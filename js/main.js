/**
 * main.js — Navigation, Bio, Forms, Toasts, Global helpers
 * 3EAS SYSTEM
 */

class SiteController {
    constructor() {
        this._initNav();
        this._initBio();
        this._initForms();
        this._initVisualTabs();
        this._loadBio();
    }

    /* ═══════════════════════════════════════════
       NAVIGATION
    ═══════════════════════════════════════════ */

    _initNav() {
        const toggle = document.getElementById('mobile-toggle');
        const overlay = document.getElementById('mobile-nav-overlay');
        const closeBtn = document.getElementById('mobile-nav-close');

        if (toggle) {
            toggle.addEventListener('click', () => {
                overlay.classList.toggle('open');
                document.body.style.overflow = overlay.classList.contains('open') ? 'hidden' : '';
            });
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => this._closeMobileNav());
        }

        // Close overlay when a link is tapped
        document.querySelectorAll('.mobile-nav-link').forEach(link => {
            link.addEventListener('click', () => this._closeMobileNav());
        });

        // Close on backdrop click
        if (overlay) {
            overlay.addEventListener('click', e => {
                if (e.target === overlay) this._closeMobileNav();
            });
        }

        // Active link on scroll
        window.addEventListener('scroll', () => this._updateActiveNav(), { passive: true });
        this._updateActiveNav();
    }

    _closeMobileNav() {
        const overlay = document.getElementById('mobile-nav-overlay');
        if (overlay) overlay.classList.remove('open');
        document.body.style.overflow = '';
    }

    _updateActiveNav() {
        const sections = ['transmissions', 'visuals', 'acquisitions', 'signal', 'access'];
        let current = '';
        const scrollY = window.scrollY + 100;

        sections.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.offsetTop <= scrollY) current = id;
        });

        document.querySelectorAll('.nav-link').forEach(link => {
            const href = link.getAttribute('href');
            link.classList.toggle('active', href === '#' + current);
        });
    }

    /* ═══════════════════════════════════════════
       BIO
    ═══════════════════════════════════════════ */

    _loadBio() {
        const bioText = document.getElementById('bio-text');
        if (!bioText) return;
        try {
            const saved = localStorage.getItem('bio');
            if (saved) bioText.innerHTML = saved;
        } catch (e) { /* pass */ }
    }

    _initBio() {
        const saveBioBtn = document.getElementById('save-bio-btn');
        const bioText = document.getElementById('bio-text');

        if (saveBioBtn && bioText) {
            saveBioBtn.addEventListener('click', () => {
                if (!window.authManager || !authManager.isAdmin()) return;
                try {
                    localStorage.setItem('bio', bioText.innerHTML);
                    window.showToast('Signal saved.', 'success');
                } catch (e) {
                    window.showToast('Save failed.', 'error');
                }
            });
        }
    }

    /* ═══════════════════════════════════════════
       FORMS
    ═══════════════════════════════════════════ */

    _initForms() {
        const newsletterForm = document.getElementById('newsletter-form');
        if (newsletterForm) {
            newsletterForm.addEventListener('submit', e => {
                e.preventDefault();
                const email = document.getElementById('newsletter-email').value.trim();
                if (!this._validEmail(email)) {
                    this._setFormStatus('newsletter-message', 'Invalid email address.', 'error');
                    return;
                }
                try {
                    const subs = JSON.parse(localStorage.getItem('newsletter') || '[]');
                    if (!subs.includes(email)) subs.push(email);
                    localStorage.setItem('newsletter', JSON.stringify(subs));
                } catch (e) { /* pass */ }
                this._setFormStatus('newsletter-message', 'Frequency locked in.', 'success');
                newsletterForm.reset();
            });
        }

        // Contact form is handled by contact-form.js (EmailJS)
    }

    _validEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    _setFormStatus(id, message, type) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = message;
        el.className = `form-status form-status--${type}`;
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 5000);
    }

    /* ═══════════════════════════════════════════
       VISUALS TABS (Photos / Video)
    ═══════════════════════════════════════════ */

    _initVisualTabs() {
        const filters = document.querySelectorAll('[data-visual-filter]');
        const galleryWrap = document.getElementById('galleryGrid');
        const galleryEmpty = document.getElementById('galleryEmpty');
        const videoSection = document.getElementById('video-section');

        filters.forEach(btn => {
            btn.addEventListener('click', () => {
                filters.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const filter = btn.dataset.visualFilter;
                if (filter === 'photos') {
                    if (galleryWrap) galleryWrap.style.display = '';
                    if (galleryEmpty) galleryEmpty.style.display = '';
                    if (videoSection) videoSection.style.display = 'none';
                } else {
                    if (galleryWrap) galleryWrap.style.display = 'none';
                    if (galleryEmpty) galleryEmpty.style.display = 'none';
                    if (videoSection) videoSection.style.display = 'block';
                    // Show video upload controls if admin
                    const videoUpload = document.getElementById('video-upload-controls');
                    if (videoUpload && window.authManager && authManager.isAdmin()) {
                        videoUpload.style.display = 'flex';
                    }
                }
            });
        });
    }
}

/* ═══════════════════════════════════════════
   TOAST SYSTEM
═══════════════════════════════════════════ */
window.showToast = function(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

/* ═══════════════════════════════════════════
   GLOBAL HELPERS
═══════════════════════════════════════════ */
function scrollToSection(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
}

function showLinksEditor() {
    // Future: could open a modal for editing access links
    window.showToast('Links editor coming soon.', 'success');
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    window.siteController = new SiteController();
});

/* Legacy compat */
window.musicWebsite = {
    showNotification: (msg, type) => window.showToast(msg, type),
    updateBioEditableState: () => {}
};
