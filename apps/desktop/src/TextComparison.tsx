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
  const { start, removed, added } = changedLines(before, after);
  const beforeRange = `${removed.length ? start + 1 : start},${removed.length}`;
  const afterRange = `${added.length ? start + 1 : start},${added.length}`;

  return (
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
  );
}

function formatLine(sign: "-" | "+", line: string) {
  const displayed = line.replaceAll("\r", "␍");
  return `${sign}${displayed}${line.endsWith("\n") ? "" : "\n\\ Sem nova linha ao final do arquivo\n"}`;
}
