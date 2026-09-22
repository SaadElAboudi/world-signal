CREATE TABLE climate_references (
  cell_id text NOT NULL,
  extreme_kind text NOT NULL CHECK (extreme_kind IN ('heat','cold')),
  month_day text NOT NULL CHECK (month_day ~ '^[0-9]{2}-[0-9]{2}$'),
  mean_c double precision NOT NULL,
  stddev_c double precision NOT NULL CHECK (stddev_c >= 0),
  p10_c double precision NOT NULL,
  p90_c double precision NOT NULL,
  sample_count integer NOT NULL CHECK (sample_count > 0),
  reference_start date NOT NULL,
  reference_end date NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(cell_id, extreme_kind, month_day)
);

CREATE INDEX climate_references_computed_at ON climate_references(computed_at DESC);
