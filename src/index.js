require('dotenv').config();
const {
    Client, GatewayIntentBits, Partials, ActivityType, Events,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
    StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
    ChannelType
} = require('discord.js');

const db = require('./database/service');
const ticketService = require('./services/ticketService');
const panelService = require('./services/panelService');
const adminService = require('./services/adminService');
const backupService = require('./services/backupService');
const { sendLog, LOG_TYPES } = require('./utils/logger');
const { isAdmin, isStaff, PERMISSION_KEYS } = require('./utils/permissions');
const { createWebServer } = require('./web/server');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.User,
        Partials.GuildMember,
    ],
});

// ─── Ready Event ───
client.once(Events.ClientReady, () => {
    console.log(`🤖 Bot giriş yaptı: ${client.user.tag}`);
    client.user.setActivity('🎫 Destek Talepleri | /ticket-admin', { type: ActivityType.Watching });

    // Initial check for default categories & start automation timer
    initDefaults();
    startAutomationLoop();

    // Start Web Dashboard
    const PORT = process.env.PORT || 3000;
    try {
        const app = createWebServer(client, db);
        app.listen(PORT, () => {
            console.log(`🌐 Web Dashboard aktif: http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error('❌ Web Dashboard başlatılırken hata:', err);
    }
});

function initDefaults() {
    for (const guild of client.guilds.cache.values()) {
        const categories = db.getCategories(guild.id);
        if (categories.length === 0) {
            db.createCategory(guild.id, {
                name: 'Genel Destek',
                emoji: '🎫',
                button_label: 'Destek Talebi Aç',
                description: 'Genel sorularınız ve sorunlarınız için destek talebi.',
                channel_name_format: 'ticket-{number}',
                color: '#5865F2',
                is_active: 1,
            });
        }
    }
}

// ─── Automation Interval (Auto-close, Auto-archive, Auto-delete, Cooldowns) ───
function startAutomationLoop() {
    setInterval(async () => {
        try {
            db.clearExpiredCooldowns();

            for (const guild of client.guilds.cache.values()) {
                const settings = db.getAllTicketSettings(guild.id);
                const autoCloseHours = parseInt(settings.auto_close_hours) || 0;
                const autoDeleteHours = parseInt(settings.auto_delete_hours) || 0;

                const openTickets = db.getAllOpenTickets(guild.id);
                const now = Date.now();

                // Check auto-close for open tickets
                if (autoCloseHours > 0) {
                    for (const t of openTickets) {
                        const lastActivity = new Date(t.last_message_at || t.opened_at).getTime();
                        if (now - lastActivity > autoCloseHours * 60 * 60 * 1000) {
                            const channel = guild.channels.cache.get(t.channel_id);
                            if (channel) {
                                db.closeTicket(t.id, client.user.id, `Otomatik kapatma (${autoCloseHours} saat inaktiflik)`);
                                channel.send({
                                    embeds: [
                                        new EmbedBuilder()
                                            .setTitle('🔒 Ticket Otomatik Kapatıldı')
                                            .setDescription(`Bu ticket ${autoCloseHours} saat boyunca inaktif kaldığı için otomatik olarak kapatılmıştır.`)
                                            .setColor('#ED4245')
                                    ]
                                }).catch(() => {});
                            }
                        }
                    }
                }
            }
        } catch (err) {
            console.error('[AUTOMATION LOOP ERROR]', err);
        }
    }, 60000); // 1 minute
}

// ─── Message Handler (Transcript logging) ───
client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;

    const ticket = db.getTicketByChannel(message.channel.id);
    if (!ticket) return;

    try {
        db.saveMessage({
            ticket_id: ticket.id,
            guild_id: message.guild.id,
            message_id: message.id,
            user_id: message.author.id,
            username: message.author.tag || message.author.username,
            avatar_url: message.author.displayAvatarURL(),
            content: message.content,
            attachments: message.attachments.map(a => ({
                name: a.name,
                url: a.url,
                size: a.size,
                contentType: a.contentType || 'unknown',
            })),
            embeds: message.embeds.map(e => e.toJSON()),
            created_at: new Date().toISOString(),
        });

        db.updateTicket(ticket.id, { last_message_at: new Date().toISOString() });
    } catch (err) {
        console.error('[SAVE MESSAGE ERROR]', err);
    }
});

// ─── Interaction Router ───
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            await handleCommand(interaction);
        } else if (interaction.isButton()) {
            await handleButton(interaction);
        } else if (interaction.isAnySelectMenu()) {
            await handleSelect(interaction);
        } else if (interaction.isModalSubmit()) {
            await handleModal(interaction);
        }
    } catch (err) {
        console.error('[INTERACTION ERROR]', err);
        const reply = { content: '❌ İşlem gerçekleştirilirken bir hata oluştu.', flags: 64 };
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(reply).catch(() => {});
        } else {
            await interaction.reply(reply).catch(() => {});
        }
    }
});

// ─── Slash Commands ───
async function handleCommand(interaction) {
    const { commandName, guild, member, channelId } = interaction;
    if (!guild) return interaction.reply({ content: '❌ Bu komut yalnızca sunucularda kullanılabilir.', flags: 64 });

    switch (commandName) {
        case 'ticket-admin': {
            if (!isAdmin(member, guild.id)) {
                return interaction.reply({ content: '❌ Bu komutu kullanmak için yönetici yetkiniz bulunmuyor.', flags: 64 });
            }
            return interaction.reply({
                embeds: [adminService.mainMenuEmbed()],
                components: adminService.mainMenuComponents(),
                flags: 64,
            });
        }

        case 'ticket-add': {
            const user = interaction.options.getUser('kullanici');
            return ticketService.addUserToTicket(interaction, user);
        }

        case 'ticket-remove': {
            const user = interaction.options.getUser('kullanici');
            return ticketService.removeUserFromTicket(interaction, user);
        }

        case 'ticket-close': {
            const reason = interaction.options.getString('neden') || '';
            return ticketService.closeTicketAction(interaction, channelId, reason);
        }

        case 'ticket-priority': {
            const ticket = db.getTicketByChannel(channelId);
            if (!ticket || ticket.status !== 'open') {
                return interaction.reply({ content: '❌ Bu komut yalnızca aktif bir ticket kanalında kullanılabilir.', flags: 64 });
            }
            if (!isStaff(member, guild.id, ticket.category_id)) {
                return interaction.reply({ content: '❌ Öncelik değiştirme yetkiniz yok.', flags: 64 });
            }
            const priority = interaction.options.getString('oncelik');
            db.updateTicket(ticket.id, { priority });
            sendLog(client, guild.id, LOG_TYPES.PRIORITY_CHANGE, {
                staff: member.id,
                ticket: ticket.ticket_number,
                channel: channelId,
                priority,
            });
            return interaction.reply({ content: `✅ Ticket önceliği **${priority.toUpperCase()}** olarak güncellendi.` });
        }

        case 'ticket-topic': {
            const ticket = db.getTicketByChannel(channelId);
            if (!ticket || ticket.status !== 'open') {
                return interaction.reply({ content: '❌ Bu komut yalnızca aktif bir ticket kanalında kullanılabilir.', flags: 64 });
            }
            const topic = interaction.options.getString('konu');
            await interaction.channel.setTopic(`Ticket #${ticket.ticket_number} | Konu: ${topic}`).catch(() => {});
            sendLog(client, guild.id, LOG_TYPES.TOPIC_CHANGE, {
                staff: member.id,
                ticket: ticket.ticket_number,
                channel: channelId,
                topic,
            });
            return interaction.reply({ content: `✅ Ticket konusu güncellendi: **${topic}**` });
        }

        case 'ticket-call': {
            const ticket = db.getTicketByChannel(channelId);
            if (!ticket || ticket.status !== 'open') {
                return interaction.reply({ content: '❌ Bu komut yalnızca aktif bir ticket kanalında kullanılabilir.', flags: 64 });
            }
            const staffRoles = db.getStaffRoles(guild.id);
            const mentions = staffRoles.map(r => `<@&${r}>`).join(' ');
            if (!mentions) {
                return interaction.reply({ content: '❌ Ayarlanmış bir yetkili rolü bulunamadı.', flags: 64 });
            }
            sendLog(client, guild.id, LOG_TYPES.STAFF_CALL, {
                user: member.id,
                ticket: ticket.ticket_number,
                channel: channelId,
            });
            return interaction.reply({ content: `🔔 ${mentions} — <@${member.id}> yetkili desteği talep ediyor!` });
        }

        case 'ticket-rename': {
            const ticket = db.getTicketByChannel(channelId);
            if (!ticket || ticket.status !== 'open') {
                return interaction.reply({ content: '❌ Bu komut yalnızca aktif bir ticket kanalında kullanılabilir.', flags: 64 });
            }
            if (!isStaff(member, guild.id, ticket.category_id)) {
                return interaction.reply({ content: '❌ Kanalı yeniden adlandırma yetkiniz yok.', flags: 64 });
            }
            const newName = interaction.options.getString('isim');
            await interaction.channel.setName(newName).catch(() => {});
            return interaction.reply({ content: `✅ Kanal adı **${newName}** olarak değiştirildi.` });
        }

        case 'ticket-unclaim': {
            return ticketService.unclaimTicketAction(interaction, channelId);
        }
    }
}

// ─── Button Handlers ───
async function handleButton(interaction) {
    const { customId, guildId } = interaction;

    // 1. Panel Ticket Açma Butonları (open_ticket_<categoryId>)
    if (customId.startsWith('open_ticket_')) {
        const categoryId = customId.replace('open_ticket_', '');
        const category = db.getCategory(categoryId);
        if (category && category.use_modal && category.modal_fields && category.modal_fields.length > 0) {
            return ticketService.showTicketModal(interaction, category);
        }
        return ticketService.openTicket(interaction, categoryId);
    }

    // 2. Ticket İçi İşlem Butonları
    if (customId.startsWith('ticket_close_confirm_')) {
        const channelId = customId.replace('ticket_close_confirm_', '');
        return ticketService.closeTicketAction(interaction, channelId);
    }
    if (customId.startsWith('ticket_close_cancel_')) {
        return interaction.update({ content: '❌ Ticket kapatma işlemi iptal edildi.', embeds: [], components: [] });
    }
    if (customId.startsWith('ticket_close_')) {
        const channelId = customId.replace('ticket_close_', '');
        return ticketService.closeTicketAction(interaction, channelId);
    }
    if (customId.startsWith('ticket_claim_')) {
        const channelId = customId.replace('ticket_claim_', '');
        return ticketService.claimTicketAction(interaction, channelId);
    }
    if (customId.startsWith('ticket_transcript_')) {
        const channelId = customId.replace('ticket_transcript_', '');
        return ticketService.generateTranscriptAction(interaction, channelId);
    }
    if (customId.startsWith('ticket_reopen_')) {
        const channelId = customId.replace('ticket_reopen_', '');
        return ticketService.reopenTicketAction(interaction, channelId);
    }
    if (customId.startsWith('ticket_delete_')) {
        const channelId = customId.replace('ticket_delete_', '');
        return ticketService.deleteTicketAction(interaction, channelId);
    }

    // 3. Admin Paneli Gezinme ve Aksiyon Butonları
    if (customId === 'admin_back_main') {
        return interaction.update({
            embeds: [adminService.mainMenuEmbed()],
            components: adminService.mainMenuComponents(),
        });
    }
    if (customId === 'admin_refresh_overview') {
        const view = adminService.buildOverview(guildId);
        return interaction.update(view);
    }
    if (customId === 'admin_back_categories') {
        const view = adminService.buildCategoryList(guildId);
        return interaction.update(view);
    }
    if (customId.startsWith('admin_cat_page_')) {
        const page = parseInt(customId.replace('admin_cat_page_', '')) || 0;
        const view = adminService.buildCategoryList(guildId, page);
        return interaction.update(view);
    }
    if (customId === 'admin_category_create') {
        const modal = new ModalBuilder()
            .setCustomId('modal_admin_cat_create')
            .setTitle('Yeni Ticket Kategorisi');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('cat_name').setLabel('Kategori Adı').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Örn: Destek Talebi')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('cat_emoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Örn: 🎫')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('cat_button_label').setLabel('Buton Metni').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('Örn: Talep Aç')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('cat_format').setLabel('Kanal Formatı').setStyle(TextInputStyle.Short).setRequired(false).setValue('ticket-{number}')
            )
        );
        return interaction.showModal(modal);
    }
    if (customId.startsWith('admin_cat_duplicate_')) {
        const catId = customId.replace('admin_cat_duplicate_', '');
        db.duplicateCategory(catId);
        const view = adminService.buildCategoryList(guildId);
        return interaction.update(view);
    }
    if (customId.startsWith('admin_cat_delete_')) {
        const catId = customId.replace('admin_cat_delete_', '');
        db.deleteCategory(catId);
        const view = adminService.buildCategoryList(guildId);
        return interaction.update(view);
    }

    if (customId === 'admin_back_panels') {
        const view = adminService.buildPanelList(guildId);
        return interaction.update(view);
    }
    if (customId === 'admin_panel_create') {
        const modal = new ModalBuilder()
            .setCustomId('modal_admin_panel_create')
            .setTitle('Yeni Ticket Paneli');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('panel_name').setLabel('Panel Adı').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Örn: Ana Destek Paneli')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('panel_title').setLabel('Embed Başlığı').setStyle(TextInputStyle.Short).setRequired(false).setValue('🎫 Destek Sistemi')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('panel_desc').setLabel('Embed Açıklaması').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue('Aşağıdaki butonlara tıklayarak yeni bir destek talebi oluşturabilirsiniz.')
            )
        );
        return interaction.showModal(modal);
    }
    if (customId.startsWith('admin_panel_deploy_')) {
        const panelId = customId.replace('admin_panel_deploy_', '');
        const panel = db.getPanel(panelId);
        if (!panel) return interaction.reply({ content: '❌ Panel bulunamadı.', flags: 64 });
        if (!panel.channel_id) {
            return interaction.reply({ content: '❌ Bu panel için bir gönderim kanalı ayarlanmamış. Lütfen önce paneli düzenleyip kanal seçin.', flags: 64 });
        }
        await interaction.deferReply({ flags: 64 });
        const res = await panelService.deployPanel(client, panel, guildId);
        if (res.success) {
            return interaction.editReply({ content: `✅ Panel başarıyla <#${panel.channel_id}> kanalına gönderildi!` });
        } else {
            return interaction.editReply({ content: `❌ Panel gönderilirken hata: ${res.error}` });
        }
    }
    if (customId.startsWith('admin_panel_duplicate_')) {
        const panelId = customId.replace('admin_panel_duplicate_', '');
        db.duplicatePanel(panelId);
        const view = adminService.buildPanelList(guildId);
        return interaction.update(view);
    }
    if (customId.startsWith('admin_panel_delete_')) {
        const panelId = customId.replace('admin_panel_delete_', '');
        db.deletePanel(panelId);
        const view = adminService.buildPanelList(guildId);
        return interaction.update(view);
    }
    if (customId.startsWith('admin_panel_preview_')) {
        const panelId = customId.replace('admin_panel_preview_', '');
        const panel = db.getPanel(panelId);
        const categories = db.getCategories(guildId);
        const preview = panelService.buildPanelMessage(panel, categories);
        return interaction.reply({ ...preview, flags: 64 });
    }

    if (customId === 'admin_backup_create') {
        const res = backupService.createBackup(guildId);
        const view = adminService.buildBackupManager(guildId);
        return interaction.update(view);
    }
    if (customId === 'admin_refresh_stats') {
        const view = adminService.buildStatistics(guildId);
        return interaction.update(view);
    }
    if (customId.startsWith('admin_behavior_page_')) {
        const page = parseInt(customId.replace('admin_behavior_page_', '')) || 0;
        const view = adminService.buildBehaviorSettings(guildId, page);
        return interaction.update(view);
    }
    if (customId === 'admin_role_add_staff' || customId === 'admin_role_add_admin') {
        const type = customId === 'admin_role_add_staff' ? 'staff' : 'admin';
        const roleMenu = new RoleSelectMenuBuilder()
            .setCustomId(`admin_role_select_add_${type}`)
            .setPlaceholder(`${type === 'staff' ? 'Yetkili' : 'Yönetici'} rolünü seçin...`)
            .setMaxValues(1);
        return interaction.update({
            content: `Lütfen eklenecek rolü seçin:`,
            components: [new ActionRowBuilder().addComponents(roleMenu)]
        });
    }
    if (customId === 'admin_blacklist_add') {
        const modal = new ModalBuilder()
            .setCustomId('modal_admin_blacklist_add')
            .setTitle('Kara Listeye Ekle');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('target_id').setLabel('Kullanıcı veya Rol ID').setStyle(TextInputStyle.Short).setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('target_type').setLabel('Tür (user / role)').setStyle(TextInputStyle.Short).setRequired(true).setValue('user')
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('reason').setLabel('Neden').setStyle(TextInputStyle.Paragraph).setRequired(false)
            )
        );
        return interaction.showModal(modal);
    }
    if (customId === 'admin_blacklist_remove') {
        const modal = new ModalBuilder()
            .setCustomId('modal_admin_blacklist_remove')
            .setTitle('Kara Listeden Çıkar');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('target_id').setLabel('Kullanıcı veya Rol ID').setStyle(TextInputStyle.Short).setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }
    if (customId === 'admin_log_clear_all') {
        const logTypes = ['ticket_open', 'ticket_close', 'ticket_delete', 'ticket_reopen', 'ticket_claim', 'ticket_unclaim', 'user_add', 'user_remove', 'category_change', 'priority_change', 'transcript_create', 'admin_change'];
        for (const lt of logTypes) db.setLogChannel(guildId, lt, '');
        const view = adminService.buildLogManager(guildId);
        return interaction.update(view);
    }
    if (customId === 'admin_message_reset') {
        const keys = ['welcome_title', 'welcome_message', 'close_message', 'reopen_message', 'claim_message', 'staff_call_message', 'blacklist_message', 'cooldown_message', 'limit_message'];
        for (const k of keys) db.setCustomMessage(guildId, k, '');
        const view = adminService.buildMessageManager(guildId);
        return interaction.update(view);
    }
}

