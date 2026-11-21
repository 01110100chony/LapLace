import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTemporaryWorkspace } from "./temporary-workspace.ts";

export async function prepareMockOutput(
  protectedRoots: string[],
  signal: AbortSignal,
) {
  return withTemporaryWorkspace("task", protectedRoots, async (workspace) => {
    signal.throwIfAborted();
    const path = "resultado.txt";
    const file = join(workspace, path);
    await writeFile(file, "Resultado inicial da simulação.\n", {
      flag: "wx",
      mode: 0o600,
      signal,
    });
    const before = await readFile(file, { signal });
    await writeFile(file, "Execução simulada concluída.\n", { signal });
    const after = await readFile(file, { signal });
    signal.throwIfAborted();
    return { path, before, after };
  });
}
