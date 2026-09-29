CREATE TABLE converge_live_preferences (
  group_id text NOT NULL,
  wallet_address text NOT NULL,
  revision_id text NOT NULL,
  raw_text text NOT NULL,
  extraction jsonb,
  confirmed boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('extracting','review','failed')),
  PRIMARY KEY(group_id,wallet_address),
  FOREIGN KEY(group_id,wallet_address) REFERENCES converge_participants(group_id,wallet_address) ON DELETE CASCADE
);
ALTER TABLE converge_live_plans
  ADD COLUMN search_token text,
  ADD COLUMN search_started_at timestamptz;

CREATE FUNCTION converge_invalidate_live_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE converge_live_plans SET votes='{}',
    snapshot=jsonb_set(snapshot,'{recommendationReady}','false'),
    search_token=NULL,search_started_at=NULL
  WHERE group_id=CASE WHEN TG_OP='DELETE' THEN OLD.group_id ELSE NEW.group_id END;
  RETURN NULL;
END;
$$;
CREATE TRIGGER converge_live_membership_changed AFTER INSERT OR DELETE ON converge_participants
FOR EACH ROW EXECUTE FUNCTION converge_invalidate_live_membership();

CREATE TABLE converge_live_usage (
  group_id text NOT NULL REFERENCES converge_groups(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  attempt integer NOT NULL,
  usage jsonb NOT NULL,
  PRIMARY KEY(group_id,request_id,attempt)
);
