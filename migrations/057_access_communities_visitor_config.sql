ALTER TABLE access_communities
  ADD COLUMN logo_url VARCHAR(500) NULL AFTER access_url,
  ADD COLUMN banner_url VARCHAR(500) NULL AFTER logo_url,
  ADD COLUMN visitor_title VARCHAR(255) NULL AFTER banner_url,
  ADD COLUMN show_tips TINYINT(1) NOT NULL DEFAULT 1 AFTER visitor_title,
  ADD COLUMN tips_text VARCHAR(500) NULL AFTER show_tips;
