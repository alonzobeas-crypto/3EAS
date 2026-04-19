/**
 * TransmissionsManager
 * Manages the audio catalog — releases, mixes, exclusive content.
 * Handles track CRUD, preview playback, filtering, and Stripe purchase flow.
 */

class TransmissionsManager {
    constructor() {
        this.tracks        = [];
        this.currentFilter = 'all';
        this.currentTrackId= null;
        this.isPlaying     = false;
        this.audio         = new Audio();
        this.audioContext  = null;
        this.analyser      = null;
        this.animFrame     = null;
        this.purchaseTrackId  = null;
        this.downloadTrackId  = null;

        this._loadTracks();
        this._bindAudio();
        this._bindFilterTabs();
        this._bindAdminUpload();
        this._bindTrackForm();
        this._bindPaywalledToggle();
        this._bindPanelTabs();

        this.audio.volume = 0.7;
    }

    /* ═══════════════════════════════════════════
       STORAGE
    ═══════════════════════════════════════════ */

    _loadTracks() {
        try {
            const raw = localStorage.getItem('transmissions_tracks');
            this.tracks = raw ? JSON.parse(raw) : [];
        } catch (e) {
            this.tracks = [];
        }
    }

    _saveTracks() {
        try {
            localStorage.setItem('transmissions_tracks', JSON.stringify(this.tracks));
        } catch (e) {
            console.warn('TransmissionsManager: could not save tracks', e);
        }
    }

    _generateId() {
        return 'trk_' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    /* ═══════════════════════════════════════════
       PURCHASE STATE
    ═══════════════════════════════════════════ */

    isPurchased(trackId) {
        return window.stripeCheckout ? stripeCheckout.isPurchased(trackId) : false;
    }

    /**
     * Called by stripe-checkout.js after a successful Stripe return.
     * Validates the unlock code and returns success/failure.
     */
    processStripeReturn(trackId, code) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return { success: false, reason: 'track_not_found' };

        // If no unlock code set on track, trust Stripe redirect (less secure)
        if (!track.unlockCode) return { success: true, track };

        // Validate code
        if (track.unlockCode === code) return { success: true, track };

        return { success: false, reason: 'invalid_code' };
    }

    /* ═══════════════════════════════════════════
       AUDIO BLOBS (IndexedDB)
    ═══════════════════════════════════════════ */

    async _saveAudioBlob(id, file) {
        if (window.storage) {
            try {
                const result = await storage.saveAudioFile(file);
                return result; // auto-increment db id
            } catch (e) {
                console.warn('Could not store audio in IndexedDB', e);
            }
        }
        return null;
    }

    async _getAudioURL(track) {
        if (track._blobURL) return track._blobURL;

        if (window.storage && track.audioDbId) {
            try {
                const files = await storage.getAllAudioFiles();
                const match = files.find(f => f.id === track.audioDbId);
                if (match && match.blob) {
                    track._blobURL = URL.createObjectURL(match.blob);
                    return track._blobURL;
                }
            } catch (e) {
                console.warn('Could not retrieve audio blob', e);
            }
        }

        return track.externalAudioUrl || null;
    }

    async _saveArtworkBlob(id, file) {
        if (window.storage) {
            try {
                const imageData = {
                    id,
                    filename: file.name,
                    blob: file,
                    uploadDate: new Date().toISOString(),
                    size: file.size,
                };
                await storage.saveImage(imageData);
            } catch (e) {
                console.warn('Could not store artwork blob', e);
            }
        }
    }

    async _getArtworkURL(track) {
        if (track._artworkURL) return track._artworkURL;

        if (window.storage && track.artworkStorageKey) {
            try {
                const images = await storage.getAllImages();
                const match  = images.find(i => i.id === track.artworkStorageKey);
                if (match && match.blob) {
                    track._artworkURL = URL.createObjectURL(match.blob);
                    return track._artworkURL;
                }
            } catch (e) {
                console.warn('Could not retrieve artwork blob', e);
            }
        }
        return null;
    }

    /* ═══════════════════════════════════════════
       RENDER
    ═══════════════════════════════════════════ */

