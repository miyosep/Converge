CREATE TABLE converge_group_execution (
  decision_id text PRIMARY KEY REFERENCES converge_group_policies(decision_id),
  transaction_hash text NOT NULL CHECK (transaction_hash ~ '^0x[0-9a-f]{64}$'),
  journal jsonb NOT NULL,
  reserved_wei numeric(78,0) NOT NULL CHECK (reserved_wei >= 0),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'reverted')),
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Signed payloads are worker-private. Public queries explicitly omit journal.
CREATE TABLE converge_group_chain_snapshots (
  decision_id text PRIMARY KEY REFERENCES converge_group_policies(decision_id),
  block_number bigint NOT NULL,
  block_hash text NOT NULL,
  state jsonb NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE converge_group_chain_events (
  decision_id text NOT NULL REFERENCES converge_group_policies(decision_id),
  transaction_hash text NOT NULL,
  log_index integer NOT NULL,
  block_number bigint NOT NULL,
  event jsonb NOT NULL,
  PRIMARY KEY (decision_id, transaction_hash, log_index)
);
CREATE INDEX converge_group_events_order ON converge_group_chain_events(decision_id, block_number, log_index);
