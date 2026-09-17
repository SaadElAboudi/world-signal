-- Counts preserve the exact (start, end] convention used by the anomaly engine.
-- Only complete, validated source hours are replaced. Raw current detections stay separate.
CREATE TABLE fire_hourly (
  hour_end timestamptz NOT NULL,
  cell_id text NOT NULL,
  detections integer NOT NULL CHECK (detections > 0),
  quality_sum double precision NOT NULL,
  frp_total double precision,
  frp_count integer NOT NULL,
  first_at timestamptz NOT NULL,
  last_at timestamptz NOT NULL,
  high integer NOT NULL,
  nominal integer NOT NULL,
  source_as_of timestamptz NOT NULL,
  PRIMARY KEY (hour_end,cell_id)
);
CREATE TABLE fire_hour_coverage (
  hour_end timestamptz PRIMARY KEY,
  source_as_of timestamptz NOT NULL
);