    async renderCatalog() {
        const catalog = document.getElementById('transmission-catalog');
        const empty   = document.getElementById('catalog-empty');
        if (!catalog) return;

        let filtered = this.tracks;
        if (this.currentFilter !== 'all') {
            filtered = this.tracks.filter(t => t.type === this.currentFilter);
        }

        if (filtered.length === 0) {
            catalog.innerHTML = '';
            if (empty) empty.style.display = 'block';
            return;
        }

        if (empty) empty.style.display = 'none';

        const isAdmin = window.authManager && authManager.isAdmin();
        const rows    = await Promise.all(
            filtered.map((track, i) => this._buildTrackRow(track, i + 1, isAdmin))
        );
        catalog.innerHTML = rows.join('');

        catalog.querySelectorAll('.track-row').forEach(row => {
            const id = row.dataset.id;
            row.addEventListener('click', e => {
                if (e.target.closest('button') || e.target.closest('a')) return;
                this.playTrack(id);
            });
        });
    }

    async _buildTrackRow(track, index, isAdmin) {
        const artworkURL    = await this._getArtworkURL(track);
        const artworkHTML   = artworkURL
            ? `<img src="${artworkURL}" alt="${this._esc(track.title)}" loading="lazy">`
            : `<span class="track-artwork-placeholder">ART</span>`;

        const isFree      = !track.price || parseFloat(track.price) === 0;
        const priceLabel  = isFree ? 'FREE' : `$${parseFloat(track.price).toFixed(2)}`;
        const purchased   = this.isPurchased(track.id);
        const isPlaying   = this.currentTrackId === track.id && this.isPlaying;

        /* ── Action buttons ── */
        let actionBtn = '';
        let purchasedBadge = '';

        if (purchased) {
            purchasedBadge = `<span class="track-purchased-badge mono-label">PURCHASED ✓</span>`;
            actionBtn = `
                <button class="btn-download-row" onclick="transmissionsManager.showDownloadModal('${track.id}')">
                    ↓ DOWNLOAD
                </button>`;
        } else if (track.isPaywalled) {
            actionBtn = `
                <button class="btn-locked" onclick="transmissionsManager.showPurchaseModal('${track.id}')">
                    ⬡ ${priceLabel}
                </button>`;
        } else if (!isFree) {
            actionBtn = `
                <button class="btn-acquire" onclick="transmissionsManager.showPurchaseModal('${track.id}')">
                    ACQUIRE ${priceLabel}
                </button>`;
        } else {
            actionBtn = `
                <button class="btn-acquire btn-free" onclick="transmissionsManager.playTrack('${track.id}')">
                    ▶ PLAY
                </button>`;
        }

        /* ── Preview button (paid but not paywalled) ── */
        const previewBtn = (!isFree && !track.isPaywalled && !purchased)
            ? `<button class="btn-preview" onclick="transmissionsManager.previewTrack('${track.id}')">PREVIEW</button>`
            : '';

        /* ── Admin buttons ── */
        const adminBtns = isAdmin ? `
            <button class="btn-track-edit"   onclick="transmissionsManager.showEditTrackModal('${track.id}')">EDIT</button>
            <button class="btn-track-delete" onclick="transmissionsManager.deleteTrack('${track.id}')">DEL</button>
        ` : '';

        return `
        <div class="track-row${isPlaying ? ' playing' : ''}${purchased ? ' purchased' : ''}" data-id="${track.id}" data-type="${track.type}">
            <div class="track-num">${String(index).padStart(2, '0')}</div>
            <div class="track-play-icon">${isPlaying ? '◼' : '▶'}</div>
            <div class="track-artwork">${artworkHTML}</div>
            <div class="track-info">
                <div class="track-title-text">${this._esc(track.title)}</div>
                <div class="track-meta-row">
                    <span class="track-artist-text">${this._esc(track.artist || '3EAS')}</span>
                    <span class="track-type-badge${track.type === 'exclusive' ? ' badge-exclusive' : ''}">${track.type.toUpperCase()}</span>
                    ${track.album ? `<span class="track-artist-text">— ${this._esc(track.album)}</span>` : ''}
                    ${purchasedBadge}
                </div>
            </div>
            <div class="track-duration mono-label">${track.duration ? this._formatDuration(track.duration) : '—:——'}</div>
            <div class="track-price-tag">${purchased ? '✓' : priceLabel}</div>
            <div class="track-actions">
                ${previewBtn}
                ${actionBtn}
                ${adminBtns}
            </div>
        </div>`;
    }

    /* ═══════════════════════════════════════════
       PLAYBACK
    ═══════════════════════════════════════════ */

