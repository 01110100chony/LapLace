import type { PreviewId } from "../navigation";

export const fixtureName = "Atlas · documentação técnica";
export type Scenario = "ready" | "empty" | "error" | "unavailable";
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
  if (scenario === "ready") return { kind: "ready" };
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
  lines: number;
  digest: string;
  tier: "Invariante canônico" | "Documento técnico" | "Código local";
  kind: "Documento" | "Código" | "Decisão";
  excerpt: string;
};

export const sources: readonly Source[] = [
  {
    id: "s1",
    path: "manual/retomada.md",
    tokens: 164,
    lines: 42,
    digest: "9f4c2a1b",
    tier: "Documento técnico",
    kind: "Documento",
    excerpt:
      "Conferir a origem da captura antes de revisar o roteiro. Registrar lacunas no mesmo checkout.",
  },
  {
    id: "s2",
    path: "src/relatorio.ts",
    tokens: 228,
    lines: 68,
    digest: "4e19d70c",
    tier: "Código local",
    kind: "Código",
    excerpt: "export const estado = 'revisão local';",
  },
  {
    id: "s3",
    path: "decisões/continuidade",
    tokens: 112,
    lines: 29,
    digest: "a83b5f01",
    tier: "Invariante canônico",
    kind: "Decisão",
    excerpt:
      "Preservar o trecho e o instante observado em toda revisão de continuidade.",
  },
  {
    id: "s4",
    path: "manual/checklist.md",
    tokens: 132,
    lines: 36,
    digest: "c710e84d",
    tier: "Documento técnico",
    kind: "Documento",
    excerpt:
      "Vínculo do checkout, escopo das fontes, cobertura da prova e autorização do destino.",
  },
];

export type MemoryRevision = {
  version: number;
  observed: string;
  effective: string;
  digest: string;
  content: string;
};

export type MemoryRecord = {
  id: string;
  title: string;
  scope: string;
  authority: "Canônica · humana" | "Local · observada";
  summaryTag: string;
  source: string;
  revisions: readonly MemoryRevision[];
};

export const memoryRecords: readonly MemoryRecord[] = [
  {
    id: "m1",
    title: "Prova de continuidade",
    scope: "Canônica · fixture",
    authority: "Canônica · humana",
    summaryTag: "INV-02 · Evidência acoplada",
    source: "s1",
    revisions: [
      {
        version: 3,
        observed: "22 nov · 14:40",
        effective: "22 nov · 13:11",
        digest: "dc62a51f",
        content:
          "Conferir a origem da captura antes de revisar o roteiro. Manter juntas a data, o digest e a fonte preservada em toda retomada.",
      },
      {
        version: 2,
        observed: "20 nov · 09:42",
        effective: "20 nov · 09:30",
        digest: "bf194dd8",
        content:
          "Conferir a origem da captura antes de revisar o roteiro. Manter juntas a data e a fonte preservada.",
      },
      {
        version: 1,
        observed: "19 nov · 10:14",
        effective: "19 nov · 10:10",
        digest: "0f71bd04",
        content:
          "Conferir a origem da captura antes de revisar o roteiro.",
      },
    ],
  },
  {
    id: "m2",
    title: "Escopo de uma consulta",
    scope: "Local · fixture",
    authority: "Local · observada",
    summaryTag: "INV-01 · Destino explícito",
    source: "s4",
    revisions: [
      {
        version: 2,
        observed: "21 nov · 15:08",
        effective: "21 nov · 15:00",
        digest: "e2841ca9",
        content:
          "Explicitar a seleção de fontes, o limite em tokens e a finalidade antes de revisar o manifesto público.",
      },
      {
        version: 1,
        observed: "21 nov · 11:20",
        effective: "21 nov · 11:15",
        digest: "71c0b3e2",
        content:
          "Explicitar a seleção de fontes e a finalidade antes de revisar o manifesto.",
      },
    ],
  },
  {
    id: "m3",
    title: "Roteiro de inspeção Git",
    scope: "Local · fixture",
    authority: "Local · observada",
    summaryTag: "Leitura passiva",
    source: "s2",
    revisions: [
      {
        version: 1,
        observed: "19 nov · 17:03",
        effective: "19 nov · 17:00",
        digest: "3a95f612",
        content:
          "Conferir a diferença entre a revisão preparada no índice e o arquivo vivo sem alterar HEAD ou refs.",
      },
    ],
  },
];

