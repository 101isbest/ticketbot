const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, EmbedBuilder
} = require('discord.js');
const db = require('../database/service');
const { buildEmbed, defaultPanelEmbed } = require('../utils/embedBuilder');

/**
 * Build panel embed and components from panel config
 */
function buildPanelMessage(panel, categories) {
    const embedConfig = panel.embed_config && Object.keys(panel.embed_config).length > 0
        ? panel.embed_config
        : defaultPanelEmbed();

    const embed = buildEmbed(embedConfig, {
        guild: '',
        categories: categories.length,
    });

    const components = buildPanelComponents(panel, categories);

    return { embeds: [embed], components };
}

/**
 * Build panel components (buttons and select menus) respecting Discord limits
 */
function buildPanelComponents(panel, categories) {
    const componentsConfig = panel.components_config || [];
    const rows = [];

    // If explicit component config exists, use it
    if (componentsConfig.length > 0) {
        return buildFromConfig(componentsConfig, categories);
    }

    // Otherwise, auto-generate from active categories
    const activeCategories = categories.filter(c => c.is_active);

    if (activeCategories.length === 0) return [];

    // If 5 or fewer categories, use buttons
    if (activeCategories.length <= 5) {
        const row = new ActionRowBuilder();
        for (const cat of activeCategories) {
            const btn = new ButtonBuilder()
                .setCustomId(`open_ticket_${cat.id}`)
                .setLabel(cat.button_label || cat.name)
                .setStyle(ButtonStyle.Primary);
            if (cat.emoji) {
                try { btn.setEmoji(cat.emoji); } catch {}
            }
            row.addComponents(btn);
        }
        rows.push(row);
    }
    // If 6-25, use select menu
    else if (activeCategories.length <= 25) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId('ticket_category_select')
            .setPlaceholder('Ticket türünü seçin...')
            .addOptions(
                activeCategories.slice(0, 25).map(cat => ({
                    label: (cat.button_label || cat.name).substring(0, 100),
                    description: (cat.description || '').substring(0, 100) || undefined,
                    value: cat.id,
                    emoji: cat.emoji || undefined,
                }))
            );

        rows.push(new ActionRowBuilder().addComponents(menu));
    }
    // If more than 25, split into multiple rows
    else {
        // Use buttons in multiple rows (max 5 rows, 5 buttons each = 25)
        for (let i = 0; i < Math.min(activeCategories.length, 25); i += 5) {
            const row = new ActionRowBuilder();
            const chunk = activeCategories.slice(i, i + 5);
            for (const cat of chunk) {
                const btn = new ButtonBuilder()
                    .setCustomId(`open_ticket_${cat.id}`)
                    .setLabel((cat.button_label || cat.name).substring(0, 80))
                    .setStyle(ButtonStyle.Primary);
                if (cat.emoji) {
                    try { btn.setEmoji(cat.emoji); } catch {}
                }
                row.addComponents(btn);
            }
            rows.push(row);
        }
    }

    return rows.slice(0, 5); // Discord max 5 action rows
}

/**
 * Build components from explicit config
 */
function buildFromConfig(config, categories) {
    const rows = [];

    for (const rowConfig of config.slice(0, 5)) {
        if (rowConfig.type === 'buttons') {
            const row = new ActionRowBuilder();
            for (const btnConfig of (rowConfig.buttons || []).slice(0, 5)) {
                const cat = categories.find(c => c.id === btnConfig.category_id);
                const styles = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };
                const btn = new ButtonBuilder()
                    .setCustomId(`open_ticket_${btnConfig.category_id}`)
                    .setLabel((btnConfig.label || cat?.button_label || 'Ticket').substring(0, 80))
                    .setStyle(styles[btnConfig.style] || ButtonStyle.Primary);

                if (btnConfig.disabled) btn.setDisabled(true);
                if (btnConfig.emoji) {
                    try { btn.setEmoji(btnConfig.emoji); } catch {}
                }

                row.addComponents(btn);
            }
            if (row.components.length > 0) rows.push(row);
        } else if (rowConfig.type === 'select') {
            const options = (rowConfig.options || []).slice(0, 25).map(opt => {
                const cat = categories.find(c => c.id === opt.category_id);
                return {
                    label: (opt.label || cat?.button_label || 'Ticket').substring(0, 100),
                    description: (opt.description || cat?.description || '').substring(0, 100) || undefined,
                    value: opt.category_id,
                    emoji: opt.emoji || cat?.emoji || undefined,
                };
            }).filter(o => o.value);

            if (options.length > 0) {
                const menu = new StringSelectMenuBuilder()
                    .setCustomId(rowConfig.custom_id || 'ticket_category_select')
                    .setPlaceholder(rowConfig.placeholder || 'Ticket türünü seçin...')
                    .addOptions(options);
                rows.push(new ActionRowBuilder().addComponents(menu));
            }
        }
    }

    return rows.slice(0, 5);
}

/**
 * Deploy or update a panel message in a channel
 */
async function deployPanel(client, panel, guildId) {
    const categories = db.getCategories(guildId);
    const { embeds, components } = buildPanelMessage(panel, categories);

    const channelId = panel.channel_id;
    if (!channelId) return { success: false, error: 'Panel kanalı ayarlanmamış.' };

    try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return { success: false, error: 'Kanal bulunamadı.' };

        // Try to edit existing message first
        if (panel.message_id) {
            try {
                const msg = await channel.messages.fetch(panel.message_id);
                await msg.edit({ embeds, components });
                return { success: true, messageId: msg.id };
            } catch {
                // Message doesn't exist anymore, send new one
            }
        }

        // Send new message
        const msg = await channel.send({ embeds, components });
        db.updatePanel(panel.id, { message_id: msg.id, channel_id: channelId });

        return { success: true, messageId: msg.id };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * Deploy panel to multiple channels
 */
async function deployPanelToChannels(client, panel, guildId, channelIds) {
    const categories = db.getCategories(guildId);
    const { embeds, components } = buildPanelMessage(panel, categories);
    const results = [];

    for (const channelId of channelIds) {
        try {
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel) {
                results.push({ channelId, success: false, error: 'Kanal bulunamadı' });
                continue;
            }

            const msg = await channel.send({ embeds, components });
            db.addPanelDeployment(panel.id, guildId, channelId, msg.id);
            results.push({ channelId, success: true, messageId: msg.id });
        } catch (err) {
            results.push({ channelId, success: false, error: err.message });
        }
    }

    return results;
}

/**
 * Update all deployments of a panel
 */
async function updateAllDeployments(client, panel, guildId) {
    const categories = db.getCategories(guildId);
    const { embeds, components } = buildPanelMessage(panel, categories);

    // Update main message
    if (panel.channel_id && panel.message_id) {
        try {
            const channel = await client.channels.fetch(panel.channel_id).catch(() => null);
            if (channel) {
                const msg = await channel.messages.fetch(panel.message_id).catch(() => null);
                if (msg) await msg.edit({ embeds, components }).catch(() => {});
            }
        } catch {}
    }

    // Update all deployments
    const deployments = db.getPanelDeployments(panel.id);
    for (const dep of deployments) {
        try {
            const channel = await client.channels.fetch(dep.channel_id).catch(() => null);
            if (channel && dep.message_id) {
                const msg = await channel.messages.fetch(dep.message_id).catch(() => null);
                if (msg) await msg.edit({ embeds, components }).catch(() => {});
            }
        } catch {}
    }
}

module.exports = {
    buildPanelMessage,
    buildPanelComponents,
    deployPanel,
    deployPanelToChannels,
    updateAllDeployments,
};
