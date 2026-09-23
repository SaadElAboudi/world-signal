import { demoSnapshot } from "./demo";
import { correlate } from "../correlations/engine";
import { scopeForSignal } from "../correlations/geography";
const providerIds = {
  internet: "ioda",
  aviation: "adsblol",
  earthquake: "usgs",
  wildfire: "firms",
};
export const demoCorrelations = correlate(
  demoSnapshot.signals.map((signal) => ({
    signal,
    providerId: providerIds[signal.type],
    scope: scopeForSignal(signal),
    recordedAt: signal.timestamp,
  })),
  { asOf: demoSnapshot.asOf, windowHours: 6 },
).events;
