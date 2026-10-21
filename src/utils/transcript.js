const sanitizeHtml = require('sanitize-html');
const db = require('../database/service');
const fs = require('fs');
const path = require('path');

/**
 * Generate an HTML transcript for a ticket
 */
function generateTranscript(ticket, messages, guild, category) {
    const sanitize = (text) => sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} });

    const formatTime = (isoStr) => {
        try {
            const d = new Date(isoStr);
            return d.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
        } catch {
            return isoStr || '';
        }
    };

    const categoryName = category ? sanitize(category.name) : 'Bilinmiyor';
    const guildName = guild ? sanitize(guild.name) : 'Bilinmiyor';
    const ticketNum = ticket.ticket_number || ticket.id;

    let messagesHtml = '';
    for (const msg of messages) {
        const username = sanitize(msg.username || 'Bilinmeyen');
        const avatar = msg.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png';
        const content = sanitize(msg.content || '').replace(/\n/g, '<br>');
        const time = formatTime(msg.created_at);

        let attachmentsHtml = '';
        const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
        if (attachments.length > 0) {
            attachmentsHtml = '<div class="attachments">';
            for (const att of attachments) {
                const attName = sanitize(typeof att === 'string' ? att : (att.name || 'dosya'));
                const attUrl = sanitize(typeof att === 'string' ? att : (att.url || '#'));
                attachmentsHtml += `<a href="${attUrl}" target="_blank" class="attachment">📎 ${attName}</a>`;
            }
            attachmentsHtml += '</div>';
        }

        messagesHtml += `
        <div class="message">
            <img class="avatar" src="${sanitize(avatar)}" alt="avatar">
            <div class="message-content">
                <div class="message-header">
                    <span class="username">${username}</span>
                    <span class="timestamp">${sanitize(time)}</span>
                </div>
                <div class="text">${content || '<em>İçerik yok</em>'}</div>
                ${attachmentsHtml}
            </div>
        </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transcript - Ticket #${ticketNum}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
            background: #36393f;
            color: #dcddde;
            padding: 20px;
        }
        .header {
            background: #2f3136;
            border-radius: 8px;
            padding: 24px;
            margin-bottom: 16px;
            border-left: 4px solid #5865f2;
        }
        .header h1 { color: #fff; font-size: 1.5em; margin-bottom: 8px; }
        .header .meta { color: #a3a6aa; font-size: 0.9em; }
        .header .meta span { margin-right: 16px; }
        .messages { background: #36393f; }
        .message {
            display: flex;
            padding: 8px 16px;
            margin: 2px 0;
            transition: background 0.1s;
        }
        .message:hover { background: #32353b; }
        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            margin-right: 16px;
            flex-shrink: 0;
        }
        .message-content { flex: 1; min-width: 0; }
        .message-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
        .username { color: #fff; font-weight: 600; font-size: 1em; }
        .timestamp { color: #72767d; font-size: 0.75em; }
        .text { color: #dcddde; line-height: 1.4; word-wrap: break-word; }
        .attachments { margin-top: 8px; }
        .attachment {
            display: inline-block;
            background: #2f3136;
            color: #00aff4;
            padding: 6px 12px;
            border-radius: 4px;
            text-decoration: none;
            font-size: 0.9em;
            margin: 2px 4px 2px 0;
            border: 1px solid #42454a;
        }
        .attachment:hover { background: #393c43; }
        .footer {
            background: #2f3136;
            border-radius: 8px;
            padding: 16px 24px;
            margin-top: 16px;
            text-align: center;
            color: #72767d;
            font-size: 0.85em;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>📋 Ticket #${ticketNum} Transcript</h1>
        <div class="meta">
            <span>🏠 ${guildName}</span>
            <span>📂 ${categoryName}</span>
            <span>👤 <strong>${sanitize(ticket.user_id)}</strong></span>
            <span>📅 ${formatTime(ticket.opened_at)}</span>
            ${ticket.closed_at ? `<span>🔒 ${formatTime(ticket.closed_at)}</span>` : ''}
            <span>💬 ${messages.length} mesaj</span>
        </div>
    </div>
    <div class="messages">
        ${messagesHtml || '<div class="message"><div class="message-content"><div class="text"><em>Bu ticketta mesaj bulunamadı.</em></div></div></div>'}
    </div>
    <div class="footer">
        Ultra Ticket Bot tarafından oluşturuldu • ${formatTime(new Date().toISOString())}
    </div>
</body>
</html>`;

    return html;
}

/**
 * Save transcript to file and return the file path
 */
function saveTranscriptFile(ticket, messages, guild, category) {
    const transcriptDir = path.join(__dirname, '..', '..', 'data', 'transcripts');
    if (!fs.existsSync(transcriptDir)) fs.mkdirSync(transcriptDir, { recursive: true });

    const fileName = `transcript-${ticket.guild_id}-${ticket.ticket_number}-${Date.now()}.html`;
    const filePath = path.join(transcriptDir, fileName);

    const html = generateTranscript(ticket, messages, guild, category);
    fs.writeFileSync(filePath, html, 'utf-8');

    return filePath;
}

module.exports = { generateTranscript, saveTranscriptFile };
