-- Durable serverless state. Signed payloads are private and never projected to APIs.
CREATE TABLE converge_job_leases (
  name text PRIMARY KEY,
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE converge_explore_runs (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE converge_job_transactions (
  id text PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('explore','group')),
  signer text NOT NULL,
  journal jsonb NOT NULL,
  reserved_wei numeric(78,0) NOT NULL CHECK (reserved_wei >= 0),
  confirmed boolean NOT NULL DEFAULT false,
  failed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX converge_one_pending_per_signer ON converge_job_transactions(signer) WHERE NOT confirmed;
INSERT INTO converge_job_transactions(id,scope,signer,journal,reserved_wei,confirmed,failed)
 SELECT 'group:' || decision_id,'group',lower(journal->'intent'->>'from'),journal,reserved_wei,status<>'pending',status='reverted'
 FROM converge_group_execution;
CREATE TABLE converge_job_health (
  name text PRIMARY KEY,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE converge_explore_attempts (
  id text PRIMARY KEY,
  attempt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE converge_job_wakeups (
  name text PRIMARY KEY,
  dispatched_at timestamptz NOT NULL DEFAULT now()
);
