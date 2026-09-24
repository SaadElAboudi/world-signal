import { DataError } from "./log";
import { reserveProviderCalls, type BudgetedProvider } from "./resource-budget";
import { getPool } from "../database/client";

export function createBudgetedFetch(
  provider: BudgetedProvider,
  dependencies: {
    fetcher?: typeof fetch;
    reserve?: (units: number) => Promise<{ allowed: boolean }>;
    cooldown?: () => Promise<boolean>;
    defer?: (until: Date) => Promise<void>;
    now?: () => number;
  } = {},
): typeof fetch {
  const now = dependencies.now ?? Date.now;
  const reserve =
    dependencies.reserve ?? ((units) => reserveProviderCalls(provider, units));
  const cooldown =
    dependencies.cooldown ??
    (async () => {
      const result = await getPool().query(
        "SELECT 1 FROM api_cooldowns WHERE provider=$1 AND retry_at>now()",
        [provider],
      );
      return result.rowCount !== 0;
    });
  const defer =
    dependencies.defer ??
    (async (until: Date) => {
      await getPool().query(
        `INSERT INTO api_cooldowns(provider,retry_at) VALUES($1,$2)
       ON CONFLICT(provider) DO UPDATE SET retry_at=GREATEST(api_cooldowns.retry_at,EXCLUDED.retry_at)`,
        [provider, until],
      );
    });
  return async (input, init) => {
    if (await cooldown()) throw new DataError("provider_cooldown");
    // Multi-coordinate weather queries are charged conservatively per location.
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    const locations =
      provider === "open-meteo"
        ? (url.searchParams.get("latitude")?.split(",").length ?? 1)
        : 1;
    // Long archive requests have greater upstream weight than a daily forecast.
    const start = Date.parse(url.searchParams.get("start_date") ?? "");
    const end = Date.parse(url.searchParams.get("end_date") ?? "");
    const days =
      Number.isFinite(start) && Number.isFinite(end)
        ? Math.max(1, (end - start) / 86400000 + 1)
        : 1;
    const units = locations * Math.max(1, Math.ceil(days / 14));
    if (!(await reserve(units)).allowed)
      throw new DataError("api_budget_exhausted");
    const response = await (dependencies.fetcher ?? fetch)(input, init);
    if (response.status === 429) {
      const raw = response.headers.get("retry-after");
      const seconds = raw === null ? NaN : Number(raw);
      const until = Number.isFinite(seconds)
        ? now() + seconds * 1000
        : Date.parse(raw ?? "");
      // No early retry, including across worker restarts. Default: one hour.
      await defer(
        new Date(
          Math.max(
            now() + 60_000,
            Number.isFinite(until) ? until : now() + 3600_000,
          ),
        ),
      );
    }
    return response;
  };
}
