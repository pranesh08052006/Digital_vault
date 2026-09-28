const searchService = require('../services/searchService');

class SearchController {
  /**
   * GET /api/search?q=<query>
   * Universal search endpoint querying Gmail, Drive, Photos, and Calendar
   */
  async search(req, res) {
    try {
      const query = req.query.q;

      if (!query || typeof query !== 'string' || !query.trim()) {
        return res.status(400).json({
          error: 'Search query parameter "q" is required.'
        });
      }

      const tokens = req.session.tokens;
      const userEmail = (req.session.user && req.session.user.email) ? req.session.user.email : '';
      const searchResult = await searchService.searchAll(tokens, query, userEmail);

      res.json(searchResult);
    } catch (err) {
      console.error('Unhandled Search Controller Error:', err);
      res.status(500).json({
        error: 'An internal server error occurred while executing the search.'
      });
    }
  }
}

module.exports = new SearchController();
