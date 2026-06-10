-- ─────────────────────────────────────────────────────────────────────────────
-- meta_lead_forms_cache  — synced lead form list per page
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `meta_lead_forms_cache` (
  `id`           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `username`     VARCHAR(191)  NOT NULL,
  `page_id`      VARCHAR(100)  NOT NULL,
  `form_id`      VARCHAR(100)  NOT NULL,
  `name`         VARCHAR(500)  NOT NULL DEFAULT '',
  `status`       VARCHAR(50)   NOT NULL DEFAULT 'ACTIVE',
  `leads_count`  INT UNSIGNED  NOT NULL DEFAULT 0,
  `created_time` DATETIME      DEFAULT NULL,
  `synced_at`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_form` (`username`, `form_id`),
  KEY `idx_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────────
-- meta_campaigns_cache  — synced campaign list per ad account
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `meta_campaigns_cache` (
  `id`               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  `username`         VARCHAR(191)  NOT NULL,
  `ad_account_id`    VARCHAR(100)  NOT NULL,
  `campaign_id`      VARCHAR(100)  NOT NULL,
  `name`             VARCHAR(500)  NOT NULL DEFAULT '',
  `status`           VARCHAR(50)   NOT NULL DEFAULT 'ACTIVE',
  `objective`        VARCHAR(100)  DEFAULT NULL,
  `daily_budget`     BIGINT UNSIGNED DEFAULT NULL COMMENT 'in cents/paise',
  `lifetime_budget`  BIGINT UNSIGNED DEFAULT NULL COMMENT 'in cents/paise',
  `start_time`       DATETIME      DEFAULT NULL,
  `stop_time`        DATETIME      DEFAULT NULL,
  -- Insights (last 30 days, refreshed on sync)
  `spend`            DECIMAL(12,2) DEFAULT NULL,
  `impressions`      INT UNSIGNED  DEFAULT NULL,
  `clicks`           INT UNSIGNED  DEFAULT NULL,
  `reach`            INT UNSIGNED  DEFAULT NULL,
  `leads`            INT UNSIGNED  DEFAULT NULL,
  `created_time`     DATETIME      DEFAULT NULL,
  `synced_at`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_campaign` (`username`, `campaign_id`),
  KEY `idx_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
