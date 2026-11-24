import { useState } from "react";
import { TextComparison } from "../TextComparison";
import { VisualIcon } from "../VisualIcon";
import { hypotheses, replayEvents } from "./fixtures";
import { ArenaDivergenceVisual, ReplayChronoscopeVisual } from "./LabVisuals";
import {
  PreviewLinks,
  PreviewRow,
  PreviewSection,
  type NavigatePreview,
} from "./Shared";

const metricLabels = [
  ["minimalScope", "Escopo mínimo"],
  ["reuse", "Reutilização"],
  ["certainty", "Certeza"],
  ["reversibility", "Reversibilidade"],
] as const;

export function HypothesisArena({ navigate }: { navigate: NavigatePreview }) {
  const [visible, setVisible] = useState<string[]>(["h1", "h2"]);
  const [chosen, setChosen] = useState<string>();
  const comparing = hypotheses.filter((item) => visible.includes(item.id));

  return (
    <div className="lab-stack">
      <ArenaDivergenceVisual visibleIds={visible} chosenId={chosen} />

      <fieldset className="arena-selection">
        <legend>Hipóteses em comparação paralela</legend>
        {hypotheses.map((item) => (
          <label key={item.id} className="arena-chip-label">
            <input
              type="checkbox"
              checked={visible.includes(item.id)}
              onChange={(event) => {
                const active = event.target.checked;
                setVisible((items) =>
                  active
                    ? [...items, item.id]
                    : items.filter((id) => id !== item.id),
                );
              }}
            />
            <span>{item.title}</span>
            <code className="arena-branch-tag">{item.diffStats}</code>
          </label>
        ))}
      </fieldset>

      {comparing.length ? (
        <div className="arena-options">
          {comparing.map((item) => {
            const isChosen = chosen === item.id;
            return (
              <article
                className="preview-section arena-dossier"
                data-chosen={isChosen}
                key={item.id}
              >
                <div className="dossier-header">
                  <div>
                    <p className="section-eyebrow">
                      <code>{item.branch}</code> · base {item.baseHash}
                    </p>
                    <h2>{item.title}</h2>
                  </div>
                  <span className={`lab-chip ${isChosen ? "accent" : ""}`}>
                    {item.diffStats}
                  </span>
                </div>

                <p className="preview-muted">{item.goal}</p>

                <pre className="arena-patch" tabIndex={0}>
                  {item.patchPreview}
                </pre>

                <ul
                  className="arena-meters"
                  aria-label={`Critérios de ${item.title}`}
                >
                  {metricLabels.map(([key, label]) => {
                    const value = item.metrics[key];
                    return (
                      <li key={key}>
                        <div className="meter-head">
                          <span>{label}</span>
                          <code>{value}%</code>
                        </div>
                        <div className="meter-track" aria-hidden="true">
                          <span style={{ width: `${value}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>

                <dl className="arena-facts">
                  <div>
                    <dt>Resultado ilustrativo</dt>
                    <dd>{item.outcome}</dd>
                  </div>
                  <div>
                    <dt>Impacto</dt>
                    <dd>{item.cost}</dd>
                  </div>
                  <div>
                    <dt>Limite</dt>
                    <dd>{item.caveat}</dd>
                  </div>
                </dl>

                <button
                  className={isChosen ? "button primary" : "button"}
                  type="button"
                  aria-pressed={isChosen}
                  onClick={() => setChosen(item.id)}
                >
                  {isChosen
                    ? "Hipótese selecionada · simulação"
                    : "Escolher para revisão · simulação"}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="preview-muted">
          Selecione hipóteses para montar a comparação.
        </p>
      )}

      {chosen && (
        <p role="status" className="preview-message">
          Escolhida neste cenário:{" "}
          {hypotheses.find((item) => item.id === chosen)?.title}.
        </p>
      )}
      <PreviewLinks ids={["planner", "replay"]} navigate={navigate} />
    </div>
  );
}

export function TemporalReplay({ navigate }: { navigate: NavigatePreview }) {
  const [target, setTarget] = useState<string>(replayEvents[2].id);
  const [base, setBase] = useState<string>(replayEvents[0].id);
  const left = replayEvents.find((item) => item.id === base)!;
  const right = replayEvents.find((item) => item.id === target)!;

  return (
    <div className="lab-stack">
      <ReplayChronoscopeVisual
        baseId={base}
        targetId={target}
        onSelectTarget={(id) => setTarget(id)}
      />

      <div className="preview-workbench">
        <PreviewSection
          eyebrow="Linha bitemporal"
          title="Momentos da fixture"
          aside={
            <span className="lab-count">{replayEvents.length} estados</span>
          }
        >
          <ul className="preview-list">
            {replayEvents.map((event) => (
              <li key={event.id}>
                <PreviewRow
                  title={`${event.txSeq} · ${event.label}`}
                  detail={`V ${event.effective} · K ${event.recorded}`}
                  badge={event.gapNote ? "Lacuna" : event.revision}
                  active={target === event.id}
                  onClick={() => setTarget(event.id)}
                />
              </li>
            ))}
          </ul>
        </PreviewSection>

        <PreviewSection
          eyebrow="Reconstrução histórica"
          title="Comparação histórica"
          aside={<span className="lab-chip mono">{right.coverage}</span>}
        >
          <div className="replay-controls">
            <label className="preview-input">
              <span>Base de comparação (Antes)</span>
              <select
                value={base}
                onChange={(event) => setBase(event.target.value)}
              >
                {replayEvents.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.txSeq} · {item.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button replay-swap"
              onClick={() => {
                setBase(target);
                setTarget(base);
              }}
            >
              <VisualIcon name="split" /> Inverter A ↔ B
            </button>
          </div>

          <p className="preview-detail-title">{right.label}</p>
          <dl className="dossier-meta">
            <div>
              <dt>Vigente em (V)</dt>
              <dd>{right.effective}</dd>
            </div>
            <div>
              <dt>Registrado em (K)</dt>
              <dd>{right.recorded}</dd>
            </div>
            <div>
              <dt>Revisões Git</dt>
              <dd>
                <code>{left.revision}</code> → <code>{right.revision}</code>
              </dd>
            </div>
          </dl>

          {right.gapNote && (
            <p className="preview-warning" role="status">
              <strong>Lacuna declarada</strong> · {right.gapNote}
            </p>
          )}

          {left.id === right.id && (
            <p className="preview-message" role="status">
              Os dois lados apontam para o mesmo momento.
            </p>
          )}

          <div className="lab-comparison-frame">
            <TextComparison before={left.content} after={right.content} />
          </div>
          <PreviewLinks ids={["memory", "arena"]} navigate={navigate} />
        </PreviewSection>
      </div>
    </div>
  );
}
