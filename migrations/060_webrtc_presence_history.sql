CREATE TABLE IF NOT EXISTS webrtc_account_presence_state (
  extension VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  status_text VARCHAR(64) NOT NULL DEFAULT '狀態未知',
  previous_status VARCHAR(32) NULL,
  online_at DATETIME NULL,
  offline_at DATETIME NULL,
  last_seen_at DATETIME NULL,
  last_changed_at DATETIME NULL,
  last_checked_at DATETIME NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'asterisk_poll',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (extension),
  KEY idx_webrtc_presence_state_status (status),
  KEY idx_webrtc_presence_state_last_changed_at (last_changed_at),
  KEY idx_webrtc_presence_state_last_checked_at (last_checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webrtc_account_presence_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  extension VARCHAR(32) NOT NULL,
  previous_status VARCHAR(32) NULL,
  status VARCHAR(32) NOT NULL,
  status_text VARCHAR(64) NOT NULL DEFAULT '狀態未知',
  changed_at DATETIME NOT NULL,
  source VARCHAR(64) NOT NULL DEFAULT 'asterisk_poll',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_webrtc_presence_events_extension_changed_at (extension, changed_at),
  KEY idx_webrtc_presence_events_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
