import type { Project, SelectedProject } from "@laplace/contracts";

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
