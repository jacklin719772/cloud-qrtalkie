ALTER TABLE access_entrances
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 0 AFTER name;
