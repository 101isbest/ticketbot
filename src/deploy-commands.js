require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const commands = [
    // ─── /ticket-admin: Ana yönetim paneli ───
    new SlashCommandBuilder()
        .setName('ticket-admin')
        .setDescription('Ticket bot yönetim panelini açar')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    // ─── /ticket-add: Kullanıcı ekleme ───
    new SlashCommandBuilder()
        .setName('ticket-add')
        .setDescription('Mevcut ticketa bir kullanıcı ekler')
        .addUserOption(opt =>
            opt.setName('kullanici')
                .setDescription('Eklenecek kullanıcı')
                .setRequired(true)),

    // ─── /ticket-remove: Kullanıcı çıkarma ───
    new SlashCommandBuilder()
        .setName('ticket-remove')
        .setDescription('Mevcut tickettan bir kullanıcıyı çıkarır')
        .addUserOption(opt =>
            opt.setName('kullanici')
                .setDescription('Çıkarılacak kullanıcı')
                .setRequired(true)),

    // ─── /ticket-close: Ticket kapatma ───
    new SlashCommandBuilder()
        .setName('ticket-close')
        .setDescription('Bu ticketı kapatır')
        .addStringOption(opt =>
            opt.setName('neden')
                .setDescription('Kapatma nedeni')
                .setRequired(false)),

    // ─── /ticket-priority: Öncelik değiştirme ───
    new SlashCommandBuilder()
        .setName('ticket-priority')
        .setDescription('Ticket önceliğini değiştirir')
        .addStringOption(opt =>
            opt.setName('oncelik')
                .setDescription('Yeni öncelik')
                .setRequired(true)
                .addChoices(
                    { name: '🔴 Acil', value: 'urgent' },
                    { name: '🟠 Yüksek', value: 'high' },
                    { name: '🟡 Normal', value: 'normal' },
                    { name: '🟢 Düşük', value: 'low' },
                )),

    // ─── /ticket-topic: Konu değiştirme ───
    new SlashCommandBuilder()
        .setName('ticket-topic')
        .setDescription('Ticket konusunu belirler')
        .addStringOption(opt =>
            opt.setName('konu')
                .setDescription('Yeni konu')
                .setRequired(true)),

    // ─── /ticket-call: Yetkili çağırma ───
    new SlashCommandBuilder()
        .setName('ticket-call')
        .setDescription('Tüm yetkilileri ticketa çağırır'),

    // ─── /ticket-rename: Kanal yeniden adlandırma ───
    new SlashCommandBuilder()
        .setName('ticket-rename')
        .setDescription('Ticket kanalının adını değiştirir')
        .addStringOption(opt =>
            opt.setName('isim')
                .setDescription('Yeni kanal adı')
                .setRequired(true)),

    // ─── /ticket-unclaim: Sahipliği bırakma ───
    new SlashCommandBuilder()
        .setName('ticket-unclaim')
        .setDescription('Ticket sahipliğini bırakır'),
].map(cmd => cmd.toJSON());

module.exports = commands;

if (require.main === module) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    (async () => {
        try {
            console.log(`🔄 ${commands.length} adet slash komut kaydediliyor...`);

            const data = await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands },
            );

            console.log(`✅ ${data.length} adet slash komut başarıyla kaydedildi!`);
        } catch (error) {
            console.error('❌ Komut kaydı sırasında hata:', error);
        }
    })();
}
