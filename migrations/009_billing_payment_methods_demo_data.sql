CREATE TABLE IF NOT EXISTS billing_payment_methods (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  method_code VARCHAR(80) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  method_type ENUM('online', 'offline') NOT NULL DEFAULT 'online',
  logo_class VARCHAR(80) NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by_platform_admin_id BIGINT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by_platform_admin_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_payment_methods_code (method_code),
  KEY idx_billing_payment_methods_type_status_sort (method_type, status, sort_order),
  KEY idx_billing_payment_methods_created_by (created_by_platform_admin_id),
  KEY idx_billing_payment_methods_updated_by (updated_by_platform_admin_id),
  CONSTRAINT fk_billing_payment_methods_created_by
    FOREIGN KEY (created_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_billing_payment_methods_updated_by
    FOREIGN KEY (updated_by_platform_admin_id) REFERENCES platform_admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO billing_payment_methods (method_code, display_name, method_type, logo_class, status, sort_order)
SELECT 'paypal', 'PayPal', 'online', 'paypal', 'active', 10
WHERE NOT EXISTS (SELECT 1 FROM billing_payment_methods WHERE method_code = 'paypal');

INSERT INTO billing_payment_methods (method_code, display_name, method_type, logo_class, status, sort_order)
SELECT 'visa', 'VISA', 'online', 'visa', 'active', 20
WHERE NOT EXISTS (SELECT 1 FROM billing_payment_methods WHERE method_code = 'visa');

INSERT INTO billing_payment_methods (method_code, display_name, method_type, logo_class, status, sort_order)
SELECT 'mastercard', 'Mastercard', 'online', 'mastercard', 'active', 30
WHERE NOT EXISTS (SELECT 1 FROM billing_payment_methods WHERE method_code = 'mastercard');

INSERT INTO billing_payment_methods (method_code, display_name, method_type, logo_class, status, sort_order)
SELECT 'discover', 'DISCOVER', 'online', 'discover', 'active', 40
WHERE NOT EXISTS (SELECT 1 FROM billing_payment_methods WHERE method_code = 'discover');

INSERT INTO billing_payment_methods (method_code, display_name, method_type, logo_class, status, sort_order)
SELECT 'amex', 'AMERICAN EXPRESS', 'online', 'amex', 'active', 50
WHERE NOT EXISTS (SELECT 1 FROM billing_payment_methods WHERE method_code = 'amex');
