# WORLD SIGNAL free-tier budget

WORLD SIGNAL is designed to stay inside small hosted-database and public-API budgets by storing events and compact aggregates, not global raw feeds.

## Hard operating envelope

- Hosted PostgreSQL target: **1 GB disk**. Operational target is <= 650 MB; warning at 70%, protective mode at 82%, emergency compaction at 90%.
- PostgreSQL connections: keep the application pool small (`DATABASE_POOL_MAX=2` in scheduled jobs; <=5 locally) because the free Aiven PostgreSQL plan exposes a small connection budget.
- Open-Meteo free endpoint: non-commercial only, <10,000 calls/day, <5,000/hour and <600/minute. WORLD SIGNAL therefore batches coordinates and applies a local daily request budget below the upstream cap.
- High-frequency providers must have independent cadences. Faster refresh must never imply refreshing every provider.

## Retention defaults

| Data | Default retention | Storage shape |
| --- | ---: | --- |
| Current `world_events` | active + 21 days resolved | one normalized JSON event |
| `world_event_history` | 14 days | only semantic state changes |
| Aviation aggregates | 21 days | one regional count / 15 min |
| FIRMS raw observations | 24 h in hosted compact mode | bounded samples only |
| Context investigation history | 14 days | prior investigation snapshots |
| Climate references | retained | compact mean/stddev/p10/p90/N only |
| Raw weather / marine API arrays | 0 | evaluated in memory and discarded |

These are defaults for free-tier operation and can be raised by environment variables on a larger plan.

## API-budget policy

Every scheduled external provider must define:

1. a cadence;
2. a maximum requests-per-run budget;
3. a conservative daily budget where the provider publishes a quota;
4. batching where the API supports it;
5. failure semantics that do not infer recovery from a failed or skipped refresh.

Open-Meteo budgets are deliberately lower than the published free limits. Climate archive cache misses are separately bounded because one 30-year historical query is much more expensive than a forecast batch.

## Protective database mode

`npm run db:budget` inspects the current PostgreSQL database size and major WORLD SIGNAL tables.

`npm run db:compact` applies retention using the configured free-tier defaults. Scheduled maintenance should run compaction before optional low-priority collectors. When the configured database budget is exceeded, low-priority historical expansion should stop before current-event ingestion.

The goal is not to fill the free plan. The goal is to leave enough headroom for indexes, PostgreSQL overhead, migrations and temporary growth during maintenance.
