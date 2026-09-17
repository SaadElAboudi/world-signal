# Phase 3 — implementation status

## First increment: calculation and provider foundations

Implemented 17 September 2026. Phase 2 remains the operational public application; this increment does **not** claim that four live systems are connected.

Inspection covered the provider contract, normalized observations, all four migrations, ingestion transactions, compact retention, baseline/confidence logic, snapshot/query/health paths, globe/dashboard/detail components, environment settings and unit/PostgreSQL/browser tests. The existing Next.js route-handler guide was read before changes.

Implementation sequence:

1. Validate the hosted Phase 2 release and inspect actual Internet/aviation access constraints.
2. Establish provider independence, shared H3/country scopes, a deterministic correlation engine and historical input contract.
3. Add offline source normalizers and matched temporal baselines, with tests for missing data, deduplication and geographic/temporal boundaries.
4. Connect approved collectors, persistence and the event UI in the next increment after access and data-quality validation.

### Available now

- Explicit registry separates a real-world system from a provider and its independence group. Candidate registration never activates collection.
- Country scope can contain a regional H3 measurement. Two local signals require a shared cell or parent/child H3 containment, not just membership in the same large country. Country names must use Natural Earth ADMIN names, as the existing globe does.
- Correlation windows: 1, 6 and 24 UTC hours. Candidate indexes use country membership, exact H3 cells/ancestors/descendants and time buckets. Unrelated local cells are not compared through a country or root-cell bucket.
- Score = 30% geographic relation + 25% onset-time proximity + 15% mean severity + 15% system independence + 15% minimum component confidence. Default threshold 0.70; confidence below 0.40 is rejected. Geography scores are 1 for identical H3 cells, 0.9 for parent containment, 0.8 for country containment. Temporal score declines linearly with onset separation. These are versioned heuristics, not calibrated probabilities.
- Same-system sources can produce a separate corroboration result (+0.05 above the stronger component, capped at 0.95). They never become two independent systems. This diagnostic does not silently change stored signal confidence.
- Strongest-edge, complete-link merging prevents chains from inflating the area or time span. Each signal belongs to at most one emitted event in a computation. Expanded events supersede previous subsets during reconciliation.
- Event quality is capped at the weakest component. Resolved components alone can resolve an existing event; unavailable providers or missing observations cannot. The lifecycle helper is not yet wired into the production worker.
- Versioned historical input rejects evidence that was not known at the requested time. It selects the latest known version before eligibility checks, avoiding resurrection of superseded observations.
- Deterministic `buildEvidencePackage` preserves each signal's source, quality, baseline, observation references and limitations, and orders represented observation times. It does not invent incident onsets. `ContextProvider` is an interface only; no news retrieval or LLM call exists.

### Read-only command

```sh
npm run correlations:compute -- --window 6
npm run correlations:compute -- --window 24 --debug
npm run correlations:compute -- --input .data/captured-inputs.json --as-of 2026-09-17T12:00:00.000Z --window 6
```

The command emits JSON and never writes to the database. Without `--input`, it queries eligible **latest stored signal versions**, including the provider ID and actual database update time. Existing Phase 2 rows are overwritten during recomputation: they are **not a complete point-in-time archive**. The output explicitly reports that limitation. Full historical recalculation accepts captured `CorrelationInput[]` records with `signal`, `providerId`, `scope`, `recordedAt`, and optional `endedAt`. Do not set `recordedAt` to an assumed historical time.

`--debug` emits accepted/rejected candidate explanations and comparison counts only to the operator's terminal. No public debug API is exposed. Geographically unrelated pairs are absent from candidate diagnostics because the index rejected them before scoring; `scoreCandidate` can explain a specific pair during development.

## Source investigation and normalization

### Internet: IODA candidate

