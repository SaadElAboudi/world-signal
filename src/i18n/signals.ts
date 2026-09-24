import type { WorldSignal } from "../core/types";
import type { Locale } from "./context";

export function signalTitle(signal: WorldSignal, locale: Locale) {
  if (locale === "en") return signal.title;
  if (signal.kind === "earthquake-event")
    return `Séisme · magnitude ${(signal.magnitude ?? signal.observedValue).toLocaleString("fr-FR")}`;
  if (signal.status === "recovering")
    return "Retour vers l’activité de référence";
  if (signal.status === "resolved") return "Activité revenue dans les seuils";
  return {
    earthquake: "Activité sismique inhabituelle",
    wildfire: "Détections thermiques inhabituelles",
    internet: "Baisse de connectivité observée",
    aviation: "Baisse du trafic aérien observé",
  }[signal.type];
}
