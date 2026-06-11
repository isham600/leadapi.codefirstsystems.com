-- Server-backed lead notes (was browser localStorage — not shared, lost on
-- cache clear). One row per note, scoped to the owning account.
-- Run once on production DB.

CREATE TABLE IF NOT EXISTS `lead_notes` (
  `id`         INT AUTO_INCREMENT PRIMARY KEY,
  `lead_id`    INT          NOT NULL,
  `username`   VARCHAR(255) NOT NULL COMMENT 'owning account username',
  `author`     VARCHAR(255) NOT NULL COMMENT 'who wrote it (agent or owner)',
  `note`       TEXT         NOT NULL,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_lead_notes_lead` (`lead_id`, `created_at`),
  KEY `idx_lead_notes_user` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
