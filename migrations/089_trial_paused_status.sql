-- 試用記錄新增「暫停」狀態：暫停可恢復（區別於寬限期與已回收）
-- 暫停時不改到期日/歸屬，僅翻狀態位；恢復（未到期時）原樣翻回
ALTER TABLE trial_assignments
  MODIFY COLUMN status ENUM('active', 'paused', 'converted', 'reclaimed') NOT NULL DEFAULT 'active';
