-- Groups can gather private preferences before the first venue search.
ALTER TABLE converge_live_plans ALTER COLUMN search_id DROP NOT NULL;

ALTER TABLE converge_live_preferences
  DROP CONSTRAINT converge_live_preferences_status_check;
ALTER TABLE converge_live_preferences
  ADD CONSTRAINT converge_live_preferences_status_check
  CHECK (status IN ('draft', 'extracting', 'review', 'failed'));
