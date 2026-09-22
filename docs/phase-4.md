# Phase 4 — Context Engine

WORLD SIGNAL explains **what external evidence exists after an anomaly appears** without turning correlation into causation.

## Phase 4A — deterministic investigation core

Implemented:

1. Accept a single `WorldSignal` or a `CorrelatedEvent`.
2. Ask independent `ContextProvider` implementations for external evidence.
3. Deduplicate evidence by source URL.
4. Score evidence on temporal proximity, geographic match and source quality.
5. Keep only sufficiently relevant evidence.
6. Merge signal detection and external publication into one chronology.
7. Return one explicit state: `context_found` or `no_explanation_found_yet`.

`NO EXPLANATION FOUND YET` is a first-class product state. It means no sufficiently relevant external evidence was retrieved. It does **not** mean that the observed anomaly has no real-world explanation.

## Phase 4B — first real context provider

A `GdeltContextProvider` queries GDELT DOC 2.0 Article List mode using a bounded event window and a query assembled from the event location and signal types. It normalizes articles into the same `ContextEvidence` contract used by the deterministic investigation core.

The provider is deliberately isolated from the investigation engine and accepts an injected `fetch` implementation so tests never depend on live network availability. Provider failure is expected to degrade to the other providers through `Promise.allSettled` in the investigation engine.

Current limitations:

- GDELT DOC searches only its recent coverage window; it is not the historical replay store.
- GDELT evidence is news context, not an authoritative incident confirmation.
- Geographic relevance is still validated by the deterministic ranking layer after retrieval.
- A second provider for official alerts is still required before context can be considered independently corroborated.

## Phase 4C — signal context API

`GET /api/signals/:id/context?mode=live` builds an investigation for a stored signal and retrieves GDELT context. The endpoint is dynamic and uncached so contextual evidence can evolve after the anomaly is first detected.

`mode=demo` never performs external retrieval by default. It returns the deterministic `NO EXPLANATION FOUND YET` state unless an explicit provider is injected in tests. This preserves the existing rule that demo data and live evidence never silently mix.

The API currently computes investigations on request. Persistence, correlated-event investigations and scheduled refresh are the next storage/operations increment.

## Epistemic rules

- Retrieved articles or alerts are contextual evidence, not proof of causality.
- Temporal order never establishes causation.
- Provider failures degrade gracefully and do not erase successful evidence from other providers.
- Duplicate URLs do not create artificial confirmation.
- Source quality affects ranking but does not make a source automatically true.
- The future LLM layer may summarize only the supplied evidence package and must preserve source links, timestamps and unknowns.

## Next increments

- Phase 4D: add an official-alert provider and distinguish `reported` from `independently_confirmed` context.
- Phase 4E: persist investigations, add scheduled context refresh and support correlated-event IDs.
- Phase 4F: add the investigation timeline panel to the globe UI.
- Phase 4G: optional LLM briefing over the deterministic evidence package, with citation coverage checks and `NO EXPLANATION FOUND YET` preserved.
