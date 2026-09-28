const fs = require('fs');
const path = require('path');

const NOTES_FILE_PATH = path.join(__dirname, '..', 'data', 'notes.json');

class NotesService {
  constructor() {
    this.ensureDataFile();
  }

  ensureDataFile() {
    try {
      const dir = path.dirname(NOTES_FILE_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!fs.existsSync(NOTES_FILE_PATH)) {
        fs.writeFileSync(NOTES_FILE_PATH, JSON.stringify([], null, 2), 'utf8');
      }
    } catch (err) {
      console.error('Error ensuring notes data file:', err);
    }
  }

  loadNotes() {
    try {
      this.ensureDataFile();
      const content = fs.readFileSync(NOTES_FILE_PATH, 'utf8');
      return JSON.parse(content || '[]');
    } catch (err) {
      console.error('Error reading notes.json:', err);
      return [];
    }
  }

  saveNotes(notes) {
    try {
      this.ensureDataFile();
      fs.writeFileSync(NOTES_FILE_PATH, JSON.stringify(notes, null, 2), 'utf8');
      return true;
    } catch (err) {
      console.error('Error writing to notes.json:', err);
      return false;
    }
  }

  /**
   * Search notes matching query
   */
  detectLocation(text) {
    if (!text) return null;
    const candidates = [
      'Baga Beach, Goa', 'Baga beach', 'Anjuna Flea Market', 'Anjuna',
      'Calangute', 'Panaji', 'Old Goa', 'Goa',
      'Madurai Biriyani', 'Madurai', 'Chennai', 'Bangalore', 'Mumbai', 'Delhi'
    ];
    for (const c of candidates) {
      if (new RegExp(`\\b${c}\\b`, 'i').test(text)) {
        return c;
      }
    }
    return null;
  }

  formatNote(n) {
    const loc = n.location || this.detectLocation(`${n.title || ''} ${n.content || ''}`);
    const mapsUrl = loc ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc)}` : null;

    return {
      id: n.id,
      source: 'notes',
      title: n.title,
      description: n.content,
      content: n.content,
      location: loc,
      googleMapsUrl: mapsUrl,
      color: n.color || '#f59e0b',
      tags: n.tags || [],
      pinned: Boolean(n.pinned),
      timestamp: n.updatedAt || n.createdAt,
      formattedDate: new Date(n.updatedAt || n.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      url: mapsUrl || 'javascript:void(0)'
    };
  }

  /**
   * Search notes matching query
   */
  async searchNotes(query, userEmail = null) {
    const q = (query || '').toLowerCase().trim();
    if (!q) return [];

    const notes = this.loadNotes();
    const filtered = notes.filter(n => {
      // If userEmail is provided, match notes belonging to user or global notes
      if (userEmail && n.userEmail && n.userEmail !== userEmail) {
        return false;
      }
      const titleMatch = (n.title || '').toLowerCase().includes(q);
      const contentMatch = (n.content || '').toLowerCase().includes(q);
      const locationMatch = (n.location || '').toLowerCase().includes(q);
      const tagsMatch = Array.isArray(n.tags) && n.tags.some(t => t.toLowerCase().includes(q));
      return titleMatch || contentMatch || locationMatch || tagsMatch;
    });

    return filtered.map(n => this.formatNote(n));
  }

  /**
   * Get all notes for user
   */
  async getAllNotes(userEmail = null) {
    const notes = this.loadNotes();
    const userNotes = userEmail 
      ? notes.filter(n => !n.userEmail || n.userEmail === userEmail)
      : notes;

    const sorted = userNotes.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
    });

    return sorted.map(n => this.formatNote(n));
  }

  /**
   * Create a new note
   */
  async createNote({ title, content, location, color, tags, pinned }, userEmail = null) {
    const notes = this.loadNotes();
    const detectedLoc = location ? location.trim() : this.detectLocation(`${title || ''} ${content || ''}`);
    const newNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      userEmail: userEmail || 'digitalvault0005@gmail.com',
      title: (title || '').trim() || 'Untitled Note',
      content: (content || '').trim(),
      location: detectedLoc || null,
      color: color || '#f59e0b',
      tags: Array.isArray(tags) ? tags : [],
      pinned: Boolean(pinned),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    notes.unshift(newNote);
    this.saveNotes(notes);
    return this.formatNote(newNote);
  }

  /**
   * Update an existing note
   */
  async updateNote(id, updates, userEmail = null) {
    const notes = this.loadNotes();
    const index = notes.findIndex(n => n.id === id);
    if (index === -1) return null;

    if (userEmail && notes[index].userEmail && notes[index].userEmail !== userEmail) {
      throw new Error('Unauthorized to modify this note');
    }

    notes[index] = {
      ...notes[index],
      title: updates.title !== undefined ? updates.title.trim() : notes[index].title,
      content: updates.content !== undefined ? updates.content.trim() : notes[index].content,
      location: updates.location !== undefined ? updates.location.trim() : notes[index].location,
      color: updates.color || notes[index].color,
      tags: updates.tags !== undefined ? updates.tags : notes[index].tags,
      pinned: updates.pinned !== undefined ? Boolean(updates.pinned) : notes[index].pinned,
      updatedAt: new Date().toISOString()
    };

    this.saveNotes(notes);
    return this.formatNote(notes[index]);
  }

  /**
   * Delete note by id
   */
  async deleteNote(id, userEmail = null) {
    const notes = this.loadNotes();
    const index = notes.findIndex(n => n.id === id);
    if (index === -1) return false;

    if (userEmail && notes[index].userEmail && notes[index].userEmail !== userEmail) {
      throw new Error('Unauthorized to delete this note');
    }

    notes.splice(index, 1);
    this.saveNotes(notes);
    return true;
  }
}

module.exports = new NotesService();
