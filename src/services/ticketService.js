const {
    ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder,
    ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    StringSelectMenuBuilder
} = require('discord.js');
const db = require('../database/service');
const { buildEmbed, processVariables } = require('../utils/embedBuilder');
const { sendLog, LOG_TYPES } = require('../utils/logger');
const { isStaff, checkBotPermissions } = require('../utils/permissions');
const { saveTranscriptFile } = require('../utils/transcript');

/**
 * Open a new ticket
 */
async function openTicket(interaction, categoryId, modalResponses = {}) {
    const { guild, user, client } = interaction;
    const guildId = guild.id;

    const category = db.getCategory(categoryId);
    if (!category) {
        return interaction.reply({ content: '❌ Bu ticket kategorisi bulunamadı.', flags: 64 });
    }
    if (!category.is_active) {
        return interaction.reply({ content: '❌ Bu ticket kategorisi şu anda aktif değil.', flags: 64 });
    }

    // Check blacklist
    const memberRoles = interaction.member.roles?.cache?.map(r => r.id) || [];
    if (db.isBlacklisted(guildId, user.id, memberRoles)) {
        return interaction.reply({ content: '❌ Ticket açma yetkiniz engellenmiştir.', flags: 64 });
    }

    // Check allowed roles/users
    if (category.allowed_roles.length > 0 || category.allowed_users.length > 0) {
        const hasRole = category.allowed_roles.some(r => memberRoles.includes(r));
        const isUser = category.allowed_users.includes(user.id);
        if (!hasRole && !isUser) {
            return interaction.reply({ content: '❌ Bu kategoride ticket açma yetkiniz yok.', flags: 64 });
        }
    }

    // Check cooldown
    const cooldown = db.getCooldown(guildId, user.id, categoryId);
    if (cooldown) {
        const expiresAt = new Date(cooldown);
        return interaction.reply({
            content: `❌ Bu kategoride ticket açmak için beklemeniz gerekiyor. <t:${Math.floor(expiresAt.getTime() / 1000)}:R> tekrar deneyebilirsiniz.`,
            flags: 64
        });
    }

    // Check per-category limit
    const openInCategory = db.getOpenTicketsByCategory(guildId, user.id, categoryId);
    const maxPerCat = category.max_tickets_per_user || 1;
    if (openInCategory.length >= maxPerCat) {
        return interaction.reply({
            content: `❌ Bu kategoride en fazla **${maxPerCat}** açık ticket olabilir. Lütfen mevcut ticketlarınızı kapatın.`,
            flags: 64
        });
    }

    // Check global limit
    const globalMax = parseInt(db.getTicketSetting(guildId, 'max_tickets_per_user')) || 3;
    const allOpen = db.getOpenTickets(guildId, user.id);
    if (allOpen.length >= globalMax) {
        return interaction.reply({
            content: `❌ Aynı anda en fazla **${globalMax}** açık ticket olabilir.`,
            flags: 64
        });
    }

    // Check modal requirement
    if (category.use_modal && category.modal_fields.length > 0 && Object.keys(modalResponses).length === 0) {
        return showTicketModal(interaction, category);
    }

    await interaction.deferReply({ flags: 64 });

    // Get ticket number
    const ticketNumber = db.getNextTicketNumber(guildId);

    // Build channel name
    let channelName = (category.channel_name_format || 'ticket-{number}')
        .replace('{number}', String(ticketNumber).padStart(4, '0'))
        .replace('{user}', user.username.toLowerCase().replace(/[^a-z0-9-]/g, ''))
        .replace('{category}', category.name.toLowerCase().replace(/[^a-z0-9-]/g, ''));
    channelName = channelName.substring(0, 100);

    // Set up permissions
    const permissionOverwrites = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    ];

    // Add global staff roles
    const staffRoles = db.getStaffRoles(guildId);
    for (const roleId of staffRoles) {
        const role = guild.roles.cache.get(roleId);
        if (role) {
            permissionOverwrites.push({
                id: roleId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
            });
        }
    }

    // Add category-specific staff roles
    for (const roleId of (category.staff_roles || [])) {
        const role = guild.roles.cache.get(roleId);
        if (role && !staffRoles.includes(roleId)) {
            permissionOverwrites.push({
                id: roleId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
            });
        }
    }

    // Add additional access roles
    for (const roleId of (category.additional_access_roles || [])) {
        const role = guild.roles.cache.get(roleId);
        if (role) {
            permissionOverwrites.push({
                id: roleId,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
            });
        }
    }

    try {
        // Create channel
        const ticketChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.discord_category_id || undefined,
            permissionOverwrites,
            topic: `Ticket #${ticketNumber} | ${user.tag || user.username} | ${category.name}`,
        });

        // Save to database
        const ticketId = db.createTicket({
            guild_id: guildId,
            channel_id: ticketChannel.id,
            user_id: user.id,
            category_id: categoryId,
            ticket_number: ticketNumber,
            priority: category.priority || 'normal',
            tags: category.default_tags || [],
            modal_responses: modalResponses,
        });

        // Set cooldown
        if (category.cooldown_seconds > 0) {
            const expiresAt = new Date(Date.now() + category.cooldown_seconds * 1000).toISOString();
            db.setCooldown(guildId, user.id, categoryId, expiresAt);
        }

        // Build welcome message
        const variables = {
            user: `<@${user.id}>`,
            username: user.username,
            number: ticketNumber,
            category: category.name,
            guild: guild.name,
        };

        let welcomeEmbed;
        if (category.embed_config && Object.keys(category.embed_config).length > 0) {
            welcomeEmbed = buildEmbed(category.embed_config, variables);
        } else {
            welcomeEmbed = new EmbedBuilder()
                .setTitle(`🎫 Ticket #${ticketNumber}`)
                .setDescription(
                    category.welcome_message
                        ? processVariables(category.welcome_message, variables)
                        : `Merhaba ${variables.user}! **${category.name}** kategorisinde destek talebiniz oluşturuldu.\n\nLütfen sorununuzu detaylı olarak açıklayın, bir yetkili en kısa sürede size yardımcı olacaktır.`
                )
                .setColor(category.color || '#57F287')
                .setTimestamp()
                .setFooter({ text: `Kategori: ${category.name} • Ticket #${ticketNumber}` });
        }

        // Add modal responses to embed
        if (Object.keys(modalResponses).length > 0) {
            for (const [key, value] of Object.entries(modalResponses)) {
                welcomeEmbed.addFields({ name: key, value: value.substring(0, 1024) || 'Boş', inline: false });
            }
        }

        // Build action buttons
        const actionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ticket_close_${ticketChannel.id}`).setLabel('Kapat').setEmoji('🔒').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`ticket_claim_${ticketChannel.id}`).setLabel('Sahiplen').setEmoji('✋').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`ticket_transcript_${ticketChannel.id}`).setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
        );

        await ticketChannel.send({ content: `<@${user.id}>`, embeds: [welcomeEmbed], components: [actionRow] });

        // Notify staff
        const notifySetting = db.getTicketSetting(guildId, 'staff_notification');
        if (notifySetting === '1') {
            const mentions = staffRoles.map(r => `<@&${r}>`).join(' ');
            const catStaffMentions = (category.staff_roles || []).filter(r => !staffRoles.includes(r)).map(r => `<@&${r}>`).join(' ');
            const allMentions = [mentions, catStaffMentions].filter(Boolean).join(' ');
            if (allMentions) {
                const notifMsg = await ticketChannel.send({ content: `${allMentions} — Yeni ticket açıldı!` });
                setTimeout(() => notifMsg.delete().catch(() => {}), 5000);
            }
        }

        // Send log
        sendLog(client, guildId, LOG_TYPES.TICKET_OPEN, {
            user: user.id,
            ticket: ticketNumber,
            channel: ticketChannel.id,
            category: category.name,
            categoryId: categoryId,
        });

        // Add audit log
        db.addAuditLog(guildId, user.id, 'ticket_open', { ticket_number: ticketNumber, category: category.name });

        await interaction.editReply({
            content: `✅ Ticket başarıyla oluşturuldu! → <#${ticketChannel.id}>`,
        });

    } catch (error) {
        console.error('[TICKET OPEN ERROR]', error);
        await interaction.editReply({ content: '❌ Ticket oluşturulurken bir hata oluştu. Lütfen bot izinlerini kontrol edin.' }).catch(() => {});
    }
}

