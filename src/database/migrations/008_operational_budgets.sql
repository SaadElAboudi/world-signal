CREATE TABLE IF NOT EXISTS api_usage_daily (
  provider text NOT NULL,
  usage_date date NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(provider, usage_date)
);

CREATE TABLE IF NOT EXISTS storage_budget_snapshots (
  captured_at timestamptz PRIMARY KEY,
  database_bytes bigint NOT NULL CHECK (database_bytes >= 0),
  soft_limit_bytes bigint NOT NULL CHECK (soft_limit_bytes > 0),
  hard_limit_bytes bigint NOT NULL CHECK (hard_limit_bytes >= soft_limit_bytes),
  state text NOT NULL CHECK (state IN ('normal','soft_limit','hard_limit'))
);

CREATE INDEX IF NOT EXISTS storage_budget_snapshots_recent_idx
  ON storage_budget_snapshots(captured_at DESC);
