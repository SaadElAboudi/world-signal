# Phase 3 — Internet, aviation and multi-signal evidence

The integration combines the local Phase 3 implementation and French interface with GitHub's context investigations and universal event providers. English and French are selectable and the language preference persists.

## Operational data

- IODA active probing: hourly country series for 40 configured countries; 32 days of initial history, then incremental collection. Missing measurements stay missing. Per-country collection and freshness are visible in provider status.
- ADSB.lol: 20 fixed regional sentinels of 250 NM, one aggregated count per 15-minute bucket. Aircraft identifiers are discarded immediately. Requests include project contact information, are spaced, and retry rate limits once. The complete batch must succeed before analysis.
- Historical references match the provider, metric, sampling interval, geographic series, UTC hour and weekday/weekend class. At least seven matched days are required. Aviation additionally requires a reference of at least five aircraft and a reduction of at least 40%. Confidence is capped at 0.55.
- Stale or insufficient history cannot resolve aviation alerts. Internet recovery requires two distinct eligible observations. Initial collection does not imply a usable baseline everywhere.

## Correlation and interface

The deterministic engine evaluates 1-, 6- and 24-hour windows, geography, independent measurement systems and evidence quality. It uses complete-link grouping to avoid creating large events from chains of weak neighbors. Co-occurrence is never presented as proof of causality.

Compact immutable `signal_versions` support historical recomputation without future information. Baseline arrays are omitted from this index; the current signal and its evidence retain the detailed reference. Provider health gates event resolution. Migration `008_correlations.sql` adds the required storage; the migration runner recognizes the identical local `005_correlations.sql` draft.

The globe and ranked feed expose grouped events, their underlying signals, source links and a shared observation timeline. A separate **Reported events** tab shows externally reported or rule-selected events, avoiding confusion with baseline-derived anomalies. Clicking a feed entry or marker opens its evidence. Original external reports and detailed provider methodology may remain in their original language; French interface explanations distinguish observation, confidence and unknown cause.

## Verification and limits

Run `npm test`, `npm run test:db`, `npm run lint`, `npm run build` and `npm run test:e2e`. The browser suite covers English/French, grouped evidence, event filtering, data failures and desktop/tablet/mobile layouts. Browser fixtures are intercepted responses and are never stored in production.

Real aviation anomaly detection needs enough days of collection. Sentinels represent partial receiver-network coverage, not a census of flights. IODA covers the configured countries, not every network. GitHub schedule delays and upstream outages remain possible and must remain visible. Cloudflare Radar and OpenSky are registry candidates, not active collectors. See [storage and deployment constraints](free-tier-budget.md).