export type GraphKind = "Decisão" | "Fonte" | "Tarefa";
export type GraphNode = {
  id: string;
  type: GraphKind;
  name: string;
  x: number;
  y: number;
  evidence: string;
  digest: string;
  status: "Confirmada" | "Verificada" | "Em revisão";
};

export const graphNodes: readonly GraphNode[] = [
  {
    id: "n1",
    type: "Decisão",
    name: "Prova de continuidade",
    x: 380,
    y: 178,
    evidence: "s3",
    digest: "a83b5f01",
    status: "Confirmada",
  },
  {
    id: "n2",
    type: "Fonte",
    name: "Roteiro de retomada",
    x: 132,
    y: 78,
    evidence: "s1",
    digest: "9f4c2a1b",
    status: "Verificada",
  },
  {
    id: "n3",
    type: "Tarefa",
    name: "Revisar a prova",
    x: 622,
    y: 84,
    evidence: "s4",
    digest: "c710e84d",
    status: "Em revisão",
  },
  {
    id: "n4",
    type: "Fonte",
    name: "Relatório local",
    x: 626,
    y: 266,
    evidence: "s2",
    digest: "4e19d70c",
    status: "Verificada",
  },
  {
    id: "n5",
    type: "Tarefa",
    name: "Checar alterações",
    x: 132,
    y: 268,
    evidence: "s2",
    digest: "4e19d70c",
    status: "Confirmada",
  },
  {
    id: "n6",
    type: "Decisão",
    name: "Escopo de consulta",
    x: 380,
    y: 62,
    evidence: "s4",
    digest: "e2841ca9",
    status: "Confirmada",
  },
  {
    id: "n7",
    type: "Fonte",
    name: "Checklist de vínculo",
    x: 380,
    y: 304,
    evidence: "s4",
    digest: "c710e84d",
    status: "Verificada",
  },
  {
    id: "n8",
    type: "Tarefa",
    name: "Auditar manifesto",
    x: 632,
    y: 176,
    evidence: "s3",
    digest: "a83b5f01",
    status: "Em revisão",
  },
];

export const graphEdges: readonly {
  from: string;
  to: string;
  relation: string;
}[] = [
  { from: "n2", to: "n1", relation: "fundamenta" },
  { from: "n1", to: "n3", relation: "orienta" },
  { from: "n4", to: "n3", relation: "evidencia" },
  { from: "n4", to: "n5", relation: "inspecionado por" },
  { from: "n5", to: "n1", relation: "verifica" },
  { from: "n6", to: "n1", relation: "restringe" },
  { from: "n2", to: "n6", relation: "informa" },
  { from: "n7", to: "n1", relation: "ancora" },
  { from: "n7", to: "n4", relation: "valida" },
  { from: "n1", to: "n8", relation: "audita" },
];

export const sessions = [
  {
    id: "a17",
    title: "Revisar o roteiro",
    capability: "Leitura de evidências",
    state: "Em revisão",
    attempt: 2,
    worktree: "wt/atlas-rev-02",
    boundary: "Worktree dedicada · leitura passiva",
    duration: "14s",
    stageIndex: 3,
    result: "Identificou uma lacuna entre a decisão e a revisão documentada.",
    source: "s1",
    events: [
      { time: "14:32:04", label: "Seleção recebeu 2 fontes preservadas", tone: "ok" },
      { time: "14:32:09", label: "Confinamento da worktree verificado", tone: "ok" },
      { time: "14:32:16", label: "Tentativa produziu uma nota de revisão", tone: "warn" },
      { time: "14:32:18", label: "Aguardando decisão humana", tone: "warn" },
    ],
  },
  {
    id: "a19",
    title: "Preparar nota de continuidade",
    capability: "Proposta local",
    state: "Concluída",
    attempt: 1,
    worktree: "wt/atlas-nota-01",
    boundary: "Worktree dedicada · isolamento local",
    duration: "9s",
    stageIndex: 3,
    result: "Registrou uma sugestão de checklist com proveniência de fixture.",
    source: "s4",
    events: [
      { time: "11:18:10", label: "Manifesto conferido por digest", tone: "ok" },
      { time: "11:18:14", label: "Verificação estrutural concluída", tone: "ok" },
      { time: "11:18:19", label: "Nota disponibilizada para inspeção", tone: "ok" },
    ],
  },
  {
    id: "a22",
    title: "Revisar envio de contexto",
    capability: "Conexão com provedor",
    state: "Bloqueada",
    attempt: 1,
    worktree: "sem alocação",
    boundary: "Bloqueada antes da fronteira externa",
    duration: "1s",
    stageIndex: 1,
    result: "O cenário não inclui autorização para um destino.",
    source: "s3",
    events: [
      { time: "09:44:01", label: "Checagem do destino simulada", tone: "warn" },
      { time: "09:44:02", label: "Tentativa bloqueada antes de enviar", tone: "block" },
    ],
  },
] as const;

