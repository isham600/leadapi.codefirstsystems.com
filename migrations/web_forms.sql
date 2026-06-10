-- Web Forms Integration
-- Stores embed keys, webhooks, and form submissions

CREATE TABLE IF NOT EXISTS `web_forms` (
  `id`                    INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `username`              VARCHAR(191)    NOT NULL,
  `embed_key`             VARCHAR(100)    NOT NULL UNIQUE COMMENT 'Unique key for form embed',
  `webhook_url`           VARCHAR(500)    NOT NULL,
  `form_title`            VARCHAR(255)    DEFAULT NULL,
  `form_description`      TEXT            DEFAULT NULL,
  `form_fields`           JSON            DEFAULT NULL COMMENT 'Array of fields: {name, label, type, required}',

  -- Submission tracking
  `total_submissions`     INT UNSIGNED    DEFAULT 0,
  `total_leads_created`   INT UNSIGNED    DEFAULT 0,

  -- Security & settings
  `allowed_origins`       JSON            DEFAULT NULL COMMENT 'Allowed domains for CORS',
  `api_key`               VARCHAR(255)    DEFAULT NULL COMMENT 'Optional API key for form updates',
  `status`                ENUM('active','inactive','archived') NOT NULL DEFAULT 'active',

  `created_at`            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  KEY `idx_username` (`username`),
  KEY `idx_embed_key` (`embed_key`),
  KEY `idx_status` (`status`),
  UNIQUE KEY `uniq_username_embed_key` (`username`, `embed_key`)
);

-- Form submissions (leads created from web forms)
CREATE TABLE IF NOT EXISTS `form_submissions` (
  `id`                    INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  `form_id`               INT UNSIGNED    NOT NULL,
  `username`              VARCHAR(191)    NOT NULL,

  -- Lead Information
  `first_name`            VARCHAR(255)    DEFAULT NULL,
  `last_name`             VARCHAR(255)    DEFAULT NULL,
  `email`                 VARCHAR(255)    DEFAULT NULL,
  `phone`                 VARCHAR(20)     DEFAULT NULL,
  `company`               VARCHAR(255)    DEFAULT NULL,
  `message`               TEXT            DEFAULT NULL,

  -- Custom fields (stored as JSON for flexibility)
  `custom_fields`         JSON            DEFAULT NULL COMMENT 'Additional form fields',

  -- UTM & Tracking
  `utm_source`            VARCHAR(100)    DEFAULT NULL,
  `utm_medium`            VARCHAR(100)    DEFAULT NULL,
  `utm_campaign`          VARCHAR(100)    DEFAULT NULL,
  `utm_term`              VARCHAR(100)    DEFAULT NULL,
  `utm_content`           VARCHAR(100)    DEFAULT NULL,
  `referrer`              VARCHAR(500)    DEFAULT NULL,
  `page_url`              VARCHAR(500)    DEFAULT NULL,

  -- Lead conversion
  `lead_id`               INT UNSIGNED    DEFAULT NULL COMMENT 'FK to created lead (if any)',
  `conversion_status`     ENUM('pending','converted','failed') DEFAULT 'pending',

  -- IP & Browser
  `ip_address`            VARCHAR(50)     DEFAULT NULL,
  `user_agent`            TEXT            DEFAULT NULL,

  `submitted_at`          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at`            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (`id`),
  FOREIGN KEY (`form_id`) REFERENCES `web_forms`(`id`) ON DELETE CASCADE,
  KEY `idx_form_id` (`form_id`),
  KEY `idx_username` (`username`),
  KEY `idx_email` (`email`),
  KEY `idx_phone` (`phone`),
  KEY `idx_conversion_status` (`conversion_status`),
  KEY `idx_submitted_at` (`submitted_at`)
);

-- Index for analytics
CREATE INDEX idx_form_submissions_daily ON form_submissions(form_id, submitted_at);
