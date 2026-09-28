CREATE TABLE converge_evaluations (
  id text PRIMARY KEY,
  group_id text NOT NULL UNIQUE REFERENCES converge_groups(id),
  input_snapshot jsonb NOT NULL,
  internal_result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
