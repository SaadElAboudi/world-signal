import type { ContextProvider } from "../context/evidence";
import {
  buildInvestigation,
  type Investigation,
} from "../context/investigation";
import { GdacsContextProvider } from "../context/providers/gdacs";
import { GdeltContextProvider } from "../context/providers/gdelt";
import type { CorrelatedEvent } from "../correlations/types";
import type { WorldSignal } from "../core/types";
import {
  getPersistedInvestigation,
  saveInvestigation,
} from "../database/investigations";
import { collectionGuard } from "./resource-budget";
import { getSignal } from "./snapshot";

const DEFAULT_CONTEXT_PROVIDERS = () => [
  new GdeltContextProvider(),
  new GdacsContextProvider(),
];

async function buildSignalInvestigation(
  id: string,
  mode: "demo" | "live",
  providers: ContextProvider[],
): Promise<Investigation | null> {
  const signal = await getSignal(id, mode);
  if (!signal) return null;
  return buildInvestigation(signal, {
    providers,
    signals: [signal],
  });
}

export async function getSignalInvestigation(
  id: string,
  mode: "demo" | "live",
  providers?: ContextProvider[],
) {
  // Injected providers are deterministic test/preview inputs and never consume production budgets.
  if (providers) return buildSignalInvestigation(id, mode, providers);
  if (mode === "demo") return buildSignalInvestigation(id, mode, []);

  const cached = await getPersistedInvestigation("signal", id, {
    allowStale: true,
  });
  if (cached) return cached;
  // Web requests never spend API quota or write with the reader role.
  return buildSignalInvestigation(id, mode, []);
}

export async function refreshSignalInvestigation(
  id: string,
  options: { providers?: ContextProvider[]; ttlMs?: number; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  if (!options.providers) {
    const guard = await collectionGuard("context", { now });
    if (!guard.allowed)
      return getPersistedInvestigation("signal", id, { allowStale: true, now });
  }
  const investigation = await buildSignalInvestigation(
    id,
    "live",
    options.providers ?? DEFAULT_CONTEXT_PROVIDERS(),
  );
  if (!investigation) return null;
  // Explicit providers remain ephemeral so fixtures can never overwrite production cache.
  if (options.providers) return investigation;
  await saveInvestigation("signal", investigation, {
    now,
    ttlMs: options.ttlMs,
  });
  return investigation;
}

export async function getCorrelatedEventInvestigation(
  event: CorrelatedEvent,
  signals: WorldSignal[],
  options: {
    providers?: ContextProvider[];
    forceRefresh?: boolean;
    ttlMs?: number;
    now?: Date;
  } = {},
) {
  if (options.providers) {
    return buildInvestigation(event, {
      providers: options.providers,
      signals,
      now: options.now,
    });
  }

  const now = options.now ?? new Date();
  if (!options.forceRefresh) {
    const cached = await getPersistedInvestigation(
      "correlated_event",
      event.id,
      { now },
    );
    if (cached) return cached;
  }

  const guard = await collectionGuard("context", { now });
  if (!guard.allowed) {
    const stale = await getPersistedInvestigation(
      "correlated_event",
      event.id,
      {
        allowStale: true,
        now,
      },
    );
    if (stale) return stale;
    return buildInvestigation(event, { providers: [], signals, now });
  }

  const investigation = await buildInvestigation(event, {
    providers: DEFAULT_CONTEXT_PROVIDERS(),
    signals,
    now,
  });
  await saveInvestigation("correlated_event", investigation, {
    now,
    ttlMs: options.ttlMs,
  });
  return investigation;
}
