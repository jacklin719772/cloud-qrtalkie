-- Migration: 067_chatroom_ephemeral_policy

-- 幂等：生产库中该表已存在（当时绕过迁移器手工建），改用 IF NOT EXISTS 以便 db:migrate 安全登记
CREATE TABLE IF NOT EXISTS chatroom_ephemeral_policy (
    chatroom_sip_uri  VARCHAR(512) PRIMARY KEY,
    enabled           TINYINT(1)  NOT NULL DEFAULT 0,
    lifetime_seconds  INT         NOT NULL DEFAULT 60,
    set_by_username   VARCHAR(120) NOT NULL,
    policy_version    INT         NOT NULL DEFAULT 1,
    updated_at        TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
