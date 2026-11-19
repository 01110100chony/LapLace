import { execFileSync } from "node:child_process";
import { copyFile, mkdir, stat, utimes } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { build } from "esbuild";

const output = new URL("../src-tauri/generated/", import.meta.url);
const rustVersion = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
const host = /^host: (.+)$/m.exec(rustVersion)?.[1].trim();
const target = process.env.TAURI_ENV_TARGET_TRIPLE || host;
const nodeArchitecture = { x64: "x86_64", arm64: "aarch64" }[process.arch];

if (
  process.platform !== "win32" ||
  !nodeArchitecture ||
  (target !== `${nodeArchitecture}-pc-windows-msvc` &&
    target !== `${nodeArchitecture}-pc-windows-gnu`)
) {
  throw new Error(
    "Use Node.js e Rust nativos para a mesma arquitetura Windows.",
  );
}

await mkdir(output, { recursive: true });
await build({
  entryPoints: [
    fileURLToPath(new URL("../../local-service/src/main.ts", import.meta.url)),
  ],
  outfile: fileURLToPath(new URL("service.cjs", output)),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
});
const runtime = new URL(`laplace-node-${target}.exe`, output);
const [source, existing] = await Promise.all([
  stat(process.execPath),
  stat(runtime).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  }),
]);
if (
  !existing ||
  source.size !== existing.size ||
  Math.abs(source.mtimeMs - existing.mtimeMs) > 1
) {
  await copyFile(process.execPath, runtime);
  await utimes(runtime, source.atime, source.mtime);
}
