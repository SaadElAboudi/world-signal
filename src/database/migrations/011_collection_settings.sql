CREATE TABLE IF NOT EXISTS collection_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  cadence_minutes integer NOT NULL CHECK (cadence_minutes BETWEEN 5 AND 1440),
  updated_at timestamptz NOT NULL DEFAULT now()
);
