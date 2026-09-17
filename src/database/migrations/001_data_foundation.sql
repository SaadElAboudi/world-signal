CREATE TABLE provider_runs (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running','success','failed','unavailable')),
  records_received integer NOT NULL DEFAULT 0,
  records_inserted integer NOT NULL DEFAULT 0,
  records_updated integer NOT NULL DEFAULT 0,
  records_rejected integer NOT NULL DEFAULT 0,
  coverage_start timestamptz,
  coverage_end timestamptz,
  source_as_of timestamptz,
  latest_observation_at timestamptz,
  error_code text,
  history boolean NOT NULL DEFAULT false
);
CREATE INDEX provider_runs_provider_started ON provider_runs(provider, started_at DESC);
CREATE INDEX provider_runs_success ON provider_runs(provider, finished_at DESC) WHERE status='success';
CREATE TABLE observations (
  id text PRIMARY KEY,
  provider text NOT NULL,
  upstream_id text NOT NULL,
  type text NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  occurred_at timestamptz NOT NULL,
  source_updated_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  value double precision,
  cell_id text NOT NULL,
  quality double precision NOT NULL CHECK (quality BETWEEN 0 AND 1),
  properties jsonb NOT NULL,
  source_url text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  UNIQUE(provider, upstream_id)
);
CREATE INDEX observations_time ON observations(occurred_at DESC);
CREATE INDEX observations_provider_time ON observations(provider, occurred_at DESC);
CREATE INDEX observations_cell_time ON observations(provider, cell_id, occurred_at DESC) WHERE active;
CREATE INDEX observations_type_time ON observations(type, occurred_at DESC);
CREATE INDEX observations_location ON observations(latitude, longitude);
CREATE TABLE signals (
  id text PRIMARY KEY,
  provider text NOT NULL,
  type text NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('notable','elevated','significant')),
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  observed_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz,
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  payload jsonb NOT NULL
);
CREATE INDEX signals_time ON signals(observed_at DESC);
CREATE INDEX signals_type_severity_time ON signals(type, severity, observed_at DESC);
CREATE INDEX signals_location ON signals(latitude, longitude);
CREATE INDEX signals_provider_active ON signals(provider) WHERE resolved_at IS NULL;
CREATE TABLE signal_evidence (
  id bigserial PRIMARY KEY,
  signal_id text NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  computed_at timestamptz NOT NULL,
  evidence jsonb NOT NULL,
  UNIQUE(signal_id, computed_at)
);
CREATE INDEX signal_evidence_signal_time ON signal_evidence(signal_id, computed_at DESC);
