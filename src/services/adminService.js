const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
    StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelSelectMenuBuilder, RoleSelectMenuBuilder, ChannelType
} = require('discord.js');
const db = require('../database/service');
const { buildEmbed, defaultPanelEmbed } = require('../utils/embedBuilder');
const { deployPanel, updateAllDeployments, buildPanelMessage } = require('./panelService');
const { isAdmin } = require('../utils/permissions');
const { sendLog, LOG_TYPES } = require('../utils/logger');

// ─── Session store for pending edits ───
const adminSessions = new Map();

function getSession(userId, guildId) {
    const key = `${userId}-${guildId}`;
    if (!adminSessions.has(key)) {
        adminSessions.set(key, { page: 'main', data: {}, history: [] });
    }
    return adminSessions.get(key);
}

function setSession(userId, guildId, data) {
    const key = `${userId}-${guildId}`;
    adminSessions.set(key, data);
}

function clearSession(userId, guildId) {
    adminSessions.delete(`${userId}-${guildId}`);
}

// ─── Main Admin Menu ───
function mainMenuEmbed() {
    return new EmbedBuilder()
        .setTitle('⚙️ Ultra Ticket Bot — Yönetim Paneli')
        .setDescription('Aşağıdaki menüden düzenlemek istediğiniz bölümü seçin.')
        .setColor('#5865F2')
        .addFields(
            { name: '📊 Genel Bakış', value: 'İstatistikler ve durum', inline: true },
            { name: '🎨 Panel Tasarımcısı', value: 'Ticket panellerini yönet', inline: true },
            { name: '📂 Kategori Yönetimi', value: 'Ticket türleri', inline: true },
            { name: '🔘 Buton Tasarımcısı', value: 'Buton ve menü ayarları', inline: true },
            { name: '🖼️ Embed Tasarımcısı', value: 'Embed şablonları', inline: true },
            { name: '👥 Rol Yönetimi', value: 'Yetkili ve rol ayarları', inline: true },
            { name: '📝 Kanal ve Log', value: 'Log kanal ayarları', inline: true },
            { name: '⚡ Davranış Ayarları', value: 'Ticket davranışları', inline: true },
            { name: '📄 Transcript', value: 'Transcript ve arşiv', inline: true },
            { name: '🤖 Otomasyon', value: 'Otomatik işlemler', inline: true },
            { name: '📈 İstatistikler', value: 'Detaylı istatistikler', inline: true },
            { name: '💬 Mesajlar', value: 'Dil ve mesaj yönetimi', inline: true },
            { name: '🔒 Güvenlik', value: 'İzin ve güvenlik', inline: true },
            { name: '💾 Yedekleme', value: 'Veritabanı yedekleme', inline: true },
            { name: '🚀 Kurulum', value: 'Kurulum sihirbazı', inline: true },
        )
        .setFooter({ text: 'Ultra Ticket Bot Yönetim Paneli' })
        .setTimestamp();
}

function mainMenuComponents() {
    const menu = new StringSelectMenuBuilder()
        .setCustomId('admin_menu_select')
        .setPlaceholder('Bölüm seçin...')
        .addOptions([
            { label: 'Genel Bakış', value: 'overview', emoji: '📊' },
            { label: 'Panel Tasarımcısı', value: 'panels', emoji: '🎨' },
            { label: 'Kategori Yönetimi', value: 'categories', emoji: '📂' },
            { label: 'Buton ve Menü Tasarımcısı', value: 'buttons', emoji: '🔘' },
            { label: 'Embed Tasarımcısı', value: 'embeds', emoji: '🖼️' },
            { label: 'Yetkili ve Rol Yönetimi', value: 'roles', emoji: '👥' },
            { label: 'Kanal ve Log Ayarları', value: 'logs', emoji: '📝' },
            { label: 'Davranış Ayarları', value: 'behavior', emoji: '⚡' },
            { label: 'Transcript ve Arşiv', value: 'transcripts', emoji: '📄' },
            { label: 'Otomatik İşlemler', value: 'automation', emoji: '🤖' },
            { label: 'İstatistikler', value: 'statistics', emoji: '📈' },
            { label: 'Dil ve Mesaj Yönetimi', value: 'messages', emoji: '💬' },
            { label: 'İzin ve Güvenlik', value: 'security', emoji: '🔒' },
            { label: 'Yedekleme', value: 'backup', emoji: '💾' },
            { label: 'Kurulum Sihirbazı', value: 'setup', emoji: '🚀' },
        ]);

    return [new ActionRowBuilder().addComponents(menu)];
}

