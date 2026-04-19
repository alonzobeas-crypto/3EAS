/**
 * Instagram Feed Manager
 * Handles loading and displaying Instagram posts
 */

class InstagramFeedManager {
    constructor() {
        this.posts = [];
        this.container = null;
        this.loading = null;
        this.error = null;
        this.cacheKey = 'instagramFeedCache';
        this.cacheTimeKey = 'instagramFeedCacheTime';
        this.init();
    }

    async init() {
        if (!window.instagramConfig || !window.instagramConfig.enabled) {
            console.log('Instagram feed disabled');
            return;
        }

        // Wait for DOM
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }

    setup() {
        this.container = document.getElementById('instagramFeedContainer');
        this.loading = document.getElementById('instagramLoading');
        this.error = document.getElementById('instagramError');

        if (!this.container) {
            console.warn('Instagram feed container not found');
            return;
        }

        // Update Instagram username in links
        this.updateInstagramLinks();

        // Load feed
        this.loadFeed();
    }

    updateInstagramLinks() {
        const username = window.instagramConfig.username;
        const instagramUrl = `https://instagram.com/${username}`;
        
        document.querySelectorAll(`a[href*="instagram.com/${username}"]`).forEach(link => {
            link.href = instagramUrl;
        });
        
        const handleElement = document.querySelector('.instagram-handle a');
        if (handleElement) {
            handleElement.textContent = `@${username}`;
            handleElement.href = instagramUrl;
        }
    }

    async loadFeed() {
        this.showLoading();

        // Check cache first
        const cachedData = this.getCachedData();
        if (cachedData) {
            this.posts = cachedData;
            this.renderFeed();
            return;
        }

        // Load based on method
        const method = window.instagramConfig.method;

        try {
            switch (method) {
                case 'juicer':
                    await this.loadFromJuicer();
                    break;
                case 'official':
                    await this.loadFromOfficialAPI();
                    break;
                case 'manual':
                    await this.loadManualPosts();
                    break;
                default:
                    throw new Error('Invalid Instagram feed method');
            }

            this.cacheData();
            this.renderFeed();
        } catch (error) {
            console.error('Failed to load Instagram feed:', error);
            this.showError();
        }
    }

    async loadFromJuicer() {
        const { feedName } = window.instagramConfig.juicer;
        const postsToShow = window.instagramConfig.postsToShow;
        
        // Juicer.io API endpoint
        const url = `https://www.juicer.io/api/feeds/${feedName}?per=${postsToShow}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Failed to fetch from Juicer');
        }

        const data = await response.json();
        
        // Validate response structure
        if (!data || !data.posts || !data.posts.items) {
            throw new Error('Invalid response from Juicer API');
        }
        
        // Filter for Instagram posts only
        this.posts = data.posts.items
            .filter(post => post.source.source === 'Instagram')
            .slice(0, postsToShow)
            .map(post => ({
                id: post.id,
                image: post.image,
                caption: post.message || '',
                likes: post.like_count || 0,
                comments: post.comment_count || 0,
                link: post.full_url,
                date: new Date(post.external_created_at)
            }));
    }

    async loadFromOfficialAPI() {
        const { accessToken, userId } = window.instagramConfig.official;
        const postsToShow = window.instagramConfig.postsToShow;
        
        // Instagram Basic Display API endpoint
        const fields = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp';
        const url = `https://graph.instagram.com/${userId}/media?fields=${fields}&access_token=${accessToken}&limit=${postsToShow}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('Failed to fetch from Instagram API');
        }

        const data = await response.json();
        
