const { EmbedBuilder } = require('discord.js');

/**
 * Process template variables in text
 */
function processVariables(text, variables = {}) {
    if (!text) return '';
    return text.replace(/\{(\w+)\}/g, (match, key) => {
        return variables[key] !== undefined ? String(variables[key]) : match;
    });
}

/**
 * Build an EmbedBuilder from a config object
 */
function buildEmbed(config, variables = {}) {
    const embed = new EmbedBuilder();

    if (config.title) embed.setTitle(processVariables(config.title, variables).substring(0, 256));
    if (config.description) embed.setDescription(processVariables(config.description, variables).substring(0, 4096));
    if (config.color) {
        try { embed.setColor(config.color); } catch { embed.setColor('#5865F2'); }
    }
    if (config.author_name) {
        embed.setAuthor({
            name: processVariables(config.author_name, variables).substring(0, 256),
            iconURL: config.author_icon || undefined,
            url: config.author_url || undefined,
        });
    }
    if (config.thumbnail) embed.setThumbnail(config.thumbnail);
    if (config.image) embed.setImage(config.image);
    if (config.footer_text) {
        embed.setFooter({
            text: processVariables(config.footer_text, variables).substring(0, 2048),
            iconURL: config.footer_icon || undefined,
        });
    }
    if (config.timestamp) embed.setTimestamp();

    if (config.fields && Array.isArray(config.fields)) {
        for (const field of config.fields.slice(0, 25)) {
            if (field.name && field.value) {
                embed.addFields({
                    name: processVariables(field.name, variables).substring(0, 256),
                    value: processVariables(field.value, variables).substring(0, 1024),
                    inline: field.inline || false,
                });
            }
        }
    }

    return embed;
}

/**
 * Create default panel embed config
 */
function defaultPanelEmbed() {
    return {
        title: '🎫 Destek Ticket Sistemi',
        description: 'Aşağıdaki butonlardan birini kullanarak bir destek talebi oluşturabilirsiniz.\n\nLütfen ticket açmadan önce kuralları okuduğunuzdan emin olun.',
        color: '#5865F2',
        footer_text: 'Ticket Bot • Destek sistemi',
        timestamp: true,
    };
}

/**
 * Create default welcome embed for a ticket
 */
function defaultTicketWelcomeEmbed() {
    return {
        title: '🎫 Ticket #{number}',
        description: 'Merhaba {user}! Destek talebiniz oluşturuldu.\n\nLütfen sorununuzu detaylı olarak açıklayın, bir yetkili en kısa sürede size yardımcı olacaktır.',
        color: '#57F287',
        footer_text: 'Ticket açılma zamanı',
        timestamp: true,
    };
}

/**
 * Default close confirmation embed
 */
function closeConfirmEmbed() {
    return {
        title: '🔒 Ticket Kapatma',
        description: 'Bu ticketı kapatmak istediğinize emin misiniz?',
        color: '#ED4245',
        footer_text: 'Bu işlem geri alınabilir',
        timestamp: true,
    };
}

module.exports = {
    processVariables,
    buildEmbed,
    defaultPanelEmbed,
    defaultTicketWelcomeEmbed,
    closeConfirmEmbed,
};
