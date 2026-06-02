ALTER TABLE access_communities
  ADD COLUMN slug VARCHAR(64) NULL AFTER name,
  ADD UNIQUE KEY uq_access_communities_slug (slug);
