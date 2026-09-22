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
7. Compute a separate contextual-support confidence from relevance, source diversity and evidence volume.
8. Merge signal detection and external publication into one chronology.
9. Distinguish `context_found`, `no_explanation_found_yet` and `context_unavailable`.
10. Expose retrieval health as `not_attempted`, `complete`, `partial` or `unavailable`.

`NO EXPLANATION FOUND YET` is a first-class product state. It means no sufficiently relevant external evidence was retrieved from the sources that were successfully searched. It does **not** mean that the observed anomaly has no real-world explanation. If every configured provider fails, the investigation reports `context_unavailable` instead.

The topical gate is intentional. An authoritative article published at the right time and place is **not** relevant context if it does not concern the observed system. This prevents unrelated local news from being promoted into a plausible-looking explanation.

`explanationConfidence` is deliberately separate from signal confidence. It measures the strength of retrieved contextual support using the best ranked evidence and independent source domains. It is **not** a probability that an incident occurred and it is **not** a probability that any proposed cause is true.

## Phase 4B — first real context provider

A `GdeltContextProvider` queries GDELT DOC 2.0 Article List mode using a bounded event window and a query assembled from the event location and signal types. It normalizes articles into the same `ContextEvidence` contract used by the deterministic investigation core.

The provider is deliberately isolated from the investigation engine and accepts an injected `fetch` implementation so tests never depend on live network availability. Provider failure degrades independently through `Promise.allSettled` and is surfaced in provider health rather than being confused with an empty search result.

Current limitations:

- GDELT DOC searches only its recent coverage window; it is not the historical replay store.
- GDELT evidence is news context, not an authoritative incident confirmation.
- Geographic and topical relevance are validated again by the deterministic ranking layer after retrieval.
- A second provider for official alerts is still required before context can be considered independently corroborated.

## Phase 4C — signal context API

`GET /api/signals/:id/context?mode=live` builds an investigation for a stored signal and retrieves GDELT context. The endpoint is dynamic and uncached so contextual evidence can evolve after the anomaly is first detected.

`mode=demo` never performs external retrieval by default. It returns the deterministic `NO EXPLANATION FOUND YET` state with `retrievalStatus: not_attempted`. This preserves the existing rule that demo data and live evidence never silently mix.

The API currently computes investigations on request. Persistence, correlated-event investigations and scheduled refresh are the next storage/operations increment.

## Phase 4D — investigation panel

Implemented in the signal detail panel:

- editorial context is visibly separated from retrieved evidence;
- live investigation is fetched only when the user opens the panel;
- `CONTEXT EVIDENCE FOUND`, `NO EXPLANATION FOUND YET` and `CONTEXT SOURCES UNAVAILABLE` have distinct UI states;
- evidence cards keep source URL, publication time, deterministic relevance score and topical score;
- contextual-support confidence is shown separately from data confidence;
- the timeline merges anomaly detection and contextual publication times;
- provider health and unresolved unknowns remain visible;
- demo mode is deterministic and performs no external retrieval.

Playwright covers the investigation panel and context API on desktop, tablet and mobile.

## Epistemic rules

- Retrieved articles or alerts are contextual evidence, not proof of causality.
- Temporal order never establishes causation.
- Temporal and geographic coincidence without topical relevance is rejected.
- Provider failures degrade gracefully and do not erase successful evidence from other providers.
- Canonically equivalent URLs do not create artificial confirmation.
- Source quality affects ranking but does not make a source automatically true.
- Contextual-support confidence is not causal confidence or incident probability.
- The future LLM layer may summarize only the supplied evidence package and must preserve source links, timestamps and unknowns.

## Next increments

- Phase 4E: add an official-alert provider and distinguish `reported` from `independently_confirmed` context.
- Phase 4F: persist investigations, add scheduled context refresh and support correlated-event IDs.
- Phase 4G: add historical context replay using only evidence available at each replay timestamp.
- Phase 4H: optional LLM briefing over the deterministic evidence package, with citation coverage checks and `NO EXPLANATION FOUND YET` preserved.
