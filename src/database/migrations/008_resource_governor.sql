CREATE TABLE IF NOT EXISTS api_usage_daily (
  provider text NOT NULL,
  usage_date date NOT NULL,
  calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  units numeric NOT NULL DEFAULT 0 CHECK (units >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, usage_date)
);

CREATE INDEX IF NOT EXISTS api_usage_daily_date_idx
  ON api_usage_daily (usage_date);
