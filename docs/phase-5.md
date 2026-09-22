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
- EONET refresh integrated into the worker.

### Storage policy

WORLD SIGNAL must not become a raw mirror of upstream APIs.

For broad event providers like EONET, only the normalized current event state is retained. Large upstream geometry histories are compacted to the latest operational geometry summary. When state changes, one previous normalized version is archived.

For future high-volume measurement providers (weather grids, aviation positions, Internet measurements), raw samples should be ephemeral. Persist only time buckets, H3/regional aggregates, anomalies and promoted events.

Target lifecycle:

- **HOT**: detailed aggregates for 24–72 hours;
- **WARM**: hourly/region summaries and baselines for ~30 days;
- **COLD**: normalized events, timelines and contextual evidence.

## Source roadmap

Next provider families should use the same event contract:

1. Internet — IODA first, then independent confirmation sources.
2. Weather/climate anomaly engine — heat, wind and extreme precipitation.
3. Marine anomaly engine — sea-surface temperature and marine heatwaves.
4. Aviation — aggregate OpenSky traffic into regional time buckets; never store global aircraft positions long-term.
5. Power — start with open regional grid/transparency sources and expose coverage limitations explicitly.

## Product direction

The default product surface should evolve toward:

- **World Status** — significant/elevated event counts and provider freshness;
- **World Feed** — chronological, human-readable global event stream;
- **Globe** — category-first filtering rather than dozens of provider-specific layers;
- **Investigation** — Context Engine timeline and evidence for any promoted event.

The system must always distinguish source coverage from absence of an event. No provider should be presented as global when its geographic or licensing coverage is narrower.