// ─── Select Menu Handlers ───
async function handleSelect(interaction) {
    const { customId, values, guildId } = interaction;
    const selected = values[0];

    // Panel category select menu
    if (customId === 'ticket_category_select') {
        const category = db.getCategory(selected);
        if (category && category.use_modal && category.modal_fields && category.modal_fields.length > 0) {
            return ticketService.showTicketModal(interaction, category);
        }
        return ticketService.openTicket(interaction, selected);
    }

    // Admin main menu navigation
    if (customId === 'admin_menu_select') {
        switch (selected) {
            case 'overview':
                return interaction.update(adminService.buildOverview(guildId));
            case 'panels':
                return interaction.update(adminService.buildPanelList(guildId));
            case 'categories':
                return interaction.update(adminService.buildCategoryList(guildId));
            case 'buttons':
            case 'embeds':
                return interaction.update(adminService.buildEmbedDesigner(guildId));
            case 'roles':
                return interaction.update(adminService.buildRoleManager(guildId));
            case 'logs':
                return interaction.update(adminService.buildLogManager(guildId));
            case 'behavior':
                return interaction.update(adminService.buildBehaviorSettings(guildId, 0));
            case 'transcripts':
                return interaction.update(adminService.buildTranscriptSettings(guildId));
            case 'automation':
                return interaction.update(adminService.buildAutomationSettings(guildId));
            case 'statistics':
                return interaction.update(adminService.buildStatistics(guildId));
            case 'messages':
                return interaction.update(adminService.buildMessageManager(guildId));
            case 'security':
                return interaction.update(adminService.buildSecurityManager(guildId));
            case 'backup':
                return interaction.update(adminService.buildBackupManager(guildId));
            case 'setup': {
                const embed = new EmbedBuilder()
                    .setTitle('🚀 Kurulum Sihirbazı')
                    .setDescription('Botunuz hızlıca hazır hale getirildi!\n\n1. **/ticket-admin** menüsünden **Panel Tasarımcısı**na gidin.\n2. Bir panel seçip **Gönderim Kanalı**nı belirleyin.\n3. **🚀 Gönder** butonuna basarak paneli Discord kanalına yerleştirin.')
                    .setColor('#57F287');
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary)
                );
                return interaction.update({ embeds: [embed], components: [row] });
            }
        }
    }

    // Category selection in admin
    if (customId === 'admin_category_select') {
        const view = adminService.buildCategoryEditor(selected);
        if (view) return interaction.update(view);
    }

    // Category edit options
    if (customId.startsWith('admin_cat_edit_')) {
        const catId = customId.replace('admin_cat_edit_', '');
        const cat = db.getCategory(catId);
        if (!cat) return;

        if (selected === 'name_desc') {
            const modal = new ModalBuilder()
                .setCustomId(`modal_admin_cat_name_desc_${catId}`)
                .setTitle('Ad ve Açıklama Düzenle');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('name').setLabel('Kategori Adı').setStyle(TextInputStyle.Short).setValue(cat.name).setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('desc').setLabel('Açıklama').setStyle(TextInputStyle.Paragraph).setValue(cat.description || '').setRequired(false)
                )
            );
            return interaction.showModal(modal);
        }
        if (selected === 'emoji_button') {
            const modal = new ModalBuilder()
                .setCustomId(`modal_admin_cat_emoji_button_${catId}`)
                .setTitle('Emoji ve Buton Metni');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('emoji').setLabel('Emoji').setStyle(TextInputStyle.Short).setValue(cat.emoji || '').setRequired(false)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('button_label').setLabel('Buton Etiketi').setStyle(TextInputStyle.Short).setValue(cat.button_label || '').setRequired(true)
                )
            );
            return interaction.showModal(modal);
        }
        if (selected === 'channel_cat') {
            const modal = new ModalBuilder()
                .setCustomId(`modal_admin_cat_channel_${catId}`)
                .setTitle('Kanal ve Format');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('format').setLabel('Kanal Ad Formatı').setStyle(TextInputStyle.Short).setValue(cat.channel_name_format || 'ticket-{number}').setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('cat_id').setLabel('Discord Kategori ID').setStyle(TextInputStyle.Short).setValue(cat.discord_category_id || '').setRequired(false)
                )
            );
            return interaction.showModal(modal);
        }
        if (selected === 'limits') {
            const modal = new ModalBuilder()
                .setCustomId(`modal_admin_cat_limits_${catId}`)
                .setTitle('Limitler ve Cooldown');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('max_tickets').setLabel('Maksimum Ticket (Kullanıcı Başı)').setStyle(TextInputStyle.Short).setValue(String(cat.max_tickets_per_user || 1)).setRequired(true)
                ),
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('cooldown').setLabel('Cooldown (Saniye)').setStyle(TextInputStyle.Short).setValue(String(cat.cooldown_seconds || 0)).setRequired(true)
                )
            );
            return interaction.showModal(modal);
        }
        if (selected === 'color') {
            const modal = new ModalBuilder()
                .setCustomId(`modal_admin_cat_color_${catId}`)
                .setTitle('Renk Düzenle (HEX)');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('color').setLabel('HEX Renk Kodu').setStyle(TextInputStyle.Short).setValue(cat.color || '#5865F2').setRequired(true)
                )
            );
            return interaction.showModal(modal);
        }
        if (selected === 'toggle') {
            db.updateCategory(catId, { is_active: cat.is_active ? 0 : 1 });
            return interaction.update(adminService.buildCategoryEditor(catId));
        }
    }

    // Panel selection in admin
    if (customId === 'admin_panel_select') {
        const view = adminService.buildPanelEditor(selected, guildId);
        if (view) return interaction.update(view);
    }

    // Panel edit options
    if (customId.startsWith('admin_panel_edit_')) {
        const panelId = customId.replace('admin_panel_edit_', '');
        const panel = db.getPanel(panelId);
        if (!panel) return;

        if (selected === 'name') {
            const modal = new ModalBuilder()
                .setCustomId(`modal_admin_panel_name_${panelId}`)
                .setTitle('Panel Adını Düzenle');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('name').setLabel('Panel Adı').setStyle(TextInputStyle.Short).setValue(panel.name).setRequired(true)
                )
            );
            return interaction.showModal(modal);
        }
        if (selected === 'channel') {
            const channelSelect = new ChannelSelectMenuBuilder()
                .setCustomId(`admin_panel_set_channel_${panelId}`)
                .setPlaceholder('Paneli göndermek istediğiniz kanalı seçin...')
                .setChannelTypes(ChannelType.GuildText)
                .setMaxValues(1);
            return interaction.update({
                content: 'Lütfen kanal seçin:',
                components: [new ActionRowBuilder().addComponents(channelSelect)]
            });
        }
        if (selected === 'toggle') {
            db.updatePanel(panelId, { is_active: panel.is_active ? 0 : 1 });
            return interaction.update(adminService.buildPanelEditor(panelId, guildId));
        }
    }

    // Panel channel select callback
    if (customId.startsWith('admin_panel_set_channel_')) {
        const panelId = customId.replace('admin_panel_set_channel_', '');
        db.updatePanel(panelId, { channel_id: selected });
        return interaction.update(adminService.buildPanelEditor(panelId, guildId));
    }

    // Role removal in role manager
    if (customId === 'admin_role_remove') {
        if (selected.startsWith('staff_')) {
            db.removeStaffRole(guildId, selected.replace('staff_', ''));
        } else if (selected.startsWith('admin_')) {
            db.removeAdminRole(guildId, selected.replace('admin_', ''));
        }
        return interaction.update(adminService.buildRoleManager(guildId));
    }

    // Role select add callback
    if (customId.startsWith('admin_role_select_add_')) {
        const type = customId.replace('admin_role_select_add_', '');
        if (type === 'staff') db.addStaffRole(guildId, selected);
        else db.addAdminRole(guildId, selected);
        return interaction.update(adminService.buildRoleManager(guildId));
    }

    // Log channel selection prompt
    if (customId === 'admin_log_select') {
        const logType = selected;
        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId(`admin_log_set_channel_${logType}`)
            .setPlaceholder('Bu log için kanal seçin...')
            .setChannelTypes(ChannelType.GuildText)
            .setMaxValues(1);
        return interaction.update({
            content: `**${logType}** logu için kanal seçin:`,
            components: [new ActionRowBuilder().addComponents(channelSelect)]
        });
    }

    // Log channel assignment callback
    if (customId.startsWith('admin_log_set_channel_')) {
        const logType = customId.replace('admin_log_set_channel_', '');
        db.setLogChannel(guildId, logType, selected);
        return interaction.update(adminService.buildLogManager(guildId));
    }

    // Behavior setting toggle/edit
    if (customId === 'admin_behavior_select') {
        const currentVal = db.getTicketSetting(guildId, selected);
        if (currentVal === '0' || currentVal === '1') {
            db.setTicketSetting(guildId, selected, currentVal === '1' ? '0' : '1');
            return interaction.update(adminService.buildBehaviorSettings(guildId, 0));
        } else {
            const modal = new ModalBuilder()
                .setCustomId(`modal_admin_behavior_${selected}`)
                .setTitle('Ayar Değerini Girin');
            modal.addComponents(
                new ActionRowBuilder().addComponents(
                    new TextInputBuilder().setCustomId('val').setLabel('Yeni Değer').setStyle(TextInputStyle.Short).setValue(currentVal || '').setRequired(true)
                )
            );
            return interaction.showModal(modal);
        }
    }

    // Automation setting edit
    if (customId === 'admin_auto_select') {
        const currentVal = db.getTicketSetting(guildId, selected);
        const modal = new ModalBuilder()
            .setCustomId(`modal_admin_auto_${selected}`)
            .setTitle('Süreyi Belirleyin (Saat)');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('val').setLabel('Saat (0 = Devre dışı)').setStyle(TextInputStyle.Short).setValue(currentVal || '0').setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    // Message setting edit
    if (customId === 'admin_message_select') {
        const currentVal = db.getCustomMessage(guildId, selected) || '';
        const modal = new ModalBuilder()
            .setCustomId(`modal_admin_msg_${selected}`)
            .setTitle('Mesajı Düzenle');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('val').setLabel('Mesaj İçeriği').setStyle(TextInputStyle.Paragraph).setValue(currentVal).setRequired(true)
            )
        );
        return interaction.showModal(modal);
    }

    // Backup restore
    if (customId === 'admin_backup_select') {
        const res = backupService.restoreBackup(guildId, selected);
        if (res.success) {
            return interaction.update({ content: `✅ Yedek başarıyla geri yüklendi: **${selected}**`, components: [] });
        } else {
            return interaction.reply({ content: `❌ Yedek yüklenemedi: ${res.error}`, flags: 64 });
        }
    }
}

