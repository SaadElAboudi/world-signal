# Phase 2 validation

Initial local verification on 17 September 2026:

- 19 unit tests pass: normalization, stable identities, null/invalid inputs, baselines, ratios, population z-scores, coverage gaps, clustering, confidence, thresholds, filters, freshness, retries and missing credentials.
- Seven integration tests pass against a real isolated PostgreSQL database: migrations, idempotent inserts/revisions, locking, malformed-batch rollback, two-provider analysis/evidence, actual API handlers/filtering, partial failures and database outage without synthetic fallback.
- Twelve Playwright cases pass across desktop, tablet and mobile (8.6 minutes locally). These preserve the demo journeys and exercise live provenance, N/A event references, provisional fire references, partial provider failure and delayed refresh. Live browser state tests use intercepted deterministic responses, not upstream APIs.
- TypeScript/production build and ESLint pass.
- Real upstream ingestion was separately exercised against USGS monthly/daily GeoJSON and NASA's public seven-day NOAA-20 CSV. Initial storage included 11,084 earthquake observations and 549,548 thermal detections; subsequent scheduled collections update these counts.
- A live HTTP snapshot returned 200 with both healthy providers, 14 selected earthquake events and 237 geographic fire anomalies. These are a dated local validation snapshot, not promised future counts. Detail endpoints exposed real observation IDs, source URLs and calculation evidence. No seismic count cluster met the configured rules at this snapshot.
- FIRMS references currently contain five to six fully covered daily windows and are explicitly provisional, with LOW confidence. No full 30-day history, seasonal model or verified wildfire incident count is claimed.
- The authenticated NASA API/backfill path requires a user key and has not been tested against the real authenticated service. Public no-key ingestion was verified.

The local machine uses macOS 12, so browser tests used an existing Chromium 149 binary via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and software WebGL. These are emulated viewport checks, not physical-device tests or frame-rate benchmarks. That initial validation used PostgreSQL through the local development helper. Hosted deployment was subsequently verified below; managed backups and an operational SLA are not claimed.

CI runs lint, unit tests, PostgreSQL integration tests, production build and browser tests without depending on live feeds. Credentials, database contents and runtime logs are ignored by Git.

A final real-data browser check displayed 236 current signals with both providers healthy, no uncaught browser errors and no horizontal overflow. The live screenshot in the README records this later snapshot; changing counts reflect ongoing ingestion.

## Previous release

Phase 1 passed seven unit tests and nine browser cases on 16 September 2026. It contained only visibly synthetic scenarios. Those demo behaviors remain covered by the Phase 2 suite.

## Hosted Phase 2 finalization — 17 September 2026

Production is [world-signal-seven.vercel.app](https://world-signal-seven.vercel.app), backed by the Aiven Free PostgreSQL compact-storage profile. The Vercel deployment for `30e7120` succeeded. [CI run 35223015118](https://github.com/SaadElAboudi/world-signal/actions/runs/35223015118) passed, including the complete browser suite. Before Phase 3 changes, the compact profile passed 21 unit and eight real PostgreSQL integration tests, plus three targeted local live-state browser tests.

[Collector run 35223045617](https://github.com/SaadElAboudi/world-signal/actions/runs/35223045617) completed real USGS and FIRMS collection from GitHub in 52 seconds, independently of the local Mac. A subsequent public API check during Phase 3 work returned live status, 199 current selected signals and healthy USGS/FIRMS providers; last successful collections were 17:37:42 and 17:37:56 UTC respectively. Signal counts and freshness are dated observations.

See [hosted operations](hosted-operations.md) for actual TLS, role isolation, retention and hourly scheduling, and [Phase 3 status](phase-3.md) for the new calculation foundations and remaining integration work.
