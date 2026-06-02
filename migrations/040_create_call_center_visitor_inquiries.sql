CREATE TABLE IF NOT EXISTS call_center_visitor_inquiries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  call_center_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NULL,
  agent_id BIGINT UNSIGNED NULL,
  sip_account_id BIGINT UNSIGNED NULL,
  sip_number VARCHAR(64) NULL,
  visitor_name VARCHAR(128) NULL,
  visitor_email VARCHAR(128) NOT NULL,
  visitor_phone VARCHAR(64) NULL,
  visitor_company VARCHAR(128) NULL,
  visitor_message VARCHAR(1000) NULL,
  visitor_ip VARCHAR(64) NULL,
  user_agent VARCHAR(1000) NULL,
  inquiry_status VARCHAR(32) NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cc_inquiry_center_id (call_center_id),
  KEY idx_cc_inquiry_tenant_id (tenant_id),
  KEY idx_cc_inquiry_category_id (category_id),
  KEY idx_cc_inquiry_agent_id (agent_id),
  KEY idx_cc_inquiry_sip_account_id (sip_account_id),
  KEY idx_cc_inquiry_email (visitor_email),
  KEY idx_cc_inquiry_created_at (created_at),
  CONSTRAINT fk_cc_inquiry_center
    FOREIGN KEY (call_center_id) REFERENCES call_centers (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_cc_inquiry_category
    FOREIGN KEY (category_id) REFERENCES call_center_categories (id)
    ON DELETE SET NULL,
  CONSTRAINT fk_cc_inquiry_agent
    FOREIGN KEY (agent_id) REFERENCES call_center_category_agents (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='呼叫中心访客咨询登记表';