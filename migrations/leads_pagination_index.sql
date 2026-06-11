-- Speeds up Lead Manager listing: the getLeads window-function dedup
-- partitions by phone and orders by created_at within each account.
-- Composite index lets MariaDB satisfy the scan/sort from the index.
-- Run once on production DB.

ALTER TABLE `leads`
  ADD INDEX IF NOT EXISTS `idx_leads_user_phone_created` (`username`, `phone`, `created_at`);
