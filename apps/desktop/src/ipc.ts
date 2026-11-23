import {
  isIdentityScope,
  isIpcError,
  isResponse,
  contextSearchPageSize,
  type AuditedQueryRunInput,
  type AuditReviewInput,
  type CodexExecution,
  type CodexPrepare,
  type CodexPreview,
  type CompilerCompileInput,
  type ContextSearchInput,
  type ContextSourceRef,
  type DecisionEvidenceInput,
  type DecisionPurgeInput,
  type DecisionRecordInput,
  type ErrorCode,
  type GrantIssueInput,
  type GrantRevokeInput,
  type HandoffImportInput,
  type IdentityScope,
  type McpCallInput,
  type Operation,
  type PackageExportInput,
  type ReviewInput,
  type Results,
  type TaskDraft,
  type TaskEdit,
  type TaskRunRef,
  type TaskScope,
  type TaskStart,
  type WorkingLayer,
  type WorkingRef,
} from "@laplace/contracts";

type DesktopCommand =
  | "service_health"
  | "workspace_list"
  | "workspace_add_local"
  | "clone_start"
  | "clone_status"
  | "clone_cancel"
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
  | "context_source_preview"
  | "codex_request"
  | "task_request"
  | "working_request"
  | "resume_request"
  | "compiler_request";
type PickerOperation =
  "workspace.addLocal" | "project.relocate" | "clone.start";
type DesktopOperation = Exclude<Operation, "codex.approval" | "clone.prepare">;
type InvokeArgs = Record<string, unknown>;
type Invoke = (command: DesktopCommand, args: InvokeArgs) => Promise<unknown>;

const commands: Record<DesktopOperation, DesktopCommand> = {
  health: "service_health",
  "workspace.list": "workspace_list",
  "workspace.addLocal": "workspace_add_local",
  "clone.start": "clone_start",
  "clone.status": "clone_status",
  "clone.cancel": "clone_cancel",
  "project.select": "project_select",
  "project.inspect": "project_inspect",
  "project.relocate": "project_relocate",
  "project.identity": "resume_request",
  "project.resume": "resume_request",
  "decision.evidenceResolve": "resume_request",
  "decision.comparePresent": "resume_request",
  "decision.record": "resume_request",
  "decision.list": "resume_request",
  "decision.get": "resume_request",
  "decision.purge": "resume_request",
  "compiler.compile": "compiler_request",
  "compiler.grantIssue": "compiler_request",
  "compiler.grantList": "compiler_request",
  "compiler.grantRevoke": "compiler_request",
  "compiler.packageExport": "compiler_request",
  "compiler.handoffImport": "compiler_request",
  "compiler.mcpCall": "compiler_request",
  "compiler.queryRun": "compiler_request",
  "compiler.auditList": "compiler_request",
  "compiler.auditReview": "compiler_request",
  "context.browse": "context_browse",
  "context.capture": "context_capture",
  "context.list": "context_list",
  "context.get": "context_get",
  "context.validate": "context_validate",
  "context.indexStatus": "context_index_status",
  "context.index": "context_index",
  "context.search": "context_search",
  "context.sourcePreview": "context_source_preview",
  "codex.status": "codex_request",
  "codex.prepare": "codex_request",
  "codex.start": "codex_request",
  "codex.events": "codex_request",
  "codex.cancel": "codex_request",
  "codex.history": "codex_request",
  "codex.citation": "codex_request",
  "task.list": "task_request",
  "task.create": "task_request",
  "task.update": "task_request",
  "task.start": "task_request",
  "execution.latest": "task_request",
  "execution.events": "task_request",
  "execution.cancel": "task_request",
  "execution.result": "task_request",
  "execution.change": "task_request",
  "result.reviewStatus": "task_request",
  "result.review": "task_request",
  "working.list": "working_request",
  "working.latest": "working_request",
  "working.capture": "working_request",
  "working.compare": "working_request",
};

export class DesktopError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(code);
    this.code = code;
  }
}

