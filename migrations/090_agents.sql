-- 代理商登记表（2026-10-15 方案）：试用分配「代理商」由自由文本改为登记表选择+现场新建
-- 银行账号为纯登记用途（脱敏展示、仅平台管理员可见——应用层实现）
CREATE TABLE IF NOT EXISTS agents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  contact_name VARCHAR(120) NULL,
  contact_phone VARCHAR(40) NULL,
  contact_email VARCHAR(255) NULL,
  notes VARCHAR(500) NULL,
  payee_name VARCHAR(180) NULL,
  bank_name VARCHAR(180) NULL,
  bank_branch VARCHAR(180) NULL,
  bank_account_no VARCHAR(120) NULL,
  swift_code VARCHAR(40) NULL,
  status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
  created_by_admin_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agents_name (name),
  KEY idx_agents_status (status),
  CONSTRAINT fk_agents_created_by
    FOREIGN KEY (created_by_admin_user_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 试用记录关联代理商（存量 notes 无代理商文本，无需回填）
ALTER TABLE trial_assignments
  ADD COLUMN IF NOT EXISTS agent_id BIGINT UNSIGNED NULL AFTER owner_tenant_id,
  ADD KEY IF NOT EXISTS idx_trial_assignments_agent (agent_id);

SET @fk_trial_assignments_agent_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'trial_assignments'
    AND CONSTRAINT_NAME = 'fk_trial_assignments_agent'
);

SET @fk_trial_assignments_agent_sql = IF(
  @fk_trial_assignments_agent_exists = 0,
  'ALTER TABLE trial_assignments ADD CONSTRAINT fk_trial_assignments_agent FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE SET NULL',
  'SELECT 1'
);

PREPARE stmt FROM @fk_trial_assignments_agent_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
