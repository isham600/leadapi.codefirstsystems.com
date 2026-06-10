-- Conversions API: dataset/pixel ID per Meta account for lead-event feedback
-- Run once on production DB

ALTER TABLE `meta_accounts`
  ADD COLUMN IF NOT EXISTS `pixel_id` VARCHAR(100) DEFAULT NULL COMMENT 'Meta dataset/pixel ID for Conversions API lead events' AFTER `instagram_account_id`;
