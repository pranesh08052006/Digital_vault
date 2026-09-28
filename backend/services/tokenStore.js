const fs = require('fs');
const path = require('path');

const TOKENS_FILE = path.join(__dirname, '..', 'data', 'tokens.json');

class TokenStore {
  constructor() {
    this.ensureDataFile();
  }

  ensureDataFile() {
    try {
      const dir = path.dirname(TOKENS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (e) {
      console.error('Error creating token directory:', e);
    }
  }

  saveSession(tokens, user) {
    try {
      this.ensureDataFile();
      const data = {
        tokens,
        user,
        updatedAt: new Date().toISOString()
      };
      fs.writeFileSync(TOKENS_FILE, JSON.stringify(data, null, 2), 'utf8');
      return true;
    } catch (e) {
      console.error('Error saving session to tokens.json:', e);
      return false;
    }
  }

  loadSession() {
    try {
      if (fs.existsSync(TOKENS_FILE)) {
        const raw = fs.readFileSync(TOKENS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.tokens && parsed.tokens.access_token) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Could not read tokens.json:', e);
    }
    return null;
  }

  clearSession() {
    try {
      if (fs.existsSync(TOKENS_FILE)) {
        fs.unlinkSync(TOKENS_FILE);
      }
    } catch (e) {
      console.warn('Error clearing tokens.json:', e);
    }
  }
}

module.exports = new TokenStore();
