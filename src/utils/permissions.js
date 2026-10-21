const db = require('../database/service');

const PERMISSION_KEYS = {
    MANAGE_PANEL: 'manage_panel',
    CREATE_PANEL: 'create_panel',
    CLOSE_TICKET: 'close_ticket',
    DELETE_TICKET: 'delete_ticket',
    REOPEN_TICKET: 'reopen_ticket',
    CLAIM_TICKET: 'claim_ticket',
    ADD_USER: 'add_user',
    REMOVE_USER: 'remove_user',
    VIEW_TRANSCRIPT: 'view_transcript',
    MANAGE_CATEGORIES: 'manage_categories',
    MANAGE_SETTINGS: 'manage_settings',
    MANAGE_BLACKLIST: 'manage_blacklist',
    MANAGE_BACKUP: 'manage_backup',
};

/**
 * Check if a member has a specific permission
 */
function hasPermission(member, guildId, permissionKey) {
    if (!member || !guildId) return false;

    // Bot owner always has access
    if (member.id === process.env.OWNER_ID) return true;

    // Server owner always has access
    if (member.guild && member.guild.ownerId === member.id) return true;

    // Discord Administrator permission
    if (member.permissions && member.permissions.has('Administrator')) return true;

    // Check admin roles
    const adminRoles = db.getAdminRoles(guildId);
    if (adminRoles.some(roleId => member.roles?.cache?.has(roleId))) return true;

    // Check specific permission overrides
    const perms = db.getPermissions(guildId, permissionKey);
    for (const perm of perms) {
        if (perm.target_type === 'user' && perm.target_id === member.id) {
            return !!perm.allowed;
        }
        if (perm.target_type === 'role' && member.roles?.cache?.has(perm.target_id)) {
            return !!perm.allowed;
        }
    }

    return false;
}

/**
 * Check if a member is a ticket staff member (globally or for a category)
 */
function isStaff(member, guildId, categoryId) {
    if (!member || !guildId) return false;

    if (member.id === process.env.OWNER_ID) return true;
    if (member.guild && member.guild.ownerId === member.id) return true;
    if (member.permissions && member.permissions.has('Administrator')) return true;

    // Global staff roles
    const staffRoles = db.getStaffRoles(guildId);
    if (staffRoles.some(roleId => member.roles?.cache?.has(roleId))) return true;

    // Category-specific staff roles
    if (categoryId) {
        const category = db.getCategory(categoryId);
        if (category && category.staff_roles) {
            if (category.staff_roles.some(roleId => member.roles?.cache?.has(roleId))) return true;
        }
    }

    return false;
}

/**
 * Check if a member can access the admin panel
 */
function isAdmin(member, guildId) {
    return hasPermission(member, guildId, PERMISSION_KEYS.MANAGE_SETTINGS);
}

/**
 * Check if the bot has required permissions in a channel
 */
function checkBotPermissions(channel, requiredPerms = []) {
    if (!channel || !channel.guild) return { ok: false, missing: requiredPerms };
    const me = channel.guild.members.me;
    if (!me) return { ok: false, missing: requiredPerms };

    const missing = [];
    for (const perm of requiredPerms) {
        if (!channel.permissionsFor(me).has(perm)) {
            missing.push(perm);
        }
    }

    return { ok: missing.length === 0, missing };
}

module.exports = {
    PERMISSION_KEYS,
    hasPermission,
    isStaff,
    isAdmin,
    checkBotPermissions,
};