export const proposals = [
  {
    id: "i1",
    title: "Manter data junto da evidência",
    source: "s1",
    origin: "Sessão a17 · leitura",
    duplicates: 2,
    submittedAt: "22 nov · 14:35",
    conflict: "",
    incumbentText: "",
    text: "Registrar o instante da captura junto da prova para distinguir a leitura histórica da observação atual.",
  },
  {
    id: "i2",
    title: "Priorizar sempre o arquivo vivo",
    source: "s2",
    origin: "Inspeção automática · disco",
    duplicates: 1,
    submittedAt: "22 nov · 14:12",
    conflict: "Conflita com a decisão vigente sobre fontes preservadas.",
    incumbentText:
      "Preservar o trecho e o instante observado em toda revisão de continuidade.",
    text: "Preferir a leitura da árvore atual para revisar cada nota, substituindo o trecho preservado.",
  },
  {
    id: "i3",
    title: "Exibir cobertura no manifesto",
    source: "s4",
    origin: "Compilador · manifesto",
    duplicates: 3,
    submittedAt: "21 nov · 18:04",
    conflict: "",
    incumbentText: "",
    text: "Mostrar quando uma fonte foi incluída inteira ou apenas por trecho.",
  },
] as const;

export const plannerSteps = [
  {
    id: "p1",
    code: "01",
    name: "Conferir vínculo do checkout",
    condition: "Worktree de fixture corresponde ao alvo",
    scopePath: ".git/HEAD · fixture",
    effect: "Leitura",
    risk: "Baixo",
  },
  {
    id: "p2",
    code: "02",
    name: "Comparar estado e captura",
    condition: "Captura histórica disponível para leitura",
    scopePath: "manual/retomada.md",
    effect: "Comparação",
    risk: "Baixo",
  },
  {
    id: "p3",
    code: "03",
    name: "Preparar revisão das alterações",
    condition: "Roteiro e fonte preservada selecionados",
    scopePath: "src/relatorio.ts",
    effect: "Revisão",
    risk: "Revisão necessária",
  },
  {
    id: "p4",
    code: "04",
    name: "Emitir pacote de evidências",
    condition: "Diff isolado revisado sem mutar main",
    scopePath: "manual/checklist.md",
    effect: "Revisão",
    risk: "Revisão necessária",
  },
] as const;

export const preflightChecks = [
  {
    id: "c1",
    quadrant: "Checkout",
    label: "Checkout identificado",
    fingerprint: "chk-9f4c",
    scopeNote: "Raiz canônica e HEAD conferidos",
    evidence: "Raiz e revisão conferidas no cenário.",
  },
  {
    id: "c2",
    quadrant: "Fontes",
    label: "Fontes selecionadas",
    fingerprint: "src-a83b",
    scopeNote: "3 fontes seladas por digest",
    evidence: "Roteiro e decisão disponíveis na fixture.",
  },
  {
    id: "c3",
    quadrant: "Risco",
    label: "Risco revisado",
    fingerprint: "rsk-4e19",
    scopeNote: "Zero mutação no disco local",
    evidence: "A comparação é apenas uma leitura.",
  },
  {
    id: "c4",
    quadrant: "Destino",
    label: "Destino revisado",
    fingerprint: "dst-c710",
    scopeNote: "Escopo estrito na sessão local",
    evidence: "O pacote demonstrativo fica nesta tela.",
  },
] as const;