// ─── Overview ───
function buildOverview(guildId) {
    const stats = db.getStats(guildId);
    const settings = db.getAllTicketSettings(guildId);
    const categories = db.getCategories(guildId);
    const panels = db.getPanels(guildId);
    const staffRoles = db.getStaffRoles(guildId);

    const embed = new EmbedBuilder()
        .setTitle('📊 Genel Bakış')
        .setColor('#5865F2')
        .addFields(
            { name: '📈 Toplam Ticket', value: String(stats.totalTickets), inline: true },
            { name: '🟢 Açık', value: String(stats.openTickets), inline: true },
            { name: '🔴 Kapalı', value: String(stats.closedTickets), inline: true },
            { name: '📂 Kategoriler', value: String(stats.totalCategories), inline: true },
            { name: '🎨 Paneller', value: String(stats.totalPanels), inline: true },
            { name: '👥 Yetkili Roller', value: String(staffRoles.length), inline: true },
            { name: '📅 Bugün', value: String(stats.todayTickets), inline: true },
            { name: '📅 Bu Hafta', value: String(stats.weekTickets), inline: true },
            { name: '⭐ Ort. Puan', value: stats.avgRating ? stats.avgRating.toFixed(1) : 'Veri yok', inline: true },
        )
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('admin_refresh_overview').setLabel('🔄 Yenile').setStyle(ButtonStyle.Primary),
    );

    return { embeds: [embed], components: [row] };
}

// ─── Category Management ───
function buildCategoryList(guildId, page = 0) {
    const categories = db.getCategories(guildId);
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(categories.length / pageSize));
    const currentPage = Math.min(page, totalPages - 1);
    const pageCategories = categories.slice(currentPage * pageSize, (currentPage + 1) * pageSize);

    const embed = new EmbedBuilder()
        .setTitle('📂 Kategori Yönetimi')
        .setDescription(categories.length === 0
            ? 'Henüz kategori oluşturulmamış. "Yeni Kategori" butonuyla başlayın.'
            : `Toplam **${categories.length}** kategori (Sayfa ${currentPage + 1}/${totalPages})`)
        .setColor('#5865F2')
        .setTimestamp();

    for (const cat of pageCategories) {
        embed.addFields({
            name: `${cat.emoji || '🎫'} ${cat.name} ${cat.is_active ? '🟢' : '🔴'}`,
            value: `ID: \`${cat.id.substring(0, 8)}...\`\nButon: ${cat.button_label}\nKanal Formatı: \`${cat.channel_name_format}\`\nMaksimum: ${cat.max_tickets_per_user}`,
            inline: true,
        });
    }

    const rows = [];

    // Category select if any exist
    if (categories.length > 0) {
        const catMenu = new StringSelectMenuBuilder()
            .setCustomId('admin_category_select')
            .setPlaceholder('Düzenlenecek kategoriyi seçin...')
            .addOptions(categories.slice(0, 25).map(c => ({
                label: c.name.substring(0, 100),
                value: c.id,
                emoji: c.emoji || '🎫',
                description: `${c.is_active ? 'Aktif' : 'Pasif'} — ${c.button_label}`.substring(0, 100),
            })));
        rows.push(new ActionRowBuilder().addComponents(catMenu));
    }

    // Action buttons
    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('admin_category_create').setLabel('➕ Yeni Kategori').setStyle(ButtonStyle.Success),
    );

    if (totalPages > 1) {
        if (currentPage > 0) actionRow.addComponents(new ButtonBuilder().setCustomId(`admin_cat_page_${currentPage - 1}`).setLabel('◀').setStyle(ButtonStyle.Primary));
        if (currentPage < totalPages - 1) actionRow.addComponents(new ButtonBuilder().setCustomId(`admin_cat_page_${currentPage + 1}`).setLabel('▶').setStyle(ButtonStyle.Primary));
    }

    rows.push(actionRow);

    return { embeds: [embed], components: rows };
}

