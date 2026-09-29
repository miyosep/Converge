-- Existing groups keep their original selection. New groups can choose A–T.
ALTER TABLE converge_groups DROP CONSTRAINT converge_groups_permitted_restaurant_ids_check;
ALTER TABLE converge_groups ADD CONSTRAINT converge_groups_permitted_restaurant_ids_check
  CHECK (jsonb_typeof(permitted_restaurant_ids) = 'array'
    AND jsonb_array_length(permitted_restaurant_ids) BETWEEN 1 AND 20
    AND '["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T"]'::jsonb @> permitted_restaurant_ids);
