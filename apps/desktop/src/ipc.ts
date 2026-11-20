import {
  isIpcError,
  isResponse,
  contextSearchPageSize,
  type ContextSearchInput,
  type ContextSourceRef,
  type ErrorCode,
  type Operation,
  type Results,
} from "@laplace/contracts";

type DesktopCommand =
  | "service_health"
  | "workspace_list"
  | "workspace_add_local"
  | "project_select"
  | "project_inspect"
  | "project_relocate"
  | "context_browse"
  | "context_capture"
  | "context_list"
  | "context_get"
  | "context_validate"
  | "context_index_status"
  | "context_index"
  | "context_search"
  | "context_source_preview";
type PickerOperation = "workspace.addLocal" | "project.relocate";
type InvokeArgs = Record<string, string | string[] | number | boolean | null>;
type Invoke = (command: DesktopCommand, args: InvokeArgs) => Promise<unknown>;

const commands: Record<Operation, DesktopCommand> = {
  health: "service_health",
  "workspace.list": "workspace_list",
  "workspace.addLocal": "workspace_add_local",
  "project.select": "project_select",
  "project.inspect": "project_inspect",
  "project.relocate": "project_relocate",
  "context.browse": "context_browse",
  "context.capture": "context_capture",
  "context.list": "context_list",
  "context.get": "context_get",
  "context.validate": "context_validate",
  "context.indexStatus": "context_index_status",
  "context.index": "context_index",
  "context.search": "context_search",
  "context.sourcePreview": "context_source_preview",
};

export class DesktopError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
  }
}

export function createDesktopClient(invoke: Invoke, deadlineMs = 20_000) {
  async function request(
    operation: PickerOperation,
    args?: InvokeArgs,
  ): Promise<Results[PickerOperation] | null>;
  async function request<K extends Exclude<Operation, PickerOperation>>(
    operation: K,
    args?: InvokeArgs,
  ): Promise<Results[K]>;
  async function request<K extends Operation>(
    operation: K,
    args: InvokeArgs = {},
  ): Promise<Results[K] | null> {
    const id = crypto.randomUUID();
    const picker =
      operation === "workspace.addLocal" || operation === "project.relocate";
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const call = invoke(commands[operation], { ...args, id });
      // The native picker may stay open as long as the user needs.
      const response = picker
        ? await call
        : await Promise.race([
            call,
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new DesktopError("ipc_timeout")),
                deadlineMs,
              );
            }),
          ]);
      if (response === null && picker) return null;
      if (!isResponse(response, id, operation))
        throw new DesktopError("invalid_response");
      if (!response.ok) throw new DesktopError(response.error.code);
      if (
        args.projectId !== undefined &&
        ("projectId" in response.data
          ? response.data.projectId
          : "id" in response.data
            ? response.data.id
            : undefined) !== args.projectId
      )
        throw new DesktopError("invalid_response");
      if (
        typeof args.contextId === "string" &&
        (!("contextId" in response.data) ||
          response.data.contextId !== args.contextId)
      )
        throw new DesktopError("invalid_response");
      return response.data;
    } catch (error) {
      if (error instanceof DesktopError) throw error;
      throw new DesktopError(
        isIpcError(error) ? error.code : "service_unavailable",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    health: () => request("health"),
    list: () => request("workspace.list"),
    addLocal: () => request("workspace.addLocal"),
    select: (projectId: string) => request("project.select", { projectId }),
    inspect: (projectId: string) => request("project.inspect", { projectId }),
    relocate: (projectId: string) => request("project.relocate", { projectId }),
    context: {
      browse: (projectId: string, folder: string, prefix: string) =>
        request("context.browse", { projectId, folder, prefix }),
      capture: (projectId: string, paths: string[]) =>
        request("context.capture", { projectId, paths }),
      list: (projectId: string, before: string | null = null) =>
        request("context.list", { projectId, before }),
      get: (projectId: string, contextId: string) =>
        request("context.get", { projectId, contextId }),
      validate: (projectId: string, contextId: string) =>
        request("context.validate", { projectId, contextId }),
      indexStatus: (projectId: string, contextId: string | null) =>
        request("context.indexStatus", { projectId, contextId }),
      index: (projectId: string, contextId: string, force: boolean) =>
        request("context.index", { projectId, contextId, force }),
      async search(projectId: string, input: ContextSearchInput) {
        const result = await request("context.search", { projectId, ...input });
        if (
          result.scope !== input.scope ||
          (result.nextOffset !== null &&
            result.nextOffset !== input.offset + contextSearchPageSize)
        )
          throw new DesktopError("invalid_response");
        return result;
      },
      async preview(
        projectId: string,
        { contextId, path, sha256, chunk }: ContextSourceRef,
      ) {
        const result = await request("context.sourcePreview", {
          projectId,
          contextId,
          path,
          sha256,
          chunk,
        });
        if (
          result.path !== path ||
          result.sha256 !== sha256 ||
          result.chunk !== chunk
        )
          throw new DesktopError("invalid_response");
        return result;
      },
    },
  };
}

