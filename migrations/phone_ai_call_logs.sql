-- AI Call Logs table
-- Captures every significant event in an AI calling session
-- Run: mysql -u USER -p DB < migrations/phone_ai_call_logs.sql

CREATE TABLE IF NOT EXISTS phone_ai_call_logs (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  detail_id    INT          NOT NULL            COMMENT 'References phone_ivr_camp_details.id',
  request_id   VARCHAR(100) NOT NULL DEFAULT '' COMMENT 'Campaign request_id',
  username     VARCHAR(255) NOT NULL DEFAULT '',
  phone_number VARCHAR(30)  NOT NULL DEFAULT '',
  call_mode    VARCHAR(30)  NOT NULL DEFAULT '' COMMENT 'voice_blast|dtmf|ai_conversation',

  -- event taxonomy
  event        VARCHAR(50)  NOT NULL            COMMENT 'call_start|tts_ok|ami_sent|ami_result|stt|gpt|tts_response|dtmf_press|call_result|error',
  turn         TINYINT      NULL                COMMENT 'Conversation turn (1-based, NULL for non-turn events)',
  payload      JSON         NULL                COMMENT 'Event-specific detail (text, transcript, status …)',

  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX idx_detail_id  (detail_id),
  INDEX idx_request_id (request_id),
  INDEX idx_username   (username),
  INDEX idx_event      (event),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Per-event audit trail for every AI call — STT, GPT, TTS, AMI, DTMF';
