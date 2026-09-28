const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');
const { requireGoogleAuth } = require('../middleware/authMiddleware');

router.get('/', requireGoogleAuth, (req, res) => searchController.search(req, res));

module.exports = router;
