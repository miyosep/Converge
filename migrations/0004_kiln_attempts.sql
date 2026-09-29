CREATE TABLE converge_kiln_attempts (
  request_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  group_id text NOT NULL,
  wallet_address text NOT NULL,
  revision_id text NOT NULL,
  usage jsonb NOT NULL,
  http_status integer,
  error_code text,
  cost_usd numeric,
  cached_input_tokens integer,
  reasoning_tokens integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, attempt),
  FOREIGN KEY (group_id, wallet_address, revision_id)
    REFERENCES converge_preference_revisions(group_id, wallet_address, revision_id)
);

CREATE INDEX converge_kiln_attempts_revision_idx
  ON converge_kiln_attempts(group_id, wallet_address, revision_id);
