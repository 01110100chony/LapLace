import type {
  ProjectIdentityResult,
  ProjectRecord,
  ResumeSummary,
} from "@laplace/contracts";
import { formatObservation, proofCoverage } from "../EvidenceProof";
import type { GraphData, GraphEdge, GraphNode } from "./model";

export function projectGraph(
  project: ProjectRecord,
  identity: ProjectIdentityResult | null,
  resume: ResumeSummary | null,
): GraphData | undefined {
  if (
    !identity ||
    !resume ||
    identity.legacyProjectId !== project.id ||
    resume.root !== project.root ||
    resume.scope.projectId !== identity.scope.projectId ||
    resume.scope.bindingId !== identity.scope.bindingId ||
    resume.scope.worktreeId !== identity.scope.worktreeId
  )
    return;

  const scope = resume.scope;
  const nodes: GraphNode[] = [
    {
      id: "project",
      kind: "project",
      label: project.name,
      x: 0,
      y: 0,
      target: "overview",
      facts: [
        { label: "Checkout", value: resume.root, mono: true },
        { label: "Worktree", value: scope.worktreeId, mono: true },
        { label: "Leitura", value: formatObservation(resume.computedAt) },
      ],
    },
  ];
  const edges: GraphEdge[] = [];
  const observed = resume.observation.observation;
  if (observed) {
    nodes.push({
      id: "git",
      kind: "git",
      label: observed.branch ?? "HEAD destacado",
      x: -270,
      y: -133,
      target: "working",
      facts: [
        {
          label: "Origem",
          value:
            resume.observation.state === "cached"
              ? "Cache Git"
              : "Observação Git",
        },
        {
          label: "Observado em",
          value: formatObservation(observed.observedAt),
        },
        { label: "HEAD", value: observed.head ?? "Sem commit", mono: true },
      ],
    });
    edges.push({
      id: "project-git",
      from: "project",
      to: "git",
      label: "tem leitura Git",
      origin: "Observação do checkout vinculada na F1",
    });
  }

  const decision = resume.memory.decision;
  const evidence = decision?.evidence;
  const ref = evidence?.ref;
  const decisionHere = decision?.projectId === scope.projectId;
  const sourceHere = decisionHere && ref?.projectId === scope.projectId;
  if (decisionHere && decision) {
    nodes.push({
      id: "decision",
      kind: "decision",
      label: "Decisão vigente",
      description: decision.content,
      x: 276,
      y: -130,
      target: "overview",
      facts: [
        {
          label: "Autoridade",
          value:
            decision.visibility === "canonical_verified"
              ? "Canônica verificada"
              : "Decisão local",
        },
        { label: "Autor", value: decision.author },
        { label: "Revisão", value: String(decision.revision) },
        {
          label: "Registrada em",
          value: formatObservation(decision.recordedAt),
        },
        {
          label: "Prova",
          value:
            evidence?.state === "verified" && sourceHere
              ? "Vinculada"
              : "Lacuna de evidência",
        },
      ],
    });
    edges.push({
      id: "project-decision",
      from: "project",
      to: "decision",
      label: "tem decisão",
      origin: "Decisão humana selecionada para este vínculo",
    });
  }
  if (sourceHere && ref && evidence) {
    nodes.push({
      id: "source",
      kind: "source",
      label: ref.path,
      x: 310,
      y: 126,
      target: evidence.state === "verified" ? "source" : undefined,
      facts: [
        {
          label: "Origem",
          value:
            evidence.sourceOrigin === "context_search"
              ? "Índice C02"
              : evidence.sourceOrigin === "context_capture"
                ? "Captura C01"
                : "Origem indisponível",
        },
        { label: "Cobertura", value: proofCoverage[evidence.coverage] },
        {
          label: "Disponibilidade",
          value:
            evidence.state === "verified"
              ? "Preservada na última leitura"
              : "Lacuna na última leitura",
        },
        { label: "Captura", value: ref.contextId, mono: true },
        ...(evidence.capturedAt
          ? [
              {
                label: "Capturada em",
                value: formatObservation(evidence.capturedAt),
              },
            ]
          : []),
        { label: "SHA-256", value: ref.sha256, mono: true },
      ],
    });
    edges.push({
      id: "decision-source",
      from: "decision",
      to: "source",
      label: "referencia",
      origin: "Vínculo de evidência da revisão da decisão",
    });
  }
  const capture = resume.activity.lastCapture;
  if (capture?.projectId === scope.projectId) {
    nodes.push({
      id: "capture",
      kind: "capture",
      label: "Última captura",
      x: -88,
      y: 168,
      target: "context",
      facts: [
        { label: "Origem", value: "Catálogo de capturas C01" },
        { label: "Captura", value: capture.contextId, mono: true },
        {
          label: "Concluída em",
          value: formatObservation(capture.completedAt),
        },
        {
          label: "Cobertura",
          value:
            capture.status === "invalidated"
              ? "Invalidada"
              : `${capture.included} incluídas · ${capture.omitted} omitidas`,
        },
      ],
    });
    edges.push({
      id: "project-capture",
      from: "project",
      to: "capture",
      label: "tem captura",
      origin: "Última captura registrada para o checkout",
    });
    if (sourceHere && ref?.contextId === capture.contextId)
      edges.push({
        id: "capture-source",
        from: "capture",
        to: "source",
        label: "contém a fonte",
        origin: "Identificador da captura na referência de evidência",
      });
  }
  const execution = resume.activity.lastExecution;
  if (execution?.projectId === scope.projectId) {
    nodes.push({
      id: "task",
      kind: "task",
      label: "Tentativa simulada",
      x: -303,
      y: 87,
      target: "tasks",
      facts: [
        { label: "Origem", value: "Registro legado · execução Mock" },
        { label: "Estado", value: execution.state },
        {
          label: "Registrada em",
          value: formatObservation(execution.recordedAt),
        },
        { label: "Tentativa", value: execution.executionId, mono: true },
      ],
    });
    edges.push({
      id: "project-task",
      from: "project",
      to: "task",
      label: "tem registro",
      origin: "Última tentativa simulada do checkout",
    });
  }
  return { scope: { kind: "project", label: project.name }, nodes, edges };
}
