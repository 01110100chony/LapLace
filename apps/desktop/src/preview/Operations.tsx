import { useState } from "react";
import { memoryRecords, plannerSteps, proposals, sessions } from "./fixtures";
import { AgentObservatory, GitTopology, Instrument } from "./Instruments";
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
      <PreviewSection title="Sessões de exemplo" icon="agent">
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
      <PreviewSection title="Tentativa e revisão" icon="activity">
        {active && (
          <>
            <p className="preview-detail-title">{active.title}</p>
            <AgentObservatory session={active} />
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
  const [selected, setSelected] = useState<string>(proposals[1].id);
  const [reviews, setReviews] = useState<Record<string, Review | undefined>>(
    {},
  );
  const [result, setResult] = useState("");
  const items = proposals.filter(
    (proposal) =>
      filter === "Todas" || (reviews[proposal.id] ?? "A revisar") === filter,
  );
  const active = items.find((item) => item.id === selected) ?? items[0];
  const conflictingRecord =
    active && "conflictsWith" in active
      ? memoryRecords.find(({ id }) => id === active.conflictsWith)
      : undefined;

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
            {conflictingRecord ? (
              <Instrument
                title="Comparação de conflito"
                detail="Revisão humana"
                className="conflict-instrument"
              >
                <div className="conflict-pair">
                  <div>
                    <h3>Proposta</h3>
                    <p>{active.text}</p>
                    <Evidence id={active.source} />
                  </div>
                  <div>
                    <h3>
                      Decisão vigente · v
                      {conflictingRecord.revisions[0]?.version}
                    </h3>
                    <p>{conflictingRecord.revisions[0]?.content}</p>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => navigate("memory", conflictingRecord.id)}
                    >
                      Abrir revisão <VisualIcon name="forward" />
                    </button>
                  </div>
                </div>
              </Instrument>
            ) : (
              <>
                <p className="preview-reading">{active.text}</p>
                <Evidence id={active.source} />
              </>
            )}
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
        <GitTopology selected={steps} binding={binding} reviewed={review} />
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
  const [checkout, setCheckout] = useState<"confirmed" | "changed">(
    "confirmed",
  );
  const [destination, setDestination] = useState<"local" | "external">("local");
  const conditions = [
    {
      label: "Checkout",
      value:
        checkout === "confirmed"
          ? "Base da fixture confirmada"
          : "Base mudou desde a seleção",
      ok: checkout === "confirmed",
    },
    { label: "Fontes", value: "Roteiro e decisão do acervo Atlas", ok: true },
    { label: "Operação", value: "Leitura de evidências", ok: true },
    {
      label: "Destino",
      value:
        destination === "local" ? "Somente local" : "Externo sem autorização",
      ok: destination === "local",
    },
  ];
  const blocked = conditions.filter((condition) => !condition.ok);
  return (
    <div className="preview-workbench">
      <PreviewSection title="Escopo do cenário">
        <label className="preview-input">
          <span>Estado do checkout</span>
          <select
            value={checkout}
            onChange={(event) =>
              setCheckout(
                event.target.value === "changed" ? "changed" : "confirmed",
              )
            }
          >
            <option value="confirmed">Base confirmada</option>
            <option value="changed">Base alterada</option>
          </select>
        </label>
        <label className="preview-input">
          <span>Destino</span>
          <select
            value={destination}
            onChange={(event) =>
              setDestination(
                event.target.value === "external" ? "external" : "local",
              )
            }
          >
            <option value="local">Local</option>
            <option value="external">Externo sem autorização</option>
          </select>
        </label>
        <Evidence id="s4" />
      </PreviewSection>
      <PreviewSection title="Precondições avaliadas">
        <Instrument
          title="Astrolábio de prontidão"
          className="preflight-instrument"
        >
          <svg viewBox="0 0 176 176" aria-hidden="true">
            <circle className="lv-orbit" cx="88" cy="88" r="78" />
            <circle className="lv-orbit" cx="88" cy="88" r="51" />
            <circle className="lv-hub" cx="88" cy="88" r="30" />
            <text className="lv-lambda" x="88" y="98">
              λ
            </text>
            {conditions.map((condition, index) => (
              <path
                key={condition.label}
                className={condition.ok ? "lv-source" : "lv-warn"}
                d="M96 16A72 72 0 0 1 160 80"
                strokeWidth="6"
                strokeLinecap="round"
                transform={"rotate(" + index * 90 + " 88 88)"}
              />
            ))}
          </svg>
          <dl>
            {conditions.map(({ label, value, ok }) => (
              <div key={label} data-blocked={!ok}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </Instrument>
        <p
          role="status"
          className={blocked.length ? "preview-warning" : "preview-message"}
        >
          {blocked.length
            ? "Revisão bloqueada por " +
              blocked.map(({ label }) => label.toLowerCase()).join(" e ") +
              "."
            : "Cenário pronto para revisão humana."}
        </p>
        <PreviewLinks ids={["compiler", "planner"]} navigate={navigate} />
      </PreviewSection>
    </div>
  );
}
