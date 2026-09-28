const { google } = require('googleapis');
const { createOAuth2Client } = require('../config/googleConfig');

class CalendarService {
  /**
   * Search Google Calendar events
   * Output format normalized to: { id, source: "calendar", title, description, location, start, end, formattedDate, url, thumbnail, timestamp, relevance }
   */
  async search(tokens, query, maxResults = 20, userEmail = '') {
    if (!tokens || !tokens.access_token) {
      throw new Error('No valid Google tokens provided');
    }

    if (tokens.access_token === 'demo_access_token_digital_memory_vault_phase1') {
      return this.searchDemoData(query);
    }

    const sanitizedQuery = (query || '').trim();
    const queryLower = sanitizedQuery.toLowerCase();

    console.log(`📅 [CalendarService] Querying real Google Calendar for: "${sanitizedQuery}" (User: ${userEmail || 'authenticated'})`);

    // Verify if calendar scope is in the session token
    if (tokens.scope && !tokens.scope.includes('calendar')) {
      console.warn('⚠️ [CalendarService] Token scopes do NOT contain calendar.readonly. Granted scopes:', tokens.scope);
      throw new Error('Google Calendar permission is not granted on current token. Please disconnect and reconnect Google to authorize Calendar.');
    }

    const auth = createOAuth2Client();
    auth.setCredentials(tokens);

    auth.on('tokens', (newTokens) => {
      console.log('🔄 [CalendarService] Access token refreshed automatically');
      Object.assign(tokens, newTokens);
    });

    const calendar = google.calendar({ version: 'v3', auth });

    const cleanAlphanumeric = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const queryAlpha = cleanAlphanumeric(queryLower);
    const queryTokens = queryLower.split(/\s+/).filter(t => t.length > 0);

    const isCalendarMatch = (ev) => {
      const summary = ev.summary || '';
      const desc = ev.description || '';
      const loc = ev.location || '';
      const attendees = (ev.attendees || []).map(a => `${a.displayName || ''} ${a.email || ''}`).join(' ');
      const combined = `${summary} ${desc} ${loc} ${attendees}`.toLowerCase();
      const alpha = cleanAlphanumeric(combined);

      if (combined.includes(queryLower) || (queryAlpha.length >= 3 && alpha.includes(queryAlpha))) return true;
      if (queryAlpha.length >= 3 && alpha.startsWith(queryAlpha)) return true;
      if (queryTokens.length > 1 && queryTokens.every(tok => combined.includes(tok) || alpha.includes(cleanAlphanumeric(tok)))) return true;
      if (queryLower === 'nyk' || queryLower === 'nyc') {
        if (combined.includes('new york') || alpha.includes('newyork')) return true;
      }
      if (queryLower === 'blr') {
        if (combined.includes('bangalore') || combined.includes('bengaluru')) return true;
      }
      if (queryLower === 'maa') {
        if (combined.includes('chennai') || combined.includes('madras')) return true;
      }
      return false;
    };

    try {
      // 1. Fetch events from Google Calendar
      const [searchRes, listRes] = await Promise.allSettled([
        calendar.events.list({
          calendarId: 'primary',
          q: sanitizedQuery,
          maxResults: maxResults,
          singleEvents: true,
          orderBy: 'startTime'
        }),
        calendar.events.list({
          calendarId: 'primary',
          maxResults: 50,
          singleEvents: true,
          orderBy: 'startTime',
          timeMin: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() // Past 90 days onwards
        })
      ]);

      const candidateEvents = [
        ...(searchRes.status === 'fulfilled' ? (searchRes.value.data.items || []) : []),
        ...(listRes.status === 'fulfilled' ? (listRes.value.data.items || []) : [])
      ];

      const seenIds = new Set();
      const results = [];

      for (const event of candidateEvents) {
        if (!seenIds.has(event.id) && isCalendarMatch(event)) {
          seenIds.add(event.id);

          const startRaw = event.start ? (event.start.dateTime || event.start.date) : '';
          const endRaw = event.end ? (event.end.dateTime || event.end.date) : '';
          const formattedDate = this.formatEventDate(event.start, event.end);

          let detailedDesc = '';
          if (event.location && event.location.trim()) {
            detailedDesc += `📍 ${event.location.trim()}`;
          }
          if (event.description && event.description.trim()) {
            detailedDesc += detailedDesc ? ` • ${event.description.trim()}` : event.description.trim();
          }
          if (!detailedDesc) {
            detailedDesc = `Calendar Event • ${formattedDate}`;
          }

          const resultItem = {
            id: event.id,
            source: 'calendar',
            title: event.summary || '(Untitled Event)',
            description: detailedDesc,
            location: event.location || '',
            start: startRaw,
            end: endRaw,
            formattedDate: formattedDate,
            url: event.htmlLink || `https://calendar.google.com/calendar/u/0/r/eventedit/${event.id}`,
            thumbnail: null,
            timestamp: startRaw || new Date().toISOString(),
            relevance: 1.0
          };

          results.push(resultItem);
          console.log(`  🗓️ Match: "${resultItem.title}" (ID: ${resultItem.id}) -> ${resultItem.url}`);
        }
      }

      console.log(`📅 [CalendarService] Total verified calendar events matching "${sanitizedQuery}": ${results.length}`);
      return results;
    } catch (err) {
      const errCode = err.code || err.response?.status;
      const errMsg = err.message || '';
      const errDetails = err.response?.data?.error;

      console.error(`❌ [CalendarService] Calendar API error (HTTP ${errCode}):`, errMsg, errDetails || '');

      if (errCode === 403 || errMsg.includes('Insufficient Permission') || errMsg.includes('insufficientPermissions')) {
        throw new Error('Google Calendar permission missing. Please disconnect and reconnect Google to grant Calendar access.');
      }

      if (errMsg.includes('disabled') || errDetails?.message?.includes('disabled')) {
        console.warn('👉 Enable Google Calendar API: https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=562837382723');
        throw new Error('Google Calendar API is not enabled in Google Cloud Console.');
      }

      throw new Error(`Google Calendar error: ${errMsg}`);
    }
  }

