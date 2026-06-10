module.exports = {
  apps: [
    {
      name: "CF-CRM-api",

      script: "dist/server.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "500M",

      env: {
        NODE_ENV: "production",
        PORT: 3004
      },

      error_file: "./logs/error.log",
      out_file: "./logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-insert-whatsapp",

      script: "dist/worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "400M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-insert-whatsapp-error.log",
      out_file: "./logs/worker-insert-whatsapp-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-sync-google",

      script: "dist/google-sync-worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "400M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-sync-google-error.log",
      out_file: "./logs/worker-sync-google-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-sync-whatsapp-templates",

      script: "dist/whatsapp-template-sync-worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "400M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-sync-whatsapp-templates-error.log",
      out_file: "./logs/worker-sync-whatsapp-templates-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-mail-insert",

      script: "dist/mail-campaign-insert-worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "400M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-mail-insert-error.log",
      out_file: "./logs/worker-mail-insert-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-mail-send",

      script: "dist/mail-campaign-send-worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "400M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-mail-send-error.log",
      out_file: "./logs/worker-mail-send-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-webhook-whatsapp",

      script: "dist/workers/webhook-whatsapp.worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "400M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-webhook-whatsapp-error.log",
      out_file: "./logs/worker-webhook-whatsapp-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-webhook-facebook",

      script: "dist/workers/webhook-facebook.worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "400M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-webhook-facebook-error.log",
      out_file: "./logs/worker-webhook-facebook-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-webhook-google",

      script: "dist/workers/webhook-google.worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "400M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-webhook-google-error.log",
      out_file: "./logs/worker-webhook-google-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-webhook-rcs",

      script: "dist/workers/webhook-rcs.worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "400M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-webhook-rcs-error.log",
      out_file: "./logs/worker-webhook-rcs-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-webhook-generic",

      script: "dist/workers/webhook-generic.worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "300M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-webhook-generic-error.log",
      out_file: "./logs/worker-webhook-generic-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-webhook-chatbot",

      script: "dist/workers/webhook-chatbot.worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "400M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-webhook-chatbot-error.log",
      out_file: "./logs/worker-webhook-chatbot-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-lead-dispatcher",

      script: "dist/workers/lead-dispatcher.worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "300M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-lead-dispatcher-error.log",
      out_file: "./logs/worker-lead-dispatcher-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-sync-meta",

      script: "dist/meta-sync-worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "400M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-sync-meta-error.log",
      out_file: "./logs/worker-sync-meta-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-sms-campaign",

      script: "dist/sms-campaign-worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "400M",

      env: {
        NODE_ENV: "production"
      },

      error_file: "./logs/worker-sms-campaign-error.log",
      out_file: "./logs/worker-sms-campaign-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    },

    {
      name: "CF-CRM-worker-phone-ai-campaign",

      script: "dist/phone-ai-campaign-worker.js",
      interpreter: "node",

      exec_mode: "fork",
      instances: 1,

      watch: false,
      autorestart: true,
      max_memory_restart: "400M",

      env: {
        NODE_ENV: "production",
        // ── FreePBX ARI (Application Resource Interface) ───────────
        // ARI replaces AMI+AGI — all call logic runs here, no SSH/SCP needed
        // ASTERISK_ARI_HOST:    "103.73.188.148",      // FreePBX server IP
        // ASTERISK_ARI_PORT:    "8088",                // ARI HTTP port (default 8088)
        // ASTERISK_ARI_USER:    "aicaller",            // ARI username (see ari.conf setup)
        // ASTERISK_ARI_SECRET:  "aicaller@2025",       // ARI password
        // ASTERISK_ARI_APP:     "ai-caller",           // Stasis app name (must match ari.conf)
        // ASTERISK_CHANNEL_FMT: "PJSIP/{number}@cloudjio",  // outbound channel format
        // ASTERISK_CALLER_ID:   "+919099051683",       // outbound caller ID
        // ── API public URL (FreePBX sends callback here when call ends) ───
        API_BASE_URL:         "https://apilead.nuke.co.in",
        // ── OpenAI (AI conversation mode) ──────────────────────────
        // OPENAI_API_KEY:       "sk-...",
        // ── Google credentials (TTS + STT) ─────────────────────────
        // GOOGLE_APPLICATION_CREDENTIALS: "/etc/gcloud/tts-key.json",
      },

      error_file: "./logs/worker-phone-ai-campaign-error.log",
      out_file: "./logs/worker-phone-ai-campaign-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true
    }
  ]
};
