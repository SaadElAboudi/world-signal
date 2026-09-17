-- Operator-visible registration metadata. Provider implementation and thresholds stay in versioned code.
CREATE TABLE provider_registry (
  id text PRIMARY KEY,
  name text NOT NULL,
  signal_type text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO provider_registry(id,name,signal_type) VALUES
('usgs','USGS Earthquake Hazards Program','earthquake'),
('firms','NASA FIRMS NOAA-20 VIIRS','wildfire');
