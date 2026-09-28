const { google } = require('googleapis');
const { createOAuth2Client } = require('../config/googleConfig');

class DriveService {
  /**
   * Search Google Drive files
   * Output format normalized to: { id, source: "drive", title, description, url, thumbnail, timestamp, relevance }
   */
  async search(tokens, query, pageSize = 10) {
    if (!tokens || !tokens.access_token) {
      throw new Error('No valid Google tokens provided');
    }

    if (tokens.access_token === 'demo_access_token_digital_memory_vault_phase1') {
      return this.searchDemoData(query);
    }

    const auth = createOAuth2Client();
    auth.setCredentials(tokens);

    const drive = google.drive({ version: 'v3', auth });
    const sanitizedQuery = (query || '').trim();
    const queryLower = sanitizedQuery.toLowerCase();
    const cleanAlphanumeric = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const queryAlpha = cleanAlphanumeric(queryLower);
    const queryTokens = queryLower.split(/\s+/).filter(t => t.length > 0);

    const formatMime = (mime) => {
      if (!mime) return 'File';
      if (mime.includes('pdf')) return 'PDF Document';
      if (mime.includes('document') || mime.includes('word')) return 'Word Document';
      if (mime.includes('spreadsheet') || mime.includes('sheet') || mime.includes('excel')) return 'Spreadsheet';
      if (mime.includes('presentation') || mime.includes('powerpoint')) return 'Presentation';
      if (mime.includes('image')) return 'Image';
      if (mime.includes('zip') || mime.includes('rar') || mime.includes('compressed')) return 'Archive';
      if (mime.includes('folder')) return 'Folder';
      return mime.split('/').pop().toUpperCase() + ' File';
    };

    const isMatch = (filename, description) => {
      const combined = `${filename || ''} ${description || ''}`.toLowerCase();
      const alpha = cleanAlphanumeric(combined);
      if (combined.includes(queryLower) || (queryAlpha.length >= 3 && alpha.includes(queryAlpha))) return true;
      if (queryAlpha.length >= 3 && alpha.startsWith(queryAlpha)) return true;
      if (queryTokens.length > 1 && queryTokens.every(tok => combined.includes(tok) || alpha.includes(cleanAlphanumeric(tok)))) return true;
      return false;
    };

    try {
      // 1. Fetch search matches from Drive API
      const driveRes = await drive.files.list({
        q: 'trashed = false',
        pageSize: 50,
        fields: 'files(id, name, mimeType, description, size, modifiedTime, createdTime, webViewLink, thumbnailLink, iconLink)',
        spaces: 'drive'
      });

      const allFiles = driveRes.data.files || [];
      const matchedFiles = allFiles.filter(f => isMatch(f.name, f.description));

      return matchedFiles.slice(0, pageSize).map(file => {
        const typeName = formatMime(file.mimeType);
        const modDate = file.modifiedTime || file.createdTime;
        const formattedDate = modDate 
          ? new Date(modDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '';

        let sizeStr = '';
        if (file.size) {
          const kb = parseInt(file.size, 10) / 1024;
          sizeStr = kb > 1024 ? ` • ${(kb / 1024).toFixed(1)} MB` : ` • ${Math.round(kb)} KB`;
        }

        const desc = file.description 
          ? `${file.description} • ${typeName} • Modified ${formattedDate}${sizeStr}`
          : `${typeName} • Modified ${formattedDate}${sizeStr}`;

        return {
          id: file.id,
          source: 'drive',
          title: file.name,
          description: desc,
          fileType: typeName,
          formattedDate: formattedDate,
          url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
          thumbnail: file.thumbnailLink || file.iconLink || null,
          timestamp: modDate || new Date().toISOString(),
          relevance: 1.0
        };
      });
    } catch (err) {
      console.error('❌ [DriveService] Search error:', err.message);
      throw err;
    }
  }

  searchDemoData(query) {
    const q = query.toLowerCase().trim();
    const demoFiles = [
      {
        id: 'file_001',
        source: 'drive',
        title: 'Amazon_Invoice_Tax_2026.pdf',
        description: 'PDF Document • Amazon Purchasing Tax Invoice September 2026',
        url: 'https://drive.google.com',
        thumbnail: null,
        timestamp: '2026-09-10T09:15:00Z',
        relevance: 1.0
      },
      {
        id: 'file_002',
        source: 'drive',
        title: 'College_Project_System_Architecture.docx',
        description: 'Word Document • System Specifications & Diagrams',
        url: 'https://drive.google.com',
        thumbnail: null,
        timestamp: '2026-09-08T14:30:00Z',
        relevance: 0.95
      },
      {
        id: 'file_003',
        source: 'drive',
        title: 'Amazon_Prime_Service_Receipt.pdf',
        description: 'PDF Document • Membership renewal receipt',
        url: 'https://drive.google.com',
        thumbnail: null,
        timestamp: '2026-09-01T11:20:00Z',
        relevance: 0.96
      },
      {
        id: 'file_004',
        source: 'drive',
        title: 'September_2026_Travel_Itinerary.pdf',
        description: 'PDF Document • Travel guide & hotel bookings',
        url: 'https://drive.google.com',
        thumbnail: null,
        timestamp: '2026-08-25T16:00:00Z',
        relevance: 0.90
      }
    ];

    return demoFiles.filter(item =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
    );
  }
}

module.exports = new DriveService();
