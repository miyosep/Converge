-- Existing groups and recorded six-person policies retain their original size.
ALTER TABLE converge_groups
  ADD COLUMN target_member_count integer NOT NULL DEFAULT 6
    CHECK (target_member_count BETWEEN 2 AND 100);

ALTER TABLE converge_group_invites
  DROP CONSTRAINT converge_group_invites_max_uses_check;
ALTER TABLE converge_group_invites
  ADD CONSTRAINT converge_group_invites_max_uses_check
    CHECK (max_uses BETWEEN 1 AND 99);