    async playTrack(id) {
        const track = this.tracks.find(t => t.id === id);
        if (!track) return;

        const isFree    = !track.price || parseFloat(track.price) === 0;
        const purchased = this.isPurchased(id);

        if (track.isPaywalled && !purchased && !(window.authManager && authManager.isAdmin())) {
            this.showPurchaseModal(id);
            return;
        }

        const url = await this._getAudioURL(track);
        if (!url) {
            this._showToast('No audio file for this transmission.', 'error');
            return;
        }

        if (this.currentTrackId === id && !this.audio.paused) {
            this.audio.pause();
            this.isPlaying = false;
            this._updateNowPlayingUI(track);
            this.renderCatalog();
            return;
        }

        this.audio.src = url;
        this.audio.currentTime = 0;

        try {
            await this.audio.play();
            this.currentTrackId = id;
            this.isPlaying      = true;
            this._updateNowPlayingUI(track);
            this._initVisualizer();
            this.renderCatalog();
        } catch (err) {
            console.warn('Playback error', err);
            this._showToast('Playback failed. Check browser autoplay settings.', 'error');
        }
    }

    async previewTrack(id) {
        const track = this.tracks.find(t => t.id === id);
        if (!track) return;
        await this.playTrack(id);
        const previewSecs = track.previewDuration || 30;
        const startTime   = this.audio.currentTime;
        const check = setInterval(() => {
            if (this.audio.currentTime >= startTime + previewSecs) {
                this.audio.pause();
                this.isPlaying = false;
                this.renderCatalog();
                clearInterval(check);
            }
        }, 500);
    }

    _updateNowPlayingUI(track) {
        const titleEl = document.getElementById('np-title');
        const playBtn = document.getElementById('np-play');
        if (titleEl) {
            titleEl.textContent = track
                ? `${(track.artist || '3EAS').toUpperCase()} — ${track.title.toUpperCase()}`
                : '— SELECT A TRANSMISSION —';
        }
        if (playBtn) {
            playBtn.textContent = (this.isPlaying && !this.audio.paused) ? '◼' : '▶';
        }
    }

    _bindAudio() {
        const playBtn    = document.getElementById('np-play');
        const prevBtn    = document.getElementById('np-prev');
        const nextBtn    = document.getElementById('np-next');
        const scrubber   = document.getElementById('np-scrubber');
        const volumeInput= document.getElementById('np-volume');

        if (playBtn) {
            playBtn.addEventListener('click', () => {
                if (!this.currentTrackId) return;
                if (this.audio.paused) {
                    this.audio.play().then(() => {
                        this.isPlaying = true;
                        playBtn.textContent = '◼';
                    });
                } else {
                    this.audio.pause();
                    this.isPlaying = false;
                    playBtn.textContent = '▶';
                }
            });
        }

        if (prevBtn) prevBtn.addEventListener('click', () => this._skipTrack(-1));
        if (nextBtn) nextBtn.addEventListener('click', () => this._skipTrack(1));

        this.audio.addEventListener('timeupdate', () => {
            const current = document.getElementById('np-current');
            const fill    = document.getElementById('np-progress-fill');
            const slider  = document.getElementById('np-scrubber');
            if (!this.audio.duration) return;
            const pct = (this.audio.currentTime / this.audio.duration) * 100;
            if (current) current.textContent = this._formatDuration(this.audio.currentTime);
            if (fill)    fill.style.width    = pct + '%';
            if (slider)  slider.value        = pct;
        });

        this.audio.addEventListener('loadedmetadata', () => {
            const dur = document.getElementById('np-duration');
            if (dur) dur.textContent = this._formatDuration(this.audio.duration);
            if (this.currentTrackId) {
                const track = this.tracks.find(t => t.id === this.currentTrackId);
                if (track && !track.duration) {
                    track.duration = this.audio.duration;
                    this._saveTracks();
                }
            }
        });

        this.audio.addEventListener('ended', () => {
            this.isPlaying = false;
            this._skipTrack(1);
        });

        if (scrubber) {
            scrubber.addEventListener('input', () => {
                if (this.audio.duration) {
                    this.audio.currentTime = (scrubber.value / 100) * this.audio.duration;
                }
            });
        }

        if (volumeInput) {
            volumeInput.addEventListener('input', () => {
                this.audio.volume = volumeInput.value / 100;
            });
        }
    }

