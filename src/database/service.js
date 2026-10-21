const { getDb } = require('./database');
const { randomUUID } = require('crypto');

/* ──────────────────────────── Guild Settings ──────────────────────────── */
function getGuildSettings(guildId) {
    const db = getDb();
    let row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
    if (!row) {
        db.prepare('INSERT OR IGNORE INTO guild_settings (guild_id) VALUES (?)').run(guildId);
        row = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId);
    }
    return row;
}

function updateGuildSettings(guildId, data) {
    const db = getDb();
    const fields = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE guild_settings SET ${fields}, updated_at = datetime('now') WHERE guild_id = @guild_id`)
        .run({ ...data, guild_id: guildId });
}

/* ──────────────────────────── Ticket Settings (key-value) ──────────────────────────── */
const DEFAULT_SETTINGS = {
    channel_name_format: 'ticket-{number}',
    auto_numbering: '1',
    max_tickets_per_user: '3',
    max_tickets_per_category: '1',
    open_cooldown: '0',
    use_modal: '0',
    staff_notification: '1',
    close_confirmation: '1',
    close_reason_required: '0',
    reopen_timeout_hours: '48',
    auto_archive_hours: '0',
    auto_delete_hours: '0',
    inactive_warning_hours: '0',
    auto_close_hours: '0',
    claim_required: '0',
    priority_system: '1',
    tag_system: '1',
    user_rating: '0',
    max_added_users: '10',
    allow_category_change: '1',
    claim_cooldown: '0',
    transcript_format: 'html',
    transcript_dm: '0',
    archive_category_id: '',
    archive_channel_id: '',
    transcript_retention_days: '0',
};

function getTicketSetting(guildId, key) {
    const db = getDb();
    const row = db.prepare('SELECT setting_value FROM ticket_settings WHERE guild_id = ? AND setting_key = ?').get(guildId, key);
    return row ? row.setting_value : (DEFAULT_SETTINGS[key] || '');
}

function getAllTicketSettings(guildId) {
    const db = getDb();
    const rows = db.prepare('SELECT setting_key, setting_value FROM ticket_settings WHERE guild_id = ?').all(guildId);
    const result = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
        result[row.setting_key] = row.setting_value;
    }
    return result;
}

function setTicketSetting(guildId, key, value) {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO ticket_settings (guild_id, setting_key, setting_value) VALUES (?, ?, ?)')
        .run(guildId, key, String(value));
}

/* ──────────────────────────── Categories ──────────────────────────── */
function createCategory(guildId, data) {
    const db = getDb();
    const id = randomUUID();
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM ticket_categories WHERE guild_id = ?').get(guildId);
    db.prepare(`INSERT INTO ticket_categories (id, guild_id, name, emoji, button_label, description, welcome_message,
        discord_category_id, channel_name_format, max_tickets_per_user, cooldown_seconds, use_modal, modal_title, modal_fields,
        priority, default_tags, transcript_channel_id, open_log_channel_id, close_log_channel_id,
        auto_close_hours, auto_archive_hours, close_message, claim_message, color, embed_config, is_active,
        sort_order, allowed_roles, allowed_users, staff_roles, additional_access_roles)
        VALUES (@id, @guild_id, @name, @emoji, @button_label, @description, @welcome_message,
        @discord_category_id, @channel_name_format, @max_tickets_per_user, @cooldown_seconds, @use_modal, @modal_title, @modal_fields,
        @priority, @default_tags, @transcript_channel_id, @open_log_channel_id, @close_log_channel_id,
        @auto_close_hours, @auto_archive_hours, @close_message, @claim_message, @color, @embed_config, @is_active,
        @sort_order, @allowed_roles, @allowed_users, @staff_roles, @additional_access_roles)`)
        .run({
            id,
            guild_id: guildId,
            name: data.name || 'New Category',
            emoji: data.emoji || '🎫',
            button_label: data.button_label || data.name || 'New Category',
            description: data.description || '',
            welcome_message: data.welcome_message || '',
            discord_category_id: data.discord_category_id || null,
            channel_name_format: data.channel_name_format || 'ticket-{number}',
            max_tickets_per_user: data.max_tickets_per_user ?? 1,
            cooldown_seconds: data.cooldown_seconds ?? 0,
            use_modal: data.use_modal ?? 0,
            modal_title: data.modal_title || '',
            modal_fields: JSON.stringify(data.modal_fields || []),
            priority: data.priority || 'normal',
            default_tags: JSON.stringify(data.default_tags || []),
            transcript_channel_id: data.transcript_channel_id || null,
            open_log_channel_id: data.open_log_channel_id || null,
            close_log_channel_id: data.close_log_channel_id || null,
            auto_close_hours: data.auto_close_hours ?? 0,
            auto_archive_hours: data.auto_archive_hours ?? 0,
            close_message: data.close_message || '',
            claim_message: data.claim_message || '',
            color: data.color || '#5865F2',
            embed_config: JSON.stringify(data.embed_config || {}),
            is_active: data.is_active ?? 1,
            sort_order: (maxOrder?.m ?? -1) + 1,
            allowed_roles: JSON.stringify(data.allowed_roles || []),
            allowed_users: JSON.stringify(data.allowed_users || []),
            staff_roles: JSON.stringify(data.staff_roles || []),
            additional_access_roles: JSON.stringify(data.additional_access_roles || []),
        });
    return id;
}

function getCategory(categoryId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM ticket_categories WHERE id = ?').get(categoryId);
    if (row) {
        row.modal_fields = JSON.parse(row.modal_fields || '[]');
        row.default_tags = JSON.parse(row.default_tags || '[]');
        row.embed_config = JSON.parse(row.embed_config || '{}');
        row.allowed_roles = JSON.parse(row.allowed_roles || '[]');
        row.allowed_users = JSON.parse(row.allowed_users || '[]');
        row.staff_roles = JSON.parse(row.staff_roles || '[]');
        row.additional_access_roles = JSON.parse(row.additional_access_roles || '[]');
    }
    return row;
}

function getCategories(guildId) {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM ticket_categories WHERE guild_id = ? ORDER BY sort_order ASC').all(guildId);
    return rows.map(row => {
        row.modal_fields = JSON.parse(row.modal_fields || '[]');
        row.default_tags = JSON.parse(row.default_tags || '[]');
        row.embed_config = JSON.parse(row.embed_config || '{}');
        row.allowed_roles = JSON.parse(row.allowed_roles || '[]');
        row.allowed_users = JSON.parse(row.allowed_users || '[]');
        row.staff_roles = JSON.parse(row.staff_roles || '[]');
        row.additional_access_roles = JSON.parse(row.additional_access_roles || '[]');
        return row;
    });
}

function updateCategory(categoryId, data) {
    const db = getDb();
    const jsonFields = ['modal_fields', 'default_tags', 'embed_config', 'allowed_roles', 'allowed_users', 'staff_roles', 'additional_access_roles'];
    const processedData = { ...data };
    for (const f of jsonFields) {
        if (f in processedData && typeof processedData[f] !== 'string') {
            processedData[f] = JSON.stringify(processedData[f]);
        }
    }
    const fields = Object.keys(processedData).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE ticket_categories SET ${fields}, updated_at = datetime('now') WHERE id = @id`)
        .run({ ...processedData, id: categoryId });
}

