-- -----------------------------------------------------------------------------
-- 为已有 ecard_style_backgrounds 表安全添加新增的 JSON 配置字段
-- -----------------------------------------------------------------------------
ALTER TABLE ecard_style_backgrounds
  ADD COLUMN IF NOT EXISTS layout_json JSON NULL COMMENT '背景图元素布局配置：头像、姓名、电话、二维码、公司名称等坐标和尺寸' AFTER file_size_kb,
  ADD COLUMN IF NOT EXISTS default_style_json JSON NULL COMMENT '背景图默认文字样式配置：字体、字号、颜色、字重等' AFTER layout_json,
  ADD COLUMN IF NOT EXISTS display_config_json JSON NULL COMMENT '背景图默认显示控制配置：字段是否显示' AFTER default_style_json;