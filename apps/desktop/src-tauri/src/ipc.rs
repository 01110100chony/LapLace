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
        }
    }

    fn project_id(self) -> Option<&'a str> {
        match self {
            Self::Select { project_id }
            | Self::Inspect { project_id }
            | Self::Relocate { project_id, .. } => Some(project_id),
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
