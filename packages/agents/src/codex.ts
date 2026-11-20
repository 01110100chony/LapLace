import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import {
  codexMaxEvents,
  codexMaxLineBytes,
  codexMaxOutputBytes,
  codexTimeoutMs,
  isRecord,
  isRequestId,
  type CodexEvent,
  type CodexFailure,
  type CodexState,
} from "@laplace/contracts";

type Availability = {
  state:
    | "missing"
    | "unsupported"
    | "probe_failed"
    | "unauthenticated"
    | "confinement_unverified";
  version: string | null;
};
export type CodexInstallation = { executable: string; version: string };
type EventBody<T = CodexEvent> = T extends CodexEvent ? Omit<T, "seq"> : never;
export type CodexRunEvent = EventBody;
type Terminal = Extract<CodexRunEvent, { type: "terminal" }>;

type ProbeResult = {
  code: number | string | null;
  stdout: string;
  stderr: string;
};
type Probe = (
  file: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) => Promise<ProbeResult>;

function envValue(key: string, env: NodeJS.ProcessEnv) {
  return Object.entries(env).find(
    ([name]) => name.toUpperCase() === key.toUpperCase(),
  )?.[1];
}

export function codexEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const keys = [
    "SYSTEMROOT",
    "WINDIR",
    "SYSTEMDRIVE",
    "COMSPEC",
    "PATH",
    "PATHEXT",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "LOCALAPPDATA",
    "APPDATA",
    "HOME",
    "TEMP",
    "TMP",
    "CODEX_HOME",
  ];
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = envValue(key, env);
      return value ? [[key, value]] : [];
    }),
  );
}

function findCodex(): string | undefined {
  const env = codexEnvironment();
  const windows = process.platform === "win32";
  if (!windows) return;
  const pathFolders = (env.PATH ?? "").split(delimiter).filter(isAbsolute);
  const all = [...pathFolders];
  if (env.LOCALAPPDATA)
    all.push(join(env.LOCALAPPDATA, "Programs", "OpenAI", "Codex", "bin"));
  all.push(
    ...pathFolders.map((folder) =>
      join(
        folder,
        "node_modules",
        "@openai",
        "codex",
        "node_modules",
        "@openai",
        "codex-win32-x64",
        "vendor",
        "x86_64-pc-windows-msvc",
        "bin",
      ),
    ),
  );
  for (const folder of all) {
    const file = join(folder, "codex.exe");
    try {
      const canonical = realpathSync.native(file);
      if (statSync(canonical).isFile()) return canonical;
    } catch {
      // Continue past missing and inaccessible PATH entries.
    }
  }
}

const probe: Probe = (file, args, cwd, env) =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { cwd, env, windowsHide: true, timeout: 2500, maxBuffer: 48 * 1024 },
      (error, stdout, stderr) =>
        resolve({ code: error ? (error.code ?? null) : 0, stdout, stderr }),
    );
  });

const supportedVersion = "0.141.0";
const workspaceVersion = "0.157.0";
const execOptions = [
  "--json",
  "--sandbox",
  "--cd",
  "--skip-git-repo-check",
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--config",
  "--strict-config",
];
const authConfig = 'cli_auth_credentials_store="auto"';
const providerConfig = 'model_provider="openai"';

export async function detectCodex(
  cwd: string,
  {
    find = findCodex,
    call = probe,
    env = codexEnvironment(),
    workspace = false,
  }: {
    find?: () => string | undefined;
    call?: Probe;
    env?: NodeJS.ProcessEnv;
    workspace?: boolean;
  } = {},
): Promise<{
  availability: Availability;
  installation?: CodexInstallation;
}> {
  const executable = find();
  if (!executable) return { availability: { state: "missing", version: null } };
  const [result, help] = await Promise.all([
    call(executable, ["--version"], cwd, env),
    call(executable, ["exec", "--help"], cwd, env),
  ]);
  const version =
    /^codex-cli (\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)$/m.exec(
      result.stdout,
    )?.[1] ?? null;
  if (result.code !== 0 || help.code !== 0 || !version)
    return { availability: { state: "probe_failed", version } };
  if (
    version !== (workspace ? workspaceVersion : supportedVersion) ||
    !execOptions.every((flag) => help.stdout.includes(flag)) ||
    !help.stdout.includes("read-only") ||
    !help.stdout.includes("stdin")
  )
    return { availability: { state: "unsupported", version } };
  const login = await call(
    executable,
    ["-c", providerConfig, "-c", authConfig, "login", "status"],
    cwd,
    env,
  );
  const authStatus = [login.stdout, login.stderr].join("\n");
  if (login.code === 1 && /\bnot logged in\b/i.test(authStatus))
    return { availability: { state: "unauthenticated", version } };
  if (
    login.code !== 0 ||
    !/\blogged in using (?:ChatGPT|an API key)\b/i.test(authStatus)
  )
    return { availability: { state: "probe_failed", version } };
  return {
    availability: { state: "confinement_unverified", version },
    installation: { executable, version },
  };
}

