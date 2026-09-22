# WORLD SIGNAL

**What changed?** A globe-first observatory for unusual activity and real-world events across independent planetary systems.

WORLD SIGNAL connects **USGS earthquakes, NASA FIRMS fire detections, NASA EONET natural events, Open-Meteo weather + ERA5 climatology, Open-Meteo Marine SST sentinels, IODA Internet outage events and ADSB.lol aviation sentinels** to PostgreSQL, deterministic analysis and an interactive globe. Live observations and the explicitly labeled synthetic demo remain separate.

Phase 3 provides deterministic spatial/temporal correlation foundations. Phase 4 adds a deterministic **Context Engine** with GDELT news context and GDACS institutional evidence, ranked and deduplicated into an investigation timeline while preserving **NO EXPLANATION FOUND YET** and **CONTEXT SOURCES UNAVAILABLE**. Phase 5 introduces the additive **Universal Event Engine**: a provider-independent `WorldEvent` contract and compact current-state/history storage across hazards, climate, infrastructure and mobility. Phase 5B adds global weather sentinels, 5C live Internet outages, 5D regional aviation activity and 5E compact ERA5 climate references plus ocean SST rapid-warming sentinels. No LLM-generated briefing is currently used. External reporting is context, never automatic proof of causality. See [Phase 3 implementation status](docs/phase-3.md), [Phase 4 Context Engine](docs/phase-4.md) and [Phase 5 Universal Event Engine](docs/phase-5.md).

![WORLD SIGNAL live interface — real USGS and NASA FIRMS data](docs/live-preview.png)

## Run locally

Node.js 20.9+ and npm are required.

```sh
npm ci
npm run db:local
```

Keep that terminal open. This initializes a real, isolated PostgreSQL cluster on loopback port 55432, creates the development/test databases and writes local credentials to ignored `.env.local`. The database persists under ignored `.data/`; stop it with Ctrl+C.

In a second terminal:

```sh
npm run db:migrate
npm run db:seed
npm run ingest:all -- --history
npm run dev
```

Open http://localhost:3000/?mode=live. Initial ingestion downloads the USGS monthly feed and NASA's seven-day NOAA-20 feed. `db:seed` registers providers only; it never inserts simulated observations.

In a third terminal, keep the scheduler running:

```sh
npm run worker
```

The long-running worker collects USGS and FIRMS, recomputes signals, refreshes context investigations and refreshes universal world-event providers. EONET refreshes are semantically deduplicated. Set `OPEN_METEO_ENABLED=true` to include the weather sentinel locally. Internet, aviation and marine collection also have dedicated hosted workflows.

One-shot refreshes:

```sh
npm run events:refresh
npm run events:internet
npm run events:marine
npm run aviation:refresh
```

For an existing PostgreSQL service, copy `.env.example` to `.env.local`, set `DATABASE_URL` and `WORLD_SIGNAL_MODE=live`, then migrate, seed, ingest and run the appropriate collectors. Do not commit credentials. Production requires persistent PostgreSQL and separate scheduled collectors; the Next.js web process does not perform ingestion on page requests.

The hosted setup uses compact historical storage with an hourly core observation collector, a **15-minute EONET/weather collector**, a **5-minute Internet-outage collector**, a **15-minute aviation-sentinel collector** and an **hourly marine SST collector**. ERA5 1991–2020 climatology is fetched only on bounded cache misses and stored as compact statistics. See [hosted operation and retention](docs/hosted-operations.md).

For Vercel, follow the [production database and worker setup](docs/vercel-deployment.md). A web deployment does not create the database or start collection. Run `npm run db:check` to diagnose the configured database without printing credentials.

## Sources and limits

