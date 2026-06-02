CREATE TABLE IF NOT EXISTS notification_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NULL,
  scope_type VARCHAR(40) NOT NULL DEFAULT 'tenant',
  scope_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(80) NOT NULL,
  dedupe_key VARCHAR(180) NOT NULL,
  title VARCHAR(180) NOT NULL,
  body VARCHAR(600) NOT NULL,
  severity ENUM('info', 'warning', 'error') NOT NULL DEFAULT 'info',
  status ENUM('active', 'resolved') NOT NULL DEFAULT 'active',
  target_view VARCHAR(80) NULL,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notification_events_tenant_dedupe (tenant_id, dedupe_key),
  KEY idx_notification_events_tenant_status (tenant_id, status, updated_at),
  KEY idx_notification_events_type_status (event_type, status),
  CONSTRAINT fk_notification_events_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notification_receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id BIGINT UNSIGNED NOT NULL,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  read_at TIMESTAMP NULL,
  dismissed_at TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notification_receipts_event_user (event_id, admin_user_id),
  KEY idx_notification_receipts_user_state (admin_user_id, deleted_at, dismissed_at, read_at),
  CONSTRAINT fk_notification_receipts_event
    FOREIGN KEY (event_id) REFERENCES notification_events (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_notification_receipts_admin_user
    FOREIGN KEY (admin_user_id) REFERENCES admin_users (id)
    ON DELETE CASCADE
);
