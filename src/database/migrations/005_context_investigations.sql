CREATE TABLE context_investigations (
  subject_type text NOT NULL CHECK (subject_type IN ('signal','correlated_event')),
  subject_id text NOT NULL,
  investigation jsonb NOT NULL,
  status text NOT NULL,
  corroboration_status text NOT NULL DEFAULT 'none',
  retrieval_status text NOT NULL,
  created_at timestamptz NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (subject_type, subject_id)
);

CREATE INDEX context_investigations_refresh_idx
  ON context_investigations (expires_at, refreshed_at);

CREATE INDEX context_investigations_status_idx
  ON context_investigations (status, corroboration_status, refreshed_at DESC);

CREATE TABLE context_investigation_history (
  id bigserial PRIMARY KEY,
  subject_type text NOT NULL CHECK (subject_type IN ('signal','correlated_event')),
  subject_id text NOT NULL,
  investigation jsonb NOT NULL,
  status text NOT NULL,
  corroboration_status text NOT NULL DEFAULT 'none',
  retrieval_status text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX context_investigation_history_subject_idx
  ON context_investigation_history (subject_type, subject_id, captured_at DESC);
