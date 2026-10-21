const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'tickets.db');

let db;

function getDb() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        initializeSchema();
    }
    return db;
}

function initializeSchema() {
    const d = getDb();

    d.exec(`
        -- Guild settings
        CREATE TABLE IF NOT EXISTS guild_settings (
            guild_id TEXT PRIMARY KEY,
            language TEXT DEFAULT 'tr',
            setup_completed INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Ticket categories
        CREATE TABLE IF NOT EXISTS ticket_categories (
            id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            name TEXT NOT NULL,
            emoji TEXT DEFAULT '🎫',
            button_label TEXT NOT NULL,
            description TEXT DEFAULT '',
            welcome_message TEXT DEFAULT '',
            discord_category_id TEXT,
            channel_name_format TEXT DEFAULT 'ticket-{number}',
            max_tickets_per_user INTEGER DEFAULT 1,
            cooldown_seconds INTEGER DEFAULT 0,
            use_modal INTEGER DEFAULT 0,
            modal_title TEXT DEFAULT '',
            modal_fields TEXT DEFAULT '[]',
            priority TEXT DEFAULT 'normal',
            default_tags TEXT DEFAULT '[]',
            transcript_channel_id TEXT,
            open_log_channel_id TEXT,
            close_log_channel_id TEXT,
            auto_close_hours INTEGER DEFAULT 0,
            auto_archive_hours INTEGER DEFAULT 0,
            close_message TEXT DEFAULT '',
            claim_message TEXT DEFAULT '',
            color TEXT DEFAULT '#5865F2',
            embed_config TEXT DEFAULT '{}',
            is_active INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            allowed_roles TEXT DEFAULT '[]',
            allowed_users TEXT DEFAULT '[]',
            staff_roles TEXT DEFAULT '[]',
            additional_access_roles TEXT DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Ticket panels
        CREATE TABLE IF NOT EXISTS ticket_panels (
            id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            name TEXT NOT NULL,
            channel_id TEXT,
            message_id TEXT,
            embed_config TEXT DEFAULT '{}',
            components_config TEXT DEFAULT '[]',
            is_active INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Panel deployments (multiple channels)
        CREATE TABLE IF NOT EXISTS panel_deployments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            panel_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            message_id TEXT,
            guild_id TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (panel_id) REFERENCES ticket_panels(id) ON DELETE CASCADE
        );

        -- Active tickets
        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            channel_id TEXT UNIQUE,
            user_id TEXT NOT NULL,
            category_id TEXT,
            ticket_number INTEGER NOT NULL,
            status TEXT DEFAULT 'open',
            priority TEXT DEFAULT 'normal',
            topic TEXT DEFAULT '',
            tags TEXT DEFAULT '[]',
            claimed_by TEXT,
            modal_responses TEXT DEFAULT '{}',
            added_users TEXT DEFAULT '[]',
            added_roles TEXT DEFAULT '[]',
            opened_at TEXT DEFAULT (datetime('now')),
            closed_at TEXT,
            closed_by TEXT,
            close_reason TEXT,
            archived_at TEXT,
            deleted_at TEXT,
            transcript_url TEXT,
            rating INTEGER,
            rating_comment TEXT
        );

        -- Ticket messages for transcript
        CREATE TABLE IF NOT EXISTS ticket_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER NOT NULL,
            guild_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            username TEXT NOT NULL,
            avatar_url TEXT,
            content TEXT DEFAULT '',
            attachments TEXT DEFAULT '[]',
            embeds TEXT DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
        );

        -- Permission overrides
        CREATE TABLE IF NOT EXISTS permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            target_type TEXT NOT NULL, -- 'role' or 'user'
            target_id TEXT NOT NULL,
            permission TEXT NOT NULL,
            allowed INTEGER DEFAULT 1,
            UNIQUE(guild_id, target_type, target_id, permission)
        );

        -- Staff roles (global)
        CREATE TABLE IF NOT EXISTS staff_roles (
            guild_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            PRIMARY KEY (guild_id, role_id)
        );

        -- Admin roles (can access /ticket-admin)
        CREATE TABLE IF NOT EXISTS admin_roles (
            guild_id TEXT NOT NULL,
            role_id TEXT NOT NULL,
            PRIMARY KEY (guild_id, role_id)
        );

        -- Log channel config
        CREATE TABLE IF NOT EXISTS log_channels (
            guild_id TEXT NOT NULL,
            log_type TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            PRIMARY KEY (guild_id, log_type)
        );

        -- Ticket behavior settings
        CREATE TABLE IF NOT EXISTS ticket_settings (
            guild_id TEXT NOT NULL,
            setting_key TEXT NOT NULL,
            setting_value TEXT NOT NULL,
            PRIMARY KEY (guild_id, setting_key)
        );

        -- Blacklist
        CREATE TABLE IF NOT EXISTS blacklist (
            guild_id TEXT NOT NULL,
            target_type TEXT NOT NULL, -- 'user' or 'role'
            target_id TEXT NOT NULL,
            reason TEXT DEFAULT '',
            added_by TEXT NOT NULL,
            added_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (guild_id, target_type, target_id)
        );

        -- Embed templates
        CREATE TABLE IF NOT EXISTS embed_templates (
            id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            name TEXT NOT NULL,
            embed_config TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- Audit log
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            action TEXT NOT NULL,
            details TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now'))
        );

        -- Ticket counter per guild
        CREATE TABLE IF NOT EXISTS ticket_counters (
            guild_id TEXT PRIMARY KEY,
            counter INTEGER DEFAULT 0
        );

        -- Cooldowns
        CREATE TABLE IF NOT EXISTS cooldowns (
            guild_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            category_id TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            PRIMARY KEY (guild_id, user_id, category_id)
        );

        -- Messages/language strings
        CREATE TABLE IF NOT EXISTS custom_messages (
            guild_id TEXT NOT NULL,
            message_key TEXT NOT NULL,
            message_value TEXT NOT NULL,
            PRIMARY KEY (guild_id, message_key)
        );

        CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guild_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets(channel_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
        CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);
        CREATE INDEX IF NOT EXISTS idx_categories_guild ON ticket_categories(guild_id);
        CREATE INDEX IF NOT EXISTS idx_panels_guild ON ticket_panels(guild_id);
        CREATE INDEX IF NOT EXISTS idx_audit_guild ON audit_log(guild_id);
    `);
}

function close() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = { getDb, close, DATA_DIR, DB_PATH };
