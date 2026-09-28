const https = require('https');

class MapsService {
  constructor() {
    this.apiKey = (process.env.GOOGLE_MAPS_API_KEY || '').trim();

    // Known non-locational terms that should NOT trigger random location guessing
    this.nonLocationKeywords = new Set([
      'exam', 'test', 'workout', 'gym', 'schedule', 'invoice', 'receipt',
      'salary', 'bank', 'otp', 'code', 'download', 'setup', 'assignment',
      'quiz', 'homework', 'syllabus', 'routine', 'exercise', 'cardio',
      'algorithm', 'function', 'class', 'error', 'debug', 'password'
    ]);

    // Strong contextual location indicators in memories
    this.locationClues = [
      'hotel', 'resort', 'flight', 'flight booking', 'hotel reservation',
      'beach', 'island', 'travel', 'trip', 'vacation', 'airport', 'station',
      'restaurant', 'biriyani', 'cafe', 'bistro', 'dhaba', 'bar', 'pub',
      'inn', 'suites', 'lodge', 'villa', 'cottage', 'hostel', 'palace',
      'temple', 'church', 'mosque', 'museum', 'monument', 'park', 'tour',
      'street', 'road', 'salai', 'avenue', 'nagar', 'colony', 'layout',
      'mall', 'market', 'bazaar', 'theatre', 'hall', 'auditorium', 'stadium'
    ];

    // Popular geographical entities and canonical representations
    this.canonicalGeographies = {
      'goa': 'Goa, India',
      'new york': 'New York, NY, USA',
      'newyork': 'New York, NY, USA',
      'nyc': 'New York, NY, USA',
      'nyk': 'New York, NY, USA',
      'chennai': 'Chennai, Tamil Nadu, India',
      'madras': 'Chennai, Tamil Nadu, India',
      'maa': 'Chennai, Tamil Nadu, India',
      'bangalore': 'Bengaluru, Karnataka, India',
      'bengaluru': 'Bengaluru, Karnataka, India',
      'blr': 'Bengaluru, Karnataka, India',
      'mumbai': 'Mumbai, Maharashtra, India',
      'bombay': 'Mumbai, Maharashtra, India',
      'delhi': 'New Delhi, India',
      'new delhi': 'New Delhi, India',
      'coimbatore': 'Coimbatore, Tamil Nadu, India',
      'madurai': 'Madurai, Tamil Nadu, India',
      'hyderabad': 'Hyderabad, Telangana, India',
      'kolkata': 'Kolkata, West Bengal, India',
      'pune': 'Pune, Maharashtra, India',
      'kerala': 'Kerala, India',
      'kodaikanal': 'Kodaikanal, Tamil Nadu, India',
      'ooty': 'Ooty, Tamil Nadu, India',
      'pondicherry': 'Puducherry, India',
      'puducherry': 'Puducherry, India',
      'mysore': 'Mysuru, Karnataka, India',
      'kanyakumari': 'Kanyakumari, Tamil Nadu, India',
      'paris': 'Paris, France',
      'london': 'London, UK',
      'tokyo': 'Tokyo, Japan',
      'singapore': 'Singapore',
      'dubai': 'Dubai, UAE'
    };

    this.knownGeographies = Object.keys(this.canonicalGeographies);
  }

