# Storage and collection budget

The free hosted profile uses an internal 1 GiB PostgreSQL budget, one scheduled
collector every four hours, and a persisted API ledger. See
[hosted operations](hosted-operations.md) for configuration and limits.

The worker checks database size before collection, contracts retention at 55%,
and blocks new observation/event collection at 65%, leaving headroom below the
70% operating target. This is not a guarantee about the provider's total disk:
WAL, concurrent writes, and an individual batch can use additional space.
Deleting rows frees reusable PostgreSQL space; it does not immediately shrink files.

Run migrations once with the administrator before deploying. Scheduled jobs use
the restricted worker role, never migration privileges. Web requests use a
SELECT-only role and only read cached context.

Run `npm run ops:status` for measured database size and API reservations.
No paid plan or automatic upgrade is enabled. Account-level spending caps and
usage outside this application remain the operator's responsibility.
