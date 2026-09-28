const express = require('express');
const session = require('express-session');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./backend/routes/authRoutes');
const searchRoutes = require('./backend/routes/searchRoutes');
const notesRoutes = require('./backend/routes/notesRoutes');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'digital_memory_vault_phase1_secret';

// Trust proxy for tunnels/Cloudflare
app.set('trust proxy', 1);

// Enable CORS
app.use(cors({
  origin: true,
  credentials: true
}));

// Express Session configuration
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if running under HTTPS in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Body Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate Limiter for API protection
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests from this IP, please try again later.' }
});

app.use('/api/', apiLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notes', notesRoutes);

// Serve static frontend files (preserving 100% of existing UI)
app.use(express.static(path.join(__dirname)));

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Express Server explicitly on 0.0.0.0
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🚀 Digital Memory Vault Server running on port ${PORT} (0.0.0.0)`);
  console.log(`🔗 Local URL: http://localhost:${PORT}`);
  console.log(`🔗 LAN URL:   http://10.31.171.134:${PORT}`);
  console.log(`=======================================================`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.warn('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
