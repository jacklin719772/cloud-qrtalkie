ALTER TABLE access_buildings
  ADD COLUMN address VARCHAR(500) NULL AFTER name,
  ADD COLUMN latitude DOUBLE NULL AFTER address,
  ADD COLUMN longitude DOUBLE NULL AFTER latitude,
  ADD COLUMN service_scope INT NOT NULL DEFAULT 0 AFTER longitude,
  ADD COLUMN contact_person VARCHAR(120) NULL AFTER service_scope,
  ADD COLUMN contact_phone VARCHAR(40) NULL AFTER contact_person,
  ADD COLUMN contact_email VARCHAR(255) NULL AFTER contact_phone;
