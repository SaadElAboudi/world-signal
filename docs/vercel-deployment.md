# Vercel production connection

For the currently configured Aiven deployment, use the [hosted operation guide](hosted-operations.md). The steps below also describe alternative full-storage deployments.

A successful Vercel build deploys the web application. It does **not** transfer the local PostgreSQL cluster or start `npm run worker`. The hosted application needs both a hosted PostgreSQL database and an independently running ingestion worker.

## 1. Connect hosted PostgreSQL

Use a dedicated existing database or create one through Vercel's Storage/Marketplace interface. Confirm its storage capacity and plan before provisioning: the initial local ingestion used hundreds of thousands of observations, and the database itself measured 768 MB and the local cluster occupied roughly 1.4 GB including indexes/WAL. This is not an exact hosted-storage requirement, but a tiny free database may be insufficient.

In the WORLD SIGNAL project's **Production** environment, configure:

```dotenv
WORLD_SIGNAL_MODE=live
DATABASE_URL=<hosted PostgreSQL connection string, with the provider's TLS settings>
FIRMS_TRANSPORT=public
```

This application reads `DATABASE_URL`. If the integration supplies a different variable name, map its PostgreSQL connection string to `DATABASE_URL`. Do not use the example `127.0.0.1:55432` connection in Vercel: it addresses the deployed process itself, not the development Mac. Never paste credentials into a chat or commit an environment file.

Redeploy after changing production environment variables. Configure Preview separately if it needs live data; prefer a separate test database rather than exposing production writes to previews.

## 2. Initialize the hosted schema and observations

With Vercel CLI authenticated, link the correct project and pull production environment into an ignored file:

```sh
vercel login
vercel link
vercel env pull .env.hosted.local --environment=production
chmod 600 .env.hosted.local
```

Sensitive variables are not readable through `vercel env pull`. If connection values are blank/redacted, obtain them from the database provider through its authorized interface and save them in the ignored file.

Use Node's explicit environment file so the existing local `.env.local` database does not accidentally become the initialization target:

```sh
node --env-file=.env.hosted.local --import=tsx scripts/check-db.ts
node --env-file=.env.hosted.local --import=tsx scripts/migrate.ts
node --env-file=.env.hosted.local --import=tsx scripts/seed.ts
node --env-file=.env.hosted.local --import=tsx scripts/ingest.ts all --history
node --env-file=.env.hosted.local --import=tsx scripts/check-db.ts
```

The first check can report missing schema before migration; this is expected. These commands must run from the repository root on Node 20.9+ with dependencies installed. `db:check` is read-only, prints safe diagnostic labels and collection/analysis times, and never prints the connection string or raw database exceptions. Without an explicit production environment it checks the normal local development configuration.

Use a direct PostgreSQL connection or a session-mode pool for migrations and ingestion. Their advisory locks and staging tables require session affinity; do not run those jobs through a transaction-mode pool. The web reader can use the provider's pooled endpoint.

## 3. Keep ingestion running

Run `npm run worker` on a persistent worker service or server, using the same hosted database and source settings. Install dependencies first; the worker uses `tsx`, currently a development dependency. Keep the process supervised and restart it after a release.

For a temporary verification from the development machine:

```sh
node --env-file=.env.hosted.local --import=tsx scripts/worker.ts
```

This temporary process stops collecting when the terminal or machine stops. It is not a durable production service. Do not add the worker to the Next.js build command: it never exits. Do not rely on a normal page request to ingest data.

Vercel cron jobs invoke time-limited functions, and Hobby scheduling is restricted to daily runs. This implementation requires five-minute USGS/analysis updates, so the existing persistent worker is the supported deployment path. No paid service or scheduler is provisioned automatically by this repository.

## 4. Verify production

Inspect the deployed `/api/signals?mode=live` and `/api/providers/status`. Expect successful collection/analysis timestamps, actual observations and explicit healthy/delayed states. A working schema without ingested observations is not a healthy live deployment. Insufficient reference history remains provisional.

`database unavailable` means the read path failed; it can be a missing variable, unreachable database, authentication/TLS problem or missing migrations. It does not by itself establish an outage at USGS or NASA. Use the read-only check with the same environment to distinguish configuration/schema issues before changing providers.

References: [Vercel Postgres integrations](https://vercel.com/docs/postgres), [Marketplace storage](https://vercel.com/docs/marketplace-storage), [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
