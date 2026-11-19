import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const manifest = fileURLToPath(
  new URL("../src-tauri/Cargo.toml", import.meta.url),
);
const licenses = fileURLToPath(new URL("../licenses/", import.meta.url));
const noticeName = /^(licen[cs]e|copying|notice|copyright)([._-]|$)/i;

async function noticesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && noticeName.test(entry.name))
    .map((entry) => join(directory, entry.name))
    .sort();
}

export async function prepareNotices(target, output) {
  const { packages } = JSON.parse(
    execFileSync(
      "cargo",
      [
        "metadata",
        "--locked",
        "--format-version",
        "1",
        "--filter-platform",
        target,
        "--features",
        "custom-protocol",
        "--manifest-path",
        manifest,
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    ),
  );
  const crateDir = (name) =>
    dirname(packages.find((pkg) => pkg.name === name).manifest_path);

  // Upstream notices omitted from these particular Cargo archives.
  const fallbacks = {
    "alloc-stdlib@0.3.0": [join(licenses, "alloc-stdlib.txt")],
    "selectors@0.38.0": [join(crateDir("cssparser"), "LICENSE")],
    "tauri-plugin@2.7.2": await noticesIn(crateDir("tauri")),
    ...Object.fromEntries(
      [
        "webview2-com@0.39.1",
        "webview2-com-macros@0.8.1",
        "webview2-com-sys@0.39.1",
      ].map((name) => [name, [join(licenses, "webview2-rs.txt")]]),
    ),
  };

  const sections = [
    "Laplace — Avisos de terceiros",
    "O runtime Node.js e suas dependências internas são descritos em NODE-LICENSE.txt.",
    "WebView2 Loader e Evergreen Runtime seguem os termos da Microsoft.\nhttps://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution",
    "O instalador usa NSIS e os plugins do Tauri.\nhttps://nsis.sourceforge.io/License\nhttps://github.com/tauri-apps/nsis-tauri-utils (Apache-2.0 / MIT)",
    await readFile(join(licenses, "NSIS.txt"), "utf8"),
    "Dependências Rust resolvidas para este alvo, incluindo ferramentas de compilação. Links de cada crate dão acesso ao código-fonte correspondente, inclusive para MPL-2.0.",
  ];
  for (const pkg of packages.filter((pkg) => pkg.source)) {
    const name = `${pkg.name}@${pkg.version}`;
    const directory = dirname(pkg.manifest_path);
    const texts = new Set(await noticesIn(directory));
    if (pkg.license_file) texts.add(resolve(directory, pkg.license_file));
    if (!texts.size) {
      for (const path of fallbacks[name] ?? []) texts.add(path);
    }
    if (!texts.size) throw new Error(`Aviso de licença ausente para ${name}.`);
    sections.push(
      `${name} — ${pkg.license ?? pkg.license_file}\nhttps://crates.io/crates/${pkg.name}/${pkg.version}`,
      ...(await Promise.all([...texts].map((path) => readFile(path, "utf8")))),
    );
  }

  sections.push("Dependências JavaScript de produção.");
  const jsPackages = [
    fileURLToPath(new URL("../package.json", import.meta.url)),
  ];
  const visited = new Set();
  for (const path of jsPackages) {
    if (visited.has(path)) continue;
    visited.add(path);
    const pkg = JSON.parse(await readFile(path, "utf8"));
    const require = createRequire(path);
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (name.startsWith("@laplace/")) continue; // Código deste workspace.
      jsPackages.push(require.resolve(`${name}/package.json`));
    }
    if (pkg.private) continue;
    const texts = await noticesIn(dirname(path));
    if (!texts.length)
      throw new Error(`Aviso de licença ausente para ${pkg.name}.`);
    sections.push(
      `${pkg.name}@${pkg.version} — ${pkg.license}`,
      ...(await Promise.all(texts.map((text) => readFile(text, "utf8")))),
    );
  }
  await writeFile(
    join(output, "THIRD-PARTY-NOTICES.txt"),
    sections.join("\n\n"),
  );
}