function buildCategoryEditor(categoryId) {
    const cat = db.getCategory(categoryId);
    if (!cat) return null;

    const embed = new EmbedBuilder()
        .setTitle(`📂 Kategori: ${cat.emoji || ''} ${cat.name}`)
        .setColor(cat.color || '#5865F2')
        .addFields(
            { name: '📝 Ad', value: cat.name, inline: true },
            { name: '🏷️ Buton Etiketi', value: cat.button_label, inline: true },
            { name: '😀 Emoji', value: cat.emoji || 'Yok', inline: true },
            { name: '📄 Açıklama', value: cat.description || 'Yok', inline: false },
            { name: '🏠 Discord Kategorisi', value: cat.discord_category_id ? `<#${cat.discord_category_id}>` : 'Ayarlanmamış', inline: true },
            { name: '📋 Kanal Formatı', value: `\`${cat.channel_name_format}\``, inline: true },
            { name: '🔢 Max Ticket', value: String(cat.max_tickets_per_user), inline: true },
            { name: '⏱️ Cooldown', value: `${cat.cooldown_seconds}s`, inline: true },
            { name: '📝 Modal', value: cat.use_modal ? `Aktif (${cat.modal_fields.length} alan)` : 'Pasif', inline: true },
            { name: '🎨 Renk', value: cat.color || '#5865F2', inline: true },
            { name: '📊 Durum', value: cat.is_active ? '🟢 Aktif' : '🔴 Pasif', inline: true },
            { name: '👥 Yetkili Roller', value: cat.staff_roles.length > 0 ? cat.staff_roles.map(r => `<@&${r}>`).join(', ') : 'Genel yetkili rolleri', inline: false },
        )
        .setTimestamp();

    const editMenu = new StringSelectMenuBuilder()
        .setCustomId(`admin_cat_edit_${categoryId}`)
        .setPlaceholder('Düzenlenecek ayarı seçin...')
        .addOptions([
            { label: 'Ad ve Açıklama', value: 'name_desc', emoji: '📝' },
            { label: 'Emoji ve Buton', value: 'emoji_button', emoji: '🏷️' },
            { label: 'Kanal ve Kategori', value: 'channel_cat', emoji: '🏠' },
            { label: 'Limitler ve Cooldown', value: 'limits', emoji: '🔢' },
            { label: 'Modal Ayarları', value: 'modal', emoji: '📝' },
            { label: 'Renk ve Tasarım', value: 'color', emoji: '🎨' },
            { label: 'Karşılama Mesajı', value: 'welcome', emoji: '👋' },
            { label: 'Kapatma Mesajı', value: 'close_msg', emoji: '🔒' },
            { label: 'Yetkili Rolleri', value: 'staff', emoji: '👥' },
            { label: 'İzin Verilen Roller', value: 'allowed', emoji: '✅' },
            { label: 'Log Kanalları', value: 'cat_logs', emoji: '📋' },
            { label: 'Otomasyon', value: 'auto', emoji: '🤖' },
            { label: 'Öncelik ve Etiketler', value: 'priority', emoji: '🏷️' },
            { label: 'Aktif/Pasif', value: 'toggle', emoji: '⚡' },
        ]);

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin_back_categories').setLabel('← Kategoriler').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`admin_cat_duplicate_${categoryId}`).setLabel('📋 Kopyala').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`admin_cat_delete_${categoryId}`).setLabel('🗑️ Sil').setStyle(ButtonStyle.Danger),
    );

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(editMenu), actionRow] };
}

// ─── Panel Management ───
function buildPanelList(guildId) {
    const panels = db.getPanels(guildId);

    const embed = new EmbedBuilder()
        .setTitle('🎨 Ticket Panel Tasarımcısı')
        .setDescription(panels.length === 0
            ? 'Henüz panel oluşturulmamış. "Yeni Panel" butonuyla başlayın.'
            : `Toplam **${panels.length}** panel`)
        .setColor('#5865F2')
        .setTimestamp();

    for (const panel of panels.slice(0, 10)) {
        embed.addFields({
            name: `${panel.is_active ? '🟢' : '🔴'} ${panel.name}`,
            value: `Kanal: ${panel.channel_id ? `<#${panel.channel_id}>` : 'Ayarlanmamış'}\nMesaj: ${panel.message_id ? 'Gönderildi' : 'Gönderilmemiş'}`,
            inline: true,
        });
    }

    const rows = [];

    if (panels.length > 0) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId('admin_panel_select')
            .setPlaceholder('Düzenlenecek paneli seçin...')
            .addOptions(panels.slice(0, 25).map(p => ({
                label: p.name.substring(0, 100),
                value: p.id,
                description: `${p.is_active ? 'Aktif' : 'Pasif'} — ${p.channel_id ? 'Kanal ayarlı' : 'Kanal yok'}`.substring(0, 100),
            })));
        rows.push(new ActionRowBuilder().addComponents(menu));
    }

    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('admin_panel_create').setLabel('➕ Yeni Panel').setStyle(ButtonStyle.Success),
    ));

    return { embeds: [embed], components: rows };
}

