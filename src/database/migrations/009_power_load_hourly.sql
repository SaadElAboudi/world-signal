CREATE TABLE IF NOT EXISTS power_load_hourly (
  provider text NOT NULL,
  region_id text NOT NULL,
  bucket_hour timestamptz NOT NULL,
  load_mw double precision NOT NULL CHECK (load_mw >= 0),
  source_updated_at timestamptz NOT NULL,
  PRIMARY KEY (provider, region_id, bucket_hour)
);

CREATE INDEX IF NOT EXISTS power_load_hourly_region_time_idx
  ON power_load_hourly (provider, region_id, bucket_hour DESC);
