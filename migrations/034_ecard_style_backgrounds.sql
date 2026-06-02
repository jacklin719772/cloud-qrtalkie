CREATE TABLE IF NOT EXISTS ecard_style_backgrounds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  style_id BIGINT UNSIGNED NOT NULL,
  background_name VARCHAR(128) NULL,
  image_url VARCHAR(500) NOT NULL,
  thumbnail_url VARCHAR(500) NULL,
  image_width INT UNSIGNED NULL,
  image_height INT UNSIGNED NULL,
  file_size_kb INT UNSIGNED NULL,
  layout_json JSON NULL COMMENT '背景图元素布局配置：头像、姓名、电话、二维码、公司名称等坐标和尺寸',
  default_style_json JSON NULL COMMENT '背景图默认文字样式配置：字体、字号、颜色、字重等',
  display_config_json JSON NULL COMMENT '背景图默认显示控制配置：字段是否显示',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 0,
  uploaded_by BIGINT UNSIGNED NULL,
  uploaded_by_name VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ecard_style_bg_style_id (style_id),
  KEY idx_ecard_style_bg_status (status),
  KEY idx_ecard_style_bg_sort (sort_order),
  CONSTRAINT fk_ecard_style_bg_style
    FOREIGN KEY (style_id) REFERENCES ecard_styles (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;