CREATE TABLE stories (
  id text PRIMARY KEY,
  correlation_id text NOT NULL UNIQUE REFERENCES correlated_events(id) ON DELETE CASCADE,
  fingerprint text NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('detected','developing','corroborated','confirmed','unexplained','resolved')),
  explanation_status text NOT NULL CHECK (explanation_status IN ('pending','reported','corroborated','unexplained','unavailable')),
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz,
  payload jsonb NOT NULL
);

CREATE INDEX stories_current_idx ON stories (status, updated_at DESC);
CREATE INDEX stories_started_idx ON stories (started_at DESC);

CREATE TABLE story_members (
  story_id text NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  signal_id text NOT NULL REFERENCES signals(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, signal_id)
);