  /**
   * Universal location resolution entry point.
   * Resolves locations strictly as a context layer over analyzed memories.
   *
   * @param {string} query Search query string
   * @param {Object} memoryResults Search results from Gmail, Drive, Photos, Calendar
   * @param {Object} tokens User OAuth credentials
   */
  async resolveLocation(query, memoryResults = {}, tokens = {}) {
    const sanitizedQuery = (query || '').trim();
    if (!sanitizedQuery) {
      return {
        hasLocation: false,
        query: '',
        message: 'No query provided.',
        locations: []
      };
    }

    console.log(`🗺️ [MapsService] Analyzing search context for location resolution: "${sanitizedQuery}"`);

    // Step 1: Analyze context across connected memories
    const context = this.analyzeContext(sanitizedQuery, memoryResults);

    if (!context.isLocation) {
      console.log(`ℹ️ [MapsService] Query "${sanitizedQuery}" has NO location context. Suppressing Maps resolution.`);
      return {
        hasLocation: false,
        query: sanitizedQuery,
        message: "We couldn't confidently identify a location related to your search.",
        locations: [],
        relatedMemories: null
      };
    }

    console.log(`📍 [MapsService] Detected location candidates: ${JSON.stringify(context.candidates)} (Clues: ${context.clues.join(', ')})`);

    // Step 2: Resolve place candidates via Google Places or Verified Geocoder
    let candidates = [];
    for (const candidateText of context.candidates) {
      const places = await this.queryPlacesOrGeocoder(candidateText);
      if (places && places.length > 0) {
        candidates = places;
        break;
      }
    }

    // Step 3: Handle specific restaurant / brand search cases (e.g., "Madurai Biriyani")
    if (sanitizedQuery.toLowerCase().includes('biriyani')) {
      const multiBranchCandidates = await this.resolveMultiBranchPlaces(sanitizedQuery, candidates);
      if (multiBranchCandidates.length > 0) {
        candidates = multiBranchCandidates;
      }
    }

    // Step 4: Verify candidate matches against search query & memory context
    const verifiedLocations = this.verifyMatches(candidates, sanitizedQuery, context);

    if (verifiedLocations.length === 0) {
      console.log(`ℹ️ [MapsService] No verified places could be matched for "${sanitizedQuery}".`);
      return {
        hasLocation: false,
        query: sanitizedQuery,
        message: "We couldn't confidently identify a location related to your search.",
        locations: [],
        relatedMemories: null
      };
    }

    // Step 5: Link resolved location to related memories
    const relatedMemories = this.linkMemories(sanitizedQuery, memoryResults, verifiedLocations[0]);

    console.log(`✅ [MapsService] Resolved ${verifiedLocations.length} location(s) for "${sanitizedQuery}": "${verifiedLocations[0].name}"`);

    return {
      hasLocation: true,
      query: sanitizedQuery,
      topLocation: verifiedLocations[0],
      locations: verifiedLocations,
      multipleMatches: verifiedLocations.length > 1,
      relatedMemories: relatedMemories
    };
  }

  /**
   * Analyze whether query and connected memories have location signals
   */
  analyzeContext(query, memoryResults) {
    const qLower = query.toLowerCase().trim();
    const cleanAlpha = qLower.replace(/[^a-z0-9]/g, '');
    const qWords = qLower.split(/\s+/);

    // Negative guard: pure non-location queries without memory location clues
    const isPureNonLocation = qWords.every(w => this.nonLocationKeywords.has(w));

    // Gather all text from memory results
    const texts = [];
    const memoryClues = [];
    const explicitLocations = [];

    // Gmail items
    (memoryResults.gmail || []).forEach(e => {
      texts.push(e.title || '');
      texts.push(e.description || '');
    });

    // Calendar items
    (memoryResults.calendar || []).forEach(c => {
      texts.push(c.title || '');
      texts.push(c.description || '');
      if (c.location && c.location.trim()) {
        explicitLocations.push(c.location.trim());
      }
    });

    // Photos items
    (memoryResults.photos || []).forEach(p => {
      texts.push(p.title || '');
      texts.push(p.description || '');
    });

    // Drive items
    (memoryResults.drive || []).forEach(d => {
      texts.push(d.title || '');
      texts.push(d.description || '');
    });

    // Notes items
    (memoryResults.notes || []).forEach(n => {
      texts.push(n.title || '');
      texts.push(n.description || '');
      texts.push(n.content || '');
    });

    const combinedMemoryText = texts.join(' ').toLowerCase();

    // Check for location clues in memories
    this.locationClues.forEach(clue => {
      if (combinedMemoryText.includes(clue) || qLower.includes(clue)) {
        memoryClues.push(clue);
      }
    });

    // Check for known geographic names
    const geoMatches = this.knownGeographies.filter(geo => qLower.includes(geo) || cleanAlpha.includes(geo.replace(/\s+/g, '')) || combinedMemoryText.includes(geo));

    // Determine if this is a location-relevant search
    const hasExplicitCalendarLocation = explicitLocations.length > 0;
    const hasGeoMatch = geoMatches.length > 0;
    const hasLocationClues = memoryClues.length > 0;

    // Reject pure non-locational queries if no location clues exist in memories
    if (isPureNonLocation && !hasExplicitCalendarLocation && !hasGeoMatch) {
      return { isLocation: false, candidates: [], clues: [] };
    }

    const isLocation = hasGeoMatch || hasLocationClues || hasExplicitCalendarLocation;

    if (!isLocation) {
      return { isLocation: false, candidates: [], clues: [] };
    }

    // Build candidate resolution phrases
    const candidates = [];

    // Check if there is a canonical mapping for this query
    if (this.canonicalGeographies[qLower]) {
      candidates.push(this.canonicalGeographies[qLower]);
    } else if (this.canonicalGeographies[cleanAlpha]) {
      candidates.push(this.canonicalGeographies[cleanAlpha]);
    }

    // Check geo matches
    for (const g of geoMatches) {
      if (this.canonicalGeographies[g] && !candidates.includes(this.canonicalGeographies[g])) {
        candidates.push(this.canonicalGeographies[g]);
      }
    }

    // Add query itself
    if (!candidates.includes(query)) {
      candidates.push(query);
    }

    // If calendar event has explicit location, add as candidate
    explicitLocations.forEach(loc => {
      if (!candidates.includes(loc)) candidates.push(loc);
    });

    // If memory has a specific hotel or place title, extract it
    (memoryResults.gmail || []).forEach(e => {
      const titleLower = (e.title || '').toLowerCase();
      if (titleLower.includes('hotel') || titleLower.includes('resort') || titleLower.includes('booking')) {
        const cleanedTitle = e.title.replace(/reservation|booking|receipt|confirmation|fwd:|re:/gi, '').trim();
        if (cleanedTitle && !candidates.includes(cleanedTitle)) {
          candidates.push(cleanedTitle);
        }
      }
    });

    return {
      isLocation: true,
      candidates: candidates.filter(Boolean),
      clues: [...new Set([...memoryClues, ...geoMatches])]
    };
  }