  /**
   * Format human-readable event date & time
   */
  formatEventDate(start, end) {
    if (!start) return 'Date not specified';
    try {
      if (start.date && !start.dateTime) {
        // All-day event
        const d = new Date(start.date + 'T00:00:00');
        return `All Day • ${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`;
      }
      if (start.dateTime) {
        const startDate = new Date(start.dateTime);
        const dateStr = startDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const startTimeStr = startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        if (end && end.dateTime) {
          const endDate = new Date(end.dateTime);
          const endTimeStr = endDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
          return `${dateStr} • ${startTimeStr} - ${endTimeStr}`;
        }
        return `${dateStr} • ${startTimeStr}`;
      }
    } catch (e) {
      // Fallback
    }
    return start.dateTime || start.date || '';
  }

  searchDemoData(query) {
    const q = query.toLowerCase().trim();
    const demoEvents = [
      {
        id: 'event_001',
        source: 'calendar',
        title: 'Amazon AWS Cloud Conference 2026',
        description: 'Keynote presentation & digital vault server design session',
        location: 'Virtual Conference Hall',
        start: '2026-09-20T10:00:00Z',
        end: '2026-09-20T12:00:00Z',
        formattedDate: 'Sun, Sep 20 • 10:00 AM - 12:00 PM',
        url: 'https://calendar.google.com',
        thumbnail: null,
        timestamp: '2026-09-20T10:00:00Z',
        relevance: 1.0
      },
      {
        id: 'event_002',
        source: 'calendar',
        title: 'College Team Project Final Review Meeting',
        description: 'Final evaluation meeting with project advisor',
        location: 'Lab Room 302',
        start: '2026-09-18T14:00:00Z',
        end: '2026-09-18T15:30:00Z',
        formattedDate: 'Fri, Sep 18 • 2:00 PM - 3:30 PM',
        url: 'https://calendar.google.com',
        thumbnail: null,
        timestamp: '2026-09-18T14:00:00Z',
        relevance: 0.95
      },
      {
        id: 'event_003',
        source: 'calendar',
        title: 'Amazon Delivery Pickup Reminder',
        description: 'Locker pickup code for security hardware device',
        location: 'Hub Locker',
        start: '2026-09-16T17:00:00Z',
        end: '2026-09-16T17:30:00Z',
        formattedDate: 'Wed, Sep 16 • 5:00 PM - 5:30 PM',
        url: 'https://calendar.google.com',
        thumbnail: null,
        timestamp: '2026-09-16T17:00:00Z',
        relevance: 0.98
      },
      {
        id: 'event_004',
        source: 'calendar',
        title: 'September 2026 Birthday Celebration',
        description: 'Riverside Cafe Birthday dinner party',
        location: 'Riverside Cafe',
        start: '2026-09-19T19:00:00Z',
        end: '2026-09-19T22:00:00Z',
        formattedDate: 'Sat, Sep 19 • 7:00 PM - 10:00 PM',
        url: 'https://calendar.google.com',
        thumbnail: null,
        timestamp: '2026-09-19T19:00:00Z',
        relevance: 0.92
      }
    ];

    return demoEvents.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.location.toLowerCase().includes(q)
    );
  }
}

module.exports = new CalendarService();
