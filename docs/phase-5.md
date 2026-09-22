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
- 24-hour forecast scanning for extreme heat/cold, high wind and heavy rain;
- only promoted extreme events are persisted; raw hourly global weather arrays are discarded after evaluation;
- deterministic event IDs by H3 cell, event class and forecast day;
- missing forecast events are resolved only after a successful authoritative refresh;
- upstream failure never implies a false return to normal;
- hosted 15-minute event refresh cadence;
- mocked provider tests and PostgreSQL lifecycle tests.

This first weather layer is deliberately coarse. It uses absolute operational thresholds, not local climatological anomaly percentiles yet.

## Phase 5C — Internet outage layer

Implemented first live increment:

- public IODA v2 outage-event provider behind the universal `WorldEvent` contract;
- country-level macroscopic Internet outages normalized into `infrastructure / internet_outage` events;
- BGP and active-probing provenance retained;
- no global raw Internet time-series mirror;
- stable event identity from country, IODA datasource and outage start time;
- 90-day bounded lookup for recent and long-running outages;
- provider failure or a missing row never implies recovery;
- dedicated hosted refresh every five minutes.

IODA outage events are evidence of connectivity disruption, not evidence of cause.

## Phase 5D — Aviation activity layer

Implemented first live increment:

- ADSB.lol selected instead of OpenSky for the operational public layer because ADSB.lol publishes its API/data under ODbL 1.0; OpenSky remains disabled because live operational REST use requires a written agreement;
- 20 fixed aviation sentinel regions spanning major traffic areas across the Americas, Europe, Africa, the Middle East, Asia and Australia;
- each sentinel queries a 250 NM radius every 15 minutes;
- aircraft identifiers, callsigns, registrations and trajectories are used only transiently for deduplication and are discarded immediately;
- PostgreSQL stores one regional airborne-aircraft count per 15-minute bucket;
- aviation observations older than 35 days are pruned;
- matched baseline compares one prior sample per day at the same UTC hour and weekday/weekend class;
- at least seven matched historical days are required before any disruption is promoted;
- reference mean must be at least five aircraft;
- activity reductions of at least 40%, 60% and 80% map to notable, elevated and significant respectively;
- aviation confidence is capped at 0.55 because receiver-network coverage is incomplete and can vary independently of real traffic;
- upstream failure never resolves an existing aviation disruption;
- dedicated hosted refresh cadence every 15 minutes.

This is explicitly a **sentinel network**, not a complete census of global flights. A traffic reduction can result from real operational change, receiver/network coverage change or source availability. Cause attribution remains external to the detector.

## Storage policy

WORLD SIGNAL must not become a raw mirror of upstream APIs.

For broad event providers like EONET, only normalized current event state is retained. For weather, Internet and aviation, raw upstream payloads are evaluated in memory and discarded. Aviation keeps only 15-minute regional counts for 35 days — no aircraft identity or trajectory is persisted.

Target lifecycle:

- **HOT**: short-lived observations or compact regional aggregates;
- **WARM**: regional/time-bucket references and baselines for ~30–35 days;
- **COLD**: normalized events, timelines and contextual evidence.

## Source roadmap

Next provider families should use the same event contract:

1. Internet v2 — independent confirmation source plus finer regional/ASN coverage.
2. Weather/climate v2 — denser/adaptive scanning plus local climatological baselines and ensemble support.
3. Marine anomaly engine — sea-surface temperature and marine heatwaves.
4. Aviation v2 — denser/adaptive coverage and independent confirmation without storing aircraft tracks.
5. Power — start with open regional grid/transparency sources and expose coverage limitations explicitly.

## Product direction

The default product surface should evolve toward:

- **World Status** — significant/elevated event counts and provider freshness;
- **World Feed** — chronological, human-readable global event stream;
- **Globe** — category-first filtering rather than dozens of provider-specific layers;
- **Investigation** — Context Engine timeline and evidence for any promoted event.

The system must always distinguish source coverage from absence of an event. No provider should be presented as global at a finer resolution than it actually measures, and forecast conditions must remain distinct from observed impacts.
