CREATE TABLE converge_calendar_connections (
  wallet_address text PRIMARY KEY CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  google_subject text NOT NULL,
  email text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  needs_reconnect boolean NOT NULL DEFAULT false,
  connected_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE converge_calendar_oauth_states (
  state_hash text PRIMARY KEY,
  session_hash text NOT NULL REFERENCES converge_auth_sessions(token_hash),
  wallet_address text NOT NULL,
  group_id text NOT NULL REFERENCES converge_groups(id) ON DELETE CASCADE,
  verifier_encrypted text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE converge_calendar_jobs (
  group_id text NOT NULL,
  wallet_address text NOT NULL,
  google_subject text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 15 AND 10080),
  enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','synced','retry','blocked')),
  event_id text,
  event_url text,
  error_code text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, wallet_address),
  FOREIGN KEY (group_id, wallet_address) REFERENCES converge_participants(group_id, wallet_address) ON DELETE CASCADE
);
CREATE INDEX converge_calendar_pending ON converge_calendar_jobs(next_attempt_at) WHERE enabled AND status IN ('waiting','retry');
