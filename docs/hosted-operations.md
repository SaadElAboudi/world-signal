# Hosted operation on a free PostgreSQL plan

The production web application runs on Vercel. Its database is a dedicated Aiven PostgreSQL `free-1-1gb` service. Vercel uses a read-only database role; the collector uses a separate role with data-write and temporary-table permissions. Both connections verify TLS against the provider CA. Provider API tokens and database credentials stay outside Git.

## Storage profile

Production uses `FIRMS_RAW_RETENTION_HOURS=24` and `FIRMS_RAW_SAMPLES_PER_CELL_HOUR=3`:

- Every validated, qualified NOAA-20 detection contributes to exact hourly H3-cell counts, quality sums and FRP sums/counts. Statistical calculations use **all qualified detections**, not the retained raw sample.
- Keep up to three representative raw observations per cell per hour for 24 hours, preferring qualified detections. These support clickable-signal evidence IDs. They are not a complete pixel archive.
- Aggregates and source-hour coverage remain the statistical layer; missing hours remain unknown and zero detections are inferred only within fully covered source hours.
- A complete feed replaces covered hourly aggregates atomically with raw sample updates. Repeated imports do not double-count; older feeds cannot overwrite newer aggregate revisions or retractions. A failed transaction cannot expose partial new history.
- The normal free-tier mini-history keeps resolved events/signals for about 21 days, event-state history for 14 days and provider runs for 30 days. Context investigation history defaults to 14 days.
- Climate references are compact statistics only. Raw weather, ERA5 archive arrays and marine arrays are evaluated in memory and discarded.

WORLD SIGNAL measures `pg_database_size(current_database())` during scheduled maintenance. `DB_SOFT_LIMIT_MB=650` and `DB_HARD_LIMIT_MB=800` leave substantial headroom below the 1 GB managed-disk limit for indexes, migrations and temporary growth.

Retention is adaptive:

- **normal**: 14-day event history / 21-day resolved mini-history;
- **soft limit**: 7-day event history / 14-day resolved mini-history;
- **hard limit**: 3-day event history / 7-day resolved mini-history, historical expansion stops and scheduled context refresh is skipped.

Current incremental ingestion still runs in protective mode; WORLD SIGNAL drops expendable history before sacrificing the current global picture. Run `npm run db:budget` to print the current DB size, largest tables and recent API-use counters. Run `npm run db:compact` to apply the active retention profile immediately.

The first successful hosted import historically analyzed 514,805 fire detections and the database measured approximately 109 MB under an older, less aggressive raw-retention profile. Real-world volume changes with activity; the current guardrails are intentionally designed to react well before the managed quota is exhausted. No paid plan or automatic upgrade is assumed.

## API request budgets

Upstream polling is performed only by scheduled collectors. Browser traffic reads persisted `/api/signals` and `/api/events`; adding site visitors does **not** multiply calls to Open-Meteo, IODA, ADSB.lol, EONET or ENTSO-E.

A transactional daily ledger prevents collectors from exceeding WORLD SIGNAL's internal budgets. Defaults are deliberately conservative and configurable:

- Open-Meteo family: 4,000 request units/day shared by forecast, climatology and marine collectors;
- EONET: 500/day;
- IODA: 500/day;
- ADSB.lol: 2,400/day; the 20-region / 15-minute schedule normally requires about 1,920/day;
- ENTSO-E: 200/day, with the current six-zone hourly scan requiring at most 144/day.

A collector that cannot reserve its next request budget returns `budget_exhausted` and makes no external request. Reservations are conservative: failed external requests still consume the internal ledger rather than encouraging retry storms.

Open-Meteo's public free endpoints are non-commercial. Production commercialization must use an appropriate customer endpoint/API key or another source. ENTSO-E collection is opt-in and runs only when the repository variable and approved API token are configured.

## Automatic collection

`.github/workflows/ingest.yml` runs at minute 17 of each hour and can also be dispatched manually. It requires repository variable `WORLD_SIGNAL_INGEST_ENABLED=true` and secrets `WORLD_SIGNAL_DATABASE_URL` and `WORLD_SIGNAL_DATABASE_CA`. Scheduled runs respect provider intervals. The worker performs one bounded pass with `npm run worker -- --once`: apply storage maintenance, collect due core providers, recompute signals and refresh context when the storage budget allows it.

Separate hosted workflows keep fast and slow providers independent: Internet every five minutes, EONET/weather every fifteen minutes, aviation every fifteen minutes, marine hourly and optional ENTSO-E power-grid unavailability hourly. A faster data source never forces all other providers to refresh at that cadence.

Jobs have explicit timeouts and GitHub schedules remain best-effort. Failed or skipped jobs never invent fresh data or infer recovery from source absence.

## Release and verification

Run migrations using an administrative connection before deploying code that requires new tables. The Vercel reader and GitHub collectors deliberately use bounded database roles. Do not commit credentials or provider tokens.

Verify `/api/signals?mode=live`, `/api/events?status=active`, `/api/providers/status`, a quake detail, a fire detail and the relevant scheduled workflow runs. `npm run db:check` now also reports database footprint and largest tables. `npm run db:budget` gives the dedicated quota view.

Sensitive Vercel variables cannot be recovered with `vercel env pull`; empty/redacted pulled values do not mean the deployed runtime lacks them. Retrieve administrative connection details through the database provider's authorized interface instead.

Sources: [Aiven free plan](https://aiven.io/docs/products/postgresql/concepts/pg-free-tier), [Vercel sensitive variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables).
