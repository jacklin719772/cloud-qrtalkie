ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS nickname VARCHAR(80) NULL AFTER display_name;
