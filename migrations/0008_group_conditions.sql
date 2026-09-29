ALTER TABLE converge_groups
  ADD COLUMN permitted_restaurant_ids jsonb NOT NULL DEFAULT '["A","B","C","D","E"]'::jsonb
  CHECK (jsonb_typeof(permitted_restaurant_ids) = 'array'
    AND jsonb_array_length(permitted_restaurant_ids) BETWEEN 1 AND 5
    AND '["A","B","C","D","E"]'::jsonb @> permitted_restaurant_ids);
