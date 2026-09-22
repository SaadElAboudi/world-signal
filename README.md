# WORLD SIGNAL

**What changed?** A globe-first observatory for unusual activity and real-world events across independent planetary systems.

WORLD SIGNAL connects **USGS earthquakes, NASA FIRMS fire detections, NASA EONET natural events, coarse Open-Meteo extreme-weather sentinels, IODA Internet outage events and ADSB.lol aviation sentinels** to PostgreSQL, deterministic analysis and an interactive globe. Live observations and the explicitly labeled synthetic demo remain separate.

Phase 3 provides deterministic spatial/temporal correlation foundations. Phase 4 adds a deterministic **Context Engine** with GDELT news context and GDACS institutional evidence, ranked and deduplicated into an investigation timeline while preserving **NO EXPLANATION FOUND YET** and **CONTEXT SOURCES UNAVAILABLE**. Phase 5 introduces the additive **Universal Event Engine**: a provider-independent `WorldEvent` contract and compact current-state/history storage that can grow to natural hazards, climate, infrastructure and mobility without turning every new source into a bespoke UI model. Phase 5B adds coarse global weather sentinels, Phase 5C adds live country-level Internet outage events and Phase 5D adds live regional aviation-activity sentinels. No LLM-generated briefing is currently used. External reporting is context, never automatic proof of causality. See [Phase 3 implementation status](docs/phase-3.md), [Phase 4 Context Engine](docs/phase-4.md) and [Phase 5 Universal Event Engine](docs/phase-5.md).

![WORLD SIGNAL live interface — real USGS and NASA FIRMS data](docs/live-preview.png)

## Run locally

Node.js 20.9+ and npm are required.

```sh
npm ci
npm run db:local
```

Keep that terminal open. This initializes a real, isolated PostgreSQL cluster on loopback port 55432, creates the development/test databases and writes local credentials to ignored `.env.local`. The database persists under ignored `.data/`; stop it with Ctrl+C. The helper uses platform-specific PostgreSQL binaries and is intended for development.

In a second terminal:

```sh
npm run db:migrate
npm run db:seed
npm run ingest:all -- --history
npm run dev
```

Open http://localhost:3000/?mode=live. Initial ingestion downloads the USGS monthly feed and NASA's seven-day NOAA-20 feed; allow several minutes and sufficient disk space for hundreds of thousands of observations. `db:seed` registers providers only; it never inserts simulated observations.

In a third terminal, keep the scheduler running:

```sh
npm run worker
```

The long-running worker collects USGS and FIRMS according to provider cadence, recomputes signals, refreshes context investigations and refreshes universal world-event providers. EONET refreshes are semantically deduplicated: an unchanged poll updates freshness without creating another history row. Set `OPEN_METEO_ENABLED=true` to include the weather sentinel locally. Hosted Internet and aviation collection use dedicated workflows; locally they can be refreshed explicitly with the commands below. The page polls the stored signal API every minute; **CURRENT** requests a refresh.

One-shot refreshes:

```sh
npm run events:refresh
npm run events:internet
npm run aviation:refresh
```

For an existing PostgreSQL service, copy `.env.example` to `.env.local`, set `DATABASE_URL` and `WORLD_SIGNAL_MODE=live`, then migrate, seed, ingest and run the worker. Do not commit credentials. Production requires persistent PostgreSQL and separate scheduled collectors; the Next.js web process does not perform ingestion on page requests.

The hosted setup uses Aiven PostgreSQL with compact historical storage, an hourly core observation collector, a **15-minute EONET/weather collector**, a **5-minute Internet-outage collector** and a **15-minute aviation-sentinel collector**. See [hosted operation and retention](docs/hosted-operations.md). Separate schedules avoid repeatedly running expensive or slow pipelines just to refresh faster sources.

For Vercel, follow the [production database and worker setup](docs/vercel-deployment.md). A web deployment does not create the database or start collection. Run `npm run db:check` to diagnose the configured database without printing credentials.

## Sources and limits

