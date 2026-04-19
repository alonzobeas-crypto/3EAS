/**
 * Audio Player with Web Audio API Visualization
 */

class AudioPlayer {
    constructor() {
        this.audio = new Audio();
        this.playlist = [];
        this.currentTrackIndex = -1;
        this.isPlaying = false;
        
        // Audio context for visualization
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.source = null;
        this.isAudioContextInitialized = false;

        // DOM elements
        this.playPauseBtn = document.getElementById('play-pause-btn');
        this.prevBtn = document.getElementById('prev-btn');
        this.nextBtn = document.getElementById('next-btn');
        this.progressSlider = document.getElementById('progress-slider');
        this.progressFill = document.getElementById('progress-fill');
        this.currentTimeEl = document.getElementById('current-time');
        this.durationTimeEl = document.getElementById('duration-time');
        this.volumeSlider = document.getElementById('volume-slider');
        this.trackTitle = document.getElementById('track-title');
        this.trackArtist = document.getElementById('track-artist');
        this.playlistEl = document.getElementById('playlist');
        this.visualizerCanvas = document.getElementById('audio-visualizer');
        this.canvasContext = this.visualizerCanvas.getContext('2d');

        this.init();
    }

    init() {
        // Set up event listeners
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.prevBtn.addEventListener('click', () => this.playPrevious());
        this.nextBtn.addEventListener('click', () => this.playNext());
        
        this.progressSlider.addEventListener('input', (e) => {
            const time = (e.target.value / 100) * this.audio.duration;
            this.audio.currentTime = time;
        });

        this.volumeSlider.addEventListener('input', (e) => {
            this.audio.volume = e.target.value / 100;
        });

        this.audio.addEventListener('timeupdate', () => this.updateProgress());
        this.audio.addEventListener('loadedmetadata', () => this.updateDuration());
        this.audio.addEventListener('ended', () => this.playNext());

        // Set initial volume
        this.audio.volume = 0.7;

        // Load saved tracks from storage
        this.loadPlaylistFromStorage();

        // Set up canvas
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    initAudioContext() {
        if (this.isAudioContextInitialized) return;

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            
            const bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(bufferLength);

            this.source = this.audioContext.createMediaElementSource(this.audio);
            this.source.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);

            this.isAudioContextInitialized = true;
            this.visualize();
        } catch (error) {
            console.error('Failed to initialize audio context:', error);
        }
    }

    async loadPlaylistFromStorage() {
        try {
            const audioFiles = await storage.getAllAudioFiles();
            this.playlist = audioFiles.map(file => ({
                id: file.id,
                name: file.name,
                url: URL.createObjectURL(file.blob)
            }));
            this.renderPlaylist();
        } catch (error) {
            console.error('Failed to load playlist:', error);
        }
    }

    async addTrack(file) {
        try {
            const id = await storage.saveAudioFile(file);
            const track = {
                id: id,
                name: file.name,
                url: URL.createObjectURL(file)
            };
            this.playlist.push(track);
            this.renderPlaylist();
            
            // If this is the first track, load it
            if (this.playlist.length === 1) {
                this.loadTrack(0);
            }
        } catch (error) {
            console.error('Failed to add track:', error);
        }
    }

    async removeTrack(index) {
        try {
            const track = this.playlist[index];
            await storage.deleteAudioFile(track.id);
            URL.revokeObjectURL(track.url);
            this.playlist.splice(index, 1);
            
            // If currently playing track was removed
            if (index === this.currentTrackIndex) {
                this.audio.pause();
                this.isPlaying = false;
                this.currentTrackIndex = -1;
                this.updatePlayPauseButton();
            } else if (index < this.currentTrackIndex) {
                this.currentTrackIndex--;
            }
            
            this.renderPlaylist();
        } catch (error) {
            console.error('Failed to remove track:', error);
        }
    }

    renderPlaylist() {
        this.playlistEl.innerHTML = '';
        
        if (this.playlist.length === 0) {
            this.playlistEl.innerHTML = '<div style="padding: 2rem; text-align: center; opacity: 0.6;">No tracks in playlist. Upload some music!</div>';
            return;
        }

        this.playlist.forEach((track, index) => {
            const item = document.createElement('div');
            item.className = 'playlist-item';
            if (index === this.currentTrackIndex) {
                item.classList.add('active');
            }

            const info = document.createElement('div');
            info.className = 'playlist-item-info';
            
            const title = document.createElement('div');
            title.className = 'playlist-item-title';
            title.textContent = track.name.replace(/\.[^/.]+$/, '');

            info.appendChild(title);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'playlist-item-delete';
            deleteBtn.innerHTML = '✕';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeTrack(index);
            });

            item.appendChild(info);
            item.appendChild(deleteBtn);

            item.addEventListener('click', () => {
                this.loadTrack(index);
                this.play();
            });

            this.playlistEl.appendChild(item);
        });
    }

    loadTrack(index) {
        if (index < 0 || index >= this.playlist.length) return;

        this.currentTrackIndex = index;
        const track = this.playlist[index];

        this.audio.src = track.url;
        this.trackTitle.textContent = track.name.replace(/\.[^/.]+$/, '');
        this.trackArtist.textContent = 'BEAS';

        this.renderPlaylist();
    }

    async togglePlayPause() {
        if (this.playlist.length === 0) return;

        if (this.currentTrackIndex === -1) {
            this.loadTrack(0);
        }

        if (!this.isAudioContextInitialized) {
            this.initAudioContext();
        }

        if (this.isPlaying) {
            this.pause();
        } else {
            await this.play();
        }
    }

    async play() {
        try {
            await this.audio.play();
            this.isPlaying = true;
            this.updatePlayPauseButton();
        } catch (error) {
            console.error('Failed to play audio:', error);
        }
    }

    pause() {
        this.audio.pause();
        this.isPlaying = false;
        this.updatePlayPauseButton();
    }

    playNext() {
        if (this.playlist.length === 0) return;
        const nextIndex = (this.currentTrackIndex + 1) % this.playlist.length;
        this.loadTrack(nextIndex);
        this.play();
    }

    playPrevious() {
        if (this.playlist.length === 0) return;
        const prevIndex = this.currentTrackIndex - 1 < 0 ? this.playlist.length - 1 : this.currentTrackIndex - 1;
        this.loadTrack(prevIndex);
        this.play();
    }

    updatePlayPauseButton() {
        this.playPauseBtn.innerHTML = this.isPlaying ? '<span class="glyph-icon">⏸</span>' : '<span class="glyph-icon">▶</span>';
    }

    updateProgress() {
        if (this.audio.duration) {
            const progress = (this.audio.currentTime / this.audio.duration) * 100;
            this.progressSlider.value = progress;
            this.progressFill.style.width = progress + '%';
            this.currentTimeEl.textContent = this.formatTime(this.audio.currentTime);
        }
    }

    updateDuration() {
        this.durationTimeEl.textContent = this.formatTime(this.audio.duration);
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    resizeCanvas() {
        const container = this.visualizerCanvas.parentElement;
        this.visualizerCanvas.width = container.clientWidth;
        this.visualizerCanvas.height = container.clientHeight;
    }

    visualize() {
        if (!this.analyser) return;

        const draw = () => {
            requestAnimationFrame(draw);

            this.analyser.getByteFrequencyData(this.dataArray);

            // Clear canvas
            this.canvasContext.fillStyle = 'rgba(0, 0, 0, 0.2)';
            this.canvasContext.fillRect(0, 0, this.visualizerCanvas.width, this.visualizerCanvas.height);

            const barWidth = (this.visualizerCanvas.width / this.dataArray.length) * 2.5;
            let x = 0;

            for (let i = 0; i < this.dataArray.length; i++) {
                const barHeight = (this.dataArray[i] / 255) * this.visualizerCanvas.height;

                // Create gradient for bars (neon pastel)
                const gradient = this.canvasContext.createLinearGradient(0, this.visualizerCanvas.height - barHeight, 0, this.visualizerCanvas.height);
                gradient.addColorStop(0, '#FF6B9D'); // Pastel Neon Pink
                gradient.addColorStop(0.5, '#40E0D0'); // Turquoise
                gradient.addColorStop(1, '#7FFFD4'); // Aquamarine

                this.canvasContext.fillStyle = gradient;
                this.canvasContext.fillRect(x, this.visualizerCanvas.height - barHeight, barWidth, barHeight);

                x += barWidth + 1;
            }
        };

        draw();
    }
}

// Initialize audio player when DOM is loaded
let audioPlayer;
document.addEventListener('DOMContentLoaded', () => {
    audioPlayer = new AudioPlayer();
});
