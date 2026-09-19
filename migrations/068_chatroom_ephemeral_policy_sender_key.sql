-- Migration: 068_chatroom_ephemeral_policy_sender_key

ALTER TABLE chatroom_ephemeral_policy
  ADD COLUMN IF NOT EXISTS sender_username VARCHAR(120) NOT NULL DEFAULT '' AFTER chatroom_sip_uri;

-- Backfill sender_username from set_by_username for existing records
UPDATE chatroom_ephemeral_policy SET sender_username = set_by_username WHERE sender_username = '';

-- 幂等：主键已为 (chatroom_sip_uri, sender_username) 时，下面这条等价于重建同一主键
ALTER TABLE chatroom_ephemeral_policy
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (chatroom_sip_uri, sender_username);