- [USGS GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php): individual events selected by configurable magnitude/significance/depth rules, plus regional count anomalies when adequate coverage exists.
- [NASA FIRMS active-fire downloads](https://firms.modaps.eosdis.nasa.gov/active_fire/): public NOAA-20 VIIRS CSV, without a key. Detections are aggregated into H3 geographic cells and compared with covered historical windows. A detection is not a confirmed incident or burned-area estimate.
- [NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3): broad event metadata for categories such as wildfires, volcanoes, severe storms, floods, landslides, drought, snow and temperature extremes. WORLD SIGNAL stores the normalized current event state plus compact geometry summaries, not the full upstream geometry history.
- [Open-Meteo Forecast API](https://open-meteo.com/en/docs): Phase 5B uses batched multiple-coordinate 24-hour forecasts at H3 resolution 0 to detect coarse global sentinels for extreme temperature, wind gusts and rolling six-hour rainfall. Only promoted extremes are persisted; raw hourly responses are discarded. This first layer uses deterministic absolute thresholds and is **not** a high-resolution warning service or local climatological anomaly model. The endpoint is configurable through `OPEN_METEO_ENDPOINT`; use the appropriate customer endpoint/API key for commercial operation.
- [IODA](https://ioda.inetintel.cc.gatech.edu/): public country-level macroscopic Internet outage events derived from network measurements including BGP and active probing. WORLD SIGNAL stores normalized outage events, not a global mirror of raw Internet measurement time series. An IODA event indicates connectivity disruption, not cause.
- [ADSB.lol](https://www.adsb.lol/): Phase 5D queries 20 fixed 250-NM aviation sentinel regions every 15 minutes under ODbL 1.0. Aircraft identifiers, callsigns, registrations and tracks are discarded immediately; only 15-minute regional airborne counts are retained for a 35-day matched baseline. Coverage is explicitly partial and receiver-network dependent.
- OpenSky normalization remains available for offline/research fixtures, but operational REST collection is disabled unless WORLD SIGNAL has the required written agreement for live product use.
- [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/): live news-context retrieval for investigations.
- [GDACS](https://www.gdacs.org/): institutional disaster-alert context used as an independent corroboration layer for supported event classes.
- Public FIRMS history starts with seven days, currently yielding five to six usable reference windows. The UI reports the actual reference count and marks short histories **provisional**. A 30-day reference becomes available as ingestion accumulates coverage; missing days are never invented.
- Optional authenticated FIRMS backfill: set `FIRMS_TRANSPORT=api` and `NASA_FIRMS_API_KEY`, then run `npm run backfill:firms`. This requests 31 days in bounded batches, subject to NASA availability and account limits.
- Confidence describes data quality and reference support, not the probability of an incident. Internet outage events are live through IODA. Aviation is live as a deliberately partial sentinel network and requires at least seven matched historical days before it can promote a disruption. Power-grid monitoring is not yet operational.

Provider outages expose unavailable, partial or delayed states. Context retrieval separately reports whether external searches were complete, partial, unavailable or intentionally not attempted. A live failure never substitutes demo data. Weather-provider failure never resolves current weather events, IODA failure never implies connectivity recovery, and ADSB.lol failure never resolves an aviation disruption.

## Storage model

WORLD SIGNAL deliberately does **not** mirror every upstream raw feed indefinitely.

- **HOT** — short-lived raw or fine-grained aggregates needed for near-real-time computation.
- **WARM** — compact regional/time-bucket references and baselines for roughly a month.
- **COLD** — normalized events, state transitions, investigation timelines and sourced evidence.

`world_events` stores only the current normalized event state. `world_event_history` receives a previous version only when a semantic fingerprint changes, so polling the same event repeatedly does not grow storage. Resolved events are currently retained for 35 days and event-state history for 30 days. Weather forecast arrays are evaluated in memory and discarded; only promoted extremes reach `world_events`. IODA stores normalized outage events only. ADSB.lol aircraft-level payloads are never persisted: WORLD SIGNAL keeps only one regional count per 15-minute aviation sentinel bucket for up to 35 days.

## API

- `GET /api/signals?mode=live&type=earthquake,wildfire&limit=250`
- `GET /api/signals/:id?mode=live`
- `GET /api/signals/:id/context?mode=live`
- `GET /api/events?status=active&category=natural_hazard&limit=300`
- `GET /api/events/:id`
- `GET /api/providers/status`

Signal filters: `type`, exact `severity` (`notable`, `elevated`, `significant`), ISO `since`/`until` (maximum 31-day interval), `bbox=west,south,east,north` (antimeridian supported), `q`, exact `country`, `includeResolved=true`, `limit` (1–500), and `offset`. Responses include mode, freshness, provider health, total and truncation information. Invalid filters return 400, unknown details 404, and unavailable storage 503. Requests query persisted results, never raw upstream feeds.

World-event filters currently include `category`, `type`, `status`, `since` and `limit`. This API is the Phase 5 migration surface for the future World Status, World Feed and category-first globe.

The context endpoint creates a deterministic investigation for one signal. In live mode it queries configured context providers and returns ranked evidence, provider retrieval status, contextual-support confidence, corroboration assessment and a combined anomaly/context timeline. In demo mode it performs no external retrieval and returns the explicit `no_explanation_found_yet` state with `retrievalStatus: not_attempted`.

Use `/?mode=demo` or `WORLD_SIGNAL_MODE=demo` for deterministic synthetic scenarios. Demo mode works without a database. `?mode=live` never falls back to those scenarios.

## Operations and validation

```sh
npm run ingest:usgs -- --history
npm run ingest:firms -- --history
npm run signals:compute
npm run events:refresh
npm run events:internet
npm run aviation:refresh
npm test
npm run test:db
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Database tests require an isolated database whose name ends in `_test`. The local helper creates it automatically; alternatively set `TEST_DATABASE_URL`. **Tests truncate that dedicated test database.** CI runs lint, strict TypeScript checking, unit tests, database integration tests, production build and browser tests. Superseded PR verification runs are cancelled automatically so only the latest branch state consumes the full pipeline. Browser tests start a production web server on port 3012 and cover desktop, tablet and mobile.

See [data architecture and statistical methodology](docs/data-architecture.md), [validation evidence](docs/validation.md), [Phase 1 design decisions](docs/architecture.md), [Phase 4 Context Engine](docs/phase-4.md), [Phase 5 Universal Event Engine](docs/phase-5.md), and [asset credits](docs/credits.md).
