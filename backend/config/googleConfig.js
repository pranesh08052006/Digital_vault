const { google } = require('googleapis');
require('dotenv').config();

const PORT = parseInt(process.env.PORT, 10) || 3000;
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();

// Configurable Backend base URL (e.g. https://YOUR_PUBLIC_BACKEND_DOMAIN or http://localhost:3000 for local dev)
const BACKEND_URL = (process.env.BACKEND_URL || process.env.API_BASE_URL || '').trim().replace(/\/+$/, '');

// Deriving canonical GOOGLE_REDIRECT_URI
let GOOGLE_REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI || '').trim();
if (!GOOGLE_REDIRECT_URI) {
  if (BACKEND_URL) {
    GOOGLE_REDIRECT_URI = `${BACKEND_URL}/api/auth/google/callback`;
  } else {
    // Default fallback strictly for local desktop development
    GOOGLE_REDIRECT_URI = `http://localhost:${PORT}/api/auth/google/callback`;
  }
}

const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/photoslibrary.readonly',
  'https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata',
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar.readonly'
];

function createOAuth2Client(redirectUri) {
  const finalRedirectUri = (redirectUri || process.env.GOOGLE_REDIRECT_URI || GOOGLE_REDIRECT_URI).trim();
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    finalRedirectUri
  );
}

module.exports = {
  createOAuth2Client,
  SCOPES,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI,
  BACKEND_URL,
  PORT
};
