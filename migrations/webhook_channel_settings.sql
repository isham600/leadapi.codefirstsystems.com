-- Per-channel webhook verify token settings
-- Allows each user to enable/disable token verification independently per channel

CREATE TABLE IF NOT EXISTS webhook_channel_settings (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username             VARCHAR(255)  NOT NULL,
  uuid                 VARCHAR(100)  NOT NULL,
  channel              VARCHAR(50)   NOT NULL,
  verify_token_enabled TINYINT(1)    NOT NULL DEFAULT 0,
  verify_token         VARCHAR(255)  DEFAULT NULL,
  created_at           DATETIME      NOT NULL DEFAULT NOW(),
  updated_at           DATETIME      NOT NULL DEFAULT NOW() ON UPDATE NOW(),
  UNIQUE KEY uq_username_channel (username, channel)
);

-- Backfill existing users: insert one row per channel per user (all disabled by default)
INSERT IGNORE INTO webhook_channel_settings (username, uuid, channel, verify_token_enabled, verify_token, created_at, updated_at)
SELECT u.username, u.uuid, c.channel, 0, NULL, NOW(), NOW()
FROM users u
CROSS JOIN (
  SELECT 'whatsapp' AS channel UNION ALL
  SELECT 'facebook'            UNION ALL
  SELECT 'google'              UNION ALL
  SELECT 'rcs'
) c
WHERE u.uuid IS NOT NULL AND u.uuid != '';
