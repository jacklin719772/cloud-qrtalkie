ALTER TABLE access_communities
  ADD COLUMN latitude DECIMAL(10, 7) NULL AFTER address,
  ADD COLUMN longitude DECIMAL(10, 7) NULL AFTER latitude,
  ADD COLUMN service_scope VARCHAR(500) NULL AFTER longitude,
  ADD COLUMN contact_person VARCHAR(120) NULL AFTER service_scope,
  ADD COLUMN contact_phone VARCHAR(40) NULL AFTER contact_person,
  ADD COLUMN contact_email VARCHAR(255) NULL AFTER contact_phone;