function buildPanelEditor(panelId, guildId) {
    const panel = db.getPanel(panelId);
    if (!panel) return null;

    const categories = db.getCategories(guildId);
    const deployments = db.getPanelDeployments(panelId);

    const embedConfig = panel.embed_config || {};
    const embed = new EmbedBuilder()
        .setTitle(`🎨 Panel: ${panel.name}`)
        .setColor('#5865F2')
        .addFields(
            { name: '📝 Ad', value: panel.name, inline: true },
            { name: '📺 Kanal', value: panel.channel_id ? `<#${panel.channel_id}>` : 'Ayarlanmamış', inline: true },
            { name: '💬 Mesaj', value: panel.message_id ? `✅ Gönderildi` : '❌ Gönderilmemiş', inline: true },
            { name: '📊 Durum', value: panel.is_active ? '🟢 Aktif' : '🔴 Pasif', inline: true },
            { name: '🔗 Dağıtımlar', value: String(deployments.length), inline: true },
            { name: '📂 Kategoriler', value: String(categories.filter(c => c.is_active).length), inline: true },
            { name: '🎨 Embed Başlık', value: embedConfig.title || 'Varsayılan', inline: true },
            { name: '📝 Bileşen Sayısı', value: String((panel.components_config || []).length || 'Otomatik'), inline: true },
        )
        .setTimestamp();

    const editMenu = new StringSelectMenuBuilder()
        .setCustomId(`admin_panel_edit_${panelId}`)
        .setPlaceholder('Düzenlenecek ayarı seçin...')
        .addOptions([
            { label: 'Panel Adı', value: 'name', emoji: '📝' },
            { label: 'Embed Tasarımı', value: 'embed', emoji: '🎨' },
            { label: 'Buton Düzeni', value: 'components', emoji: '🔘' },
            { label: 'Gönderim Kanalı', value: 'channel', emoji: '📺' },
            { label: 'Aktif/Pasif', value: 'toggle', emoji: '⚡' },
        ]);

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin_back_panels').setLabel('← Paneller').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`admin_panel_preview_${panelId}`).setLabel('👁️ Önizle').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`admin_panel_deploy_${panelId}`).setLabel('🚀 Gönder').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`admin_panel_duplicate_${panelId}`).setLabel('📋 Kopyala').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`admin_panel_delete_${panelId}`).setLabel('🗑️ Sil').setStyle(ButtonStyle.Danger),
    );

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(editMenu), actionRow] };
}

// ─── Role Management ───
function buildRoleManager(guildId) {
    const staffRoles = db.getStaffRoles(guildId);
    const adminRoles = db.getAdminRoles(guildId);

    const embed = new EmbedBuilder()
        .setTitle('👥 Yetkili ve Rol Yönetimi')
        .setColor('#5865F2')
        .addFields(
            { name: '🛡️ Yönetim Paneli Rolleri', value: adminRoles.length > 0 ? adminRoles.map(r => `<@&${r}>`).join('\n') : 'Ayarlanmamış (Yalnızca yöneticiler)', inline: false },
            { name: '👥 Genel Yetkili Rolleri', value: staffRoles.length > 0 ? staffRoles.map(r => `<@&${r}>`).join('\n') : 'Ayarlanmamış', inline: false },
        )
        .setTimestamp();

    const rows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admin_role_add_staff').setLabel('➕ Yetkili Rolü Ekle').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('admin_role_add_admin').setLabel('➕ Yönetici Rolü Ekle').setStyle(ButtonStyle.Primary),
        ),
    ];

    if (staffRoles.length > 0 || adminRoles.length > 0) {
        const removeOptions = [];
        for (const r of staffRoles) removeOptions.push({ label: `Yetkili: ${r}`, value: `staff_${r}`, emoji: '👥' });
        for (const r of adminRoles) removeOptions.push({ label: `Yönetici: ${r}`, value: `admin_${r}`, emoji: '🛡️' });

        if (removeOptions.length > 0) {
            const removeMenu = new StringSelectMenuBuilder()
                .setCustomId('admin_role_remove')
                .setPlaceholder('Kaldırılacak rolü seçin...')
                .addOptions(removeOptions.slice(0, 25));
            rows.unshift(new ActionRowBuilder().addComponents(removeMenu));
        }
    }

    return { embeds: [embed], components: rows };
}

