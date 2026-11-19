import {
  isIpcError,
  isResponse,
  type ErrorCode,
  type Operation,
  type Results,
} from "@laplace/contracts";

type DesktopCommand =
  | "service_health"
  | "workspace_list"
  | "workspace_add_local"
  | "project_inspect";
type Invoke = (
  command: DesktopCommand,
  args: Record<string, string>,
) => Promise<unknown>;

const commands: Record<Operation, DesktopCommand> = {
  health: "service_health",
  "workspace.list": "workspace_list",
  "workspace.addLocal": "workspace_add_local",
  "project.inspect": "project_inspect",
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
    operation: "workspace.addLocal",
  ): Promise<Results["workspace.addLocal"] | null>;
  async function request<K extends Exclude<Operation, "workspace.addLocal">>(
    operation: K,
    args?: Record<string, string>,
  ): Promise<Results[K]>;
  async function request<K extends Operation>(
    operation: K,
    args: Record<string, string> = {},
  ): Promise<Results[K] | null> {
    const id = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const call = invoke(commands[operation], { ...args, id });
      // The native picker may stay open as long as the user needs.
      const response =
        operation === "workspace.addLocal"
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
      if (response === null && operation === "workspace.addLocal") return null;
      if (!isResponse(response, id, operation))
        throw new DesktopError("invalid_response");
      if (!response.ok) throw new DesktopError(response.error.code);
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
    inspect: (projectId: string) => request("project.inspect", { projectId }),
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
    "A pasta Git cadastrada está indisponível. Restabeleça o acesso à pasta original e clique em Atualizar.",
  catalog_unavailable:
    "O catálogo local está indisponível. Verifique o acesso aos dados do aplicativo e tente novamente.",
  dialog_failed: "Não foi possível abrir o seletor de pastas. Tente novamente.",
  service_unavailable: "O serviço local está indisponível. Tente reconectar.",
  ipc_timeout: "O serviço local demorou para responder. Tente novamente.",
  invalid_response:
    "O serviço local retornou uma resposta inválida. Tente novamente.",
  desktop_required: "Abra o aplicativo desktop para conectar ao serviço local.",
};

export function errorMessage(error: unknown): string {
  return messages[
    error instanceof DesktopError ? error.code : "service_unavailable"
  ];
}
