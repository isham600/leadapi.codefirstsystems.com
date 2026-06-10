-- Per-form mapping of Meta lead-form question keys → CRM lead columns
-- Applied by upsertMetaLead so custom question answers land in real fields
-- instead of dying in raw_payload. Run once on production DB.

CREATE TABLE IF NOT EXISTS `meta_form_field_map` (
  `id`          INT AUTO_INCREMENT PRIMARY KEY,
  `username`    VARCHAR(255) NOT NULL,
  `form_id`     VARCHAR(100) NOT NULL,
  `meta_field`  VARCHAR(255) NOT NULL COMMENT 'Question key from Meta field_data (lowercased)',
  `crm_field`   VARCHAR(50)  NOT NULL COMMENT 'Target leads column (allowlisted in code)',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_form_field` (`username`, `form_id`, `meta_field`),
  KEY `idx_ffm_user_form` (`username`, `form_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
