ALTER TABLE access_communities
  ADD COLUMN access_url VARCHAR(500) NULL AFTER is_active;
