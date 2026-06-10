-- ─────────────────────────────────────────────────────────────────────────────
-- meta_accounts  — stores Facebook / Instagram / Ads account credentials
-- Supports both OAuth-connected and manually-entered accounts
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `meta_accounts` (
  `id`                    INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `tenant_id`             VARCHAR(191)    NOT NULL,
  `username`              VARCHAR(191)    NOT NULL,

  -- Page / User identity
  `page_id`               VARCHAR(100)    DEFAULT NULL,
  `page_name`             VARCHAR(255)    DEFAULT NULL,
  `ssid`                  VARCHAR(100)    DEFAULT NULL COMMENT 'Facebook User ID',

  -- Access token
  `access_token`          TEXT            NOT NULL,
  `access_token_type`     VARCHAR(20)     NOT NULL DEFAULT 'page' COMMENT 'page | user | system_user',

  -- App credentials (used by OAuth flow; optional for manual entry)
  `app_id`                VARCHAR(100)    DEFAULT NULL,
  `app_secret`            VARCHAR(255)    DEFAULT NULL,
  `redirect_uri`          VARCHAR(500)    DEFAULT NULL,
  `webhook_verify_token`  VARCHAR(255)    DEFAULT NULL,

  -- Business / Ads (optional extras)
  `ad_account_id`         VARCHAR(100)    DEFAULT NULL COMMENT 'format: act_XXXXXXXX',
  `business_id`           VARCHAR(100)    DEFAULT NULL,
  `instagram_account_id`  VARCHAR(100)    DEFAULT NULL,

  `status`                ENUM('active','inactive','expired') NOT NULL DEFAULT 'active',
  `created_at`            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_meta_username` (`username`),
  KEY `idx_meta_tenant`   (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
