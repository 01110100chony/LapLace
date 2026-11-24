import type { ReactNode } from "react";
import {
  hypotheses,
  plannerSteps,
  replayEvents,
  type MemoryRecord,
  type Source,
  type sessions,
} from "./fixtures";

export function Instrument({
  title,
  detail,
  children,
  className,
}: {
  title: string;
  detail?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={["lab-instrument", className].filter(Boolean).join(" ")}>
      <figcaption>
        <strong>{title}</strong>
        {detail && <span>{detail}</span>}
      </figcaption>
      {children}
    </figure>
  );
}

export function RevisionStrata({
  record,
  selected,
  onSelect,
}: {
  record: MemoryRecord;
  selected: number;
  onSelect: (version: number) => void;
}) {
  return (
    <Instrument title="Estratigrafia de revisões">
      <ol className="revision-strata" aria-label="Revisões do registro">
        {record.revisions.map(({ version, observed }) => (
          <li key={version}>
            <button
              type="button"
              aria-pressed={version === selected}
              onClick={() => onSelect(version)}
            >
              <span className="strata-index">v{version}</span>
              <span>Observada em {observed}</span>
              <span className="strata-line" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
    </Instrument>
  );
}

type ManifestEntry = Source & { included: boolean };

export function BudgetSpectrum({
  manifest,
  budget,
}: {
  manifest: readonly ManifestEntry[];
  budget: number;
}) {
  const included = manifest.filter((item) => item.included);
  const omitted = manifest.filter((item) => !item.included);
  const used = included.reduce((total, item) => total + item.tokens, 0);
  const requested = manifest.reduce((total, item) => total + item.tokens, 0);
  const scale = Math.max(budget, requested);
  const width = (tokens: number) => ((tokens / scale) * 100).toString() + "%";

  return (
    <Instrument
      title="Espectro de orçamento"
      detail={
        <>
          {used} de {budget} tokens estimados
        </>
      }
    >
      <div className="budget-spectrum" aria-hidden="true">
        <div className="spectrum-track">
          {included.map((item) => (
            <span
              key={item.id}
              data-source={item.kind}
              style={{ width: width(item.tokens) }}
            />
          ))}
          <span
            className="spectrum-unused"
            style={{ width: width(budget - used) }}
          />
          {!!omitted.length && (
            <span
              className="spectrum-overflow"
              style={{ width: width(scale - budget) }}
            />
          )}
        </div>
        <div className="spectrum-limit" style={{ left: width(budget) }} />
      </div>
      <p className="instrument-note">
        {requested} solicitados · {omitted.length}{" "}
        {omitted.length === 1 ? "fonte omitida" : "fontes omitidas"}
      </p>
    </Instrument>
  );
}

export function AgentObservatory({
  session,
}: {
  session: (typeof sessions)[number];
}) {
  return (
    <Instrument
      title="Observatório de execução"
      detail={
        <>
          Tentativa {session.attempt} · {session.state}
        </>
      }
      className="agent-observatory"
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="lv-orbit" cx="60" cy="60" r="50" />
        <circle
          className={session.state === "Bloqueada" ? "lv-warn" : "lv-source"}
          cx="60"
          cy="60"
          r="37"
          strokeDasharray={session.state === "Bloqueada" ? "5 4" : "1 4"}
        />
        <circle className="lv-hub" cx="60" cy="60" r="22" />
        <text className="lv-lambda" x="60" y="68">
          λ
        </text>
      </svg>
      <ol aria-label="Eventos da tentativa">
        {session.events.map((event) => (
          <li key={event}>{event}</li>
        ))}
      </ol>
    </Instrument>
  );
}

export function GitTopology({
  selected,
  binding,
  reviewed,
}: {
  selected: readonly string[];
  binding: boolean;
  reviewed: boolean;
}) {
  return (
    <Instrument
      title="Topologia do plano"
      detail={
        reviewed
          ? "Revisado"
          : binding
            ? "Vínculo confirmado"
            : "Vínculo pendente"
      }
    >
      <svg
        className="instrument-svg topology-svg"
        viewBox="0 0 680 130"
        role="img"
        aria-label={
          "Checkout original e worktree proposta. Etapas selecionadas: " +
          (plannerSteps
            .filter((step) => selected.includes(step.id))
            .map((step) => step.name)
            .join(", ") || "nenhuma")
        }
      >
        <path className="lv-grid" d="M42 92H635" strokeWidth="2" />
        <path
          className={binding ? "lv-accent" : "lv-warn"}
          d="M75 92C137 92 136 45 198 45H634"
          strokeWidth="2"
          strokeDasharray={binding ? undefined : "5 4"}
        />
        <circle className="lv-dot-source" cx="75" cy="92" r="7" />
        <text className="instrument-axis" x="42" y="116">
          Checkout original
        </text>
        <text className="instrument-axis" x="198" y="26">
          Worktree proposta
        </text>
        {plannerSteps.map((step, index) => {
          const x = 225 + index * 135;
          return (
            <g key={step.id}>
              <circle
                className={
                  selected.includes(step.id) ? "lv-dot-accent" : "lv-panel"
                }
                cx={x}
                cy="45"
                r="9"
              />
              <text
                className="instrument-axis"
                x={x}
                y="70"
                textAnchor="middle"
              >
                {["Vínculo", "Comparação", "Revisão"][index]}
              </text>
            </g>
          );
        })}
        <circle
          className={reviewed ? "lv-dot-green" : "lv-hub"}
          cx="635"
          cy="45"
          r="12"
        />
      </svg>
    </Instrument>
  );
}

export function DivergenceField({
  visible,
  chosen,
}: {
  visible: readonly string[];
  chosen?: string;
}) {
  const items = hypotheses.filter(({ id }) => visible.includes(id));
  const tones = ["lv-accent", "lv-source", "lv-task"];
  const revision = replayEvents[1].revision;
  return (
    <Instrument
      title="Bifurcação de hipóteses"
      detail={
        <>
          Base Git <code>{revision}</code>
        </>
      }
    >
      <svg
        className="instrument-svg"
        viewBox="0 0 700 154"
        role="img"
        aria-label={
          "Trajetórias da mesma base: " +
          items.map(({ title }) => title).join(", ")
        }
      >
        <ellipse className="lv-orbit" cx="70" cy="77" rx="43" ry="34" />
        <circle className="lv-hub" cx="70" cy="77" r="21" />
        <text className="lv-lambda" x="70" y="85">
          λ
        </text>
        {items.map((item, index) => {
          const y = 77 + (index - (items.length - 1) / 2) * 42;
          const tone = tones[hypotheses.indexOf(item)];
          const selected = chosen === item.id;
          return (
            <g key={item.id} className={tone}>
              <path
                d={"M90 77 C175 77 180 " + y + " 286 " + y + " H335"}
                strokeWidth={selected ? 4 : 2}
              />
              <circle
                cx="335"
                cy={y}
                r={selected ? 7 : 4}
                fill="var(--instrument-tone)"
              />
              <text className="instrument-axis" x="355" y={y + 4}>
                {item.title}
                {selected ? " · selecionada" : ""}
              </text>
            </g>
          );
        })}
      </svg>
    </Instrument>
  );
}

export function Chronoscope({
  base,
  target,
  onTarget,
}: {
  base: string;
  target: string;
  onTarget: (id: string) => void;
}) {
  const instants = replayEvents.flatMap(({ effectiveAt, recordedAt }) => [
    Date.parse(effectiveAt),
    Date.parse(recordedAt),
  ]);
  const start = Math.min(...instants);
  const span = Math.max(...instants) - start;
  const xFor = (instant: string) =>
    150 + ((Date.parse(instant) - start) / span) * 465;
  const first = replayEvents.find(({ id }) => id === base)!;
  const last = replayEvents.find(({ id }) => id === target)!;
  const xBase = xFor(first.effectiveAt);
  const xTarget = xFor(last.effectiveAt);
  const middle = (xBase + xTarget) / 2;
  return (
    <Instrument
      title="Cronoscópio bitemporal"
      detail={
        <>
          <code>{first.revision}</code> → <code>{last.revision}</code>
        </>
      }
    >
      <svg className="instrument-svg" viewBox="0 0 680 132" aria-hidden="true">
        <text className="instrument-axis" x="18" y="58">
          Vigência (V)
        </text>
        <text className="instrument-axis" x="18" y="104">
          Registro (K)
        </text>
        <path className="lv-accent" d="M130 54H640" opacity=".66" />
        <path className="lv-source" d="M130 100H640" opacity=".66" />
        {base !== target && (
          <path
            className="lv-accent"
            strokeWidth="2"
            strokeDasharray="4 4"
            d={"M" + xBase + " 54 Q" + middle + " -6 " + xTarget + " 54"}
          />
        )}
        {replayEvents.map((event) => {
          const vx = xFor(event.effectiveAt);
          const kx = xFor(event.recordedAt);
          return (
            <g
              key={event.id}
              opacity={event.id === target || event.id === base ? 1 : 0.56}
            >
              <line
                className="lv-grid"
                x1={vx}
                y1="54"
                x2={kx}
                y2="100"
                strokeWidth="2"
              />
              <circle
                className="lv-dot-accent"
                cx={vx}
                cy="54"
                r={event.id === target ? 7 : 4}
              />
              <circle className="lv-dot-source" cx={kx} cy="100" r="5" />
              <text
                className="instrument-axis"
                x={kx}
                y="121"
                textAnchor="middle"
              >
                {event.revision}
              </text>
            </g>
          );
        })}
      </svg>
      <div
        className="chrono-events"
        role="group"
        aria-label="Momento a inspecionar"
      >
        {replayEvents.map((event) => (
          <button
            type="button"
            key={event.id}
            aria-pressed={event.id === target}
            onClick={() => onTarget(event.id)}
          >
            <strong>{event.label}</strong>
            <small>V {event.effective}</small>
            <small>K {event.recorded}</small>
          </button>
        ))}
      </div>
    </Instrument>
  );
}
