import { useState } from "react";
import { VisualIcon } from "./VisualIcon";

function readLines(text: string | null) {
  return text?.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function changedLines(before: string | null, after: string | null) {
  const oldLines = readLines(before);
  const newLines = readLines(after);
  let start = 0;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (
    start < oldEnd &&
    start < newEnd &&
    oldLines[start] === newLines[start]
  )
    start++;
  while (
    start < oldEnd &&
    start < newEnd &&
    oldLines[oldEnd - 1] === newLines[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  return {
    start,
    removed: oldLines.slice(start, oldEnd),
    added: newLines.slice(start, newEnd),
  };
}

export function TextComparison({
  before,
  after,
}: {
  before: string | null;
  after: string | null;
}) {
  const [mode, setMode] = useState<"unified" | "split">("unified");
  const { start, removed, added } = changedLines(before, after);
  const beforeRange = `${removed.length ? start + 1 : start},${removed.length}`;
  const afterRange = `${added.length ? start + 1 : start},${added.length}`;

  return (
    <div className="comparison-view">
      <div
        className="comparison-toolbar"
        role="group"
        aria-label="Apresentação da comparação"
      >
        <button
          type="button"
          className="git-filter"
          aria-pressed={mode === "unified"}
          onClick={() => setMode("unified")}
        >
          Diferenças
        </button>
        <button
          type="button"
          className="git-filter"
          aria-pressed={mode === "split"}
          onClick={() => setMode("split")}
        >
          <VisualIcon name="split" /> Lado a lado
        </button>
      </div>
      {mode === "split" ? (
        <div className="comparison-split">
          <CodeVersion
            name="Antes"
            text={before}
            start={start}
            size={removed.length}
            tone="removed"
          />
          <CodeVersion
            name="Depois"
            text={after}
            start={start}
            size={added.length}
            tone="added"
          />
        </div>
      ) : (
        <>
          {removed.length + added.length > 0 && (
            <pre className="text-diff" aria-label="Diff unificado" tabIndex={0}>
              <span className="diff-location">{`@@ -${beforeRange} +${afterRange} @@\n`}</span>
              {removed.map((line, i) => (
                <span className="diff-removed" key={i}>
                  {formatLine("-", line)}
                </span>
              ))}
              {added.map((line, i) => (
                <span className="diff-added" key={i}>
                  {formatLine("+", line)}
                </span>
              ))}
            </pre>
          )}
          <details>
            <summary>Ver conteúdo completo</summary>
            <dl className="diff-versions">
              <dt>Antes</dt>
              <dd>
                {before === null ? (
                  <p>Arquivo ausente</p>
                ) : (
                  <pre className="text-diff" tabIndex={0} aria-label="Antes">
                    {before}
                  </pre>
                )}
              </dd>
              <dt>Depois</dt>
              <dd>
                {after === null ? (
                  <p>Arquivo ausente</p>
                ) : (
                  <pre className="text-diff" tabIndex={0} aria-label="Depois">
                    {after}
                  </pre>
                )}
              </dd>
            </dl>
          </details>
        </>
      )}
    </div>
  );
}

function CodeVersion({
  name,
  text,
  start,
  size,
  tone,
}: {
  name: string;
  text: string | null;
  start: number;
  size: number;
  tone: "added" | "removed";
}) {
  return (
    <figure className="comparison-version">
      <figcaption>{name}</figcaption>
      {text === null ? (
        <p>Arquivo ausente</p>
      ) : (
        <pre className="text-diff version-lines" tabIndex={0} aria-label={name}>
          {readLines(text).map((line, index) => (
            <span
              className={
                index >= start && index < start + size
                  ? "diff-" + tone
                  : undefined
              }
              key={index}
            >
              <span aria-hidden="true" className="line-number">
                {index + 1}
              </span>
              {line.replace(/\r?\n$/, "").replaceAll("\r", "␍") || " "}
            </span>
          ))}
        </pre>
      )}
    </figure>
  );
}

function formatLine(sign: "-" | "+", line: string) {
  const displayed = line.replaceAll("\r", "␍");
  return `${sign}${displayed}${line.endsWith("\n") ? "" : "\n\\ Sem nova linha ao final do arquivo\n"}`;
}
