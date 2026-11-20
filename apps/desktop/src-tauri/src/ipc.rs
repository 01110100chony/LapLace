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
#[serde(tag = "operation", content = "data")]
enum Payload {
    #[serde(rename = "health")]
    Health(Health),
    #[serde(rename = "workspace.list")]
    List(Catalog),
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
}

impl Payload {
    fn operation(&self) -> &'static str {
        match self {
            Self::Health(_) => "health",
            Self::List(_) => "workspace.list",
            Self::Add(_) => "workspace.addLocal",
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
            Self::ContextBrowse(data) | Self::ContextList(data) | Self::CodexStatus(data) => {
                valid_project_id(&data.project_id) && data.context_id.is_none()
            }
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
            | Self::CodexCancel(data) => {
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
                        && operation.project_id().is_none_or(|id| match payload {
                            Payload::Select(project) => project.record.id == id,
                            Payload::Inspect(project) | Payload::Relocate(project) => {
                                project.record.id == id
                            }
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
                            | Payload::CodexCancel(data) => {
                                data.project_id == id
                                    && operation.snapshot_id().is_none_or(|context_id| {
                                        data.context_id.as_deref() == Some(context_id)
                                    })
                            }
                            _ => false,
                        })
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
        }
    }

    fn project_id(&self) -> &str {
        match self {
            Self::Status { project_id }
            | Self::Prepare { project_id, .. }
            | Self::Approval { project_id, .. }
            | Self::Start { project_id, .. }
            | Self::Events { project_id, .. }
            | Self::Cancel { project_id, .. } => project_id,
        }
    }

    fn snapshot_id(&self) -> Option<&str> {
        match self {
            Self::Status { .. } => None,
            Self::Prepare { context_id, .. }
            | Self::Approval { context_id, .. }
            | Self::Start { context_id, .. }
            | Self::Events { context_id, .. }
            | Self::Cancel { context_id, .. } => Some(context_id),
        }
    }
}

impl<'a> Operation<'a> {
    fn name(self) -> &'static str {
        match self {
            Self::Health => "health",
            Self::List => "workspace.list",
            Self::Add { .. } => "workspace.addLocal",
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
        let mut command = Command::new(&self.runtime);
        command
            // Node's CommonJS resolver cannot canonicalize a Windows verbatim path.
            .arg("--preserve-symlinks-main")
            .arg(&self.script)
            .arg(&self.data_dir)
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
                let helper = std::env::current_exe()
                    .map_err(|_| ErrorCode::ServiceUnavailable)?
                    .with_file_name("laplace-codex-job.exe");
                command.arg("--codex-workspace").arg(helper);
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
