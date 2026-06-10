-- ============================================================
-- RCS Business Messaging tables
-- Run once: mysql -u root -p your_db < migrations/rcs.sql
-- ============================================================

-- ── RCS Message Templates ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS rcs_templates (
  id                      INT            NOT NULL AUTO_INCREMENT,
  username                VARCHAR(100)   NOT NULL,
  name                    VARCHAR(255)   NOT NULL,
  message_type            VARCHAR(50)    NOT NULL               COMMENT 'text | rich_card | carousel',
  body_text               TEXT           NULL,
  rich_card_json          LONGTEXT       NULL                   COMMENT 'JSON: title, description, media_url, media_type, orientation, suggested_replies',
  carousel_cards_json     LONGTEXT       NULL                   COMMENT 'JSON array of rich_card objects',
  suggested_replies_json  LONGTEXT       NULL                   COMMENT 'JSON array of suggested action objects',
  status                  VARCHAR(20)    NOT NULL DEFAULT 'pending' COMMENT 'pending | active | rejected',
  created_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_rcs_tpl_username (username),
  INDEX idx_rcs_tpl_type (message_type),
  INDEX idx_rcs_tpl_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- If table already exists, add column (safe to run on existing DBs)
ALTER TABLE rcs_templates ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending | active | rejected' AFTER suggested_replies_json;
ALTER TABLE rcs_templates ADD INDEX IF NOT EXISTS idx_rcs_tpl_status (status);


-- ── RCS Campaign Summary (one row per campaign) ───────────────
CREATE TABLE IF NOT EXISTS rcs_camp_summary (
  id              INT            NOT NULL AUTO_INCREMENT,
  username        VARCHAR(100)   NOT NULL,
  name            VARCHAR(255)   NOT NULL,
  template_id     INT            NOT NULL,
  template_name   VARCHAR(255)   NOT NULL,
  audience        INT            NOT NULL DEFAULT 0             COMMENT 'total recipients',
  sent            INT            NOT NULL DEFAULT 0,
  delivered       INT            NOT NULL DEFAULT 0,
  read_count      INT            NOT NULL DEFAULT 0,
  status          VARCHAR(50)    NOT NULL DEFAULT 'pending'     COMMENT 'pending | scheduled | active | completed | failed',
  sms_fallback    TINYINT(1)     NOT NULL DEFAULT 0,
  scheduled_date  DATE           NULL,
  scheduled_time  TIME           NULL,
  created_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_rcs_camp_username (username),
  INDEX idx_rcs_camp_status (status),
  INDEX idx_rcs_camp_template (template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── RCS Campaign Details (one row per recipient) ──────────────
CREATE TABLE IF NOT EXISTS rcs_camp_details (
  id            INT            NOT NULL AUTO_INCREMENT,
  camp_id       INT            NOT NULL                         COMMENT 'FK → rcs_camp_summary.id',
  username      VARCHAR(100)   NOT NULL,
  phone_number  VARCHAR(20)    NOT NULL,
  status        VARCHAR(50)    NOT NULL DEFAULT 'pending'       COMMENT 'pending | sent | delivered | read | failed',
  sent_at       DATETIME       NULL,
  delivered_at  DATETIME       NULL,
  read_at       DATETIME       NULL,
  error         TEXT           NULL                             COMMENT 'error message if failed',
  created_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_rcs_det_camp   (camp_id),
  INDEX idx_rcs_det_user   (username),
  INDEX idx_rcs_det_phone  (phone_number),
  INDEX idx_rcs_det_status (status),
  CONSTRAINT fk_rcs_det_camp FOREIGN KEY (camp_id) REFERENCES rcs_camp_summary (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
