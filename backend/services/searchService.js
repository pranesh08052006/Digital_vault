const gmailService = require('./gmailService');
const driveService = require('./driveService');
const photosService = require('./photosService');
const calendarService = require('./calendarService');
const keepService = require('./keepService');
const notesService = require('./notesService');
const mapsService = require('./mapsService');

class SearchService {
  /**
   * Universal search across connected Google services (Gmail, Drive, Photos, Calendar, Google Keep)
   * with separation of built-in Vault Notes and contextual Google Maps / Places resolution layer.
   * 
   * @param {Object} tokens User OAuth tokens
   * @param {string} query Search query string
   */
  async searchAll(tokens, query, userEmail = '') {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return {
        query: '',
        results: { gmail: [], drive: [], photos: [], calendar: [], keep: [], notes: [], maps: { hasLocation: false, locations: [] } },
        totalResults: 0,
        errors: {}
      };
    }

    const sanitizedQuery = query.trim();

    // 1. Execute connected memory services concurrently
    const [gmailRes, driveRes, photosRes, calendarRes, keepRes, notesRes] = await Promise.allSettled([
      gmailService.search(tokens, sanitizedQuery, 10, userEmail),
      driveService.search(tokens, sanitizedQuery),
      photosService.search(tokens, sanitizedQuery, 20, userEmail),
      calendarService.search(tokens, sanitizedQuery, 20, userEmail),
      keepService.search(tokens, sanitizedQuery, userEmail),
      notesService.searchNotes(sanitizedQuery, userEmail)
    ]);

    const results = {
      gmail: [],
      drive: [],
      photos: [],
      calendar: [],
      keep: [],
      keepStatus: { available: false, reason: "Google Keep isn't available for personal Google accounts." },
      notes: [],
      maps: { hasLocation: false, query: sanitizedQuery, locations: [] }
    };

    const errors = {};

    // Process Gmail result
    if (gmailRes.status === 'fulfilled') {
      results.gmail = gmailRes.value;
      console.log(`✅ [SearchService] Gmail search returned ${gmailRes.value.length} results for "${sanitizedQuery}"`);
    } else {
      const errMsg = gmailRes.reason?.message || 'Unknown error';
      console.error(`❌ [SearchService] Gmail Search Error for "${sanitizedQuery}":`, errMsg);
      errors.gmail = `Gmail search failed: ${errMsg}`;
    }

    // Process Drive result
    if (driveRes.status === 'fulfilled') {
      results.drive = driveRes.value;
    } else {
      console.error('Drive Search Error:', driveRes.reason.message);
      errors.drive = "Google Drive couldn't be searched right now.";
    }

    // Process Photos result
    if (photosRes.status === 'fulfilled') {
      results.photos = photosRes.value;
    } else {
      console.error('Photos Search Error:', photosRes.reason.message);
      errors.photos = "Google Photos couldn't be searched right now.";
    }

    // Process Calendar result
    if (calendarRes.status === 'fulfilled') {
      results.calendar = calendarRes.value;
      console.log(`✅ [SearchService] Calendar search returned ${calendarRes.value.length} results for "${sanitizedQuery}"`);
    } else {
      const errMsg = calendarRes.reason?.message || "Google Calendar couldn't be searched right now.";
      console.error('Calendar Search Error:', errMsg);
      errors.calendar = errMsg;
    }

    // Process Google Keep result (Truthful real data or unavailable state)
    if (keepRes.status === 'fulfilled') {
      const keepData = keepRes.value;
      results.keep = keepData.notes || [];
      results.keepStatus = {
        available: Boolean(keepData.available),
        status: keepData.status,
        reason: keepData.reason || null
      };
      if (!keepData.available) {
        errors.keep = keepData.reason || "Google Keep access isn't available for this account.";
      }
      console.log(`ℹ️ [SearchService] Google Keep status: ${keepData.status || 'unknown'}, items: ${results.keep.length}`);
    } else {
      console.error('Keep Search Error:', keepRes.reason?.message);
      errors.keep = "Google Keep couldn't be accessed.";
      results.keep = [];
      results.keepStatus = { available: false, status: 'error', reason: keepRes.reason?.message };
    }

    // Process Built-in Vault Notes result (clearly separated from Google Keep)
    if (notesRes.status === 'fulfilled') {
      results.notes = notesRes.value;
    } else {
      console.error('Notes Search Error:', notesRes.reason?.message);
      results.notes = [];
    }

    // 2. Google Maps / Places Contextual Location Resolution Layer
    try {
      const mapsResult = await mapsService.resolveLocation(sanitizedQuery, results, tokens);
      results.maps = mapsResult;
    } catch (mapsErr) {
      console.error('Maps Search Error:', mapsErr.message);
      errors.maps = "Location resolution couldn't be completed right now.";
    }

    // Only real Google data and real matches contribute to totalResults
    const totalResults =
      results.gmail.length +
      results.drive.length +
      results.photos.length +
      results.calendar.length +
      results.keep.length +
      (results.maps.hasLocation ? (results.maps.locations?.length || 1) : 0);

    return {
      query: sanitizedQuery,
      results,
      totalResults,
      errors
    };
  }
}

module.exports = new SearchService();