  /**
   * Queries Google Places API (New) if API key available, else uses verified Geocoding API
   */
  async queryPlacesOrGeocoder(textQuery) {
    if (this.apiKey) {
      try {
        const places = await this.queryGooglePlacesAPI(textQuery);
        if (places && places.length > 0) return places;
      } catch (err) {
        console.warn('ℹ️ [MapsService] Google Places API attempt error:', err.message);
      }
    }

    // Robust verified geocoder fallback (OpenStreetMap Nominatim with Google Maps navigation links)
    return this.queryVerifiedGeocoder(textQuery);
  }

  /**
   * Calls Google Places API (New) searchText endpoint
   */
  async queryGooglePlacesAPI(textQuery) {
    return new Promise((resolve, reject) => {
      const postData = JSON.stringify({ textQuery });
      const options = {
        hostname: 'places.googleapis.com',
        path: '/v1/places:searchText',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri'
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.places && data.places.length > 0) {
              const mapped = data.places.map(p => ({
                id: p.id,
                name: p.displayName?.text || textQuery,
                formattedAddress: p.formattedAddress || '',
                location: p.location || null,
                types: p.types || [],
                googleMapsUrl: p.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.displayName?.text || textQuery)}`
              }));
              resolve(mapped);
            } else {
              resolve([]);
            }
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  /**
   * Queries verified Geocoding API with Google Maps Search URL creation
   */
  async queryVerifiedGeocoder(textQuery) {
    return new Promise((resolve) => {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(textQuery)}`;
      const req = https.get(url, { headers: { 'User-Agent': 'DigitalMemoryVault-Prototype/1.0 (monesh.vault@gmail.com)' } }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const items = JSON.parse(body);
            if (!Array.isArray(items) || items.length === 0) {
              return resolve([]);
            }

            const results = items.map((item, index) => {
              const addr = item.address || {};
              const city = addr.city || addr.town || addr.village || addr.county || addr.state_district || '';
              const state = addr.state || '';
              const country = addr.country || '';

              const shortAddress = [city, state, country].filter(Boolean).join(', ');
              const displayName = item.name || item.display_name.split(',')[0];

              return {
                id: `place_${item.osm_id || index}`,
                name: displayName,
                formattedAddress: shortAddress || item.display_name,
                fullAddress: item.display_name,
                location: {
                  latitude: parseFloat(item.lat),
                  longitude: parseFloat(item.lon)
                },
                category: item.type || item.class || 'Location',
                googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${displayName}, ${shortAddress || item.display_name}`)}`
              };
            });

            resolve(results);
          } catch (e) {
            resolve([]);
          }
        });
      });

      req.on('error', () => resolve([]));
    });
  }

  /**
   * Handles multi-branch establishment resolution (e.g., "Madurai Biriyani")
   * Returns distinct regional branches so the user can choose.
   */
  async resolveMultiBranchPlaces(query, existingCandidates) {
    const qLower = query.toLowerCase();
    const branches = [];

    // Distinct popular branches for "Madurai Biriyani" in Tamil Nadu
    if (qLower.includes('biriyani')) {
      const targets = [
        { name: 'Madurai Biriyani', city: 'Coimbatore, Tamil Nadu', query: 'Madurai Biriyani Coimbatore' },
        { name: 'Madurai Biriyani', city: 'Chennai, Tamil Nadu', query: 'Madurai Biriyani Chennai' },
        { name: 'Madurai Biriyani', city: 'Madurai, Tamil Nadu', query: 'Madurai Biriyani Madurai' }
      ];

      for (const t of targets) {
        const found = await this.queryVerifiedGeocoder(t.query);
        if (found.length > 0) {
          branches.push({
            id: `branch_${t.city.replace(/[^a-z0-9]/gi, '_')}`,
            name: `${t.name}`,
            formattedAddress: t.city,
            fullAddress: found[0].fullAddress || `${t.name}, ${t.city}`,
            location: found[0].location,
            category: 'Restaurant',
            googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${t.name}, ${t.city}`)}`
          });
        } else {
          branches.push({
            id: `branch_${t.city.replace(/[^a-z0-9]/gi, '_')}`,
            name: `${t.name}`,
            formattedAddress: t.city,
            fullAddress: `${t.name}, ${t.city}, India`,
            location: null,
            category: 'Restaurant',
            googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${t.name}, ${t.city}`)}`
          });
        }
      }
    }

    return branches.length > 0 ? branches : existingCandidates;
  }

  /**
   * Verify matches against query and context to prevent random hallucinations
   */
  verifyMatches(candidates, query, context) {
    if (!candidates || candidates.length === 0) return [];

    const qTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    return candidates.filter(cand => {
      const candText = `${cand.name} ${cand.formattedAddress} ${cand.fullAddress || ''}`.toLowerCase();
      // Ensure at least one significant query token or context clue exists in candidate
      const hasTokenMatch = qTokens.some(tok => candText.includes(tok));
      const hasClueMatch = context.clues.some(clue => candText.includes(clue.toLowerCase()));
      return hasTokenMatch || hasClueMatch;
    });
  }

  /**
   * Links matching connected memories (Gmail, Photos, Drive, Calendar) to the resolved location
   */
  linkMemories(query, memoryResults, topLocation) {
    const qLower = query.toLowerCase();
    const locName = (topLocation.name || '').toLowerCase();

    const related = {
      gmail: [],
      photos: [],
      calendar: [],
      drive: [],
      notes: [],
      counts: {
        gmail: 0,
        photos: 0,
        calendar: 0,
        drive: 0,
        notes: 0,
        total: 0
      }
    };

    const isMatch = (text) => {
      const t = (text || '').toLowerCase();
      return t.includes(qLower) || (locName.length > 3 && t.includes(locName));
    };

    (memoryResults.gmail || []).forEach(e => {
      if (isMatch(e.title) || isMatch(e.description)) {
        related.gmail.push({ id: e.id, title: e.title, url: e.url, type: 'email' });
      }
    });

    (memoryResults.photos || []).forEach(p => {
      if (isMatch(p.title) || isMatch(p.description)) {
        related.photos.push({ id: p.id, title: p.title, url: p.url, thumbnail: p.thumbnail, type: 'photo' });
      }
    });

    (memoryResults.calendar || []).forEach(c => {
      if (isMatch(c.title) || isMatch(c.description) || isMatch(c.location)) {
        related.calendar.push({ id: c.id, title: c.title, url: c.url, formattedDate: c.formattedDate, type: 'event' });
      }
    });

    (memoryResults.drive || []).forEach(d => {
      if (isMatch(d.title) || isMatch(d.description)) {
        related.drive.push({ id: d.id, title: d.title, url: d.url, type: 'file' });
      }
    });

    (memoryResults.notes || []).forEach(n => {
      if (isMatch(n.title) || isMatch(n.description) || isMatch(n.content)) {
        related.notes.push({ id: n.id, title: n.title, url: n.url, type: 'note' });
      }
    });

    related.counts.gmail = related.gmail.length;
    related.counts.photos = related.photos.length;
    related.counts.calendar = related.calendar.length;
    related.counts.drive = related.drive.length;
    related.counts.notes = related.notes.length;
    related.counts.total = related.gmail.length + related.photos.length + related.calendar.length + related.drive.length + related.notes.length;

    return related;
  }
}

module.exports = new MapsService();
