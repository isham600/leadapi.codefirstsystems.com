-- Add call_mode + DTMF options + AI conversation fields to phone_ivr_template
-- Run once: mysql -u USER -p DB < migrations/phone_ai_template_modes.sql

ALTER TABLE phone_ivr_template
  ADD COLUMN call_mode       ENUM('voice_blast','dtmf','ai_conversation') NOT NULL DEFAULT 'voice_blast'
                             COMMENT 'voice_blast=play & hangup | dtmf=keypress interaction | ai_conversation=realtime STT+LLM+TTS'
                             AFTER voice_gender,
  ADD COLUMN dtmf_options    JSON NULL
                             COMMENT '[{"key":"1","label":"Interested","response_text":"Great! Our team will call you.","outcome":"interested"},...]'
                             AFTER call_mode,
  ADD COLUMN ai_system_prompt TEXT NULL
                             COMMENT 'OpenAI system prompt for AI conversation mode'
                             AFTER dtmf_options,
  ADD COLUMN ai_max_turns    INT NOT NULL DEFAULT 3
                             COMMENT 'Max back-and-forth turns in AI conversation'
                             AFTER ai_system_prompt;