function deleteCategory(categoryId) {
    const db = getDb();
    db.prepare('DELETE FROM ticket_categories WHERE id = ?').run(categoryId);
}

function duplicateCategory(categoryId) {
    const cat = getCategory(categoryId);
    if (!cat) return null;
    const { id, created_at, updated_at, ...rest } = cat;
    rest.name = rest.name + ' (Copy)';
    rest.button_label = rest.button_label + ' (Copy)';
    return createCategory(cat.guild_id, rest);
}

/* ──────────────────────────── Panels ──────────────────────────── */
function createPanel(guildId, data) {
    const db = getDb();
    const id = randomUUID();
    db.prepare(`INSERT INTO ticket_panels (id, guild_id, name, channel_id, message_id, embed_config, components_config, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, guildId, data.name || 'New Panel', data.channel_id || null, data.message_id || null,
            JSON.stringify(data.embed_config || {}), JSON.stringify(data.components_config || []), data.is_active ?? 1);
    return id;
}

function getPanel(panelId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM ticket_panels WHERE id = ?').get(panelId);
    if (row) {
        row.embed_config = JSON.parse(row.embed_config || '{}');
        row.components_config = JSON.parse(row.components_config || '[]');
    }
    return row;
}

function getPanels(guildId) {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM ticket_panels WHERE guild_id = ?').all(guildId);
    return rows.map(row => {
        row.embed_config = JSON.parse(row.embed_config || '{}');
        row.components_config = JSON.parse(row.components_config || '[]');
        return row;
    });
}

function updatePanel(panelId, data) {
    const db = getDb();
    const processedData = { ...data };
    if ('embed_config' in processedData && typeof processedData.embed_config !== 'string') {
        processedData.embed_config = JSON.stringify(processedData.embed_config);
    }
    if ('components_config' in processedData && typeof processedData.components_config !== 'string') {
        processedData.components_config = JSON.stringify(processedData.components_config);
    }
    const fields = Object.keys(processedData).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE ticket_panels SET ${fields}, updated_at = datetime('now') WHERE id = @id`)
        .run({ ...processedData, id: panelId });
}

