CREATE TABLE IF NOT EXISTS tenants (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  sip_domain VARCHAR(255) NOT NULL DEFAULT 'sip.qrtalkie.org',
  contact_email VARCHAR(255) NULL,
  contact_phone VARCHAR(40) NULL,
  plan_code VARCHAR(80) NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  user_limit INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tenants_sip_domain (sip_domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(120) NULL,
  phone_number VARCHAR(40) NULL,
  role ENUM('owner', 'admin', 'viewer') NOT NULL DEFAULT 'owner',
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMP NULL,
  failed_login_count INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until TIMESTAMP NULL,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_users_email (email),
  KEY idx_admin_users_tenant_id (tenant_id),
  CONSTRAINT fk_admin_users_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_admin_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(120) NULL,
  phone_number VARCHAR(40) NULL,
  role ENUM('super_admin', 'operator', 'support', 'auditor') NOT NULL DEFAULT 'operator',
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMP NULL,
  failed_login_count INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until TIMESTAMP NULL,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_platform_admin_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sip_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL,
  username VARCHAR(120) NOT NULL,
  sip_domain VARCHAR(255) NOT NULL DEFAULT 'sip.qrtalkie.org',
  display_name VARCHAR(120) NULL,
  email VARCHAR(255) NOT NULL,
  phone_number VARCHAR(40) NULL,
  password_hash VARCHAR(255) NOT NULL,
  status ENUM('pending', 'active', 'disabled', 'expired', 'rejected') NOT NULL DEFAULT 'pending',
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TIMESTAMP NULL,
  service_expires_at TIMESTAMP NULL,
  reviewed_by_platform_admin_id BIGINT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL,
  last_registered_at TIMESTAMP NULL,
  last_seen_at TIMESTAMP NULL,
  last_user_agent VARCHAR(255) NULL,
  last_contact VARCHAR(512) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sip_users_uri (username, sip_domain),
  KEY idx_sip_users_tenant_id (tenant_id),
  KEY idx_sip_users_email (email),
  KEY idx_sip_users_status (status),
  KEY idx_sip_users_reviewed_by_platform_admin_id (reviewed_by_platform_admin_id),
  CONSTRAINT fk_sip_users_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_sip_users_platform_reviewer
    FOREIGN KEY (reviewed_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