    _skipTrack(dir) {
        if (!this.currentTrackId) return;
        const list = this.currentFilter === 'all'
            ? this.tracks
            : this.tracks.filter(t => t.type === this.currentFilter);
        const idx  = list.findIndex(t => t.id === this.currentTrackId);
        if (idx === -1) return;
        const next = list[idx + dir];
        if (next) this.playTrack(next.id);
    }

    /* ═══════════════════════════════════════════
       VISUALIZER
    ═══════════════════════════════════════════ */

    _initVisualizer() {
        const canvas = document.getElementById('audio-visualizer');
        if (!canvas) return;

        if (!this.audioContext) {
            try {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const source = this.audioContext.createMediaElementSource(this.audio);
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 64;
                source.connect(this.analyser);
                this.analyser.connect(this.audioContext.destination);
            } catch (e) { return; }
        }

        const ctx      = canvas.getContext('2d');
        const bufLen   = this.analyser.frequencyBinCount;
        const dataArr  = new Uint8Array(bufLen);

        const draw = () => {
            this.animFrame = requestAnimationFrame(draw);
            this.analyser.getByteFrequencyData(dataArr);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const barW = canvas.width / bufLen;
            for (let i = 0; i < bufLen; i++) {
                const h     = (dataArr[i] / 255) * canvas.height;
                const alpha = 0.3 + (dataArr[i] / 255) * 0.7;
                ctx.fillStyle = `rgba(255,255,255,${alpha})`;
                ctx.fillRect(i * barW, canvas.height - h, barW - 1, h);
            }
        };

        if (this.animFrame) cancelAnimationFrame(this.animFrame);
        draw();
    }

    /* ═══════════════════════════════════════════
       FILTERS
    ═══════════════════════════════════════════ */

    _bindFilterTabs() {
        const filters = document.querySelectorAll('.t-filter[data-filter]');
        filters.forEach(btn => {
            btn.addEventListener('click', () => {
                filters.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentFilter = btn.dataset.filter;
                this.renderCatalog();
            });
        });
    }

    /* ═══════════════════════════════════════════
       ADMIN: ADD / EDIT TRACK MODAL
    ═══════════════════════════════════════════ */

    showAddTrackModal() {
        const modal = document.getElementById('track-modal');
        const form  = document.getElementById('track-form');
        const title = document.getElementById('track-modal-title');
        if (!modal) return;

        form.reset();
        document.getElementById('track-id').value              = '';
        document.getElementById('track-artist').value          = '3EAS';
        document.getElementById('track-audio-filename').textContent   = 'CHOOSE MP3 FILE';
        document.getElementById('track-artwork-filename').textContent = 'CHOOSE IMAGE FILE';
        const preview = document.getElementById('track-artwork-preview');
        if (preview) { preview.src = ''; preview.style.display = 'none'; }

        const stripePanel = document.getElementById('stripe-setup-panel');
        if (stripePanel) stripePanel.style.display = 'none';

        if (title) title.textContent = 'ADD TRANSMISSION';
        modal.classList.add('active');
    }

    showEditTrackModal(id) {
        const track = this.tracks.find(t => t.id === id);
        if (!track) return;

        const modal = document.getElementById('track-modal');
        const title = document.getElementById('track-modal-title');
        if (!modal) return;

        document.getElementById('track-id').value             = track.id;
        document.getElementById('track-title-input').value    = track.title     || '';
        document.getElementById('track-artist').value         = track.artist    || '3EAS';
        document.getElementById('track-type').value           = track.type      || 'release';
        document.getElementById('track-price').value          = track.price     || 0;
        document.getElementById('track-purchase-url').value   = track.purchaseUrl   || '';
        document.getElementById('track-download-url').value   = track.downloadUrl   || '';
        document.getElementById('track-album').value          = track.album     || '';
        document.getElementById('track-release-date').value   = track.releaseDate   || '';
        document.getElementById('track-paywalled').checked    = !!track.isPaywalled;
        document.getElementById('track-unlock-code').value    = track.unlockCode    || '';

        const audioLabel = document.getElementById('track-audio-filename');
        if (audioLabel) audioLabel.textContent = track.audioDbId ? '✓ AUDIO ON FILE' : 'CHOOSE MP3 FILE';

        const unlockGroup = document.getElementById('track-unlock-group');
        if (unlockGroup) unlockGroup.style.display = track.isPaywalled ? 'flex' : 'none';

        if (title) title.textContent = 'EDIT TRANSMISSION';
        modal.classList.add('active');

        // Show Stripe setup panel if track has ID + code
        updateStripeSetupPanel && updateStripeSetupPanel();
    }

