CREATE TABLE world_events (
  id text PRIMARY KEY,
  provider text NOT NULL,
  upstream_id text NOT NULL,
  category text NOT NULL,
  type text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','resolved')),
  severity text NOT NULL CHECK (severity IN ('info','notable','elevated','significant')),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  ended_at timestamptz,
  fingerprint text NOT NULL,
  payload jsonb NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, upstream_id)
);

CREATE INDEX world_events_status_updated_idx
  ON world_events(status, updated_at DESC);
CREATE INDEX world_events_category_type_idx
  ON world_events(category, type, updated_at DESC);
CREATE INDEX world_events_location_idx
  ON world_events(latitude, longitude);

CREATE TABLE world_event_history (
  id bigserial PRIMARY KEY,
  event_id text NOT NULL,
  fingerprint text NOT NULL,
  payload jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX world_event_history_event_idx
  ON world_event_history(event_id, captured_at DESC);
