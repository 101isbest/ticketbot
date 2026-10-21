/* ═══════════════════════════════════════════════════════════════
   TicketBot Dashboard — Client App
   ═══════════════════════════════════════════════════════════════ */

const App = {
    state: {
        user: null,
        guilds: [],
        currentGuild: null,
        currentPage: 'overview',
    },

    // ─── Helpers ───
    async api(url, options = {}) {
        try {
            const res = await fetch(url, {
                headers: { 'Content-Type': 'application/json', ...options.headers },
                ...options,
            });
            if (res.status === 401) {
                this.showLanding();
                return null;
            }
            return await res.json();
        } catch (err) {
            console.error('API Error:', err);
            this.toast('API hatası oluştu', 'error');
            return null;
        }
    },

    toast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const icons = { success: '✅', error: '❌', info: 'ℹ️' };
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    formatDate(dateStr) {
        if (!dateStr) return '-';
        const d = new Date(dateStr);
        return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    },

    // ─── Initialization ───
    async init() {
        // Check auth
        const user = await this.api('/api/user');
        if (!user || user.error) {
            this.showLanding();
            return;
        }
        this.state.user = user;

        // Load guilds
        const guilds = await this.api('/api/guilds');
        this.state.guilds = guilds || [];

        this.showDashboard();
        this.renderUser();
        this.renderGuildSelector();
        this.bindEvents();
    },

    showLanding() {
        document.getElementById('landing-page').classList.add('active');
        document.getElementById('dashboard-page').classList.remove('active');
    },

    showDashboard() {
        document.getElementById('landing-page').classList.remove('active');
        document.getElementById('dashboard-page').classList.add('active');
    },

    // ─── Render User ───
    renderUser() {
        const { user } = this.state;
        document.getElementById('user-avatar').src = user.avatar;
        document.getElementById('user-name').textContent = user.displayName || user.username;
    },

    // ─── Guild Selector ───
    renderGuildSelector() {
        const dropdown = document.getElementById('guild-dropdown');
        dropdown.innerHTML = '';

        if (this.state.guilds.length === 0) {
            dropdown.innerHTML = '<div class="guild-option"><span class="guild-option-name" style="color:var(--text-tertiary)">Yetkiniz olan sunucu bulunamadı</span></div>';
            return;
        }

        this.state.guilds.forEach(g => {
            const opt = document.createElement('div');
            opt.className = 'guild-option';
            opt.innerHTML = `
                <div class="guild-option-avatar">
                    ${g.icon ? `<img src="${g.icon}" alt="">` : g.name.charAt(0)}
                </div>
                <span class="guild-option-name">${g.name}</span>
            `;
            opt.addEventListener('click', () => this.selectGuild(g));
            dropdown.appendChild(opt);
        });
    },

    async selectGuild(guild) {
        this.state.currentGuild = guild;

        // Update UI
        const avatar = document.getElementById('guild-avatar');
        avatar.innerHTML = guild.icon ? `<img src="${guild.icon}" alt="">` : guild.name.charAt(0);
        document.getElementById('guild-name').textContent = guild.name;
        document.getElementById('guild-members').textContent = `${guild.memberCount} üye`;

        // Close dropdown
        document.getElementById('guild-selector').classList.remove('open');

        // Navigate to overview
        this.navigateTo('overview');
    },

    // ─── Navigation ───
    navigateTo(page) {
        if (!this.state.currentGuild && page !== 'select-guild') {
            document.querySelectorAll('.content-page').forEach(p => p.classList.remove('active'));
            document.getElementById('page-select-guild').classList.add('active');
            return;
        }

        this.state.currentPage = page;

        // Update nav active state
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (navItem) navItem.classList.add('active');

        // Show page
        document.querySelectorAll('.content-page').forEach(p => p.classList.remove('active'));
        const pageEl = document.getElementById(`page-${page}`);
        if (pageEl) pageEl.classList.add('active');

        // Load data
        this.loadPageData(page);

        // Close mobile sidebar
        document.getElementById('sidebar').classList.remove('open');
        document.querySelector('.sidebar-overlay')?.classList.remove('active');
    },

    async loadPageData(page) {
        const guildId = this.state.currentGuild?.id;
        if (!guildId) return;

        switch (page) {
            case 'overview': return this.loadOverview(guildId);
            case 'tickets': return this.loadTickets(guildId);
            case 'categories': return this.loadCategories(guildId);
            case 'panels': return this.loadPanels(guildId);
            case 'roles': return this.loadRoles(guildId);
            case 'settings': return this.loadSettings(guildId);
            case 'logs': return this.loadLogs(guildId);
            case 'blacklist': return this.loadBlacklist(guildId);
        }
    },

    // ═══════════ PAGE LOADERS ═══════════

    async loadOverview(guildId) {
        const data = await this.api(`/api/guilds/${guildId}/overview`);
        if (!data) return;

        const { stats } = data;
        const grid = document.getElementById('stats-grid');
        grid.innerHTML = `
            <div class="stat-card">
                <div class="stat-icon">🎫</div>
                <div class="stat-value">${stats.totalTickets}</div>
                <div class="stat-label">Toplam Ticket</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">🟢</div>
                <div class="stat-value">${stats.openTickets}</div>
                <div class="stat-label">Açık Ticket</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">🔒</div>
                <div class="stat-value">${stats.closedTickets}</div>
                <div class="stat-label">Kapatılmış</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📅</div>
                <div class="stat-value">${stats.todayTickets}</div>
                <div class="stat-label">Bugün</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📊</div>
                <div class="stat-value">${stats.weekTickets}</div>
                <div class="stat-label">Bu Hafta</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">⭐</div>
                <div class="stat-value">${stats.avgRating ? stats.avgRating.toFixed(1) : '-'}</div>
                <div class="stat-label">Ort. Puan</div>
            </div>
        `;

        // Category breakdown
        const catBreakdown = document.getElementById('category-breakdown');
        if (stats.categoryBreakdown && stats.categoryBreakdown.length > 0) {
            const max = Math.max(...stats.categoryBreakdown.map(c => c.count));
            catBreakdown.innerHTML = stats.categoryBreakdown.map(c => `
                <div class="bar-chart-item">
                    <span class="bar-chart-label">${c.name}</span>
                    <div class="bar-chart-track">
                        <div class="bar-chart-fill" style="width: ${(c.count / max * 100)}%"></div>
                    </div>
                    <span class="bar-chart-value">${c.count}</span>
                </div>
            `).join('');
        } else {
            catBreakdown.innerHTML = '<div class="empty-mini">Henüz veri yok</div>';
        }

        // Top staff
        const topStaff = document.getElementById('top-staff');
        if (stats.topStaff && stats.topStaff.length > 0) {
            const rankClasses = ['gold', 'silver', 'bronze'];
            topStaff.innerHTML = stats.topStaff.map((s, i) => `
                <div class="staff-item">
                    <div class="staff-rank ${rankClasses[i] || ''}">${i + 1}</div>
                    <span class="staff-name">${s.claimed_by}</span>
                    <span class="staff-count">${s.count} ticket</span>
                </div>
            `).join('');
        } else {
            topStaff.innerHTML = '<div class="empty-mini">Henüz veri yok</div>';
        }
    },

    async loadTickets(guildId) {
        const tickets = await this.api(`/api/guilds/${guildId}/tickets`);
        const categories = await this.api(`/api/guilds/${guildId}/categories`);
        const tbody = document.getElementById('tickets-tbody');

        if (!tickets || tickets.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty-cell">Açık ticket bulunmuyor 🎉</td></tr>';
            return;
        }

        const catMap = {};
        if (categories) categories.forEach(c => catMap[c.id] = c);

        tbody.innerHTML = tickets.map(t => {
            const cat = catMap[t.category_id];
            return `
                <tr>
                    <td><strong>#${t.ticket_number}</strong></td>
                    <td>${t.user_id}</td>
                    <td>${cat ? `${cat.emoji} ${cat.name}` : '-'}</td>
                    <td><span class="priority-badge priority-${t.priority}">${t.priority}</span></td>
                    <td><span class="status-badge status-${t.status}"><span class="status-dot"></span>${t.status === 'open' ? 'Açık' : 'Kapalı'}</span></td>
                    <td>${this.formatDate(t.opened_at)}</td>
                </tr>
            `;
        }).join('');
    },

    async loadCategories(guildId) {
        const categories = await this.api(`/api/guilds/${guildId}/categories`);
        const list = document.getElementById('categories-list');

        if (!categories || categories.length === 0) {
            list.innerHTML = '<div class="empty-mini" style="grid-column:1/-1">Henüz kategori oluşturulmamış</div>';
            return;
        }

        list.innerHTML = categories.map(c => `
            <div class="item-card">
                <div class="item-card-header">
                    <div class="item-card-icon" style="background: ${c.color}22; color: ${c.color}">${c.emoji}</div>
                    <div>
                        <div class="item-card-title">${c.name}</div>
                        <div class="item-card-subtitle">${c.channel_name_format}</div>
                    </div>
                    <span class="item-card-badge ${c.is_active ? 'badge-active' : 'badge-inactive'}" style="margin-left:auto">
                        ${c.is_active ? '● Aktif' : '● Devre Dışı'}
                    </span>
                </div>
                <div class="item-card-body">${c.description || 'Açıklama yok'}</div>
                <div class="item-card-actions">
                    <button class="btn btn-sm btn-ghost" onclick="App.editCategory('${c.id}')">✏️ Düzenle</button>
                    <button class="btn btn-sm btn-ghost" onclick="App.toggleCategory('${c.id}', ${c.is_active})">${c.is_active ? '⏸️ Devre Dışı' : '▶️ Aktifleştir'}</button>
                    <button class="btn btn-sm btn-danger" onclick="App.deleteCategory('${c.id}')">🗑️ Sil</button>
                </div>
            </div>
        `).join('');
    },

    async loadPanels(guildId) {
        const panels = await this.api(`/api/guilds/${guildId}/panels`);
        const list = document.getElementById('panels-list');

        if (!panels || panels.length === 0) {
            list.innerHTML = '<div class="empty-mini" style="grid-column:1/-1">Henüz panel oluşturulmamış</div>';
            return;
        }

        list.innerHTML = panels.map(p => `
            <div class="item-card">
                <div class="item-card-header">
                    <div class="item-card-icon" style="background: var(--accent-subtle); color: var(--accent)">📋</div>
                    <div>
                        <div class="item-card-title">${p.name}</div>
                        <div class="item-card-subtitle">${p.channel_id ? `Kanal: ${p.channel_id}` : 'Kanal atanmamış'}</div>
                    </div>
                    <span class="item-card-badge ${p.is_active ? 'badge-active' : 'badge-inactive'}" style="margin-left:auto">
                        ${p.is_active ? '● Aktif' : '● Devre Dışı'}
                    </span>
                </div>
                <div class="item-card-actions">
                    <button class="btn btn-sm btn-ghost" onclick="App.editPanel('${p.id}')">✏️ Düzenle</button>
                    <button class="btn btn-sm btn-danger" onclick="App.deletePanel('${p.id}')">🗑️ Sil</button>
                </div>
            </div>
        `).join('');
    },

    async loadRoles(guildId) {
        const data = await this.api(`/api/guilds/${guildId}/roles`);
        if (!data) return;

        const { staffRoles, adminRoles, allRoles } = data;

        // Render staff roles
        const staffList = document.getElementById('staff-roles-list');
        staffList.innerHTML = staffRoles.length > 0
            ? staffRoles.map(rid => {
                const role = allRoles.find(r => r.id === rid);
                return `<span class="role-tag" style="border-color: ${role?.color || 'var(--border)'}">
                    ${role?.name || rid}
                    <button class="remove-role" onclick="App.removeRole('staff', '${rid}')">&times;</button>
                </span>`;
            }).join('')
            : '<div class="empty-mini">Yetkili rolü eklenmemiş</div>';

        // Render admin roles
        const adminList = document.getElementById('admin-roles-list');
        adminList.innerHTML = adminRoles.length > 0
            ? adminRoles.map(rid => {
                const role = allRoles.find(r => r.id === rid);
                return `<span class="role-tag" style="border-color: ${role?.color || 'var(--border)'}">
                    ${role?.name || rid}
                    <button class="remove-role" onclick="App.removeRole('admin', '${rid}')">&times;</button>
                </span>`;
            }).join('')
            : '<div class="empty-mini">Yönetici rolü eklenmemiş</div>';

        // Populate selects
        const staffSelect = document.getElementById('staff-role-select');
        const adminSelect = document.getElementById('admin-role-select');

        const optionsHtml = '<option value="">Rol seçin...</option>' +
            allRoles.map(r => `<option value="${r.id}">${r.name}</option>`).join('');

        staffSelect.innerHTML = optionsHtml;
        adminSelect.innerHTML = optionsHtml;
    },

    async loadSettings(guildId) {
        const settings = await this.api(`/api/guilds/${guildId}/settings`);
        if (!settings) return;

        const settingsConfig = [
            { key: 'staff_notification', name: 'Yetkili Bildirimi', desc: 'Yeni ticket açıldığında yetkililere bildirim gönder', type: 'toggle' },
            { key: 'close_confirmation', name: 'Kapatma Onayı', desc: 'Ticket kapatılırken onay iste', type: 'toggle' },
            { key: 'close_reason_required', name: 'Kapatma Nedeni Zorunlu', desc: 'Ticket kapatılırken neden isteme', type: 'toggle' },
            { key: 'claim_required', name: 'Üstlenme Zorunlu', desc: 'Ticket cevaplamadan önce üstlenme zorunlu', type: 'toggle' },
            { key: 'priority_system', name: 'Öncelik Sistemi', desc: 'Ticket öncelik seviyesi aktif', type: 'toggle' },
            { key: 'tag_system', name: 'Etiket Sistemi', desc: 'Ticket etiketleme sistemi', type: 'toggle' },
            { key: 'user_rating', name: 'Kullanıcı Değerlendirme', desc: 'Ticket kapatıldıktan sonra kullanıcıdan puan iste', type: 'toggle' },
            { key: 'transcript_dm', name: 'Transcript DM', desc: 'Transcript dosyasını kullanıcıya DM ile gönder', type: 'toggle' },
            { key: 'allow_category_change', name: 'Kategori Değiştirme', desc: 'Ticket kategorisi değiştirilebilsin', type: 'toggle' },
            { key: 'max_tickets_per_user', name: 'Maks. Ticket (Kullanıcı)', desc: 'Kullanıcı başına açılabilecek maksimum ticket', type: 'number' },
            { key: 'max_added_users', name: 'Maks. Eklenen Kullanıcı', desc: 'Bir ticket\'a eklenebilecek maksimum kullanıcı', type: 'number' },
            { key: 'reopen_timeout_hours', name: 'Yeniden Açma Süresi (Saat)', desc: 'Kapatılan ticket yeniden açılabilme süresi', type: 'number' },
            { key: 'auto_close_hours', name: 'Otomatik Kapatma (Saat)', desc: 'İnaktif ticket otomatik kapatma süresi (0=devre dışı)', type: 'number' },
            { key: 'auto_delete_hours', name: 'Otomatik Silme (Saat)', desc: 'Kapatılan ticket otomatik silme süresi (0=devre dışı)', type: 'number' },
        ];

        const container = document.getElementById('settings-list');
        container.innerHTML = settingsConfig.map(s => {
            const val = settings[s.key] || '0';
            if (s.type === 'toggle') {
                return `
                    <div class="setting-row">
                        <div class="setting-info">
                            <div class="setting-name">${s.name}</div>
                            <div class="setting-desc">${s.desc}</div>
                        </div>
                        <div class="setting-control">
                            <div class="toggle ${val === '1' ? 'active' : ''}" onclick="App.toggleSetting('${s.key}', '${val}')"></div>
                        </div>
                    </div>
                `;
            } else {
                return `
                    <div class="setting-row">
                        <div class="setting-info">
                            <div class="setting-name">${s.name}</div>
                            <div class="setting-desc">${s.desc}</div>
                        </div>
                        <div class="setting-control">
                            <input type="number" class="form-input" value="${val}" style="width:80px;text-align:center"
                                onchange="App.saveSetting('${s.key}', this.value)">
                        </div>
                    </div>
                `;
            }
        }).join('');
    },

    async loadLogs(guildId) {
        const data = await this.api(`/api/guilds/${guildId}/logs`);
        if (!data) return;

        const { logChannels, channels } = data;

        const logTypes = [
            { key: 'ticket_open', name: '🎫 Ticket Açılması' },
            { key: 'ticket_close', name: '🔒 Ticket Kapatılması' },
            { key: 'ticket_delete', name: '🗑️ Ticket Silinmesi' },
            { key: 'ticket_reopen', name: '🔓 Ticket Yeniden Açılması' },
            { key: 'ticket_claim', name: '✋ Ticket Üstlenme' },
            { key: 'ticket_unclaim', name: '👋 Ticket Bırakma' },
            { key: 'user_add', name: '➕ Kullanıcı Ekleme' },
            { key: 'user_remove', name: '➖ Kullanıcı Çıkarma' },
            { key: 'priority_change', name: '📌 Öncelik Değişikliği' },
            { key: 'transcript_create', name: '📄 Transcript Oluşturma' },
        ];

        const channelOpts = '<option value="">Kanal Seçin...</option>' +
            channels.map(c => `<option value="${c.id}">#${c.name}</option>`).join('');

        const container = document.getElementById('logs-list');
        container.innerHTML = logTypes.map(lt => {
            const currentChannel = logChannels[lt.key] || '';
            return `
                <div class="log-row">
                    <span class="log-type">${lt.name}</span>
                    <span class="log-channel">${currentChannel ? `#${channels.find(c => c.id === currentChannel)?.name || currentChannel}` : 'Ayarlanmamış'}</span>
                    <select class="select-input" style="width:200px" onchange="App.saveLog('${lt.key}', this.value)">
                        ${channelOpts.replace(`value="${currentChannel}"`, `value="${currentChannel}" selected`)}
                    </select>
                </div>
            `;
        }).join('');
    },

    async loadBlacklist(guildId) {
        const list = await this.api(`/api/guilds/${guildId}/blacklist`);
        const tbody = document.getElementById('blacklist-tbody');

        if (!list || list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="empty-cell">Kara liste boş</td></tr>';
            return;
        }

        tbody.innerHTML = list.map(b => `
            <tr>
                <td><span class="priority-badge priority-${b.target_type === 'user' ? 'normal' : 'high'}">${b.target_type === 'user' ? '👤 Kullanıcı' : '🏷️ Rol'}</span></td>
                <td><code>${b.target_id}</code></td>
                <td>${b.reason || '-'}</td>
                <td>${this.formatDate(b.added_at)}</td>
                <td><button class="btn btn-sm btn-danger" onclick="App.removeBlacklist('${b.target_type}', '${b.target_id}')">Kaldır</button></td>
            </tr>
        `).join('');
    },

    // ═══════════ ACTIONS ═══════════

    async toggleSetting(key, currentVal) {
        const newVal = currentVal === '1' ? '0' : '1';
        await this.api(`/api/guilds/${this.state.currentGuild.id}/settings`, {
            method: 'PUT',
            body: JSON.stringify({ key, value: newVal }),
        });
        this.toast('Ayar güncellendi', 'success');
        this.loadSettings(this.state.currentGuild.id);
    },

    async saveSetting(key, value) {
        await this.api(`/api/guilds/${this.state.currentGuild.id}/settings`, {
            method: 'PUT',
            body: JSON.stringify({ key, value }),
        });
        this.toast('Ayar kaydedildi', 'success');
    },

    async saveLog(logType, channelId) {
        await this.api(`/api/guilds/${this.state.currentGuild.id}/logs`, {
            method: 'PUT',
            body: JSON.stringify({ logType, channelId }),
        });
        this.toast('Log kanalı güncellendi', 'success');
    },

    async addRole(type) {
        const select = document.getElementById(`${type}-role-select`);
        const roleId = select.value;
        if (!roleId) return this.toast('Lütfen bir rol seçin', 'error');

        await this.api(`/api/guilds/${this.state.currentGuild.id}/roles/${type}`, {
            method: 'POST',
            body: JSON.stringify({ roleId }),
        });
        this.toast('Rol eklendi', 'success');
        this.loadRoles(this.state.currentGuild.id);
    },

    async removeRole(type, roleId) {
        await this.api(`/api/guilds/${this.state.currentGuild.id}/roles/${type}/${roleId}`, {
            method: 'DELETE',
        });
        this.toast('Rol kaldırıldı', 'success');
        this.loadRoles(this.state.currentGuild.id);
    },

    async toggleCategory(catId, isActive) {
        await this.api(`/api/guilds/${this.state.currentGuild.id}/categories/${catId}`, {
            method: 'PUT',
            body: JSON.stringify({ is_active: isActive ? 0 : 1 }),
        });
        this.toast('Kategori durumu güncellendi', 'success');
        this.loadCategories(this.state.currentGuild.id);
    },

    async deleteCategory(catId) {
        if (!confirm('Bu kategoriyi silmek istediğinize emin misiniz?')) return;
        await this.api(`/api/guilds/${this.state.currentGuild.id}/categories/${catId}`, {
            method: 'DELETE',
        });
        this.toast('Kategori silindi', 'success');
        this.loadCategories(this.state.currentGuild.id);
    },

    async deletePanel(panelId) {
        if (!confirm('Bu paneli silmek istediğinize emin misiniz?')) return;
        await this.api(`/api/guilds/${this.state.currentGuild.id}/panels/${panelId}`, {
            method: 'DELETE',
        });
        this.toast('Panel silindi', 'success');
        this.loadPanels(this.state.currentGuild.id);
    },

    async removeBlacklist(targetType, targetId) {
        await this.api(`/api/guilds/${this.state.currentGuild.id}/blacklist/${targetType}/${targetId}`, {
            method: 'DELETE',
        });
        this.toast('Kara listeden kaldırıldı', 'success');
        this.loadBlacklist(this.state.currentGuild.id);
    },

    // ═══════════ MODALS ═══════════

    showModal(title, bodyHtml, onConfirm) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = bodyHtml;
        document.getElementById('modal-overlay').classList.add('active');

        const confirmBtn = document.getElementById('modal-confirm');
        const newBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
        newBtn.id = 'modal-confirm';
        newBtn.addEventListener('click', () => {
            onConfirm();
            this.closeModal();
        });
    },

    closeModal() {
        document.getElementById('modal-overlay').classList.remove('active');
    },

    showAddCategory() {
        this.showModal('Yeni Kategori', `
            <div class="form-group">
                <label class="form-label">Kategori Adı</label>
                <input type="text" class="form-input" id="modal-cat-name" placeholder="Örn: Destek Talebi">
            </div>
            <div class="form-group">
                <label class="form-label">Emoji</label>
                <input type="text" class="form-input" id="modal-cat-emoji" placeholder="🎫" value="🎫">
            </div>
            <div class="form-group">
                <label class="form-label">Buton Metni</label>
                <input type="text" class="form-input" id="modal-cat-button" placeholder="Talep Aç">
            </div>
            <div class="form-group">
                <label class="form-label">Açıklama</label>
                <textarea class="form-input" id="modal-cat-desc" placeholder="Kategori açıklaması..."></textarea>
            </div>
            <div class="form-group">
                <label class="form-label">Kanal Format</label>
                <input type="text" class="form-input" id="modal-cat-format" value="ticket-{number}">
            </div>
            <div class="form-group">
                <label class="form-label">Renk (HEX)</label>
                <input type="color" class="form-input" id="modal-cat-color" value="#5865F2" style="height:44px;padding:4px">
            </div>
        `, async () => {
            const name = document.getElementById('modal-cat-name').value;
            if (!name) return this.toast('Kategori adı gerekli', 'error');
            await this.api(`/api/guilds/${this.state.currentGuild.id}/categories`, {
                method: 'POST',
                body: JSON.stringify({
                    name,
                    emoji: document.getElementById('modal-cat-emoji').value || '🎫',
                    button_label: document.getElementById('modal-cat-button').value || name,
                    description: document.getElementById('modal-cat-desc').value,
                    channel_name_format: document.getElementById('modal-cat-format').value || 'ticket-{number}',
                    color: document.getElementById('modal-cat-color').value,
                }),
            });
            this.toast('Kategori oluşturuldu', 'success');
            this.loadCategories(this.state.currentGuild.id);
        });
    },

    async editCategory(catId) {
        const cats = await this.api(`/api/guilds/${this.state.currentGuild.id}/categories`);
        const cat = cats?.find(c => c.id === catId);
        if (!cat) return;

        this.showModal('Kategori Düzenle', `
            <div class="form-group">
                <label class="form-label">Kategori Adı</label>
                <input type="text" class="form-input" id="modal-cat-name" value="${cat.name}">
            </div>
            <div class="form-group">
                <label class="form-label">Emoji</label>
                <input type="text" class="form-input" id="modal-cat-emoji" value="${cat.emoji}">
            </div>
            <div class="form-group">
                <label class="form-label">Buton Metni</label>
                <input type="text" class="form-input" id="modal-cat-button" value="${cat.button_label}">
            </div>
            <div class="form-group">
                <label class="form-label">Açıklama</label>
                <textarea class="form-input" id="modal-cat-desc">${cat.description || ''}</textarea>
            </div>
            <div class="form-group">
                <label class="form-label">Kanal Format</label>
                <input type="text" class="form-input" id="modal-cat-format" value="${cat.channel_name_format}">
            </div>
            <div class="form-group">
                <label class="form-label">Renk (HEX)</label>
                <input type="color" class="form-input" id="modal-cat-color" value="${cat.color || '#5865F2'}" style="height:44px;padding:4px">
            </div>
        `, async () => {
            await this.api(`/api/guilds/${this.state.currentGuild.id}/categories/${catId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    name: document.getElementById('modal-cat-name').value,
                    emoji: document.getElementById('modal-cat-emoji').value,
                    button_label: document.getElementById('modal-cat-button').value,
                    description: document.getElementById('modal-cat-desc').value,
                    channel_name_format: document.getElementById('modal-cat-format').value,
                    color: document.getElementById('modal-cat-color').value,
                }),
            });
            this.toast('Kategori güncellendi', 'success');
            this.loadCategories(this.state.currentGuild.id);
        });
    },

    showAddPanel() {
        this.showModal('Yeni Panel', `
            <div class="form-group">
                <label class="form-label">Panel Adı</label>
                <input type="text" class="form-input" id="modal-panel-name" placeholder="Örn: Ana Destek Paneli">
            </div>
        `, async () => {
            const name = document.getElementById('modal-panel-name').value;
            if (!name) return this.toast('Panel adı gerekli', 'error');
            await this.api(`/api/guilds/${this.state.currentGuild.id}/panels`, {
                method: 'POST',
                body: JSON.stringify({ name }),
            });
            this.toast('Panel oluşturuldu', 'success');
            this.loadPanels(this.state.currentGuild.id);
        });
    },

    async editPanel(panelId) {
        const panels = await this.api(`/api/guilds/${this.state.currentGuild.id}/panels`);
        const panel = panels?.find(p => p.id === panelId);
        if (!panel) return;

        const channels = await this.api(`/api/guilds/${this.state.currentGuild.id}/channels`);
        const textChannels = channels?.filter(c => c.type === 0) || [];
        const channelOpts = textChannels.map(c => `<option value="${c.id}" ${c.id === panel.channel_id ? 'selected' : ''}>#${c.name}</option>`).join('');

        this.showModal('Panel Düzenle', `
            <div class="form-group">
                <label class="form-label">Panel Adı</label>
                <input type="text" class="form-input" id="modal-panel-name" value="${panel.name}">
            </div>
            <div class="form-group">
                <label class="form-label">Gönderim Kanalı</label>
                <select class="select-input" id="modal-panel-channel">
                    <option value="">Kanal seçin...</option>
                    ${channelOpts}
                </select>
            </div>
        `, async () => {
            await this.api(`/api/guilds/${this.state.currentGuild.id}/panels/${panelId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    name: document.getElementById('modal-panel-name').value,
                    channel_id: document.getElementById('modal-panel-channel').value,
                }),
            });
            this.toast('Panel güncellendi', 'success');
            this.loadPanels(this.state.currentGuild.id);
        });
    },

    showAddBlacklist() {
        this.showModal('Kara Listeye Ekle', `
            <div class="form-group">
                <label class="form-label">Tür</label>
                <select class="select-input" id="modal-bl-type">
                    <option value="user">Kullanıcı</option>
                    <option value="role">Rol</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">ID</label>
                <input type="text" class="form-input" id="modal-bl-id" placeholder="Kullanıcı veya Rol ID">
            </div>
            <div class="form-group">
                <label class="form-label">Neden</label>
                <textarea class="form-input" id="modal-bl-reason" placeholder="Engelleme nedeni..."></textarea>
            </div>
        `, async () => {
            const targetId = document.getElementById('modal-bl-id').value;
            if (!targetId) return this.toast('ID gerekli', 'error');
            await this.api(`/api/guilds/${this.state.currentGuild.id}/blacklist`, {
                method: 'POST',
                body: JSON.stringify({
                    targetType: document.getElementById('modal-bl-type').value,
                    targetId,
                    reason: document.getElementById('modal-bl-reason').value,
                }),
            });
            this.toast('Kara listeye eklendi', 'success');
            this.loadBlacklist(this.state.currentGuild.id);
        });
    },

    // ═══════════ EVENT BINDING ═══════════

    bindEvents() {
        // Guild dropdown toggle
        document.getElementById('guild-current').addEventListener('click', () => {
            document.getElementById('guild-selector').classList.toggle('open');
        });

        // Close dropdown on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.guild-selector')) {
                document.getElementById('guild-selector').classList.remove('open');
            }
        });

        // Nav items
        document.querySelectorAll('.nav-item[data-page]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                this.navigateTo(item.dataset.page);
            });
        });

        // Mobile menu
        document.getElementById('mobile-menu-btn').addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
            let overlay = document.querySelector('.sidebar-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'sidebar-overlay';
                overlay.addEventListener('click', () => {
                    document.getElementById('sidebar').classList.remove('open');
                    overlay.classList.remove('active');
                });
                document.body.appendChild(overlay);
            }
            overlay.classList.toggle('active');
        });

        // Modal close
        document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
        document.getElementById('modal-cancel').addEventListener('click', () => this.closeModal());
        document.getElementById('modal-overlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeModal();
        });

        // Action buttons
        document.getElementById('btn-add-category').addEventListener('click', () => this.showAddCategory());
        document.getElementById('btn-add-panel').addEventListener('click', () => this.showAddPanel());
        document.getElementById('btn-add-blacklist').addEventListener('click', () => this.showAddBlacklist());
        document.getElementById('btn-add-staff-role').addEventListener('click', () => this.addRole('staff'));
        document.getElementById('btn-add-admin-role').addEventListener('click', () => this.addRole('admin'));
    },
};

// ─── Boot ───
document.addEventListener('DOMContentLoaded', () => App.init());
