import { useState } from "react";
import { VisualIcon } from "../VisualIcon";
import { preflightChecks, plannerSteps, proposals, sessions } from "./fixtures";
import {
  AgentTelemetryVisual,
  InboxMembraneVisual,
  PlannerTopologyVisual,
  PreflightAstrolabeVisual,
} from "./LabVisuals";
import {
  Evidence,
  PreviewLinks,
  PreviewRow,
  PreviewSection,
  type NavigatePreview,
} from "./Shared";

const sessionStates = [
  "Todas",
  "Em revisão",
  "Concluída",
  "Bloqueada",
] as const;

export function AgentCenter({ navigate }: { navigate: NavigatePreview }) {
  const [filter, setFilter] = useState("Todas");
  const [id, setId] = useState<string>(sessions[0].id);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const visible = sessions.filter(
    (item) => filter === "Todas" || item.state === filter,
  );
  const active = visible.find((item) => item.id === id) ?? visible[0];

  return (
    <div className="lab-stack">
      {active && <AgentTelemetryVisual activeSession={active} />}

      <div className="preview-workbench">
        <PreviewSection
          eyebrow="Fila supervisionada"
          title="Sessões de exemplo"
          aside={<span className="lab-count">{visible.length} sessões</span>}
        >
          <div
            className="preview-switch"
            role="group"
            aria-label="Filtrar estado da sessão"
          >
            {sessionStates.map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <ul className="preview-list">
            {visible.map((item) => {
              const isReviewed = reviewed.includes(item.id);
              const badge = isReviewed ? "Revisada" : item.state;
              return (
                <li key={item.id}>
                  <PreviewRow
                    title={item.title}
                    detail={`${item.capability} · tentativa #${item.attempt}`}
                    badge={badge}
                    active={item.id === active?.id}
                    onClick={() => setId(item.id)}
                  />
                </li>
              );
            })}
          </ul>
        </PreviewSection>

        <PreviewSection
          eyebrow="Console da tentativa"
          title="Tentativa e revisão"
          aside={
            active && (
              <span
                className={`lab-chip ${
                  active.state === "Concluída"
                    ? "ok"
                    : active.state === "Bloqueada"
                      ? "error"
                      : "accent"
                }`}
              >
                {reviewed.includes(active.id)
                  ? "Revisada na prévia"
                  : active.state}
              </span>
            )
          }
        >
          {active && (
            <>
              <p className="preview-detail-title">{active.title}</p>
              <div className="lab-chip-row">
                <span className="lab-chip">Tentativa {active.attempt}</span>
                <span className="lab-chip mono">{active.worktree}</span>
                <span className="lab-chip">{active.duration}</span>
              </div>

              <ol className="telemetry-timeline">
                {active.events.map((event) => (
                  <li key={event.time + event.label} data-tone={event.tone}>
                    <time>{event.time}</time>
                    <span>{event.label}</span>
                  </li>
                ))}
              </ol>

              <blockquote className="editorial-statement">
                {active.result}
              </blockquote>

              <Evidence id={active.source} />

              {active.state === "Em revisão" && (
                <div className="lab-action-row">
                  <button
                    type="button"
                    className="button primary"
                    disabled={reviewed.includes(active.id)}
                    onClick={() =>
                      setReviewed((items) => [...items, active.id])
                    }
                  >
                    Marcar revisada · simulação
                  </button>
                </div>
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
    </div>
  );
}

type Review = "Aceita" | "Rejeitada";
const inboxFilters = ["A revisar", "Aceita", "Rejeitada", "Todas"] as const;

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

  function countFor(state: string) {
    if (state === "Todas") return proposals.length;
    return proposals.filter(
      (item) => (reviews[item.id] ?? "A revisar") === state,
    ).length;
  }

  function review(id: string, decision: Review) {
    setReviews((current) => ({ ...current, [id]: decision }));
    setResult(
      decision === "Aceita"
        ? "Proposta aceita nesta simulação."
        : "Proposta rejeitada nesta simulação.",
    );
  }

  return (
    <div className="lab-stack">
      <InboxMembraneVisual
        activeId={active?.id ?? proposals[0].id}
        hasConflict={Boolean(active?.conflict)}
        decision={active ? reviews[active.id] : undefined}
      />

      <div className="preview-workbench">
        <PreviewSection
          eyebrow="Quarentena de entrada"
          title="Propostas de memória"
          aside={<span className="lab-count">{items.length} visíveis</span>}
        >
          <div
            className="preview-switch"
            role="group"
            aria-label="Estado da proposta"
          >
            {inboxFilters.map((value) => (
              <button
                type="button"
                key={value}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value} ({countFor(value)})
              </button>
            ))}
          </div>
          {items.length ? (
            <ul className="preview-list">
              {items.map((item) => (
                <li key={item.id}>
                  <PreviewRow
                    title={item.title}
                    detail={`${item.origin} · dup ×${item.duplicates}`}
                    badge={
                      reviews[item.id] ??
                      (item.conflict ? "Conflito" : "A revisar")
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

        <PreviewSection
          eyebrow="Mesa de triagem"
          title="Revisão humana"
          aside={
            active && (
              <span className="lab-chip mono">{active.submittedAt}</span>
            )
          }
        >
          {active && (
            <>
              <div className="dossier-header">
                <p className="preview-detail-title">{active.title}</p>
                <span className="lab-chip">dup ×{active.duplicates}</span>
              </div>

              {active.conflict ? (
                <div className="conflict-desk" role="status">
                  <div className="conflict-head">
                    <strong>Conflito material detectado</strong>
                    <span>{active.conflict}</span>
                  </div>
                  <div className="conflict-columns">
                    <div className="conflict-card incumbent">
                      <span className="section-eyebrow">Decisão vigente</span>
                      <p>{active.incumbentText}</p>
                    </div>
                    <div className="conflict-card candidate">
                      <span className="section-eyebrow">
                        Proposta candidata
                      </span>
                      <p>{active.text}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <blockquote className="editorial-statement">
                  {active.text}
                </blockquote>
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
                {reviews[active.id] && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setReviews((current) => ({
                        ...current,
                        [active.id]: undefined,
                      }));
                      setResult("Decisão reaberta para nova triagem.");
                    }}
                  >
                    Reabrir triagem
                  </button>
                )}
              </div>
            </>
          )}
          {result && (
            <p className="preview-message" role="status">
              {result}
            </p>
          )}
          <PreviewLinks ids={["memory", "replay"]} navigate={navigate} />
        </PreviewSection>
      </div>
    </div>
  );
}

export function GitPlanner({ navigate }: { navigate: NavigatePreview }) {
  const [steps, setSteps] = useState<string[]>(["p1", "p2", "p3"]);
  const [binding, setBinding] = useState(true);
  const [review, setReview] = useState(false);
  const chosen = plannerSteps.filter((item) => steps.includes(item.id));

  return (
    <div className="lab-stack">
      <PlannerTopologyVisual
        selectedIds={steps}
        bindingConfirmed={binding}
        reviewed={review}
      />

      <div className="preview-workbench">
        <PreviewSection
          eyebrow="Sequência isolada"
          title="Etapas propostas"
          aside={
            <span className="lab-chip mono">
              <VisualIcon name="git" /> fixture/retomada
            </span>
          }
        >
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
                <span className="check-copy">
                  <span className="check-title">
                    <span className="step-code">{item.code}</span>
                    <strong>{item.name}</strong>
                    <span
                      className={`lab-chip ${
                        item.risk === "Baixo" ? "ok" : "warn"
                      }`}
                    >
                      {item.risk}
                    </span>
                  </span>
                  <small>
                    {item.condition} · <code>{item.scopePath}</code>
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
        </PreviewSection>

        <PreviewSection
          eyebrow="Portão de segurança"
          title="Precondições e revisão"
          aside={
            <span className="lab-count">
              {chosen.length}/{plannerSteps.length} etapas
            </span>
          }
        >
          <label className="preview-control">
            <input
              type="checkbox"
              checked={binding}
              onChange={(event) => {
                setBinding(event.target.checked);
                setReview(false);
              }}
            />
            <span>
              <strong>Vínculo confirmado na fixture</strong>
              <small>Garante leitura passiva e isolamento fora de main</small>
            </span>
          </label>

          {!binding && (
            <p className="preview-warning" role="status">
              Plano bloqueado pela precondição de vínculo.
            </p>
          )}

          <div className="lab-action-row">
            <button
              className="button primary"
              type="button"
              disabled={!binding || !chosen.length}
              onClick={() => setReview(true)}
            >
              Revisar plano demonstrativo
            </button>
          </div>

          {review && (
            <div className="plan-dossier" role="status">
              <p className="section-eyebrow">Plano selado nesta simulação</p>
              <ol className="telemetry-timeline" aria-label="Etapas revisadas">
                {chosen.map((item) => (
                  <li
                    key={item.id}
                    data-tone={item.risk === "Baixo" ? "ok" : "warn"}
                  >
                    <time>{item.code}</time>
                    <span>
                      <strong>{item.name}</strong> ·{" "}
                      <code>{item.scopePath}</code> ({item.risk})
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <PreviewLinks ids={["preflight", "arena"]} navigate={navigate} />
        </PreviewSection>
      </div>
    </div>
  );
}

export function PreFlight({ navigate }: { navigate: NavigatePreview }) {
  const [checked, setChecked] = useState<string[]>(["c1", "c2"]);
  const ready = checked.length === preflightChecks.length;

  function toggleCheck(id: string) {
    setChecked((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  return (
    <div className="preview-workbench preflight-bench">
      <PreviewSection
        eyebrow="Conferência estrutural"
        title="Checklist de preparação"
        aside={
          <div className="work-actions">
            <button
              type="button"
              className="pill-toggle"
              onClick={() => setChecked(preflightChecks.map((c) => c.id))}
            >
              Confirmar todas
            </button>
            <button
              type="button"
              className="pill-toggle"
              onClick={() => setChecked([])}
            >
              Limpar
            </button>
          </div>
        }
      >
        <fieldset className="preview-checks">
          <legend>Conferências da fixture</legend>
          {preflightChecks.map((item) => (
            <label key={item.id}>
              <input
                type="checkbox"
                checked={checked.includes(item.id)}
                onChange={() => toggleCheck(item.id)}
              />
              <span className="check-copy">
                <span className="check-title">
                  <strong>{item.label}</strong>
                  <span className="lab-chip">{item.quadrant}</span>
                  <span className="lab-chip mono">{item.fingerprint}</span>
                </span>
                <small>
                  {item.evidence} ({item.scopeNote})
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        <Evidence id="s4" />
        <PreviewLinks ids={["compiler", "planner"]} navigate={navigate} />
      </PreviewSection>

      <PreviewSection
        eyebrow="Selo de liberação"
        title="Prontidão da simulação"
        aside={
          <span className={`lab-chip ${ready ? "ok" : "warn"}`}>
            {ready ? "Liberado" : "Pendente"}
          </span>
        }
      >
        <PreflightAstrolabeVisual checkedIds={checked} onToggle={toggleCheck} />
        <p className="preview-number">
          {checked.length}/{preflightChecks.length}{" "}
          <small>conferências confirmadas</small>
        </p>
        <p role="status" className="preview-message">
          {ready
            ? "Cenário pronto para revisão."
            : "Ainda há verificações pendentes."}
        </p>
      </PreviewSection>
    </div>
  );
}
