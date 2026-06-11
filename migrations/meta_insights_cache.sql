-- Insights cache: Analytics responses stored per account + range with a
-- 15-min TTL so preset clicks / revisits don't hammer the Graph API.
-- Also: permanent form-questions cache (Meta forms are immutable).
-- Run once on production DB.

CREATE TABLE IF NOT EXISTS `meta_insights_cache` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `account_id` INT          NOT NULL COMMENT 'meta_accounts.id',
  `username`   VARCHAR(255) NOT NULL,
  `cache_key`  VARCHAR(120) NOT NULL COMMENT 'e.g. insights:last_30d, timeseries:2026-05-01_2026-05-15',
  `payload`    LONGTEXT     DEFAULT NULL COMMENT 'JSON response body',
  `synced_at`  DATETIME     NOT NULL,
  UNIQUE KEY `uq_insights_cache` (`account_id`, `cache_key`),
  KEY `idx_insights_user` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE `meta_lead_forms_cache`
  ADD COLUMN IF NOT EXISTS `questions_cache` LONGTEXT DEFAULT NULL COMMENT 'JSON form questions — immutable on Meta, cached forever' AFTER `leads_count`;