/**
 * Show ticket creation modal
 */
function showTicketModal(interaction, category) {
    const modal = new ModalBuilder()
        .setCustomId(`ticket_modal_${category.id}`)
        .setTitle((category.modal_title || `${category.name} - Ticket`).substring(0, 45));

    const fields = category.modal_fields.slice(0, 5); // Discord max 5 fields
    for (const field of fields) {
        const input = new TextInputBuilder()
            .setCustomId(field.id || field.label.toLowerCase().replace(/\s+/g, '_'))
            .setLabel(field.label.substring(0, 45))
            .setStyle(field.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
            .setRequired(field.required !== false)
            .setPlaceholder(field.placeholder || '');

        if (field.min_length) input.setMinLength(field.min_length);
        if (field.max_length) input.setMaxLength(field.max_length);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
    }

    return interaction.showModal(modal);
}

/**
 * Close a ticket
 */
async function closeTicketAction(interaction, channelId, reason = '') {
    const ticket = db.getTicketByChannel(channelId);
    if (!ticket || ticket.status !== 'open') {
        return interaction.reply({ content: '❌ Bu kanal aktif bir ticket değil.', flags: 64 });
    }

    const { guild, user, client } = interaction;
    const guildId = guild.id;

    // Permission check
    const isOwner = ticket.user_id === user.id;
    const staffMember = isStaff(interaction.member, guildId, ticket.category_id);
    if (!isOwner && !staffMember) {
        return interaction.reply({ content: '❌ Bu ticketı kapatma yetkiniz yok.', flags: 64 });
    }

    // Check close reason requirement
    const reasonRequired = db.getTicketSetting(guildId, 'close_reason_required') === '1';
    if (reasonRequired && !reason && staffMember) {
        const modal = new ModalBuilder()
            .setCustomId(`ticket_close_reason_${channelId}`)
            .setTitle('Ticket Kapatma Nedeni');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('close_reason')
                    .setLabel('Kapatma nedeni')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setPlaceholder('Lütfen kapatma nedenini yazın...')
            )
        );

        return interaction.showModal(modal);
    }

    // Confirmation
    const confirmSetting = db.getTicketSetting(guildId, 'close_confirmation');
    if (confirmSetting === '1' && !interaction.customId?.startsWith('ticket_close_confirm_')) {
        const embed = new EmbedBuilder()
            .setTitle('🔒 Ticket Kapatma Onayı')
            .setDescription('Bu ticketı kapatmak istediğinize emin misiniz?')
            .setColor('#ED4245')
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ticket_close_confirm_${channelId}`).setLabel('Evet, Kapat').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
            new ButtonBuilder().setCustomId(`ticket_close_cancel_${channelId}`).setLabel('İptal').setStyle(ButtonStyle.Secondary).setEmoji('❌'),
        );

        return interaction.reply({ embeds: [embed], components: [row] });
    }

    if (interaction.deferred || interaction.replied) {
        // Already deferred
    } else {
        await interaction.deferReply();
    }

    // Generate transcript
    const messages = db.getTicketMessages(ticket.id);
    const category = db.getCategory(ticket.category_id);

    let transcriptPath = null;
    try {
        transcriptPath = saveTranscriptFile(ticket, messages, guild, category);
    } catch (err) {
        console.error('[TRANSCRIPT ERROR]', err);
    }

    // Close ticket in DB
    db.closeTicket(ticket.id, user.id, reason);

    // Send transcript to configured channel
    const transcriptChannelId = category?.transcript_channel_id || db.getTicketSetting(guildId, 'archive_channel_id');
    if (transcriptChannelId && transcriptPath) {
        try {
            const transcriptChannel = await client.channels.fetch(transcriptChannelId).catch(() => null);
            if (transcriptChannel) {
                const tEmbed = new EmbedBuilder()
                    .setTitle(`📄 Transcript - Ticket #${ticket.ticket_number}`)
                    .setColor('#5865F2')
                    .addFields(
                        { name: 'Açan', value: `<@${ticket.user_id}>`, inline: true },
                        { name: 'Kapatan', value: `<@${user.id}>`, inline: true },
                        { name: 'Kategori', value: category?.name || 'Bilinmiyor', inline: true },
                        { name: 'Mesaj Sayısı', value: String(messages.length), inline: true },
                    )
                    .setTimestamp();

                if (reason) tEmbed.addFields({ name: 'Kapatma Nedeni', value: reason });

                await transcriptChannel.send({
                    embeds: [tEmbed],
                    files: [{ attachment: transcriptPath, name: `transcript-${ticket.ticket_number}.html` }],
                });
            }
        } catch (err) {
            console.error('[TRANSCRIPT SEND ERROR]', err);
        }
    }

    // DM transcript to user
    const transcriptDm = db.getTicketSetting(guildId, 'transcript_dm');
    if (transcriptDm === '1' && transcriptPath) {
        try {
            const ticketUser = await client.users.fetch(ticket.user_id).catch(() => null);
            if (ticketUser) {
                const dmEmbed = new EmbedBuilder()
                    .setTitle(`📄 Ticket #${ticket.ticket_number} Kapatıldı`)
                    .setDescription(`**${guild.name}** sunucusundaki ticketınız kapatıldı.`)
                    .setColor('#ED4245')
                    .setTimestamp();
                if (reason) dmEmbed.addFields({ name: 'Neden', value: reason });

                await ticketUser.send({
                    embeds: [dmEmbed],
                    files: [{ attachment: transcriptPath, name: `transcript-${ticket.ticket_number}.html` }],
                }).catch(() => {});
            }
        } catch (err) {
            console.error('[DM TRANSCRIPT ERROR]', err);
        }
    }

    // Close message
    const closeMsg = category?.close_message || 'Bu ticket kapatıldı.';
    const closeEmbed = new EmbedBuilder()
        .setTitle('🔒 Ticket Kapatıldı')
        .setDescription(processVariables(closeMsg, { user: `<@${user.id}>`, reason: reason || 'Belirtilmedi' }))
        .setColor('#ED4245')
        .setTimestamp();

    const reopenRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_reopen_${channelId}`).setLabel('Yeniden Aç').setStyle(ButtonStyle.Success).setEmoji('🔓'),
        new ButtonBuilder().setCustomId(`ticket_delete_${channelId}`).setLabel('Sil').setStyle(ButtonStyle.Danger).setEmoji('🗑️'),
    );

    if (transcriptPath) {
        await interaction.editReply({
            embeds: [closeEmbed],
            components: [reopenRow],
            files: [{ attachment: transcriptPath, name: `transcript-${ticket.ticket_number}.html` }],
        });
    } else {
        await interaction.editReply({ embeds: [closeEmbed], components: [reopenRow] });
    }

    // Remove send permission from ticket owner
    const channel = guild.channels.cache.get(channelId);
    if (channel) {
        await channel.permissionOverwrites.edit(ticket.user_id, {
            SendMessages: false,
        }).catch(() => {});
    }

    // Send log
    sendLog(client, guildId, LOG_TYPES.TICKET_CLOSE, {
        user: ticket.user_id,
        staff: user.id,
        ticket: ticket.ticket_number,
        channel: channelId,
        category: category?.name,
        categoryId: ticket.category_id,
        reason,
    });

    db.addAuditLog(guildId, user.id, 'ticket_close', { ticket_number: ticket.ticket_number, reason });
}

/**
 * Reopen a closed ticket
 */
async function reopenTicketAction(interaction, channelId) {
    const ticket = db.getTicketByChannel(channelId);
    if (!ticket || ticket.status !== 'closed') {
        return interaction.reply({ content: '❌ Bu ticket yeniden açılamaz.', flags: 64 });
    }

    const { guild, user, client } = interaction;
    const guildId = guild.id;

    const staffMember = isStaff(interaction.member, guildId, ticket.category_id);
    const isOwner = ticket.user_id === user.id;
    if (!isOwner && !staffMember) {
        return interaction.reply({ content: '❌ Bu ticketı yeniden açma yetkiniz yok.', flags: 64 });
    }

    // Check reopen timeout
    const reopenTimeout = parseInt(db.getTicketSetting(guildId, 'reopen_timeout_hours')) || 48;
    if (ticket.closed_at && reopenTimeout > 0) {
        const closedAt = new Date(ticket.closed_at);
        const now = new Date();
        const hoursSinceClosed = (now - closedAt) / (1000 * 60 * 60);
        if (hoursSinceClosed > reopenTimeout) {
            return interaction.reply({ content: `❌ Bu ticket kapatıldıktan ${reopenTimeout} saat sonra yeniden açılamaz.`, flags: 64 });
        }
    }

    await interaction.deferReply();

    db.reopenTicket(ticket.id);

    // Restore permissions
    const channel = guild.channels.cache.get(channelId);
    if (channel) {
        await channel.permissionOverwrites.edit(ticket.user_id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
        }).catch(() => {});
    }

    const embed = new EmbedBuilder()
        .setTitle('🔓 Ticket Yeniden Açıldı')
        .setDescription(`Bu ticket <@${user.id}> tarafından yeniden açıldı.`)
        .setColor('#57F287')
        .setTimestamp();

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ticket_close_${channelId}`).setLabel('Kapat').setEmoji('🔒').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ticket_claim_${channelId}`).setLabel('Sahiplen').setEmoji('✋').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ticket_transcript_${channelId}`).setLabel('Transcript').setEmoji('📄').setStyle(ButtonStyle.Secondary),
    );

    await interaction.editReply({ embeds: [embed], components: [actionRow] });

    sendLog(client, guildId, LOG_TYPES.TICKET_REOPEN, {
        user: ticket.user_id,
        staff: user.id,
        ticket: ticket.ticket_number,
        channel: channelId,
        categoryId: ticket.category_id,
    });

    db.addAuditLog(guildId, user.id, 'ticket_reopen', { ticket_number: ticket.ticket_number });
}

