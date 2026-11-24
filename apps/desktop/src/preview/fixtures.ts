import type { PreviewId } from "../navigation";

export const fixtureName = "Atlas · documentação técnica";
export type Scenario = "ready" | "medium" | "empty" | "error" | "unavailable";
export type PreviewState =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "unavailable"; message: string };

export function readFixture(
  experience: PreviewId,
  scenario: Scenario,
): PreviewState {
  if (scenario === "ready" || (experience === "graph" && scenario === "medium"))
    return { kind: "ready" };
  if (scenario === "empty") return { kind: "empty" };
  if (scenario === "error")
    return {
      kind: "error",
      message: "O cenário de falha interrompeu a leitura da fixture.",
    };
  return { kind: "unavailable", message: availability[experience] };
}

const availability: Record<PreviewId, string> = {
  memory: "O catálogo versionado de memória está previsto na F3.",
  graph: "A projeção reconstruível de relações está prevista na F3.",
  compiler: "O compilador e a autorização por destino estão previstos na F2.",
  inbox: "A revisão de propostas de memória está prevista na F3.",
  agents: "A supervisão de execuções reais depende dos marcos da F4.",
  planner: "A execução supervisionada de planos está prevista na F4.",
  preflight: "O preflight executável depende dos verificadores da F4.",
  arena: "A execução isolada por hipótese depende da F5.",
  replay: "A reconstrução histórica consultável depende da F5.",
};

export type Source = {
  id: string;
  path: string;
  tokens: number;
  kind: "Documento" | "Código" | "Decisão";
  excerpt: string;
};

export const sources: readonly Source[] = [
  {
    id: "s1",
    path: "manual/retomada.md",
    tokens: 164,
    kind: "Documento",
    excerpt:
      "Conferir a origem da captura antes de revisar o roteiro. Registrar lacunas no mesmo checkout.",
  },
  {
    id: "s2",
    path: "src/relatorio.ts",
    tokens: 228,
    kind: "Código",
    excerpt: "export const estado = 'revisão local';",
  },
  {
    id: "s3",
    path: "decisões/continuidade",
    tokens: 112,
    kind: "Decisão",
    excerpt:
      "Preservar o trecho e o instante observado em toda revisão de continuidade.",
  },
  {
    id: "s4",
    path: "manual/checklist.md",
    tokens: 132,
    kind: "Documento",
    excerpt:
      "Vínculo do checkout, escopo das fontes, cobertura da prova e autorização do destino.",
  },
];

export type MemoryRecord = {
  id: string;
  title: string;
  scope: string;
  source: string;
  revisions: readonly { version: number; observed: string; content: string }[];
};
export const memoryRecords: readonly MemoryRecord[] = [
  {
    id: "m1",
    title: "Prova de continuidade",
    scope: "Canônica · fixture",
    source: "s1",
    revisions: [
      {
        version: 2,
        observed: "22 nov · 14:40",
        content:
          "Conferir a origem da captura antes de revisar o roteiro. Manter juntas a data e a fonte preservada.",
      },
      {
        version: 1,
        observed: "20 nov · 09:15",
        content: "Conferir a origem da captura antes de revisar o roteiro.",
      },
    ],
  },
  {
    id: "m2",
    title: "Escopo de uma consulta",
    scope: "Local · fixture",
    source: "s4",
    revisions: [
      {
        version: 1,
        observed: "21 nov · 11:20",
        content:
          "Explicitar a seleção de fontes e a finalidade antes de revisar o manifesto.",
      },
    ],
  },
  {
    id: "m3",
    title: "Roteiro de inspeção Git",
    scope: "Local · fixture",
    source: "s2",
    revisions: [
      {
        version: 1,
        observed: "19 nov · 17:03",
        content:
          "Conferir a diferença entre a revisão preparada e o arquivo vivo.",
      },
    ],
  },
];

