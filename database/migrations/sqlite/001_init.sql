-- ============================================
-- COMPLETE DATABASE SCHEMA - NEXUS BOT
-- File: 002_complete_schema.sql
-- This is the FULL schema with all tables INCLUDING SPAM TRACKING
-- ============================================

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,  
    first_name TEXT,
    username TEXT,
    session_id TEXT,
    phone_number TEXT,
    is_connected INTEGER DEFAULT FALSE,
    connection_status TEXT DEFAULT 'disconnected',
    reconnect_attempts INTEGER DEFAULT 0,
    source TEXT DEFAULT 'telegram',
    detected INTEGER DEFAULT FALSE,
    detected_at TIMESTAMP,
    is_admin INTEGER DEFAULT FALSE,
    is_active INTEGER DEFAULT TRUE,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS web_users_auth (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- WHATSAPP USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS whatsapp_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER UNIQUE NOT NULL,
    jid TEXT,
    phone TEXT,
    name TEXT,
    bot_mode TEXT DEFAULT 'public',
    custom_prefix TEXT DEFAULT '.',
    antiviewonce_enabled INTEGER DEFAULT FALSE,
    antideleted_enabled INTEGER DEFAULT FALSE,
    vip_level INTEGER DEFAULT 0,
    is_default_vip INTEGER DEFAULT FALSE,
    owned_by_telegram_id INTEGER,
    claimed_at TIMESTAMP,
    auto_online INTEGER DEFAULT FALSE,
    auto_typing INTEGER DEFAULT FALSE,
    auto_recording INTEGER DEFAULT FALSE,
    auto_status_view INTEGER DEFAULT FALSE,
    auto_status_like INTEGER DEFAULT FALSE,
    default_presence TEXT DEFAULT 'unavailable',
    is_banned INTEGER DEFAULT FALSE,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    CONSTRAINT fk_owner FOREIGN KEY (owned_by_telegram_id) 
        REFERENCES whatsapp_users(telegram_id) ON DELETE SET NULL
);

-- ============================================
-- VIP TABLES
-- ============================================
CREATE TABLE IF NOT EXISTS vip_owned_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vip_telegram_id INTEGER NOT NULL,
    owned_telegram_id INTEGER NOT NULL,
    owned_phone TEXT,
    owned_jid TEXT,
    claimed_at TEXT DEFAULT (datetime('now')),
    last_used_at TIMESTAMP,
    takeovers_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT TRUE,
    CONSTRAINT fk_vip FOREIGN KEY (vip_telegram_id) 
        REFERENCES whatsapp_users(telegram_id) ON DELETE CASCADE,
    CONSTRAINT fk_owned FOREIGN KEY (owned_telegram_id) 
        REFERENCES whatsapp_users(telegram_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vip_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vip_telegram_id INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    target_user_telegram_id INTEGER,
    target_group_jid TEXT,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    CONSTRAINT fk_vip_activity FOREIGN KEY (vip_telegram_id) 
        REFERENCES whatsapp_users(telegram_id) ON DELETE CASCADE
);

-- ============================================
-- GROUPS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jid TEXT UNIQUE NOT NULL,
    name TEXT,
    description TEXT,
    telegram_id INTEGER,
    
    -- Group modes
    grouponly_enabled INTEGER DEFAULT FALSE,
    public_mode INTEGER DEFAULT TRUE,
    is_closed INTEGER DEFAULT FALSE,
    closed_until TIMESTAMP,
    
    -- Scheduling
    scheduled_close_time TIME,
    scheduled_open_time TIME,
    auto_schedule_enabled INTEGER DEFAULT FALSE,
    timezone TEXT DEFAULT 'UTC',
    
    -- Anti-features
    antilink_enabled INTEGER DEFAULT FALSE,
    anticall_enabled INTEGER DEFAULT FALSE,
    antipromote_enabled INTEGER DEFAULT FALSE,
    antidemote_enabled INTEGER DEFAULT FALSE,
    antibot_enabled INTEGER DEFAULT FALSE,
    antitag_enabled INTEGER DEFAULT FALSE,
    antitagadmin_enabled INTEGER DEFAULT FALSE,
    antigroupmention_enabled INTEGER DEFAULT FALSE,
    antiimage_enabled INTEGER DEFAULT FALSE,
    antivideo_enabled INTEGER DEFAULT FALSE,
    antiaudio_enabled INTEGER DEFAULT FALSE,
    antidocument_enabled INTEGER DEFAULT FALSE,
    antisticker_enabled INTEGER DEFAULT FALSE,
    antidelete_enabled INTEGER DEFAULT FALSE,
    antiviewonce_enabled INTEGER DEFAULT FALSE,
    antispam_enabled INTEGER DEFAULT FALSE,
    antiraid_enabled INTEGER DEFAULT FALSE,
    antiadd_enabled INTEGER DEFAULT FALSE,
    antivirtex_enabled INTEGER DEFAULT FALSE,
    antiremove_enabled INTEGER DEFAULT FALSE,
    
    -- Auto-features
    autowelcome_enabled INTEGER DEFAULT FALSE,
    autokick_enabled INTEGER DEFAULT FALSE,
    welcome_enabled INTEGER DEFAULT FALSE,
    goodbye_enabled INTEGER DEFAULT FALSE,
    warning_limit INTEGER DEFAULT 4,
    
    -- Metadata
    participants_count INTEGER DEFAULT 0,
    is_bot_admin INTEGER DEFAULT FALSE,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid TEXT NOT NULL,
    user_jid TEXT NOT NULL,
    promoted_by TEXT,
    promoted_at TEXT DEFAULT (datetime('now')),
    UNIQUE (group_jid, user_jid)
);

