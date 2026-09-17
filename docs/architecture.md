> Historical Phase 1 design notes. For the implemented live pipeline, see [Phase 2 data architecture](data-architecture.md).

# Architecture decisions

## Scope: a complete first experience

The first release implements the brief's first implementation task. It deliberately stops before external ingestion. Its purpose is to validate the globe → anomaly → evidence interaction with a complete usable interface. A demo is never labeled live. The prototype contains no authentication, payments, AI calls or external data credentials.

## One Next.js application

Next.js App Router, React and TypeScript provide server snapshot delivery and a small JSON endpoint. A single app with `core`, `providers` and `components` modules is easier to operate than a monorepo with empty packages. These module boundaries can move into packages if multiple workers or applications need them.

React Globe GL is dynamically imported on the client; heavy WebGL code stays out of the server route. Natural Earth country geometry and a globe texture are served locally. Country polygons provide selection, points represent aggregated regional signals, and rings encode salience. There are no decorative flight paths presented as observations.

The demo has only 14 region-level signals, 10 in its initial 24-hour window. Runtime spatial clustering is not needed at this density and is not implemented. Add viewport/zoom-dependent clustering and a server response limit before connecting high-volume providers. The renderer stops when the document is hidden. The accessible feed remains the primary keyboard alternative to the globe. Mobile uses the same small globe with stacked panels; low-power devices may require a 2D fallback later.

## Data and computation

`SignalProvider.getSnapshot()` separates ingestion from presentation. `WorldSignal` carries the observation, reference, unit, method, provenance, time and confidence. The default server route and API use the same demo provider. No synthetic data is persisted.

Demo reference samples precede each scenario timestamp. The current observation is never included in its baseline. Ratios and signed percentage changes use the arithmetic mean. Seismic counts use a population z-score. An insufficient, zero or invalid denominator yields `null`, not infinity or a fake baseline. Thresholds are centralized by layer. Demo threshold rules are explanatory prototype rules, not validated hazard models.

Earthquake magnitude and depth are separate properties; the count z-score does not describe magnitude rarity. Internet values are a traffic index. Fire detections are not individual fires. Aviation counts are regional aggregates. Real providers must define comparable observation windows and handle missing coverage before these methods can be used operationally.

The evidence chart renders the 30 reference samples and current measurement. Its dotted connector indicates a comparison, not intervening observations. Units, methodology and limitations stay attached to the signal.

## UI state and chronology

A single derived filtered list drives the globe, count and feed. Filters combine layer, severity, search, country and event time. The detail panel can only show a currently visible signal. Replay moves the window's end backward from the fixed demo snapshot and excludes events after that instant. Play advances this cursor; Snapshot restores the fixed endpoint. Layer counts show the available samples in the selected time window before search and severity filtering.

Search is deterministic substring search over places, regions, titles and types in the demo dataset. It is not a geocoder or Ask Earth. Editorial explanations are explicitly not AI generated. Selecting a country reports available demo signals or missing demo coverage, not a danger score or a declaration of normal conditions.

## Production ingestion plan

The next release should preserve these interfaces while adding:

- A provider adapter per source, schema validation, timeouts, rate-limit handling and metadata for observation/publication/ingestion times.
- An explicit connection status and freshness budget per source. No silent switch from live to demo.
- PostgreSQL `observations`, `ingestion_runs`, `baseline_windows` and `signals` tables; a unique provider/event key for idempotency and indexed coordinates/timestamps. Add PostGIS when spatial queries justify it.
- A scheduled ingestion worker outside web request lifetimes; backfill and baseline warm-up before anomaly claims.
- Provider-specific baselines controlling for seasonality, reporting coverage and comparable time windows.
- Evidence-bound AI responses with explicit interpretation labels, source references and no inferred cause presented as fact.

Public deployment, external providers, persistent historical replay, AI Brief, Ask Earth and correlation are not implemented in this phase.

## Reference documentation

- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [React Globe GL API](https://github.com/vasturiano/react-globe.gl)
