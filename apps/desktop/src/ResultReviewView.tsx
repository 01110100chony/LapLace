import type {
  ResultReview,
  ReviewChoice,
  TaskRunRef,
} from "@laplace/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage, type createDesktopClient } from "./ipc";
import { createLatestRequest } from "./workspace";

type Client = ReturnType<typeof createDesktopClient>["execution"];
const choiceLabel: Record<ReviewChoice, string> = {
  approved: "Diff aprovado",
  rejected: "Diff recusado",
};

export function ResultReviewView({
  run,
  client,
}: {
  run: TaskRunRef;
  client: Client;
}) {
  const { projectId, taskId, executionId } = run;
  const [status, setStatus] = useState<ResultReview>();
  const [problem, setProblem] = useState("");
  const [pending, setPending] = useState(false);
  const [request] = useState(createLatestRequest);
  const retry = useRef<
    { id: string; revision: number; choice: ReviewChoice } | undefined
  >(undefined);

  const load = useCallback(() => {
    setPending(true);
    setProblem("");
    void request.run(
      () => client.reviewStatus({ projectId, taskId, executionId }),
      (current) => {
        setStatus(current);
        setPending(false);
      },
      (error) => {
        setProblem(errorMessage(error));
        setPending(false);
      },
    );
  }, [client, executionId, projectId, request, taskId]);

  useEffect(() => {
    load();
    return () => request.invalidate();
  }, [load, request]);

  function submit(choice: ReviewChoice) {
    if (!status || pending || status.latest?.choice === choice) return;
    const revision = status.latest?.revision ?? 0;
    if (retry.current?.revision !== revision || retry.current.choice !== choice)
      retry.current = { id: crypto.randomUUID(), revision, choice };
    const requestId = retry.current.id;
    setProblem("");
    setPending(true);
    void request.run(
      () =>
        client.review({
          projectId,
          taskId,
          executionId,
          requestId,
          expectedRevision: revision,
          expectedBase: status.evidence.resultDigest,
          choice,
        }),
      (latest) => {
        retry.current = undefined;
        setStatus({ ...status, latest });
        setPending(false);
      },
      (error) => {
        setProblem(errorMessage(error));
        setPending(false);
      },
    );
  }

  return (
    <section className="result-review" aria-label="Revisão do diff simulado">
      <h4>Revisão do diff simulado</h4>
      {status && (
        <>
          <p role="status">
            {status.latest
              ? choiceLabel[status.latest.choice]
              : "Aguardando revisão"}
          </p>
          <div className="context-toolbar">
            <button
              type="button"
              className="button"
              disabled={pending || status.latest?.choice === "approved"}
              onClick={() => submit("approved")}
            >
              Aprovar diff
            </button>
            <button
              type="button"
              className="button"
              disabled={pending || status.latest?.choice === "rejected"}
              onClick={() => submit("rejected")}
            >
              Recusar diff
            </button>
          </div>
        </>
      )}
      {problem && (
        <>
          <p role="alert" className="service-error">
            {problem}
          </p>
          <button
            type="button"
            className="text-button"
            disabled={pending}
            onClick={load}
          >
            Atualizar revisão
          </button>
        </>
      )}
    </section>
  );
}