    hideTrackModal() {
        const modal = document.getElementById('track-modal');
        if (modal) modal.classList.remove('active');
    }

    _bindTrackForm() {
        const audioInput   = document.getElementById('track-audio-file');
        const artworkInput = document.getElementById('track-artwork-file');
        const unlockInput  = document.getElementById('track-unlock-code');

        if (audioInput) {
            audioInput.addEventListener('change', () => {
                const file = audioInput.files[0];
                if (file) document.getElementById('track-audio-filename').textContent = file.name;
            });
        }

        if (artworkInput) {
            artworkInput.addEventListener('change', () => {
                const file = artworkInput.files[0];
                if (file) {
                    document.getElementById('track-artwork-filename').textContent = file.name;
                    const preview = document.getElementById('track-artwork-preview');
                    if (preview) { preview.src = URL.createObjectURL(file); preview.style.display = 'block'; }
                }
            });
        }

        // Update Stripe setup panel whenever unlock code changes
        if (unlockInput) {
            unlockInput.addEventListener('input', () => {
                if (typeof updateStripeSetupPanel === 'function') updateStripeSetupPanel();
            });
        }
    }

    _bindPaywalledToggle() {
        const checkbox = document.getElementById('track-paywalled');
        const group    = document.getElementById('track-unlock-group');
        if (checkbox && group) {
            checkbox.addEventListener('change', () => {
                group.style.display = checkbox.checked ? 'flex' : 'none';
            });
        }
    }

    async handleTrackSubmit(event) {
        event.preventDefault();

        const errorEl = document.getElementById('track-form-error');
        if (errorEl) errorEl.style.display = 'none';

        const id          = document.getElementById('track-id').value || this._generateId();
        const titleVal    = document.getElementById('track-title-input').value.trim();
        const artist      = document.getElementById('track-artist').value.trim()    || '3EAS';
        const type        = document.getElementById('track-type').value;
        const price       = parseFloat(document.getElementById('track-price').value) || 0;
        const purchaseUrl = document.getElementById('track-purchase-url').value.trim();
        const downloadUrl = document.getElementById('track-download-url').value.trim();
        const album       = document.getElementById('track-album').value.trim();
        const releaseDate = document.getElementById('track-release-date').value;
        const isPaywalled = document.getElementById('track-paywalled').checked;
        const unlockCode  = document.getElementById('track-unlock-code').value.trim();

        if (!titleVal) {
            if (errorEl) { errorEl.textContent = 'Title is required.'; errorEl.style.display = 'block'; }
            return;
        }

        const audioFile   = document.getElementById('track-audio-file').files[0];
        const artworkFile = document.getElementById('track-artwork-file').files[0];

        const existing = this.tracks.find(t => t.id === id);
        const track    = existing || { id, uploadDate: new Date().toISOString() };

        track.title       = titleVal;
        track.artist      = artist;
        track.type        = type;
        track.price       = price;
        track.purchaseUrl = purchaseUrl;
        track.downloadUrl = downloadUrl;
        track.album       = album;
        track.releaseDate = releaseDate;
        track.isPaywalled = isPaywalled;
        track.unlockCode  = unlockCode;
        track.previewDuration = 30;

        // Handle audio file
        if (audioFile) {
            if (audioFile.size > 100 * 1024 * 1024) {
                if (errorEl) { errorEl.textContent = 'Audio file too large (max 100MB).'; errorEl.style.display = 'block'; }
                return;
            }
            track._blobURL = URL.createObjectURL(audioFile);
            const namedBlob = new File([audioFile], id + '_audio', { type: audioFile.type });
            const dbId = await this._saveAudioBlob(id + '_audio', namedBlob);
            if (dbId) track.audioDbId = dbId;
        }

        // Handle artwork file
        if (artworkFile) {
            if (track._artworkURL) URL.revokeObjectURL(track._artworkURL);
            track.artworkStorageKey = id + '_artwork';
            track._artworkURL = URL.createObjectURL(artworkFile);
            const namedBlob = new File([artworkFile], id + '_artwork', { type: artworkFile.type });
            await this._saveArtworkBlob(id + '_artwork', namedBlob);
        }

        if (!existing) this.tracks.push(track);

        this._saveTracks();
        this.hideTrackModal();
        this.renderCatalog();
        this._showToast('Transmission saved.', 'success');
    }

