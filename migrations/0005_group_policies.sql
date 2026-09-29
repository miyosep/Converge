CREATE TABLE converge_group_policies (
  decision_id text PRIMARY KEY CHECK (decision_id ~ '^0x[0-9a-f]{64}$'),
  group_id text NOT NULL UNIQUE REFERENCES converge_groups(id),
  evaluation_id text NOT NULL UNIQUE REFERENCES converge_evaluations(id),
  policy jsonb NOT NULL,
  policy_hash text NOT NULL CHECK (policy_hash ~ '^0x[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A prepared policy is immutable. Replacement must be a separate decision lifecycle.
CREATE FUNCTION converge_reject_policy_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Prepared group policies are immutable';
END;
$$;
CREATE TRIGGER converge_group_policy_immutable
BEFORE UPDATE ON converge_group_policies
FOR EACH ROW EXECUTE FUNCTION converge_reject_policy_update();
