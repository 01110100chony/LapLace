import { spawnSync } from "node:child_process";
import console from "node:console";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import process from "node:process";

const cli = process.argv[2];
if (process.platform !== "win32" || !cli || !isAbsolute(cli))
  throw new Error(
    "Usage: node scripts/probe-codex-read.mjs <absolute codex.exe>",
  );
const parent = await realpath(process.env.LAPLACE_PROBE_PARENT ?? tmpdir());
const root = await mkdtemp(join(parent, "laplace-codex-probe-"));
try {
  const cwd = join(root, "workspace");
  const home = join(root, "codex-home");
  await mkdir(cwd);
  await mkdir(home);
  await writeFile(join(cwd, "authorized.txt"), "authorized-fixture");
  await writeFile(join(root, "canary.txt"), "external-fixture");
  const script = join(cwd, "probe.cjs");
  await writeFile(
    script,
    [
      'const { readFileSync } = require("node:fs");',
      'const { join } = require("node:path");',
      'if (readFileSync(join(__dirname, "authorized.txt"), "utf8") !== "authorized-fixture") process.exit(2);',
      'console.log("AUTHORIZED_READ_OK");',
      "try {",
      '  if (readFileSync(join(__dirname, "..", "canary.txt"), "utf8") !== "external-fixture") process.exit(3);',
      '  console.log("EXTERNAL_READ_SUCCEEDED"); process.exit(4);',
      "} catch (error) {",
      '  if (error.code !== "EACCES" && error.code !== "EPERM") process.exit(5);',
      '  console.log("EXTERNAL_READ_DENIED");',
      "}",
    ].join("\r\n"),
  );
  const runner = process.execPath;
  const args = [script];
  const options = {
    cwd,
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    timeout: 10_000,
  };
  const baseline = spawnSync(runner, args, options);
  if (
    baseline.status !== 4 ||
    !baseline.stdout.includes("AUTHORIZED_READ_OK") ||
    !baseline.stdout.includes("EXTERNAL_READ_SUCCEEDED")
  )
    throw new Error("The positive controls could not read both fixtures.");
  console.log("baseline: authorized and external reads succeeded");
  const results = [
    ["read-only", ["-c", 'sandbox_mode="read-only"']],
    [
      "workspace read allowlist",
      [
        "-P",
        "laplace",
        "-c",
        'permissions.laplace.filesystem={":workspace_roots"="read"}',
      ],
    ],
  ];
  let denied = false;
  for (const [label, policy] of results) {
    const result = spawnSync(
      cli,
      [
        "sandbox",
        "-C",
        cwd,
        "-c",
        'windows.sandbox="unelevated"',
        ...policy,
        "--",
        runner,
        ...args,
      ],
      { ...options, env: { ...process.env, CODEX_HOME: home } },
    );
    const out = result.stdout ?? "";
    const diagnostics = result.stderr ?? "";
    const outcome =
      out.includes("AUTHORIZED_READ_OK") &&
      out.includes("EXTERNAL_READ_DENIED") &&
      result.status === 0
        ? "canary denied"
        : out.includes("EXTERNAL_READ_SUCCEEDED")
          ? "external file read"
          : "confinement unverified (no successful positive and negative controls)";
    console.log(`${label}: ${outcome} (exit ${result.status ?? "unknown"})`);
    denied ||= outcome === "canary denied";
    if (/CreateRestrictedToken failed: 87/.test(diagnostics))
      console.log("CreateRestrictedToken failed: 87");
    if (/cannot enforce split filesystem read restrictions/i.test(diagnostics))
      console.log(
        "The unelevated token cannot enforce the requested read allowlist.",
      );
    if (result.error?.code) console.log(`Process error: ${result.error.code}`);
  }
  if (!denied) process.exitCode = 1;
} finally {
  const target = await realpath(root);
  if (target === root && dirname(target) === parent) {
    await rm(target, { recursive: true, force: true, maxRetries: 2 });
  }
}