export const hypotheses = [
  {
    id: "h1",
    title: "Manter revisão no roteiro",
    branch: "arena/h1-roteiro",
    baseHash: "bf194dd",
    diffStats: "+14 −3",
    goal: "Limitar a mudança à documentação existente.",
    outcome: "Valida a prova com menor alteração didática.",
    cost: "1 arquivo proposto",
    caveat: "O checklist continua no mesmo documento.",
    patchPreview:
      "@@ manual/retomada.md @@\n+ Conferir digest antes da revisão.\n  Registrar lacunas no mesmo checkout.",
    metrics: {
      minimalScope: 92,
      reuse: 48,
      certainty: 88,
      reversibility: 96,
    },
  },
  {
    id: "h2",
    title: "Extrair checklist",
    branch: "arena/h2-checklist",
    baseHash: "bf194dd",
    diffStats: "+28 −6",
    goal: "Tornar a revisão reutilizável pelo restante do manual.",
    outcome: "Separa as precondições do percurso narrativo.",
    cost: "2 arquivos propostos",
    caveat: "Exige revisar vínculos entre documentos.",
    patchPreview:
      "@@ manual/checklist.md @@\n+ export const checklist = ['vinculo', 'escopo'];\n@@ manual/retomada.md @@\n+ Referenciar checklist compartilhado.",
    metrics: {
      minimalScope: 64,
      reuse: 94,
      certainty: 79,
      reversibility: 84,
    },
  },
  {
    id: "h3",
    title: "Começar pela comparação Git",
    branch: "arena/h3-leitura-git",
    baseHash: "bf194dd",
    diffStats: "0 alterações",
    goal: "Confirmar o impacto antes de propor uma estrutura.",
    outcome: "Reduz a incerteza sobre o arquivo em disco.",
    cost: "Sem alteração proposta",
    caveat: "Adia a revisão editorial para outra rodada.",
    patchPreview:
      "@@ git diff --no-optional-locks @@\n  src/relatorio.ts | 4 ++--\n  Nenhuma mutação proposta nesta hipótese.",
    metrics: {
      minimalScope: 100,
      reuse: 30,
      certainty: 96,
      reversibility: 100,
    },
  },
] as const;

export const replayEvents = [
  {
    id: "r1",
    label: "Captura inicial",
    txSeq: "tx#01",
    effective: "19 nov · 10:10",
    recorded: "19 nov · 10:14",
    revision: "0f71bd0",
    coverage: "2/2 fontes íntegras",
    gapNote: "",
    vAxis: 0.08,
    kAxis: 0.1,
    content: "Política de continuidade\nConferir o roteiro antes de editar.\n",
  },
  {
    id: "r2",
    label: "Prova vinculada",
    txSeq: "tx#02",
    effective: "20 nov · 09:30",
    recorded: "20 nov · 09:42",
    revision: "bf194dd",
    coverage: "3/3 fontes íntegras",
    gapNote: "",
    vAxis: 0.36,
    kAxis: 0.38,
    content:
      "Política de continuidade\nConferir o roteiro antes de editar.\nPreservar a fonte usada na decisão.\n",
  },
  {
    id: "r3",
    label: "Decisão revisada",
    txSeq: "tx#03",
    effective: "22 nov · 13:11",
    recorded: "22 nov · 14:40",
    revision: "dc62a51",
    coverage: "4/4 fontes íntegras",
    gapNote: "",
    vAxis: 0.66,
    kAxis: 0.68,
    content:
      "Política de continuidade\nConferir o roteiro e a origem da captura antes de editar.\nPreservar a fonte e o instante usados na decisão.\n",
  },
  {
    id: "r4",
    label: "Leitura com lacuna",
    txSeq: "tx#04",
    effective: "22 nov · 13:11",
    recorded: "23 nov · 08:25",
    revision: "e84c902",
    coverage: "3/4 fontes · 1 lacuna",
    gapNote:
      "Trecho auxiliar removido no disco; leitura preservada via tombstone.",
    vAxis: 0.66,
    kAxis: 0.94,
    content:
      "Política de continuidade\nConferir o roteiro e a origem da captura antes de editar.\nPreservar a fonte e o instante usados na decisão.\nLacuna declarada: manual/anexo-removido.md.\n",
  },
] as const;

export function findSource(id: string) {
  return sources.find((source) => source.id === id);
}
