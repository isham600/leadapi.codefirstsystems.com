-- ── Automation Summary (one row per automation) ──────────────────────────────
CREATE TABLE IF NOT EXISTS automation_summary (
  id           INT          NOT NULL AUTO_INCREMENT,
  username     VARCHAR(100) NOT NULL,
  name         VARCHAR(255) NOT NULL,
  description  TEXT         NULL,
  source       VARCHAR(100) NOT NULL DEFAULT 'Any',
  trigger_event VARCHAR(100) NOT NULL DEFAULT 'New Lead',
  trigger_type VARCHAR(50)  NOT NULL DEFAULT 'event'   COMMENT 'event | time | webhook | db-change | external',
  actions_json LONGTEXT     NULL                        COMMENT 'JSON array of action strings',
  status       ENUM('active','paused','draft') NOT NULL DEFAULT 'draft',
  runs         INT          NOT NULL DEFAULT 0,
  last_run     DATETIME     NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_auto_username (username),
  INDEX idx_auto_status   (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── Automation Logs (one row per execution) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_logs (
  id            INT          NOT NULL AUTO_INCREMENT,
  automation_id INT          NOT NULL,
  username      VARCHAR(100) NOT NULL,
  automation_name VARCHAR(255) NOT NULL,
  event         VARCHAR(255) NOT NULL,
  result        ENUM('success','failed','skipped') NOT NULL DEFAULT 'success',
  error_message TEXT         NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_alog_username      (username),
  INDEX idx_alog_automation_id (automation_id),
  INDEX idx_alog_created       (created_at),
  CONSTRAINT fk_alog_automation FOREIGN KEY (automation_id) REFERENCES automation_summary (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
