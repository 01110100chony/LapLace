use std::{
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, ChildStdout, Command},
    sync::{watch, Mutex},
    time::timeout,
};

const VERSION: u8 = 2;
const MAX_BYTES: usize = 192 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(18);
const STOP_TIMEOUT: Duration = Duration::from_millis(500);

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidRequest,
    InvalidFolder,
    NotRepository,
    GitMissing,
    PermissionDenied,
    GitFailed,
    GitTimeout,
    ProjectUnavailable,
    ProjectIdentityMismatch,
    ProjectIdentityUnknown,
    ProjectAlreadyRegistered,
    ProjectIdentityAmbiguous,
    CatalogUnavailable,
    DialogFailed,
    ServiceUnavailable,
    IpcTimeout,
    InvalidResponse,
    ContextNotFound,
    ContextPathUnavailable,
    ContextTimeout,
    ContextLimit,
    ContextNotEligible,
    ContextNotIndexed,
    ContextIndexFailed,
    ContextSearchQuery,
    ContextSourceUnavailable,
    CodexSelectionInvalid,
    CodexAuthorizationRequired,
    CodexUnavailable,
    CodexBusy,
    CodexExecutionUnavailable,
    TaskUnavailable,
    TaskConflict,
    TaskBusy,
    TaskRunnerUnavailable,
    TaskExecutionUnavailable,
    TaskResultUnavailable,
    WorkingChanged,
    WorkingUnavailable,
    WorkingConflict,
    ResultReviewConflict,
    DecisionUnavailable,
    DecisionConflict,
    DecisionAuthorizationRequired,
    DecisionPurgePending,
    ResumeStale,
    CompilerInvalidInput,
    DestinationUnknown,
    DestinationDenied,
    GrantInvalid,
    GrantRevoked,
    GrantExpired,
    HandoffInvalid,
    AuditUnavailable,
    MemoryInvalidInput,
    MemoryNotFound,
    MemoryConflict,
    PinQuotaExceeded,
    PinProtected,
    PurgeInProgress,
    ExportDenied,
    ExportExceptionInvalid,
    OverlayRaceDetected,
    OverlayBlobMissing,
    OverlayUnsafeTarget,
    CloneUnavailable,
    CloneBusy,
    CloneDestinationExists,
    CloneDestinationChanged,
}

#[derive(Deserialize, Serialize)]
pub struct Fault {
    code: ErrorCode,
}

