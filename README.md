# BEAS - WebGL Music Website

A fully functional, immersive music website featuring WebGL 3D graphics with a modern aesthetic. Built entirely with client-side technologies (no backend required).

![Theme](https://img.shields.io/badge/Theme-Rock%2FMayan-8B4513)
![Tech](https://img.shields.io/badge/Tech-WebGL%20%7C%20Three.js-556B2F)
![Status](https://img.shields.io/badge/Status-Complete-CD853F)

## 🎨 Features

### 🌟 WebGL 3D Visual Experience
- **Three.js powered** immersive 3D background
- Mayan-inspired rotating glyphs and geometric shapes
- Dynamic particle system with earth-tone colors
- Atmospheric fog and lighting effects
- Fully responsive canvas that adapts to any screen size

### 🎵 Advanced Audio Player
- Custom HTML5 audio player with full controls
- **Real-time audio visualization** using Web Audio API
- Frequency bar visualization with earth-tone gradients
- Playlist management (play, pause, skip, delete)
- Volume control and progress tracking
- Persistent playback state

### 📤 Media Upload & Management
- **MP3 Upload**: Add your music files (up to 50MB each)
- **MP4 Upload**: Upload video content (up to 100MB each)
- Client-side storage using **IndexedDB**
- Visual media library with easy management
- Delete and organize your media files

### 📝 Content Management
- **Editable Bio Section**: Rich text editing with localStorage persistence
- **Events Management**: Add, edit, delete, and filter upcoming/past shows
- Calendar-style event cards with venue, location, and ticket links
- Filter events by upcoming, past, or all

### 🖼️ Gallery & UI
- Responsive photo gallery with grid layout
- Lightbox viewing experience
- Mayan glyph-inspired iconography throughout
- Earth-tone color palette (browns, terracottas, jade greens, obsidian blacks)

### 📷 Instagram Feed Integration
- **Live Instagram feed** displaying recent posts
- Multiple integration options: Juicer.io, Instagram API, or manual upload
- Responsive grid layout (3 columns desktop, 2 tablet, 1 mobile)
- Hover effects showing post stats (likes, comments) and caption preview
- Direct links to Instagram posts
- Automatic caching for better performance
- Loading and error states

### 📱 Fully Responsive
- Mobile-first design approach
- Hamburger menu for mobile navigation
- Smooth scrolling between sections
- Touch-friendly controls
- Optimized for tablets and desktops

### 📧 Communication Features
- Newsletter signup form with email validation
- Contact form with client-side validation
- Social media integration (Spotify, YouTube, Instagram, Facebook)
- All form data stored in localStorage for demonstration

## 🎨 Color Palette (Earth Tones)

```css
Primary:    #8B4513  /* Saddle Brown */
Secondary:  #CD853F  /* Peru/Terracotta */
Accent:     #556B2F  /* Dark Olive Green/Jade */
Dark:       #2F2F2F  /* Obsidian */
Light:      #D2B48C  /* Tan/Stone */
Background: #1A1A1A  /* Very Dark Brown */
```

## 📁 File Structure

```
/
├── index.html              # Main HTML file with all sections
├── css/
│   ├── style.css          # Main styles with earth-tone theme
│   └── responsive.css     # Mobile/tablet responsive styles
├── js/
│   ├── main.js            # Navigation, forms, general functionality
│   ├── webgl-scene.js     # Three.js WebGL scene setup
│   ├── audio-player.js    # Audio player with visualization
│   ├── media-upload.js    # MP3/MP4 upload handler
│   ├── storage.js         # IndexedDB & localStorage management
│   └── events.js          # Events CRUD operations
├── assets/
│   ├── fonts/             # (Optional) Custom fonts
│   ├── textures/          # (Optional) 3D textures
│   └── icons/             # (Optional) Custom icons
└── README.md              # This file
```

## 🚀 Quick Start

### Local Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/marcusg999/music-website.git
   cd music-website
   ```

2. **Open in browser**:
   - Simply open `index.html` in a modern web browser
   - Or use a local server:
     ```bash
     # Python 3
     python -m http.server 8000
     
     # Node.js with http-server
     npx http-server -p 8000
     ```

3. **Visit**: `http://localhost:8000`

### Requirements
- Modern web browser with WebGL support (Chrome, Firefox, Safari, Edge)
- JavaScript enabled
- IndexedDB support for media storage

## 🌐 Deployment

### GitHub Pages

1. Push your code to GitHub
2. Go to repository Settings → Pages
3. Select branch (usually `main`) and root directory
4. Save and wait for deployment
5. Your site will be live at: `https://yourusername.github.io/music-website/`

### Other Hosting Options
- **Netlify**: Drag and drop the folder
- **Vercel**: Import from GitHub
- **Firebase Hosting**: Use Firebase CLI
- **Any static host**: Upload all files

## 💡 Usage Guide

### Uploading Music
1. Click "Upload Audio (MP3)" button
2. Select one or multiple MP3 files
3. Files are stored in IndexedDB
4. Play tracks from the playlist

### Uploading Videos
1. Click "Upload Video (MP4)" button
2. Select MP4 files
3. Click on video thumbnails to play

### Managing Events
1. Click "Add Event" button
2. Fill in date, venue, location, and optional ticket link
3. Events auto-filter into upcoming/past
4. Delete events with the delete button

### Editing Bio
1. Click into the bio text area
2. Edit content directly
3. Click "Save Bio" to persist changes

### Forms
- Newsletter forms store data in localStorage
- Contact form sends emails via EmailJS (requires configuration)
- Check browser console or localStorage to see submitted data

## 📧 Email Configuration Setup

This website uses EmailJS to send contact form submissions via email.

### Steps to Configure EmailJS:

1. **Create EmailJS Account**
   - Go to https://www.emailjs.com/
   - Sign up for a free account (allows 200 emails/month)

2. **Add Email Service**
   - In EmailJS dashboard, go to "Email Services"
   - Click "Add New Service"
   - Choose your email provider (Gmail, Outlook, etc.)
   - Connect your email account

3. **Create Email Template**
   - Go to "Email Templates"
   - Click "Create New Template"
   - Use this template structure:

   **Subject:** New Contact Form Submission from {{from_name}}
   
   **Body:**
   ```
   You have received a new message from your website contact form.

   Name: {{from_name}}
   Email: {{from_email}}
   
   Message:
   {{message}}
   
   ---
   Sent from BEAS Music Website
   Timestamp: {{timestamp}}
   ```

4. **Get Your Credentials**
   - Service ID: Found in "Email Services" section
   - Template ID: Found in "Email Templates" section
   - Public Key: Found in "Account" > "General" section

5. **Update Configuration File**
   - Open `js/email-config.js`
   - Replace placeholder values with your credentials:
   ```javascript
   window.emailConfig = {
       serviceId: 'YOUR_SERVICE_ID',
       templateId: 'YOUR_TEMPLATE_ID',
       publicKey: 'YOUR_PUBLIC_KEY',
       recipientEmail: 'your-email@example.com'
   };
   ```

6. **Test the Form**
   - Submit a test message through your contact form
   - Check your email for the message
   - Messages are also saved to localStorage as backup

### How Contact Form Works

- **With EmailJS configured**: Submissions are sent via email AND saved to localStorage
- **Without EmailJS**: Submissions are only saved to localStorage with a warning message
- **On email failure**: Form keeps the data so users don't lose their message
- **Email validation**: Checks for valid email format and required fields (minimum 10 characters for message)
- **Loading states**: Shows "Sending..." during submission
- **Success/Error notifications**: Visual feedback after submission

## 🛠️ Technologies Used

- **Three.js** (r128): WebGL 3D graphics library
- **EmailJS**: Client-side email sending service
- **Web Audio API**: Real-time audio analysis and visualization
- **IndexedDB API**: Client-side storage for media files
- **localStorage**: Persistent storage for text content
- **HTML5 Canvas**: Audio visualization rendering
- **CSS Grid & Flexbox**: Responsive layouts
- **CSS Custom Properties**: Dynamic theming
- **Vanilla JavaScript**: No frameworks, pure JS
- **Intersection Observer API**: Scroll animations

## 📊 Browser Support

| Browser | Version | Support |
|---------|---------|---------|
| Chrome  | 60+     | ✅ Full |
| Firefox | 55+     | ✅ Full |
| Safari  | 11+     | ✅ Full |
| Edge    | 79+     | ✅ Full |

## 🎯 Performance Optimization

- Efficient WebGL rendering with requestAnimationFrame
- Lazy-loaded audio/video files
- Optimized particle system (1500 particles)
- Minimal DOM manipulation
- CSS transforms for smooth animations
- Blob URLs for media storage

## 🔧 Customization

### Changing Colors
Edit CSS variables in `css/style.css`:
```css
:root {
    --color-primary: #YourColor;
    --color-secondary: #YourColor;
    /* ... */
}
```

### Modifying WebGL Scene
Edit `js/webgl-scene.js`:
- Adjust particle count
- Change glyph geometries
- Modify lighting and fog

### Audio Visualizer
Customize in `js/audio-player.js`:
- Change FFT size for resolution
- Modify bar colors and gradients
- Adjust animation speed

## 📝 License

This project is open source and available under the MIT License.

## 🙏 Acknowledgments

- Inspiration: [beaslab.com](https://beaslab.com/home)
- Three.js community
- Web Audio API documentation
- Mayan cultural heritage for design inspiration

## 🐛 Known Issues

- Large media files (>100MB videos) may cause performance issues
- Safari may require user interaction before audio context initialization
- IndexedDB has browser-specific storage limits

## 🚧 Future Enhancements

- [ ] Service Worker for offline support
- [ ] PWA manifest for installability
- [ ] Additional audio visualizer types (waveform, circular)
- [ ] Image upload for gallery
- [ ] Export/import playlist feature
- [ ] Advanced audio effects (equalizer, reverb)

## 📷 Instagram Feed Setup

The website includes Instagram feed integration with multiple setup options:

### Option 1: Juicer.io (Recommended - Easiest)

1. **Sign up for Juicer.io**
   - Visit https://www.juicer.io
   - Free tier includes up to 1 social feed

2. **Connect Instagram**
   - Click "Add Social Media Account"
   - Choose Instagram
   - Authorize your Instagram account

3. **Get Feed Name**
   - In Juicer dashboard, note your feed name
   - This is typically your username or a custom name

4. **Configure Website**
   - Open `js/instagram-config.js`
   - Set `method: 'juicer'`
   - Update `juicer.feedName` with your feed name
   - Update `username` with your Instagram handle

5. **Test**
   - Reload website
   - Instagram feed should appear

### Option 2: Instagram Basic Display API

1. **Create Facebook App**
   - Go to https://developers.facebook.com
   - Create new app
   - Add "Instagram Basic Display" product

2. **Configure Instagram Basic Display**
   - Add Instagram test user
   - Generate access token
   - **Note**: Token expires every 90 days (needs refresh)

3. **Get Credentials**
   - Copy access token
   - Copy user ID

4. **Configure Website**
   - Open `js/instagram-config.js`
   - Set `method: 'official'`
   - Update `official.accessToken`
   - Update `official.userId`
   - Update `username`

### Option 3: Manual Posts (No API)

1. **Configure**
   - Open `js/instagram-config.js`
   - Set `method: 'manual'`

2. **Upload Posts**
   - Posts can be added programmatically
   - Store in localStorage as `instagramManualPosts`
   - Format: `[{id, image, caption, likes, comments, link, date}]`

### Customization

**Change number of posts:**
```javascript
postsToShow: 9 // Change to 6, 12, etc.
```

**Change cache duration:**
```javascript
cacheDuration: 30 // Minutes before refreshing feed
```

**Disable Instagram feed:**
```javascript
enabled: false
```

## 📧 Contact

For questions or suggestions, use the contact form on the website or open an issue on GitHub.

---

**Built with 🎵 and ◈ by the BEAS team** 
