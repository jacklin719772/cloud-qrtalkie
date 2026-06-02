CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(100) PRIMARY KEY COMMENT '配置键名，例如：privacy_policy, terms_of_service',
  setting_value LONGTEXT NOT NULL COMMENT '配置具体内容，使用 LONGTEXT 方便后续扩展存储富文本或HTML',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统全局配置表';