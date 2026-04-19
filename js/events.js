/**
 * Events Management - Add, edit, delete, and filter events
 */

class EventsManager {
    constructor() {
        this.events = [];
        this.currentFilter = 'upcoming';
        
        // DOM elements
        this.eventsListEl = document.getElementById('events-list');
        this.addEventBtn = document.getElementById('add-event-btn');
        this.eventModal = document.getElementById('event-modal');
        this.eventForm = document.getElementById('event-form');
        this.modalClose = document.querySelector('.modal-close');
        this.filterBtns = document.querySelectorAll('.filter-btn');

        this.init();
    }

    init() {
        // Load events from storage
        this.loadEvents();

        // Event listeners
        this.addEventBtn.addEventListener('click', () => this.openModal());
        this.modalClose.addEventListener('click', () => this.closeModal());
        this.eventModal.addEventListener('click', (e) => {
            if (e.target === this.eventModal) this.closeModal();
        });
        this.eventForm.addEventListener('submit', (e) => this.handleSubmit(e));

        // Filter buttons
        this.filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentFilter = btn.dataset.filter;
                this.filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.renderEvents();
            });
        });

        this.renderEvents();
    }

    loadEvents() {
        this.events = storage.getEvents();
    }

    saveEvents() {
        storage.saveEvents(this.events);
    }

    openModal() {
        // Check if user is logged in
        if (!authManager || !authManager.isAdmin()) {
            if (typeof window.musicWebsite !== 'undefined') {
                window.musicWebsite.showNotification('You must be logged in to add events.', 'error');
            }
            return;
        }
        
        this.eventForm.reset();
        this.eventModal.classList.add('active');
    }

    closeModal() {
        this.eventModal.classList.remove('active');
    }

    handleSubmit(e) {
        e.preventDefault();

        // Check if user is logged in
        if (!authManager || !authManager.isAdmin()) {
            if (typeof window.musicWebsite !== 'undefined') {
                window.musicWebsite.showNotification('You must be logged in to add events.', 'error');
            }
            this.closeModal();
            return;
        }

        const eventData = {
            id: Date.now(),
            date: document.getElementById('event-date').value,
            venue: document.getElementById('event-venue').value,
            location: document.getElementById('event-location').value,
            ticketLink: document.getElementById('event-ticket-link').value
        };

        this.events.push(eventData);
        this.saveEvents();
        this.renderEvents();
        this.closeModal();
    }

    deleteEvent(id) {
        // Check if user is logged in
        if (!authManager || !authManager.isAdmin()) {
            if (typeof window.musicWebsite !== 'undefined') {
                window.musicWebsite.showNotification('You must be logged in to delete events.', 'error');
            }
            return;
        }
        
        if (confirm('Are you sure you want to delete this event?')) {
            this.events = this.events.filter(event => event.id !== id);
            this.saveEvents();
            this.renderEvents();
        }
    }

    renderEvents() {
        this.eventsListEl.innerHTML = '';

        let filteredEvents = this.events;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Filter events
        if (this.currentFilter === 'upcoming') {
            filteredEvents = this.events.filter(event => new Date(event.date) >= today);
        } else if (this.currentFilter === 'past') {
            filteredEvents = this.events.filter(event => new Date(event.date) < today);
        }

        // Sort by date
        filteredEvents.sort((a, b) => new Date(a.date) - new Date(b.date));

        if (filteredEvents.length === 0) {
            this.eventsListEl.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 3rem; opacity: 0.6;">No events found. Add some events!</div>';
            return;
        }

        filteredEvents.forEach(event => {
            const card = this.createEventCard(event);
            this.eventsListEl.appendChild(card);
        });
    }

    createEventCard(event) {
        const card = document.createElement('div');
        card.className = 'event-card';

        const eventDate = new Date(event.date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (eventDate < today) {
            card.classList.add('event-past');
        }

        // Format date
        const dateStr = this.formatEventDate(eventDate);

        // Check if admin is logged in
        const isAdmin = authManager && authManager.isAdmin();

        card.innerHTML = `
            <div class="event-date">
                <span class="glyph-icon">◐</span> ${dateStr}
            </div>
            <div class="event-venue">${event.venue}</div>
            <div class="event-location">
                <span class="glyph-icon">◈</span> ${event.location}
            </div>
            <div class="event-actions">
                ${event.ticketLink ? `<a href="${event.ticketLink}" target="_blank" class="event-ticket-link">Get Tickets</a>` : ''}
                <button class="event-delete-btn" style="display: ${isAdmin ? 'inline-block' : 'none'};">Delete</button>
            </div>
        `;

        // Add delete handler
        const deleteBtn = card.querySelector('.event-delete-btn');
        deleteBtn.addEventListener('click', () => this.deleteEvent(event.id));

        return card;
    }

    formatEventDate(date) {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const day = date.getDate();
        const month = months[date.getMonth()];
        const year = date.getFullYear();
        return `${month} ${day}, ${year}`;
    }
}

// Initialize events manager when DOM is loaded
let eventsManager;
document.addEventListener('DOMContentLoaded', () => {
    eventsManager = new EventsManager();
});
