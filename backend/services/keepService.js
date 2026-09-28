const https = require('https');

class KeepService {
  constructor() {
    this.keepScope = 'https://www.googleapis.com/auth/keep.readonly';
  }

  /**
   * Determine if an email belongs to a consumer account (@gmail.com / @googlemail.com)
   */
  isConsumerAccount(email) {
    if (!email || typeof email !== 'string') return false;
    const lower = email.toLowerCase().trim();
    return lower.endsWith('@gmail.com') || lower.endsWith('@googlemail.com');
  }

  /**
   * Search or list Google Keep notes
   * 
   * @param {Object} tokens User OAuth credentials
   * @param {string} query Search query string
   * @param {string} userEmail User's Google email address
   * @returns {Promise<Object>} Status and notes array
   */
  async search(tokens, query, userEmail = '') {
    const sanitizedQuery = (query || '').trim().toLowerCase();

    // 1. Google officially restricts the Keep API to Google Workspace (Enterprise) accounts.
    // Personal @gmail.com accounts cannot be read via Keep API.
    if (this.isConsumerAccount(userEmail)) {
      console.log(`ℹ️ [KeepService] Account ${userEmail} is a personal Google account. Google Keep API is restricted to Workspace Enterprise accounts.`);
      return {
        available: false,
        status: 'restricted_account_type',
        reason: "Google Keep access isn't available for personal Google accounts. Google restricts the Keep API to Google Workspace (Enterprise) accounts.",
        accountType: 'consumer',
        notes: []
      };
    }

    // 2. If no valid access token exists
    if (!tokens || !tokens.access_token) {
      return {
        available: false,
        status: 'unauthenticated',
        reason: 'Google Account not connected.',
        notes: []
      };
    }

    // 3. Attempt genuine call to Google Keep REST API
    try {
      const result = await this.fetchKeepNotesFromGoogle(tokens.access_token, sanitizedQuery);
      return result;
    } catch (err) {
      console.warn('⚠️ [KeepService] Google Keep API request failed:', err.message);
      return {
        available: false,
        status: 'api_error',
        reason: err.message || "Couldn't access Google Keep API.",
        notes: []
      };
    }
  }

  /**
   * Real call to Google Keep API endpoint (https://keep.googleapis.com/v1/notes)
   */
  fetchKeepNotesFromGoogle(accessToken, query = '') {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'keep.googleapis.com',
        path: '/v1/notes',
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(body);
              const rawNotes = data.notes || [];
              const filtered = query
                ? rawNotes.filter(n => {
                    const title = (n.title || '').toLowerCase();
                    const text = (n.body?.text?.text || '').toLowerCase();
                    return title.includes(query) || text.includes(query);
                  })
                : rawNotes;

              const normalized = filtered.map(n => ({
                id: n.name || n.id,
                source: 'keep',
                title: n.title || 'Untitled Note',
                description: n.body?.text?.text || '',
                content: n.body?.text?.text || '',
                formattedDate: n.updateTime ? new Date(n.updateTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Google Keep',
                url: `https://keep.google.com/#NOTE/${(n.name || '').split('/').pop()}`
              }));

              resolve({
                available: true,
                status: 'connected',
                notes: normalized
              });
            } catch (parseErr) {
              reject(new Error('Failed to parse Google Keep response'));
            }
          } else {
            let errorMsg = `Google Keep API returned HTTP ${res.statusCode}`;
            try {
              const errObj = JSON.parse(body);
              if (errObj.error && errObj.error.message) {
                errorMsg = errObj.error.message;
              }
            } catch (e) {}

            resolve({
              available: false,
              statusCode: res.statusCode,
              status: res.statusCode === 403 ? 'enterprise_restricted' : 'api_error',
              reason: res.statusCode === 403
                ? "Google Keep access isn't available for this account. The Keep API requires Google Workspace Enterprise delegation."
                : errorMsg,
              notes: []
            });
          }
        });
      });

      req.on('error', (e) => reject(e));
      req.end();
    });
  }
}

module.exports = new KeepService();
