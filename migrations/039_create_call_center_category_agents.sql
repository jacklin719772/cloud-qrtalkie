CREATE TABLE IF NOT EXISTS call_center_category_agents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  call_center_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  sip_account_id BIGINT UNSIGNED NOT NULL,
  sip_number VARCHAR(64) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  avatar_url VARCHAR(500) NULL,
  job_title VARCHAR(128) NULL,
  phone VARCHAR(64) NULL,
  email VARCHAR(128) NULL,
  service_title VARCHAR(128) NULL,
  service_desc VARCHAR(500) NULL,
  agent_status VARCHAR(32) NOT NULL DEFAULT 'online',
  call_enabled TINYINT NOT NULL DEFAULT 1,
  message_enabled TINYINT NOT NULL DEFAULT 1,
  card_style_json JSON NULL,
  extra_json JSON NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cc_category_sip (category_id, sip_account_id),
  KEY idx_cc_agent_center_id (call_center_id),
  KEY idx_cc_agent_category_id (category_id),
  KEY idx_cc_agent_tenant_id (tenant_id),
  KEY idx_cc_agent_sip_account_id (sip_account_id),
  KEY idx_cc_agent_status (agent_status),
  KEY idx_cc_agent_sort (sort_order),
  CONSTRAINT fk_cc_agent_center
    FOREIGN KEY (call_center_id) REFERENCES call_centers (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_cc_agent_category
    FOREIGN KEY (category_id) REFERENCES call_center_categories (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='呼叫中心分类坐席表';