// ─── Modal Submit Handlers ───
async function handleModal(interaction) {
    const { customId, guildId } = interaction;

    // User ticket creation modal
    if (customId.startsWith('ticket_modal_')) {
        const categoryId = customId.replace('ticket_modal_', '');
        const responses = {};
        for (const [key, value] of interaction.fields.fields) {
            responses[key] = value.value;
        }
        return ticketService.openTicket(interaction, categoryId, responses);
    }

    // Ticket close reason modal
    if (customId.startsWith('ticket_close_reason_')) {
        const channelId = customId.replace('ticket_close_reason_', '');
        const reason = interaction.fields.getTextInputValue('close_reason');
        return ticketService.closeTicketAction(interaction, channelId, reason);
    }

    // Admin create category modal
    if (customId === 'modal_admin_cat_create') {
        const name = interaction.fields.getTextInputValue('cat_name');
        const emoji = interaction.fields.getTextInputValue('cat_emoji') || '🎫';
        const button_label = interaction.fields.getTextInputValue('cat_button_label') || name;
        const format = interaction.fields.getTextInputValue('cat_format') || 'ticket-{number}';

        db.createCategory(guildId, {
            name,
            emoji,
            button_label,
            channel_name_format: format,
            is_active: 1,
        });

        return interaction.update(adminService.buildCategoryList(guildId));
    }

    // Admin category name/desc modal
    if (customId.startsWith('modal_admin_cat_name_desc_')) {
        const catId = customId.replace('modal_admin_cat_name_desc_', '');
        const name = interaction.fields.getTextInputValue('name');
        const desc = interaction.fields.getTextInputValue('desc');
        db.updateCategory(catId, { name, description: desc });
        return interaction.update(adminService.buildCategoryEditor(catId));
    }

    // Admin category emoji/button modal
    if (customId.startsWith('modal_admin_cat_emoji_button_')) {
        const catId = customId.replace('modal_admin_cat_emoji_button_', '');
        const emoji = interaction.fields.getTextInputValue('emoji');
        const button_label = interaction.fields.getTextInputValue('button_label');
        db.updateCategory(catId, { emoji, button_label });
        return interaction.update(adminService.buildCategoryEditor(catId));
    }

    // Admin category channel/format modal
    if (customId.startsWith('modal_admin_cat_channel_')) {
        const catId = customId.replace('modal_admin_cat_channel_', '');
        const format = interaction.fields.getTextInputValue('format');
        const discord_category_id = interaction.fields.getTextInputValue('cat_id');
        db.updateCategory(catId, {
            channel_name_format: format,
            discord_category_id: discord_category_id || null,
        });
        return interaction.update(adminService.buildCategoryEditor(catId));
    }

    // Admin category limits modal
    if (customId.startsWith('modal_admin_cat_limits_')) {
        const catId = customId.replace('modal_admin_cat_limits_', '');
        const max_tickets_per_user = parseInt(interaction.fields.getTextInputValue('max_tickets')) || 1;
        const cooldown_seconds = parseInt(interaction.fields.getTextInputValue('cooldown')) || 0;
        db.updateCategory(catId, { max_tickets_per_user, cooldown_seconds });
        return interaction.update(adminService.buildCategoryEditor(catId));
    }

    // Admin category color modal
    if (customId.startsWith('modal_admin_cat_color_')) {
        const catId = customId.replace('modal_admin_cat_color_', '');
        const color = interaction.fields.getTextInputValue('color');
        db.updateCategory(catId, { color });
        return interaction.update(adminService.buildCategoryEditor(catId));
    }

    // Admin create panel modal
    if (customId === 'modal_admin_panel_create') {
        const name = interaction.fields.getTextInputValue('panel_name');
        const title = interaction.fields.getTextInputValue('panel_title');
        const description = interaction.fields.getTextInputValue('panel_desc');

        const panelId = db.createPanel(guildId, {
            name,
            embed_config: { title, description, color: '#5865F2' },
            is_active: 1,
        });

        return interaction.update(adminService.buildPanelEditor(panelId, guildId));
    }

    // Admin panel name modal
    if (customId.startsWith('modal_admin_panel_name_')) {
        const panelId = customId.replace('modal_admin_panel_name_', '');
        const name = interaction.fields.getTextInputValue('name');
        db.updatePanel(panelId, { name });
        return interaction.update(adminService.buildPanelEditor(panelId, guildId));
    }

    // Admin behavior setting modal
    if (customId.startsWith('modal_admin_behavior_')) {
        const key = customId.replace('modal_admin_behavior_', '');
        const val = interaction.fields.getTextInputValue('val');
        db.setTicketSetting(guildId, key, val);
        return interaction.update(adminService.buildBehaviorSettings(guildId, 0));
    }

    // Admin automation setting modal
    if (customId.startsWith('modal_admin_auto_')) {
        const key = customId.replace('modal_admin_auto_', '');
        const val = interaction.fields.getTextInputValue('val');
        db.setTicketSetting(guildId, key, val);
        return interaction.update(adminService.buildAutomationSettings(guildId));
    }

    // Admin custom message modal
    if (customId.startsWith('modal_admin_msg_')) {
        const key = customId.replace('modal_admin_msg_', '');
        const val = interaction.fields.getTextInputValue('val');
        db.setCustomMessage(guildId, key, val);
        return interaction.update(adminService.buildMessageManager(guildId));
    }

    // Admin blacklist add modal
    if (customId === 'modal_admin_blacklist_add') {
        const targetId = interaction.fields.getTextInputValue('target_id');
        const targetType = interaction.fields.getTextInputValue('target_type') || 'user';
        const reason = interaction.fields.getTextInputValue('reason') || '';
        db.addBlacklist(guildId, targetType, targetId, reason, interaction.user.id);
        return interaction.update(adminService.buildSecurityManager(guildId));
    }

    // Admin blacklist remove modal
    if (customId === 'modal_admin_blacklist_remove') {
        const targetId = interaction.fields.getTextInputValue('target_id');
        db.removeBlacklist(guildId, targetId);
        return interaction.update(adminService.buildSecurityManager(guildId));
    }
}

// ─── Login ───
client.login(process.env.DISCORD_TOKEN).catch((err) => {
    console.error('❌ Discord botuna bağlanırken hata:', err);
});
