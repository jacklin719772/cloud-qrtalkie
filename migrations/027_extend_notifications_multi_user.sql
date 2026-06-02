-- Migration: 027_extend_notifications_multi_user.sql
-- Extend notification system to support platform admins and SIP users

ALTER TABLE notification_events
  ADD COLUMN sender_type ENUM('system','platform_admin','tenant_admin') DEFAULT 'system' AFTER event_type,
  ADD COLUMN sender_id BIGINT UNSIGNED NULL AFTER sender_type,
  ADD INDEX idx_events_receiver (tenant_id, status, created_at);

ALTER TABLE notification_receipts
  MODIFY admin_user_id BIGINT UNSIGNED NULL,
  ADD COLUMN sip_user_id BIGINT UNSIGNED NULL AFTER admin_user_id,
  ADD COLUMN receiver_type ENUM('admin','sip') DEFAULT 'admin' AFTER sip_user_id,
  ADD UNIQUE INDEX idx_receipt_unique (event_id, admin_user_id, sip_user_id),
  ADD INDEX idx_receipt_sip (sip_user_id, deleted_at, dismissed_at, read_at);

-- Drop old unique constraint if it exists (MariaDB may complain on duplicate)
-- ALTER TABLE notification_receipts DROP INDEX event_id;
