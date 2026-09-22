import type { ContextProvider } from "../context/evidence";
import { buildInvestigation, type Investigation } from "../context/investigation";
import { GdacsContextProvider } from "../context/providers/gdacs";
import { GdeltContextProvider } from "../context/providers/gdelt";
import type { CorrelatedEvent } from "../correlations/types";
import type { WorldSignal } from "../core/types";
import {
  getPersistedInvestigation,
  saveInvestigation,
} from "../database/investigations";
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
  // Injected providers are primarily deterministic test/preview inputs. They must
  // never be mixed with, or overwrite, the production investigation cache.
  if (providers) return buildSignalInvestigation(id, mode, providers);

  if (mode === "demo") return buildSignalInvestigation(id, mode, []);

  const cached = await getPersistedInvestigation("signal", id);
  if (cached) return cached;

  return refreshSignalInvestigation(id);
}

export async function refreshSignalInvestigation(
  id: string,
  options: { providers?: ContextProvider[]; ttlMs?: number; now?: Date } = {},
) {
  const investigation = await buildSignalInvestigation(
    id,
    "live",
    options.providers ?? DEFAULT_CONTEXT_PROVIDERS(),
  );
  if (!investigation) return null;
  await saveInvestigation("signal", investigation, {
    now: options.now,
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
  if (!options.forceRefresh) {
    const cached = await getPersistedInvestigation("correlated_event", event.id);
    if (cached) return cached;
  }
  const investigation = await buildInvestigation(event, {
    providers: options.providers ?? DEFAULT_CONTEXT_PROVIDERS(),
    signals,
    now: options.now,
  });
  await saveInvestigation("correlated_event", investigation, {
    now: options.now,
    ttlMs: options.ttlMs,
  });
  return investigation;
}
