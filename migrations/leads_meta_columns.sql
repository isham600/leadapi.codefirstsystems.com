-- Add Meta-specific columns to leads table
-- Run once on production DB

ALTER TABLE `leads`
  ADD COLUMN IF NOT EXISTS `meta_lead_id`  VARCHAR(100) DEFAULT NULL COMMENT 'Meta leadgen_id — unique per lead submission' AFTER `source`,
  ADD COLUMN IF NOT EXISTS `meta_form_id`  VARCHAR(100) DEFAULT NULL COMMENT 'Meta lead form ID' AFTER `meta_lead_id`,
  ADD COLUMN IF NOT EXISTS `medium`        VARCHAR(100) DEFAULT NULL COMMENT 'e.g. facebook_lead_ads, google_ads' AFTER `meta_form_id`,
  ADD COLUMN IF NOT EXISTS `raw_payload`   TEXT         DEFAULT NULL COMMENT 'Raw webhook/API payload for debugging' AFTER `medium`;

-- Index for fast meta_lead_id dedup lookup
ALTER TABLE `leads`
  ADD INDEX IF NOT EXISTS `idx_meta_lead_id` (`username`, `meta_lead_id`);
