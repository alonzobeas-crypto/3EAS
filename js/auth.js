/**
 * AuthManager — Admin authentication + menu visibility control
 */

class AuthManager {
    constructor() {
        this.isAuthenticated = false;
        this.currentUser = null;
        this._initUsers();
        this._initMenuVisibility();
        this.init();
    }

    /* ═══════════════════════════════════════════
       USER STORAGE
    ═══════════════════════════════════════════ */

    _initUsers() {
        const users = localStorage.getItem('adminUsers');
        if (!users) {
            localStorage.setItem('adminUsers', JSON.stringify([
                { username: 'admin', password: 'beas2026', createdAt: new Date().toISOString() }
            ]));
        }
    }

    getUsers() {
        try {
            return JSON.parse(localStorage.getItem('adminUsers')) || [];
        } catch (e) { return []; }
    }

    addUser(username, password) {
        if (!username || !password) return { success: false, message: 'Username and password required' };
        const users = this.getUsers();
        if (users.some(u => u.username === username)) return { success: false, message: 'Username already exists' };
        users.push({ username, password, createdAt: new Date().toISOString() });
        localStorage.setItem('adminUsers', JSON.stringify(users));
        return { success: true, message: 'User added' };
    }

    deleteUser(username) {
        if (username === 'admin') return { success: false, message: 'Cannot delete default admin' };
        const users = this.getUsers();
        const filtered = users.filter(u => u.username !== username);
        if (filtered.length === users.length) return { success: false, message: 'User not found' };
        localStorage.setItem('adminUsers', JSON.stringify(filtered));
        return { success: true, message: 'User deleted' };
    }

    /* ═══════════════════════════════════════════
       MENU VISIBILITY
    ═══════════════════════════════════════════ */

    _initMenuVisibility() {
        // Default: all sections visible
        const defaults = { transmissions: true, visuals: true, acquisitions: true, signal: true, access: true };
        const stored = localStorage.getItem('sectionVisibility');
        this._sectionVisibility = stored ? { ...defaults, ...JSON.parse(stored) } : defaults;
    }

    _saveMenuVisibility() {
        localStorage.setItem('sectionVisibility', JSON.stringify(this._sectionVisibility));
    }

    setSectionVisible(section, visible) {
        this._sectionVisibility[section] = visible;
        this._saveMenuVisibility();
        this._applySectionVisibility();
    }

    _applySectionVisibility() {
        const sections = ['transmissions', 'visuals', 'acquisitions', 'signal', 'access'];
        sections.forEach(section => {
            const visible = this._sectionVisibility[section] !== false;

            // Hide/show section element
            const sectionEl = document.getElementById(section);
            if (sectionEl) sectionEl.style.display = visible ? '' : 'none';

            // Hide/show nav item
            const navItem = document.getElementById('nav-item-' + section);
            if (navItem) navItem.style.display = visible ? '' : 'none';

            // Hide/show mobile nav item
            const mobileItem = document.getElementById('mobile-item-' + section);
            if (mobileItem) mobileItem.style.display = visible ? '' : 'none';
        });
    }

    _syncToggleCheckboxes() {
        document.querySelectorAll('.section-toggle').forEach(checkbox => {
            const section = checkbox.dataset.section;
            checkbox.checked = this._sectionVisibility[section] !== false;

            checkbox.addEventListener('change', () => {
                this.setSectionVisible(section, checkbox.checked);
            });
        });
    }

    /* ═══════════════════════════════════════════
       AUTH
    ═══════════════════════════════════════════ */

    init() {
        const authState = sessionStorage.getItem('isAuthenticated');
        const user = sessionStorage.getItem('currentUser');
        if (authState === 'true' && user) {
            this.isAuthenticated = true;
            this.currentUser = user;
        }

        this.updateUI();
        this._applySectionVisibility();
        this._setupModalBackdropClose();
    }

    _setupModalBackdropClose() {
        document.querySelectorAll('.sys-modal').forEach(modal => {
            modal.addEventListener('click', e => {
                if (e.target === modal) modal.classList.remove('active');
            });
        });
    }

    isAdmin() {
        return this.isAuthenticated;
    }

    isLoggedIn() {
        return this.isAuthenticated;
    }

    login(username, password) {
        const user = this.getUsers().find(u => u.username === username && u.password === password);
        if (user) {
            this.isAuthenticated = true;
            this.currentUser = username;
            sessionStorage.setItem('isAuthenticated', 'true');
            sessionStorage.setItem('currentUser', username);
            this.updateUI();
            this._notifyModules();
            return true;
        }
        return false;
    }