// A host-owned boundary must constrain all model tools and own the child tree,
// including forced termination when the parent sidecar disappears.
type CodexLaunch = {
  child: ChildProcessWithoutNullStreams;
  stop: () => void;
};

export interface VerifiedCodexBoundary {
  verify(installation: CodexInstallation): Promise<boolean>;
  start(
    file: string,
    args: string[],
    options: { cwd: string; env: NodeJS.ProcessEnv; workspace: string },
  ): CodexLaunch;
}

export function codexExecArgs(cwd: string) {
  return [
    "exec",
    "--json",
    "--sandbox",
    "read-only",
    "--cd",
    cwd,
    "--skip-git-repo-check",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "-c",
    'approval_policy="never"',
    "-c",
    providerConfig,
    "-c",
    'openai_base_url="https://api.openai.com/v1"',
    "-c",
    'chatgpt_base_url="https://chatgpt.com/backend-api/"',
    "-c",
    authConfig,
    "-c",
    'web_search="disabled"',
    "-c",
    "mcp_servers={}",
    "-c",
    "features.plugins=false",
    "-c",
    "features.codex_hooks=false",
    "-c",
    "features.multi_agent=false",
    "-c",
    "features.shell_tool=false",
    "-c",
    "features.shell_snapshot=false",
    "-c",
    "features.computer_use=false",
    "-c",
    "features.browser_use=false",
    "-c",
    "features.js_repl=false",
    "-c",
    "features.multi_agent_v2=false",
    "-c",
    "features.apps=false",
    "-c",
    "project_doc_max_bytes=0",
    "-c",
    "project_root_markers=[]",
    "-c",
    'shell_environment_policy.inherit="none"',
    "-",
  ];
}

export function workspaceCodexExecArgs(cwd: string) {
  const args = codexExecArgs(cwd);
  args.splice(
    args.length - 1,
    0,
    "-c",
    'windows.sandbox="unelevated"',
    "-c",
    'history.persistence="none"',
    "-c",
    "features.skip_host_skill_discovery=true",
    "-c",
    "features.unified_exec=false",
    "-c",
    "features.code_mode=false",
    "-c",
    "features.connectors=false",
    "-c",
    "features.tool_search=false",
    "-c",
    "features.apply_patch_freeform=false",
  );
  return args;
}

export class CodexJsonl {
  private pending = Buffer.alloc(0);
  private bytes = 0;
  private events = 0;
  private completed = false;
  private message = false;
  private providerError = false;
  private failure: CodexFailure | undefined;
  private readonly emit: (event: CodexRunEvent) => void;

  constructor(emit: (event: CodexRunEvent) => void) {
    this.emit = emit;
  }

  push(chunk: Buffer) {
    if (this.failure) return;
    this.bytes += chunk.length;
    if (this.bytes > codexMaxOutputBytes) {
      this.failure = "output_limit";
      return;
    }
    let start = 0;
    while (start < chunk.length && !this.failure) {
      const newline = chunk.indexOf(10, start);
      const part = chunk.subarray(start, newline < 0 ? undefined : newline);
      if (this.pending.length + part.length > codexMaxLineBytes) {
        this.failure = "output_limit";
        return;
      }
      this.pending = Buffer.concat([this.pending, part]);
      if (newline < 0) return;
      this.decodeLine();
      this.pending = Buffer.alloc(0);
      start = newline + 1;
    }
  }

  get problem() {
    return this.failure;
  }

  finish() {
    if (this.pending.length && !this.failure) this.decodeLine();
    const completed = this.completed && this.message;
    return {
      completed,
      failure:
        this.failure ??
        (!completed && this.providerError ? "provider_failed" : undefined),
    };
  }

  private publish(event: CodexRunEvent) {
    if (++this.events > codexMaxEvents - 2) {
      this.failure = "output_limit";
      return;
    }
    this.emit(event);
  }

