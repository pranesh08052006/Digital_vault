const { google } = require('googleapis');
const { createOAuth2Client, SCOPES } = require('../config/googleConfig');

class GoogleAuthService {
  /**
   * Generates the Google OAuth 2.0 authorization URL
   */
  getAuthUrl(redirectUri) {
    const oauth2Client = createOAuth2Client(redirectUri);

    console.log('Google Client ID loaded:', process.env.GOOGLE_CLIENT_ID);

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'
    });
  }

  /**
   * Exchanges an auth code for access & refresh tokens
   */
  async getTokensFromCode(code, redirectUri) {
    const oauth2Client = createOAuth2Client(redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    return tokens;
  }

  /**
   * Fetches connected user profile info (Email, Name, Avatar)
   */
  async getUserProfile(tokens, redirectUri) {
    const oauth2Client = createOAuth2Client(redirectUri);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const res = await oauth2.userinfo.get();
    
    return {
      email: res.data.email,
      name: res.data.name,
      picture: res.data.picture
    };
  }

  /**
   * Revokes the user's OAuth tokens on disconnect
   */
  async revokeTokens(tokens) {
    if (!tokens || !tokens.access_token) return;
    if (typeof tokens.access_token === 'string' && tokens.access_token.startsWith('demo_')) {
      return;
    }
    try {
      const oauth2Client = createOAuth2Client();
      oauth2Client.setCredentials(tokens);
      await oauth2Client.revokeToken(tokens.access_token);
    } catch (err) {
      console.warn('Failed to revoke Google token:', err.message);
    }
  }
}

module.exports = new GoogleAuthService();
