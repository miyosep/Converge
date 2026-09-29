-- Each group selects one category, with 1-20 unique candidate IDs checked by the application.
-- Existing restaurant selections and frozen evaluation snapshots are preserved.
ALTER TABLE converge_groups DROP CONSTRAINT converge_groups_permitted_restaurant_ids_check;
ALTER TABLE converge_groups ADD CONSTRAINT converge_groups_permitted_restaurant_ids_check
  CHECK (jsonb_typeof(permitted_restaurant_ids) = 'array'
    AND jsonb_array_length(permitted_restaurant_ids) BETWEEN 1 AND 20
    AND (
    '["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T"]'::jsonb @> permitted_restaurant_ids
    OR
    '["stay-01","stay-02","stay-03","stay-04","stay-05","stay-06","stay-07","stay-08","stay-09","stay-10","stay-11","stay-12","stay-13","stay-14","stay-15","stay-16","stay-17","stay-18","stay-19","stay-20"]'::jsonb @> permitted_restaurant_ids
    OR
    '["space-01","space-02","space-03","space-04","space-05","space-06","space-07","space-08","space-09","space-10","space-11","space-12","space-13","space-14","space-15","space-16","space-17","space-18","space-19","space-20"]'::jsonb @> permitted_restaurant_ids
    OR
    '["sport-01","sport-02","sport-03","sport-04","sport-05","sport-06","sport-07","sport-08","sport-09","sport-10","sport-11","sport-12","sport-13","sport-14","sport-15","sport-16","sport-17","sport-18","sport-19","sport-20"]'::jsonb @> permitted_restaurant_ids
    OR
    '["class-01","class-02","class-03","class-04","class-05","class-06","class-07","class-08","class-09","class-10","class-11","class-12","class-13","class-14","class-15","class-16","class-17","class-18","class-19","class-20"]'::jsonb @> permitted_restaurant_ids
    ));
