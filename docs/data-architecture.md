# Phase 2 data foundation

## Data flow

Public feeds → provider validation/normalization → PostgreSQL observations and collection coverage → deterministic baseline/signal computation → stored evidence → filtered Next.js API → existing globe UI.

`src/providers/contract.ts` separates raw batches and observations from user-facing `WorldSignal` records. A provider implements fetching and normalization. Add future providers through `src/server/ingestion.ts`, explicit health budgets and an appropriate statistical rule; do not reuse fire thresholds for unrelated phenomena.

## Persistence and scheduling

Versioned, checksummed SQL migrations create `observations`, `provider_runs`, `signals`, `signal_evidence` and `provider_registry`. Observations preserve source IDs, coordinates, timestamps, quality, H3 cell, source URL and provider-specific properties. Signal payloads are materialized independently; evidence snapshots retain the calculation inputs and source observation ID samples. Indexed provider/time/cell, signal type/severity/time and coordinate fields support the current workload. All instants use UTC and PostgreSQL `timestamptz`.

Stable observation identities and guarded upserts make repeats idempotent and permit upstream revisions. A staged batch is transactional. Complete successful feeds retract missing observations only within their covered interval and only when their source version is not newer. Invalid records fail the batch instead of silently claiming complete coverage. Failed fetches retain previous data and cannot resolve its signals.

PostgreSQL advisory locks prevent concurrent collections of the same provider and concurrent signal recomputations. Collection runs record timestamps, counts, coverage, status and sanitized errors. Analysis completion/error timestamps are tracked separately so a successful fetch cannot disguise a broken analysis pipeline. Signal persistence and evidence updates are transactional; signals absent from a successful current computation are marked resolved, not deleted. Stored signal history begins when this installation starts computing: observation backfill does not manufacture a historical signal archive.

The scheduler checks every minute, collecting USGS every five minutes and FIRMS every sixty minutes by default. Daily wider downloads repair recent gaps. Computation runs every five minutes. HTTP requests use bounded response sizes, timeouts, three attempts and exponential retry for transient failures, honoring bounded `Retry-After`. Long rate limits defer to a later run. A crashed run may remain recorded as running, but its session lock is released; subsequent worker runs can recover. Monitor status and process logs externally in production.

## Earthquake rules

USGS daily/monthly GeoJSON is validated before storage. Missing magnitude/depth remains null; non-earthquake/deleted records are excluded from analysis. Reviewed events have higher data-quality weight than preliminary events.

Individual events qualify at M ≥ 5, significance ≥ 600, or M ≥ 4.5 with depth ≤ 70 km. Elevated defaults are M ≥ 5.5/significance ≥ 750; significant defaults M ≥ 6/significance ≥ 1000. These are event-selection heuristics, not impact predictions. An individual event has no fabricated historical expected magnitude: its reference is N/A.

Regional clusters use H3 resolution 2, earthquakes M ≥ 2.5 and six-hour count windows, up to 120 prior covered windows. Require at least 14 covered reference windows, 20 historical events, five current events and twice the historical mean. Population z-score thresholds 2/3/4 map to notable/elevated/significant. Undefined or zero-variance z-scores do not produce an anomaly. Catalog completeness varies geographically; this simple reference does not correct for regional network sensitivity or aftershock dependence.

## Fire rules

Use only NOAA-20 VIIRS to avoid changing detection counts by mixing satellites. Public CSV confidence values (`low`, `nominal`, `high`) and API abbreviations are normalized; low-confidence detections are stored but excluded from cluster counts. Negative FRP is preserved as raw metadata and represented as unknown in the normalized value.

H3 resolution 3 groups detections into cells (roughly 12,000 km² on average, varying geographically). Cell centroids and coarse country polygons provide a navigation label, not an incident location or fire perimeter. Cross-border cells may contain detections from multiple countries.

Compare a current 24-hour count to up to 30 preceding aligned 24-hour windows. The analysis cutoff lags the feed timestamp by three hours by default to reduce late-reporting effects. A reference window is usable only when its whole interval is covered by successful collection ranges. Require at least five reference windows, 20 historical detections and 20 current detections. Count/mean ratios 2/3/4 map to notable/elevated/significant. A zero reference denominator is not converted to infinity; there is no ratio signal without a supported denominator.

A short history is explicitly provisional, with the actual window count in the UI. Seven-day bootstrap is not a 30-day or seasonal baseline. Satellite overpass patterns, clouds, industrial heat sources, repeat detections and reporting delays limit interpretation. FRP is summed over available qualified detections as evidence only: it is neither unique fire power nor burned area. Successful feed coverage establishes reporting coverage, not perfect physical observation; zero reported detections is not proof of no fire.

## Confidence and evidence

Confidence is a reproducible quality index: 30% source quality, 15% observation support, 30% historical coverage, 10% baseline stability and 15% freshness. Short cluster references with less than half the target history are capped at 0.55. Labels are LOW below 0.60, MEDIUM below 0.80 and HIGH otherwise. Individual earthquake events use a separate review-status index: 0.85 for reviewed and 0.65 for preliminary, because historical comparison is inapplicable. These labels are not calibrated incident probabilities and do not measure severity.

Evidence includes window bounds, observed/expected values, reference sample count/target, ratio or z-score, thresholds, source timestamps, quality distribution, available FRP and up to 20 observation IDs. In the full-storage profile, full observations remain queryable in PostgreSQL. The optional compact hosted profile retains recent raw samples plus exact hourly aggregates; see [hosted operation](hosted-operations.md). Context is deterministic and factual; no LLM, causal inference or composite global threat score is used.

## API, freshness and failure semantics

`src/server/query.ts` validates filters; SQL values are parameterized. Responses are bounded (250 default, 500 maximum) and cached in-process for 15 seconds with a bounded key count. The UI announces truncation. The cache is intentionally per web instance; no distributed invalidation is claimed.

Collection/source freshness defaults to 20 minutes for USGS and 240 minutes for FIRMS, with an additional twelve-hour latest-observation budget for FIRMS. Analysis older than fifteen minutes, absent or failed downgrades an otherwise healthy live snapshot. Provider health distinguishes unavailable credentials, errors and delayed sources. The client preserves previously received real signals after a transport failure and marks the display delayed. Database failure returns an unavailable live snapshot, never synthetic replacements.

The demo provider is explicit and separate. No raw provider fetching, database credentials or NASA key reach the browser. Logs contain operational counts and sanitized codes; authenticated URLs are not logged or stored. There is no public ingestion/admin endpoint. Public read APIs still need deployment-level rate limiting if exposed at scale.

## Deployment and extension limits

Run the web application, persistent PostgreSQL and scheduler as separate processes/services. Supply secrets through runtime environment, enable database TLS as required by the host, run migrations during release, and configure backups/retention and process supervision. The included local database helper is not a production service manager. No cloud deployment or automatic backup setup is included.

Keep raw observations when tuning rules so recomputation remains possible. Introduce seasonality, multiple-sensor calibration and stronger geospatial assignment only with appropriate data and evaluation. Internet/aviation connectors and AI briefs belong to later phases.

## Compact hosted profile

The Aiven deployment uses the exact hourly aggregates and bounded raw sampling described in [hosted operation](hosted-operations.md). The historical counts remain complete; the raw evidence archive is sampled. Web reads use a dedicated role and verified TLS. Production runs an hourly scheduled collector with an explicit 90-minute analysis/USGS freshness budget; local persistent-worker defaults remain unchanged.