// ─── Log Channel Management ───
function buildLogManager(guildId) {
    const logChannels = db.getAllLogChannels(guildId);

    const logTypes = [
        { key: 'ticket_open', label: '📩 Ticket Açılma' },
        { key: 'ticket_close', label: '🔒 Ticket Kapanma' },
        { key: 'ticket_delete', label: '🗑️ Ticket Silme' },
        { key: 'ticket_reopen', label: '🔓 Yeniden Açma' },
        { key: 'ticket_claim', label: '✋ Sahiplenme' },
        { key: 'ticket_unclaim', label: '👋 Sahiplik Bırakma' },
        { key: 'user_add', label: '➕ Kullanıcı Ekleme' },
        { key: 'user_remove', label: '➖ Kullanıcı Çıkarma' },
        { key: 'category_change', label: '📂 Kategori Değişikliği' },
        { key: 'priority_change', label: '🏷️ Öncelik Değişikliği' },
        { key: 'transcript_create', label: '📄 Transcript Oluşturma' },
        { key: 'admin_change', label: '⚙️ Ayar Değişikliği' },
    ];

    const embed = new EmbedBuilder()
        .setTitle('📝 Kanal ve Log Ayarları')
        .setColor('#5865F2')
        .setDescription('Her log türü için ayrı kanal ayarlayabilirsiniz.')
        .setTimestamp();

    for (const lt of logTypes) {
        embed.addFields({
            name: lt.label,
            value: logChannels[lt.key] ? `<#${logChannels[lt.key]}>` : '`Ayarlanmamış`',
            inline: true,
        });
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId('admin_log_select')
        .setPlaceholder('Ayarlanacak log türünü seçin...')
        .addOptions(logTypes.map(lt => ({
            label: lt.label.replace(/^.+\s/, ''),
            value: lt.key,
            description: logChannels[lt.key] ? 'Kanal ayarlı' : 'Ayarlanmamış',
        })));

    const rows = [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('admin_log_clear_all').setLabel('🗑️ Tümünü Temizle').setStyle(ButtonStyle.Danger),
        ),
    ];

    return { embeds: [embed], components: rows };
}

