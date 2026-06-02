CREATE TABLE IF NOT EXISTS call_center_agent_action_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  call_center_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  agent_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  sip_account_id BIGINT UNSIGNED NOT NULL,
  sip_number VARCHAR(64) NOT NULL,
  action_type VARCHAR(32) NOT NULL,
  visitor_ip VARCHAR(64) NULL,
  user_agent VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cc_action_center_id (call_center_id),
  KEY idx_cc_action_category_id (category_id),
  KEY idx_cc_action_agent_id (agent_id),
  KEY idx_cc_action_tenant_id (tenant_id),
  KEY idx_cc_action_sip_account_id (sip_account_id),
  KEY idx_cc_action_type (action_type),
  KEY idx_cc_action_time (created_at),
  CONSTRAINT fk_cc_action_center
    FOREIGN KEY (call_center_id) REFERENCES call_centers (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_cc_action_category
    FOREIGN KEY (category_id) REFERENCES call_center_categories (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_cc_action_agent
    FOREIGN KEY (agent_id) REFERENCES call_center_category_agents (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='呼叫中心坐席行为日志表';