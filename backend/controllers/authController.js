const googleAuthService = require('../services/googleAuthService');
const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = require('../config/googleConfig');
const tokenStore = require('../services/tokenStore');

function getEffectiveRedirectUri(req) {
  const host = req.get('host') || '';
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : (req.protocol || 'http');
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return `http://localhost:3000/api/auth/google/callback`;
  }
  if (process.env.GOOGLE_REDIRECT_URI) {
    return process.env.GOOGLE_REDIRECT_URI;
  }
  return `${protocol}://${host}/api/auth/google/callback`;
}

class AuthController {
  /**
   * GET /api/auth/google
   * Initiates Google OAuth consent page or redirects to configuration instructions if credentials are not configured
   */
  async redirectToGoogle(req, res) {
    try {
      // Clear any previous or demo session before starting real Google OAuth flow
      if (req.session) {
        delete req.session.tokens;
        delete req.session.user;
      }

      const isConfigured =
        GOOGLE_CLIENT_ID &&
        !GOOGLE_CLIENT_ID.includes('YOUR_GOOGLE_CLIENT_ID') &&
        GOOGLE_CLIENT_SECRET &&
        GOOGLE_CLIENT_SECRET.trim().length > 0;

      if (isConfigured) {
        const redirectUri = getEffectiveRedirectUri(req);
        req.session.lastRedirectUri = redirectUri;
        console.log(`🚀 Initiating Google OAuth consent redirect with Redirect URI: ${redirectUri}`);
        const authUrl = googleAuthService.getAuthUrl(redirectUri);
        return res.redirect(authUrl);
      } else {
        return res.redirect('/?config_required=true');
      }
    } catch (err) {
      console.error('❌ Error initiating Google Authentication:', err);
      return res.redirect('/?auth_error=' + encodeURIComponent(err.message));
    }
  }

  /**
   * POST /api/auth/sandbox-connect
   * Helper endpoint for instant local sandbox testing when Google Cloud keys are pending
   */
  async connectSandbox(req, res) {
    req.session.tokens = {
      access_token: 'demo_access_token_digital_memory_vault_phase1',
      refresh_token: 'demo_refresh_token',
      scope: 'gmail drive photos calendar',
      token_type: 'Bearer',
      expiry_date: Date.now() + 3600 * 1000
    };
    req.session.user = {
      name: 'Local Sandbox User',
      email: 'monesh.vault@gmail.com',
      picture: 'assets/cloud_logo.jpg',
      isDemo: true
    };
    tokenStore.saveSession(req.session.tokens, req.session.user);

    return res.json({ success: true, connected: true, email: 'monesh.vault@gmail.com' });
  }

  /**
   * GET /api/auth/google/callback
   * OAuth Callback handler
   */
  async handleCallback(req, res) {
    const { code, error } = req.query;

    if (error) {
      console.error('Google OAuth callback error:', error);
      return res.redirect('/?auth_error=' + encodeURIComponent(error));
    }

    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code from Google.' });
    }

    try {
      if (!GOOGLE_CLIENT_SECRET || GOOGLE_CLIENT_SECRET.trim() === '') {
        throw new Error('Google Client Secret is not configured in .env');
      }

      const redirectUri = req.session.lastRedirectUri || getEffectiveRedirectUri(req);
      console.log('🔄 Exchanging Google authorization code for real OAuth tokens with redirectUri:', redirectUri);
      const tokens = await googleAuthService.getTokensFromCode(code, redirectUri);
      console.log('✅ Real Google OAuth tokens received successfully!');
      console.log('🔑 Granted OAuth Scopes:', tokens.scope || 'No explicit scope property returned');

      const userProfile = await googleAuthService.getUserProfile(tokens, redirectUri);
      console.log(`👤 Connected user: ${userProfile.name} (${userProfile.email})`);

      req.session.tokens = tokens;
      req.session.user = userProfile;
      tokenStore.saveSession(tokens, userProfile);

      const userAgent = req.get('user-agent') || '';
      const isMobile = /Android|iPhone|iPad|Mobile/i.test(userAgent);

      if (isMobile) {
        const emailParam = encodeURIComponent(userProfile.email || '');
        const nameParam = encodeURIComponent(userProfile.name || '');
        const deepLinkUrl = `digitalvault://auth/callback?status=success&email=${emailParam}&name=${nameParam}`;

        return res.send(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Digital Vault - Connected</title>
            <style>
              body { background: #0b0f17; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; text-align: center; padding: 24px; box-sizing: border-box; }
              .card { background: #131b2e; border: 1px solid #1e293b; border-radius: 20px; padding: 36px 24px; max-width: 420px; width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
              .icon { font-size: 48px; margin-bottom: 16px; }
              h2 { margin: 0 0 10px 0; color: #38bdf8; font-size: 22px; font-weight: 700; }
              p { color: #94a3b8; font-size: 14px; margin-bottom: 28px; line-height: 1.6; }
              .btn { display: inline-block; background: linear-gradient(135deg, #0284c7, #2563eb); color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 9999px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 15px rgba(2, 132, 199, 0.4); transition: transform 0.2s; }
              .btn:active { transform: scale(0.97); }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="icon">✨</div>
              <h2>Google Account Connected!</h2>
              <p>Successfully signed in as <strong>${userProfile.email || userProfile.name}</strong>.<br>Returning to Digital Vault...</p>
              <a href="${deepLinkUrl}" class="btn">Return to Digital Vault</a>
            </div>
            <script>
              setTimeout(function() {
                window.location.href = "${deepLinkUrl}";
              }, 600);
            </script>
          </body>
          </html>
        `);
      }

      return res.redirect('/?connected=true');
    } catch (err) {
      console.error('❌ Error during Google token exchange:', err.message, err.response?.data || '');
      return res.redirect('/?auth_error=' + encodeURIComponent(err.message));
    }
  }

  /**
   * GET /api/auth/status
   * Returns Google connection status and authenticated user email
   */
  async getStatus(req, res) {
    let sessionUser = req.session && req.session.user ? req.session.user : null;
    let hasTokens = Boolean(req.session && req.session.tokens && req.session.tokens.access_token);
    let scopes = hasTokens && req.session.tokens ? req.session.tokens.scope : null;

    if (!hasTokens) {
      const saved = tokenStore.loadSession();
      if (saved && saved.tokens && saved.tokens.access_token) {
        hasTokens = true;
        sessionUser = saved.user;
        scopes = saved.tokens.scope;
        if (!req.session) req.session = {};
        req.session.tokens = saved.tokens;
        req.session.user = saved.user;
      }
    }

    res.json({
      connected: hasTokens,
      email: hasTokens && sessionUser ? sessionUser.email : null,
      name: hasTokens && sessionUser ? sessionUser.name : null,
      isDemo: hasTokens && sessionUser ? Boolean(sessionUser.isDemo) : false,
      scopes: scopes
    });
  }

  /**
   * POST /api/auth/disconnect
   * Removes session, revokes tokens, clears cookies
   */
  async disconnect(req, res) {
    tokenStore.clearSession();
    if (req.session && req.session.tokens) {
      await googleAuthService.revokeTokens(req.session.tokens);
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to log out.' });
      }
      res.clearCookie('connect.sid');
      return res.json({ connected: false, message: 'Google Account disconnected.' });
    });
  }
}

module.exports = new AuthController();
