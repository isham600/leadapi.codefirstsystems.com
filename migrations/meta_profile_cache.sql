-- Profile cache: Overview data (page, instagram, ad account, token health)
-- stored per account so the Overview tab serves from DB instead of hitting
-- the Graph API on every visit. Refreshed by "Sync Profile" or when stale.
-- Run once on production DB.

ALTER TABLE `meta_accounts`
  ADD COLUMN IF NOT EXISTS `profile_cache`     LONGTEXT  DEFAULT NULL COMMENT 'JSON: {page, instagram, ad_account, token_health}' AFTER `pixel_id`,
  ADD COLUMN IF NOT EXISTS `profile_synced_at` DATETIME  DEFAULT NULL COMMENT 'Last profile cache refresh' AFTER `profile_cache`;
