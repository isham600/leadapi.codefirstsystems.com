-- ============================================================
-- Phone IVR - All Tables
-- Prefix: phone_ivr_
-- ============================================================

-- ── 1. Trunk / SIP Accounts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phone_ivr_accounts (
  id                    INT          NOT NULL AUTO_INCREMENT,
  username              VARCHAR(100) NOT NULL,
  display_name          VARCHAR(100) NOT NULL,
  provider              VARCHAR(100) NOT NULL DEFAULT 'Custom',  -- Twilio, Vonage, Plivo, FreeSWITCH, Asterisk, Custom
  sip_server            VARCHAR(255) NOT NULL,
  sip_port              INT          NOT NULL DEFAULT 5060,
  websocket_url         VARCHAR(500) NULL       COMMENT 'wss://host:8089/ws  — required for browser calling',
  sip_username          VARCHAR(150) NOT NULL,
  sip_password          VARCHAR(255) NOT NULL,
  auth_realm            VARCHAR(255) NULL,
  transport             ENUM('UDP','TCP','TLS','WS','WSS') NOT NULL DEFAULT 'WSS',
  outbound_proxy        VARCHAR(255) NULL,
  inbound_enabled       TINYINT(1)   NOT NULL DEFAULT 1,
  outbound_enabled      TINYINT(1)   NOT NULL DEFAULT 1,
  recording_enabled     TINYINT(1)   NOT NULL DEFAULT 0,
  transcription_enabled TINYINT(1)   NOT NULL DEFAULT 0,
  browser_calling       TINYINT(1)   NOT NULL DEFAULT 1  COMMENT 'Enable WebSocket/WebRTC browser calls',
  caller_id_name        VARCHAR(100) NULL,
  caller_id_number      VARCHAR(30)  NULL,
  webhook_url           VARCHAR(500) NULL       COMMENT 'POST call events here',
  webhook_secret        VARCHAR(255) NULL,
  status                ENUM('active','inactive','error') NOT NULL DEFAULT 'inactive',
  last_registered_at    DATETIME     NULL,
  error_message         VARCHAR(500) NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_pivr_acc_username (username),
  INDEX idx_pivr_acc_status   (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 2. DID Numbers (virtual numbers linked to trunk) ─────────────────────────
CREATE TABLE IF NOT EXISTS phone_ivr_dids (
  id              INT          NOT NULL AUTO_INCREMENT,
  account_id      INT          NOT NULL,
  username        VARCHAR(100) NOT NULL,
  number          VARCHAR(30)  NOT NULL  COMMENT 'E.164 format: +919099051683',
  friendly_name   VARCHAR(100) NULL,
  route_to        ENUM('ivr','queue','extension','voicemail','forward','agent') NOT NULL DEFAULT 'ivr',
  route_target_id INT          NULL       COMMENT 'FK to ivr_menus, queues or extensions',
  forward_to      VARCHAR(30)  NULL,
  is_primary      TINYINT(1)   NOT NULL DEFAULT 0,
  status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_pivr_did_account  (account_id),
  INDEX idx_pivr_did_username (username),
  INDEX idx_pivr_did_number   (number),
  CONSTRAINT fk_pivr_did_account FOREIGN KEY (account_id)
    REFERENCES phone_ivr_accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 3. Call Detail Records (CDR) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phone_ivr_calls (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  call_uuid       VARCHAR(64)  NOT NULL UNIQUE,
  account_id      INT          NOT NULL,
  username        VARCHAR(100) NOT NULL,
  direction       ENUM('inbound','outbound') NOT NULL DEFAULT 'inbound',
  from_number     VARCHAR(30)  NOT NULL,
  to_number       VARCHAR(30)  NOT NULL,
  caller_name     VARCHAR(100) NULL,
  did_id          INT          NULL,
  queue_id        INT          NULL,
  ivr_menu_id     INT          NULL,
  agent_username  VARCHAR(100) NULL,
  extension_id    INT          NULL,
  status          ENUM('ringing','in-progress','answered','missed','voicemail','failed','busy','no-answer','cancelled') NOT NULL DEFAULT 'ringing',
  duration_sec    INT          NULL  COMMENT 'Total call time including ring',
  billsec         INT          NULL  COMMENT 'Seconds after answer',
  hangup_cause    VARCHAR(50)  NULL,
  recording_url   VARCHAR(500) NULL,
  transcription   LONGTEXT     NULL,
  lead_id         INT          NULL  COMMENT 'Linked CRM lead',
  started_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  answered_at     DATETIME     NULL,
  ended_at        DATETIME     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_pivr_call_uuid     (call_uuid),
  INDEX idx_pivr_call_account  (account_id),
  INDEX idx_pivr_call_username (username),
  INDEX idx_pivr_call_from     (from_number),
  INDEX idx_pivr_call_status   (status),
  INDEX idx_pivr_call_started  (started_at),
  INDEX idx_pivr_call_agent    (agent_username),
  CONSTRAINT fk_pivr_call_account FOREIGN KEY (account_id)
    REFERENCES phone_ivr_accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 4. IVR Menus ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phone_ivr_menus (
  id              INT          NOT NULL AUTO_INCREMENT,
  account_id      INT          NOT NULL,
  username        VARCHAR(100) NOT NULL,
  name            VARCHAR(100) NOT NULL,
  greeting_type   ENUM('tts','audio') NOT NULL DEFAULT 'tts',
  greeting_text   TEXT         NULL  COMMENT 'TTS greeting text',
  greeting_audio  VARCHAR(500) NULL  COMMENT 'Audio file URL',
  voice           VARCHAR(50)  NOT NULL DEFAULT 'en-US-Standard-A',
  timeout_sec     INT          NOT NULL DEFAULT 10,
  max_retries     INT          NOT NULL DEFAULT 3,
  timeout_action  ENUM('repeat','hangup','transfer') NOT NULL DEFAULT 'repeat',
  invalid_action  ENUM('repeat','hangup','transfer') NOT NULL DEFAULT 'repeat',
  is_default      TINYINT(1)   NOT NULL DEFAULT 0,
  status          ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_pivr_menu_account  (account_id),
  INDEX idx_pivr_menu_username (username),
  CONSTRAINT fk_pivr_menu_account FOREIGN KEY (account_id)
    REFERENCES phone_ivr_accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 5. IVR Menu Options (keypress → action) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS phone_ivr_menu_options (
  id              INT          NOT NULL AUTO_INCREMENT,
  menu_id         INT          NOT NULL,
  digit           CHAR(1)      NOT NULL  COMMENT '0-9, *, #',
  description     VARCHAR(100) NULL,
  action          ENUM('queue','extension','ivr','voicemail','forward','hangup','lead_capture','agent') NOT NULL,
  action_target_id INT         NULL,
  forward_to      VARCHAR(30)  NULL,
  tts_confirm     VARCHAR(255) NULL  COMMENT 'Optional TTS spoken before action',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pivr_menu_digit (menu_id, digit),
  INDEX idx_pivr_option_menu (menu_id),
  CONSTRAINT fk_pivr_option_menu FOREIGN KEY (menu_id)
    REFERENCES phone_ivr_menus (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 6. Call Queues ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phone_ivr_queues (
  id               INT          NOT NULL AUTO_INCREMENT,
  account_id       INT          NOT NULL,
  username         VARCHAR(100) NOT NULL,
  name             VARCHAR(100) NOT NULL,
  strategy         ENUM('ring-all','round-robin','least-recent','fewest-calls','random','linear') NOT NULL DEFAULT 'ring-all',
  timeout_sec      INT          NOT NULL DEFAULT 30  COMMENT 'Per-agent ring time',
  max_wait_sec     INT          NOT NULL DEFAULT 300,
  announce_position TINYINT(1)  NOT NULL DEFAULT 0,
  hold_music_url   VARCHAR(500) NULL,
  moh_type         ENUM('default','url') NOT NULL DEFAULT 'default',
  overflow_action  ENUM('voicemail','forward','hangup') NOT NULL DEFAULT 'voicemail',
  overflow_target  VARCHAR(100) NULL,
  status           ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_pivr_queue_account  (account_id),
  INDEX idx_pivr_queue_username (username),
  CONSTRAINT fk_pivr_queue_account FOREIGN KEY (account_id)
    REFERENCES phone_ivr_accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 7. Queue Agents ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phone_ivr_queue_agents (
  id              INT          NOT NULL AUTO_INCREMENT,
  queue_id        INT          NOT NULL,
  agent_username  VARCHAR(100) NOT NULL,
  extension       VARCHAR(20)  NULL,
  priority        INT          NOT NULL DEFAULT 1,
  penalty         INT          NOT NULL DEFAULT 0,
  status          ENUM('available','busy','offline','paused') NOT NULL DEFAULT 'offline',
  last_call_at    DATETIME     NULL,
  calls_handled   INT          NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pivr_queue_agent (queue_id, agent_username),
  INDEX idx_pivr_qa_queue (queue_id),
  INDEX idx_pivr_qa_agent (agent_username),
  CONSTRAINT fk_pivr_qa_queue FOREIGN KEY (queue_id)
    REFERENCES phone_ivr_queues (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 8. Extensions (per agent / user SIP endpoint) ────────────────────────────
CREATE TABLE IF NOT EXISTS phone_ivr_extensions (
  id                INT          NOT NULL AUTO_INCREMENT,
  account_id        INT          NOT NULL,
  username          VARCHAR(100) NOT NULL  COMMENT 'Owner account',
  agent_username    VARCHAR(100) NULL      COMMENT 'Assigned agent',
  extension         VARCHAR(20)  NOT NULL,
  sip_password      VARCHAR(255) NULL,
  caller_id_name    VARCHAR(100) NULL,
  caller_id_number  VARCHAR(30)  NULL,
  voicemail_enabled TINYINT(1)   NOT NULL DEFAULT 1,
  voicemail_pin     VARCHAR(10)  NULL,
  do_not_disturb    TINYINT(1)   NOT NULL DEFAULT 0,
  call_forward_to   VARCHAR(30)  NULL,
  status            ENUM('active','inactive') NOT NULL DEFAULT 'active',
  registered_at     DATETIME     NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pivr_ext_account (account_id, extension),
  INDEX idx_pivr_ext_account (account_id),
  INDEX idx_pivr_ext_agent   (agent_username),
  CONSTRAINT fk_pivr_ext_account FOREIGN KEY (account_id)
    REFERENCES phone_ivr_accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 9. Voicemails ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phone_ivr_voicemails (
  id              INT          NOT NULL AUTO_INCREMENT,
  account_id      INT          NOT NULL,
  username        VARCHAR(100) NOT NULL,
  call_id         BIGINT       NULL,
  extension_id    INT          NULL,
  from_number     VARCHAR(30)  NOT NULL,
  caller_name     VARCHAR(100) NULL,
  duration_sec    INT          NULL,
  audio_url       VARCHAR(500) NULL,
  transcription   TEXT         NULL,
  is_read         TINYINT(1)   NOT NULL DEFAULT 0,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_pivr_vm_account  (account_id),
  INDEX idx_pivr_vm_username (username),
  INDEX idx_pivr_vm_is_read  (is_read),
  CONSTRAINT fk_pivr_vm_account FOREIGN KEY (account_id)
    REFERENCES phone_ivr_accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 10. Recordings ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS phone_ivr_recordings (
  id              INT          NOT NULL AUTO_INCREMENT,
  account_id      INT          NOT NULL,
  call_id         BIGINT       NOT NULL,
  username        VARCHAR(100) NOT NULL,
  file_url        VARCHAR(500) NOT NULL,
  file_size_bytes INT          NULL,
  duration_sec    INT          NULL,
  format          VARCHAR(10)  NOT NULL DEFAULT 'mp3',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_pivr_rec_account (account_id),
  INDEX idx_pivr_rec_call    (call_id),
  CONSTRAINT fk_pivr_rec_account FOREIGN KEY (account_id)
    REFERENCES phone_ivr_accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
