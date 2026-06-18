ALTER TABLE access_rooms ADD COLUMN allow_video_call TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否允许视频通话' AFTER sip_user_id;
