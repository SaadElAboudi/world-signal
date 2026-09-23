import {
  getStorageBudgetState,
  reserveApiBudget,
  type ApiBudgetDecision,
} from "../database/resource-governor";

export type BudgetedProvider =
  | "eonet"
  | "open-meteo"
  | "ioda"
  | "adsblol"
  | "entsoe"
  | "context";

const DEFAULT_LIMITS: Record<BudgetedProvider, { daily: number; monthly: number }> = {
  // Internal safety caps, deliberately below known/free usage envelopes when published.
  eonet: { daily: 200, monthly: 5_000 },
  "open-meteo": { daily: 5_000, monthly: 120_000 },
  ioda: { daily: 500, monthly: 14_000 },
  adsblol: { daily: 2_500, monthly: 70_000 },
  entsoe: { daily: 200, monthly: 5_000 },
  // GDELT + GDACS are counted together so investigations cannot create an unbounded fan-out.
  context: { daily: 2_500, monthly: 60_000 },
};

function envLimit(provider: BudgetedProvider, period: "DAILY" | "MONTHLY", fallback: number) {
  const key = `API_BUDGET_${provider.toUpperCase().replaceAll("-", "_")}_${period}`;
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function providerBudget(provider: BudgetedProvider) {
  const defaults = DEFAULT_LIMITS[provider];
  return {
    daily: envLimit(provider, "DAILY", defaults.daily),
    monthly: envLimit(provider, "MONTHLY", defaults.monthly),
  };
}

export async function reserveProviderCalls(
  provider: BudgetedProvider,
  requestedCalls: number,
  now = new Date(),
): Promise<ApiBudgetDecision> {
  return reserveApiBudget(provider, requestedCalls, providerBudget(provider), now);
}

export async function collectionGuard(
  provider: BudgetedProvider,
  requestedCalls: number,
  options: { storageSensitive?: boolean; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const storage = await getStorageBudgetState();
  if (options.storageSensitive && storage.pressure === "critical") {
    return {
      allowed: false as const,
      reason: "storage_critical" as const,
      storage,
      api: null,
    };
  }
  const api = await reserveProviderCalls(provider, requestedCalls, now);
  return {
    allowed: api.allowed,
    reason: api.allowed ? ("ok" as const) : ("api_budget" as const),
    storage,
    api,
  };
}