    logout() {
        this.isAuthenticated = false;
        this.currentUser = null;
        sessionStorage.removeItem('isAuthenticated');
        sessionStorage.removeItem('currentUser');
        this.updateUI();
        this._notifyModules();
        window.showToast && window.showToast('Logged out', 'success');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    _notifyModules() {
        if (window.transmissionsManager) transmissionsManager.onAuthChange();
        if (window.galleryManager) galleryManager.renderGallery();
        if (typeof eventsManager !== 'undefined' && eventsManager.renderEvents) eventsManager.renderEvents();
    }

    updateUI() {
        const isAdmin = this.isAuthenticated;

        // Nav buttons
        const adminBtn = document.getElementById('admin-btn');
        const manageBtn = document.getElementById('manage-btn');
        const logoutBtn = document.getElementById('logout-btn');

        if (adminBtn) adminBtn.style.display = isAdmin ? 'none' : 'inline-block';
        if (manageBtn) manageBtn.style.display = isAdmin ? 'inline-block' : 'none';
        if (logoutBtn) logoutBtn.style.display = isAdmin ? 'inline-block' : 'none';

        // Admin bars
        const adminBars = document.querySelectorAll('.admin-bar');
        adminBars.forEach(bar => { bar.style.display = isAdmin ? 'flex' : 'none'; });

        // Bio editing
        const bioText = document.getElementById('bio-text');
        const saveBioBtn = document.getElementById('save-bio-btn');
        if (bioText) {
            bioText.contentEditable = isAdmin ? 'true' : 'false';
        }
        if (saveBioBtn) saveBioBtn.style.display = isAdmin ? 'inline-block' : 'none';

        // Gallery upload controls
        const galleryUpload = document.getElementById('gallery-upload-controls');
        if (galleryUpload) galleryUpload.style.display = isAdmin ? 'flex' : 'none';
    }

    /* ═══════════════════════════════════════════
       LOGIN MODAL
    ═══════════════════════════════════════════ */

    showLoginModal() {
        const modal = document.getElementById('admin-login-modal');
        if (!modal) return;
        modal.classList.add('active');
        document.getElementById('admin-username').value = '';
        document.getElementById('admin-password').value = '';
        setTimeout(() => document.getElementById('admin-username').focus(), 100);
    }

    hideLoginModal() {
        const modal = document.getElementById('admin-login-modal');
        if (modal) modal.classList.remove('active');
    }

    handleLoginSubmit(event) {
        event.preventDefault();
        const username = document.getElementById('admin-username').value;
        const password = document.getElementById('admin-password').value;
        const errorEl = document.getElementById('login-error');

        if (this.login(username, password)) {
            this.hideLoginModal();
            window.showToast && window.showToast(`Welcome, ${this.currentUser}`, 'success');
        } else {
            if (errorEl) { errorEl.textContent = 'Invalid credentials'; errorEl.style.display = 'block'; }
            const form = document.getElementById('admin-login-form');
            if (form) {
                form.style.animation = 'shake 0.4s';
                setTimeout(() => { form.style.animation = ''; }, 400);
            }
        }
    }

    /* ═══════════════════════════════════════════
       ADMIN PANEL MODAL
    ═══════════════════════════════════════════ */

    showAdminPanel() {
        const modal = document.getElementById('admin-panel-modal');
        if (!modal) return;

        // Reset to first tab
        document.querySelectorAll('.panel-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
        document.getElementById('panel-menu').style.display = 'block';
        document.getElementById('panel-users').style.display = 'none';

        this._syncToggleCheckboxes();
        this._refreshUserList();
        modal.classList.add('active');
    }

    hideAdminPanel() {
        const modal = document.getElementById('admin-panel-modal');
        if (modal) modal.classList.remove('active');
    }

    /* ═══════════════════════════════════════════
       USER MANAGEMENT
    ═══════════════════════════════════════════ */

    _refreshUserList() {
        const list = document.getElementById('user-list');
        if (!list) return;
        const users = this.getUsers();
        list.innerHTML = users.map(u => `
            <div class="user-item">
                <div class="user-info">
                    <span class="user-username">${u.username}</span>
                    <span class="user-date mono-label">Created: ${new Date(u.createdAt).toLocaleDateString()}</span>
                </div>
                <button class="btn-delete-user"
                    onclick="authManager._confirmDeleteUser('${u.username}')"
                    ${u.username === 'admin' ? 'disabled title="Cannot delete default admin"' : ''}>
                    DELETE
                </button>
            </div>
        `).join('');
    }

    handleAddUserSubmit(event) {
        event.preventDefault();
        const username = document.getElementById('new-username').value.trim();
        const password = document.getElementById('new-password').value;
        const confirm  = document.getElementById('confirm-password').value;
        const errorEl  = document.getElementById('add-user-error');
        const successEl= document.getElementById('add-user-success');

        errorEl.style.display = 'none';
        successEl.style.display = 'none';

        if (password !== confirm) {
            errorEl.textContent = 'Passwords do not match'; errorEl.style.display = 'block'; return;
        }
        if (password.length < 6) {
            errorEl.textContent = 'Password must be 6+ characters'; errorEl.style.display = 'block'; return;
        }

        const result = this.addUser(username, password);
        if (result.success) {
            successEl.textContent = result.message; successEl.style.display = 'block';
            document.getElementById('new-username').value = '';
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-password').value = '';
            this._refreshUserList();
            setTimeout(() => { successEl.style.display = 'none'; }, 3000);
        } else {
            errorEl.textContent = result.message; errorEl.style.display = 'block';
        }
    }

    _confirmDeleteUser(username) {
        if (!confirm(`Delete user "${username}"?`)) return;
        const result = this.deleteUser(username);
        if (result.success) {
            this._refreshUserList();
            window.showToast && window.showToast(result.message, 'success');
        } else {
            alert(result.message);
        }
    }

    /* Legacy compat */
    showUserManagementModal() { this.showAdminPanel(); }
    hideUserManagementModal() { this.hideAdminPanel(); }
    confirmDeleteUser(username) { this._confirmDeleteUser(username); }
}

const authManager = new AuthManager();
