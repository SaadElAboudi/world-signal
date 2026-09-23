import type { NormalizedBatch } from "./contract";
export async function mapLimited<T, R>(
  items: readonly T[],
  concurrency: number,
  callback: (item: T) => Promise<R>,
) {
  const result: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        try {
          result[index] = {
            status: "fulfilled",
            value: await callback(items[index]),
          };
        } catch (reason) {
          result[index] = { status: "rejected", reason };
        }
      }
    }),
  );
  return result;
}
export interface ScopeCollection {
  id: string;
  label: string;
  ok: boolean;
  latestObservationAt: string | null;
  error: string | null;
}
export function combineBatches(
  batches: NormalizedBatch[],
  scopes: ScopeCollection[],
): NormalizedBatch {
  if (!batches.length) throw new Error("No usable source data");
  const sorted = batches.map((b) => b.sourceAsOf).sort();
  return {
    observations: batches.flatMap((b) => b.observations),
    received: batches.reduce((n, b) => n + b.received, 0),
    rejected: batches.reduce((n, b) => n + b.rejected, 0),
    sourceAsOf: sorted[sorted.length - 1],
    coverageStart: batches.map((b) => b.coverageStart).sort()[0],
    coverageEnd: batches
      .map((b) => b.coverageEnd)
      .sort()
      .at(-1)!,
    completeSnapshot: false,
    scopes,
  };
}