impl From<ErrorCode> for Fault {
    fn from(code: ErrorCode) -> Self {
        Self { code }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    version: String,
    node_version: String,
}

#[derive(Deserialize, Serialize)]
pub struct Changes {
    staged: u32,
    unstaged: u32,
    untracked: u32,
    conflicted: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectRecord {
    id: String,
    root: String,
    name: String,
}

impl ProjectRecord {
    fn valid(&self) -> bool {
        valid_project_id(&self.id)
            && std::path::Path::new(&self.root).is_absolute()
            && !self.name.is_empty()
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    projects: Vec<ProjectRecord>,
    selected_project_id: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Project {
    #[serde(flatten)]
    record: ProjectRecord,
    #[serde(flatten)]
    summary: GitObservation,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SelectedProject {
    #[serde(flatten)]
    record: ProjectRecord,
    cached: Option<GitObservation>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityScopeDto {
    project_id: String,
    binding_id: String,
    worktree_id: String,
}

impl IdentityScopeDto {
    fn valid(&self) -> bool {
        valid_project_id(&self.project_id)
            && valid_project_id(&self.binding_id)
            && valid_project_id(&self.worktree_id)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScopePayload {
    scope: IdentityScopeDto,
    #[serde(flatten)]
    data: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectIdentityPayload {
    scope: IdentityScopeDto,
    legacy_project_id: String,
    #[serde(flatten)]
    data: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GitObservation {
    branch: Option<String>,
    head: Option<String>,
    changes: Changes,
    observed_at: String,
    source: String,
    summary_version: u8,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextPayload {
    project_id: String,
    context_id: Option<String>,
    // The shared TypeScript contract validates the versioned manifest and its entries.
    #[serde(flatten)]
    data: serde_json::Map<String, serde_json::Value>,
}

impl GitObservation {
    fn valid(&self) -> bool {
        self.source == "git.status" && self.summary_version == 1
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClonePlan {
    pub grant_id: String,
    pub url: String,
    pub destination: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClonePayload {
    clone_id: String,
    #[serde(flatten)]
    data: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "operation", content = "data")]
enum Payload {
    #[serde(rename = "health")]
    Health(Health),
    #[serde(rename = "workspace.list")]
    List(Catalog),
    #[serde(rename = "clone.prepare")]
    ClonePrepare(ClonePlan),
    #[serde(rename = "clone.start")]
    CloneStart(ClonePayload),
    #[serde(rename = "clone.status")]
    CloneStatus(ClonePayload),
    #[serde(rename = "clone.cancel")]
    CloneCancel(ClonePayload),
    #[serde(rename = "workspace.addLocal")]
    Add(Project),
    #[serde(rename = "project.select")]
    Select(SelectedProject),
    #[serde(rename = "project.inspect")]
    Inspect(Project),
    #[serde(rename = "project.relocate")]
    Relocate(Project),
    #[serde(rename = "context.browse")]
    ContextBrowse(ContextPayload),
    #[serde(rename = "context.capture")]
    ContextCapture(ContextPayload),
    #[serde(rename = "context.list")]
    ContextList(ContextPayload),
    #[serde(rename = "context.get")]
    ContextGet(ContextPayload),
    #[serde(rename = "context.validate")]
    ContextValidate(ContextPayload),
    #[serde(rename = "context.indexStatus")]
    ContextIndexStatus(ContextPayload),
    #[serde(rename = "context.index")]
    ContextIndex(ContextPayload),
    #[serde(rename = "context.search")]
    ContextSearch(ContextPayload),
    #[serde(rename = "context.sourcePreview")]
    ContextSourcePreview(ContextPayload),
    #[serde(rename = "codex.status")]
    CodexStatus(ContextPayload),
    #[serde(rename = "codex.prepare")]
    CodexPrepare(ContextPayload),
    #[serde(rename = "codex.approval")]
    CodexApproval(ContextPayload),
    #[serde(rename = "codex.start")]
    CodexStart(ContextPayload),
    #[serde(rename = "codex.events")]
    CodexEvents(ContextPayload),
    #[serde(rename = "codex.cancel")]
    CodexCancel(ContextPayload),
    #[serde(rename = "codex.history")]
    CodexHistory(ContextPayload),
    #[serde(rename = "codex.citation")]
    CodexCitation(ContextPayload),
    #[serde(rename = "task.list")]
    TaskList(ContextPayload),
    #[serde(rename = "task.create")]
    TaskCreate(ContextPayload),
    #[serde(rename = "task.update")]
    TaskUpdate(ContextPayload),
    #[serde(rename = "task.start")]
    TaskStart(ContextPayload),
    #[serde(rename = "execution.latest")]
    ExecutionLatest(ContextPayload),
    #[serde(rename = "execution.events")]
    ExecutionEvents(ContextPayload),
    #[serde(rename = "execution.cancel")]
    ExecutionCancel(ContextPayload),
    #[serde(rename = "execution.result")]
    ExecutionResult(ContextPayload),
    #[serde(rename = "execution.change")]
    ExecutionChange(ContextPayload),
    #[serde(rename = "working.list")]
    WorkingList(ContextPayload),
    #[serde(rename = "working.latest")]
    WorkingLatest(ContextPayload),
    #[serde(rename = "working.capture")]
    WorkingCapture(ContextPayload),
    #[serde(rename = "working.compare")]
    WorkingCompare(ContextPayload),
    #[serde(rename = "result.reviewStatus")]
    ResultReviewStatus(ContextPayload),
    #[serde(rename = "result.review")]
    ResultReview(ContextPayload),
    #[serde(rename = "project.identity")]
    ProjectIdentity(ProjectIdentityPayload),
    #[serde(rename = "project.resume")]
    ProjectResume(ScopePayload),
    #[serde(rename = "decision.evidenceResolve")]
    DecisionEvidenceResolve(ScopePayload),
    #[serde(rename = "decision.comparePresent")]
    DecisionComparePresent(ScopePayload),
    #[serde(rename = "decision.record")]
    DecisionRecord(ContextPayload),
    #[serde(rename = "decision.list")]
    DecisionList(ScopePayload),
    #[serde(rename = "decision.get")]
    DecisionGet(ScopePayload),
    #[serde(rename = "decision.purge")]
    DecisionPurge(ScopePayload),
    #[serde(rename = "compiler.compile")]
    CompilerCompile(ScopePayload),
    #[serde(rename = "compiler.grantIssue")]
    CompilerGrantIssue(ScopePayload),
    #[serde(rename = "compiler.grantList")]
    CompilerGrantList(ScopePayload),
    #[serde(rename = "compiler.grantRevoke")]
    CompilerGrantRevoke(ScopePayload),
    #[serde(rename = "compiler.packageExport")]
    CompilerPackageExport(ScopePayload),
    #[serde(rename = "compiler.handoffImport")]
    CompilerHandoffImport(ScopePayload),
    #[serde(rename = "compiler.mcpCall")]
    CompilerMcpCall(ScopePayload),
    #[serde(rename = "compiler.queryRun")]
    CompilerQueryRun(ScopePayload),
    #[serde(rename = "compiler.auditList")]
    CompilerAuditList(ScopePayload),
    #[serde(rename = "compiler.auditReview")]
    CompilerAuditReview(ScopePayload),
    #[serde(rename = "memory.claimRecord")]
    MemoryClaimRecord(ScopePayload),
    #[serde(rename = "memory.claimCorrect")]
    MemoryClaimCorrect(ScopePayload),
    #[serde(rename = "memory.relationRecord")]
    MemoryRelationRecord(ScopePayload),
    #[serde(rename = "memory.timeline")]
    MemoryTimeline(ScopePayload),
    #[serde(rename = "memory.pinCreate")]
    MemoryPinCreate(ScopePayload),
    #[serde(rename = "memory.pinList")]
    MemoryPinList(ScopePayload),
    #[serde(rename = "memory.pinVerify")]
    MemoryPinVerify(ScopePayload),
    #[serde(rename = "memory.pinRelease")]
    MemoryPinRelease(ScopePayload),
    #[serde(rename = "memory.gcRun")]
    MemoryGcRun(ScopePayload),
    #[serde(rename = "memory.purgeStart")]
    MemoryPurgeStart(ScopePayload),
    #[serde(rename = "memory.purgeResume")]
    MemoryPurgeResume(ScopePayload),
    #[serde(rename = "memory.purgeStatus")]
    MemoryPurgeStatus(ScopePayload),
    #[serde(rename = "memory.inboxSubmit")]
    MemoryInboxSubmit(ScopePayload),
    #[serde(rename = "memory.inboxList")]
    MemoryInboxList(ScopePayload),
    #[serde(rename = "memory.inboxReview")]
    MemoryInboxReview(ScopePayload),
    #[serde(rename = "memory.exportPreview")]
    MemoryExportPreview(ScopePayload),
    #[serde(rename = "memory.exportExceptionGrant")]
    MemoryExportExceptionGrant(ScopePayload),
    #[serde(rename = "memory.exportExecute")]
    MemoryExportExecute(ScopePayload),
    #[serde(rename = "memory.overlayCapture")]
    MemoryOverlayCapture(ScopePayload),
    #[serde(rename = "memory.overlayList")]
    MemoryOverlayList(ScopePayload),
    #[serde(rename = "memory.overlayVerify")]
    MemoryOverlayVerify(ScopePayload),
    #[serde(rename = "memory.overlayReconstruct")]
    MemoryOverlayReconstruct(ScopePayload),
}

impl Payload {
    fn operation(&self) -> &'static str {
        match self {
            Self::Health(_) => "health",
            Self::List(_) => "workspace.list",
            Self::Add(_) => "workspace.addLocal",
            Self::ClonePrepare(_) => "clone.prepare",
            Self::CloneStart(_) => "clone.start",
            Self::CloneStatus(_) => "clone.status",
            Self::CloneCancel(_) => "clone.cancel",
            Self::Select(_) => "project.select",
            Self::Inspect(_) => "project.inspect",
            Self::Relocate(_) => "project.relocate",
            Self::ContextBrowse(_) => "context.browse",
            Self::ContextCapture(_) => "context.capture",
            Self::ContextList(_) => "context.list",
            Self::ContextGet(_) => "context.get",
            Self::ContextValidate(_) => "context.validate",
            Self::ContextIndexStatus(_) => "context.indexStatus",
            Self::ContextIndex(_) => "context.index",
            Self::ContextSearch(_) => "context.search",
            Self::ContextSourcePreview(_) => "context.sourcePreview",
            Self::CodexStatus(_) => "codex.status",
            Self::CodexPrepare(_) => "codex.prepare",
            Self::CodexApproval(_) => "codex.approval",
            Self::CodexStart(_) => "codex.start",
            Self::CodexEvents(_) => "codex.events",
            Self::CodexCancel(_) => "codex.cancel",
            Self::CodexHistory(_) => "codex.history",
            Self::CodexCitation(_) => "codex.citation",
            Self::TaskList(_) => "task.list",
            Self::TaskCreate(_) => "task.create",
            Self::TaskUpdate(_) => "task.update",
            Self::TaskStart(_) => "task.start",
            Self::ExecutionLatest(_) => "execution.latest",
            Self::ExecutionEvents(_) => "execution.events",
            Self::ExecutionCancel(_) => "execution.cancel",
            Self::ExecutionResult(_) => "execution.result",
            Self::ExecutionChange(_) => "execution.change",
            Self::WorkingList(_) => "working.list",
            Self::WorkingLatest(_) => "working.latest",
            Self::WorkingCapture(_) => "working.capture",
            Self::WorkingCompare(_) => "working.compare",
            Self::ResultReviewStatus(_) => "result.reviewStatus",
            Self::ResultReview(_) => "result.review",
            Self::ProjectIdentity(_) => "project.identity",
            Self::ProjectResume(_) => "project.resume",
            Self::DecisionEvidenceResolve(_) => "decision.evidenceResolve",
            Self::DecisionComparePresent(_) => "decision.comparePresent",
            Self::DecisionRecord(_) => "decision.record",
            Self::DecisionList(_) => "decision.list",
            Self::DecisionGet(_) => "decision.get",
            Self::DecisionPurge(_) => "decision.purge",
            Self::CompilerCompile(_) => "compiler.compile",
            Self::CompilerGrantIssue(_) => "compiler.grantIssue",
            Self::CompilerGrantList(_) => "compiler.grantList",
            Self::CompilerGrantRevoke(_) => "compiler.grantRevoke",
            Self::CompilerPackageExport(_) => "compiler.packageExport",
            Self::CompilerHandoffImport(_) => "compiler.handoffImport",
            Self::CompilerMcpCall(_) => "compiler.mcpCall",
            Self::CompilerQueryRun(_) => "compiler.queryRun",
            Self::CompilerAuditList(_) => "compiler.auditList",
            Self::CompilerAuditReview(_) => "compiler.auditReview",
            Self::MemoryClaimRecord(_) => "memory.claimRecord",
            Self::MemoryClaimCorrect(_) => "memory.claimCorrect",
            Self::MemoryRelationRecord(_) => "memory.relationRecord",
            Self::MemoryTimeline(_) => "memory.timeline",
            Self::MemoryPinCreate(_) => "memory.pinCreate",
            Self::MemoryPinList(_) => "memory.pinList",
            Self::MemoryPinVerify(_) => "memory.pinVerify",
            Self::MemoryPinRelease(_) => "memory.pinRelease",
            Self::MemoryGcRun(_) => "memory.gcRun",
            Self::MemoryPurgeStart(_) => "memory.purgeStart",
            Self::MemoryPurgeResume(_) => "memory.purgeResume",
            Self::MemoryPurgeStatus(_) => "memory.purgeStatus",
            Self::MemoryInboxSubmit(_) => "memory.inboxSubmit",
            Self::MemoryInboxList(_) => "memory.inboxList",
            Self::MemoryInboxReview(_) => "memory.inboxReview",
            Self::MemoryExportPreview(_) => "memory.exportPreview",
            Self::MemoryExportExceptionGrant(_) => "memory.exportExceptionGrant",
            Self::MemoryExportExecute(_) => "memory.exportExecute",
            Self::MemoryOverlayCapture(_) => "memory.overlayCapture",
            Self::MemoryOverlayList(_) => "memory.overlayList",
            Self::MemoryOverlayVerify(_) => "memory.overlayVerify",
            Self::MemoryOverlayReconstruct(_) => "memory.overlayReconstruct",
        }
    }

    fn valid(&self) -> bool {
        match self {
            Self::Health(health) => !health.version.is_empty() && !health.node_version.is_empty(),
            Self::List(catalog) => {
                catalog.projects.iter().all(ProjectRecord::valid)
                    && catalog
                        .selected_project_id
                        .as_ref()
                        .is_none_or(|id| catalog.projects.iter().any(|project| &project.id == id))
            }
            Self::Select(project) => {
                project.record.valid() && project.cached.as_ref().is_none_or(GitObservation::valid)
            }
            Self::Add(project) | Self::Inspect(project) | Self::Relocate(project) => {
                project.record.valid() && project.summary.valid()
            }
            Self::ClonePrepare(plan) => {
                valid_id(&plan.grant_id)
                    && plan.url.starts_with("https://github.com/")
                    && std::path::Path::new(&plan.destination).is_absolute()
            }
            Self::CloneStart(data) | Self::CloneStatus(data) | Self::CloneCancel(data) => {
                valid_id(&data.clone_id)
            }
            Self::ContextBrowse(data)
            | Self::ContextList(data)
            | Self::CodexStatus(data)
            | Self::TaskList(data)
            | Self::TaskCreate(data)
            | Self::TaskUpdate(data)
            | Self::TaskStart(data)
            | Self::ExecutionLatest(data)
            | Self::ExecutionEvents(data)
            | Self::ExecutionCancel(data)
            | Self::ExecutionResult(data)
            | Self::ExecutionChange(data)
            | Self::WorkingList(data)
            | Self::WorkingLatest(data)
            | Self::WorkingCapture(data)
            | Self::WorkingCompare(data)
            | Self::ResultReviewStatus(data)
            | Self::ResultReview(data)
            | Self::DecisionRecord(data) => {
                valid_project_id(&data.project_id) && data.context_id.is_none()
            }
            Self::ProjectIdentity(data) => {
                data.scope.valid() && valid_project_id(&data.legacy_project_id)
            }
            Self::ProjectResume(data)
            | Self::DecisionEvidenceResolve(data)
            | Self::DecisionComparePresent(data)
            | Self::DecisionList(data)
            | Self::DecisionGet(data)
            | Self::DecisionPurge(data)
            | Self::CompilerCompile(data)
            | Self::CompilerGrantIssue(data)
            | Self::CompilerGrantList(data)
            | Self::CompilerGrantRevoke(data)
            | Self::CompilerPackageExport(data)
            | Self::CompilerHandoffImport(data)
            | Self::CompilerMcpCall(data)
            | Self::CompilerQueryRun(data)
            | Self::CompilerAuditList(data)
            | Self::CompilerAuditReview(data)
            | Self::MemoryClaimRecord(data)
            | Self::MemoryClaimCorrect(data)
            | Self::MemoryRelationRecord(data)
            | Self::MemoryTimeline(data)
            | Self::MemoryPinCreate(data)
            | Self::MemoryPinList(data)
            | Self::MemoryPinVerify(data)
            | Self::MemoryPinRelease(data)
            | Self::MemoryGcRun(data)
            | Self::MemoryPurgeStart(data)
            | Self::MemoryPurgeResume(data)
            | Self::MemoryPurgeStatus(data)
            | Self::MemoryInboxSubmit(data)
            | Self::MemoryInboxList(data)
            | Self::MemoryInboxReview(data)
            | Self::MemoryExportPreview(data)
            | Self::MemoryExportExceptionGrant(data)
            | Self::MemoryExportExecute(data)
            | Self::MemoryOverlayCapture(data)
            | Self::MemoryOverlayList(data)
            | Self::MemoryOverlayVerify(data)
            | Self::MemoryOverlayReconstruct(data) => data.scope.valid(),
            Self::ContextSearch(data) => {
                valid_project_id(&data.project_id)
                    && data.context_id.as_deref().is_none_or(valid_project_id)
            }
            Self::ContextCapture(data)
            | Self::ContextGet(data)
            | Self::ContextValidate(data)
            | Self::ContextIndexStatus(data)
            | Self::ContextIndex(data)
            | Self::ContextSourcePreview(data)
            | Self::CodexPrepare(data)
            | Self::CodexApproval(data)
            | Self::CodexStart(data)
            | Self::CodexEvents(data)
            | Self::CodexCancel(data)
            | Self::CodexHistory(data)
            | Self::CodexCitation(data) => {
                valid_project_id(&data.project_id)
                    && data.context_id.as_deref().is_some_and(valid_project_id)
            }
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum Body {
    Success {
        ok: bool,
        #[serde(flatten)]
        payload: Payload,
    },
    Failure {
        ok: bool,
        error: Fault,
    },
}

#[derive(Serialize, Deserialize)]
pub struct Response {
    version: u8,
    id: String,
    #[serde(flatten)]
    body: Body,
}

impl Response {
    pub fn clone_plan(self) -> Result<ClonePlan, ErrorCode> {
        match self.body {
            Body::Success {
                payload: Payload::ClonePrepare(plan),
                ..
            } => Ok(plan),
            Body::Failure { error, .. } => Err(error.code),
            _ => Err(ErrorCode::InvalidResponse),
        }
    }

    pub fn codex_approval(self) -> Result<CodexApproval, ErrorCode> {
        match self.body {
            Body::Success {
                payload: Payload::CodexApproval(data),
                ..
            } => serde_json::from_value(serde_json::Value::Object(data.data))
                .map_err(|_| ErrorCode::InvalidResponse),
            Body::Failure { error, .. } => Err(error.code),
            _ => Err(ErrorCode::InvalidResponse),
        }
    }

    fn matches(&self, id: &str, operation: Operation<'_>) -> bool {
        self.version == VERSION
            && self.id == id
            && match &self.body {
                Body::Success { ok: true, payload } => {
                    payload.operation() == operation.name()
                        && payload.valid()
                        && match (operation.scope(), payload) {
                            (
                                Some((pid, bid, wid)),
                                Payload::ProjectResume(data)
                                | Payload::DecisionEvidenceResolve(data)
                                | Payload::DecisionComparePresent(data)
                                | Payload::DecisionList(data)
                                | Payload::DecisionGet(data)
                                | Payload::DecisionPurge(data)
                                | Payload::CompilerCompile(data)
                                | Payload::CompilerGrantIssue(data)
                                | Payload::CompilerGrantList(data)
                                | Payload::CompilerGrantRevoke(data)
                                | Payload::CompilerPackageExport(data)
                                | Payload::CompilerHandoffImport(data)
                                | Payload::CompilerMcpCall(data)
                                | Payload::CompilerQueryRun(data)
                                | Payload::CompilerAuditList(data)
                                | Payload::CompilerAuditReview(data)
                                | Payload::MemoryClaimRecord(data)
                                | Payload::MemoryClaimCorrect(data)
                                | Payload::MemoryRelationRecord(data)
                                | Payload::MemoryTimeline(data)
                                | Payload::MemoryPinCreate(data)
                                | Payload::MemoryPinList(data)
                                | Payload::MemoryPinVerify(data)
                                | Payload::MemoryPinRelease(data)
                                | Payload::MemoryGcRun(data)
                                | Payload::MemoryPurgeStart(data)
                                | Payload::MemoryPurgeResume(data)
                                | Payload::MemoryPurgeStatus(data)
                                | Payload::MemoryInboxSubmit(data)
                                | Payload::MemoryInboxList(data)
                                | Payload::MemoryInboxReview(data)
                                | Payload::MemoryExportPreview(data)
                                | Payload::MemoryExportExceptionGrant(data)
                                | Payload::MemoryExportExecute(data)
                                | Payload::MemoryOverlayCapture(data)
                                | Payload::MemoryOverlayList(data)
                                | Payload::MemoryOverlayVerify(data)
                                | Payload::MemoryOverlayReconstruct(data),
                            ) => {
                                data.scope.project_id == pid
                                    && data.scope.binding_id == bid
                                    && data.scope.worktree_id == wid
                            }
                            (Some(_), _) => {
                                operation.project_id().is_none_or(|pid| match payload {
                                    Payload::DecisionRecord(data) => data.project_id == pid,
                                    _ => false,
                                })
                            }
                            (None, _) => operation.project_id().is_none_or(|pid| match payload {
                                Payload::Select(project) => project.record.id == pid,
                                Payload::Inspect(project) | Payload::Relocate(project) => {
                                    project.record.id == pid
                                }
                                Payload::ProjectIdentity(data) => data.legacy_project_id == pid,
                                Payload::ContextBrowse(data)
                                | Payload::ContextCapture(data)
                                | Payload::ContextList(data)
                                | Payload::ContextGet(data)
                                | Payload::ContextValidate(data)
                                | Payload::ContextIndexStatus(data)
                                | Payload::ContextIndex(data)
                                | Payload::ContextSearch(data)
                                | Payload::ContextSourcePreview(data)
                                | Payload::CodexStatus(data)
                                | Payload::CodexPrepare(data)
                                | Payload::CodexApproval(data)
                                | Payload::CodexStart(data)
                                | Payload::CodexEvents(data)
                                | Payload::CodexCancel(data)
                                | Payload::CodexHistory(data)
                                | Payload::CodexCitation(data)
                                | Payload::TaskList(data)
                                | Payload::TaskCreate(data)
                                | Payload::TaskUpdate(data)
                                | Payload::TaskStart(data)
                                | Payload::ExecutionLatest(data)
                                | Payload::ExecutionEvents(data)
                                | Payload::ExecutionCancel(data)
                                | Payload::ExecutionResult(data)
                                | Payload::ExecutionChange(data)
                                | Payload::WorkingList(data)
                                | Payload::WorkingLatest(data)
                                | Payload::WorkingCapture(data)
                                | Payload::WorkingCompare(data)
                                | Payload::ResultReviewStatus(data)
                                | Payload::ResultReview(data) => {
                                    data.project_id == pid
                                        && operation.snapshot_id().is_none_or(|context_id| {
                                            data.context_id.as_deref() == Some(context_id)
                                        })
                                }
                                _ => false,
                            }),
                        }
                }
                Body::Failure { ok: false, .. } => true,
                _ => false,
            }
    }
}

#[derive(Serialize)]
struct Request<'a> {
    version: u8,
    id: &'a str,
    #[serde(flatten)]
    operation: Operation<'a>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SearchScope {
    Snapshot,
    Latest,
    History,
}

#[derive(Clone, Copy, Serialize)]
#[serde(tag = "operation")]
pub enum Operation<'a> {
    #[serde(rename = "health")]
    Health,
    #[serde(rename = "workspace.list")]
    List,
    #[serde(rename = "clone.prepare")]
    ClonePrepare { url: &'a str, parent: &'a str },
    #[serde(rename = "clone.start", rename_all = "camelCase")]
    CloneStart { grant_id: &'a str },
    #[serde(rename = "clone.status", rename_all = "camelCase")]
    CloneStatus { clone_id: &'a str },
    #[serde(rename = "clone.cancel", rename_all = "camelCase")]
    CloneCancel { clone_id: &'a str },
    #[serde(rename = "workspace.addLocal")]
    Add { path: &'a str },
    #[serde(rename = "project.select")]
    Select {
        #[serde(rename = "projectId")]
        project_id: &'a str,
    },
    #[serde(rename = "project.inspect")]
    Inspect {
        #[serde(rename = "projectId")]
        project_id: &'a str,
    },
    #[serde(rename = "project.relocate")]
    Relocate {
        #[serde(rename = "projectId")]
        project_id: &'a str,
        path: &'a str,
    },
    #[serde(rename = "context.browse", rename_all = "camelCase")]
    ContextBrowse {
        project_id: &'a str,
        folder: &'a str,
        prefix: &'a str,
    },
    #[serde(rename = "context.capture", rename_all = "camelCase")]
    ContextCapture {
        project_id: &'a str,
        paths: &'a [String],
    },
    #[serde(rename = "context.list", rename_all = "camelCase")]
    ContextList {
        project_id: &'a str,
        before: Option<&'a str>,
    },
    #[serde(rename = "context.get", rename_all = "camelCase")]
    ContextGet {
        project_id: &'a str,
        context_id: &'a str,
    },
    #[serde(rename = "context.validate", rename_all = "camelCase")]
    ContextValidate {
        project_id: &'a str,
        context_id: &'a str,
    },
    #[serde(rename = "context.indexStatus", rename_all = "camelCase")]
    ContextIndexStatus {
        project_id: &'a str,
        context_id: Option<&'a str>,
    },
    #[serde(rename = "context.index", rename_all = "camelCase")]
    ContextIndex {
        project_id: &'a str,
        context_id: &'a str,
        force: bool,
    },
    #[serde(rename = "context.search", rename_all = "camelCase")]
    ContextSearch {
        project_id: &'a str,
        context_id: Option<&'a str>,
        scope: SearchScope,
        query: &'a str,
        offset: u32,
    },
    #[serde(rename = "context.sourcePreview", rename_all = "camelCase")]
    ContextSourcePreview {
        project_id: &'a str,
        context_id: &'a str,
        path: &'a str,
        sha256: &'a str,
        chunk: u32,
    },
    #[serde(untagged)]
    Codex(&'a CodexRequest),
    #[serde(untagged)]
    Task(&'a TaskRequest),
    #[serde(untagged)]
    Working(&'a WorkingRequest),
    #[serde(untagged)]
    Resume(&'a ResumeRequest),
    #[serde(untagged)]
    Compiler(&'a CompilerRequest),
    #[serde(untagged)]
    Memory(&'a MemoryRequest),
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CodexSelection {
    path: String,
    sha256: String,
    chunk: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CodexMode {
    VerifiedIsolated,
    MockDevelopment,
    UnconfinedWorkspaceDevelopment,
}

#[derive(Deserialize)]
pub struct CodexApprovalSource {
    pub path: String,
    pub bytes: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexApproval {
    pub mode: CodexMode,
    pub grant_id: String,
    pub manifest_digest: String,
    pub project_name: String,
    pub snapshot_digest: String,
    pub sources: Vec<CodexApprovalSource>,
    pub source_bytes: u32,
    pub prompt_bytes: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(
    tag = "operation",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CodexRequest {
    #[serde(rename = "codex.status")]
    Status { project_id: String },
    #[serde(rename = "codex.prepare")]
    Prepare {
        project_id: String,
        context_id: String,
        snapshot_digest: String,
        question: String,
        selection: Vec<CodexSelection>,
    },
    #[serde(rename = "codex.approval", skip_deserializing)]
    Approval {
        project_id: String,
        context_id: String,
        grant_id: String,
        manifest_digest: String,
    },
    #[serde(rename = "codex.start")]
    Start {
        project_id: String,
        context_id: String,
        grant_id: String,
        manifest_digest: String,
        #[serde(skip_deserializing)]
        confirmed: bool,
        #[serde(skip_deserializing, skip_serializing_if = "std::ops::Not::not")]
        unconfined_confirmed: bool,
    },
    #[serde(rename = "codex.events")]
    Events {
        project_id: String,
        context_id: String,
        execution_id: String,
        after_seq: u32,
    },
    #[serde(rename = "codex.cancel")]
    Cancel {
        project_id: String,
        context_id: String,
        execution_id: String,
    },
    #[serde(rename = "codex.history")]
    History {
        project_id: String,
        context_id: String,
        before: Option<String>,
    },
    #[serde(rename = "codex.citation")]
    Citation {
        project_id: String,
        context_id: String,
        execution_id: String,
        source_id: String,
    },
}

impl CodexRequest {
    fn name(&self) -> &'static str {
        match self {
            Self::Status { .. } => "codex.status",
            Self::Prepare { .. } => "codex.prepare",
            Self::Approval { .. } => "codex.approval",
            Self::Start { .. } => "codex.start",
            Self::Events { .. } => "codex.events",
            Self::Cancel { .. } => "codex.cancel",
            Self::History { .. } => "codex.history",
            Self::Citation { .. } => "codex.citation",
        }
    }

    fn project_id(&self) -> &str {
        match self {
            Self::Status { project_id }
            | Self::Prepare { project_id, .. }
            | Self::Approval { project_id, .. }
            | Self::Start { project_id, .. }
            | Self::Events { project_id, .. }
            | Self::Cancel { project_id, .. }
            | Self::History { project_id, .. }
            | Self::Citation { project_id, .. } => project_id,
        }
    }

    fn snapshot_id(&self) -> Option<&str> {
        match self {
            Self::Status { .. } => None,
            Self::Prepare { context_id, .. }
            | Self::Approval { context_id, .. }
            | Self::Start { context_id, .. }
            | Self::Events { context_id, .. }
            | Self::Cancel { context_id, .. }
            | Self::History { context_id, .. }
            | Self::Citation { context_id, .. } => Some(context_id),
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskSource {
    context_id: String,
    execution_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(
    tag = "operation",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum TaskRequest {
    #[serde(rename = "task.list")]
    List {
        project_id: String,
        before: Option<String>,
    },
    #[serde(rename = "task.create")]
    Create {
        project_id: String,
        task_id: String,
        title: String,
        objective: String,
        source: Option<TaskSource>,
    },
    #[serde(rename = "task.update")]
    Update {
        project_id: String,
        task_id: String,
        title: String,
        objective: String,
        expected_revision: u64,
    },
    #[serde(rename = "task.start")]
    Start {
        project_id: String,
        task_id: String,
        request_id: String,
        expected_revision: u64,
    },
    #[serde(rename = "execution.latest")]
    Latest { project_id: String, task_id: String },
    #[serde(rename = "execution.events")]
    Events {
        project_id: String,
        task_id: String,
        execution_id: String,
        after_seq: u32,
    },
    #[serde(rename = "execution.cancel")]
    Cancel {
        project_id: String,
        task_id: String,
        execution_id: String,
    },
    #[serde(rename = "execution.result")]
    Result {
        project_id: String,
        task_id: String,
        execution_id: String,
    },
    #[serde(rename = "execution.change")]
    Change {
        project_id: String,
        task_id: String,
        execution_id: String,
        path: String,
    },
    #[serde(rename = "result.reviewStatus")]
    ReviewStatus {
        project_id: String,
        task_id: String,
        execution_id: String,
    },
    #[serde(rename = "result.review")]
    Review {
        project_id: String,
        task_id: String,
        execution_id: String,
        request_id: String,
        expected_base: String,
        expected_revision: u64,
        choice: ReviewChoice,
    },
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReviewChoice {
    Approved,
    Rejected,
}

impl TaskRequest {
    fn name(&self) -> &'static str {
        match self {
            Self::List { .. } => "task.list",
            Self::Create { .. } => "task.create",
            Self::Update { .. } => "task.update",
            Self::Start { .. } => "task.start",
            Self::Latest { .. } => "execution.latest",
            Self::Events { .. } => "execution.events",
            Self::Cancel { .. } => "execution.cancel",
            Self::Result { .. } => "execution.result",
            Self::Change { .. } => "execution.change",
            Self::ReviewStatus { .. } => "result.reviewStatus",
            Self::Review { .. } => "result.review",
        }
    }

    fn project_id(&self) -> &str {
        match self {
            Self::List { project_id, .. }
            | Self::Create { project_id, .. }
            | Self::Update { project_id, .. }
            | Self::Start { project_id, .. }
            | Self::Latest { project_id, .. }
            | Self::Events { project_id, .. }
            | Self::Cancel { project_id, .. }
            | Self::Result { project_id, .. }
            | Self::Change { project_id, .. }
            | Self::ReviewStatus { project_id, .. }
            | Self::Review { project_id, .. } => project_id,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WorkingLayer {
    Staged,
    Unstaged,
}

#[derive(Deserialize, Serialize)]
#[serde(
    tag = "operation",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum WorkingRequest {
    #[serde(rename = "working.list")]
    List { project_id: String },
    #[serde(rename = "working.latest")]
    Latest { project_id: String },
    #[serde(rename = "working.capture")]
    Capture {
        project_id: String,
        paths: Vec<String>,
    },
    #[serde(rename = "working.compare")]
    Compare {
        project_id: String,
        snapshot_id: String,
        path: String,
        layer: WorkingLayer,
    },
}

impl WorkingRequest {
    fn name(&self) -> &'static str {
        match self {
            Self::List { .. } => "working.list",
            Self::Latest { .. } => "working.latest",
            Self::Capture { .. } => "working.capture",
            Self::Compare { .. } => "working.compare",
        }
    }

    fn project_id(&self) -> &str {
        match self {
            Self::List { project_id }
            | Self::Latest { project_id }
            | Self::Capture { project_id, .. }
            | Self::Compare { project_id, .. } => project_id,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DecisionEvidenceRefInput {
    context_id: String,
    path: String,
    sha256: String,
    chunk: u32,
}

#[derive(Deserialize, Serialize)]
#[serde(
    tag = "operation",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ResumeRequest {
    #[serde(rename = "project.identity")]
    Identity {
        project_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        path: Option<String>,
    },
    #[serde(rename = "project.resume")]
    Resume {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        correlation_id: Option<String>,
    },
    #[serde(rename = "decision.evidenceResolve")]
    EvidenceResolve {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        context_id: String,
        path: String,
        sha256: String,
        chunk: u32,
    },
    #[serde(rename = "decision.comparePresent")]
    ComparePresent {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        context_id: String,
        path: String,
        sha256: String,
        chunk: u32,
    },
    #[serde(rename = "decision.record")]
    DecisionRecord {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        request_id: String,
        assertion_id: Option<String>,
        expected_revision: u64,
        content: String,
        author: String,
        reason: String,
        human_confirmed: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        promote_canonical: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        effective_at: Option<String>,
        evidence: Option<DecisionEvidenceRefInput>,
    },
    #[serde(rename = "decision.list")]
    DecisionList {
        project_id: String,
        binding_id: String,
        worktree_id: String,
    },
    #[serde(rename = "decision.get")]
    DecisionGet {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        assertion_id: String,
    },
    #[serde(rename = "decision.purge")]
    DecisionPurge {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        assertion_id: String,
        expected_revision: u64,
        confirmed_scope: bool,
        reason: String,
    },
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompilerPreferenceInput {
    key: String,
    title: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    mandatory: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    conflict_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    conflict_polarity: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompilerIdentityScopeInput {
    project_id: String,
    binding_id: String,
    worktree_id: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompilerExtraCandidateInput {
    candidate_id: String,
    kind: String,
    tier: String,
    mandatory: bool,
    visibility: String,
    version: String,
    title: String,
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    scope: Option<CompilerIdentityScopeInput>,
    #[serde(skip_serializing_if = "Option::is_none")]
    conflict_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    conflict_polarity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    private_metadata: Option<std::collections::BTreeMap<String, String>>,
}

#[derive(Deserialize, Serialize)]
#[serde(
    tag = "operation",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum CompilerRequest {
    #[serde(rename = "compiler.compile")]
    Compile {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        objective: String,
        destination_id: String,
        budget_bytes: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        policy_version: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        strategy_version: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        context_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        selection: Option<Vec<CodexSelection>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        project_preferences: Option<Vec<CompilerPreferenceInput>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        personal_preferences: Option<Vec<CompilerPreferenceInput>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        extra_candidates: Option<Vec<CompilerExtraCandidateInput>>,
    },
    #[serde(rename = "compiler.grantIssue")]
    GrantIssue {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        session_id: String,
        manifest_digest: String,
        policy_version: String,
        destination_id: String,
        allowed_operations: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        ttl_ms: Option<u64>,
        human_confirmed: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        unconfined_confirmed: Option<bool>,
    },
    #[serde(rename = "compiler.grantList")]
    GrantList {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        manifest_digest: Option<String>,
    },
    #[serde(rename = "compiler.grantRevoke")]
    GrantRevoke {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        grant_id: String,
        reason: String,
    },
    #[serde(rename = "compiler.packageExport")]
    PackageExport {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        grant_id: String,
        session_id: String,
        manifest_digest: String,
        policy_version: String,
        destination_id: String,
        include_handoff: bool,
    },
    #[serde(rename = "compiler.handoffImport")]
    HandoffImport {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        destination_id: String,
        human_confirmed: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        context_package: Option<serde_json::Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        handoff: Option<serde_json::Value>,
    },
    #[serde(rename = "compiler.mcpCall")]
    McpCall {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        grant_id: String,
        session_id: String,
        manifest_digest: String,
        policy_version: String,
        destination_id: String,
        method: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        query: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cursor: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        limit: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        opaque_ref: Option<String>,
    },
    #[serde(rename = "compiler.queryRun")]
    QueryRun {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        grant_id: String,
        session_id: String,
        manifest_digest: String,
        policy_version: String,
        destination_id: String,
        channel: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        unconfined_confirmed: Option<bool>,
    },
    #[serde(rename = "compiler.auditList")]
    AuditList {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        manifest_digest: Option<String>,
    },
    #[serde(rename = "compiler.auditReview")]
    AuditReview {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        audit_id: String,
        status: String,
        reviewer: String,
        note: String,
        human_confirmed: bool,
    },
}

impl CompilerRequest {
    fn name(&self) -> &'static str {
        match self {
            Self::Compile { .. } => "compiler.compile",
            Self::GrantIssue { .. } => "compiler.grantIssue",
            Self::GrantList { .. } => "compiler.grantList",
            Self::GrantRevoke { .. } => "compiler.grantRevoke",
            Self::PackageExport { .. } => "compiler.packageExport",
            Self::HandoffImport { .. } => "compiler.handoffImport",
            Self::McpCall { .. } => "compiler.mcpCall",
            Self::QueryRun { .. } => "compiler.queryRun",
            Self::AuditList { .. } => "compiler.auditList",
            Self::AuditReview { .. } => "compiler.auditReview",
        }
    }

    fn project_id(&self) -> &str {
        match self {
            Self::Compile { project_id, .. }
            | Self::GrantIssue { project_id, .. }
            | Self::GrantList { project_id, .. }
            | Self::GrantRevoke { project_id, .. }
            | Self::PackageExport { project_id, .. }
            | Self::HandoffImport { project_id, .. }
            | Self::McpCall { project_id, .. }
            | Self::QueryRun { project_id, .. }
            | Self::AuditList { project_id, .. }
            | Self::AuditReview { project_id, .. } => project_id,
        }
    }

    fn scope(&self) -> (&str, &str, &str) {
        match self {
            Self::Compile {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::GrantIssue {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::GrantList {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::GrantRevoke {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::PackageExport {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::HandoffImport {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::McpCall {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::QueryRun {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::AuditList {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::AuditReview {
                project_id,
                binding_id,
                worktree_id,
                ..
            } => (project_id, binding_id, worktree_id),
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(
    tag = "operation",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MemoryRequest {
    #[serde(rename = "memory.claimRecord")]
    ClaimRecord {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        request_id: String,
        title: String,
        content: String,
        author: String,
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        promote_canonical: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        visibility: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        conflict_key: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        conflict_polarity: Option<String>,
        valid_from: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        valid_to: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        known_at: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        evidence_ref: Option<serde_json::Value>,
    },
    #[serde(rename = "memory.claimCorrect")]
    ClaimCorrect {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        request_id: String,
        claim_id: String,
        content: String,
        author: String,
        reason: String,
        correct_from: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        correct_to: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        known_at: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        conflict_key: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        conflict_polarity: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        evidence_ref: Option<serde_json::Value>,
    },
    #[serde(rename = "memory.relationRecord")]
    RelationRecord {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        from_id: String,
        to_id: String,
        kind: String,
        signal_kind: String,
        rationale: String,
        author: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        known_at: Option<String>,
    },
    #[serde(rename = "memory.timeline")]
    Timeline {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        known_at: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        valid_at: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        signal_kinds: Option<Vec<String>>,
    },
    #[serde(rename = "memory.pinCreate")]
    PinCreate {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        label: String,
        source: serde_json::Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        quota_bytes: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        protected_claim_id: Option<String>,
    },
    #[serde(rename = "memory.pinList")]
    PinList {
        project_id: String,
        binding_id: String,
        worktree_id: String,
    },
    #[serde(rename = "memory.pinVerify")]
    PinVerify {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pin_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        unpinned_ref: Option<serde_json::Value>,
    },
    #[serde(rename = "memory.pinRelease")]
    PinRelease {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        pin_id: String,
        human_confirmed: bool,
    },
    #[serde(rename = "memory.gcRun")]
    GcRun {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        quota_bytes: Option<u64>,
        human_confirmed: bool,
    },
    #[serde(rename = "memory.purgeStart")]
    PurgeStart {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        target_kind: String,
        target_id: String,
        reason: String,
        human_confirmed: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        max_steps: Option<u32>,
    },
    #[serde(rename = "memory.purgeResume")]
    PurgeResume {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        purge_id: String,
    },
    #[serde(rename = "memory.purgeStatus")]
    PurgeStatus {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        purge_id: String,
    },
    #[serde(rename = "memory.inboxSubmit")]
    InboxSubmit {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        title: String,
        content: String,
        target_kind: String,
        origin_label: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        visibility: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        ttl_ms: Option<u64>,
    },
    #[serde(rename = "memory.inboxList")]
    InboxList {
        project_id: String,
        binding_id: String,
        worktree_id: String,
    },
    #[serde(rename = "memory.inboxReview")]
    InboxReview {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        proposal_id: String,
        decision: String,
        reviewer: String,
        note: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        promote_canonical: Option<bool>,
        human_confirmed: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        valid_from: Option<String>,
    },
    #[serde(rename = "memory.exportPreview")]
    ExportPreview {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        destination_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        policy_version: Option<String>,
        items: serde_json::Value,
    },
    #[serde(rename = "memory.exportExceptionGrant")]
    ExportExceptionGrant {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        bundle_digest: String,
        destination_id: String,
        policy_version: String,
        reviewer: String,
        reason: String,
        human_confirmed: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        has_db_only_items: Option<bool>,
    },
    #[serde(rename = "memory.exportExecute")]
    ExportExecute {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        destination_id: String,
        policy_version: String,
        items: serde_json::Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        exception_id: Option<String>,
    },
    #[serde(rename = "memory.overlayCapture")]
    OverlayCapture {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        label: String,
    },
    #[serde(rename = "memory.overlayList")]
    OverlayList {
        project_id: String,
        binding_id: String,
        worktree_id: String,
    },
    #[serde(rename = "memory.overlayVerify")]
    OverlayVerify {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        overlay_id: String,
    },
    #[serde(rename = "memory.overlayReconstruct")]
    OverlayReconstruct {
        project_id: String,
        binding_id: String,
        worktree_id: String,
        overlay_id: String,
        target_dir: String,
        disposable_target_confirmed: bool,
    },
}

impl MemoryRequest {
    fn name(&self) -> &'static str {
        match self {
            Self::ClaimRecord { .. } => "memory.claimRecord",
            Self::ClaimCorrect { .. } => "memory.claimCorrect",
            Self::RelationRecord { .. } => "memory.relationRecord",
            Self::Timeline { .. } => "memory.timeline",
            Self::PinCreate { .. } => "memory.pinCreate",
            Self::PinList { .. } => "memory.pinList",
            Self::PinVerify { .. } => "memory.pinVerify",
            Self::PinRelease { .. } => "memory.pinRelease",
            Self::GcRun { .. } => "memory.gcRun",
            Self::PurgeStart { .. } => "memory.purgeStart",
            Self::PurgeResume { .. } => "memory.purgeResume",
            Self::PurgeStatus { .. } => "memory.purgeStatus",
            Self::InboxSubmit { .. } => "memory.inboxSubmit",
            Self::InboxList { .. } => "memory.inboxList",
            Self::InboxReview { .. } => "memory.inboxReview",
            Self::ExportPreview { .. } => "memory.exportPreview",
            Self::ExportExceptionGrant { .. } => "memory.exportExceptionGrant",
            Self::ExportExecute { .. } => "memory.exportExecute",
            Self::OverlayCapture { .. } => "memory.overlayCapture",
            Self::OverlayList { .. } => "memory.overlayList",
            Self::OverlayVerify { .. } => "memory.overlayVerify",
            Self::OverlayReconstruct { .. } => "memory.overlayReconstruct",
        }
    }

    fn project_id(&self) -> &str {
        match self {
            Self::ClaimRecord { project_id, .. }
            | Self::ClaimCorrect { project_id, .. }
            | Self::RelationRecord { project_id, .. }
            | Self::Timeline { project_id, .. }
            | Self::PinCreate { project_id, .. }
            | Self::PinList { project_id, .. }
            | Self::PinVerify { project_id, .. }
            | Self::PinRelease { project_id, .. }
            | Self::GcRun { project_id, .. }
            | Self::PurgeStart { project_id, .. }
            | Self::PurgeResume { project_id, .. }
            | Self::PurgeStatus { project_id, .. }
            | Self::InboxSubmit { project_id, .. }
            | Self::InboxList { project_id, .. }
            | Self::InboxReview { project_id, .. }
            | Self::ExportPreview { project_id, .. }
            | Self::ExportExceptionGrant { project_id, .. }
            | Self::ExportExecute { project_id, .. }
            | Self::OverlayCapture { project_id, .. }
            | Self::OverlayList { project_id, .. }
            | Self::OverlayVerify { project_id, .. }
            | Self::OverlayReconstruct { project_id, .. } => project_id,
        }
    }

    fn scope(&self) -> (&str, &str, &str) {
        match self {
            Self::ClaimRecord {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::ClaimCorrect {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::RelationRecord {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::Timeline {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::PinCreate {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::PinList {
                project_id,
                binding_id,
                worktree_id,
            }
            | Self::PinVerify {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::PinRelease {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::GcRun {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::PurgeStart {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::PurgeResume {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::PurgeStatus {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::InboxSubmit {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::InboxList {
                project_id,
                binding_id,
                worktree_id,
            }
            | Self::InboxReview {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::ExportPreview {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::ExportExceptionGrant {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::ExportExecute {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::OverlayCapture {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::OverlayList {
                project_id,
                binding_id,
                worktree_id,
            }
            | Self::OverlayVerify {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::OverlayReconstruct {
                project_id,
                binding_id,
                worktree_id,
                ..
            } => (project_id, binding_id, worktree_id),
        }
    }
}

impl ResumeRequest {
    fn name(&self) -> &'static str {
        match self {
            Self::Identity { .. } => "project.identity",
            Self::Resume { .. } => "project.resume",
            Self::EvidenceResolve { .. } => "decision.evidenceResolve",
            Self::ComparePresent { .. } => "decision.comparePresent",
            Self::DecisionRecord { .. } => "decision.record",
            Self::DecisionList { .. } => "decision.list",
            Self::DecisionGet { .. } => "decision.get",
            Self::DecisionPurge { .. } => "decision.purge",
        }
    }

    fn project_id(&self) -> &str {
        match self {
            Self::Identity { project_id, .. }
            | Self::Resume { project_id, .. }
            | Self::EvidenceResolve { project_id, .. }
            | Self::ComparePresent { project_id, .. }
            | Self::DecisionRecord { project_id, .. }
            | Self::DecisionList { project_id, .. }
            | Self::DecisionGet { project_id, .. }
            | Self::DecisionPurge { project_id, .. } => project_id,
        }
    }

    fn scope(&self) -> Option<(&str, &str, &str)> {
        match self {
            Self::Identity { .. } => None,
            Self::Resume {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::EvidenceResolve {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::ComparePresent {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::DecisionRecord {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::DecisionList {
                project_id,
                binding_id,
                worktree_id,
            }
            | Self::DecisionGet {
                project_id,
                binding_id,
                worktree_id,
                ..
            }
            | Self::DecisionPurge {
                project_id,
                binding_id,
                worktree_id,
                ..
            } => Some((project_id, binding_id, worktree_id)),
        }
    }
}

impl<'a> Operation<'a> {
    fn name(self) -> &'static str {
        match self {
            Self::Health => "health",
            Self::List => "workspace.list",
            Self::Add { .. } => "workspace.addLocal",
            Self::ClonePrepare { .. } => "clone.prepare",
            Self::CloneStart { .. } => "clone.start",
            Self::CloneStatus { .. } => "clone.status",
            Self::CloneCancel { .. } => "clone.cancel",
            Self::Select { .. } => "project.select",
            Self::Inspect { .. } => "project.inspect",
            Self::Relocate { .. } => "project.relocate",
            Self::ContextBrowse { .. } => "context.browse",
            Self::ContextCapture { .. } => "context.capture",
            Self::ContextList { .. } => "context.list",
            Self::ContextGet { .. } => "context.get",
            Self::ContextValidate { .. } => "context.validate",
            Self::ContextIndexStatus { .. } => "context.indexStatus",
            Self::ContextIndex { .. } => "context.index",
            Self::ContextSearch { .. } => "context.search",
            Self::ContextSourcePreview { .. } => "context.sourcePreview",
            Self::Codex(request) => request.name(),
            Self::Task(request) => request.name(),
            Self::Working(request) => request.name(),
            Self::Resume(request) => request.name(),
            Self::Compiler(request) => request.name(),
            Self::Memory(request) => request.name(),
        }
    }

    fn project_id(self) -> Option<&'a str> {
        match self {
            Self::Select { project_id }
            | Self::Inspect { project_id }
            | Self::Relocate { project_id, .. }
            | Self::ContextBrowse { project_id, .. }
            | Self::ContextCapture { project_id, .. }
            | Self::ContextList { project_id, .. }
            | Self::ContextGet { project_id, .. }
            | Self::ContextValidate { project_id, .. }
            | Self::ContextIndexStatus { project_id, .. }
            | Self::ContextIndex { project_id, .. }
            | Self::ContextSearch { project_id, .. }
            | Self::ContextSourcePreview { project_id, .. } => Some(project_id),
            Self::Codex(request) => Some(request.project_id()),
            Self::Task(request) => Some(request.project_id()),
            Self::Working(request) => Some(request.project_id()),
            Self::Resume(request) => Some(request.project_id()),
            Self::Compiler(request) => Some(request.project_id()),
            Self::Memory(request) => Some(request.project_id()),
            _ => None,
        }
    }

    fn scope(self) -> Option<(&'a str, &'a str, &'a str)> {
        match self {
            Self::Resume(request) => request.scope(),
            Self::Compiler(request) => Some(request.scope()),
            Self::Memory(request) => Some(request.scope()),
            _ => None,
        }
    }

    fn snapshot_id(self) -> Option<&'a str> {
        match self {
            Self::ContextGet { context_id, .. }
            | Self::ContextValidate { context_id, .. }
            | Self::ContextIndex { context_id, .. }
            | Self::ContextSourcePreview { context_id, .. } => Some(context_id),
            Self::ContextIndexStatus { context_id, .. }
            | Self::ContextSearch { context_id, .. } => context_id,
            Self::Codex(request) => request.snapshot_id(),
            _ => None,
        }
    }
}

pub fn valid_project_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

struct Process {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}

impl Process {
    async fn exchange(&mut self, request: &[u8]) -> Result<Response, ErrorCode> {
        self.input
            .write_all(request)
            .await
            .map_err(|_| ErrorCode::ServiceUnavailable)?;
        self.input
            .flush()
            .await
            .map_err(|_| ErrorCode::ServiceUnavailable)?;

        let mut line = Vec::new();
        let bytes = (&mut self.output)
            .take((MAX_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)
            .await
            .map_err(|_| ErrorCode::ServiceUnavailable)?;
        if bytes == 0 {
            return Err(ErrorCode::ServiceUnavailable);
        }
        if bytes > MAX_BYTES || line.last() != Some(&b'\n') {
            return Err(ErrorCode::InvalidResponse);
        }
        serde_json::from_slice(&line).map_err(|_| ErrorCode::InvalidResponse)
    }

    async fn stop(self) {
        let Self {
            mut child,
            input,
            output: _output,
        } = self;
        drop(input);
        if !matches!(timeout(STOP_TIMEOUT, child.wait()).await, Ok(Ok(_))) {
            let _ = child.kill().await;
        }
    }
}

pub struct Sidecar {
    runtime: PathBuf,
    script: PathBuf,
    data_dir: PathBuf,
    process: Mutex<Option<Process>>,
    stopped: watch::Sender<bool>,
}

impl Sidecar {
    pub fn new(runtime: PathBuf, script: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            runtime,
            script,
            data_dir,
            process: Mutex::new(None),
            stopped: watch::channel(false).0,
        }
    }

    fn spawn(&self) -> Result<Process, ErrorCode> {
        let helper = self.runtime.with_file_name("laplace-git-job.exe");
        let mut command = Command::new(&self.runtime);
        command
            // Node's CommonJS resolver cannot canonicalize a Windows verbatim path.
            .arg("--preserve-symlinks-main")
            .arg(&self.script)
            .arg(&self.data_dir)
            .arg(&helper)
            .env_remove("NODE_OPTIONS")
            .env_remove("NODE_PATH")
            .env_remove("NODE_V8_COVERAGE")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true);

        #[cfg(windows)]
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

        #[cfg(all(windows, debug_assertions, not(feature = "custom-protocol")))]
        match std::env::var("LAPLACE_CODEX_DEV").as_deref() {
            Ok("mock") => {
                command.arg("--codex-mock").arg(
                    std::env::var("LAPLACE_CODEX_MOCK_SCENARIO")
                        .unwrap_or_else(|_| "fragmented".into()),
                );
            }
            Ok("workspace") => {
                command
                    .arg("--codex-workspace")
                    .arg(self.runtime.with_file_name("laplace-codex-job.exe"));
            }
            _ => {}
        }

        let mut child = command.spawn().map_err(|error| {
            eprintln!("[laplace:host] sidecar spawn failed ({:?})", error.kind());
            ErrorCode::ServiceUnavailable
        })?;
        let input = child.stdin.take().ok_or(ErrorCode::ServiceUnavailable)?;
        let output = BufReader::new(child.stdout.take().ok_or(ErrorCode::ServiceUnavailable)?);
        Ok(Process {
            child,
            input,
            output,
        })
    }

    pub async fn request(
        &self,
        id: String,
        operation: Operation<'_>,
    ) -> Result<Response, ErrorCode> {
        if !valid_id(&id) {
            return Err(ErrorCode::InvalidRequest);
        }
        if operation
            .project_id()
            .is_some_and(|id| !valid_project_id(id))
        {
            return Err(ErrorCode::InvalidRequest);
        }
        if operation.scope().is_some_and(|(pid, bid, wid)| {
            !valid_project_id(pid) || !valid_project_id(bid) || !valid_project_id(wid)
        }) {
            return Err(ErrorCode::InvalidRequest);
        }

        let started = Instant::now();
        let mut packet = serde_json::to_vec(&Request {
            id: &id,
            version: VERSION,
            operation,
        })
        .map_err(|_| ErrorCode::InvalidRequest)?;
        packet.push(b'\n');
        if packet.len() > MAX_BYTES {
            return Err(ErrorCode::InvalidRequest);
        }

        let mut stopped = self.stopped.subscribe();
        if *stopped.borrow() {
            return Err(ErrorCode::ServiceUnavailable);
        }
        let mut slot = timeout(REQUEST_TIMEOUT, self.process.lock())
            .await
            .map_err(|_| ErrorCode::IpcTimeout)?;
        if *stopped.borrow() {
            return Err(ErrorCode::ServiceUnavailable);
        }
        let remaining = REQUEST_TIMEOUT.saturating_sub(started.elapsed());
        if remaining.is_zero() {
            return Err(ErrorCode::IpcTimeout);
        }
        if slot.is_none() {
            *slot = Some(self.spawn()?);
        }
        let process = slot.as_mut().ok_or(ErrorCode::ServiceUnavailable)?;
        let result = tokio::select! {
            _ = stopped.changed() => Err(ErrorCode::ServiceUnavailable),
            response = timeout(remaining, process.exchange(&packet)) => {
                match response {
                    Ok(Ok(reply)) if reply.matches(&id, operation) => Ok(reply),
                    Ok(Ok(_)) => Err(ErrorCode::InvalidResponse),
                    Ok(Err(error)) => Err(error),
                    Err(_) => Err(ErrorCode::IpcTimeout),
                }
            }
        };

        if let Err(code) = result {
            eprintln!(
                "[laplace:host] {id} {} {code:?} {}ms",
                operation.name(),
                started.elapsed().as_millis()
            );
            if let Some(process) = slot.take() {
                process.stop().await;
            }
        }
        result
    }

    pub async fn shutdown(&self) {
        self.stopped.send_replace(true);
        if let Some(process) = self.process.lock().await.take() {
            process.stop().await;
        }
    }
}

#[cfg(test)]
mod codex_tests {
    use super::*;

    #[test]
    fn native_approval_is_not_accepted_from_renderer() {
        let mut fields = serde_json::json!({
            "operation": "codex.start",
            "projectId": "a".repeat(64),
            "contextId": "b".repeat(64),
            "grantId": "fixture-grant",
            "manifestDigest": "c".repeat(64)
        });
        let mut approved: CodexRequest = serde_json::from_value(fields.clone()).unwrap();
        if let CodexRequest::Start { confirmed, .. } = &mut approved {
            assert!(!*confirmed);
            *confirmed = true;
        } else {
            panic!("expected start request");
        }
        fields["confirmed"] = true.into();
        assert!(serde_json::from_value::<CodexRequest>(fields.clone()).is_err());
        let operation = Operation::Codex(&approved);
        assert_eq!(serde_json::to_value(operation).unwrap(), fields);
        assert_eq!(operation.name(), "codex.start");
        assert_eq!(operation.project_id(), fields["projectId"].as_str());
        assert_eq!(operation.snapshot_id(), fields["contextId"].as_str());

        let mut workspace = fields.clone();
        workspace.as_object_mut().unwrap().remove("confirmed");
        workspace["unconfinedConfirmed"] = true.into();
        assert!(serde_json::from_value::<CodexRequest>(workspace.clone()).is_err());
        workspace
            .as_object_mut()
            .unwrap()
            .remove("unconfinedConfirmed");
        workspace["operation"] = "codex.approval".into();
        assert!(serde_json::from_value::<CodexRequest>(workspace).is_err());
    }
}

#[cfg(test)]
mod resume_tests {
    use super::*;

    #[test]
    fn resume_request_validates_scope_and_rejects_swapped_binding() {
        let project_id = "a".repeat(64);
        let binding_id = "b".repeat(64);
        let worktree_id = "c".repeat(64);
        let other_binding = "d".repeat(64);

        let resume_json = serde_json::json!({
            "operation": "project.resume",
            "projectId": project_id,
            "bindingId": binding_id,
            "worktreeId": worktree_id,
            "correlationId": "corr-1"
        });
        let req: ResumeRequest = serde_json::from_value(resume_json.clone()).unwrap();
        let operation = Operation::Resume(&req);
        assert_eq!(operation.name(), "project.resume");
        assert_eq!(
            operation.scope(),
            Some((
                project_id.as_str(),
                binding_id.as_str(),
                worktree_id.as_str()
            ))
        );

        let good_response: Response = serde_json::from_value(serde_json::json!({
            "version": VERSION,
            "id": "req-1",
            "ok": true,
            "operation": "project.resume",
            "data": {
                "scope": {
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id
                }
            }
        }))
        .unwrap();
        assert!(good_response.matches("req-1", operation));

        let swapped_binding: Response = serde_json::from_value(serde_json::json!({
            "version": VERSION,
            "id": "req-1",
            "ok": true,
            "operation": "project.resume",
            "data": {
                "scope": {
                    "projectId": project_id,
                    "bindingId": other_binding,
                    "worktreeId": worktree_id
                }
            }
        }))
        .unwrap();
        assert!(!swapped_binding.matches("req-1", operation));

        let mut extra = resume_json;
        extra["unexpected"] = true.into();
        assert!(serde_json::from_value::<ResumeRequest>(extra).is_err());
    }

    #[test]
    fn all_resume_and_decision_variants_round_trip_and_match_scope() {
        let legacy_id = "1".repeat(64);
        let project_id = "a".repeat(64);
        let binding_id = "b".repeat(64);
        let worktree_id = "c".repeat(64);
        let context_id = "d".repeat(64);
        let sha256 = "e".repeat(64);
        let assertion_id = "f".repeat(64);
        let other_id = "9".repeat(64);

        let scope_json = || {
            serde_json::json!({
                "projectId": project_id,
                "bindingId": binding_id,
                "worktreeId": worktree_id
            })
        };

        // 1. project.identity (without path and with path)
        for req_json in [
            serde_json::json!({
                "operation": "project.identity",
                "projectId": legacy_id
            }),
            serde_json::json!({
                "operation": "project.identity",
                "projectId": legacy_id,
                "path": "C:\\repos\\example"
            }),
        ] {
            let req: ResumeRequest = serde_json::from_value(req_json).unwrap();
            let op = Operation::Resume(&req);
            assert_eq!(op.name(), "project.identity");
            assert!(op.scope().is_none());
            assert_eq!(op.project_id(), Some(legacy_id.as_str()));

            let ok_resp: Response = serde_json::from_value(serde_json::json!({
                "version": VERSION,
                "id": "id-1",
                "ok": true,
                "operation": "project.identity",
                "data": {
                    "scope": scope_json(),
                    "legacyProjectId": legacy_id
                }
            }))
            .unwrap();
            assert!(ok_resp.matches("id-1", op));

            let bad_resp: Response = serde_json::from_value(serde_json::json!({
                "version": VERSION,
                "id": "id-1",
                "ok": true,
                "operation": "project.identity",
                "data": {
                    "scope": scope_json(),
                    "legacyProjectId": other_id
                }
            }))
            .unwrap();
            assert!(!bad_resp.matches("id-1", op));
        }

        // 2. Scope-validated operations returning ScopePayload
        let scoped_cases: Vec<(&str, serde_json::Value)> = vec![
            (
                "project.resume",
                serde_json::json!({
                    "operation": "project.resume",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id
                }),
            ),
            (
                "decision.evidenceResolve",
                serde_json::json!({
                    "operation": "decision.evidenceResolve",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "contextId": context_id,
                    "path": "src/lib.ts",
                    "sha256": sha256,
                    "chunk": 0
                }),
            ),
            (
                "decision.comparePresent",
                serde_json::json!({
                    "operation": "decision.comparePresent",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "contextId": context_id,
                    "path": "src/lib.ts",
                    "sha256": sha256,
                    "chunk": 0
                }),
            ),
            (
                "decision.list",
                serde_json::json!({
                    "operation": "decision.list",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id
                }),
            ),
            (
                "decision.get",
                serde_json::json!({
                    "operation": "decision.get",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "assertionId": assertion_id
                }),
            ),
            (
                "decision.purge",
                serde_json::json!({
                    "operation": "decision.purge",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "assertionId": assertion_id,
                    "expectedRevision": 2,
                    "confirmedScope": true,
                    "reason": "Expurgo de teste"
                }),
            ),
        ];

        for (op_name, req_json) in scoped_cases {
            let req: ResumeRequest = serde_json::from_value(req_json.clone()).unwrap();
            let op = Operation::Resume(&req);
            assert_eq!(op.name(), op_name);
            assert_eq!(
                serde_json::to_value(op).unwrap(),
                req_json,
                "round-trip mismatch for {op_name}"
            );

            let ok_resp: Response = serde_json::from_value(serde_json::json!({
                "version": VERSION,
                "id": "sc-1",
                "ok": true,
                "operation": op_name,
                "data": { "scope": scope_json() }
            }))
            .unwrap();
            assert!(ok_resp.matches("sc-1", op), "{op_name} should match scope");

            let bad_resp: Response = serde_json::from_value(serde_json::json!({
                "version": VERSION,
                "id": "sc-1",
                "ok": true,
                "operation": op_name,
                "data": {
                    "scope": {
                        "projectId": other_id,
                        "bindingId": binding_id,
                        "worktreeId": worktree_id
                    }
                }
            }))
            .unwrap();
            assert!(
                !bad_resp.matches("sc-1", op),
                "{op_name} must reject swapped projectId"
            );
        }

        // 3. decision.record (manual null evidence + canonical with C01 ref)
        for req_json in [
            serde_json::json!({
                "operation": "decision.record",
                "projectId": project_id,
                "bindingId": binding_id,
                "worktreeId": worktree_id,
                "requestId": "dec-req-1",
                "assertionId": null,
                "expectedRevision": 0,
                "content": "Manual decision",
                "author": "Operador",
                "reason": "Inicial",
                "humanConfirmed": true,
                "evidence": null
            }),
            serde_json::json!({
                "operation": "decision.record",
                "projectId": project_id,
                "bindingId": binding_id,
                "worktreeId": worktree_id,
                "requestId": "dec-req-2",
                "assertionId": assertion_id,
                "expectedRevision": 1,
                "content": "Canonical decision",
                "author": "Operador",
                "reason": "Com prova C01",
                "humanConfirmed": true,
                "promoteCanonical": true,
                "effectiveAt": "2026-11-22T10:00:00.000Z",
                "evidence": {
                    "contextId": context_id,
                    "path": "src/lib.ts",
                    "sha256": sha256,
                    "chunk": 0
                }
            }),
        ] {
            let req: ResumeRequest = serde_json::from_value(req_json.clone()).unwrap();
            let op = Operation::Resume(&req);
            assert_eq!(op.name(), "decision.record");
            assert_eq!(serde_json::to_value(op).unwrap(), req_json);

            let ok_resp: Response = serde_json::from_value(serde_json::json!({
                "version": VERSION,
                "id": "rec-1",
                "ok": true,
                "operation": "decision.record",
                "data": { "projectId": project_id }
            }))
            .unwrap();
            assert!(ok_resp.matches("rec-1", op));

            let bad_resp: Response = serde_json::from_value(serde_json::json!({
                "version": VERSION,
                "id": "rec-1",
                "ok": true,
                "operation": "decision.record",
                "data": { "projectId": other_id }
            }))
            .unwrap();
            assert!(!bad_resp.matches("rec-1", op));
        }
    }

    #[test]
    fn all_compiler_variants_round_trip_and_match_scope() {
        let project_id = "a".repeat(64);
        let binding_id = "b".repeat(64);
        let worktree_id = "c".repeat(64);
        let manifest_digest = "d".repeat(64);
        let other_id = "9".repeat(64);

        let scope_json = || {
            serde_json::json!({
                "projectId": project_id,
                "bindingId": binding_id,
                "worktreeId": worktree_id
            })
        };

        let cases: Vec<(&str, serde_json::Value)> = vec![
            (
                "compiler.compile",
                serde_json::json!({
                    "operation": "compiler.compile",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "objective": "Compilar contexto F2",
                    "destinationId": "codex_mock",
                    "budgetBytes": 4096,
                    "policyVersion": "f2-policy-v1",
                    "strategyVersion": "f2-deterministic-v1"
                }),
            ),
            (
                "compiler.grantIssue",
                serde_json::json!({
                    "operation": "compiler.grantIssue",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "sessionId": "session-1",
                    "manifestDigest": manifest_digest,
                    "policyVersion": "f2-policy-v1",
                    "destinationId": "codex_mock",
                    "allowedOperations": ["summary", "search", "read", "package", "query"],
                    "ttlMs": 60000,
                    "humanConfirmed": true
                }),
            ),
            (
                "compiler.grantList",
                serde_json::json!({
                    "operation": "compiler.grantList",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "manifestDigest": manifest_digest
                }),
            ),
            (
                "compiler.grantRevoke",
                serde_json::json!({
                    "operation": "compiler.grantRevoke",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "grantId": "grant-1",
                    "reason": "Revogação de teste"
                }),
            ),
            (
                "compiler.packageExport",
                serde_json::json!({
                    "operation": "compiler.packageExport",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "grantId": "grant-1",
                    "sessionId": "session-1",
                    "manifestDigest": manifest_digest,
                    "policyVersion": "f2-policy-v1",
                    "destinationId": "codex_mock",
                    "includeHandoff": true
                }),
            ),
            (
                "compiler.handoffImport",
                serde_json::json!({
                    "operation": "compiler.handoffImport",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "destinationId": "codex_mock",
                    "humanConfirmed": true,
                    "handoff": { "manifestDigest": manifest_digest }
                }),
            ),
            (
                "compiler.mcpCall",
                serde_json::json!({
                    "operation": "compiler.mcpCall",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "grantId": "grant-1",
                    "sessionId": "session-1",
                    "manifestDigest": manifest_digest,
                    "policyVersion": "f2-policy-v1",
                    "destinationId": "codex_mock",
                    "method": "summary"
                }),
            ),
            (
                "compiler.queryRun",
                serde_json::json!({
                    "operation": "compiler.queryRun",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "grantId": "grant-1",
                    "sessionId": "session-1",
                    "manifestDigest": manifest_digest,
                    "policyVersion": "f2-policy-v1",
                    "destinationId": "codex_mock",
                    "channel": "mcp_stdio",
                    "mode": "mock_development"
                }),
            ),
            (
                "compiler.auditList",
                serde_json::json!({
                    "operation": "compiler.auditList",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id
                }),
            ),
            (
                "compiler.auditReview",
                serde_json::json!({
                    "operation": "compiler.auditReview",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "auditId": "audit-1",
                    "status": "approved",
                    "reviewer": "Operador",
                    "note": "Citações verificadas.",
                    "humanConfirmed": true
                }),
            ),
        ];

        for (op_name, req_json) in cases {
            let req: CompilerRequest = serde_json::from_value(req_json.clone()).unwrap();
            let op = Operation::Compiler(&req);
            assert_eq!(op.name(), op_name);
            assert_eq!(serde_json::to_value(op).unwrap(), req_json);

            let mut extra = req_json;
            extra["unexpectedField"] = true.into();
            assert!(serde_json::from_value::<CompilerRequest>(extra).is_err());

            let ok_resp: Response = serde_json::from_value(serde_json::json!({
                "version": VERSION,
                "id": "comp-1",
                "ok": true,
                "operation": op_name,
                "data": { "scope": scope_json() }
            }))
            .unwrap();
            assert!(
                ok_resp.matches("comp-1", op),
                "{op_name} should match scope"
            );

            let bad_resp: Response = serde_json::from_value(serde_json::json!({
                "version": VERSION,
                "id": "comp-1",
                "ok": true,
                "operation": op_name,
                "data": {
                    "scope": {
                        "projectId": project_id,
                        "bindingId": other_id,
                        "worktreeId": worktree_id
                    }
                }
            }))
            .unwrap();
            assert!(
                !bad_resp.matches("comp-1", op),
                "{op_name} must reject swapped bindingId"
            );
        }
    }

    #[test]
    fn all_memory_variants_round_trip_and_match_scope() {
        let project_id = "1".repeat(64);
        let binding_id = "2".repeat(64);
        let worktree_id = "3".repeat(64);
        let other_id = "9".repeat(64);

        let scope_json = || {
            serde_json::json!({
                "projectId": project_id,
                "bindingId": binding_id,
                "worktreeId": worktree_id
            })
        };

        let cases = [
            (
                "memory.claimRecord",
                serde_json::json!({
                    "operation": "memory.claimRecord",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "requestId": "req-1",
                    "title": "Titulo",
                    "content": "Conteudo",
                    "author": "Autor",
                    "reason": "Razao",
                    "validFrom": "2026-01-01T00:00:00.000Z"
                }),
            ),
            (
                "memory.claimCorrect",
                serde_json::json!({
                    "operation": "memory.claimCorrect",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "requestId": "req-2",
                    "claimId": "claim-1",
                    "content": "Correcao",
                    "author": "Autor",
                    "reason": "Parcial",
                    "correctFrom": "2026-01-10T00:00:00.000Z"
                }),
            ),
            (
                "memory.relationRecord",
                serde_json::json!({
                    "operation": "memory.relationRecord",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "fromId": "c1",
                    "toId": "c2",
                    "kind": "supports",
                    "signalKind": "confirmed_link",
                    "rationale": "Evidencia direta",
                    "author": "Autor"
                }),
            ),
            (
                "memory.timeline",
                serde_json::json!({
                    "operation": "memory.timeline",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "knownAt": "2026-02-01T00:00:00.000Z"
                }),
            ),
            (
                "memory.pinCreate",
                serde_json::json!({
                    "operation": "memory.pinCreate",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "label": "Pin 1",
                    "source": { "kind": "inline", "content": "prova" }
                }),
            ),
            (
                "memory.pinList",
                serde_json::json!({
                    "operation": "memory.pinList",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id
                }),
            ),
            (
                "memory.pinVerify",
                serde_json::json!({
                    "operation": "memory.pinVerify",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "pinId": "pin-1"
                }),
            ),
            (
                "memory.pinRelease",
                serde_json::json!({
                    "operation": "memory.pinRelease",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "pinId": "pin-1",
                    "humanConfirmed": true
                }),
            ),
            (
                "memory.gcRun",
                serde_json::json!({
                    "operation": "memory.gcRun",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "humanConfirmed": true
                }),
            ),
            (
                "memory.purgeStart",
                serde_json::json!({
                    "operation": "memory.purgeStart",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "targetKind": "pin",
                    "targetId": "pin-1",
                    "reason": "Limpeza",
                    "humanConfirmed": true
                }),
            ),
            (
                "memory.purgeResume",
                serde_json::json!({
                    "operation": "memory.purgeResume",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "purgeId": "purge-1"
                }),
            ),
            (
                "memory.purgeStatus",
                serde_json::json!({
                    "operation": "memory.purgeStatus",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "purgeId": "purge-1"
                }),
            ),
            (
                "memory.inboxSubmit",
                serde_json::json!({
                    "operation": "memory.inboxSubmit",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "title": "Sugestao",
                    "content": "Conteudo candidato",
                    "targetKind": "claim",
                    "originLabel": "sessao-1"
                }),
            ),
            (
                "memory.inboxList",
                serde_json::json!({
                    "operation": "memory.inboxList",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id
                }),
            ),
            (
                "memory.inboxReview",
                serde_json::json!({
                    "operation": "memory.inboxReview",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "proposalId": "prop-1",
                    "decision": "approve",
                    "reviewer": "Operador",
                    "note": "Aprovado",
                    "humanConfirmed": true
                }),
            ),
            (
                "memory.exportPreview",
                serde_json::json!({
                    "operation": "memory.exportPreview",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "destinationId": "codex_mock",
                    "items": [{
                        "itemId": "i-1",
                        "title": "Item",
                        "visibility": "local_only",
                        "content": "texto seguro"
                    }]
                }),
            ),
            (
                "memory.exportExceptionGrant",
                serde_json::json!({
                    "operation": "memory.exportExceptionGrant",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "bundleDigest": "a".repeat(64),
                    "destinationId": "codex_mock",
                    "policyVersion": "f2-policy-v1",
                    "reviewer": "Operador",
                    "reason": "Excecao",
                    "humanConfirmed": true
                }),
            ),
            (
                "memory.exportExecute",
                serde_json::json!({
                    "operation": "memory.exportExecute",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "destinationId": "codex_mock",
                    "policyVersion": "f2-policy-v1",
                    "items": [{
                        "itemId": "i-1",
                        "title": "Item",
                        "visibility": "canonical_verified",
                        "content": "texto"
                    }]
                }),
            ),
            (
                "memory.overlayCapture",
                serde_json::json!({
                    "operation": "memory.overlayCapture",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "label": "WIP"
                }),
            ),
            (
                "memory.overlayList",
                serde_json::json!({
                    "operation": "memory.overlayList",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id
                }),
            ),
            (
                "memory.overlayVerify",
                serde_json::json!({
                    "operation": "memory.overlayVerify",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "overlayId": "ov-1"
                }),
            ),
            (
                "memory.overlayReconstruct",
                serde_json::json!({
                    "operation": "memory.overlayReconstruct",
                    "projectId": project_id,
                    "bindingId": binding_id,
                    "worktreeId": worktree_id,
                    "overlayId": "ov-1",
                    "targetDir": "C:\\Temp\\disposable-overlay",
                    "disposableTargetConfirmed": true
                }),
            ),
        ];

        for (op_name, req_json) in cases {
            let req: MemoryRequest = serde_json::from_value(req_json.clone()).unwrap();
            let op = Operation::Memory(&req);
            assert_eq!(op.name(), op_name);
            assert_eq!(serde_json::to_value(op).unwrap(), req_json);

            let mut extra = req_json;
            extra["unexpectedField"] = true.into();
            assert!(serde_json::from_value::<MemoryRequest>(extra).is_err());

            let ok_resp: Response = serde_json::from_value(serde_json::json!({
                "version": VERSION,
                "id": "mem-1",
                "ok": true,
                "operation": op_name,
                "data": { "scope": scope_json() }
            }))
            .unwrap();
            assert!(ok_resp.matches("mem-1", op), "{op_name} should match scope");

            let bad_resp: Response = serde_json::from_value(serde_json::json!({
                "version": VERSION,
                "id": "mem-1",
                "ok": true,
                "operation": op_name,
                "data": {
                    "scope": {
                        "projectId": project_id,
                        "bindingId": binding_id,
                        "worktreeId": other_id
                    }
                }
            }))
            .unwrap();
            assert!(
                !bad_resp.matches("mem-1", op),
                "{op_name} must reject swapped worktreeId"
            );
        }
    }
}
