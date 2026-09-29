-- Retain the dispatch timestamp for rate limiting after work is acknowledged.
ALTER TABLE converge_job_wakeups ADD COLUMN acknowledged_at timestamptz;
