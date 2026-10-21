const express = require('express');
const session = require('express-session');
const passport = require('passport');
const { Strategy } = require('passport-discord-auth');
const path = require('path');
const crypto = require('crypto');

function createWebServer(client, db) {
    const app = express();

    // ─── Middleware ───
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.static(path.join(__dirname, 'public')));

    // ─── Session ───
    const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
    app.use(session({
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
            secure: false,
            httpOnly: true,
        }
    }));

    // ─── Passport Discord OAuth2 ───
    app.use(passport.initialize());
    app.use(passport.session());

    passport.serializeUser((user, done) => done(null, user));
    passport.deserializeUser((obj, done) => done(null, obj));

    const CALLBACK_URL = process.env.CALLBACK_URL || 'http://localhost:3000/auth/discord/callback';
    const clientId = process.env.CLIENT_ID || '';
    const clientSecret = process.env.CLIENT_SECRET || '';

    if (clientId && clientSecret) {
        passport.use(new Strategy({
            clientId: clientId,
            clientSecret: clientSecret,
            callbackUrl: CALLBACK_URL,
            callbackURL: CALLBACK_URL,
            scope: ['identify', 'guilds'],
        }, (accessToken, refreshToken, profile, done) => {
            profile.accessToken = accessToken;
            return done(null, profile);
        }));
    } else {
        console.warn('⚠️ [Web Dashboard] CLIENT_SECRET .env dosyasında eksik! Discord ile giriş yapabilmek için Developer Portal\'dan Client Secret ekleyin.');
    }

    // ─── Auth Routes ───
    app.get('/auth/discord', (req, res, next) => {
        if (!process.env.CLIENT_SECRET) {
            return res.status(500).send(`
                <!DOCTYPE html>
                <html lang="tr">
                <head><meta charset="UTF-8"><title>OAuth2 Yapılandırma Gerekli</title></head>
                <body style="font-family:system-ui,-apple-system,sans-serif;background:#0d1117;color:#c9d1d9;padding:40px;text-align:center;min-height:100vh;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                    <div style="max-width:550px;background:#161b22;padding:32px;border-radius:16px;border:1px solid #30363d;box-shadow:0 8px 24px rgba(0,0,0,0.5);">
                        <div style="font-size:48px;margin-bottom:16px;">⚠️</div>
                        <h2 style="color:#f0f6fc;margin-top:0;">Discord Client Secret Eksik</h2>
                        <p style="color:#8b949e;line-height:1.6;font-size:15px;">
                            Web paneline Discord ile giriş yapabilmek için <code>.env</code> dosyasındaki <b>CLIENT_SECRET</b> alanını doldurmanız gerekmektedir.
                        </p>
                        <div style="text-align:left;background:#0d1117;padding:16px;border-radius:8px;font-size:13px;color:#58a6ff;margin:20px 0;font-family:monospace;">
                            1. Discord Developer Portal > Applications > Botunuz<br>
                            2. OAuth2 > General sekmesine gidin<br>
                            3. "Reset Secret" butonuna basıp secret'ı kopyalayın<br>
                            4. .env dosyasına CLIENT_SECRET=... olarak yapıştırın
                        </div>
                        <a href="/" style="display:inline-block;padding:10px 24px;background:#5865F2;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Ana Sayfaya Dön</a>
                    </div>
                </body>
                </html>
            `);
        }
        passport.authenticate('discord')(req, res, next);
    });

    app.get('/auth/discord/callback',
        passport.authenticate('discord', { failureRedirect: '/' }),
        (req, res) => res.redirect('/dashboard')
    );

    app.get('/auth/logout', (req, res) => {
        req.logout(() => {
            res.redirect('/');
        });
    });

    // ─── Auth Middleware ───
    function isAuthenticated(req, res, next) {
        if (req.isAuthenticated()) return next();
        res.status(401).json({ error: 'Giriş yapmanız gerekiyor' });
    }

    // ─── API: Current User ───
    app.get('/api/user', isAuthenticated, (req, res) => {
        const user = req.user;
        res.json({
            id: user.id,
            username: user.username,
            displayName: user.displayName || user.global_name || user.username,
            avatar: user.avatar
                ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
                : `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`,
        });
    });

    // ─── API: Mutual Guilds (user is admin in) ───
    app.get('/api/guilds', isAuthenticated, (req, res) => {
        const userGuilds = req.user.guilds || [];
        const botGuilds = client.guilds.cache;

        const mutualGuilds = userGuilds
            .filter(g => {
                const inBot = botGuilds.has(g.id);
                const isAdmin = (parseInt(g.permissions) & 0x8) === 0x8; // ADMINISTRATOR
                const isOwner = g.owner;
                // Also check db admin roles
                let hasAdminRole = false;
                if (inBot) {
                    const adminRoles = db.getAdminRoles(g.id);
                    // We can't check member roles from the OAuth guilds list alone
                    // so we rely on Discord ADMINISTRATOR permission
                }
                return inBot && (isAdmin || isOwner);
            })
            .map(g => {
                const botGuild = botGuilds.get(g.id);
                return {
                    id: g.id,
                    name: g.name,
                    icon: g.icon
                        ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128`
                        : null,
                    memberCount: botGuild?.memberCount || 0,
                };
            });

        res.json(mutualGuilds);
    });

    // ─── Guild-Specific Middleware ───
    function requireGuildAdmin(req, res, next) {
        const guildId = req.params.guildId;
        if (!client.guilds.cache.has(guildId)) {
            return res.status(404).json({ error: 'Sunucu bulunamadı' });
        }

        const userGuilds = req.user.guilds || [];
        const userGuild = userGuilds.find(g => g.id === guildId);
        if (!userGuild) {
            return res.status(403).json({ error: 'Bu sunucuya erişiminiz yok' });
        }

        const isAdmin = (parseInt(userGuild.permissions) & 0x8) === 0x8;
        const isOwner = userGuild.owner;
        if (!isAdmin && !isOwner) {
            return res.status(403).json({ error: 'Yönetici yetkisi gerekiyor' });
        }

        next();
    }

    // ─── API: Guild Overview ───
    app.get('/api/guilds/:guildId/overview', isAuthenticated, requireGuildAdmin, (req, res) => {
        const { guildId } = req.params;
        const stats = db.getStats(guildId);
        const guild = client.guilds.cache.get(guildId);

        res.json({
            guild: {
                id: guild.id,
                name: guild.name,
                icon: guild.iconURL({ size: 128 }),
                memberCount: guild.memberCount,
            },
            stats,
        });
    });

    // ─── API: Categories ───
    app.get('/api/guilds/:guildId/categories', isAuthenticated, requireGuildAdmin, (req, res) => {
        const categories = db.getCategories(req.params.guildId);
        res.json(categories);
    });

    app.post('/api/guilds/:guildId/categories', isAuthenticated, requireGuildAdmin, (req, res) => {
        const id = db.createCategory(req.params.guildId, req.body);
        res.json({ id, success: true });
    });

    app.put('/api/guilds/:guildId/categories/:catId', isAuthenticated, requireGuildAdmin, (req, res) => {
        db.updateCategory(req.params.catId, req.body);
        res.json({ success: true });
    });

    app.delete('/api/guilds/:guildId/categories/:catId', isAuthenticated, requireGuildAdmin, (req, res) => {
        db.deleteCategory(req.params.catId);
        res.json({ success: true });
    });

    // ─── API: Panels ───
    app.get('/api/guilds/:guildId/panels', isAuthenticated, requireGuildAdmin, (req, res) => {
        const panels = db.getPanels(req.params.guildId);
        res.json(panels);
    });

    app.post('/api/guilds/:guildId/panels', isAuthenticated, requireGuildAdmin, (req, res) => {
        const id = db.createPanel(req.params.guildId, req.body);
        res.json({ id, success: true });
    });

    app.put('/api/guilds/:guildId/panels/:panelId', isAuthenticated, requireGuildAdmin, (req, res) => {
        db.updatePanel(req.params.panelId, req.body);
        res.json({ success: true });
    });

    app.delete('/api/guilds/:guildId/panels/:panelId', isAuthenticated, requireGuildAdmin, (req, res) => {
        db.deletePanel(req.params.panelId);
        res.json({ success: true });
    });

    // ─── API: Tickets ───
    app.get('/api/guilds/:guildId/tickets', isAuthenticated, requireGuildAdmin, (req, res) => {
        const allOpen = db.getAllOpenTickets(req.params.guildId);
        res.json(allOpen);
    });

    app.get('/api/guilds/:guildId/tickets/:ticketId/messages', isAuthenticated, requireGuildAdmin, (req, res) => {
        const messages = db.getTicketMessages(parseInt(req.params.ticketId));
        res.json(messages);
    });

    // ─── API: Settings ───
    app.get('/api/guilds/:guildId/settings', isAuthenticated, requireGuildAdmin, (req, res) => {
        const settings = db.getAllTicketSettings(req.params.guildId);
        res.json(settings);
    });

    app.put('/api/guilds/:guildId/settings', isAuthenticated, requireGuildAdmin, (req, res) => {
        const { key, value } = req.body;
        db.setTicketSetting(req.params.guildId, key, value);
        res.json({ success: true });
    });

    // ─── API: Roles ───
    app.get('/api/guilds/:guildId/roles', isAuthenticated, requireGuildAdmin, (req, res) => {
        const staffRoles = db.getStaffRoles(req.params.guildId);
        const adminRoles = db.getAdminRoles(req.params.guildId);
        const guild = client.guilds.cache.get(req.params.guildId);
        const allRoles = guild ? guild.roles.cache
            .filter(r => r.id !== guild.id) // exclude @everyone
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
            .sort((a, b) => a.name.localeCompare(b.name)) : [];

        res.json({ staffRoles, adminRoles, allRoles });
    });

    app.post('/api/guilds/:guildId/roles/staff', isAuthenticated, requireGuildAdmin, (req, res) => {
        db.addStaffRole(req.params.guildId, req.body.roleId);
        res.json({ success: true });
    });

    app.delete('/api/guilds/:guildId/roles/staff/:roleId', isAuthenticated, requireGuildAdmin, (req, res) => {
        db.removeStaffRole(req.params.guildId, req.params.roleId);
        res.json({ success: true });
    });

    app.post('/api/guilds/:guildId/roles/admin', isAuthenticated, requireGuildAdmin, (req, res) => {
        db.addAdminRole(req.params.guildId, req.body.roleId);
        res.json({ success: true });
    });

    app.delete('/api/guilds/:guildId/roles/admin/:roleId', isAuthenticated, requireGuildAdmin, (req, res) => {
        db.removeAdminRole(req.params.guildId, req.params.roleId);
        res.json({ success: true });
    });

    // ─── API: Logs ───
    app.get('/api/guilds/:guildId/logs', isAuthenticated, requireGuildAdmin, (req, res) => {
        const logChannels = db.getAllLogChannels(req.params.guildId);
        const guild = client.guilds.cache.get(req.params.guildId);
        const channels = guild ? guild.channels.cache
            .filter(c => c.type === 0) // GuildText
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name)) : [];

        res.json({ logChannels, channels });
    });

    app.put('/api/guilds/:guildId/logs', isAuthenticated, requireGuildAdmin, (req, res) => {
        const { logType, channelId } = req.body;
        db.setLogChannel(req.params.guildId, logType, channelId);
        res.json({ success: true });
    });

    // ─── API: Blacklist ───
    app.get('/api/guilds/:guildId/blacklist', isAuthenticated, requireGuildAdmin, (req, res) => {
        const list = db.getBlacklist(req.params.guildId);
        res.json(list);
    });

    app.post('/api/guilds/:guildId/blacklist', isAuthenticated, requireGuildAdmin, (req, res) => {
        const { targetType, targetId, reason } = req.body;
        db.addBlacklist(req.params.guildId, targetType, targetId, reason, req.user.id);
        res.json({ success: true });
    });

    app.delete('/api/guilds/:guildId/blacklist/:targetType/:targetId', isAuthenticated, requireGuildAdmin, (req, res) => {
        db.removeBlacklist(req.params.guildId, req.params.targetType, req.params.targetId);
        res.json({ success: true });
    });

    // ─── API: Audit Log ───
    app.get('/api/guilds/:guildId/audit', isAuthenticated, requireGuildAdmin, (req, res) => {
        const logs = db.getAuditLogs(req.params.guildId, 100);
        res.json(logs);
    });

    // ─── API: Guild Channels ───
    app.get('/api/guilds/:guildId/channels', isAuthenticated, requireGuildAdmin, (req, res) => {
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.json([]);

        const channels = guild.channels.cache
            .filter(c => c.type === 0 || c.type === 4) // Text + Category
            .map(c => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId }))
            .sort((a, b) => a.name.localeCompare(b.name));

        res.json(channels);
    });

    // ─── SPA Fallback (Express 5 compatible) ───
    app.use((req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    return app;
}

module.exports = { createWebServer };