export function createDesktopClient(invoke: Invoke, deadlineMs = 20_000) {
  async function request<K extends PickerOperation>(
    operation: K,
    args?: InvokeArgs,
  ): Promise<Results[K] | null>;
  async function request<K extends Exclude<DesktopOperation, PickerOperation>>(
    operation: K,
    args?: InvokeArgs,
  ): Promise<Results[K]>;
  async function request<K extends DesktopOperation>(
    operation: K,
    args: InvokeArgs = {},
  ): Promise<Results[K] | null> {
    const id = crypto.randomUUID();
    const picker =
      operation === "workspace.addLocal" ||
      operation === "project.relocate" ||
      operation === "clone.start";
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const command = commands[operation];
      const call = invoke(
        command,
        command === "codex_request" ||
          command === "task_request" ||
          command === "working_request" ||
          command === "resume_request" ||
          command === "compiler_request"
          ? { id, request: { operation, ...args } }
          : { ...args, id },
      );
      // The native picker may stay open as long as the user needs.
      const response =
        picker || operation === "codex.start"
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
      if (operation === "project.identity") {
        const identity = response.data as Results["project.identity"];
        if (identity.legacyProjectId !== args.projectId)
          throw new DesktopError("invalid_response");
      } else if (
        typeof response.data === "object" &&
        response.data !== null &&
        "scope" in response.data &&
        isIdentityScope(response.data.scope)
      ) {
        if (
          (args.projectId !== undefined &&
            response.data.scope.projectId !== args.projectId) ||
          (args.bindingId !== undefined &&
            response.data.scope.bindingId !== args.bindingId) ||
          (args.worktreeId !== undefined &&
            response.data.scope.worktreeId !== args.worktreeId)
        )
          throw new DesktopError("invalid_response");
      } else if (
        args.projectId !== undefined &&
        ("projectId" in response.data
          ? response.data.projectId
          : "id" in response.data
            ? response.data.id
            : undefined) !== args.projectId
      ) {
        throw new DesktopError("invalid_response");
      }
      if (typeof args.contextId === "string") {
        if (operation === "decision.evidenceResolve") {
          const ev = (response.data as Results["decision.evidenceResolve"])
            .evidence;
          if (ev.ref !== null && ev.ref.contextId !== args.contextId)
            throw new DesktopError("invalid_response");
        } else if (operation === "decision.comparePresent") {
          const ev = (response.data as Results["decision.comparePresent"])
            .historical.evidence;
          if (ev.ref !== null && ev.ref.contextId !== args.contextId)
            throw new DesktopError("invalid_response");
        } else if (operation === "compiler.compile") {
          // Scope validation above already verifies IdentityScope on F2 compile responses.
        } else if (
          !("contextId" in response.data) ||
          response.data.contextId !== args.contextId
        ) {
          throw new DesktopError("invalid_response");
        }
      }
      if (
        typeof args.cloneId === "string" &&
        (!("cloneId" in response.data) ||
          response.data.cloneId !== args.cloneId)
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
    clone: {
      start: (url: string) => request("clone.start", { url }),
      status: (cloneId: string) => request("clone.status", { cloneId }),
      cancel: (cloneId: string) => request("clone.cancel", { cloneId }),
    },
    select: (projectId: string) => request("project.select", { projectId }),
    inspect: (projectId: string) => request("project.inspect", { projectId }),
    relocate: (projectId: string) => request("project.relocate", { projectId }),
    identity: (projectId: string, path?: string) =>
      request(
        "project.identity",
        path === undefined ? { projectId } : { projectId, path },
      ),
    async resume(scope: IdentityScope, correlationId?: string) {
      const payload =
        correlationId === undefined ? scope : { ...scope, correlationId };
      const summary = await request("project.resume", payload);
      if (
        correlationId !== undefined &&
        summary.correlationId !== correlationId
      )
        throw new DesktopError("invalid_response");
      return summary;
    },
    decisions: {
      async evidenceResolve(
        scope: IdentityScope,
        ref: Exclude<DecisionEvidenceInput, null>,
      ) {
        const result = await request("decision.evidenceResolve", {
          ...scope,
          ...ref,
        });
        if (
          result.evidence.ref !== null &&
          (result.evidence.ref.path !== ref.path ||
            result.evidence.ref.sha256 !== ref.sha256 ||
            result.evidence.ref.chunk !== ref.chunk)
        )
          throw new DesktopError("invalid_response");
        return result;
      },
      async comparePresent(
        scope: IdentityScope,
        ref: Exclude<DecisionEvidenceInput, null>,
      ) {
        const result = await request("decision.comparePresent", {
          ...scope,
          ...ref,
        });
        if (result.present.path !== ref.path)
          throw new DesktopError("invalid_response");
        return result;
      },
      async record(input: DecisionRecordInput) {
        const saved = await request("decision.record", input);
        if (
          (input.assertionId !== null &&
            saved.assertionId !== input.assertionId) ||
          saved.revision !== input.expectedRevision + 1 ||
          saved.author !== input.author
        )
          throw new DesktopError("invalid_response");
        return saved;
      },
      list: (scope: IdentityScope) => request("decision.list", scope),
      async get(scope: IdentityScope, assertionId: string) {
        const result = await request("decision.get", { ...scope, assertionId });
        if (result.assertionId !== assertionId)
          throw new DesktopError("invalid_response");
        return result;
      },
      async purge(input: DecisionPurgeInput) {
        const receipt = await request("decision.purge", input);
        if (receipt.assertionId !== input.assertionId)
          throw new DesktopError("invalid_response");
        return receipt;
      },
    },
    compiler: {
      compile: (input: CompilerCompileInput) =>
        request("compiler.compile", input),
      grantIssue: (input: GrantIssueInput) =>
        request("compiler.grantIssue", input),
      grantList: (scope: IdentityScope, manifestDigest?: string) =>
        request(
          "compiler.grantList",
          manifestDigest === undefined ? scope : { ...scope, manifestDigest },
        ),
      grantRevoke: (input: GrantRevokeInput) =>
        request("compiler.grantRevoke", input),
      packageExport: (input: PackageExportInput) =>
        request("compiler.packageExport", input),
      handoffImport: (input: HandoffImportInput) =>
        request("compiler.handoffImport", input),
      mcpCall: (input: McpCallInput) => request("compiler.mcpCall", input),
      queryRun: (input: AuditedQueryRunInput) =>
        request("compiler.queryRun", input),
      auditList: (scope: IdentityScope, manifestDigest?: string) =>
        request(
          "compiler.auditList",
          manifestDigest === undefined ? scope : { ...scope, manifestDigest },
        ),
      auditReview: (input: AuditReviewInput) =>
        request("compiler.auditReview", input),
    },
    working: {
      list: (projectId: string) => request("working.list", { projectId }),
      latest: (projectId: string) => request("working.latest", { projectId }),
      async capture(projectId: string, paths: string[]) {
        const snapshot = await request("working.capture", { projectId, paths });
        if (
          snapshot.files.length !== paths.length ||
          !snapshot.files.every(({ path }) => paths.includes(path))
        )
          throw new DesktopError("invalid_response");
        return snapshot;
      },
      async compare(
        { projectId, snapshotId }: WorkingRef,
        path: string,
        layer: WorkingLayer,
      ) {
        const result = await request("working.compare", {
          projectId,
          snapshotId,
          path,
          layer,
        });
        if (
          result.snapshotId !== snapshotId ||
          result.path !== path ||
          result.layer !== layer
        )
          throw new DesktopError("invalid_response");
        return result;
      },
    },
    task: {
      list: (projectId: string, before: string | null = null) =>
        request("task.list", { projectId, before }),
      async create(draft: TaskDraft) {
        const task = await request("task.create", draft);
        if (
          task.taskId !== draft.taskId ||
          task.source?.contextId !== draft.source?.contextId ||
          task.source?.executionId !== draft.source?.executionId
        )
          throw new DesktopError("invalid_response");
        return task;
      },
      async update(edit: TaskEdit) {
        const task = await request("task.update", edit);
        if (
          task.taskId !== edit.taskId ||
          task.revision !== edit.expectedRevision + 1 ||
          task.title !== edit.title.trim() ||
          task.objective !== edit.objective.trim()
        )
          throw new DesktopError("invalid_response");
        return task;
      },
    },
    execution: {
      async latest({ projectId, taskId }: TaskScope) {
        const status = await request("execution.latest", { projectId, taskId });
        if (status.taskId !== taskId)
          throw new DesktopError("invalid_response");
        return status;
      },
      async start(input: TaskStart) {
        const run = await request("task.start", input);
        if (
          run.taskId !== input.taskId ||
          run.requestId !== input.requestId ||
          run.taskRevision !== input.expectedRevision
        )
          throw new DesktopError("invalid_response");
        return run;
      },
      async events(
        { projectId, taskId, executionId }: TaskRunRef,
        afterSeq: number,
      ) {
        const page = await request("execution.events", {
          projectId,
          taskId,
          executionId,
          afterSeq,
        });
        if (
          page.taskId !== taskId ||
          page.executionId !== executionId ||
          page.nextSeq !== afterSeq + page.events.length
        )
          throw new DesktopError("invalid_response");
        return page;
      },
      async cancel({ projectId, taskId, executionId }: TaskRunRef) {
        const run = await request("execution.cancel", {
          projectId,
          taskId,
          executionId,
        });
        if (run.taskId !== taskId || run.executionId !== executionId)
          throw new DesktopError("invalid_response");
        return run;
      },
      async result({ projectId, taskId, executionId }: TaskRunRef) {
        const result = await request("execution.result", {
          projectId,
          taskId,
          executionId,
        });
        if (result.taskId !== taskId || result.executionId !== executionId)
          throw new DesktopError("invalid_response");
        return result;
      },
      async change(
        { projectId, taskId, executionId }: TaskRunRef,
        path: string,
      ) {
        const preview = await request("execution.change", {
          projectId,
          taskId,
          executionId,
          path,
        });
        if (
          preview.taskId !== taskId ||
          preview.executionId !== executionId ||
          preview.change.path !== path
        )
          throw new DesktopError("invalid_response");
        return preview;
      },
      async reviewStatus({ projectId, taskId, executionId }: TaskRunRef) {
        const status = await request("result.reviewStatus", {
          projectId,
          taskId,
          executionId,
        });
        if (status.taskId !== taskId || status.executionId !== executionId)
          throw new DesktopError("invalid_response");
        return status;
      },
      async review(input: ReviewInput) {
        const saved = await request("result.review", input);
        if (
          saved.taskId !== input.taskId ||
          saved.executionId !== input.executionId ||
          saved.choice !== input.choice ||
          saved.revision !== input.expectedRevision + 1 ||
          saved.evidence.resultDigest !== input.expectedBase
        )
          throw new DesktopError("invalid_response");
        return saved;
      },
    },
    codex: {
      status: (projectId: string) => request("codex.status", { projectId }),
      async prepare(input: CodexPrepare) {
        const preview = await request("codex.prepare", input);
        if (
          preview.snapshotDigest !== input.snapshotDigest ||
          preview.question !== input.question ||
          preview.sources.length !== input.selection.length ||
          !input.selection.every((item) =>
            preview.sources.some(
              (source) =>
                source.path === item.path &&
                source.sha256 === item.sha256 &&
                source.chunk === item.chunk,
            ),
          )
        )
          throw new DesktopError("invalid_response");
        return preview;
      },
      async start({
        projectId,
        contextId,
        grantId,
        manifestDigest,
        mode,
      }: CodexPreview) {
        const execution = await request("codex.start", {
          projectId,
          contextId,
          grantId,
          manifestDigest,
        });
        if (
          execution.manifestDigest !== manifestDigest ||
          execution.mode !== mode
        )
          throw new DesktopError("invalid_response");
        return execution;
      },
      async events(
        {
          projectId,
          contextId,
          executionId,
          manifestDigest,
          mode,
        }: CodexExecution,
        afterSeq: number,
      ) {
        const page = await request("codex.events", {
          projectId,
          contextId,
          executionId,
          afterSeq,
        });
        if (
          page.executionId !== executionId ||
          page.manifestDigest !== manifestDigest ||
          page.mode !== mode ||
          page.nextSeq !== afterSeq + page.events.length ||
          (page.more && !page.events.length)
        )
          throw new DesktopError("invalid_response");
        return page;
      },
      cancel: ({ projectId, contextId, executionId }: CodexExecution) =>
        request("codex.cancel", { projectId, contextId, executionId }),
      history: (projectId: string, contextId: string, before: string | null) =>
        request("codex.history", { projectId, contextId, before }),
      async citation(
        {
          projectId,
          contextId,
          executionId,
          manifestDigest,
          mode,
        }: CodexExecution,
        sourceId: string,
      ) {
        const citation = await request("codex.citation", {
          projectId,
          contextId,
          executionId,
          sourceId,
        });
        if (
          citation.executionId !== executionId ||
          citation.manifestDigest !== manifestDigest ||
          citation.mode !== mode ||
          citation.source.id !== sourceId
        )
          throw new DesktopError("invalid_response");
        return citation;
      },
    },
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
  clone_unavailable:
    "O clone está indisponível. Tente iniciar uma nova operação.",
  clone_busy: "Aguarde ou cancele o clone em andamento.",
  clone_failed:
    "O Git não conseguiu clonar. Confira o endereço, a conexão e o acesso ao repositório.",
  clone_timeout: "O clone excedeu o tempo limite.",
  clone_destination_exists:
    "Já existe uma pasta ou arquivo nesse destino. Escolha outra pasta-pai.",
  clone_destination_changed:
    "A pasta de destino mudou durante a operação. Selecione o destino novamente.",
  clone_registration_failed:
    "O clone foi baixado. Adicione a pasta ao catálogo pelo fluxo de projeto local.",
  clone_cleanup_pending: "A limpeza da pasta temporária ficou pendente.",
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
  project_identity_ambiguous:
    "A identidade do repositório apresentou múltiplos vínculos candidatos. Confirme explicitamente antes de retomar.",
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
  codex_selection_invalid:
    "A seleção ou o digest da captura não corresponde às fontes preservadas.",
  codex_authorization_required:
    "Autorize o envio a partir de uma prévia válida.",
  codex_unavailable:
    "A consulta está indisponível. Verifique a instalação, a autenticação e o confinamento.",
  codex_busy: "Aguarde ou cancele a consulta em andamento.",
  codex_execution_unavailable:
    "A execução não está disponível no serviço atual. Prepare uma nova tentativa.",
  task_unavailable: "A tarefa não está disponível neste projeto.",
  task_conflict:
    "A tarefa mudou ou já foi criada. Atualize a lista e reabra a tarefa.",
  task_busy: "Há uma tarefa em andamento no Laplace.",
  task_runner_unavailable:
    "A execução de tarefas está indisponível neste modo.",
  task_execution_unavailable:
    "A tentativa não está disponível para esta tarefa.",
  task_result_unavailable:
    "O diff não está disponível ou não passou na verificação de integridade.",
  working_changed:
    "O estado Git mudou durante a captura. Atualize a lista e refaça a seleção.",
  working_unavailable:
    "A captura Git está indisponível ou não passou na verificação de integridade.",
  working_conflict:
    "O caminho está em conflito. Consulte os estágios do índice na captura.",
  result_review_conflict:
    "A revisão ou a evidência mudou. Atualize a revisão antes de registrar outra decisão.",
  decision_unavailable:
    "A decisão solicitada não está disponível neste escopo.",
  decision_conflict:
    "A decisão mudou desde a última leitura. Atualize o painel antes de salvar outra revisão.",
  decision_authorization_required:
    "A gravação ou alteração de decisão exige confirmação humana explícita.",
  decision_purge_pending:
    "A exclusão da decisão ficou pendente e precisa ser concluída antes de reabrir o conteúdo.",
  resume_stale: "A leitura da retomada ficou obsoleta após a troca de projeto.",
  compiler_invalid_input:
    "A compilação ou concessão F2 contém entrada inválida ou orçamento insuficiente para itens obrigatórios.",
  destination_unknown:
    "Destino desconhecido; nenhuma concessão ou entrega de contexto pode ser autorizada.",
  destination_denied:
    "Este destino não está autorizado ou exige confinamento estrito ainda bloqueado.",
  grant_invalid:
    "O SessionGrant informado não corresponde ao escopo, sessão, manifesto ou operação.",
  grant_revoked:
    "O SessionGrant foi revogado e não autoriza mais nenhuma leitura.",
  grant_expired: "O SessionGrant expirou; emita uma nova concessão explícita.",
  handoff_invalid:
    "O ContextPackage ou handoff falhou na validação de integridade ou escopo.",
  audit_unavailable:
    "O registro de auditoria solicitado não está disponível neste escopo.",
  context_source_unavailable:
    "A fonte preservada está indisponível ou não passou na verificação de integridade.",
};

export function errorMessage(error: unknown): string {
  return messages[
    error instanceof DesktopError ? error.code : "service_unavailable"
  ];
}