const messages: Record<ErrorCode, string> = {
  invalid_request: "A solicitação é inválida. Tente novamente.",
  invalid_folder:
    "A pasta não existe ou está inacessível. Escolha outra pasta.",
  not_repository: "A pasta escolhida não pertence a um repositório Git.",
  git_missing:
    "Git não foi encontrado. Instale o Git, adicione-o ao PATH e reabra o Laplace.",
  permission_denied:
    "O Git não tem acesso a esta pasta. Verifique suas permissões e propriedade.",
  git_failed:
    "Não foi possível ler o estado do Git. Confira o repositório e tente novamente.",
  git_timeout:
    "O Git demorou para responder. Tente novamente em alguns instantes.",
  project_unavailable:
    "A pasta Git cadastrada está indisponível. Relocalize a pasta ou restabeleça o acesso e clique em Atualizar.",
  project_identity_mismatch:
    "Esta pasta pertence a outro checkout Git. Selecione a pasta original do projeto.",
  project_identity_unknown:
    "A identidade do checkout ainda não pôde ser confirmada. Restabeleça o acesso à pasta cadastrada e clique em Atualizar.",
  project_already_registered:
    "Esse checkout já está cadastrado. Abra o projeto correspondente na barra lateral para consultar ou relocalizar sua pasta.",
  catalog_unavailable:
    "O catálogo local está indisponível. Verifique o acesso aos dados do aplicativo e tente novamente.",
  dialog_failed: "Não foi possível abrir o seletor de pastas. Tente novamente.",
  service_unavailable: "O serviço local está indisponível. Tente reconectar.",
  ipc_timeout: "O serviço local demorou para responder. Tente novamente.",
  invalid_response:
    "O serviço local retornou uma resposta inválida. Tente novamente.",
  desktop_required: "Abra o aplicativo desktop para conectar ao serviço local.",
  context_not_found: "A captura não foi encontrada neste projeto.",
  context_path_unavailable: "A pasta está indisponível ou excluída da captura.",
  context_timeout: "O tempo de leitura do contexto esgotou. Tente novamente.",
  context_limit: "Os metadados excederam o limite do serviço local.",
  context_not_eligible:
    "Esta captura não tem fontes preservadas que possam ser indexadas.",
  context_not_indexed:
    "Esta captura ainda não tem índice. Indexe-a para pesquisar.",
  context_index_failed:
    "Falha ao gravar o índice da captura. Tente indexar novamente.",
  context_search_query:
    "Informe entre 1 e 12 termos de busca com letras ou números.",
  context_source_unavailable:
    "A fonte preservada está indisponível ou não passou na verificação de integridade.",
};

export function errorMessage(error: unknown): string {
  return messages[
    error instanceof DesktopError ? error.code : "service_unavailable"
  ];
}