// ─── Behavior Settings ───
function buildBehaviorSettings(guildId, page = 0) {
    const settings = db.getAllTicketSettings(guildId);

    const settingGroups = [
        {
            title: '⚡ Ticket Davranış Ayarları (Sayfa 1)',
            items: [
                { key: 'channel_name_format', label: 'Kanal İsim Formatı', desc: 'ticket-{number}, {user}-{number}, vb.' },
                { key: 'auto_numbering', label: 'Otomatik Numaralama', desc: 'Ticket numaraları otomatik artsın mı?' },
                { key: 'max_tickets_per_user', label: 'Kullanıcı Başına Max Ticket', desc: 'Genel limit' },
                { key: 'open_cooldown', label: 'Açma Cooldown (saniye)', desc: 'Genel cooldown süresi' },
                { key: 'use_modal', label: 'Varsayılan Modal', desc: 'Ticket açarken modal gösterilsin mi?' },
                { key: 'staff_notification', label: 'Yetkili Bildirimi', desc: 'Yeni ticketlarda yetkili etiketlensin mi?' },
                { key: 'close_confirmation', label: 'Kapatma Onayı', desc: 'Kapatmadan önce onay istesin mi?' },
                { key: 'close_reason_required', label: 'Kapatma Nedeni Zorunlu', desc: 'Kapatma nedeni zorunlu olsun mu?' },
            ],
        },
        {
            title: '⚡ Ticket Davranış Ayarları (Sayfa 2)',
            items: [
                { key: 'reopen_timeout_hours', label: 'Yeniden Açma Süresi (saat)', desc: 'Kapatıldıktan sonra yeniden açma limiti' },
                { key: 'claim_required', label: 'Sahiplenme Zorunlu', desc: 'Yetkili ticketı sahiplenmek zorunda mı?' },
                { key: 'priority_system', label: 'Öncelik Sistemi', desc: 'Ticket öncelik sistemi aktif mi?' },
                { key: 'tag_system', label: 'Etiket Sistemi', desc: 'Ticket etiket sistemi aktif mi?' },
                { key: 'user_rating', label: 'Kullanıcı Değerlendirmesi', desc: 'Kapanışta değerlendirme istesin mi?' },
                { key: 'max_added_users', label: 'Max Eklenen Kullanıcı', desc: 'Bir ticketa eklenebilecek max kullanıcı' },
                { key: 'allow_category_change', label: 'Kategori Değiştirme', desc: 'Kullanıcılar kategori değiştirebilsin mi?' },
                { key: 'claim_cooldown', label: 'Sahiplenme Cooldown', desc: 'Sahiplenme cooldown süresi (saniye)' },
            ],
        },
    ];

    const currentPage = Math.min(page, settingGroups.length - 1);
    const group = settingGroups[currentPage];

    const embed = new EmbedBuilder()
        .setTitle(group.title)
        .setColor('#5865F2')
        .setTimestamp();

    for (const item of group.items) {
        const val = settings[item.key] || 'Varsayılan';
        const displayVal = val === '1' ? '✅ Aktif' : val === '0' ? '❌ Pasif' : val;
        embed.addFields({ name: `${item.label}`, value: `${displayVal}\n*${item.desc}*`, inline: true });
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId('admin_behavior_select')
        .setPlaceholder('Düzenlenecek ayarı seçin...')
        .addOptions(group.items.map(item => ({
            label: item.label,
            value: item.key,
            description: item.desc.substring(0, 100),
        })));

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary),
    );

    if (currentPage > 0) navRow.addComponents(new ButtonBuilder().setCustomId(`admin_behavior_page_${currentPage - 1}`).setLabel('◀ Önceki').setStyle(ButtonStyle.Primary));
    if (currentPage < settingGroups.length - 1) navRow.addComponents(new ButtonBuilder().setCustomId(`admin_behavior_page_${currentPage + 1}`).setLabel('Sonraki ▶').setStyle(ButtonStyle.Primary));

    return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), navRow] };
}

// ─── Transcript Settings ───
function buildTranscriptSettings(guildId) {
    const settings = db.getAllTicketSettings(guildId);

    const embed = new EmbedBuilder()
        .setTitle('📄 Transcript ve Arşiv Ayarları')
        .setColor('#5865F2')
        .addFields(
            { name: 'Format', value: settings.transcript_format || 'html', inline: true },
            { name: 'DM Gönderimi', value: settings.transcript_dm === '1' ? '✅' : '❌', inline: true },
            { name: 'Arşiv Kategorisi', value: settings.archive_category_id ? `<#${settings.archive_category_id}>` : 'Ayarlanmamış', inline: true },
            { name: 'Arşiv Kanalı', value: settings.archive_channel_id ? `<#${settings.archive_channel_id}>` : 'Ayarlanmamış', inline: true },
            { name: 'Saklama Süresi', value: settings.transcript_retention_days > 0 ? `${settings.transcript_retention_days} gün` : 'Sınırsız', inline: true },
        )
        .setTimestamp();

    const menu = new StringSelectMenuBuilder()
        .setCustomId('admin_transcript_select')
        .setPlaceholder('Düzenlenecek ayarı seçin...')
        .addOptions([
            { label: 'Transcript Formatı', value: 'transcript_format', emoji: '📄' },
            { label: 'DM Gönderimi', value: 'transcript_dm', emoji: '📨' },
            { label: 'Arşiv Kanalı', value: 'archive_channel_id', emoji: '📁' },
            { label: 'Saklama Süresi', value: 'transcript_retention_days', emoji: '📅' },
        ]);

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(menu),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary),
            ),
        ],
    };
}