export const sessions = [
  {
    id: "a17",
    title: "Revisar o roteiro",
    capability: "Leitura de evidências",
    state: "Em revisão",
    attempt: 2,
    result: "Identificou uma lacuna entre a decisão e a revisão documentada.",
    source: "s1",
    events: [
      "Seleção recebeu 2 fontes preservadas",
      "Tentativa produziu uma nota de revisão",
      "Aguardando decisão humana",
    ],
  },
  {
    id: "a19",
    title: "Preparar nota de continuidade",
    capability: "Proposta local",
    state: "Concluída",
    attempt: 1,
    result: "Registrou uma sugestão de checklist com proveniência de fixture.",
    source: "s4",
    events: ["Manifesto conferido", "Nota disponibilizada para inspeção"],
  },
  {
    id: "a22",
    title: "Revisar envio de contexto",
    capability: "Conexão com provedor",
    state: "Bloqueada",
    attempt: 1,
    result: "O cenário não inclui autorização para um destino.",
    source: "s3",
    events: [
      "Checagem do destino simulada",
      "Tentativa bloqueada antes de enviar",
    ],
  },
] as const;

export const proposals = [
  {
    id: "i1",
    title: "Manter data junto da evidência",
    source: "s1",
    conflict: "",
    text: "Registrar o instante da captura junto da prova para distinguir a leitura histórica da observação atual.",
  },
  {
    id: "i2",
    title: "Priorizar sempre o arquivo vivo",
    source: "s2",
    conflict: "Conflita com a decisão vigente sobre fontes preservadas.",
    conflictsWith: "m1",
    text: "Preferir a leitura da árvore atual para revisar cada nota.",
  },
  {
    id: "i3",
    title: "Exibir cobertura no manifesto",
    source: "s4",
    conflict: "",
    text: "Mostrar quando uma fonte foi incluída inteira ou apenas por trecho.",
  },
] as const;

export const plannerSteps = [
  {
    id: "p1",
    name: "Conferir vínculo do checkout",
    condition: "Worktree de fixture corresponde ao alvo",
    risk: "Baixo",
  },
  {
    id: "p2",
    name: "Comparar estado e captura",
    condition: "Captura histórica disponível para leitura",
    risk: "Baixo",
  },
  {
    id: "p3",
    name: "Preparar revisão das alterações",
    condition: "Roteiro e fonte preservada selecionados",
    risk: "Revisão necessária",
  },
] as const;

export const hypotheses = [
  {
    id: "h1",
    title: "Manter revisão no roteiro",
    goal: "Limitar a mudança à documentação existente.",
    outcome: "Valida a prova com menor alteração didática.",
    cost: "1 arquivo proposto",
    caveat: "O checklist continua no mesmo documento.",
  },
  {
    id: "h2",
    title: "Extrair checklist",
    goal: "Tornar a revisão reutilizável pelo restante do manual.",
    outcome: "Separa as precondições do percurso narrativo.",
    cost: "2 arquivos propostos",
    caveat: "Exige revisar vínculos entre documentos.",
  },
  {
    id: "h3",
    title: "Começar pela comparação Git",
    goal: "Confirmar o impacto antes de propor uma estrutura.",
    outcome: "Reduz a incerteza sobre o arquivo em disco.",
    cost: "Sem alteração proposta",
    caveat: "Adia a revisão editorial para outra rodada.",
  },
] as const;

export const replayEvents = [
  {
    id: "r1",
    label: "Captura inicial",
    effective: "19 nov · 10:10",
    recorded: "19 nov · 10:14",
    effectiveAt: "2026-11-19T10:10:00-03:00",
    recordedAt: "2026-11-19T10:14:00-03:00",
    revision: "0f71bd0",
    content: "Política de continuidade\nConferir o roteiro antes de editar.\n",
  },
  {
    id: "r2",
    label: "Prova vinculada",
    effective: "20 nov · 09:30",
    recorded: "20 nov · 09:42",
    effectiveAt: "2026-11-20T09:30:00-03:00",
    recordedAt: "2026-11-20T09:42:00-03:00",
    revision: "bf194dd",
    content:
      "Política de continuidade\nConferir o roteiro antes de editar.\nPreservar a fonte usada na decisão.\n",
  },
  {
    id: "r3",
    label: "Decisão revisada",
    effective: "22 nov · 13:11",
    recorded: "22 nov · 14:40",
    effectiveAt: "2026-11-22T13:11:00-03:00",
    recordedAt: "2026-11-22T14:40:00-03:00",
    revision: "dc62a51",
    content:
      "Política de continuidade\nConferir o roteiro e a origem da captura antes de editar.\nPreservar a fonte e o instante usados na decisão.\n",
  },
] as const;

export function findSource(id: string) {
  return sources.find((source) => source.id === id);
}
