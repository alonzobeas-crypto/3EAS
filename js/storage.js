/**
 * Storage Management - IndexedDB for media files, localStorage for text content
 */

class StorageManager {
    constructor() {
        this.dbName = 'MusicWebsiteDB';
        this.dbVersion = 2;
        this.db = null;
        this.initDB();
    }

    /**
     * Initialize IndexedDB
     */
    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onerror = () => {
                console.error('Database failed to open');
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('Database opened successfully');
                resolve(this.db);
            };

            request.onupgradeneeded = (e) => {
                const db = e.target.result;

                // Create object stores if they don't exist
                if (!db.objectStoreNames.contains('audioFiles')) {
                    const audioStore = db.createObjectStore('audioFiles', { keyPath: 'id', autoIncrement: true });
                    audioStore.createIndex('name', 'name', { unique: false });
                }

                if (!db.objectStoreNames.contains('videoFiles')) {
                    const videoStore = db.createObjectStore('videoFiles', { keyPath: 'id', autoIncrement: true });
                    videoStore.createIndex('name', 'name', { unique: false });
                }

                if (!db.objectStoreNames.contains('images')) {
                    const imageStore = db.createObjectStore('images', { keyPath: 'id' });
                    imageStore.createIndex('filename', 'filename', { unique: false });
                    imageStore.createIndex('uploadDate', 'uploadDate', { unique: false });
                }

                console.log('Database setup complete');
            };
        });
    }

    /**
     * Save audio file to IndexedDB
     */
    async saveAudioFile(file) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['audioFiles'], 'readwrite');
            const store = transaction.objectStore('audioFiles');
            
            const audioData = {
                name: file.name,
                type: file.type,
                size: file.size,
                blob: file,
                uploadDate: new Date().toISOString()
            };

            const request = store.add(audioData);

            request.onsuccess = () => {
                console.log('Audio file saved:', file.name);
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('Failed to save audio file');
                reject(request.error);
            };
        });
    }

    /**
     * Save video file to IndexedDB
     */
    async saveVideoFile(file) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videoFiles'], 'readwrite');
            const store = transaction.objectStore('videoFiles');
            
            const videoData = {
                name: file.name,
                type: file.type,
                size: file.size,
                blob: file,
                uploadDate: new Date().toISOString()
            };

            const request = store.add(videoData);

            request.onsuccess = () => {
                console.log('Video file saved:', file.name);
                resolve(request.result);
            };

            request.onerror = () => {
                console.error('Failed to save video file');
                reject(request.error);
            };
        });
    }

    /**
     * Get all audio files
     */
    async getAllAudioFiles() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['audioFiles'], 'readonly');
            const store = transaction.objectStore('audioFiles');
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * Get all video files
     */
    async getAllVideoFiles() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videoFiles'], 'readonly');
            const store = transaction.objectStore('videoFiles');
            const request = store.getAll();

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * Get audio file by ID
     */
    async getAudioFile(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['audioFiles'], 'readonly');
            const store = transaction.objectStore('audioFiles');
            const request = store.get(id);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * Get video file by ID
     */
    async getVideoFile(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videoFiles'], 'readonly');
            const store = transaction.objectStore('videoFiles');
            const request = store.get(id);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * Delete audio file
     */
    async deleteAudioFile(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['audioFiles'], 'readwrite');
            const store = transaction.objectStore('audioFiles');
            const request = store.delete(id);

            request.onsuccess = () => {
                console.log('Audio file deleted');
                resolve();
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * Delete video file
     */
    async deleteVideoFile(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['videoFiles'], 'readwrite');
            const store = transaction.objectStore('videoFiles');
            const request = store.delete(id);

            request.onsuccess = () => {
                console.log('Video file deleted');
                resolve();
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * LocalStorage methods
     */

    // Save bio content
    saveBio(content) {
        localStorage.setItem('bio', content);
    }

    // Get bio content
    getBio() {
        return localStorage.getItem('bio');
    }

    // Save events
    saveEvents(events) {
        localStorage.setItem('events', JSON.stringify(events));
    }

    // Get events
    getEvents() {
        const events = localStorage.getItem('events');
        return events ? JSON.parse(events) : [];
    }

    // Save newsletter subscriptions
    saveNewsletterSubscription(email) {
        const subscriptions = this.getNewsletterSubscriptions();
        subscriptions.push({
            email: email,
            date: new Date().toISOString()
        });
        localStorage.setItem('newsletter', JSON.stringify(subscriptions));
    }

    // Get newsletter subscriptions
    getNewsletterSubscriptions() {
        const subs = localStorage.getItem('newsletter');
        return subs ? JSON.parse(subs) : [];
    }

    // Save contact messages
    saveContactMessage(message) {
        const messages = this.getContactMessages();
        messages.push({
            ...message,
            date: new Date().toISOString()
        });
        localStorage.setItem('contacts', JSON.stringify(messages));
    }

    // Get contact messages
    getContactMessages() {
        const messages = localStorage.getItem('contacts');
        return messages ? JSON.parse(messages) : [];
    }

    /**
     * Image storage methods
     */

    /**
     * Save image to IndexedDB
     */
    async saveImage(imageData) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['images'], 'readwrite');
            const store = transaction.objectStore('images');
            const request = store.add(imageData);
            
            request.onsuccess = () => {
                console.log('Image saved:', imageData.filename);
                resolve(request.result);
            };
            
            request.onerror = () => {
                console.error('Failed to save image');
                reject(request.error);
            };
        });
    }

    /**
     * Get all images
     */
    async getAllImages() {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['images'], 'readonly');
            const store = transaction.objectStore('images');
            const request = store.getAll();
            
            request.onsuccess = () => {
                resolve(request.result);
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    /**
     * Delete image
     */
    async deleteImage(id) {
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['images'], 'readwrite');
            const store = transaction.objectStore('images');
            const request = store.delete(id);
            
            request.onsuccess = () => {
                console.log('Image deleted');
                resolve();
            };
            
            request.onerror = () => {
                reject(request.error);
            };
        });
    }
}

// Create global storage instance
const storage = new StorageManager();
