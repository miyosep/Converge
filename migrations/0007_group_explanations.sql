CREATE TABLE converge_group_explanations (
  evaluation_id text PRIMARY KEY REFERENCES converge_evaluations(id) ON DELETE CASCADE,
  group_id text NOT NULL REFERENCES converge_groups(id),
  status text NOT NULL CHECK (status IN ('GENERATING', 'KILN', 'FALLBACK')),
  claim_token text NOT NULL,
  lease_until timestamptz NOT NULL,
  reason_ids jsonb,
  explanation text,
  cache_hits integer NOT NULL DEFAULT 0 CHECK (cache_hits >= 0),
  completed_at timestamptz,
  CHECK ((status = 'GENERATING' AND explanation IS NULL AND reason_ids IS NULL)
      OR (status <> 'GENERATING' AND explanation IS NOT NULL AND reason_ids IS NOT NULL
          AND completed_at IS NOT NULL))
);

CREATE TABLE converge_kiln_evaluation_attempts (
  request_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  group_id text NOT NULL REFERENCES converge_groups(id),
  evaluation_id text NOT NULL REFERENCES converge_evaluations(id) ON DELETE CASCADE,
  usage jsonb NOT NULL,
  http_status integer,
  error_code text,
  cost_usd numeric,
  cached_input_tokens integer,
  reasoning_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, attempt)
);

CREATE INDEX converge_kiln_evaluation_attempts_group_idx
  ON converge_kiln_evaluation_attempts(group_id, evaluation_id);
