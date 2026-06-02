CREATE TABLE IF NOT EXISTS gate_devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  device_uuid VARCHAR(120) NOT NULL,
  relay_id VARCHAR(120) NULL,
  subscribe_topic VARCHAR(255) NOT NULL,
  publish_topic VARCHAR(255) NOT NULL,
  wifi_name VARCHAR(120) NULL,
  wifi_password VARCHAR(255) NULL,
  tenant_id BIGINT UNSIGNED NULL,
  assignment_status ENUM('unassigned', 'assigned', 'disabled') NOT NULL DEFAULT 'unassigned',
  assigned_at TIMESTAMP NULL,
  assigned_by_admin_user_id BIGINT UNSIGNED NULL,
  created_by_admin_user_id BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_gate_devices_uuid (device_uuid),
  KEY idx_gate_devices_tenant (tenant_id, assignment_status),
  KEY idx_gate_devices_assignment_status (assignment_status),
  KEY idx_gate_devices_created_by (created_by_admin_user_id),
  KEY idx_gate_devices_assigned_by (assigned_by_admin_user_id),
  CONSTRAINT fk_gate_devices_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_gate_devices_created_by
    FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_gate_devices_assigned_by
    FOREIGN KEY (assigned_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gate_device_assignment_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gate_device_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NULL,
  from_status ENUM('unassigned', 'assigned', 'disabled') NULL,
  to_status ENUM('unassigned', 'assigned', 'disabled') NOT NULL,
  changed_by_admin_user_id BIGINT UNSIGNED NULL,
  change_reason VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gate_device_assignment_history_device (gate_device_id, created_at),
  KEY idx_gate_device_assignment_history_tenant (tenant_id, created_at),
  KEY idx_gate_device_assignment_history_changed_by (changed_by_admin_user_id),
  CONSTRAINT fk_gate_device_assignment_history_device
    FOREIGN KEY (gate_device_id) REFERENCES gate_devices (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_gate_device_assignment_history_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_gate_device_assignment_history_changed_by
    FOREIGN KEY (changed_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