// ─── Automation Settings ───
function buildAutomationSettings(guildId) {
    const settings = db.getAllTicketSettings(guildId);

    const embed = new EmbedBuilder()
        .setTitle('🤖 Otomatik İşlemler')
        .setColor('#5865F2')
        .addFields(
            { name: 'Otomatik Kapanma', value: settings.auto_close_hours > 0 ? `${settings.auto_close_hours} saat` : '❌ Pasif', inline: true },
            { name: 'Otomatik Arşivleme', value: settings.auto_archive_hours > 0 ? `${settings.auto_archive_hours} saat` : '❌ Pasif', inline: true },
            { name: 'Otomatik Silme', value: settings.auto_delete_hours > 0 ? `${settings.auto_delete_hours} saat` : '❌ Pasif', inline: true },
            { name: 'İnaktif Uyarısı', value: settings.inactive_warning_hours > 0 ? `${settings.inactive_warning_hours} saat` : '❌ Pasif', inline: true },
        )
        .setTimestamp();

    const menu = new StringSelectMenuBuilder()
        .setCustomId('admin_auto_select')
        .setPlaceholder('Düzenlenecek ayarı seçin...')
        .addOptions([
            { label: 'Otomatik Kapanma Süresi', value: 'auto_close_hours', emoji: '🔒' },
            { label: 'Otomatik Arşivleme Süresi', value: 'auto_archive_hours', emoji: '📁' },
            { label: 'Otomatik Silme Süresi', value: 'auto_delete_hours', emoji: '🗑️' },
            { label: 'İnaktif Uyarı Süresi', value: 'inactive_warning_hours', emoji: '⏰' },
        ]);

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(menu),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary),
            ),
        ],
    };
}

// ─── Statistics ───
function buildStatistics(guildId) {
    const stats = db.getStats(guildId);

    const embed = new EmbedBuilder()
        .setTitle('📈 Detaylı İstatistikler')
        .setColor('#5865F2')
        .addFields(
            { name: '📊 Genel', value: `Toplam: **${stats.totalTickets}**\nAçık: **${stats.openTickets}**\nKapalı: **${stats.closedTickets}**`, inline: true },
            { name: '📅 Zaman', value: `Bugün: **${stats.todayTickets}**\nBu Hafta: **${stats.weekTickets}**`, inline: true },
            { name: '⭐ Ortalama Puan', value: stats.avgRating ? `**${stats.avgRating.toFixed(1)}** / 5` : 'Veri yok', inline: true },
        )
        .setTimestamp();

    if (stats.topStaff.length > 0) {
        embed.addFields({
            name: '🏆 En Aktif Yetkililer',
            value: stats.topStaff.map((s, i) => `${i + 1}. <@${s.claimed_by}> — **${s.count}** ticket`).join('\n'),
            inline: false,
        });
    }

    if (stats.categoryBreakdown.length > 0) {
        embed.addFields({
            name: '📂 Kategori Dağılımı',
            value: stats.categoryBreakdown.map(c => `• **${c.name}**: ${c.count}`).join('\n'),
            inline: false,
        });
    }

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('admin_refresh_stats').setLabel('🔄 Yenile').setStyle(ButtonStyle.Primary),
            ),
        ],
    };
}

// ─── Backup Management ───
function buildBackupManager(guildId) {
    const backupService = require('./backupService');
    const backups = backupService.listBackups(guildId);

    const embed = new EmbedBuilder()
        .setTitle('💾 Veritabanı Yedekleme')
        .setColor('#5865F2')
        .setDescription(backups.length === 0
            ? 'Henüz yedek oluşturulmamış.'
            : `**${backups.length}** yedek bulundu.`)
        .setTimestamp();

    for (const b of backups.slice(0, 10)) {
        const sizeKB = (b.size / 1024).toFixed(1);
        embed.addFields({
            name: b.fileName.substring(0, 40),
            value: `Boyut: ${sizeKB} KB\nTarih: ${b.created}`,
            inline: true,
        });
    }

    const rows = [];

    if (backups.length > 0) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId('admin_backup_select')
            .setPlaceholder('Geri yüklenecek yedeği seçin...')
            .addOptions(backups.slice(0, 25).map(b => ({
                label: b.fileName.substring(0, 100),
                value: b.fileName,
                description: `${(b.size / 1024).toFixed(1)} KB`,
            })));
        rows.push(new ActionRowBuilder().addComponents(menu));
    }

    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('admin_backup_create').setLabel('💾 Yedek Oluştur').setStyle(ButtonStyle.Success),
    ));

    return { embeds: [embed], components: rows };
}

