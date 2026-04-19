/**
 * EmailJS Configuration
 * 
 * SETUP REQUIRED:
 * 1. Create account at https://www.emailjs.com
 * 2. Set up email service and template
 * 3. Replace values below with your credentials
 */

window.emailConfig = {
    // Your EmailJS Service ID
    serviceId: 'YOUR_SERVICE_ID',
    
    // Your EmailJS Template ID
    templateId: 'YOUR_TEMPLATE_ID',
    
    // Your EmailJS Public Key
    publicKey: 'YOUR_PUBLIC_KEY',
    
    // Email address that will receive contact form submissions
    recipientEmail: 'info@beasmusic.com',
    
    // Enable/disable email sending (set to false during development)
    enabled: true
};

// Initialize EmailJS
if (window.emailConfig.enabled && typeof emailjs !== 'undefined') {
    emailjs.init(window.emailConfig.publicKey);
}
