import { useState } from "react";
import { preflightChecks, plannerSteps, proposals, sessions } from "./fixtures";
import {
  Evidence,
  PreviewLinks,
  PreviewRow,
  PreviewSection,
  type NavigatePreview,
} from "./Shared";
import { VisualIcon } from "../VisualIcon";

export function AgentCenter({ navigate }: { navigate: NavigatePreview }) {
  const [filter, setFilter] = useState("Todas");
  const [id, setId] = useState<string>(sessions[0].id);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const visible = sessions.filter(
    (item) => filter === "Todas" || item.state === filter,
  );
  const active = visible.find((item) => item.id === id) ?? visible[0];
  return (
    <div className="preview-workbench">
      <PreviewSection title="Sessões de exemplo">
        <label className="preview-input">
          <span>Estado da sessão</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {["Todas", "Em revisão", "Concluída", "Bloqueada"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <ul className="preview-list">
          {visible.map((item) => (
            <li key={item.id}>
              <PreviewRow
                title={item.title}
                detail={
                  (reviewed.includes(item.id)
                    ? "Revisada na prévia"
                    : item.state) +
                  " · " +
                  item.capability
                }
                active={item.id === active?.id}
                onClick={() => setId(item.id)}
              />
            </li>
          ))}
        </ul>
      </PreviewSection>
      <PreviewSection title="Tentativa e revisão">
        {active && (
          <>
            <p className="preview-detail-title">{active.title}</p>
            <p className="preview-muted">
              Tentativa {active.attempt} · {active.state} · executor
              demonstrativo
            </p>
            <ol className="preview-events">
              {active.events.map((event) => (
                <li key={event}>{event}</li>
              ))}
            </ol>
            <p className="preview-reading">{active.result}</p>
            <Evidence id={active.source} />
            {active.state === "Em revisão" && (
              <button
                type="button"
                className="button primary"
                disabled={reviewed.includes(active.id)}
                onClick={() => setReviewed((items) => [...items, active.id])}
              >
                Marcar revisada · simulação
              </button>
            )}
            {reviewed.includes(active.id) && (
              <p className="preview-message" role="status">
                Revisão registrada neste cenário.
              </p>
            )}
            <PreviewLinks ids={["preflight", "inbox"]} navigate={navigate} />
          </>
        )}
      </PreviewSection>
    </div>
  );
}

type Review = "Aceita" | "Rejeitada";

export function MemoryInbox({ navigate }: { navigate: NavigatePreview }) {
  const [filter, setFilter] = useState("A revisar");
  const [selected, setSelected] = useState<string>(proposals[0].id);
  const [reviews, setReviews] = useState<Record<string, Review | undefined>>(
    {},
  );
  const [result, setResult] = useState("");
  const items = proposals.filter(
    (proposal) =>
      filter === "Todas" || (reviews[proposal.id] ?? "A revisar") === filter,
  );
  const active = items.find((item) => item.id === selected) ?? items[0];

  function review(id: string, decision: Review) {
    setReviews((current) => ({ ...current, [id]: decision }));
    setResult(
      decision === "Aceita"
        ? "Proposta aceita nesta simulação."
        : "Proposta rejeitada nesta simulação.",
    );
  }
  return (
    <div className="preview-workbench">
      <PreviewSection title="Propostas de memória">
        <label className="preview-input">
          <span>Estado da proposta</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {["A revisar", "Aceita", "Rejeitada", "Todas"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        {items.length ? (
          <ul className="preview-list">
            {items.map((item) => (
              <li key={item.id}>
                <PreviewRow
                  title={item.title}
                  detail={
                    reviews[item.id] ??
                    (item.conflict ? "Conflito a avaliar" : "A revisar")
                  }
                  active={active?.id === item.id}
                  onClick={() => setSelected(item.id)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="preview-muted">Nenhuma proposta neste estado.</p>
        )}
      </PreviewSection>
      <PreviewSection title="Revisão humana">
        {active && (
          <>
            <p className="preview-detail-title">{active.title}</p>
            <p className="preview-reading">{active.text}</p>
            {active.conflict && (
              <p className="preview-warning">
                <strong>Conflito</strong> · {active.conflict}
              </p>
            )}
            <Evidence id={active.source} />
            <div className="work-actions">
              <button
                className="button primary"
                type="button"
                disabled={!!reviews[active.id]}
                onClick={() => review(active.id, "Aceita")}
              >
                Aceitar · simulação
              </button>
              <button
                className="button"
                type="button"
                disabled={!!reviews[active.id]}
                onClick={() => review(active.id, "Rejeitada")}
              >
                Rejeitar · simulação
              </button>
            </div>
          </>
        )}
        <p className="preview-message" role="status">
          {result}
        </p>
        <PreviewLinks ids={["memory", "replay"]} navigate={navigate} />
      </PreviewSection>
    </div>
  );
}

export function GitPlanner({ navigate }: { navigate: NavigatePreview }) {
  const [steps, setSteps] = useState<string[]>(["p1", "p2"]);
  const [binding, setBinding] = useState(true);
  const [review, setReview] = useState(false);
  const chosen = plannerSteps.filter((item) => steps.includes(item.id));
  return (
    <div className="preview-workbench">
      <PreviewSection title="Etapas propostas">
        <p className="preview-muted">
          <VisualIcon name="git" /> <code>fixture/retomada</code>
        </p>
        <fieldset className="preview-checks">
          <legend>Incluir no plano</legend>
          {plannerSteps.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={steps.includes(item.id)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setSteps((values) =>
                    checked
                      ? [...values, item.id]
                      : values.filter((id) => id !== item.id),
                  );
                  setReview(false);
                }}
              />
              <span>
                <strong>{item.name}</strong>
                <small>{item.condition}</small>
              </span>
            </label>
          ))}
        </fieldset>
      </PreviewSection>
      <PreviewSection title="Precondições e revisão">
        <label className="preview-control">
          <input
            type="checkbox"
            checked={binding}
            onChange={(event) => {
              setBinding(event.target.checked);
              setReview(false);
            }}
          />{" "}
          Vínculo confirmado na fixture
        </label>
        {!binding && (
          <p className="preview-warning" role="status">
            Plano bloqueado pela precondição de vínculo.
          </p>
        )}
        <p className="preview-muted">{chosen.length} etapas selecionadas</p>
        <button
          className="button primary"
          type="button"
          disabled={!binding || !chosen.length}
          onClick={() => setReview(true)}
        >
          Revisar plano demonstrativo
        </button>
        {review && (
          <ol className="preview-events" aria-label="Etapas revisadas">
            {chosen.map((item) => (
              <li key={item.id}>
                <strong>{item.name}</strong>
                <small>{item.risk}</small>
              </li>
            ))}
          </ol>
        )}
        <PreviewLinks ids={["preflight", "arena"]} navigate={navigate} />
      </PreviewSection>
    </div>
  );
}

export function PreFlight({ navigate }: { navigate: NavigatePreview }) {
  const [checked, setChecked] = useState<string[]>(["c1"]);
  return (
    <div className="preview-workbench">
      <PreviewSection title="Checklist de preparação">
        <fieldset className="preview-checks">
          <legend>Conferências da fixture</legend>
          {preflightChecks.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={checked.includes(item.id)}
                onChange={(event) => {
                  const value = event.target.checked;
                  setChecked((current) =>
                    value
                      ? [...current, item.id]
                      : current.filter((id) => id !== item.id),
                  );
                }}
              />
              <span>
                <strong>{item.label}</strong>
                <small>{item.evidence}</small>
              </span>
            </label>
          ))}
        </fieldset>
      </PreviewSection>
      <PreviewSection title="Prontidão da simulação">
        <p className="preview-number">
          {checked.length}/{preflightChecks.length} <small>conferências</small>
        </p>
        <p role="status" className="preview-message">
          {checked.length === preflightChecks.length
            ? "Cenário pronto para revisão."
            : "Ainda há verificações pendentes."}
        </p>
        <Evidence id="s4" />
        <PreviewLinks ids={["compiler", "planner"]} navigate={navigate} />
      </PreviewSection>
    </div>
  );
}