// ─── Security/Permission Management ───
function buildSecurityManager(guildId) {
    const blacklist = db.getBlacklist(guildId);

    const embed = new EmbedBuilder()
        .setTitle('🔒 İzin ve Güvenlik Ayarları')
        .setColor('#5865F2')
        .addFields(
            { name: '🚫 Kara Liste', value: blacklist.length > 0 ? `${blacklist.length} giriş` : 'Boş', inline: true },
        )
        .setTimestamp();

    if (blacklist.length > 0) {
        const blList = blacklist.slice(0, 10).map(b => {
            const target = b.target_type === 'user' ? `<@${b.target_id}>` : `<@&${b.target_id}>`;
            return `${target} — ${b.reason || 'Neden belirtilmedi'}`;
        }).join('\n');
        embed.addFields({ name: 'Kara Liste Girişleri', value: blList, inline: false });
    }

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('admin_blacklist_add').setLabel('➕ Kara Listeye Ekle').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('admin_blacklist_remove').setLabel('➖ Kara Listeden Çıkar').setStyle(ButtonStyle.Success),
            ),
        ],
    };
}

// ─── Message Management ───
function buildMessageManager(guildId) {
    const messages = db.getAllCustomMessages(guildId);

    const messageKeys = [
        { key: 'welcome_title', label: 'Karşılama Başlığı' },
        { key: 'welcome_message', label: 'Karşılama Mesajı' },
        { key: 'close_message', label: 'Kapatma Mesajı' },
        { key: 'reopen_message', label: 'Yeniden Açma Mesajı' },
        { key: 'claim_message', label: 'Sahiplenme Mesajı' },
        { key: 'staff_call_message', label: 'Yetkili Çağırma Mesajı' },
        { key: 'blacklist_message', label: 'Kara Liste Mesajı' },
        { key: 'cooldown_message', label: 'Cooldown Mesajı' },
        { key: 'limit_message', label: 'Limit Mesajı' },
    ];

    const embed = new EmbedBuilder()
        .setTitle('💬 Dil ve Mesaj Yönetimi')
        .setDescription('Bot mesajlarını özelleştirin. Değişkenler: `{user}`, `{number}`, `{category}`, `{guild}`')
        .setColor('#5865F2')
        .setTimestamp();

    for (const mk of messageKeys) {
        embed.addFields({
            name: mk.label,
            value: messages[mk.key] ? `\`${messages[mk.key].substring(0, 50)}...\`` : '*Varsayılan*',
            inline: true,
        });
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId('admin_message_select')
        .setPlaceholder('Düzenlenecek mesajı seçin...')
        .addOptions(messageKeys.map(mk => ({
            label: mk.label,
            value: mk.key,
            description: messages[mk.key] ? 'Özelleştirilmiş' : 'Varsayılan',
        })));

    return {
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(menu),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId('admin_message_reset').setLabel('🔄 Tümünü Sıfırla').setStyle(ButtonStyle.Danger),
            ),
        ],
    };
}

// ─── Embed Designer ───
function buildEmbedDesigner(guildId) {
    const templates = db.getEmbedTemplates(guildId);

    const embed = new EmbedBuilder()
        .setTitle('🖼️ Embed Tasarımcısı')
        .setDescription('Embed şablonları oluşturabilir ve panellerinizde kullanabilirsiniz.\n\nDeğişkenler: `{user}`, `{number}`, `{category}`, `{guild}`')
        .setColor('#5865F2')
        .setTimestamp();

    if (templates.length > 0) {
        for (const t of templates.slice(0, 10)) {
            embed.addFields({
                name: t.name,
                value: `Başlık: ${t.embed_config.title || 'Yok'}\nRenk: ${t.embed_config.color || 'Varsayılan'}`,
                inline: true,
            });
        }
    }

    const rows = [];

    if (templates.length > 0) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId('admin_embed_select')
            .setPlaceholder('Düzenlenecek şablonu seçin...')
            .addOptions(templates.slice(0, 25).map(t => ({
                label: t.name.substring(0, 100),
                value: t.id,
            })));
        rows.push(new ActionRowBuilder().addComponents(menu));
    }

    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('admin_back_main').setLabel('← Ana Menü').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('admin_embed_create').setLabel('➕ Yeni Şablon').setStyle(ButtonStyle.Success),
    ));

    return { embeds: [embed], components: rows };
}

module.exports = {
    adminSessions,
    getSession, setSession, clearSession,
    mainMenuEmbed, mainMenuComponents,
    buildOverview,
    buildCategoryList, buildCategoryEditor,
    buildPanelList, buildPanelEditor,
    buildRoleManager,
    buildLogManager,
    buildBehaviorSettings,
    buildTranscriptSettings,
    buildAutomationSettings,
    buildStatistics,
    buildBackupManager,
    buildSecurityManager,
    buildMessageManager,
    buildEmbedDesigner,
};
