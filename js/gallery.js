/**
 * Gallery Manager - Image upload and display functionality
 */

class GalleryManager {
    constructor() {
        this.images = [];
        this.currentLightboxIndex = 0;
        this.init();
    }
    
    async init() {
        await this.loadImages();
        this.setupEventListeners();
        this.renderGallery();
    }
    
    setupEventListeners() {
        const uploadBtn = document.getElementById('uploadImageBtn');
        const imageInput = document.getElementById('imageUpload');
        
        if (uploadBtn && imageInput) {
            uploadBtn.addEventListener('click', () => this.handleImageUpload());
        }
        
        // Lightbox controls
        const lightbox = document.getElementById('imageLightbox');
        if (lightbox) {
            lightbox.addEventListener('click', (e) => {
                if (e.target.id === 'imageLightbox') this.closeLightbox();
            });
        }
        
        const lightboxClose = document.getElementById('lightbox-close-btn') || document.querySelector('.lightbox-close-gallery');
        if (lightboxClose) {
            lightboxClose.addEventListener('click', () => this.closeLightbox());
        }
        
        const lightboxPrev = document.querySelector('.lightbox-prev');
        if (lightboxPrev) {
            lightboxPrev.addEventListener('click', () => this.navigateLightbox(-1));
        }
        
        const lightboxNext = document.querySelector('.lightbox-next');
        if (lightboxNext) {
            lightboxNext.addEventListener('click', () => this.navigateLightbox(1));
        }

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            const lightbox = document.getElementById('imageLightbox');
            if (lightbox && lightbox.style.display === 'flex') {
                if (e.key === 'ArrowLeft') {
                    this.navigateLightbox(-1);
                } else if (e.key === 'ArrowRight') {
                    this.navigateLightbox(1);
                } else if (e.key === 'Escape') {
                    this.closeLightbox();
                }
            }
        });
    }
    
    async handleImageUpload() {
        // Check authentication
        if (!authManager.isAdmin()) {
            alert('Please log in as admin to upload images');
            authManager.showLoginModal();
            return;
        }

        const input = document.getElementById('imageUpload');
        const files = input.files;
        const statusDiv = document.getElementById('imageUploadStatus');
        
        if (!files.length) {
            statusDiv.textContent = 'Please select images to upload';
            statusDiv.className = 'upload-status error';
            return;
        }
        
        statusDiv.textContent = 'Uploading...';
        statusDiv.className = 'upload-status';
        
        let uploadedCount = 0;
        let errorMessages = [];

        for (let file of files) {
            // Validate file type
            if (!file.type.startsWith('image/')) {
                errorMessages.push(`${file.name} is not an image`);
                continue;
            }
            
            // Validate file size (10MB max)
            if (file.size > 10 * 1024 * 1024) {
                errorMessages.push(`${file.name} is too large (max 10MB)`);
                continue;
            }
            
            try {
                await this.saveImage(file);
                uploadedCount++;
            } catch (error) {
                console.error('Failed to save image:', error);
                errorMessages.push(`Failed to upload ${file.name}`);
            }
        }
        
        // Display result message
        if (uploadedCount > 0 && errorMessages.length === 0) {
            statusDiv.textContent = `Upload complete! ${uploadedCount} image(s) uploaded.`;
            statusDiv.className = 'upload-status success';
        } else if (uploadedCount > 0 && errorMessages.length > 0) {
            statusDiv.textContent = `${uploadedCount} image(s) uploaded. ${errorMessages.length} failed.`;
            statusDiv.className = 'upload-status success';
        } else {
            statusDiv.textContent = errorMessages.join('. ');
            statusDiv.className = 'upload-status error';
        }
        
        input.value = '';
        await this.loadImages();
        this.renderGallery();
        
        setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.className = 'upload-status';
        }, 3000);
    }
    
    async saveImage(file) {
        const imageData = {
            id: Date.now() + '-' + Math.random().toString(36).substring(2, 11),
            filename: file.name,
            blob: file,
            uploadDate: new Date().toISOString(),
            size: file.size
        };
        
        await storage.saveImage(imageData);
    }
    
    async loadImages() {
        try {
            this.images = await storage.getAllImages();
            this.images.sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));
        } catch (error) {
            console.error('Failed to load images:', error);
            this.images = [];
        }
    }
    
    renderGallery() {
        const grid = document.getElementById('galleryGrid');
        const emptyState = document.getElementById('galleryEmpty');
        const isAdmin = authManager && authManager.isAdmin();
        
        if (!grid) return;

        // Revoke old object URLs to prevent memory leaks
        const oldImages = grid.querySelectorAll('img');
        oldImages.forEach(img => {
            if (img.src.startsWith('blob:')) {
                URL.revokeObjectURL(img.src);
            }
        });

        if (!this.images.length) {
            grid.innerHTML = '';
            if (emptyState) emptyState.style.display = 'block';
            return;
        }
        
        if (emptyState) emptyState.style.display = 'none';
        
        grid.innerHTML = this.images.map((img, index) => {
            const url = URL.createObjectURL(img.blob);
            return `
                <div class="gallery-item" data-id="${img.id}">
                    <img src="${url}" alt="${img.filename}" 
                         onclick="galleryManager.openLightbox(${index})">
                    ${isAdmin ? `<button class="delete-gallery-btn" onclick="galleryManager.deleteImage('${img.id}')">✕</button>` : ''}
                </div>
            `;
        }).join('');
    }
    
    openLightbox(index) {
        this.currentLightboxIndex = index;
        const img = this.images[index];
        const lightbox = document.getElementById('imageLightbox');
        const lightboxImg = document.getElementById('lightboxImage');
        const filename = document.getElementById('lightboxFilename');
        const date = document.getElementById('lightboxDate');
        
        if (!lightbox || !lightboxImg) return;

        // Revoke previous object URL to prevent memory leak
        if (lightboxImg.src && lightboxImg.src.startsWith('blob:')) {
            URL.revokeObjectURL(lightboxImg.src);
        }

        lightboxImg.src = URL.createObjectURL(img.blob);
        if (filename) filename.textContent = img.filename;
        if (date) date.textContent = new Date(img.uploadDate).toLocaleDateString();
        lightbox.style.display = 'flex';
        
        // Disable body scroll
        document.body.style.overflow = 'hidden';
    }
    
    closeLightbox() {
        const lightbox = document.getElementById('imageLightbox');
        const lightboxImg = document.getElementById('lightboxImage');
        
        // Revoke object URL when closing
        if (lightboxImg && lightboxImg.src && lightboxImg.src.startsWith('blob:')) {
            URL.revokeObjectURL(lightboxImg.src);
            lightboxImg.src = '';
        }
        
        if (lightbox) {
            lightbox.style.display = 'none';
        }
        
        // Re-enable body scroll
        document.body.style.overflow = '';
    }
    
    navigateLightbox(direction) {
        if (this.images.length === 0) return;
        
        this.currentLightboxIndex += direction;
        if (this.currentLightboxIndex < 0) {
            this.currentLightboxIndex = this.images.length - 1;
        }
        if (this.currentLightboxIndex >= this.images.length) {
            this.currentLightboxIndex = 0;
        }
        this.openLightbox(this.currentLightboxIndex);
    }
    
    async deleteImage(id) {
        if (!confirm('Delete this image?')) return;
        
        try {
            await storage.deleteImage(id);
            await this.loadImages();
            this.renderGallery();
            
            window.showToast && window.showToast('Image deleted.', 'success');
        } catch (error) {
            console.error('Failed to delete image:', error);
            alert('Failed to delete image');
        }
    }
}

// Initialize gallery
let galleryManager;
document.addEventListener('DOMContentLoaded', () => {
    galleryManager = new GalleryManager();
});
