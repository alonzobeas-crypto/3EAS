/**
 * Media Upload Handler - MP3 and MP4 uploads
 */

class MediaUploadManager {
    constructor() {
        this.audioUpload = document.getElementById('audio-upload');
        this.videoUpload = document.getElementById('video-upload');
        this.videoPlayer = document.getElementById('video-player');
        this.videoList = document.getElementById('video-list');
        this.videos = [];

        this.init();
    }

    init() {
        // Audio upload handler (may not exist if transmissions.js handles it)
        if (this.audioUpload) {
            this.audioUpload.addEventListener('change', (e) => this.handleAudioUpload(e));
        }

        // Video upload handler
        if (this.videoUpload) {
            this.videoUpload.addEventListener('change', (e) => this.handleVideoUpload(e));
        }

        // Load existing videos
        if (this.videoPlayer && this.videoList) {
            this.loadVideosFromStorage();
        }
    }

    async handleAudioUpload(event) {
        // Check authentication
        if (!authManager.isLoggedIn()) {
            alert('Please log in as admin to upload media');
            event.target.value = '';
            authManager.showLoginModal();
            return;
        }
        
        const files = Array.from(event.target.files);
        
        for (const file of files) {
            // Validate file type
            if (!file.type.match('audio/mpeg') && !file.type.match('audio/mp3')) {
                alert(`${file.name} is not a valid MP3 file`);
                continue;
            }

            // Validate file size (max 50MB)
            if (file.size > 50 * 1024 * 1024) {
                alert(`${file.name} is too large. Maximum size is 50MB`);
                continue;
            }

            try {
                // Add to audio player
                await audioPlayer.addTrack(file);
                console.log(`Uploaded: ${file.name}`);
            } catch (error) {
                console.error('Failed to upload audio:', error);
                alert(`Failed to upload ${file.name}`);
            }
        }

        // Reset input
        event.target.value = '';
    }

    async handleVideoUpload(event) {
        // Check authentication
        if (!authManager.isLoggedIn()) {
            alert('Please log in as admin to upload media');
            event.target.value = '';
            authManager.showLoginModal();
            return;
        }
        
        const files = Array.from(event.target.files);
        
        for (const file of files) {
            // Validate file type
            if (!file.type.match('video/mp4')) {
                alert(`${file.name} is not a valid MP4 file`);
                continue;
            }

            // Validate file size (max 100MB)
            if (file.size > 100 * 1024 * 1024) {
                alert(`${file.name} is too large. Maximum size is 100MB`);
                continue;
            }

            try {
                // Save to storage
                const id = await storage.saveVideoFile(file);
                const video = {
                    id: id,
                    name: file.name,
                    url: URL.createObjectURL(file)
                };
                this.videos.push(video);
                console.log(`Uploaded: ${file.name}`);
            } catch (error) {
                console.error('Failed to upload video:', error);
                alert(`Failed to upload ${file.name}`);
            }
        }

        this.renderVideoList();
        event.target.value = '';
    }

    async loadVideosFromStorage() {
        try {
            const videoFiles = await storage.getAllVideoFiles();
            this.videos = videoFiles.map(file => ({
                id: file.id,
                name: file.name,
                url: URL.createObjectURL(file.blob)
            }));
            this.renderVideoList();
        } catch (error) {
            console.error('Failed to load videos:', error);
        }
    }

    renderVideoList() {
        if (!this.videoList || !this.videoPlayer) return;
        this.videoList.innerHTML = '';

        if (this.videos.length === 0) {
            this.videoList.innerHTML = '<div style="padding: 2rem; text-align: center; opacity: 0.6; grid-column: 1/-1;">No videos uploaded yet. Upload some videos!</div>';
            this.videoPlayer.style.display = 'none';
            return;
        }

        this.videoPlayer.style.display = 'block';

        this.videos.forEach((video, index) => {
            const item = document.createElement('div');
            item.className = 'video-item';

            const title = document.createElement('div');
            title.className = 'video-item-title';
            title.textContent = video.name.replace(/\.[^/.]+$/, '');

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'video-item-delete';
            deleteBtn.textContent = 'Delete';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeVideo(index);
            });

            item.appendChild(title);
            item.appendChild(deleteBtn);

            item.addEventListener('click', () => {
                this.playVideo(video);
            });

            this.videoList.appendChild(item);
        });

        // Load first video if player is empty
        if (!this.videoPlayer.src && this.videos.length > 0) {
            this.playVideo(this.videos[0]);
        }
    }

    playVideo(video) {
        this.videoPlayer.src = video.url;
        this.videoPlayer.load();
    }

    async removeVideo(index) {
        try {
            const video = this.videos[index];
            await storage.deleteVideoFile(video.id);
            URL.revokeObjectURL(video.url);
            
            // If this is the currently playing video, clear the player
            if (this.videoPlayer.src === video.url) {
                this.videoPlayer.src = '';
            }
            
            this.videos.splice(index, 1);
            this.renderVideoList();
        } catch (error) {
            console.error('Failed to remove video:', error);
        }
    }
}

// Initialize media upload manager when DOM is loaded
let mediaUploadManager;
document.addEventListener('DOMContentLoaded', () => {
    mediaUploadManager = new MediaUploadManager();
});
