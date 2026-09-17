# Hosted operation on a free PostgreSQL plan

The production web application runs on Vercel. Its database is a dedicated Aiven PostgreSQL `free-1-1gb` service. Vercel uses a read-only database role; the collector uses a separate role with data-write and temporary-table permissions. Both connections verify TLS against the provider CA. Provider API tokens and database credentials stay outside Git.

## Storage profile

Production uses `FIRMS_RAW_RETENTION_HOURS=48` and `FIRMS_RAW_SAMPLES_PER_CELL_HOUR=5`:

- Every validated, qualified NOAA-20 detection contributes to exact hourly H3-cell counts, quality sums and FRP sums/counts. Statistical calculations use **all qualified detections**, not the raw sample.
- Keep up to five representative raw observations per cell per hour for 48 hours, preferring qualified detections. These support clickable-signal evidence IDs. They are not a complete pixel archive.
- Keep hourly aggregates and explicit successful-hour coverage for 35 days. Missing hours remain unknown. Zero detections are inferred only within fully covered source hours.
- A complete feed replaces covered hourly aggregates atomically with raw sample updates. Repeated imports do not double-count; older feeds cannot overwrite newer aggregate revisions or retractions. A failed transaction cannot expose partial new history.
- Full USGS observations remain for 35 days. Old resolved signals expire after 35 days, provider runs after 40 days. Evidence snapshots are written only when calculation evidence changes; beyond two days, retain the latest snapshot per signal per UTC day, up to 35 days.

In compact mode, the baseline engine reads aggregate coverage rather than older raw-ingestion records. Enabling this mode on an existing database therefore requires a historical ingestion before old references become available. It never treats unaggregated history as zero.

The first successful hosted import analyzed 514,805 fire detections and retained 29,617 raw samples and 32,292 hourly cell aggregates. The database measured approximately 109 MB at that snapshot. Volume changes with real activity; retention reduces growth but is not a guarantee that an extreme workload can never reach the provider quota. Monitor the provider's usage dashboard. No paid plan or automatic upgrade has been activated.

## Automatic collection

`.github/workflows/ingest.yml` runs at minute 17 of each hour and can also be dispatched manually. It requires repository variable `WORLD_SIGNAL_INGEST_ENABLED=true` and secrets `WORLD_SIGNAL_DATABASE_URL` and `WORLD_SIGNAL_DATABASE_CA`. The worker performs one bounded pass with `npm run worker -- --once`: collect due providers, refresh wider history daily, recompute signals and apply retention.

Each job has a two-minute timeout, limiting scheduled runner allocation to at most 1,488 minutes for a 31-day month, excluding manual runs, CI and other repositories. This uses the GitHub account's included Actions allowance; actual account usage and billing controls still apply. No paid runner is configured. GitHub schedules are best-effort and can be delayed or skipped; failed jobs do not invent fresh data.

Production displays an approximately hourly collection cadence. Its USGS and analysis freshness budgets are 90 minutes; NASA's source budget remains four hours, with the separate latest-observation limit. A missed schedule eventually shows delayed data. A persistent worker can still run every five minutes on an independently hosted machine; the hourly schedule is the current low-cost deployment configuration, not a claim of second-by-second updates.

## Release and verification

Run migrations using an administrative connection before deploying code that requires new tables. The Vercel reader and GitHub collector deliberately cannot modify the schema. Local credentials for administration are stored in ignored `.env.aiven-production.local`; do not copy them into the browser or commit them.

Verify `/api/signals?mode=live` and `/api/providers/status` on the production domain, both provider timestamps, a quake detail, a fire detail and a successful collector workflow run. `npm run db:check` checks whichever environment is explicitly configured, not necessarily production.

Sensitive Vercel variables cannot be recovered with `vercel env pull`; empty/redacted pulled values do not mean the deployed runtime lacks them. Retrieve administrative connection details through the database provider's authorized interface instead. Use a nonstandard local filename such as `.env.hosted.local` so a download cannot silently override Next.js local development settings.

Sources: [Aiven free plan](https://aiven.io/docs/products/postgresql/concepts/pg-free-tier), [Vercel sensitive variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables).