/**
 * Delete a ticket channel
 */
async function deleteTicketAction(interaction, channelId) {
    const ticket = db.getTicketByChannel(channelId);
    if (!ticket) {
        return interaction.reply({ content: '❌ Bu kanal bir ticket değil.', flags: 64 });
    }

    const { guild, user, client } = interaction;
    const guildId = guild.id;

    if (!isStaff(interaction.member, guildId, ticket.category_id)) {
        return interaction.reply({ content: '❌ Bu ticketı silme yetkiniz yok.', flags: 64 });
    }

    await interaction.reply({ content: '🗑️ Ticket 5 saniye içinde silinecek...', flags: 64 });

    db.deleteTicketRecord(ticket.id);

    sendLog(client, guildId, LOG_TYPES.TICKET_DELETE, {
        user: ticket.user_id,
        staff: user.id,
        ticket: ticket.ticket_number,
        categoryId: ticket.category_id,
    });

    db.addAuditLog(guildId, user.id, 'ticket_delete', { ticket_number: ticket.ticket_number });

    setTimeout(async () => {
        const channel = guild.channels.cache.get(channelId);
        if (channel) await channel.delete().catch(() => {});
    }, 5000);
}

/**
 * Claim a ticket
 */
async function claimTicketAction(interaction, channelId) {
    const ticket = db.getTicketByChannel(channelId);
    if (!ticket || ticket.status !== 'open') {
        return interaction.reply({ content: '❌ Bu bir aktif ticket değil.', flags: 64 });
    }

    const { guild, user, client } = interaction;
    const guildId = guild.id;

    if (!isStaff(interaction.member, guildId, ticket.category_id)) {
        return interaction.reply({ content: '❌ Ticket sahiplenme yetkiniz yok.', flags: 64 });
    }

    if (ticket.claimed_by) {
        return interaction.reply({ content: `❌ Bu ticket zaten <@${ticket.claimed_by}> tarafından sahiplenilmiş.`, flags: 64 });
    }

    db.updateTicket(ticket.id, { claimed_by: user.id });

    const category = db.getCategory(ticket.category_id);
    const claimMsg = category?.claim_message
        ? processVariables(category.claim_message, { user: `<@${user.id}>` })
        : `✋ <@${user.id}> bu ticketı sahiplendi.`;

    const embed = new EmbedBuilder()
        .setTitle('✋ Ticket Sahiplenildi')
        .setDescription(claimMsg)
        .setColor('#5865F2')
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    sendLog(client, guildId, LOG_TYPES.TICKET_CLAIM, {
        staff: user.id,
        ticket: ticket.ticket_number,
        channel: channelId,
        categoryId: ticket.category_id,
    });

    db.addAuditLog(guildId, user.id, 'ticket_claim', { ticket_number: ticket.ticket_number });
}

