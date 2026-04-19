/**
 * StripeCheckout
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles the Stripe Payment Link return redirect and purchase persistence.
 * No backend required — uses Stripe's hosted Payment Links with a custom
 * success redirect URL that embeds the track ID and unlock code.
 *
 * ── ADMIN SETUP GUIDE ────────────────────────────────────────────────────────
 *
 *  1. In your site admin, create a track and set an UNLOCK CODE.
 *     The track form will generate a "Stripe Success URL" — copy it.
 *
 *  2. In Stripe Dashboard → Payment Links → Create link:
 *       • Add your product / price
 *       • Confirmation page → ✓ "Don't show confirmation page"
 *       • Redirect URL → paste the generated success URL
 *
 *  3. Copy the Payment Link URL (stripe.com/b/…)
 *     and paste it into the track's PURCHASE URL field.
 *
 *  4. The site now handles the full loop automatically.
 *
 * ── SUCCESS URL FORMAT ────────────────────────────────────────────────────────
 *  https://yoursite.com/?stripe_success=1&tid=trk_abc&code=SECRET123#transmissions
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

class StripeCheckout {
    constructor() {
        this.STORAGE_KEY = 'stripe_purchases';
        this._purchases  = this._loadPurchases();

        // Run return-handler after DOM + other modules are ready
        document.addEventListener('DOMContentLoaded', () => {
            // Small delay to ensure transmissionsManager is instantiated
            setTimeout(() => this._handleReturn(), 100);
        });
    }

    /* ── Storage ──────────────────────────────────────────────── */

    _loadPurchases() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}');
        } catch (e) { return {}; }
    }

    _savePurchases() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this._purchases));
        } catch (e) { console.warn('StripeCheckout: could not persist purchases'); }
    }

    isPurchased(trackId) {
        return !!this._purchases[trackId];
    }

    getPurchase(trackId) {
        return this._purchases[trackId] || null;
    }

    recordPurchase(trackId, code) {
        this._purchases[trackId] = {
            purchasedAt: new Date().toISOString(),
            code,
        };
        this._savePurchases();
    }

    clearPurchase(trackId) {
        delete this._purchases[trackId];
        this._savePurchases();
    }

    getAllPurchases() {
        return { ...this._purchases };
    }

    /* ── Return handler ───────────────────────────────────────── */

    _handleReturn() {
        const params    = new URLSearchParams(window.location.search);
        const isSuccess = params.get('stripe_success') === '1';
        const trackId   = params.get('tid');
        const code      = params.get('code');

        if (!isSuccess || !trackId) return;

        // Strip query params from URL immediately (keeps history clean)
        history.replaceState(null, '', window.location.pathname + '#transmissions');

        this._processReturn(trackId, code);
    }

    _processReturn(trackId, code, attempts = 0) {
        if (!window.transmissionsManager) {
            if (attempts < 40) {
                setTimeout(() => this._processReturn(trackId, code, attempts + 1), 150);
            }
            return;
        }

        const result = transmissionsManager.processStripeReturn(trackId, code);

        if (result.success) {
            this.recordPurchase(trackId, code);
            transmissionsManager.renderCatalog();
            transmissionsManager.showDownloadModal(trackId);
        } else {
            // Payment succeeded but code mismatch — still acknowledge
            window.showToast && showToast(
                'Payment received. Contact us if your download is unavailable.',
                'success'
            );
            console.warn('StripeCheckout: code mismatch for track', trackId);
        }
    }

    /* ── URL builder (called by transmissions.js admin UI) ────── */

    /**
     * Build the success redirect URL to paste into Stripe's Payment Link config.
     * @param {string} trackId
     * @param {string} unlockCode
     * @returns {string}
     */
    static buildSuccessUrl(trackId, unlockCode) {
        const base = window.location.origin + window.location.pathname;
        const url  = new URL(base);
        url.searchParams.set('stripe_success', '1');
        url.searchParams.set('tid', trackId);
        if (unlockCode) url.searchParams.set('code', unlockCode);
        url.hash = 'transmissions';
        return url.toString();
    }
}

/* ── Global instance ─────────────────────────────────────────── */
const stripeCheckout = new StripeCheckout();

/* ── Admin helper: copy Stripe success URL to clipboard ─────── */
function copyStripeUrl() {
    const el = document.getElementById('stripe-success-url-display');
    if (!el || !el.textContent || el.textContent === '—') return;

    navigator.clipboard.writeText(el.textContent).then(() => {
        window.showToast && showToast('Stripe success URL copied.', 'success');
    }).catch(() => {
        // Fallback for older browsers
        const ta = document.createElement('textarea');
        ta.value = el.textContent;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        window.showToast && showToast('Copied.', 'success');
    });
}

/* ── Live-update the Stripe setup panel in the track form ────── */
function updateStripeSetupPanel() {
    const trackId   = document.getElementById('track-id')?.value;
    const code      = document.getElementById('track-unlock-code')?.value?.trim();
    const panel     = document.getElementById('stripe-setup-panel');
    const urlDisplay= document.getElementById('stripe-success-url-display');

    if (!panel || !urlDisplay) return;

    if (trackId && code) {
        const url = StripeCheckout.buildSuccessUrl(trackId, code);
        urlDisplay.textContent = url;
        panel.style.display = 'block';
    } else {
        urlDisplay.textContent = '— (save track with an Unlock Code first) —';
        panel.style.display = trackId ? 'block' : 'none';
    }
}
