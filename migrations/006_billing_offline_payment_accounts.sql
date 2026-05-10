CREATE TABLE IF NOT EXISTS billing_offline_payment_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NULL,
  account_code VARCHAR(80) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  payee_name VARCHAR(180) NOT NULL,
  bank_name VARCHAR(180) NOT NULL,
  bank_account_no VARCHAR(120) NOT NULL,
  bank_branch VARCHAR(180) NULL,
  swift_code VARCHAR(40) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'USD',
  contact_name VARCHAR(120) NULL,
  contact_phone VARCHAR(40) NULL,
  contact_email VARCHAR(255) NULL,
  payment_notice VARCHAR(255) NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_platform_admin_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_platform_admin_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_offline_payment_accounts_code (account_code),
  KEY idx_billing_offline_payment_accounts_tenant (tenant_id),
  KEY idx_billing_offline_payment_accounts_status_default (status, is_default, sort_order),
  KEY idx_billing_offline_payment_accounts_created_by (created_by_platform_admin_id),
  KEY idx_billing_offline_payment_accounts_updated_by (updated_by_platform_admin_id),
  CONSTRAINT fk_billing_offline_payment_accounts_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_billing_offline_payment_accounts_created_by
    FOREIGN KEY (created_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_offline_payment_accounts_updated_by
    FOREIGN KEY (updated_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO billing_offline_payment_accounts (
  account_code,
  display_name,
  payee_name,
  bank_name,
  bank_account_no,
  currency,
  contact_name,
  contact_phone,
  contact_email,
  payment_notice,
  status,
  is_default,
  sort_order
)
SELECT
  'default-usd-bank',
  'Default USD Bank Transfer',
  'QRTalkie Cloud Limited',
  'HSBC Hong Kong',
  '123-456789-001',
  'USD',
  'Billing Support',
  '+852 3000 8888',
  'billing@qrtalkie.com',
  '線下付款後請及時上傳付款憑證截圖',
  'active',
  1,
  10
WHERE NOT EXISTS (
  SELECT 1
  FROM billing_offline_payment_accounts
  WHERE account_code = 'default-usd-bank'
);
