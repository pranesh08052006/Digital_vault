const tokenStore = require('../services/tokenStore');

/**
 * Middleware validating that user has connected their Google Account
 */
function requireGoogleAuth(req, res, next) {
  if (!req.session || !req.session.tokens || !req.session.tokens.access_token) {
    const saved = tokenStore.loadSession();
    if (saved && saved.tokens && saved.tokens.access_token) {
      if (!req.session) req.session = {};
      req.session.tokens = saved.tokens;
      req.session.user = saved.user;
    }
  }

  if (!req.session || !req.session.tokens || !req.session.tokens.access_token) {
    return res.status(401).json({
      connected: false,
      message: 'Please connect your Google Account to search.'
    });
  }
  next();
}

module.exports = {
  requireGoogleAuth
};
