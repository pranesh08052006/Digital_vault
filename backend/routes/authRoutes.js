const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.get('/google', (req, res) => authController.redirectToGoogle(req, res));
router.get('/google/callback', (req, res) => authController.handleCallback(req, res));
router.get('/status', (req, res) => authController.getStatus(req, res));
router.post('/disconnect', (req, res) => authController.disconnect(req, res));
router.post('/sandbox-connect', (req, res) => authController.connectSandbox(req, res));

module.exports = router;
