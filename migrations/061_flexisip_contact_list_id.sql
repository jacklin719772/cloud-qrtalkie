-- Migration: 061_flexisip_contact_list_id
-- 为 tenant_contact_books 新增 Flexisip contact list ID

ALTER TABLE tenant_contact_books
  ADD COLUMN flexisip_contact_list_id VARCHAR(64) NULL AFTER created_by_admin_id;
