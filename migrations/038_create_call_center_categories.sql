CREATE TABLE IF NOT EXISTS call_center_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  call_center_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  category_name VARCHAR(128) NOT NULL,
  category_code VARCHAR(64) NULL,
  description VARCHAR(500) NULL,
  icon_url VARCHAR(500) NULL,
  theme_color VARCHAR(32) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cc_category_center_id (call_center_id),
  KEY idx_cc_category_tenant_id (tenant_id),
  KEY idx_cc_category_status (status),
  KEY idx_cc_category_sort (sort_order),
  CONSTRAINT fk_cc_category_center
    FOREIGN KEY (call_center_id) REFERENCES call_centers (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='呼叫中心服务分类表';