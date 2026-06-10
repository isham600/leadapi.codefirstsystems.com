-- AI Calling Campaign tables
-- Run once to set up the AI calling system

-- AI provider credentials (OpenAI TTS, ElevenLabs, etc.)
CREATE TABLE IF NOT EXISTS phone_ai_credentials (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  username    VARCHAR(255) NOT NULL,
  provider    ENUM('openai','elevenlabs','google','azure','deepgram') DEFAULT 'openai',
  api_key     TEXT NOT NULL,
  voice_id    VARCHAR(255) NULL COMMENT 'Provider-specific voice ID',
  model       VARCHAR(100) NULL COMMENT 'e.g. tts-1, tts-1-hd',
  language    VARCHAR(20) DEFAULT 'hi-IN' COMMENT 'BCP-47 code',
  is_active   TINYINT(1) DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_username_provider (username, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- AI call script / flow templates
CREATE TABLE IF NOT EXISTS phone_ivr_template (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  username            VARCHAR(255) NOT NULL,
  name                VARCHAR(255) NOT NULL,
  description         TEXT NULL,
  language            ENUM('hindi','english','hinglish','marathi','gujarati','tamil','telugu') DEFAULT 'hindi',
  voice_gender        ENUM('male','female') DEFAULT 'female',
  voice_id            VARCHAR(255) NULL,
  greeting            TEXT NOT NULL COMMENT 'Opening message spoken to recipient',
  script              TEXT NOT NULL COMMENT 'Full call script / AI conversation prompt',
  fallback_text       TEXT NULL COMMENT 'Spoken if AI fails',
  max_call_duration   INT DEFAULT 120 COMMENT 'Max seconds per call',
  retry_count         INT DEFAULT 1  COMMENT 'Retry unanswered calls N times',
  retry_interval_min  INT DEFAULT 30 COMMENT 'Minutes between retries',
  is_active           TINYINT(1) DEFAULT 1,
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per campaign (summary counters)
CREATE TABLE IF NOT EXISTS phone_ivr_camp_summury (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  request_id      VARCHAR(100) NOT NULL UNIQUE,
  username        VARCHAR(255) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  template_id     INT NOT NULL,
  template_name   VARCHAR(255) NOT NULL,
  total_numbers   INT DEFAULT 0,
  pending         INT DEFAULT 0,
  calling         INT DEFAULT 0,
  answered        INT DEFAULT 0,
  not_answered    INT DEFAULT 0,
  failed          INT DEFAULT 0,
  completed       INT DEFAULT 0,
  schedule_date   DATE NULL,
  schedule_time   TIME NULL,
  status          ENUM('pending','running','paused','completed','cancelled') DEFAULT 'pending',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_username   (username),
  INDEX idx_request_id (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per phone number in a campaign
-- status='pp1' = pending worker pickup
CREATE TABLE IF NOT EXISTS phone_ivr_camp_details (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  request_id      VARCHAR(100) NOT NULL,
  username        VARCHAR(255) NOT NULL,
  campaign_name   VARCHAR(255) NOT NULL,
  template_id     INT NOT NULL,
  phone_number    VARCHAR(30) NOT NULL,
  lead_name       VARCHAR(255) NULL,
  lead_id         INT NULL,
  status          ENUM('pp1','calling','answered','not_answered','failed','completed') DEFAULT 'pp1'
                  COMMENT 'pp1 = pending worker pickup',
  call_duration   INT NULL    COMMENT 'Seconds',
  call_sid        VARCHAR(255) NULL COMMENT 'SIP / trunk call-ID',
  recording_url   VARCHAR(1000) NULL,
  notes           TEXT NULL   COMMENT 'Transcript summary or outcome notes',
  retry_count     INT DEFAULT 0,
  schedule_date   DATE NULL,
  schedule_time   TIME NULL,
  called_at       DATETIME NULL,
  completed_at    DATETIME NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_request_id  (request_id),
  INDEX idx_status      (status),
  INDEX idx_username    (username),
  INDEX idx_phone       (phone_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
