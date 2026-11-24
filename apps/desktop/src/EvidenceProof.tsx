import type { ResolvedEvidence } from "@laplace/contracts";
import { VisualIcon } from "./VisualIcon";

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
});
export function formatObservation(iso: string) {
  return dateTime.format(new Date(iso));
}

export const proofCoverage = {
  full: "Integral",
  partial: "Parcial",
  none: "Ausente",
};
const gapText = {
  no_source_attached: "Nenhuma fonte vinculada",
  source_unavailable: "Fonte indisponível",
  source_digest_mismatch: "Digest divergente",
  source_omitted: "Trecho omitido na captura",
  source_cross_scope: "Fonte fora do vínculo atual",
};

export function EvidenceProof({ proof }: { proof: ResolvedEvidence }) {
  const { evidence, excerpt } = proof;
  return (
    <figure className="evidence-proof" data-state={evidence.state}>
      <figcaption>
        <span className="artifact-icon" data-kind="source">
          <VisualIcon name="file" />
        </span>
        <div>
          <strong>
            {evidence.state === "verified"
              ? "Prova histórica preservada"
              : gapText[evidence.gap]}
          </strong>
          {evidence.ref && <code>{evidence.ref.path}</code>}
        </div>
      </figcaption>
      <dl className="evidence-facts">
        {evidence.sourceOrigin !== "none" && (
          <div>
            <dt>Origem</dt>
            <dd>
              {evidence.sourceOrigin === "context_search"
                ? "Índice C02"
                : "Captura C01"}
            </dd>
          </div>
        )}
        {evidence.capturedAt && (
          <div>
            <dt>Capturada em</dt>
            <dd>
              <time dateTime={evidence.capturedAt}>
                {formatObservation(evidence.capturedAt)}
              </time>
            </dd>
          </div>
        )}
        <div>
          <dt>Cobertura</dt>
          <dd>{proofCoverage[evidence.coverage]}</dd>
        </div>
        {evidence.ref && (
          <div>
            <dt>SHA-256</dt>
            <dd>
              <code title={evidence.ref.sha256}>
                {evidence.ref.sha256.slice(0, 12)}
              </code>
            </dd>
          </div>
        )}
        {excerpt && (
          <div>
            <dt>Linhas</dt>
            <dd>
              {excerpt.firstLine}–{excerpt.lastLine}
            </dd>
          </div>
        )}
      </dl>
      {excerpt && (
        <pre tabIndex={0} className="cockpit-excerpt">
          {excerpt.text}
        </pre>
      )}
    </figure>
  );
}
