-- Migration: 070_app_releases
-- App 版本发布表，用于版本检查更新

CREATE TABLE IF NOT EXISTS app_releases (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  platform VARCHAR(32) NOT NULL DEFAULT 'android',
  version VARCHAR(32) NOT NULL,
  version_code INT UNSIGNED NOT NULL DEFAULT 0,
  download_url VARCHAR(500) NOT NULL,
  file_size BIGINT UNSIGNED NULL,
  sha256 VARCHAR(64) NULL,
  release_notes TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  released_at DATETIME NULL DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_platform_status (platform, status),
  KEY idx_released_at (released_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='App 版本发布表';
