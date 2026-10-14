-- 试用通知发送去重日志：每个 trial × 每类通知只发一次（7天提醒/到期/回收）
CREATE TABLE IF NOT EXISTS trial_notification_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  trial_assignment_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('expiring_7d', 'expired', 'reclaimed') NOT NULL,
  recipient_email VARCHAR(255) NULL,
  email_status VARCHAR(20) NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_trial_notification_once (trial_assignment_id, kind),
  KEY idx_trial_notification_kind (kind, sent_at),
  CONSTRAINT fk_trial_notification_trial
    FOREIGN KEY (trial_assignment_id) REFERENCES trial_assignments (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