  private decodeLine() {
    let event: unknown;
    try {
      event = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(this.pending),
      );
    } catch {
      this.publish({ type: "notice", reason: "malformed_event" });
      return;
    }
    if (!isRecord(event) || typeof event.type !== "string") {
      this.publish({ type: "notice", reason: "malformed_event" });
      return;
    }
    switch (event.type) {
      case "thread.started":
        if (isRequestId(event.thread_id))
          this.publish({ type: "session", sessionId: event.thread_id });
        else this.publish({ type: "notice", reason: "malformed_event" });
        break;
      case "turn.started":
        this.publish({ type: "progress", stage: "turn" });
        break;
      case "item.started":
      case "item.updated":
      case "item.completed": {
        const { item } = event;
        if (!isRecord(item) || typeof item.type !== "string") {
          this.publish({ type: "notice", reason: "malformed_event" });
        } else if (
          item.type === "agent_message" &&
          event.type === "item.completed"
        ) {
          if (typeof item.text === "string" && item.text.trim()) {
            this.message = true;
            this.publish({ type: "message", text: item.text });
          } else this.publish({ type: "notice", reason: "malformed_event" });
        } else this.publish({ type: "progress", stage: "item" });
        break;
      }
      case "turn.completed": {
        this.completed = true;
        const { usage } = event;
        if (isRecord(usage)) {
          const {
            input_tokens,
            cached_input_tokens = 0,
            output_tokens,
          } = usage;
          if (
            [input_tokens, cached_input_tokens, output_tokens].every(
              (n) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0,
            )
          )
            this.publish({
              type: "usage",
              input: input_tokens as number,
              cachedInput: cached_input_tokens as number,
              output: output_tokens as number,
            });
        }
        break;
      }
      case "error":
        if (
          typeof event.message === "string" &&
          /\b401 Unauthorized\b/i.test(event.message)
        ) {
          this.failure = "authentication_failed";
          break;
        }
        this.providerError = true;
        this.publish({ type: "notice", reason: "provider_error" });
        break;
      case "turn.failed":
        this.failure = "provider_failed";
        break;
      default:
        this.publish({ type: "notice", reason: "unknown_event" });
    }
  }
}

type CodexRunInput = {
  installation: CodexInstallation;
  cwd: string;
  workspace: string;
  prompt: Buffer;
  emit: (event: CodexRunEvent) => void;
  signal: AbortSignal;
  timeout?: number;
};

export function runCodex(
  input: CodexRunInput & { boundary: VerifiedCodexBoundary },
) {
  const { boundary, installation, cwd, workspace } = input;
  return superviseCodex(input, () =>
    boundary.start(installation.executable, codexExecArgs(cwd), {
      cwd,
      workspace,
      env: codexEnvironment(),
    }),
  );
}

export function runWorkspaceCodex(input: CodexRunInput & { helper: string }) {
  const { helper, installation, cwd } = input;
  return superviseCodex(input, () => {
    const child = spawn(
      helper,
      [
        "--laplace-codex-job",
        String(process.pid),
        installation.executable,
        ...workspaceCodexExecArgs(cwd),
      ],
      { cwd, env: codexEnvironment(), windowsHide: true },
    );
    return {
      child,
      stop: () => {
        child.kill();
      },
    };
  });
}

async function superviseCodex(
  { prompt, emit, signal, timeout = codexTimeoutMs }: CodexRunInput,
  launch: () => CodexLaunch,
): Promise<Terminal> {
  const terminal = (
    state: Exclude<CodexState, "running">,
    failure: CodexFailure | null = null,
  ): Terminal => ({ type: "terminal", state, failure });
  if (signal.aborted) return terminal("cancelled");
  const parser = new CodexJsonl(emit);
  let process: CodexLaunch;
  try {
    process = launch();
  } catch {
    return terminal("failed", "launch_failed");
  }
  const { child, stop } = process;
  return new Promise((resolve) => {
    let stopping: Terminal | undefined;
    let stderrBytes = 0;
    const cancel = (state: Terminal) => {
      if (stopping) return;
      stopping = state;
      stop();
    };
    const abort = () => cancel(terminal("cancelled"));
    const timer = setTimeout(() => cancel(terminal("timeout")), timeout);
    signal.addEventListener("abort", abort, { once: true });
    child.once("spawn", () => {
      if (!stopping) emit({ type: "started" });
    });
    child.stdin.on("error", () => {
      // Closing stdin early is common when the CLI fails. Exit and JSONL determine the outcome.
    });
    child.stdout.on("data", (bytes: Buffer) => {
      if (stopping) return;
      parser.push(bytes);
      if (parser.problem === "output_limit")
        cancel(terminal("failed", "output_limit"));
    });
    child.stderr.on("data", (bytes: Buffer) => {
      stderrBytes += bytes.length;
      if (stderrBytes > codexMaxOutputBytes)
        cancel(terminal("failed", "output_limit"));
    });
    child.once("error", () => cancel(terminal("failed", "launch_failed")));
    child.once("close", (code, terminatedBy) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (stopping) return resolve(stopping);
      const { completed, failure } = parser.finish();
      if (failure) return resolve(terminal("failed", failure));
      if (terminatedBy || code === null)
        return resolve(terminal("interrupted"));
      if (code !== 0) return resolve(terminal("failed", "provider_failed"));
      resolve(
        completed
          ? terminal("completed")
          : terminal("failed", "protocol_error"),
      );
    });
    if (signal.aborted) abort();
    else child.stdin.end(prompt);
  });
}
