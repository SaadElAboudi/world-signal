# Phase 4 — Context Engine

WORLD SIGNAL must explain **what external evidence exists after an anomaly appears** without turning correlation into causation.

## Phase 4A scope

The first implementation intentionally contains **no LLM summarization and no live web provider**. It introduces the deterministic core that every provider and future LLM layer must respect:

1. Accept a single `WorldSignal` or a `CorrelatedEvent`.
2. Ask independent `ContextProvider` implementations for external evidence.
3. Deduplicate evidence by source URL.
4. Score evidence on temporal proximity, geographic match and source quality.
5. Keep only sufficiently relevant evidence.
6. Merge signal detection and external publication into one chronology.
7. Return one explicit state:
   - `context_found`
   - `no_explanation_found_yet`

`NO EXPLANATION FOUND YET` is a first-class product state. It means no sufficiently relevant external evidence was retrieved. It does **not** mean that the observed anomaly has no real-world explanation.

## Safety / epistemic rules

- Retrieved articles or alerts are contextual evidence, not proof of causality.
- Temporal order never establishes causation.
- Provider failures degrade gracefully and do not erase successful evidence from other providers.
- Duplicate URLs do not create artificial confirmation.
- Source quality affects ranking but does not make a source automatically true.
- The future LLM layer may summarize only the supplied evidence package and must preserve source links, timestamps and unknowns.

## Next increments

- Phase 4B: implement real providers (official alerts + news/event index), bounded by the event time/location window.
- Phase 4C: persist investigations and expose them through an API.
- Phase 4D: add the investigation timeline panel to the globe UI.
- Phase 4E: optional LLM briefing over the deterministic evidence package, with citation coverage checks and `NO EXPLANATION FOUND YET` preserved.
