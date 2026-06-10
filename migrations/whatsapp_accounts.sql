-- WhatsApp Business Account Management
-- Note: whatsapp_accounts table already exists, only creating phone_numbers table

-- Phone numbers associated with WABA
CREATE TABLE IF NOT EXISTS `whatsapp_phone_numbers` (
  `id`                    BIGINT          NOT NULL AUTO_INCREMENT,
  `waba_account_id`       BIGINT          NOT NULL,
  `phone_number_id`       VARCHAR(100)    NOT NULL UNIQUE,
  `phone_number`          VARCHAR(20)     NOT NULL,
  `verified_name`         VARCHAR(255)    DEFAULT NULL,
  `quality_rating`        VARCHAR(50)     DEFAULT 'GREEN',
  `status`                VARCHAR(50)     DEFAULT 'CONNECTED',
  `is_primary`            TINYINT(1)      DEFAULT 0,

  -- Metrics
  `messages_sent`         INT UNSIGNED    DEFAULT 0,
  `leads_received`        INT UNSIGNED    DEFAULT 0,
  `last_message_at`       DATETIME        DEFAULT NULL,

  `created_at`            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_waba_account` (`waba_account_id`),
  KEY `idx_phone_number` (`phone_number`),
  UNIQUE KEY `uniq_waba_phone` (`waba_account_id`, `phone_number`),
  CONSTRAINT `fk_waba_account_id` FOREIGN KEY (`waba_account_id`) REFERENCES `whatsapp_accounts`(`id`) ON DELETE CASCADE
);
