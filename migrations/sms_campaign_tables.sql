-- ── SMS Broadcast Campaign Tables ──────────────────────────────
-- Run once: mysql -u root -p your_db < migrations/sms_campaign_tables.sql

CREATE TABLE IF NOT EXISTS `smpp_campaign_summery` (
  `id`             INT          NOT NULL AUTO_INCREMENT,
  `username`       VARCHAR(100) NOT NULL,
  `request_id`     VARCHAR(100) NOT NULL,
  `broadcast_name` VARCHAR(255) NOT NULL,
  `msg`            TEXT         NOT NULL,
  `msg_mode`       VARCHAR(50)  NOT NULL DEFAULT 'transactional',
  `msg_routes`     VARCHAR(100) NOT NULL,
  `sender_id`      VARCHAR(50)  NOT NULL,
  `template_id`    VARCHAR(100) DEFAULT NULL,
  `peid`           VARCHAR(100) DEFAULT NULL,
  `flash`          TINYINT      NOT NULL DEFAULT 0,
  `unicode`        TINYINT      NOT NULL DEFAULT 0,
  `contacts`       INT          NOT NULL DEFAULT 0,
  `status`         VARCHAR(50)  NOT NULL DEFAULT 'pending',
  `schedule_date`  VARCHAR(20)  NOT NULL,
  `schedule_time`  VARCHAR(20)  DEFAULT NULL,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_request_id` (`request_id`),
  KEY `idx_username` (`username`),
  KEY `idx_schedule_date` (`schedule_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Per-receiver rows ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `smpp_campaign_details` (
  `id`             INT          NOT NULL AUTO_INCREMENT,
  `username`       VARCHAR(100) NOT NULL,
  `request_id`     VARCHAR(100) NOT NULL,
  `broadcast_name` VARCHAR(255) NOT NULL,
  `sender_id`      VARCHAR(50)  NOT NULL,
  `msg`            TEXT         NOT NULL,
  `msg_mode`       VARCHAR(50)  NOT NULL DEFAULT 'transactional',
  `msg_routes`     VARCHAR(100) NOT NULL,
  `template_id`    VARCHAR(100) DEFAULT NULL,
  `peid`           VARCHAR(100) DEFAULT NULL,
  `receiver`       VARCHAR(25)  NOT NULL,
  `status`         VARCHAR(50)  NOT NULL DEFAULT 'PP1',
  `unicode`        TINYINT      NOT NULL DEFAULT 0,
  `flash`          TINYINT      NOT NULL DEFAULT 0,
  `rid`            VARCHAR(100) DEFAULT NULL COMMENT 'SMPP message ID set by engine for DLR',
  `schedule_date`  VARCHAR(20)  NOT NULL,
  `schedule_time`  VARCHAR(20)  DEFAULT NULL,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_request_id`  (`request_id`),
  KEY `idx_username`    (`username`),
  KEY `idx_receiver`    (`receiver`),
  KEY `idx_status`      (`status`),
  KEY `idx_rid`         (`rid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── BullMQ insert-job tracking ───────────────────────────────────
CREATE TABLE IF NOT EXISTS `smpp_insert_job` (
  `id`           INT          NOT NULL AUTO_INCREMENT,
  `request_id`   VARCHAR(100) NOT NULL,
  `username`     VARCHAR(100) NOT NULL,
  `status`       VARCHAR(50)  NOT NULL DEFAULT 'pending',
  `total`        INT          NOT NULL DEFAULT 0,
  `processed`    INT          NOT NULL DEFAULT 0,
  `failed_count` INT          NOT NULL DEFAULT 0,
  `error`        TEXT         DEFAULT NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_request_id` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
