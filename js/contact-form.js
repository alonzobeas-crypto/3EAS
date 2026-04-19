/**
 * Contact Form Handler with EmailJS Integration
 */

class ContactFormManager {
    constructor() {
        this.form = null;
        this.submitBtn = null;
        this.statusDiv = null;
        this.init();
    }

    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setupForm());
        } else {
            this.setupForm();
        }
    }

    setupForm() {
        // Find contact form
        this.form = document.querySelector('#contact-form');
        
        if (!this.form) {
            console.warn('Contact form not found');
            return;
        }

        this.submitBtn = this.form.querySelector('button[type="submit"]');
        
        // Create or find status div for messages
        this.statusDiv = this.form.querySelector('.form-status') || this.createStatusDiv();

        // Add submit event listener
        this.form.addEventListener('submit', (e) => this.handleSubmit(e));
    }

    createStatusDiv() {
        const div = document.createElement('div');
        div.className = 'form-status';
        this.form.appendChild(div);
        return div;
    }

    async handleSubmit(event) {
        event.preventDefault();

        // Get form data
        const formData = new FormData(this.form);
        const data = {
            from_name: document.getElementById('contact-name').value,
            from_email: document.getElementById('contact-email').value,
            message: document.getElementById('contact-message').value,
            timestamp: new Date().toLocaleString()
        };

        // Validate
        if (!this.validateForm(data)) {
            return;
        }

        // Check if EmailJS is configured
        if (!window.emailConfig || !window.emailConfig.enabled) {
            this.showStatus('Email service not configured. Message saved locally.', 'warning');
            this.saveToLocalStorage(data);
            return;
        }

        if (typeof emailjs === 'undefined') {
            this.showStatus('Email service not loaded. Message saved locally.', 'warning');
            this.saveToLocalStorage(data);
            this.form.reset();
            return;
        }

        // Show loading state
        this.setLoading(true);

        try {
            // Send email via EmailJS
            const response = await emailjs.send(
                window.emailConfig.serviceId,
                window.emailConfig.templateId,
                data
            );

            console.log('Email sent successfully:', response);
            
            // Show success message
            this.showStatus('Message sent successfully! We\'ll get back to you soon.', 'success');
            
            // Clear form
            this.form.reset();
            
            // Also save to localStorage as backup
            this.saveToLocalStorage(data);

        } catch (error) {
            console.error('Email send failed:', error);
            
            // Show error message
            this.showStatus('Failed to send message. Please try again or email us directly.', 'error');
            
            // Save to localStorage as fallback
            this.saveToLocalStorage(data);
        } finally {
            this.setLoading(false);
        }
    }

    validateForm(data) {
        // Check required fields
        if (!data.from_name || data.from_name.trim().length === 0) {
            this.showStatus('Please enter your name.', 'error');
            return false;
        }

        if (!data.from_email || !this.isValidEmail(data.from_email)) {
            this.showStatus('Please enter a valid email address.', 'error');
            return false;
        }

        if (!data.message || data.message.trim().length < 10) {
            this.showStatus('Please enter a message (at least 10 characters).', 'error');
            return false;
        }

        return true;
    }

    isValidEmail(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    }

    setLoading(loading) {
        if (this.submitBtn) {
            this.submitBtn.disabled = loading;
            this.submitBtn.textContent = loading ? 'Sending...' : 'Send Message';
        }

        if (loading) {
            this.form.classList.add('form-loading');
        } else {
            this.form.classList.remove('form-loading');
        }
    }

    showStatus(message, type) {
        if (!this.statusDiv) return;

        this.statusDiv.textContent = message;
        this.statusDiv.className = `form-status form-status-${type}`;
        this.statusDiv.style.display = 'block';

        // Auto-hide after 5 seconds
        setTimeout(() => {
            this.statusDiv.style.display = 'none';
        }, 5000);

        // Also use existing notification system if available
        if (window.musicWebsite && window.musicWebsite.showNotification) {
            window.musicWebsite.showNotification(message, type);
        }
    }

    saveToLocalStorage(data) {
        try {
            // Get existing messages
            const messages = JSON.parse(localStorage.getItem('contactMessages') || '[]');
            
            // Add new message
            messages.push({
                ...data,
                id: Date.now(),
                read: false
            });
            
            // Save back to localStorage
            localStorage.setItem('contactMessages', JSON.stringify(messages));
            
            console.log('Message saved to localStorage as backup');
        } catch (error) {
            console.error('Failed to save to localStorage:', error);
        }
    }
}

// Initialize contact form manager
const contactFormManager = new ContactFormManager();

// Export for potential admin panel use
window.contactFormManager = contactFormManager;