        this.posts = data.data.map(post => ({
            id: post.id,
            image: post.media_type === 'VIDEO' ? post.thumbnail_url : post.media_url,
            caption: post.caption || '',
            likes: 0, // Basic API doesn't provide likes
            comments: 0,
            link: post.permalink,
            date: new Date(post.timestamp)
        }));
    }

    async loadManualPosts() {
        // Load manually uploaded posts from localStorage
        try {
            const manualPosts = JSON.parse(localStorage.getItem('instagramManualPosts') || '[]');
            
            this.posts = manualPosts
                .sort((a, b) => new Date(b.date) - new Date(a.date))
                .slice(0, window.instagramConfig.postsToShow);
        } catch (error) {
            console.error('Failed to parse manual posts:', error);
            this.posts = [];
        }
    }

    renderFeed() {
        if (!this.posts.length) {
            this.showError('No posts available');
            return;
        }

        this.hideLoading();
        
        this.container.innerHTML = this.posts.map(post => {
            // Validate URLs to prevent XSS
            const safeLink = this.sanitizeUrl(post.link);
            const safeImage = this.sanitizeUrl(post.image);
            
            return `
            <a href="${safeLink}" target="_blank" rel="noopener" class="instagram-post">
                <div class="instagram-post-image">
                    <img src="${safeImage}" alt="${this.escapeHtml(post.caption.substring(0, 50))}" loading="lazy">
                </div>
                <div class="instagram-post-overlay">
                    <div class="instagram-post-stats">
                        <span class="stat">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                            </svg>
                            ${this.formatNumber(post.likes)}
                        </span>
                        <span class="stat">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                                <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>
                            </svg>
                            ${this.formatNumber(post.comments)}
                        </span>
                    </div>
                    <p class="instagram-post-caption">
                        ${this.truncateCaption(post.caption)}
                    </p>
                </div>
            </a>
        `;
        }).join('');
    }

    showLoading() {
        if (this.loading) this.loading.style.display = 'block';
        if (this.container) this.container.style.display = 'none';
        if (this.error) this.error.style.display = 'none';
    }

    hideLoading() {
        if (this.loading) this.loading.style.display = 'none';
        if (this.container) this.container.style.display = 'grid';
    }

    showError(message = 'Unable to load Instagram feed') {
        if (this.loading) this.loading.style.display = 'none';
        if (this.container) this.container.style.display = 'none';
        if (this.error) {
            this.error.style.display = 'block';
            const errorText = this.error.querySelector('p');
            if (errorText) {
                errorText.textContent = message;
            }
        }
    }

    truncateCaption(caption, maxLength = 100) {
        if (!caption) return '';
        if (caption.length <= maxLength) return this.escapeHtml(caption);
        return this.escapeHtml(caption.substring(0, maxLength)) + '...';
    }

    formatNumber(num) {
        if (num >= 1000000) {
            const millions = num / 1000000;
            return Number.isInteger(millions) ? millions + 'M' : millions.toFixed(1) + 'M';
        }
        if (num >= 1000) {
            const thousands = num / 1000;
            return Number.isInteger(thousands) ? thousands + 'K' : thousands.toFixed(1) + 'K';
        }
        return num.toString();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    sanitizeUrl(url) {
        // Basic URL validation to prevent XSS
        if (!url || typeof url !== 'string' || !url.trim()) return '#';
        
        // Only allow http, https, and safe data URLs (images only)
        const urlLower = url.toLowerCase().trim();
        if (urlLower.startsWith('http://') || urlLower.startsWith('https://')) {
            // Escape any HTML-encoded characters
            const div = document.createElement('div');
            div.textContent = url;
            return div.innerHTML;
        }
        
        // Allow only image data URIs for image sources
        if (urlLower.startsWith('data:image/')) {
            const div = document.createElement('div');
            div.textContent = url;
            return div.innerHTML;
        }
        
        return '#';
    }

    getCachedData() {
        const cacheTime = localStorage.getItem(this.cacheTimeKey);
        const cacheDuration = window.instagramConfig.cacheDuration * 60 * 1000; // Convert to ms

        if (!cacheTime || Date.now() - parseInt(cacheTime) > cacheDuration) {
            return null;
        }

        try {
            const cached = localStorage.getItem(this.cacheKey);
            return cached ? JSON.parse(cached) : null;
        } catch (error) {
            console.error('Failed to parse cached Instagram data:', error);
            // Clear corrupted cache
            localStorage.removeItem(this.cacheKey);
            localStorage.removeItem(this.cacheTimeKey);
            return null;
        }
    }

    cacheData() {
        localStorage.setItem(this.cacheKey, JSON.stringify(this.posts));
        localStorage.setItem(this.cacheTimeKey, Date.now().toString());
    }
}

// Initialize Instagram feed
const instagramFeed = new InstagramFeedManager();
window.instagramFeed = instagramFeed;
