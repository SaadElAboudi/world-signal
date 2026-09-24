import { createBudgetedFetch } from "../../server/budgeted-fetch";
import { getConfig } from "../../server/config";
import { DataError, errorCode } from "../../server/log";
import { fetchText } from "../http";
import type {
  FetchContext,
  NormalizedBatch,
  ObservationProvider,
  RawBatch,
} from "../contract";
import { combineBatches, mapLimited, type ScopeCollection } from "../batch";
import countries from "../countries.json";
import { normalizeIodaSeries } from "./normalize";
export const DEFAULT_INTERNET_COUNTRIES =
  "FR,GB,DE,ES,IT,NL,PL,UA,TR,IR,IL,SA,AE,IN,PK,BD,CN,JP,KR,ID,TH,VN,AU,NZ,US,CA,MX,BR,AR,CL,CO,PE,ZA,NG,KE,EG,MA,ET,SD,MM";
export function internetCountries() {
  const codes = (getConfig().internetCountries || DEFAULT_INTERNET_COUNTRIES)
    .split(",")
    .map((v) => v.trim().toUpperCase());
  return [...new Set(codes)].map((code) => {
    const country = countries.find((c) => c.code === code);
    if (!country) throw new DataError("invalid_country_configuration");
    return country;
  });
}
export class IodaProvider implements ObservationProvider<NormalizedBatch> {
  id = "ioda";
  name = "IODA · active probing";
  type = "internet" as const;
  constructor(
    private readonly options: {
      fetcher?: typeof fetch;
      now?: () => number;
    } = {},
  ) {}
  async fetchRawData(
    context: FetchContext,
  ): Promise<RawBatch<NormalizedBatch>> {
    const until = Math.floor(context.now.getTime() / 3600000) * 3600;
    const from = until - (context.history ? 32 * 24 : 4) * 3600;
    const configured = internetCountries();
    const clock = this.options.now ?? Date.now;
    const deadline = clock() + 90_000;
    const fetcher = this.options.fetcher ?? createBudgetedFetch("ioda");
    const results = await mapLimited(configured, 4, async (country) => {
      const remaining = deadline - clock();
      if (remaining <= 0) throw new DataError("collection_time_budget");
      const url = new URL(
        `https://api.ioda.inetintel.cc.gatech.edu/v2/signals/raw/country/${country.code}`,
      );
      url.search = new URLSearchParams({
        from: String(from),
        until: String(until),
        datasource: "ping-slash24",
        maxPoints: String((until - from) / 3600),
      }).toString();
      const { text } = await fetchText(url.toString(), {
        timeoutMs: Math.min(12000, remaining),
        // Forty countries must not spend four minutes retrying an unavailable API.
        // Failed scopes retain their prior observations; the next pass retries them.
        attempts: 1,
        fetcher,
      });
      const envelope = JSON.parse(text);
      if (envelope.error || !Array.isArray(envelope.data))
        throw new DataError("invalid_ioda_response");
      const series = envelope.data
        .flat()
        .find((s: { datasource?: string }) => s?.datasource === "ping-slash24");
      if (!series || series.step !== 3600)
        throw new DataError("unexpected_sampling_interval");
      const batch = normalizeIodaSeries(
        series,
        country,
        context.now.toISOString(),
      );
      // Timestamp is the beginning of an hourly mean; only closed buckets enter analysis.
      batch.observations = batch.observations.filter(
        (o) => Date.parse(o.timestamp) + 3600000 <= until * 1000,
      );
      if (!batch.observations.length)
        throw new DataError("no_recent_measurements");
      batch.sourceAsOf = batch.observations.at(-1)!.timestamp;
      return batch;
    });
    const scopes: ScopeCollection[] = results.map((r, i) => ({
      id: configured[i].code,
      label: configured[i].name,
      ok: r.status === "fulfilled",
      latestObservationAt: r.status === "fulfilled" ? r.value.sourceAsOf : null,
      error: r.status === "rejected" ? errorCode(r.reason) : null,
    }));
    const batches = results.flatMap((r) =>
      r.status === "fulfilled" ? [r.value] : [],
    );
    if (!batches.length) throw new DataError("all_scopes_unavailable");
    const data = combineBatches(batches, scopes);
    return {
      data,
      fetchedAt: context.now.toISOString(),
      sourceAsOf: data.sourceAsOf,
      coverageStart: data.coverageStart,
      coverageEnd: data.coverageEnd,
      sourceUrl: "https://ioda.inetintel.cc.gatech.edu/",
    };
  }
  normalize(raw: RawBatch<NormalizedBatch>) {
    return raw.data;
  }
}
