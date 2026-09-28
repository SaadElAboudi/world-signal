import { createHash } from "node:crypto";
import { fetchText } from "../../providers/http";
import type { EventProvider, EventSeverity, WorldEvent } from "../types";
const decode = (value: string) => value.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const tag = (xml: string, name: string) => new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i").exec(xml)?.[1];
function severity(category: string): EventSeverity | null { const value = category.toLowerCase(); return value.includes("warning") ? "significant" : value.includes("advisory") ? "elevated" : value.includes("watch") || value.includes("threat") ? "notable" : null; }
/** Official NTWC Atom feed. Information statements are deliberately excluded. */
export class NoaaTsunamiProvider implements EventProvider {
  id = "noaa-tsunami"; name = "NOAA Tsunami Warning Centers";
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly endpoint = "https://www.tsunami.gov/events/xml/PAAQAtom.xml") {}
  async fetchEvents(options: { now?: Date; limit?: number } = {}): Promise<WorldEvent[]> {
    const { text } = await fetchText(this.endpoint, { fetcher: this.fetcher, attempts: 2, timeoutMs: 15_000 });
    const now = options.now ?? new Date(), output: WorldEvent[] = [];
    for (const entry of text.match(/<entry>[\s\S]*?<\/entry>/gi) ?? []) {
      const summary = decode(tag(entry, "summary") ?? ""), category = /Category:\s*([^<\n]+)/i.exec(summary)?.[1] ?? "";
      const level = severity(category), updated = tag(entry, "updated"), title = decode(tag(entry, "title") ?? "Tsunami bulletin");
      const latitude = Number(tag(entry, "geo:lat")), longitude = Number(tag(entry, "geo:long"));
      if (!level || !updated || !Number.isFinite(Date.parse(updated)) || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
      const upstream = tag(entry, "id") ?? `${title}:${updated}`;
      const id = `noaa-tsunami:${createHash("sha256").update(upstream).digest("hex").slice(0, 24)}`;
      output.push({ schemaVersion: 1, id, category: "natural_hazard", type: "tsunami", title: `Tsunami ${category} · ${title}`, description: `Official NOAA Tsunami Warning Center bulletin. Refer to the original bulletin for affected areas, arrival times and instructions.`, status: "active", severity: level, confidence: 0.95, startedAt: new Date(updated).toISOString(), updatedAt: new Date(updated).toISOString(), endedAt: null, location: { latitude, longitude, geometryType: "point" }, magnitude: { value: null, unit: null, description: null }, source: { provider: this.id, name: this.name, url: "https://www.tsunami.gov/", upstreamId: upstream }, secondarySources: [], properties: { category, officialAlert: true } });
    }
    return output.slice(0, Math.max(1, Math.min(options.limit ?? 100, 500)));
  }
}
