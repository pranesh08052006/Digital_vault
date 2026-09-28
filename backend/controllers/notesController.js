const notesService = require('../services/notesService');

class NotesController {
  async getAllNotes(req, res) {
    try {
      const userEmail = req.session?.user?.email || null;
      const notes = await notesService.getAllNotes(userEmail);
      res.json({ success: true, notes });
    } catch (err) {
      console.error('Error in getAllNotes:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async createNote(req, res) {
    try {
      const userEmail = req.session?.user?.email || null;
      const { title, content, location, color, tags, pinned } = req.body;
      const note = await notesService.createNote({ title, content, location, color, tags, pinned }, userEmail);
      res.status(201).json({ success: true, note });
    } catch (err) {
      console.error('Error in createNote:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async updateNote(req, res) {
    try {
      const userEmail = req.session?.user?.email || null;
      const { id } = req.params;
      const note = await notesService.updateNote(id, req.body, userEmail);
      if (!note) {
        return res.status(404).json({ success: false, error: 'Note not found' });
      }
      res.json({ success: true, note });
    } catch (err) {
      console.error('Error in updateNote:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }

  async deleteNote(req, res) {
    try {
      const userEmail = req.session?.user?.email || null;
      const { id } = req.params;
      const deleted = await notesService.deleteNote(id, userEmail);
      if (!deleted) {
        return res.status(404).json({ success: false, error: 'Note not found' });
      }
      res.json({ success: true, message: 'Note deleted' });
    } catch (err) {
      console.error('Error in deleteNote:', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

module.exports = new NotesController();
