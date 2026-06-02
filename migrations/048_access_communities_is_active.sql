ALTER TABLE access_communities
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER service_scope;
