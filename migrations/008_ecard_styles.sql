CREATE TABLE IF NOT EXISTS ecard_styles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  style_code VARCHAR(64) NOT NULL,
  style_name VARCHAR(128) NOT NULL,
  style_type VARCHAR(32) NOT NULL,
  company_name_enabled TINYINT(1) NOT NULL DEFAULT 1,
  description VARCHAR(255) NULL,
  cover_image_url VARCHAR(500) NULL,
  sample_count INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 0,
  created_by BIGINT UNSIGNED NULL,
  created_by_name VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  remark VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ecard_styles_code (style_code),
  KEY idx_ecard_styles_type (style_type),
  KEY idx_ecard_styles_status (status),
  KEY idx_ecard_styles_sort_order (sort_order),
  KEY idx_ecard_styles_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ecard_style_samples (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  style_id BIGINT UNSIGNED NOT NULL,
  sample_name VARCHAR(128) NULL,
  image_url VARCHAR(500) NOT NULL,
  thumbnail_url VARCHAR(500) NULL,
  image_width INT UNSIGNED NULL,
  image_height INT UNSIGNED NULL,
  file_size_kb INT UNSIGNED NULL,
  is_cover TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  uploaded_by BIGINT UNSIGNED NULL,
  uploaded_by_name VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ecard_style_samples_style_id (style_id),
  KEY idx_ecard_style_samples_is_cover (is_cover),
  KEY idx_ecard_style_samples_sort_order (sort_order),
  KEY idx_ecard_style_samples_created_at (created_at),
  CONSTRAINT fk_ecard_style_samples_style
    FOREIGN KEY (style_id) REFERENCES ecard_styles (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;