    async deleteTrack(id) {
        if (!confirm('Delete this transmission?')) return;
        this.tracks = this.tracks.filter(t => t.id !== id);
        if (this.currentTrackId === id) {
            this.audio.pause();
            this.currentTrackId = null;
            this.isPlaying      = false;
            this._updateNowPlayingUI(null);
        }
        this._saveTracks();
        this.renderCatalog();
        this._showToast('Transmission deleted.', 'success');
    }

    /* ═══════════════════════════════════════════
       ADMIN: QUICK UPLOAD
    ═══════════════════════════════════════════ */

    _bindAdminUpload() {
        const input = document.getElementById('audio-upload-hidden');
        if (!input) return;

        input.addEventListener('change', async () => {
            const files = Array.from(input.files);
            for (const file of files) {
                if (!file.type.match(/audio\/(mp3|mpeg)/)) continue;
                if (file.size > 100 * 1024 * 1024) continue;

                const id       = this._generateId();
                const titleName= file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').toUpperCase();
                const track = {
                    id,
                    title: titleName,
                    artist: '3EAS',
                    type:  'release',
                    price: 0,
                    isPaywalled:     false,
                    uploadDate:      new Date().toISOString(),
                    previewDuration: 30,
                    _blobURL: URL.createObjectURL(file),
                };

                const namedBlob = new File([file], id + '_audio', { type: file.type });
                const dbId = await this._saveAudioBlob(id + '_audio', namedBlob);
                if (dbId) track.audioDbId = dbId;
                this.tracks.push(track);
            }

            this._saveTracks();
            this.renderCatalog();
            this._showToast(`${files.length} transmission(s) uploaded.`, 'success');
            input.value = '';
        });
    }

    /* ═══════════════════════════════════════════
       PURCHASE MODAL (Stripe flow)
    ═══════════════════════════════════════════ */

    async showPurchaseModal(id) {
        const track = this.tracks.find(t => t.id === id);
        if (!track) return;

        // Already purchased — go straight to download
        if (this.isPurchased(id)) {
            this.showDownloadModal(id);
            return;
        }

        this.purchaseTrackId = id;

        const modal = document.getElementById('purchase-modal');
        if (!modal) return;

        // Title
        document.getElementById('purchase-modal-title').textContent =
            track.isPaywalled ? '⬡ RESTRICTED TRANSMISSION' : 'ACQUIRE TRANSMISSION';

        // Track info
        document.getElementById('purchase-track-title').textContent  = track.title.toUpperCase();
        document.getElementById('purchase-track-artist').textContent = (track.artist || '3EAS').toUpperCase();

        const priceText = track.price > 0 ? `$${parseFloat(track.price).toFixed(2)} USD` : 'FREE';
        document.getElementById('purchase-price').textContent = priceText;

        // Artwork
        const artEl  = document.getElementById('purchase-artwork');
        const artURL = await this._getArtworkURL(track);
        artEl.innerHTML = artURL
            ? `<img src="${artURL}" alt="${this._esc(track.title)}">`
            : '';

        // ── Stripe pay button ──
        const stripeBtn   = document.getElementById('stripe-pay-btn');
        const emailLink   = document.getElementById('purchase-email-link');
        const purchaseOpts= document.getElementById('purchase-options');
        const unlockSection = document.getElementById('purchase-unlock-section');

        if (stripeBtn) {
            if (track.purchaseUrl) {
                stripeBtn.href        = track.purchaseUrl;
                stripeBtn.textContent = `PAY ${priceText} WITH STRIPE →`;
                stripeBtn.style.display = 'block';
            } else {
                stripeBtn.style.display = 'none';
            }
        }

        if (emailLink) {
            emailLink.href = `mailto:contact@3eas.com?subject=Purchase Request: ${encodeURIComponent(track.title)}&body=I'd like to purchase "${track.title}" for ${priceText}.`;
        }

        if (purchaseOpts) {
            purchaseOpts.style.display = track.purchaseUrl ? 'flex' : 'flex';
        }

        // Unlock code section (if paywalled + no Stripe URL, show code entry)
        if (unlockSection) {
            unlockSection.style.display = track.isPaywalled ? 'block' : 'none';
        }

        const unlockError = document.getElementById('purchase-unlock-error');
        if (unlockError) { unlockError.style.display = 'none'; unlockError.textContent = ''; }
        const unlockInput = document.getElementById('purchase-unlock-input');
        if (unlockInput) unlockInput.value = '';

        modal.classList.add('active');
    }

