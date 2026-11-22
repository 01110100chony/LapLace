import type {
  IdentityScope,
  Project,
  ProjectIdentityResult,
  ResumeSummary,
  SelectedProject,
} from "@laplace/contracts";

export function createLatestRequest() {
  let revision = 0;

  return {
    invalidate() {
      revision++;
    },
    async run<T>(
      request: (isCurrent: () => boolean) => Promise<T>,
      resolve: (value: T) => void,
      reject: (error: unknown) => void,
    ) {
      const current = ++revision;
      const isCurrent = () => current === revision;
      let value: T;
      try {
        value = await request(isCurrent);
      } catch (error) {
        if (isCurrent()) reject(error);
        return;
      }
      if (isCurrent()) resolve(value);
    },
  };
}

export function createProjectLoader(client: {
  select: (id: string) => Promise<SelectedProject>;
  inspect: (id: string) => Promise<Project>;
}) {
  const latest = createLatestRequest();
  let selectionQueue: Promise<unknown> = Promise.resolve();

  function persist<T>(write: () => Promise<T>) {
    const turn = selectionQueue.then(write);
    selectionQueue = turn.catch(() => {});
    return turn;
  }

  return {
    persist,
    invalidate: latest.invalidate,
    open(
      id: string,
      onCached: (project: SelectedProject) => void,
      onFresh: (project: Project) => void,
      onError: (error: unknown) => void,
    ) {
      return latest.run(
        async (isCurrent) => {
          // Selection writes follow the user's navigation order. Git reads
          // can finish independently without writing the selection back.
          const selected = await persist(() => client.select(id));
          if (!isCurrent()) return;
          onCached(selected);
          return client.inspect(id);
        },
        (project) => {
          if (project) onFresh(project);
        },
        onError,
      );
    },
  };
}

export function createResumeLoader(client: {
  select: (id: string) => Promise<SelectedProject>;
  identity: (id: string) => Promise<ProjectIdentityResult>;
  resume: (
    scope: IdentityScope,
    correlationId?: string,
  ) => Promise<ResumeSummary>;
}) {
  const latest = createLatestRequest();
  let selectionQueue: Promise<unknown> = Promise.resolve();
  let sequence = 0;

  function persist<T>(write: () => Promise<T>) {
    const turn = selectionQueue.then(write);
    selectionQueue = turn.catch(() => {});
    return turn;
  }

  return {
    persist,
    invalidate: latest.invalidate,
    open(
      legacyProjectId: string,
      onSelected: (selected: SelectedProject) => void,
      onIdentity: (identity: ProjectIdentityResult) => void,
      onResume: (summary: ResumeSummary) => void,
      onError: (error: unknown) => void,
    ) {
      const correlationId = `resume-${++sequence}`;
      return latest.run(
        async (isCurrent) => {
          const selected = await persist(() => client.select(legacyProjectId));
          if (!isCurrent()) return;
          onSelected(selected);
          const identity = await client.identity(legacyProjectId);
          if (!isCurrent()) return;
          onIdentity(identity);
          const summary = await client.resume(identity.scope, correlationId);
          if (!isCurrent()) return;
          return summary;
        },
        (summary) => {
          if (summary) onResume(summary);
        },
        onError,
      );
    },
  };
}
