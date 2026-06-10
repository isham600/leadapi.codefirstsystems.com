-- ============================================================
-- Chatbot internal engine tables
-- Run once: mysql -u root -p your_db < migrations/chatbot.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS chatbot_flows (
  id                INT          NOT NULL AUTO_INCREMENT,
  uuid              VARCHAR(100) NOT NULL,
  username          VARCHAR(255) NOT NULL,
  flow_name         VARCHAR(255) NOT NULL,
  trigger_keywords  TEXT         NULL COMMENT 'comma-separated keywords that trigger this flow',
  is_default        TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = used when no keyword matches',
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_cf_uuid (uuid),
  INDEX idx_cf_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Steps within each flow ────────────────────────────────
CREATE TABLE IF NOT EXISTS chatbot_flow_steps (
  id            INT          NOT NULL AUTO_INCREMENT,
  flow_id       INT          NOT NULL,
  uuid          VARCHAR(100) NOT NULL,
  step_order    INT          NOT NULL DEFAULT 0 COMMENT 'execution order (ASC)',
  step_type     ENUM('message','question','end') NOT NULL DEFAULT 'message'
                COMMENT 'message=send & continue | question=send & wait for input | end=close flow',
  message       TEXT         NOT NULL COMMENT 'text to send to the contact',
  variable_name VARCHAR(100) NULL COMMENT 'store the user reply in collected_data[variable_name] (question type only)',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_cfs_flow (flow_id),
  INDEX idx_cfs_uuid (uuid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Active chatbot sessions (one per contact per account) ─
CREATE TABLE IF NOT EXISTS chatbot_sessions (
  id                INT          NOT NULL AUTO_INCREMENT,
  uuid              VARCHAR(100) NOT NULL,
  username          VARCHAR(255) NOT NULL,
  conversation_id   VARCHAR(255) NOT NULL,
  sender_id         VARCHAR(255) NOT NULL,
  flow_id           INT          NOT NULL,
  current_step_id   INT          NULL COMMENT 'step that was last sent',
  waiting_for_input TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '1 = expecting user reply',
  collected_data    JSON         NULL     COMMENT 'key/value pairs collected by question steps',
  status            ENUM('active','completed') NOT NULL DEFAULT 'active',
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cs_session (uuid, sender_id),
  INDEX idx_cs_conv (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
