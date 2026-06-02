CREATE TABLE IF NOT EXISTS call_center_visit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  call_center_id BIGINT UNSIGNED NOT NULL,
  tenant_id BIGINT UNSIGNED NOT NULL,
  visitor_name VARCHAR(100) NULL COMMENT '访客姓名',
  visitor_phone VARCHAR(50) NULL COMMENT '访客电话',
  visitor_email VARCHAR(255) NULL COMMENT '访客邮箱',
  visitor_company VARCHAR(255) NULL COMMENT '访客公司',
  visitor_content TEXT NULL COMMENT '咨询内容',
  visitor_ip VARCHAR(64) NULL,
  user_agent VARCHAR(1000) NULL,
  referer VARCHAR(1000) NULL,
  visited_url VARCHAR(1000) NULL,
  visited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cc_visit_center_id (call_center_id),
  KEY idx_cc_visit_tenant_id (tenant_id),
  KEY idx_cc_visit_time (visited_at),
  CONSTRAINT fk_cc_visit_center
    FOREIGN KEY (call_center_id) REFERENCES call_centers (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='呼叫中心访问日志表';