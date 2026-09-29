-- Expand each category to 40 candidates without rewriting saved shortlists or snapshots.
ALTER TABLE converge_groups DROP CONSTRAINT converge_groups_permitted_restaurant_ids_check;
ALTER TABLE converge_groups ADD CONSTRAINT converge_groups_permitted_restaurant_ids_check
  CHECK (jsonb_typeof(permitted_restaurant_ids) = 'array'
    AND jsonb_array_length(permitted_restaurant_ids) BETWEEN 1 AND 40
    AND (
    '["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z","AA","AB","AC","AD","AE","AF","AG","AH","AI","AJ","AK","AL","AM","AN"]'::jsonb @> permitted_restaurant_ids
    OR
    '["stay-01","stay-02","stay-03","stay-04","stay-05","stay-06","stay-07","stay-08","stay-09","stay-10","stay-11","stay-12","stay-13","stay-14","stay-15","stay-16","stay-17","stay-18","stay-19","stay-20","stay-21","stay-22","stay-23","stay-24","stay-25","stay-26","stay-27","stay-28","stay-29","stay-30","stay-31","stay-32","stay-33","stay-34","stay-35","stay-36","stay-37","stay-38","stay-39","stay-40"]'::jsonb @> permitted_restaurant_ids
    OR
    '["space-01","space-02","space-03","space-04","space-05","space-06","space-07","space-08","space-09","space-10","space-11","space-12","space-13","space-14","space-15","space-16","space-17","space-18","space-19","space-20","space-21","space-22","space-23","space-24","space-25","space-26","space-27","space-28","space-29","space-30","space-31","space-32","space-33","space-34","space-35","space-36","space-37","space-38","space-39","space-40"]'::jsonb @> permitted_restaurant_ids
    OR
    '["sport-01","sport-02","sport-03","sport-04","sport-05","sport-06","sport-07","sport-08","sport-09","sport-10","sport-11","sport-12","sport-13","sport-14","sport-15","sport-16","sport-17","sport-18","sport-19","sport-20","sport-21","sport-22","sport-23","sport-24","sport-25","sport-26","sport-27","sport-28","sport-29","sport-30","sport-31","sport-32","sport-33","sport-34","sport-35","sport-36","sport-37","sport-38","sport-39","sport-40"]'::jsonb @> permitted_restaurant_ids
    OR
    '["class-01","class-02","class-03","class-04","class-05","class-06","class-07","class-08","class-09","class-10","class-11","class-12","class-13","class-14","class-15","class-16","class-17","class-18","class-19","class-20","class-21","class-22","class-23","class-24","class-25","class-26","class-27","class-28","class-29","class-30","class-31","class-32","class-33","class-34","class-35","class-36","class-37","class-38","class-39","class-40"]'::jsonb @> permitted_restaurant_ids
    ));