/**
 * Unclaim a ticket
 */
async function unclaimTicketAction(interaction, channelId) {
    const ticket = db.getTicketByChannel(channelId);
    if (!ticket || ticket.status !== 'open') {
        return interaction.reply({ content: '❌ Bu bir aktif ticket değil.', flags: 64 });
    }

    const { user, client, guild } = interaction;
    const guildId = guild.id;

    if (!isStaff(interaction.member, guildId, ticket.category_id)) {
        return interaction.reply({ content: '❌ Bu işlemi yapma yetkiniz yok.', flags: 64 });
    }

    if (!ticket.claimed_by) {
        return interaction.reply({ content: '❌ Bu ticket henüz kimse tarafından sahiplenilmemiş.', flags: 64 });
    }

    if (ticket.claimed_by !== user.id && !interaction.member.permissions.has('Administrator')) {
        return interaction.reply({ content: '❌ Sadece ticketı sahiplenen kişi veya yönetici bu işlemi yapabilir.', flags: 64 });
    }

    db.updateTicket(ticket.id, { claimed_by: null });

    const embed = new EmbedBuilder()
        .setDescription(`👋 <@${user.id}> ticketın sahipliğini bıraktı.`)
        .setColor('#EB459E')
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    sendLog(client, guildId, LOG_TYPES.TICKET_UNCLAIM, {
        staff: user.id,
        ticket: ticket.ticket_number,
        channel: channelId,
        categoryId: ticket.category_id,
    });
}

