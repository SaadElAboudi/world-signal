# Hosted operation on free tiers

WORLD SIGNAL is deliberately operated as a **bounded observatory**, not as a raw mirror of every upstream feed. Production runs on Vercel with a dedicated Aiven PostgreSQL `free-1-1gb` service. Vercel uses a read-only database role; the collector uses a separate write role. Provider tokens and database credentials stay outside Git.

## The three budgets

The free deployment has three independent resources to protect:

1. **PostgreSQL disk** — the Aiven free PostgreSQL service currently has a 1 GiB disk budget.
2. **External APIs** — some providers publish quotas, some do not, and terms can change.
3. **GitHub Actions minutes** — a private repository on GitHub Free currently receives 2,000 hosted-runner minutes per month.

A system that respects only API quotas can still fail because of database growth or scheduler minutes. WORLD SIGNAL therefore governs all three.

## Storage governor

Set:

```sh
DATABASE_STORAGE_QUOTA_BYTES=1073741824
```

`pg_database_size(current_database())` is checked by the collector and mapped to four pressure levels:

| Pressure | Database usage | Default response |
| --- | ---: | --- |
| `normal` | <55% | normal compact retention |
| `watch` | ≥55% | shorten secondary history and representative raw fire evidence |
| `conserve` | ≥70% | stronger compaction |
| `critical` | ≥82% | preserve current state/baselines, aggressively shorten expendable history, skip storage-sensitive collectors |

At a 1 GiB quota, those thresholds are roughly 563 MiB, 717 MiB and 840 MiB. The system intentionally reacts **before** disk exhaustion.

### Adaptive retention

Normal hosted profile:

- representative FIRMS raw observations: 48 h / up to five samples per cell-hour;
- fire hourly aggregates and coverage: 35 days;
- USGS observations: 35 days;
- resolved signals: 35 days;
- provider runs: 40 days;
- universal-event state history: 30 days;
- resolved universal events: 35 days.

Under `critical` pressure this contracts to approximately:

- representative FIRMS raw observations: 12 h / one sample per cell-hour;
- fire aggregate history: 14 days;
- observation/signal history: 14 days;
- provider-run history: 14 days;
- universal-event history: 7 days;
- resolved universal events: 14 days.

The order matters: WORLD SIGNAL discards **duplicative/raw evidence before current state and compact baselines**. Detection should survive pressure longer than detailed historical proof.

The first documented hosted import analyzed 514,805 fire detections while retaining only 29,617 representative raw samples and 32,292 hourly cell aggregates; the database was approximately 109 MB at that snapshot. Real activity varies, so the governor is still required.

## API-call governor

`api_usage_daily` contains one tiny row per provider per UTC day. A collector reserves its expected call count transactionally **before** making external requests. If the daily or monthly internal budget would be crossed, the collector returns `budget_limited` instead of calling the provider.

Default WORLD SIGNAL safety caps:

| Provider group | Daily | Monthly | Current hosted hourly usage ceiling |
| --- | ---: | ---: | ---: |
| EONET | 200 | 5,000 | ~24/day |
| Open-Meteo weather + archive + marine | 5,000 | 120,000 | normally <300/day once climatology cache is warm |
| IODA | 500 | 14,000 | ~24/day |
| ADSB.lol | 2,500 | 70,000 | ~480/day at 20 sentinel requests/hour |
| ENTSO-E | 200 | 5,000 | 144/day when enabled (6 zones/hour) |
| Context (GDELT + GDACS) | 2,500 | 60,000 | bounded by investigation demand |

These are **internal safety limits**, not assertions about upstream quotas. Provider terms remain authoritative and must be reviewed before raising them. The Open-Meteo free endpoint is suitable only under its current non-commercial/evaluation terms; a commercial WORLD SIGNAL deployment must use the appropriate commercial endpoint/plan or another licensed source.

Context retrieval degrades safely: when its external-call budget is exhausted, an existing stale investigation can be reused rather than creating unbounded searches.

Inspect the live budgets with:

```sh
npm run ops:status
```

The command prints database MiB, quota percentage, pressure state and current provider call counts without exposing credentials.

## GitHub Actions budget

The private repository must stay within the account's included Actions minutes. Running separate 5-minute and 15-minute cron workflows would create thousands of jobs per month before CI is counted.

Production therefore uses **one scheduled workflow per hour**: `.github/workflows/ingest.yml`. One checkout + one `npm ci` performs the bounded worker pass for:

- USGS;
- FIRMS;
- signal computation;
- EONET;
- Open-Meteo weather/climatology;
- IODA;
- Open-Meteo Marine;
- ADSB.lol aviation sentinels;
- ENTSO-E when explicitly enabled;
- Context Engine refresh;
- retention/compaction.

This means at most about 720 scheduled job starts in a 30-day month, rather than several thousand. Actual billed minutes depend on real runtime, and CI also consumes the same account allowance. The old fast refresh workflows remain available via `workflow_dispatch` for manual diagnostics but have **no automatic schedule** in the free-tier profile.

The code still supports faster provider cadences. A future persistent/self-hosted worker can restore 5–15 minute collection without consuming GitHub-hosted runner minutes.

## ENTSO-E power layer

The first power layer stores one actual-load value per selected European bidding zone per hour. It does **not** mirror ENTSO-E datasets and does not claim to detect every household/grid outage.

It is opt-in:

```sh
ENTSOE_ENABLED=true
ENTSOE_SECURITY_TOKEN=...
```

To obtain API access, register on the ENTSO-E Transparency Platform, request REST API access according to ENTSO-E's current process, generate a token, then store it as the GitHub secret `ENTSOE_SECURITY_TOKEN` and set repository variable `ENTSOE_ENABLED=true`.

The detector requires at least seven historical matched same-UTC-hour weekday/weekend samples. A 20%/35%/50% load reduction maps to notable/elevated/significant. The resulting event is `power_grid_anomaly`; it is explicitly **not** a confirmed customer `power_outage` and no cause is inferred.

## Failure semantics

Provider failure never means recovery:

- Open-Meteo failure does not resolve weather events;
- IODA failure does not imply Internet recovery;
- ADSB.lol failure does not resolve aviation disruption;
- partial ENTSO-E coverage does not resolve missing regional power events;
- budget exhaustion is reported as a degraded collection state, not as absence of an event;
- demo data is never substituted into live mode.

## Release and verification

Database migrations must run before collectors use new tables. The hosted workflow does this before every bounded pass.

Useful checks:

```sh
npm run db:check
npm run ops:status
npm run lint
npm run typecheck
npm test
npm run test:db
npm run build
npm run test:e2e
```

Production verification should include `/api/signals?mode=live`, `/api/events?status=active`, `/api/providers/status`, one signal detail, one contextual investigation, World Feed, and the scheduled collector workflow.

No paid plan or automatic database upgrade is enabled by this repository. Any quota increase remains an explicit operator decision.