    hidePurchaseModal() {
        const modal = document.getElementById('purchase-modal');
        if (modal) modal.classList.remove('active');
        this.purchaseTrackId = null;
    }

    attemptUnlock() {
        const track = this.tracks.find(t => t.id === this.purchaseTrackId);
        if (!track) return;

        const input   = document.getElementById('purchase-unlock-input');
        const errorEl = document.getElementById('purchase-unlock-error');
        const code    = input ? input.value.trim() : '';

        if (!code) return;

        if (code === track.unlockCode) {
            // Record as purchased
            window.stripeCheckout && stripeCheckout.recordPurchase(track.id, code);
            this.hidePurchaseModal();
            this.showDownloadModal(track.id);
            this.renderCatalog();
        } else {
            if (errorEl) { errorEl.textContent = 'Invalid access code.'; errorEl.style.display = 'block'; }
        }
    }

    /* ═══════════════════════════════════════════
       DOWNLOAD MODAL
    ═══════════════════════════════════════════ */

    async showDownloadModal(trackId) {
        const track = this.tracks.find(t => t.id === trackId);
        if (!track) return;

        this.downloadTrackId = trackId;

        const modal = document.getElementById('download-modal');
        if (!modal) return;

        // Track info
        document.getElementById('dl-track-title').textContent  = track.title.toUpperCase();
        document.getElementById('dl-track-artist').textContent = (track.artist || '3EAS').toUpperCase();

        // Artwork
        const artEl  = document.getElementById('dl-artwork');
        const artURL = await this._getArtworkURL(track);
        artEl.innerHTML = artURL
            ? `<img src="${artURL}" alt="${this._esc(track.title)}">`
            : '';

        // Download button
        const dlBtn = document.getElementById('download-mp3-btn');
        if (dlBtn) {
            if (track.downloadUrl) {
                dlBtn.href    = track.downloadUrl;
                dlBtn.setAttribute('download', track.title + '.mp3');
                dlBtn.style.display = 'block';
            } else if (track._blobURL) {
                dlBtn.href    = track._blobURL;
                dlBtn.setAttribute('download', track.title + '.mp3');
                dlBtn.style.display = 'block';
            } else {
                dlBtn.style.display = 'none';
            }
        }

        modal.classList.add('active');
    }

    hideDownloadModal() {
        const modal = document.getElementById('download-modal');
        if (modal) modal.classList.remove('active');
        this.downloadTrackId = null;
    }

    playPurchasedTrack() {
        if (!this.downloadTrackId) return;
        this.hideDownloadModal();
        this.playTrack(this.downloadTrackId);
        scrollToSection('transmissions');
    }

    /* ═══════════════════════════════════════════
       ADMIN PANEL TABS
    ═══════════════════════════════════════════ */

    _bindPanelTabs() {
        const tabs = document.querySelectorAll('.panel-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.panel-content').forEach(p => p.style.display = 'none');
                const target = document.getElementById('panel-' + tab.dataset.panel);
                if (target) target.style.display = 'block';
            });
        });
    }

    /* ═══════════════════════════════════════════
       AUTH CALLBACK
    ═══════════════════════════════════════════ */

    onAuthChange() {
        const adminBar = document.getElementById('transmission-admin-bar');
        if (adminBar) {
            adminBar.style.display = (window.authManager && authManager.isAdmin()) ? 'flex' : 'none';
        }
        this.renderCatalog();
    }

    /* ═══════════════════════════════════════════
       HELPERS
    ═══════════════════════════════════════════ */

    _formatDuration(secs) {
        if (!secs || isNaN(secs)) return '—:——';
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    _esc(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    _showToast(message, type = 'success') {
        window.showToast ? showToast(message, type) : console.log(`[${type}] ${message}`);
    }
}

const transmissionsManager = new TransmissionsManager();

document.addEventListener('DOMContentLoaded', () => {
    transmissionsManager.renderCatalog();
});