/**
 * Add a user to a ticket
 */
async function addUserToTicket(interaction, targetUser) {
    const ticket = db.getTicketByChannel(interaction.channelId);
    if (!ticket || ticket.status !== 'open') {
        return interaction.reply({ content: '❌ Bu komut sadece aktif ticket kanallarında kullanılabilir.', flags: 64 });
    }

    const { guild, user } = interaction;
    const guildId = guild.id;

    const isOwner = ticket.user_id === user.id;
    const staffMember = isStaff(interaction.member, guildId, ticket.category_id);
    if (!isOwner && !staffMember) {
        return interaction.reply({ content: '❌ Bu işlemi yapma yetkiniz yok.', flags: 64 });
    }

    const maxAdded = parseInt(db.getTicketSetting(guildId, 'max_added_users')) || 10;
    const currentAdded = ticket.added_users || [];
    if (currentAdded.length >= maxAdded) {
        return interaction.reply({ content: `❌ Bir ticketa en fazla **${maxAdded}** kullanıcı eklenebilir.`, flags: 64 });
    }

    const channel = guild.channels.cache.get(interaction.channelId);
    if (channel) {
        await channel.permissionOverwrites.edit(targetUser.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
        });
    }

    if (!currentAdded.includes(targetUser.id)) {
        currentAdded.push(targetUser.id);
        db.updateTicket(ticket.id, { added_users: currentAdded });
    }

    await interaction.reply({ content: `✅ <@${targetUser.id}> bu ticketa eklendi.` });

    sendLog(interaction.client, guildId, LOG_TYPES.USER_ADD, {
        user: targetUser.id,
        staff: user.id,
        ticket: ticket.ticket_number,
        channel: interaction.channelId,
    });
}

