-- 1. 创建通讯录主表
CREATE TABLE IF NOT EXISTS tenant_contact_books (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT UNSIGNED NOT NULL COMMENT '所属租户',
  name VARCHAR(120) NOT NULL COMMENT '通讯录名称',
  description TEXT NULL COMMENT '通讯录描述',
  created_by_admin_id BIGINT UNSIGNED NULL COMMENT '创建此通讯录的租户管理员',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tenant_contact_books_tenant (tenant_id),
  CONSTRAINT fk_tenant_contact_books_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_tenant_contact_books_admin
    FOREIGN KEY (created_by_admin_id) REFERENCES admin_users (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='租户通讯录主表';

-- 2. 创建通讯录内容（联系人）表
-- 用于存储租户管理员从“已获得且启用的账号”中挑选出来放入通讯录的账号关联
CREATE TABLE IF NOT EXISTS tenant_contact_book_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contact_book_id BIGINT UNSIGNED NOT NULL COMMENT '所属通讯录',
  sip_user_id BIGINT UNSIGNED NOT NULL COMMENT '关联的有效 SIP 账号(订单账号子表数据)',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contact_book_entries (contact_book_id, sip_user_id),
  KEY idx_contact_book_entries_sip_user (sip_user_id),
  CONSTRAINT fk_contact_book_entries_book
    FOREIGN KEY (contact_book_id) REFERENCES tenant_contact_books (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_contact_book_entries_sip_user
    FOREIGN KEY (sip_user_id) REFERENCES sip_users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='通讯录中的联系人明细';

-- 3. 修改 sip_users 表，实现每个用户最多只能分配一个通讯录的限制
ALTER TABLE sip_users
  ADD COLUMN IF NOT EXISTS contact_book_id BIGINT UNSIGNED NULL COMMENT '为该 SIP 账号分配的可见通讯录' AFTER tenant_id,
  ADD KEY IF NOT EXISTS idx_sip_users_contact_book (contact_book_id),
  ADD CONSTRAINT fk_sip_users_contact_book
    FOREIGN KEY (contact_book_id) REFERENCES tenant_contact_books (id)
    ON DELETE SET NULL;