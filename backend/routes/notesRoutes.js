const express = require('express');
const router = express.Router();
const notesController = require('../controllers/notesController');

router.get('/', (req, res) => notesController.getAllNotes(req, res));
router.post('/', (req, res) => notesController.createNote(req, res));
router.put('/:id', (req, res) => notesController.updateNote(req, res));
router.delete('/:id', (req, res) => notesController.deleteNote(req, res));

module.exports = router;