CREATE TABLE IF NOT EXISTS group_member_additions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid TEXT NOT NULL,
    added_user_jid TEXT NOT NULL,
    added_by_jid TEXT NOT NULL,
    added_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- MESSAGES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS messages (
    n_o INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL,
    from_jid TEXT NOT NULL,
    sender_jid TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    content TEXT,
    media TEXT,
    media_type TEXT,
    session_id TEXT,
    user_id TEXT,
    is_view_once INTEGER DEFAULT FALSE,
    from_me INTEGER DEFAULT FALSE,
    push_name TEXT DEFAULT 'Unknown',
    is_deleted INTEGER DEFAULT FALSE,
    deleted_at TEXT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(id, session_id)
);

-- ============================================
-- WARNINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_jid TEXT NOT NULL,
    group_jid TEXT NOT NULL,
    warning_type TEXT NOT NULL,
    warning_count INTEGER DEFAULT 1,
    reason TEXT,
    last_warning_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_jid, group_jid, warning_type)
);

-- ============================================
-- VIOLATIONS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS violations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_jid TEXT NOT NULL,
    group_jid TEXT NOT NULL,
    violation_type TEXT NOT NULL,
    message_content TEXT,
    detected_content TEXT,
    action_taken TEXT,
    warning_number INTEGER,
    message_id TEXT,
    violated_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- SPAM TRACKING TABLE (NEW)
-- ============================================
CREATE TABLE IF NOT EXISTS spam_tracking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid TEXT NOT NULL,
    user_jid TEXT NOT NULL,
    message_text TEXT,
    links TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ============================================
-- SIMPLE JSON-BASED ACTIVITY TRACKING
-- File: 002_user_activity_json.sql
-- ============================================

CREATE TABLE IF NOT EXISTS group_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid TEXT UNIQUE NOT NULL,
    group_name TEXT,
    
    -- ALL user activity in ONE JSON field
    activity_data TEXT DEFAULT '{}',
    
    -- Quick stats (calculated from JSON)
    total_members INTEGER DEFAULT 0,
    active_members_7d INTEGER DEFAULT 0,
    
    -- Timestamps
    last_message_at TIMESTAMP,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    
    FOREIGN KEY (group_jid) REFERENCES groups(jid) ON DELETE CASCADE
);

-- ============================================
-- SETTINGS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT,
    setting_key TEXT NOT NULL,
    setting_value TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, session_id, setting_key)
);

-- ============================================
-- ANALYTICS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS group_analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_jid TEXT NOT NULL,
    date TEXT NOT NULL,
    total_messages INTEGER DEFAULT 0,
    total_media_messages INTEGER DEFAULT 0,
    total_violations INTEGER DEFAULT 0,
    antilink_violations INTEGER DEFAULT 0,
    antispam_violations INTEGER DEFAULT 0,
    antiraid_violations INTEGER DEFAULT 0,
    active_users INTEGER DEFAULT 0,
    warned_users INTEGER DEFAULT 0,
    kicked_users INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(group_jid, date)
);

-- ============================================
-- CREATE ALL INDEXES
-- ============================================

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_session_id ON users(session_id);

