# Phase 4 — Context Engine

WORLD SIGNAL explains **what external evidence exists after an anomaly appears** without turning correlation into causation.

## Phase 4A — deterministic investigation core

Implemented:

1. Accept a single `WorldSignal` or a `CorrelatedEvent`.
2. Ask independent `ContextProvider` implementations for external evidence.
3. Canonicalize and deduplicate evidence URLs, removing common tracking parameters before comparison.
4. Score evidence on temporal proximity, geographic match, **topical match** and source quality.
5. Require topical relevance before an external item can become investigation evidence.
6. Keep only sufficiently relevant evidence.
7. Compute a separate contextual-support confidence from relevance, source diversity, evidence volume and official-source support.
8. Merge signal detection and external publication into one chronology.
9. Distinguish `context_found`, `no_explanation_found_yet` and `context_unavailable`.
10. Expose retrieval health as `not_attempted`, `complete`, `partial` or `unavailable`.

`NO EXPLANATION FOUND YET` is a first-class product state. It means no sufficiently relevant external evidence was retrieved from the sources that were successfully searched. It does **not** mean that the observed anomaly has no real-world explanation. If every configured provider fails, the investigation reports `context_unavailable` instead.

The topical gate is intentional. An authoritative article published at the right time and place is **not** relevant context if it does not concern the observed system. This prevents unrelated local news from being promoted into a plausible-looking explanation.

`explanationConfidence` is deliberately separate from signal confidence. It measures the strength of retrieved contextual support. It is **not** a probability that an incident occurred and it is **not** a probability that any proposed cause is true.

## Phase 4B — news context provider

A `GdeltContextProvider` queries GDELT DOC 2.0 Article List mode using a bounded event window and a query assembled from the event location and signal types. It normalizes articles into the same `ContextEvidence` contract used by the deterministic investigation core.

The provider is deliberately isolated from the investigation engine and accepts an injected `fetch` implementation so tests never depend on live network availability. Provider failure degrades independently through `Promise.allSettled` and is surfaced in provider health rather than being confused with an empty search result.

## Phase 4C — signal context API

`GET /api/signals/:id/context?mode=live` builds an investigation for a stored signal. The endpoint is dynamic and uncached so contextual evidence can evolve after the anomaly is first detected.

`mode=demo` never performs external retrieval by default. It returns the deterministic `NO EXPLANATION FOUND YET` state with `retrievalStatus: not_attempted`. This preserves the existing rule that demo data and live evidence never silently mix.

The API currently computes investigations on request. Persistence, correlated-event investigations and scheduled refresh are the next storage/operations increment.

## Phase 4D — investigation panel

Implemented in the signal detail panel:

- editorial context is visibly separated from retrieved evidence;
- live investigation is fetched only when the user opens the panel;
- explicit states for unavailable retrieval and no explanation found;
- evidence cards retain source URL, publication time, deterministic relevance score and topical score;
- contextual-support confidence is shown separately from data confidence;
- the timeline merges anomaly detection and contextual publication times;
- provider health and unresolved unknowns remain visible;
- demo mode is deterministic and performs no external retrieval.

Playwright covers the investigation panel and context API on desktop, tablet and mobile.

## Phase 4E — official alert provider and corroboration

Implemented:

- `GdacsContextProvider` queries the public GDACS event API for supported disaster classes (`EQ` for earthquakes and `WF` for wildfires).
- GDACS results are normalized into the same evidence contract as GDELT and pass through the exact same deterministic topical/geographic/temporal ranking gate.
- Live investigations now query **GDELT + GDACS in parallel**.
- Unsupported systems such as internet and aviation do not trigger meaningless GDACS requests.
- Provider failures remain isolated: a GDACS outage cannot erase valid GDELT evidence, and vice versa.

The investigation exposes an explicit `assessment` distinct from `status` and `explanationConfidence`:

- `none` — no sufficiently relevant external context;
- `reported` — relevant external reporting exists, but no official alert was retrieved;
- `official_report_found` — relevant institutional evidence was retrieved;
- `independently_corroborated` — relevant official evidence and a separate non-official source domain both support the same contextual window.

The UI renders these as `POSSIBLE CONTEXT FOUND`, `OFFICIAL REPORT FOUND` and `INDEPENDENTLY CORROBORATED`.

**Important:** even `independently_corroborated` is not causal confirmation. It means independent contextual evidence exists around the same observed anomaly. WORLD SIGNAL still does not claim that the anomaly caused the reported event, or vice versa.

## Current limitations

- GDELT DOC searches only its recent coverage window; it is not the historical replay store.
- GDACS covers supported disaster categories, not internet or aviation disruptions.
- GDACS is an institutional alert layer, but its presence does not establish causal identity with a WORLD SIGNAL anomaly.
- Geographic and topical relevance are validated by the deterministic ranking layer after retrieval.
- Investigations are still computed on request rather than persisted and refreshed over time.

## Epistemic rules

- Retrieved articles or alerts are contextual evidence, not proof of causality.
- Temporal order never establishes causation.
- Temporal and geographic coincidence without topical relevance is rejected.
- Provider failures degrade gracefully and do not erase successful evidence from other providers.
- Canonically equivalent URLs do not create artificial confirmation.
- Source quality affects ranking but does not make a source automatically true.
- Official reporting strengthens contextual support but does not create causal certainty.
- Contextual-support confidence is not causal confidence or incident probability.
- The future LLM layer may summarize only the supplied evidence package and must preserve source links, timestamps and unknowns.

## Next increments

- Phase 4F: persist investigations, add scheduled context refresh and support correlated-event IDs.
- Phase 4G: add historical context replay using only evidence available at each replay timestamp.
- Phase 4H: optional LLM briefing over the deterministic evidence package, with citation coverage checks and `NO EXPLANATION FOUND YET` preserved.
