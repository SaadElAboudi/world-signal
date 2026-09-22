# Phase 5 — Universal Event Engine

WORLD SIGNAL is evolving from a small set of signal-specific pipelines into a global event-intelligence platform.

## Goal

A user should be able to open WORLD SIGNAL and understand what is happening across the world without knowing which upstream provider produced the data.

The platform therefore separates three concepts:

1. **Observation** — raw or aggregated measurement.
2. **Signal** — statistically or operationally relevant deviation.
3. **WorldEvent** — normalized real-world event suitable for the global map/feed and contextual investigation.

The existing `WorldSignal` contract remains intact while the migration happens incrementally. `WorldEvent` is additive, not a breaking replacement.

## Universal event taxonomy

Top-level categories:

- `natural_hazard`
- `climate`
- `environment`
- `infrastructure`
- `mobility`
- `earth_observation`

The type vocabulary includes earthquakes, wildfires, volcanoes, severe storms, tropical cyclones, tornadoes, floods, landslides, drought, dust/haze, snow, temperature extremes, marine heatwaves, high wind, heavy rain, tsunami, power outages, Internet outages and aviation disruption.

## Phase 5A — NASA EONET broad hazard layer

Implemented:

- `WorldEvent` universal contract;
- NASA EONET v3 provider;
- normalization for the broad EONET natural/climate/environment category set;
- point, track and polygon compaction into a display centroid plus optional bounding box;
- recently closed events are retained so the system can observe lifecycle transitions;
- current-state Postgres storage;
- semantic fingerprinting so identical refreshes do not grow history;
- history written only when meaningful event state changes;
- 30-day event-change history and 35-day resolved-event retention;
- `GET /api/events` and `GET /api/events/:id`;
- EONET refresh integrated into the worker and dedicated hosted event workflow.

## Phase 5B — Weather & Climate Engine

Implemented first increment:

- Open-Meteo forecast provider behind the universal `WorldEvent` contract;
- a deterministic global H3 resolution-0 sentinel grid with 122 cells covering the planet;
- batched multi-coordinate requests rather than one HTTP call per cell;
- 24-hour forecast scanning for:
  - extreme heat: elevated from 40 °C, significant from 45 °C;
  - extreme cold: elevated at or below -25 °C, significant at or below -35 °C;
  - high wind: elevated from 90 km/h gusts, significant from 120 km/h;
  - heavy rain: elevated from 50 mm/6h, significant from 80 mm/6h;
- only promoted extreme events are persisted; raw hourly global weather arrays are discarded after evaluation;
- deterministic event IDs by H3 cell, event class and forecast day;
- missing forecast events are resolved only after a successful authoritative refresh;
- upstream failure never implies a false return to normal;
- local opt-in through `OPEN_METEO_ENABLED`;
- hosted 15-minute event refresh cadence;
- free and commercial Open-Meteo endpoint/API-key configuration without changing normalization code;
- mocked provider tests and PostgreSQL lifecycle tests.

### What Phase 5B does not claim yet

This first weather layer is deliberately **coarse**. H3 resolution 0 is a planetary sentinel network, not a high-resolution weather warning system. A severe but geographically narrow event can fall between cell centroids.

The current detector uses absolute operational thresholds. It does **not** yet claim that 40 °C in one region is statistically anomalous relative to that region's historical climate. Historical/local climatology, percentile baselines, denser adaptive grids and ensemble confidence belong to later 5B increments.

Forecast-derived events expose `forecast: true`, their grid method and threshold method in properties. They should be presented as forecast extreme conditions, not observed impacts.

## Phase 5C — Internet outage layer

Implemented first live increment:

- public IODA v2 outage-event provider behind the universal `WorldEvent` contract;
- country-level macroscopic Internet outages normalized into `infrastructure / internet_outage` events;
- IODA BGP and active-probing event sources are preserved as measurement provenance, not treated as causal explanations;
- no global raw Internet time-series mirror: WORLD SIGNAL fetches IODA's promoted outage events and persists only normalized event state;
- stable event identity from country, IODA datasource and outage start time;
- compact country geolocation resolved from the Natural Earth GeoJSON already shipped with WORLD SIGNAL;
- recent and long-running outages are queried with a 90-day bounded window;
- provider failure or a missing row never implies connectivity recovery;
- dedicated hosted refresh cadence every five minutes, separate from the 15-minute natural/weather event collector;
- deterministic provider tests for active/resolved events, malformed payloads and unsupported geography.

IODA measures global Internet connectivity using multiple infrastructure signals including BGP and active probing. Its outage event is evidence of a connectivity disruption, not evidence of why the disruption happened. Cause attribution remains the job of the Context Engine and independent evidence.

## Storage policy

WORLD SIGNAL must not become a raw mirror of upstream APIs.

For broad event providers like EONET, only the normalized current event state is retained. Large upstream geometry histories are compacted to the latest operational geometry summary. When state changes, one previous normalized version is archived.

For high-volume providers such as weather, aviation and Internet measurements, raw samples should be ephemeral. The weather engine follows this rule now: response arrays exist only in memory while thresholds are evaluated; only promoted `WorldEvent` records reach PostgreSQL. The IODA event layer is even lighter: it consumes promoted outage events directly rather than storing country-by-country raw measurement series.

Target lifecycle:

- **HOT**: detailed aggregates for 24–72 hours;
- **WARM**: hourly/region summaries and baselines for ~30 days;
- **COLD**: normalized events, timelines and contextual evidence.

## Source roadmap

Next provider families should use the same event contract:

1. Internet v2 — independent confirmation source (for example RIPE/Cloudflare where access and licensing fit) plus finer regional/ASN coverage.
2. Weather/climate v2 — denser/adaptive scanning plus local climatological baselines and ensemble support.
3. Marine anomaly engine — sea-surface temperature and marine heatwaves.
4. Aviation — aggregate OpenSky traffic into regional time buckets; never store global aircraft positions long-term.
5. Power — start with open regional grid/transparency sources and expose coverage limitations explicitly.

## Product direction

The default product surface should evolve toward:

- **World Status** — significant/elevated event counts and provider freshness;
- **World Feed** — chronological, human-readable global event stream;
- **Globe** — category-first filtering rather than dozens of provider-specific layers;
- **Investigation** — Context Engine timeline and evidence for any promoted event.

The system must always distinguish source coverage from absence of an event. No provider should be presented as global at a finer resolution than it actually measures, and forecast conditions must remain distinct from observed impacts.
