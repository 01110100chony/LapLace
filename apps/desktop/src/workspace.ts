export function createLatestRequest() {
  let revision = 0;

  return {
    invalidate() {
      revision++;
    },
    async run<T>(
      request: () => Promise<T>,
      resolve: (value: T) => void,
      reject: (error: unknown) => void,
    ) {
      const current = ++revision;
      let value: T;
      try {
        value = await request();
      } catch (error) {
        if (current === revision) reject(error);
        return;
      }
      if (current === revision) resolve(value);
    },
  };
}
