/* global Buffer, console */
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopDir, "..", "..");

const entryPath = path.join(
  desktopDir,
  "src",
  "preview",
  "standalone-entry.tsx",
);
const fontsDir = path.join(desktopDir, "public", "fonts");
const outPath = path.join(
  repoRoot,
  "Laplace_Plano_v2",
  "visual",
  "Laboratorio_Living_Systems_2.html",
);

const bundled = await build({
  entryPoints: [entryPath],
  bundle: true,
  write: false,
  format: "iife",
  minify: true,
  target: ["chrome107"],
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

const jsCode = bundled.outputFiles[0].text.replaceAll(
  "</script>",
  "<\\/script>",
);

const cssFiles = [
  "theme.css",
  "styles.css",
  "work.css",
  "living-system.css",
  path.join("preview", "preview.css"),
];

let combinedCss = cssFiles
  .map((rel) => readFileSync(path.join(desktopDir, "src", rel), "utf8"))
  .join("\n\n");

const fontFiles = [
  "fraunces-latin-standard-normal.woff2",
  "ibm-plex-sans-latin-wght-normal.woff2",
  "inter-latin-wght-normal.woff2",
  "jetbrains-mono-latin-wght-normal.woff2",
];

for (const fontFile of fontFiles) {
  const b64 = readFileSync(path.join(fontsDir, fontFile)).toString("base64");
  combinedCss = combinedCss.replaceAll(
    `/fonts/${fontFile}`,
    `data:font/woff2;base64,${b64}`,
  );
}

combinedCss = combinedCss.replaceAll("</style>", "<\\/style>");

const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>LapLace · Laboratório Living Systems 2.0</title>
    <style>
${combinedCss}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
${jsCode}
    </script>
  </body>
</html>
`;

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, html, "utf8");
console.log(
  `Generated standalone Lab HTML: ${outPath} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`,
);
