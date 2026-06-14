-- Migration: 062_ecard_video_call_control
ALTER TABLE tenant_ecards ADD COLUMN enable_video_call TINYINT(1) NOT NULL DEFAULT 1 AFTER status;
