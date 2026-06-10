-- Add Meta ads attribution columns to leads table
-- Stores which campaign / ad set / ad generated each lead (P0-3 fix)
-- Run once on production DB

ALTER TABLE `leads`
  ADD COLUMN IF NOT EXISTS `meta_campaign_id`   VARCHAR(100) DEFAULT NULL COMMENT 'Meta campaign ID that generated this lead'  AFTER `meta_form_id`,
  ADD COLUMN IF NOT EXISTS `meta_campaign_name` VARCHAR(255) DEFAULT NULL COMMENT 'Meta campaign name (snapshot at capture)'   AFTER `meta_campaign_id`,
  ADD COLUMN IF NOT EXISTS `meta_adset_id`      VARCHAR(100) DEFAULT NULL COMMENT 'Meta ad set ID'                             AFTER `meta_campaign_name`,
  ADD COLUMN IF NOT EXISTS `meta_adset_name`    VARCHAR(255) DEFAULT NULL COMMENT 'Meta ad set name (snapshot at capture)'     AFTER `meta_adset_id`,
  ADD COLUMN IF NOT EXISTS `meta_ad_id`         VARCHAR(100) DEFAULT NULL COMMENT 'Meta ad ID'                                 AFTER `meta_adset_name`,
  ADD COLUMN IF NOT EXISTS `meta_ad_name`       VARCHAR(255) DEFAULT NULL COMMENT 'Meta ad name (snapshot at capture)'         AFTER `meta_ad_id`;

-- Index for per-campaign lead reporting
ALTER TABLE `leads`
  ADD INDEX IF NOT EXISTS `idx_meta_campaign` (`username`, `meta_campaign_id`);
