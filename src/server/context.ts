import type { ContextProvider } from "../context/evidence";
import { buildInvestigation } from "../context/investigation";
import { GdeltContextProvider } from "../context/providers/gdelt";
import { getSignal } from "./snapshot";

export async function getSignalInvestigation(
  id: string,
  mode: "demo" | "live",
  providers?: ContextProvider[],
) {
  const signal = await getSignal(id, mode);
  if (!signal) return null;
  const activeProviders = providers ?? (mode === "live" ? [new GdeltContextProvider()] : []);
  return buildInvestigation(signal, {
    providers: activeProviders,
    signals: [signal],
  });
}
