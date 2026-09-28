CREATE TABLE converge_groups (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  reservation_starts_at timestamptz NOT NULL,
  reservation_time_zone text NOT NULL,
  creator_wallet text NOT NULL CHECK (creator_wallet ~ '^0x[0-9a-f]{40}$'),
  preferences_locked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE converge_participants (
  group_id text NOT NULL REFERENCES converge_groups(id),
  wallet_address text NOT NULL CHECK (wallet_address ~ '^0x[0-9a-f]{40}$'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  current_revision_id text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, wallet_address)
);

CREATE TABLE converge_preference_revisions (
  group_id text NOT NULL,
  wallet_address text NOT NULL,
  revision_id text NOT NULL,
  raw_text text NOT NULL CHECK (char_length(raw_text) BETWEEN 1 AND 4000),
  status text NOT NULL CHECK (status IN (
    'PARSING', 'AWAITING_CONFIRMATION', 'NEEDS_CLARIFICATION',
    'PARSE_FAILED', 'CONFIRMED'
  )),
  extraction jsonb,
  confirmed_at timestamptz,
  error_code text CHECK (error_code IS NULL OR error_code = 'EXTRACTION_FAILED'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, wallet_address, revision_id),
  FOREIGN KEY (group_id, wallet_address)
    REFERENCES converge_participants(group_id, wallet_address),
  CHECK (
    (status IN ('PARSING', 'PARSE_FAILED') AND extraction IS NULL)
    OR (status IN ('AWAITING_CONFIRMATION', 'NEEDS_CLARIFICATION', 'CONFIRMED')
      AND extraction IS NOT NULL)
  ),
  CHECK ((status = 'CONFIRMED') = (confirmed_at IS NOT NULL)),
  CHECK ((status = 'PARSE_FAILED') = (error_code IS NOT NULL))
);

ALTER TABLE converge_participants
  ADD CONSTRAINT converge_current_revision_fk
  FOREIGN KEY (group_id, wallet_address, current_revision_id)
  REFERENCES converge_preference_revisions(group_id, wallet_address, revision_id);

CREATE INDEX converge_preference_revisions_created_idx
  ON converge_preference_revisions(group_id, wallet_address, created_at DESC);
