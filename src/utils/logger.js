const { EmbedBuilder } = require('discord.js');
const db = require('../database/service');

const LOG_TYPES = {
    TICKET_OPEN: 'ticket_open',
    TICKET_CLOSE: 'ticket_close',
    TICKET_DELETE: 'ticket_delete',
    TICKET_REOPEN: 'ticket_reopen',
    TICKET_CLAIM: 'ticket_claim',
    TICKET_UNCLAIM: 'ticket_unclaim',
    USER_ADD: 'user_add',
    USER_REMOVE: 'user_remove',
    CATEGORY_CHANGE: 'category_change',
    PRIORITY_CHANGE: 'priority_change',
    TOPIC_CHANGE: 'topic_change',
    STAFF_CALL: 'staff_call',
    TRANSCRIPT_CREATE: 'transcript_create',
    ADMIN_CHANGE: 'admin_change',
};

const LOG_COLORS = {
    [LOG_TYPES.TICKET_OPEN]: '#57F287',
    [LOG_TYPES.TICKET_CLOSE]: '#ED4245',
    [LOG_TYPES.TICKET_DELETE]: '#ED4245',
    [LOG_TYPES.TICKET_REOPEN]: '#FEE75C',
    [LOG_TYPES.TICKET_CLAIM]: '#5865F2',
    [LOG_TYPES.TICKET_UNCLAIM]: '#EB459E',
    [LOG_TYPES.USER_ADD]: '#57F287',
    [LOG_TYPES.USER_REMOVE]: '#ED4245',
    [LOG_TYPES.CATEGORY_CHANGE]: '#5865F2',
    [LOG_TYPES.PRIORITY_CHANGE]: '#FEE75C',
    [LOG_TYPES.TOPIC_CHANGE]: '#5865F2',
    [LOG_TYPES.STAFF_CALL]: '#EB459E',
    [LOG_TYPES.TRANSCRIPT_CREATE]: '#57F287',
    [LOG_TYPES.ADMIN_CHANGE]: '#FEE75C',
};

const LOG_TITLES = {
    [LOG_TYPES.TICKET_OPEN]: '📩 Ticket Açıldı',
    [LOG_TYPES.TICKET_CLOSE]: '🔒 Ticket Kapatıldı',
    [LOG_TYPES.TICKET_DELETE]: '🗑️ Ticket Silindi',
    [LOG_TYPES.TICKET_REOPEN]: '🔓 Ticket Yeniden Açıldı',
    [LOG_TYPES.TICKET_CLAIM]: '✋ Ticket Sahiplenildi',
    [LOG_TYPES.TICKET_UNCLAIM]: '👋 Ticket Sahiplik Bırakıldı',
    [LOG_TYPES.USER_ADD]: '➕ Kullanıcı Eklendi',
    [LOG_TYPES.USER_REMOVE]: '➖ Kullanıcı Çıkarıldı',
    [LOG_TYPES.CATEGORY_CHANGE]: '📂 Kategori Değiştirildi',
    [LOG_TYPES.PRIORITY_CHANGE]: '🏷️ Öncelik Değiştirildi',
    [LOG_TYPES.TOPIC_CHANGE]: '📝 Konu Değiştirildi',
    [LOG_TYPES.STAFF_CALL]: '🔔 Yetkili Çağrıldı',
    [LOG_TYPES.TRANSCRIPT_CREATE]: '📄 Transcript Oluşturuldu',
    [LOG_TYPES.ADMIN_CHANGE]: '⚙️ Ayar Değiştirildi',
};

/**
 * Send a log message to the appropriate log channel
 */
async function sendLog(client, guildId, logType, data = {}) {
    try {
        // Check category-specific log channel first
        let channelId = null;
        if (data.categoryId) {
            const category = db.getCategory(data.categoryId);
            if (category) {
                if (logType === LOG_TYPES.TICKET_OPEN && category.open_log_channel_id) {
                    channelId = category.open_log_channel_id;
                } else if (logType === LOG_TYPES.TICKET_CLOSE && category.close_log_channel_id) {
                    channelId = category.close_log_channel_id;
                }
            }
        }

        // Fallback to global log channel
        if (!channelId) {
            channelId = db.getLogChannel(guildId, logType);
        }

        if (!channelId) return;

        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle(LOG_TITLES[logType] || '📋 Log')
            .setColor(LOG_COLORS[logType] || '#5865F2')
            .setTimestamp();

        if (data.user) embed.addFields({ name: 'Kullanıcı', value: `<@${data.user}>`, inline: true });
        if (data.staff) embed.addFields({ name: 'Yetkili', value: `<@${data.staff}>`, inline: true });
        if (data.ticket) embed.addFields({ name: 'Ticket', value: `#${data.ticket}`, inline: true });
        if (data.channel) embed.addFields({ name: 'Kanal', value: `<#${data.channel}>`, inline: true });
        if (data.category) embed.addFields({ name: 'Kategori', value: data.category, inline: true });
        if (data.reason) embed.addFields({ name: 'Neden', value: data.reason, inline: false });
        if (data.details) embed.addFields({ name: 'Detaylar', value: data.details, inline: false });
        if (data.oldValue) embed.addFields({ name: 'Eski Değer', value: data.oldValue, inline: true });
        if (data.newValue) embed.addFields({ name: 'Yeni Değer', value: data.newValue, inline: true });

        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (error) {
        console.error(`[LOG ERROR] ${logType}:`, error.message);
    }
}

module.exports = { LOG_TYPES, sendLog };
