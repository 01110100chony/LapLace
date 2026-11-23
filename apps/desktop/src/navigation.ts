import type { IconName } from "./VisualIcon";

export const projectDestinations = [
  { id: "overview", label: "Retomada", icon: "overview" },
  { id: "context", label: "Contexto", icon: "archive" },
  { id: "tasks", label: "Tarefas", icon: "tasks" },
  { id: "working", label: "Alterações Git", icon: "git" },
] as const satisfies readonly { id: string; label: string; icon: IconName }[];

export type ProjectSection = (typeof projectDestinations)[number]["id"];

export const previewDestinations = [
  {
    id: "memory",
    label: "Memória",
    icon: "archive",
    group: "Conhecimento",
    milestone: "F3",
  },
  {
    id: "graph",
    label: "KGraph",
    icon: "graph",
    group: "Conhecimento",
    milestone: "F3",
  },
  {
    id: "compiler",
    label: "Compilador de contexto",
    icon: "layers",
    group: "Conhecimento",
    milestone: "F2",
  },
  {
    id: "inbox",
    label: "Caixa de memória",
    icon: "inbox",
    group: "Conhecimento",
    milestone: "F3",
  },
  {
    id: "agents",
    label: "Central de agentes",
    icon: "agent",
    group: "Supervisão",
    milestone: "F4",
  },
  {
    id: "planner",
    label: "Planejador Git",
    icon: "git",
    group: "Supervisão",
    milestone: "F4",
  },
  {
    id: "preflight",
    label: "Pre-Flight",
    icon: "check",
    group: "Supervisão",
    milestone: "F4",
  },
  {
    id: "arena",
    label: "Arena de hipóteses",
    icon: "split",
    group: "Experimentos",
    milestone: "F5",
  },
  {
    id: "replay",
    label: "Replay temporal",
    icon: "clock",
    group: "Experimentos",
    milestone: "F5",
  },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: IconName;
  group: string;
  milestone: string;
}[];

export type PreviewId = (typeof previewDestinations)[number]["id"];
export type Route =
  | { kind: "workspace" }
  | { kind: "project" }
  | { kind: "settings" }
  | { kind: "lab"; preview?: PreviewId };
