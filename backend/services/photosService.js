const { google } = require('googleapis');
const { createOAuth2Client } = require('../config/googleConfig');

class PhotosService {
  /**
   * Search Google Photos media items
   * Output format normalized to: { id, source: "photos", title, description, url, thumbnail, timestamp, relevance }
   * 
   * API Limitation Note: Google Photos Library REST API restricts search across arbitrary user photo libraries 
   * for third-party apps unless photos were created by the app or explicitly selected via Google Photos Picker API.
   * Drive image search is implemented as a fallback to query user media files.
   */
  async search(tokens, query, pageSize = 20, userEmail = '') {
    if (!tokens || !tokens.access_token) {
      throw new Error('No valid Google tokens provided');
    }

    if (tokens.access_token === 'demo_access_token_digital_memory_vault_phase1') {
      console.log(`[PhotosService] Searching demo data for query: "${query}"`);
      return this.searchDemoData(query);
    }

    console.log(`🔍 [PhotosService] Querying real user Photos for: "${query}"`);
    console.log(`👤 [PhotosService] Account: ${userEmail || 'Authenticated User'}`);
    console.log(`🔑 [PhotosService] Token scopes present: ${tokens.scope || '(OAuth scopes managed by Google)'}`);

    const auth = createOAuth2Client();
    auth.setCredentials(tokens);

    auth.on('tokens', (newTokens) => {
      console.log('🔄 [PhotosService] Access token refreshed automatically');
      Object.assign(tokens, newTokens);
    });

    const queryLower = query.toLowerCase().trim();
    const cleanAlphanumeric = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const queryAlpha = cleanAlphanumeric(queryLower);
    const queryTokens = queryLower.split(/\s+/).filter(t => t.length > 0);

    // Common synonyms / aliases for vacation, trip, place searches
    const queryAliases = [queryLower, queryAlpha];
    if (queryLower === 'nyk' || queryLower === 'nyc' || queryAlpha === 'newyork') {
      queryAliases.push('new york', 'newyork', 'nyc', 'nyk', 'nagaram');
    }
    if (queryLower === 'blr' || queryAlpha === 'bangalore' || queryAlpha === 'bengaluru') {
      queryAliases.push('bangalore', 'bengaluru', 'blr');
    }
    if (queryLower === 'maa' || queryAlpha === 'chennai') {
      queryAliases.push('chennai', 'madras', 'maa');
    }
    if (queryLower === 'goa') {
      queryAliases.push('goa', 'baga', 'calangute', 'anjuna', 'panaji');
    }

    // Matching tester function
    const isPhotoMatch = (targetText) => {
      if (!targetText) return false;
      const textLower = targetText.toLowerCase();
      const textAlpha = cleanAlphanumeric(textLower);

      // 1. Direct or normalized alphanumeric match
      if (textLower.includes(queryLower) || (queryAlpha.length >= 3 && textAlpha.includes(queryAlpha))) {
        return true;
      }
      // 2. Query prefix match (e.g. "newyo" matches "newyork" or "new york")
      if (queryAlpha.length >= 3 && textAlpha.startsWith(queryAlpha)) {
        return true;
      }
      if (queryAlpha.length >= 3 && textAlpha.includes(queryAlpha)) {
        return true;
      }
      // 3. Word token matches
      if (queryTokens.length > 1 && queryTokens.every(tok => textLower.includes(tok) || textAlpha.includes(cleanAlphanumeric(tok)))) {
        return true;
      }
      // 4. Aliases
      if (queryAliases.some(alias => textLower.includes(alias) || textAlpha.includes(cleanAlphanumeric(alias)))) {
        return true;
      }
      return false;
    };

    const photoResults = [];
    const seenIds = new Set();

    // 1. Attempt Google Photos Library API retrieval
    try {
      let mediaItems = [];
      try {
        const photosRes = await auth.request({
          url: `https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=100`,
          method: 'GET'
        });
        mediaItems = photosRes.data?.mediaItems || [];
      } catch (getErr) {}

      if (mediaItems.length === 0) {
        try {
          const searchRes = await auth.request({
            url: `https://photoslibrary.googleapis.com/v1/mediaItems:search`,
            method: 'POST',
            data: {
              pageSize: 100,
              filters: {
                mediaTypeFilter: {
                  mediaTypes: ['ALL_MEDIA']
                }
              }
            }
          });
          const searchItems = searchRes.data?.mediaItems || [];
          if (searchItems.length > 0) {
            mediaItems = searchItems;
          }
        } catch (searchErr) {}
      }

      console.log(`📷 [PhotosService] Total Photos items examined: ${mediaItems.length}`);

      for (const item of mediaItems) {
        const filename = item.filename || '';
        const description = item.description || '';

        if (isPhotoMatch(`${filename} ${description}`)) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            const created = item.mediaMetadata?.creationTime;
            const formattedDate = created 
              ? new Date(created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'Google Photos';
            const width = item.mediaMetadata?.width;
            const height = item.mediaMetadata?.height;
            const dimStr = width && height ? ` • ${width}×${height}` : '';

            photoResults.push({
              id: item.id,
              source: 'photos',
              title: item.filename || 'Google Photo',
              description: item.description || `Photo taken ${formattedDate}${dimStr}`,
              formattedDate: formattedDate,
              url: item.productUrl || `https://photos.google.com/photo/${item.id}`,
              thumbnail: item.baseUrl ? `${item.baseUrl}=w500-h500` : null,
              timestamp: created || new Date().toISOString(),
              relevance: 1.0
            });
          }
        }
      }

      // Check user albums
      try {
        const [albumsRes, sharedRes] = await Promise.allSettled([
          auth.request({ url: 'https://photoslibrary.googleapis.com/v1/albums?pageSize=50', method: 'GET' }),
          auth.request({ url: 'https://photoslibrary.googleapis.com/v1/sharedAlbums?pageSize=50', method: 'GET' })
        ]);
        
        const allAlbums = [
          ...(albumsRes.status === 'fulfilled' ? (albumsRes.value.data?.albums || []) : []),
          ...(sharedRes.status === 'fulfilled' ? (sharedRes.value.data?.sharedAlbums || []) : [])
        ];

        for (const album of allAlbums) {
          if (isPhotoMatch(album.title)) {
            console.log(`📷 [PhotosService] Inspecting matched Google Photos Album: "${album.title}"`);
            const albumSearchRes = await auth.request({
              url: 'https://photoslibrary.googleapis.com/v1/mediaItems:search',
              method: 'POST',
              data: { albumId: album.id, pageSize: 50 }
            });
            const albumItems = albumSearchRes.data?.mediaItems || [];
            for (const item of albumItems) {
              if (!seenIds.has(item.id)) {
                seenIds.add(item.id);
                const created = item.mediaMetadata?.creationTime;
                const formattedDate = created 
                  ? new Date(created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : 'Google Photos';
                photoResults.push({
                  id: item.id,
                  source: 'photos',
                  title: item.filename || `${album.title} Photo`,
                  description: item.description || `Album: ${album.title} • ${formattedDate}`,
                  formattedDate: formattedDate,
                  url: item.productUrl || `https://photos.google.com/photo/${item.id}`,
                  thumbnail: item.baseUrl ? `${item.baseUrl}=w500-h500` : null,
                  timestamp: created || new Date().toISOString(),
                  relevance: 1.0
                });
              }
            }
          }
        }
      } catch (albumErr) {}
    } catch (photosErr) {}

    // 2. Query Google Drive for images (covers photos, camera uploads, screenshot syncs)
    try {
      const drive = google.drive({ version: 'v3', auth });
      const driveRes = await drive.files.list({
        q: 'trashed = false',
        pageSize: 100,
        fields: 'files(id, name, mimeType, description, size, modifiedTime, createdTime, webViewLink, thumbnailLink, imageMediaMetadata)'
      });

      const allDriveFiles = driveRes.data?.files || [];
      const driveImages = allDriveFiles.filter(f => f.mimeType && f.mimeType.startsWith('image/'));
      console.log(`📁 [PhotosService] Google Drive images in account: ${driveImages.length}`);

      for (const file of driveImages) {
        const fname = file.name || '';
        const fdesc = file.description || '';
        
        if (isPhotoMatch(`${fname} ${fdesc}`)) {
          if (!seenIds.has(file.id)) {
            seenIds.add(file.id);
            const cameraInfo = file.imageMediaMetadata?.cameraModel ? ` • 📷 ${file.imageMediaMetadata.cameraModel}` : '';
            const created = file.createdTime || file.modifiedTime;
            const formattedDate = created 
              ? new Date(created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'Google Drive Image';

            let sizeStr = '';
            if (file.size) {
              const kb = parseInt(file.size, 10) / 1024;
              sizeStr = kb > 1024 ? ` • ${(kb / 1024).toFixed(1)} MB` : ` • ${Math.round(kb)} KB`;
            }

            photoResults.push({
              id: file.id,
              source: 'photos',
              title: file.name,
              description: file.description || `Drive Image • ${formattedDate}${cameraInfo}${sizeStr}`,
              formattedDate: formattedDate,
              url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
              thumbnail: file.thumbnailLink || null,
              timestamp: created || new Date().toISOString(),
              relevance: 0.98
            });
          }
        }
      }
    } catch (driveErr) {
      console.error('❌ [PhotosService] Drive image query error:', driveErr.message);
    }

    console.log(`✅ [PhotosService] Total real photo results for "${query}": ${photoResults.length}`);
    return photoResults;
  }

  searchDemoData(query) {
    const q = query.toLowerCase().trim();
    const demoPhotos = [
      {
        id: 'photo_001',
        source: 'photos',
        title: 'Amazon River Rainforest Expedition.jpg',
        description: 'Nature Photography • Amazon Trip September 2026',
        url: 'https://photos.google.com',
        thumbnail: 'https://images.unsplash.com/photo-1519681393784-d120267933ba?auto=format&fit=crop&w=400&q=80',
        timestamp: '2026-08-15T12:00:00Z',
        relevance: 1.0
      },
      {
        id: 'photo_002',
        source: 'photos',
        title: 'College Graduation Project Presentation Photo.jpg',
        description: 'Campus Event • Final Year Presentation',
        url: 'https://photos.google.com',
        thumbnail: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=400&q=80',
        timestamp: '2026-06-20T10:00:00Z',
        relevance: 0.95
      },
      {
        id: 'photo_003',
        source: 'photos',
        title: 'September 2026 Paris Eiffel Tower Photo.jpg',
        description: 'Vacation Photography • Travel memories',
        url: 'https://photos.google.com',
        thumbnail: 'https://images.unsplash.com/photo-1499856871958-5b9627545d1a?auto=format&fit=crop&w=400&q=80',
        timestamp: '2026-08-28T19:30:00Z',
        relevance: 0.90
      }
    ];

    return demoPhotos.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
    );
  }
}

module.exports = new PhotosService();
