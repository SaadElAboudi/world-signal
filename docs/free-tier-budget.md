# WORLD SIGNAL storage and collection budget

The hosted database uses Aiven Free (1 GB). Keep `DATABASE_POOL_MAX=2` in scheduled jobs and check actual disk consumption before expanding collection coverage. There is currently no automatic disk-budget circuit breaker; do not treat a target size as an enforced limit.

## Implemented retention

- FIRMS hosted configuration: 48 hours of raw data, at most five raw samples per cell/hour; hourly aggregates preserve the reference history.
- USGS, IODA and aviation observations: 35 days in compact mode. Aviation also prunes during its analysis.
- Resolved signals, correlation versions and correlation runs: 35 days.
- Provider runs: 40 days.
- World-event change history: 30 days; resolved world events: 35 days.
- Weather and marine API arrays are evaluated in memory; normalized events and compact climate references are retained.

The worker calls `maintainCompactStorage`; PostgreSQL can reuse space after deletion but disk size does not immediately shrink. `db:budget` and `db:compact` are not implemented commands.

## Deployment and collection

Run `npm run db:migrate` once with the database administrator credentials before deploying schema changes. The migration runner recognizes the byte-identical local `005_correlations.sql` draft as `008_correlations.sql`. It does not overwrite an altered migration.

Scheduled collectors use the restricted worker role and never run schema migrations. The Vercel application uses the read-only role. New tables need the corresponding default privileges; check these when changing owners or provisioning a new database.

Collectors run on independent schedules defined in `.github/workflows`. GitHub scheduled jobs can be delayed. The UI reports collection time, source time, coverage and reference-history availability rather than promising continuous real-time coverage. API failures must not be interpreted as normal measurements or automatic recovery.

Open-Meteo's free endpoint is for non-commercial use. Its batched requests reduce usage; consult its terms before commercial deployment. Do not claim an enforced daily request budget: the current collectors bound each batch, not total account-wide daily usage.