function deletePanel(panelId) {
    const db = getDb();
    db.prepare('DELETE FROM ticket_panels WHERE id = ?').run(panelId);
    db.prepare('DELETE FROM panel_deployments WHERE panel_id = ?').run(panelId);
}

function duplicatePanel(panelId) {
    const panel = getPanel(panelId);
    if (!panel) return null;
    return createPanel(panel.guild_id, {
        name: panel.name + ' (Copy)',
        embed_config: panel.embed_config,
        components_config: panel.components_config,
        is_active: panel.is_active,
    });
}

function addPanelDeployment(panelId, guildId, channelId, messageId) {
    const db = getDb();
    db.prepare('INSERT INTO panel_deployments (panel_id, channel_id, message_id, guild_id) VALUES (?, ?, ?, ?)')
        .run(panelId, channelId, messageId, guildId);
}

function getPanelDeployments(panelId) {
    const db = getDb();
    return db.prepare('SELECT * FROM panel_deployments WHERE panel_id = ?').all(panelId);
}

function removePanelDeployment(id) {
    const db = getDb();
    db.prepare('DELETE FROM panel_deployments WHERE id = ?').run(id);
}

/* ──────────────────────────── Tickets ──────────────────────────── */
function getNextTicketNumber(guildId) {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO ticket_counters (guild_id, counter) VALUES (?, 0)').run(guildId);
    db.prepare('UPDATE ticket_counters SET counter = counter + 1 WHERE guild_id = ?').run(guildId);
    const row = db.prepare('SELECT counter FROM ticket_counters WHERE guild_id = ?').get(guildId);
    return row.counter;
}

function createTicket(data) {
    const db = getDb();
    const result = db.prepare(`INSERT INTO tickets (guild_id, channel_id, user_id, category_id, ticket_number, status, priority, topic, tags, modal_responses)
        VALUES (@guild_id, @channel_id, @user_id, @category_id, @ticket_number, 'open', @priority, @topic, @tags, @modal_responses)`)
        .run({
            guild_id: data.guild_id,
            channel_id: data.channel_id,
            user_id: data.user_id,
            category_id: data.category_id,
            ticket_number: data.ticket_number,
            priority: data.priority || 'normal',
            topic: data.topic || '',
            tags: JSON.stringify(data.tags || []),
            modal_responses: JSON.stringify(data.modal_responses || {}),
        });
    return result.lastInsertRowid;
}

function getTicketByChannel(channelId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId);
    if (row) {
        row.tags = JSON.parse(row.tags || '[]');
        row.modal_responses = JSON.parse(row.modal_responses || '{}');
        row.added_users = JSON.parse(row.added_users || '[]');
        row.added_roles = JSON.parse(row.added_roles || '[]');
    }
    return row;
}

function getTicketById(ticketId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    if (row) {
        row.tags = JSON.parse(row.tags || '[]');
        row.modal_responses = JSON.parse(row.modal_responses || '{}');
        row.added_users = JSON.parse(row.added_users || '[]');
        row.added_roles = JSON.parse(row.added_roles || '[]');
    }
    return row;
}

function getOpenTickets(guildId, userId) {
    const db = getDb();
    return db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'").all(guildId, userId);
}