/**
 * Remove a user from a ticket
 */
async function removeUserFromTicket(interaction, targetUser) {
    const ticket = db.getTicketByChannel(interaction.channelId);
    if (!ticket || ticket.status !== 'open') {
        return interaction.reply({ content: '❌ Bu komut sadece aktif ticket kanallarında kullanılabilir.', flags: 64 });
    }

    const { guild, user } = interaction;
    const guildId = guild.id;

    const isOwner = ticket.user_id === user.id;
    const staffMember = isStaff(interaction.member, guildId, ticket.category_id);
    if (!isOwner && !staffMember) {
        return interaction.reply({ content: '❌ Bu işlemi yapma yetkiniz yok.', flags: 64 });
    }

    if (targetUser.id === ticket.user_id) {
        return interaction.reply({ content: '❌ Ticket sahibi kanaldan çıkarılamaz.', flags: 64 });
    }

    const channel = guild.channels.cache.get(interaction.channelId);
    if (channel) {
        await channel.permissionOverwrites.delete(targetUser.id).catch(() => {});
    }

    const currentAdded = (ticket.added_users || []).filter(id => id !== targetUser.id);
    db.updateTicket(ticket.id, { added_users: currentAdded });

    await interaction.reply({ content: `✅ <@${targetUser.id}> bu tickettan çıkarıldı.` });

    sendLog(interaction.client, guildId, LOG_TYPES.USER_REMOVE, {
        user: targetUser.id,
        staff: user.id,
        ticket: ticket.ticket_number,
        channel: interaction.channelId,
    });
}

