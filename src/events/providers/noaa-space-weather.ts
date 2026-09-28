import { createHash } from "node:crypto";
import { fetchText } from "../../providers/http";
import type { EventProvider, EventSeverity, WorldEvent } from "../types";

type Alert = { product_id?: string; issue_datetime?: string; message?: string };
const severityFor = (k: number): EventSeverity => k >= 7 ? "significant" : k >= 6 ? "elevated" : "notable";

/** NOAA SWPC K-index alerts. A global space-weather observation, never a local outage claim. */
export class NoaaSpaceWeatherProvider implements EventProvider {
  id = "noaa-swpc";
  name = "NOAA SWPC";
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly endpoint = "https://services.swpc.noaa.gov/products/alerts.json") {}
  async fetchEvents(options: { now?: Date; limit?: number } = {}): Promise<WorldEvent[]> {
    const { text } = await fetchText(this.endpoint, { fetcher: this.fetcher, attempts: 2, timeoutMs: 15_000 });
    const now = options.now ?? new Date();
    const alerts = JSON.parse(text) as Alert[];
    const output: WorldEvent[] = [];
    for (const alert of alerts.slice(0, Math.max(1, Math.min(options.limit ?? 100, 500)))) {
      const message = alert.message ?? "";
      const match = /Geomagnetic K-index of\s+([5-9])\b/i.exec(message);
      const issued = alert.issue_datetime && Date.parse(alert.issue_datetime);
      if (!match || !issued || issued > now.getTime() + 60_000) continue;
      const k = Number(match[1]);
      const id = `noaa-swpc:${createHash("sha256").update(`${alert.product_id}:${issued}:${k}`).digest("hex").slice(0, 24)}`;
      output.push({ schemaVersion: 1, id, category: "earth_observation", type: "geomagnetic_storm", title: `Geomagnetic storm alert · Kp ${k}`, description: `NOAA SWPC issued a geomagnetic K-index alert at Kp ${k}. This is a global space-weather observation; it does not establish local disruption to power, aviation, navigation or communications.`, status: "active", severity: severityFor(k), confidence: 0.9, startedAt: new Date(issued).toISOString(), updatedAt: new Date(issued).toISOString(), endedAt: null, location: { latitude: 0, longitude: 0, geometryType: "point" }, magnitude: { value: k, unit: "Kp", description: "NOAA SWPC geomagnetic K-index threshold reached" }, source: { provider: this.id, name: this.name, url: "https://www.swpc.noaa.gov/products-and-data", upstreamId: alert.product_id ?? id }, secondarySources: [], properties: { globalScope: true, productId: alert.product_id ?? null, interpretation: "official_geomagnetic_alert_not_local_impact" } });
    }
    return output;
  }
}