function getOpenTicketsByCategory(guildId, userId, categoryId) {
    const db = getDb();
    return db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND category_id = ? AND status = 'open'").all(guildId, userId, categoryId);
}

function getAllOpenTickets(guildId) {
    const db = getDb();
    return db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND status = 'open'").all(guildId);
}

function updateTicket(ticketId, data) {
    const db = getDb();
    const processedData = { ...data };
    const jsonFields = ['tags', 'modal_responses', 'added_users', 'added_roles'];
    for (const f of jsonFields) {
        if (f in processedData && typeof processedData[f] !== 'string') {
            processedData[f] = JSON.stringify(processedData[f]);
        }
    }
    const fields = Object.keys(processedData).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE tickets SET ${fields} WHERE id = @id`).run({ ...processedData, id: ticketId });
}

function closeTicket(ticketId, closedBy, reason) {
    const db = getDb();
    db.prepare("UPDATE tickets SET status = 'closed', closed_at = datetime('now'), closed_by = ?, close_reason = ? WHERE id = ?")
        .run(closedBy, reason || '', ticketId);
}

function reopenTicket(ticketId) {
    const db = getDb();
    db.prepare("UPDATE tickets SET status = 'open', closed_at = NULL, closed_by = NULL, close_reason = NULL WHERE id = ?")
        .run(ticketId);
}

function deleteTicketRecord(ticketId) {
    const db = getDb();
    db.prepare("UPDATE tickets SET status = 'deleted', deleted_at = datetime('now') WHERE id = ?").run(ticketId);
}

/* ──────────────────────────── Ticket Messages ──────────────────────────── */
function saveMessage(data) {
    const db = getDb();
    db.prepare(`INSERT INTO ticket_messages (ticket_id, guild_id, message_id, user_id, username, avatar_url, content, attachments, embeds, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(data.ticket_id, data.guild_id, data.message_id, data.user_id, data.username,
            data.avatar_url || '', data.content || '', JSON.stringify(data.attachments || []),
            JSON.stringify(data.embeds || []), data.created_at || new Date().toISOString());
}

function getTicketMessages(ticketId) {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC').all(ticketId);
    return rows.map(row => {
        row.attachments = JSON.parse(row.attachments || '[]');
        row.embeds = JSON.parse(row.embeds || '[]');
        return row;
    });
}

/* ──────────────────────────── Permissions ──────────────────────────── */
function setPermission(guildId, targetType, targetId, permission, allowed) {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO permissions (guild_id, target_type, target_id, permission, allowed) VALUES (?, ?, ?, ?, ?)')
        .run(guildId, targetType, targetId, permission, allowed ? 1 : 0);
}

function getPermissions(guildId, permission) {
    const db = getDb();
    return db.prepare('SELECT * FROM permissions WHERE guild_id = ? AND permission = ?').all(guildId, permission);
}

function removePermission(guildId, targetType, targetId, permission) {
    const db = getDb();
    db.prepare('DELETE FROM permissions WHERE guild_id = ? AND target_type = ? AND target_id = ? AND permission = ?')
        .run(guildId, targetType, targetId, permission);
}

/* ──────────────────────────── Staff & Admin Roles ──────────────────────────── */
function addStaffRole(guildId, roleId) {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO staff_roles (guild_id, role_id) VALUES (?, ?)').run(guildId, roleId);
}

function removeStaffRole(guildId, roleId) {
    const db = getDb();
    db.prepare('DELETE FROM staff_roles WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
}

function getStaffRoles(guildId) {
    const db = getDb();
    return db.prepare('SELECT role_id FROM staff_roles WHERE guild_id = ?').all(guildId).map(r => r.role_id);
}

function addAdminRole(guildId, roleId) {
    const db = getDb();
    db.prepare('INSERT OR IGNORE INTO admin_roles (guild_id, role_id) VALUES (?, ?)').run(guildId, roleId);
}

function removeAdminRole(guildId, roleId) {
    const db = getDb();
    db.prepare('DELETE FROM admin_roles WHERE guild_id = ? AND role_id = ?').run(guildId, roleId);
}

function getAdminRoles(guildId) {
    const db = getDb();
    return db.prepare('SELECT role_id FROM admin_roles WHERE guild_id = ?').all(guildId).map(r => r.role_id);
}

/* ──────────────────────────── Log Channels ──────────────────────────── */
function setLogChannel(guildId, logType, channelId) {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO log_channels (guild_id, log_type, channel_id) VALUES (?, ?, ?)').run(guildId, logType, channelId);
}

function getLogChannel(guildId, logType) {
    const db = getDb();
    const row = db.prepare('SELECT channel_id FROM log_channels WHERE guild_id = ? AND log_type = ?').get(guildId, logType);
    return row ? row.channel_id : null;
}

function getAllLogChannels(guildId) {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM log_channels WHERE guild_id = ?').all(guildId);
    const result = {};
    for (const row of rows) result[row.log_type] = row.channel_id;
    return result;
}

/* ──────────────────────────── Blacklist ──────────────────────────── */
function addBlacklist(guildId, targetType, targetId, reason, addedBy) {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO blacklist (guild_id, target_type, target_id, reason, added_by) VALUES (?, ?, ?, ?, ?)')
        .run(guildId, targetType, targetId, reason || '', addedBy);
}

function removeBlacklist(guildId, targetType, targetId) {
    const db = getDb();
    db.prepare('DELETE FROM blacklist WHERE guild_id = ? AND target_type = ? AND target_id = ?').run(guildId, targetType, targetId);
}

function isBlacklisted(guildId, userId, memberRoles) {
    const db = getDb();
    const userBan = db.prepare("SELECT 1 FROM blacklist WHERE guild_id = ? AND target_type = 'user' AND target_id = ?").get(guildId, userId);
    if (userBan) return true;
    if (memberRoles && memberRoles.length > 0) {
        const placeholders = memberRoles.map(() => '?').join(',');
        const roleBan = db.prepare(`SELECT 1 FROM blacklist WHERE guild_id = ? AND target_type = 'role' AND target_id IN (${placeholders})`).get(guildId, ...memberRoles);
        if (roleBan) return true;
    }
    return false;
}

function getBlacklist(guildId) {
    const db = getDb();
    return db.prepare('SELECT * FROM blacklist WHERE guild_id = ? ORDER BY added_at DESC').all(guildId);
}

/* ──────────────────────────── Embed Templates ──────────────────────────── */
function saveEmbedTemplate(guildId, name, config) {
    const db = getDb();
    const id = randomUUID();
    db.prepare('INSERT INTO embed_templates (id, guild_id, name, embed_config) VALUES (?, ?, ?, ?)')
        .run(id, guildId, name, JSON.stringify(config));
    return id;
}

function getEmbedTemplates(guildId) {
    const db = getDb();
    return db.prepare('SELECT * FROM embed_templates WHERE guild_id = ?').all(guildId).map(r => {
        r.embed_config = JSON.parse(r.embed_config || '{}');
        return r;
    });
}

function deleteEmbedTemplate(templateId) {
    const db = getDb();
    db.prepare('DELETE FROM embed_templates WHERE id = ?').run(templateId);
}

/* ──────────────────────────── Audit Log ──────────────────────────── */
function addAuditLog(guildId, userId, action, details) {
    const db = getDb();
    db.prepare('INSERT INTO audit_log (guild_id, user_id, action, details) VALUES (?, ?, ?, ?)')
        .run(guildId, userId, action, typeof details === 'string' ? details : JSON.stringify(details));
}

function getAuditLogs(guildId, limit = 50) {
    const db = getDb();
    return db.prepare('SELECT * FROM audit_log WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, limit);
}

/* ──────────────────────────── Cooldowns ──────────────────────────── */
function setCooldown(guildId, userId, categoryId, expiresAt) {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO cooldowns (guild_id, user_id, category_id, expires_at) VALUES (?, ?, ?, ?)')
        .run(guildId, userId, categoryId, expiresAt);
}

function getCooldown(guildId, userId, categoryId) {
    const db = getDb();
    const row = db.prepare('SELECT expires_at FROM cooldowns WHERE guild_id = ? AND user_id = ? AND category_id = ?').get(guildId, userId, categoryId);
    if (!row) return null;
    if (new Date(row.expires_at) <= new Date()) {
        db.prepare('DELETE FROM cooldowns WHERE guild_id = ? AND user_id = ? AND category_id = ?').run(guildId, userId, categoryId);
        return null;
    }
    return row.expires_at;
}

function clearExpiredCooldowns() {
    const db = getDb();
    db.prepare("DELETE FROM cooldowns WHERE expires_at <= datetime('now')").run();
}

/* ──────────────────────────── Custom Messages ──────────────────────────── */
function setCustomMessage(guildId, key, value) {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO custom_messages (guild_id, message_key, message_value) VALUES (?, ?, ?)')
        .run(guildId, key, value);
}

function getCustomMessage(guildId, key) {
    const db = getDb();
    const row = db.prepare('SELECT message_value FROM custom_messages WHERE guild_id = ? AND message_key = ?').get(guildId, key);
    return row ? row.message_value : null;
}

function getAllCustomMessages(guildId) {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM custom_messages WHERE guild_id = ?').all(guildId);
    const result = {};
    for (const row of rows) result[row.message_key] = row.message_value;
    return result;
}

/* ──────────────────────────── Statistics ──────────────────────────── */
function getStats(guildId) {
    const db = getDb();
    const totalTickets = db.prepare('SELECT COUNT(*) as c FROM tickets WHERE guild_id = ?').get(guildId).c;
    const openTickets = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE guild_id = ? AND status = 'open'").get(guildId).c;
    const closedTickets = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE guild_id = ? AND status = 'closed'").get(guildId).c;
    const totalCategories = db.prepare('SELECT COUNT(*) as c FROM ticket_categories WHERE guild_id = ?').get(guildId).c;
    const totalPanels = db.prepare('SELECT COUNT(*) as c FROM ticket_panels WHERE guild_id = ?').get(guildId).c;

    const avgRating = db.prepare('SELECT AVG(rating) as avg FROM tickets WHERE guild_id = ? AND rating IS NOT NULL').get(guildId).avg;

    const topStaff = db.prepare(`SELECT claimed_by, COUNT(*) as count FROM tickets WHERE guild_id = ? AND claimed_by IS NOT NULL GROUP BY claimed_by ORDER BY count DESC LIMIT 5`).all(guildId);

    const categoryBreakdown = db.prepare(`SELECT tc.name, COUNT(t.id) as count FROM tickets t JOIN ticket_categories tc ON t.category_id = tc.id WHERE t.guild_id = ? GROUP BY t.category_id ORDER BY count DESC`).all(guildId);

    const todayTickets = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE guild_id = ? AND opened_at >= date('now')").get(guildId).c;
    const weekTickets = db.prepare("SELECT COUNT(*) as c FROM tickets WHERE guild_id = ? AND opened_at >= date('now', '-7 days')").get(guildId).c;

    return { totalTickets, openTickets, closedTickets, totalCategories, totalPanels, avgRating, topStaff, categoryBreakdown, todayTickets, weekTickets };
}

module.exports = {
    getGuildSettings, updateGuildSettings,
    getTicketSetting, getAllTicketSettings, setTicketSetting, DEFAULT_SETTINGS,
    createCategory, getCategory, getCategories, updateCategory, deleteCategory, duplicateCategory,
    createPanel, getPanel, getPanels, updatePanel, deletePanel, duplicatePanel,
    addPanelDeployment, getPanelDeployments, removePanelDeployment,
    getNextTicketNumber, createTicket, getTicketByChannel, getTicketById,
    getOpenTickets, getOpenTicketsByCategory, getAllOpenTickets, updateTicket, closeTicket, reopenTicket, deleteTicketRecord,
    saveMessage, getTicketMessages,
    setPermission, getPermissions, removePermission,
    addStaffRole, removeStaffRole, getStaffRoles,
    addAdminRole, removeAdminRole, getAdminRoles,
    setLogChannel, getLogChannel, getAllLogChannels,
    addBlacklist, removeBlacklist, isBlacklisted, getBlacklist,
    saveEmbedTemplate, getEmbedTemplates, deleteEmbedTemplate,
    addAuditLog, getAuditLogs,
    setCooldown, getCooldown, clearExpiredCooldowns,
    setCustomMessage, getCustomMessage, getAllCustomMessages,
    getStats,
};
