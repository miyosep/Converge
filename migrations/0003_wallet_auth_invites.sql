CREATE TABLE converge_auth_challenges (
  id text PRIMARY KEY,
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  message text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX converge_auth_challenges_expiry_idx
  ON converge_auth_challenges(expires_at);

CREATE TABLE converge_auth_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX converge_auth_sessions_wallet_idx
  ON converge_auth_sessions(wallet_address, expires_at DESC);

CREATE TABLE converge_group_invites (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  group_id text NOT NULL REFERENCES converge_groups(id),
  created_by_wallet text NOT NULL,
  max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 5),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (group_id, created_by_wallet)
    REFERENCES converge_participants(group_id, wallet_address)
);

CREATE INDEX converge_group_invites_group_idx
  ON converge_group_invites(group_id, expires_at DESC);