- [USGS GeoJSON feeds](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php): individual events selected by configurable magnitude/significance/depth rules, plus regional count anomalies when adequate coverage exists.
- [NASA FIRMS active-fire downloads](https://firms.modaps.eosdis.nasa.gov/active_fire/): public NOAA-20 VIIRS detections aggregated into H3 cells. A detection is not a confirmed incident or burned-area estimate.
- [NASA EONET v3](https://eonet.gsfc.nasa.gov/docs/v3): broad event metadata for wildfires, volcanoes, severe storms, floods, landslides, drought and other natural/climate events.
- [Open-Meteo Forecast API](https://open-meteo.com/en/docs): coarse H3 resolution-0 extreme-temperature, wind and rainfall sentinels. Raw hourly forecast arrays are discarded after evaluation.
- [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api): ERA5 1991–2020 daily temperature references for promoted heat/cold events. WORLD SIGNAL caches only mean, standard deviation, p10, p90 and sample count; historical arrays are not retained. Archive enrichment is best-effort and cannot block the live weather layer.
- [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api): 24 basin sentinels examine modelled sea-surface temperature once per hour. A rise of at least 2 °C across comparable windows about seven days apart can become a `water_anomaly`. This is explicitly **not** a formal marine-heatwave classification; that requires a multi-decadal SST climatology such as a future Copernicus integration.
- [IODA](https://ioda.inetintel.cc.gatech.edu/): country-level macroscopic Internet outage events derived from network measurements including BGP and active probing. An IODA event indicates connectivity disruption, not cause.
- [ADSB.lol](https://www.adsb.lol/): 20 fixed 250-NM aviation sentinel regions every 15 minutes under ODbL 1.0. Aircraft identifiers, callsigns, registrations and tracks are discarded immediately; only compact regional counts are retained.
- OpenSky normalization remains available for offline/research fixtures, but operational REST collection is disabled without the required live-product agreement.
- [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/): live news-context retrieval for investigations.
- [GDACS](https://www.gdacs.org/): institutional disaster-alert context used as an independent corroboration layer for supported event classes.
- Confidence describes data quality/reference support, not event probability. Power-grid monitoring is not yet operational.

Free Open-Meteo endpoints are intended for evaluation/non-commercial use; endpoint and API-key settings are configurable so a commercial deployment can use the appropriate customer service without changing normalization logic.

Provider outages expose unavailable, partial or delayed states. A live failure never substitutes demo data. Weather failure never resolves current weather events, climatology failure never blocks weather events, IODA failure never implies connectivity recovery, ADSB.lol failure never resolves an aviation disruption, and marine failure never implies sea temperatures returned to normal.

## Storage model

WORLD SIGNAL deliberately does **not** mirror every upstream raw feed indefinitely.

- **HOT** — short-lived raw or fine-grained aggregates needed for near-real-time computation.
- **WARM** — compact regional/time-bucket references and baselines for roughly a month.
- **COLD** — normalized events, state transitions, investigation timelines, sourced evidence and stable compact climatology statistics.

`world_events` stores only current normalized state. `world_event_history` receives a previous version only when a semantic fingerprint changes. Resolved events are retained for a bounded period. Weather/marine arrays are evaluated in memory and discarded. `climate_references` stores only compact ERA5 statistics. IODA stores normalized outage events only. ADSB.lol aircraft-level payloads are never persisted.

## API

- `GET /api/signals?mode=live&type=earthquake,wildfire&limit=250`
- `GET /api/signals/:id?mode=live`
- `GET /api/signals/:id/context?mode=live`
- `GET /api/events?status=active&category=natural_hazard&limit=300`
- `GET /api/events/:id`
- `GET /api/providers/status`

Signal filters include `type`, `severity`, `since`, `until`, `bbox`, `q`, `country`, `includeResolved`, `limit` and `offset`. Requests query persisted results, never raw upstream feeds.

World-event filters currently include `category`, `type`, `status`, `since` and `limit`. This API is the migration surface for World Status, World Feed and the category-first globe.

The context endpoint creates a deterministic investigation for one signal. In live mode it returns ranked evidence, provider retrieval status, contextual-support confidence, corroboration assessment and a combined anomaly/context timeline. Demo mode performs no external retrieval.

Use `/?mode=demo` or `WORLD_SIGNAL_MODE=demo` for deterministic synthetic scenarios. Demo mode works without a database. `?mode=live` never falls back to those scenarios.

## Operations and validation

```sh
npm run ingest:usgs -- --history
npm run ingest:firms -- --history
npm run signals:compute
npm run events:refresh
npm run events:internet
npm run events:marine
npm run aviation:refresh
npm test
npm run test:db
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Database tests require an isolated database whose name ends in `_test`. **Tests truncate that dedicated test database.** CI runs lint, strict TypeScript checking, unit tests, database integration tests, production build and browser tests. Superseded PR verification runs are cancelled automatically; browser tests cover desktop, tablet and mobile.

See [data architecture and statistical methodology](docs/data-architecture.md), [validation evidence](docs/validation.md), [Phase 4 Context Engine](docs/phase-4.md), [Phase 5 Universal Event Engine](docs/phase-5.md), and [asset credits](docs/credits.md).
