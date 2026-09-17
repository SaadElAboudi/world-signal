ALTER TABLE provider_runs ADD COLUMN analysed_at timestamptz;
ALTER TABLE provider_runs ADD COLUMN analysis_error text;
