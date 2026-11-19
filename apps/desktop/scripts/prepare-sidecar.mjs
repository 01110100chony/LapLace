import { execFileSync } from "node:child_process";
import { hash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { build } from "esbuild";
import { prepareNotices } from "./prepare-notices.mjs";

const output = fileURLToPath(
  new URL("../src-tauri/generated/", import.meta.url),
);
const target =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();

if (
  process.platform !== "win32" ||
  !["x86_64-pc-windows-msvc", "x86_64-pc-windows-gnu"].includes(target)
) {
  throw new Error("A distribuição do sidecar requer um alvo Windows x64.");
}

const version = (
  await readFile(new URL("../../../.node-version", import.meta.url), "utf8")
).trim();
const distribution = `node-v${version}-win-x64`;
const archiveName = `${distribution}.zip`;
// SHA-256 publicado em https://nodejs.org/dist/v24.22.3/SHASUMS256.txt.
const expectedHash =
  "e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f";

await mkdir(output, { recursive: true });
const archive = join(output, archiveName);
const staging = await mkdtemp(join(output, "node-"));
try {
  let input = archive;
  const isCached = await readFile(archive).then(
    (bytes) => hash("sha256", bytes) === expectedHash,
    (error) => {
      if (error.code !== "ENOENT") throw error;
      return false;
    },
  );
  if (!isCached) {
    input = join(staging, archiveName);
    execFileSync(
      "curl.exe",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--retry",
        "2",
        "--max-time",
        "180",
        "--output",
        input,
        `https://nodejs.org/dist/v${version}/${archiveName}`,
      ],
      { stdio: "inherit" },
    );
    if (hash("sha256", await readFile(input)) !== expectedHash)
      throw new Error(`SHA-256 inválido para ${archiveName}.`);
    await rename(input, archive);
  }
  execFileSync(
    "tar.exe",
    [
      "-xf",
      archive,
      "-C",
      staging,
      `${distribution}/node.exe`,
      `${distribution}/LICENSE`,
    ],
    { stdio: "inherit" },
  );
  await Promise.all([
    copyFile(
      join(staging, distribution, "node.exe"),
      join(output, `laplace-node-${target}.exe`),
    ),
    copyFile(
      join(staging, distribution, "LICENSE"),
      join(output, "NODE-LICENSE.txt"),
    ),
  ]);
} finally {
  await rm(staging, { recursive: true, force: true });
}

await build({
  entryPoints: [
    fileURLToPath(new URL("../../local-service/src/main.ts", import.meta.url)),
  ],
  outfile: join(output, "service.cjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
});
await prepareNotices(target, output);
