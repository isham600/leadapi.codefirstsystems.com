-- ============================================================
-- Hierarchical Multi-Channel Wallet-Based Billing System
-- Run once. All tables use InnoDB + utf8mb4.
-- ============================================================

-- ── 1. Wallets (one per user) ────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id          BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  username    VARCHAR(255)     NOT NULL,
  balance     DECIMAL(18,6)    NOT NULL DEFAULT 0.000000 COMMENT 'INR with 6 decimal precision',
  currency    CHAR(3)          NOT NULL DEFAULT 'INR',
  is_active   TINYINT(1)       NOT NULL DEFAULT 1,
  created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY  uq_wallets_username (username),
  INDEX       idx_wallets_balance  (balance)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 2. Wallet transactions (immutable ledger) ────────────────
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  txn_id          VARCHAR(64)     NOT NULL COMMENT 'Idempotency key: txn-{ref_id}-{channel}-{status}',
  username        VARCHAR(255)    NOT NULL COMMENT 'Wallet owner',
  initiated_by    VARCHAR(255)    NOT NULL COMMENT 'Admin/parent who triggered the transaction',
  type            ENUM(
                    'topup',        -- parent credits child wallet
                    'deduction',    -- channel billing deduction
                    'refund',       -- refund for failed/blocked delivery
                    'adjustment',   -- manual admin correction
                    'transfer_out', -- inter-wallet transfer source
                    'transfer_in'   -- inter-wallet transfer target
                  ) NOT NULL,
  channel         ENUM(
                    'sms','whatsapp','rcs','email',
                    'voice','ai_calling','meta_ads','wallet'
                  ) NOT NULL DEFAULT 'wallet',
  category        VARCHAR(64)     NULL COMMENT 'promotional|transactional|marketing|utility|authentication|single|cpc|cpl|campaign_spend',
  amount          DECIMAL(18,6)   NOT NULL COMMENT 'Always positive; sign from type',
  balance_before  DECIMAL(18,6)   NOT NULL,
  balance_after   DECIMAL(18,6)   NOT NULL,
  ref_id          VARCHAR(128)    NULL COMMENT 'message/campaign row id',
  ref_table       VARCHAR(64)     NULL COMMENT 'whatsapp_camp_details|rcs_camp_details|phone_ivr_calls etc.',
  delivery_status VARCHAR(32)     NULL COMMENT 'sent|delivered|read|failed|blocked',
  description     TEXT            NULL,
  metadata        JSON            NULL COMMENT 'voice slab used, pulse_seconds, units, etc.',
  ip_address      VARCHAR(45)     NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY  uq_wt_txn_id       (txn_id),
  INDEX       idx_wt_username    (username),
  INDEX       idx_wt_initiated   (initiated_by),
  INDEX       idx_wt_type        (type),
  INDEX       idx_wt_channel     (channel, category),
  INDEX       idx_wt_created_at  (created_at),
  INDEX       idx_wt_ref         (ref_table(32), ref_id(32)),
  INDEX       idx_wt_delivery    (delivery_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 3. Pricing profiles (per user × channel × category) ──────
CREATE TABLE IF NOT EXISTS pricing_profiles (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username            VARCHAR(255)    NOT NULL COMMENT 'Profile owner',
  channel             ENUM(
                        'sms','whatsapp','rcs','email',
                        'voice','ai_calling','meta_ads'
                      ) NOT NULL,
  category            VARCHAR(64)     NOT NULL
                        COMMENT 'sms:promotional|transactional / whatsapp:marketing|utility|authentication / rcs:single / email:single / voice:single / ai_calling:single / meta_ads:cpc|cpl|campaign_spend',

  -- ── Flat rate per unit (message / click / email) ──────────
  rate_per_unit       DECIMAL(12,6)   NOT NULL DEFAULT 0.000000,

  -- ── Voice / AI Calling ─────────────────────────────────────
  connection_charge   DECIMAL(12,6)   NOT NULL DEFAULT 0.000000 COMMENT 'Fixed charge per answered call',
  pulse_seconds       SMALLINT        NOT NULL DEFAULT 0        COMMENT 'Billing pulse; 0 = per-second',
  duration_rate       DECIMAL(12,6)   NOT NULL DEFAULT 0.000000 COMMENT 'AI Calling: cost per second',
  ai_processing_cost  DECIMAL(12,6)   NOT NULL DEFAULT 0.000000 COMMENT 'AI Calling: cost per AI inference turn',

  -- ── Meta Ads ───────────────────────────────────────────────
  cpc                 DECIMAL(12,6)   NOT NULL DEFAULT 0.000000 COMMENT 'Cost per click',
  cpl                 DECIMAL(12,6)   NOT NULL DEFAULT 0.000000 COMMENT 'Cost per lead',

  -- ── Billing mode ───────────────────────────────────────────
  billing_mode        ENUM('submission','delivery') NOT NULL DEFAULT 'submission'
                        COMMENT 'submission=deduct on send; delivery=deduct on webhook status',

  -- ── Trigger statuses (delivery mode) ───────────────────────
  bill_on_sent        TINYINT(1)      NOT NULL DEFAULT 0,
  bill_on_delivered   TINYINT(1)      NOT NULL DEFAULT 1,
  bill_on_read        TINYINT(1)      NOT NULL DEFAULT 0,
  bill_on_failed      TINYINT(1)      NOT NULL DEFAULT 0,
  bill_on_blocked     TINYINT(1)      NOT NULL DEFAULT 0,

  -- ── Refund config ──────────────────────────────────────────
  refund_on_failed    TINYINT(1)      NOT NULL DEFAULT 0,
  refund_on_blocked   TINYINT(1)      NOT NULL DEFAULT 0,

  -- ── Audit ──────────────────────────────────────────────────
  is_active           TINYINT(1)      NOT NULL DEFAULT 1,
  created_by          VARCHAR(255)    NOT NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY  uq_pp_user_channel_cat (username, channel, category),
  INDEX       idx_pp_username        (username),
  INDEX       idx_pp_channel         (channel),
  INDEX       idx_pp_active          (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 4. Voice slab pricing (range-based call duration billing) ─
CREATE TABLE IF NOT EXISTS voice_slab_pricing (
  id                  INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  pricing_profile_id  BIGINT UNSIGNED NOT NULL COMMENT 'FK → pricing_profiles.id',
  slab_order          TINYINT         NOT NULL COMMENT 'Sort order 1,2,3…',
  duration_from_sec   SMALLINT        NOT NULL COMMENT 'Inclusive lower bound (seconds)',
  duration_to_sec     SMALLINT        NULL     COMMENT 'NULL = unlimited upper bound',
  rate_per_pulse      DECIMAL(12,6)   NOT NULL COMMENT 'Charged per pulse_seconds in this slab',
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_vsp_profile (pricing_profile_id),
  CONSTRAINT fk_vsp_profile
    FOREIGN KEY (pricing_profile_id) REFERENCES pricing_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ── 5. Billing deduction queue (async delivery-mode buffer) ───
CREATE TABLE IF NOT EXISTS billing_deduction_queue (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  txn_id          VARCHAR(64)     NOT NULL COMMENT 'Idempotency key — prevents duplicate deduction',
  username        VARCHAR(255)    NOT NULL,
  channel         VARCHAR(32)     NOT NULL,
  category        VARCHAR(64)     NULL,
  ref_id          VARCHAR(128)    NOT NULL,
  ref_table       VARCHAR(64)     NOT NULL,
  delivery_status VARCHAR(32)     NOT NULL,
  processed       TINYINT(1)      NOT NULL DEFAULT 0,
  retry_count     TINYINT         NOT NULL DEFAULT 0,
  error_message   TEXT            NULL,
  created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at    DATETIME        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY  uq_bdq_txn_id     (txn_id),
  INDEX       idx_bdq_processed (processed, created_at),
  INDEX       idx_bdq_username  (username),
  INDEX       idx_bdq_ref       (ref_table(32), ref_id(32))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