-- WhatsApp Users indexes
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_telegram_id ON whatsapp_users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_jid ON whatsapp_users(jid) WHERE jid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_phone ON whatsapp_users(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_bot_mode ON whatsapp_users(telegram_id, bot_mode);
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_custom_prefix ON whatsapp_users(telegram_id, custom_prefix);
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_antiviewonce ON whatsapp_users(telegram_id) WHERE antiviewonce_enabled = true;
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_antideleted ON whatsapp_users(telegram_id) WHERE antideleted_enabled = true;
CREATE INDEX IF NOT EXISTS idx_vip_level ON whatsapp_users(vip_level) WHERE vip_level > 0;
CREATE INDEX IF NOT EXISTS idx_is_default_vip ON whatsapp_users(telegram_id) WHERE is_default_vip = true;
CREATE INDEX IF NOT EXISTS idx_owned_by ON whatsapp_users(owned_by_telegram_id) WHERE owned_by_telegram_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_whatsapp_users_presence ON whatsapp_users(telegram_id, auto_online, auto_typing, auto_recording);

-- VIP indexes
CREATE INDEX IF NOT EXISTS idx_vip_owned_active ON vip_owned_users(vip_telegram_id, is_active);
CREATE INDEX IF NOT EXISTS idx_owned_user_active ON vip_owned_users(owned_telegram_id, is_active);
CREATE INDEX IF NOT EXISTS idx_activity_vip ON vip_activity_log(vip_telegram_id);
CREATE INDEX IF NOT EXISTS idx_activity_date ON vip_activity_log(created_at DESC);

-- Groups indexes
CREATE INDEX IF NOT EXISTS idx_groups_jid ON groups(jid);
CREATE INDEX IF NOT EXISTS idx_groups_telegram_scheduler ON groups(telegram_id, scheduled_close_time, scheduled_open_time) WHERE auto_schedule_enabled = true;
CREATE INDEX IF NOT EXISTS idx_groups_auto_schedule ON groups(auto_schedule_enabled) WHERE auto_schedule_enabled = true;
CREATE INDEX IF NOT EXISTS idx_group_user ON admin_promotions(group_jid, user_jid);
CREATE INDEX IF NOT EXISTS idx_promoted_at ON admin_promotions(promoted_at);
CREATE INDEX IF NOT EXISTS idx_group_added ON group_member_additions(group_jid, added_at);
CREATE INDEX IF NOT EXISTS idx_added_by ON group_member_additions(added_by_jid);

-- Groups activityindexes
CREATE INDEX IF NOT EXISTS idx_group_activity_jid 
    ON group_activity(group_jid);
-- Index for JSON queries (optional, for advanced queries)

-- Messages indexes
CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_from_jid ON messages(from_jid);
CREATE INDEX IF NOT EXISTS idx_messages_sender_jid ON messages(sender_jid);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp_desc ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_id_session ON messages(id, session_id);

-- Warnings indexes
CREATE INDEX IF NOT EXISTS idx_warnings_user_group ON warnings(user_jid, group_jid);

-- Violations indexes
CREATE INDEX IF NOT EXISTS idx_violations_user_group ON violations(user_jid, group_jid);
CREATE INDEX IF NOT EXISTS idx_violations_date ON violations(violated_at DESC);

-- Spam tracking indexes (NEW)
CREATE INDEX IF NOT EXISTS idx_spam_tracking_group_user ON spam_tracking(group_jid, user_jid);
CREATE INDEX IF NOT EXISTS idx_spam_tracking_created ON spam_tracking(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_spam_tracking_lookup ON spam_tracking(group_jid, user_jid, created_at);

-- Settings indexes
CREATE INDEX IF NOT EXISTS idx_settings_user_session ON settings(user_id, session_id);

-- Analytics indexes
CREATE INDEX IF NOT EXISTS idx_analytics_group_date ON group_analytics(group_jid, date);

-- ============================================
-- CREATE UPDATE TRIGGERS
-- ============================================

-- Generic update timestamp function

-- Apply update triggers to tables

-- ============================================
-- WHATSAPP USER JID/PHONE TRANSFER TRIGGER
-- ============================================

-- ============================================
-- MESSAGES AUTO-CLEANUP TRIGGER
-- ============================================

-- ============================================
-- SPAM TRACKING AUTO-CLEANUP TRIGGER (NEW)
-- ============================================

-- ============================================
-- ADD COMMENTS
-- ============================================

-- ============================================
-- VERIFICATION
-- ============================================

