-- ============================================================
-- Chatbot enhancements migration
-- Adds options_json to steps + trigger_type/trigger_channels to flows
-- Run: mysql -u root -p your_db < migrations/chatbot_enhancements.sql
-- ============================================================

-- Add options_json to chatbot_flow_steps (stores branch/delay/webhook config)
ALTER TABLE chatbot_flow_steps
  ADD COLUMN options_json TEXT DEFAULT NULL COMMENT 'JSON config for condition/delay/transfer/set_field/webhook steps'
  AFTER variable_name;

-- Widen step_type enum to include new step types
ALTER TABLE chatbot_flow_steps
  MODIFY COLUMN step_type VARCHAR(30) NOT NULL DEFAULT 'message'
  COMMENT 'message | question | end | condition | delay | transfer_to_agent | set_field | webhook';

-- Add trigger_type to chatbot_flows (keyword = classic, first_message, postback, always)
ALTER TABLE chatbot_flows
  ADD COLUMN trigger_type VARCHAR(50) NOT NULL DEFAULT 'keyword'
  COMMENT 'keyword | first_message | postback | opt_out | always'
  AFTER trigger_keywords;

-- Add trigger_channels — restrict which channels activate this flow (NULL = all)
ALTER TABLE chatbot_flows
  ADD COLUMN trigger_channels VARCHAR(255) DEFAULT NULL
  COMMENT 'comma-separated: whatsapp,rcs,facebook — NULL means all channels'
  AFTER trigger_type;

-- Add keyword_match to automation_summary for keyword-based trigger matching
ALTER TABLE automation_summary
  ADD COLUMN keyword_match VARCHAR(500) DEFAULT NULL
  COMMENT 'comma-separated keywords — used when trigger_type = keyword'
  AFTER trigger_type;
