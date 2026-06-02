CREATE TABLE IF NOT EXISTS tenant_contact_book_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  contact_book_id BIGINT UNSIGNED NOT NULL,
  sip_user_id BIGINT UNSIGNED NOT NULL,
  assigned_by_admin_id BIGINT UNSIGNED NULL,
  status ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contact_book_assignments_book_user (contact_book_id, sip_user_id),
  KEY idx_contact_book_assignments_tenant (tenant_id),
  KEY idx_contact_book_assignments_book (contact_book_id),
  KEY idx_contact_book_assignments_sip_user (sip_user_id),
  KEY idx_contact_book_assignments_status (status),
  KEY idx_contact_book_assignments_admin (assigned_by_admin_id),
  CONSTRAINT fk_contact_book_assignments_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_contact_book_assignments_book
    FOREIGN KEY (contact_book_id) REFERENCES tenant_contact_books (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_contact_book_assignments_sip_user
    FOREIGN KEY (sip_user_id) REFERENCES sip_users (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_contact_book_assignments_admin
    FOREIGN KEY (assigned_by_admin_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @sip_users_contact_book_id_exists = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sip_users'
    AND COLUMN_NAME = 'contact_book_id'
);

SET @backfill_contact_book_assignments_sql = IF(
  @sip_users_contact_book_id_exists > 0,
  'INSERT IGNORE INTO tenant_contact_book_assignments (tenant_id, contact_book_id, sip_user_id, status, assigned_at)
   SELECT su.tenant_id, su.contact_book_id, su.id, ''active'', CURRENT_TIMESTAMP
   FROM sip_users su
   JOIN tenant_contact_books cb
     ON cb.id = su.contact_book_id
    AND cb.tenant_id = su.tenant_id
   WHERE su.tenant_id IS NOT NULL
     AND su.contact_book_id IS NOT NULL',
  'SELECT 1'
);

PREPARE stmt FROM @backfill_contact_book_assignments_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
