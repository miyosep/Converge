CREATE TABLE converge_discovery_searches (
  id text PRIMARY KEY,
  owner_wallet text NOT NULL,
  request jsonb NOT NULL,
  result jsonb NOT NULL,
  selected_place_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX converge_discovery_owner ON converge_discovery_searches(owner_wallet, created_at DESC);

CREATE TABLE converge_live_plans (
  group_id text PRIMARY KEY REFERENCES converge_groups(id) ON DELETE CASCADE,
  search_id text NOT NULL REFERENCES converge_discovery_searches(id),
  snapshot jsonb NOT NULL,
  votes jsonb NOT NULL DEFAULT '{}'
);

-- Live plans use explicit unanimous candidate selection instead of a synthetic
-- catalog evaluation. Existing evaluation-backed policies remain unchanged.
ALTER TABLE converge_group_policies ALTER COLUMN evaluation_id DROP NOT NULL;
CREATE INDEX converge_explore_owner ON converge_explore_runs(lower(data->>'judge'));