/**
 * Generate and send transcript
 */
async function generateTranscriptAction(interaction, channelId) {
    const ticket = db.getTicketByChannel(channelId);
    if (!ticket) {
        return interaction.reply({ content: '❌ Bu kanal bir ticket değil.', flags: 64 });
    }

    await interaction.deferReply({ flags: 64 });

    const messages = db.getTicketMessages(ticket.id);
    const category = db.getCategory(ticket.category_id);
    const guild = interaction.guild;

    try {
        const filePath = saveTranscriptFile(ticket, messages, guild, category);

        await interaction.editReply({
            content: `📄 Ticket #${ticket.ticket_number} transcript'i oluşturuldu (${messages.length} mesaj).`,
            files: [{ attachment: filePath, name: `transcript-${ticket.ticket_number}.html` }],
        });

        sendLog(interaction.client, guild.id, LOG_TYPES.TRANSCRIPT_CREATE, {
            staff: interaction.user.id,
            ticket: ticket.ticket_number,
            channel: channelId,
        });
    } catch (err) {
        console.error('[TRANSCRIPT GEN ERROR]', err);
        await interaction.editReply({ content: '❌ Transcript oluşturulurken bir hata oluştu.' });
    }
}

module.exports = {
    openTicket,
    showTicketModal,
    closeTicketAction,
    reopenTicketAction,
    deleteTicketAction,
    claimTicketAction,
    unclaimTicketAction,
    addUserToTicket,
    removeUserFromTicket,
    generateTranscriptAction,
};