The [official IODA API](https://api.ioda.inetintel.cc.gatech.edu/v2/) responded successfully to a country time-series probe on 17 September 2026. Its raw country route returned native 300-second BGP and 600-second active-probing series; a request for 24 points over one day returned hourly aggregates. Actual cadence depends on datasource and request resolution, not our collection interval.

`normalizeIodaSeries` intentionally supports only:

- `bgp`: visible /24 blocks;
- `ping-slash24`: responsive /24 blocks measured through active probing.

These are separate measurement series. Neither is a percentage of a country's population online, and neither proves an intentional shutdown. Country scope is retained separately from its display H3 cell. Missing samples remain missing; measured zero remains zero. Last actual observation determines freshness. Fetch time is marked as a local revision time, not a known upstream publication time. Batch bounds describe the requested series span and **must not be treated as gap-free baseline coverage**: missing-sample metadata must be respected by the future collector/analysis path.

The API probe returned Georgia Tech Research Corporation copyright wording. API rate guarantees and permission for this deployed product have not been established from the public API documentation; the provider therefore remains non-operational. The [IODA project description](https://www.caida.org/projects/ioda/) describes the measurement systems; [IODA's data-download notes](https://ioda.inetintel.cc.gatech.edu/reports/ioda-markup/) also explain that API access may not be available to everyone. Cloudflare Radar and RIPE Atlas remain alternatives to investigate before final activation.

### Aviation: OpenSky offline adapter; operational access not enabled

The [official REST specification](https://openskynetwork.github.io/opensky-api/rest.html) documents anonymous recent-state access, 400 daily credits, and four credits per global snapshot. Authenticated requests use OAuth2 client credentials. Those technical quotas do not grant production usage rights: the current [OpenSky terms](https://opensky-network.org/about/terms-of-use) require a written agreement for operational REST integration into a live product or automated system. No such agreement is claimed, and no recurring OpenSky collection has been enabled.

`normalizeOpenSkySnapshot` accepts supplied snapshots, filters grounded/missing/stale positions, deduplicates aircraft in memory, and immediately aggregates counts to H3 resolution 2. No callsign, registration or aircraft identifier is stored in normalized observations. The metric is explicitly **observed airborne aircraft at a snapshot**, not an hourly flight count. Receiver coverage is unknown, unobserved cells remain unknown rather than zero, and quality is capped at 0.5. Empty or stale snapshots cannot establish falling air traffic.

A legitimate alternative to investigate is [ADSB.lol's public API](https://www.adsb.lol/docs/open-data/api/), documented under ODbL 1.0. Its available query scope, rate constraints, attribution/share-alike requirements and geographic coverage still need checking; it is not connected in this increment.

### Baseline foundation

`matchedActivityBaseline` compares the same provider, metric, cell/country, sampling interval, UTC hour and either exact weekday or weekday/weekend class. It selects at most one sample per historical day, excludes the current period, limits history to 35 days and requires four exact-weekday or seven day-kind samples by default. Observations must be recent and usable. Missing history is an unavailable result, not an anomaly. Aviation confidence is capped at 0.55 because receiver coverage remains unknown. This is a baseline calculation, not yet an operational Internet/aviation anomaly rule.

## Validation and remaining work

- 40 unit tests passed, including 19 new Phase 3 tests.
- TypeScript, ESLint and production build passed.
- Read-only 24-hour computation against hosted observed data at 18:19 UTC: 245 eligible stored signal versions, one spatial/temporal candidate comparison, zero accepted events. These counts describe that run, not a permanent data guarantee.
- The Phase 2 hosted endpoint independently returned HTTP 200, live status, 199 selected current signals and two healthy providers during this increment.

Remaining before Phase 3 can be called complete: approved operational Internet/aviation transports and rate handling; per-scope coverage/freshness monitoring; bounded retention and immutable historical correlation inputs; actual anomaly generation and recovery; worker/persistence integration; event API and source-health extensions; correlated globe markers, linked selection, feed ranking and shared evidence timeline; PostgreSQL integration and browser tests for those features. No paid service, schema migration, extra scheduled collection or invented data was introduced by this increment.
