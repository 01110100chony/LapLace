import { useState } from "react";
import { TextComparison } from "../TextComparison";
import { hypotheses, replayEvents } from "./fixtures";
import { Chronoscope, DivergenceField } from "./Instruments";
import { PreviewLinks, PreviewSection, type NavigatePreview } from "./Shared";

export function HypothesisArena({ navigate }: { navigate: NavigatePreview }) {
  const [visible, setVisible] = useState<string[]>(["h1", "h2"]);
  const [chosen, setChosen] = useState<string>();
  const comparing = hypotheses.filter((item) => visible.includes(item.id));
  const selected = comparing.find((item) => item.id === chosen);
  return (
    <div className="preview-history">
      <fieldset className="arena-selection">
        <legend>Hipóteses em comparação</legend>
        {hypotheses.map((item) => (
          <label key={item.id}>
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
                if (!active && chosen === item.id) setChosen(undefined);
              }}
            />{" "}
            {item.title}
          </label>
        ))}
      </fieldset>
      <DivergenceField visible={visible} chosen={selected?.id} />
      {comparing.length ? (
        <div className="arena-options">
          {comparing.map((item) => (
            <article className="preview-section" key={item.id}>
              <h2>{item.title}</h2>
              <p className="preview-muted">{item.goal}</p>
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
                className="button"
                type="button"
                aria-pressed={chosen === item.id}
                onClick={() => setChosen(item.id)}
              >
                Escolher para revisão · simulação
              </button>
            </article>
          ))}
        </div>
      ) : (
        <p className="preview-muted">
          Selecione hipóteses para montar a comparação.
        </p>
      )}
      {selected && (
        <p role="status" className="preview-message">
          {selected.title} foi escolhida para revisão nesta simulação.
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
    <div className="preview-history">
      <Chronoscope base={base} target={target} onTarget={setTarget} />
      <div className="preview-workbench replay-workbench">
        <PreviewSection title="Comparação histórica">
          <label className="preview-input">
            <span>Comparar com</span>
            <select
              value={base}
              onChange={(event) => setBase(event.target.value)}
            >
              {replayEvents.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          {left.id === right.id && (
            <p className="preview-message" role="status">
              Os dois lados apontam para o mesmo momento.
            </p>
          )}
          <TextComparison before={left.content} after={right.content} />
          <PreviewLinks ids={["memory", "arena"]} navigate={navigate} />
        </PreviewSection>
      </div>
    </div>
  );
}
