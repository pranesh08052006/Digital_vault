const { google } = require('googleapis');
const { createOAuth2Client } = require('../config/googleConfig');

class GmailService {
  /**
   * Search Gmail messages for query
   * Output format normalized to: { id, source: "gmail", title, description, url, thumbnail, timestamp, relevance }
   */
  async search(tokens, query, maxResults = 10, userEmail = '') {
    if (!tokens || !tokens.access_token) {
      throw new Error('No valid Google tokens provided');
    }

    if (tokens.access_token === 'demo_access_token_digital_memory_vault_phase1') {
      console.log(`[GmailService] Searching demo data for query: "${query}"`);
      return this.searchDemoData(query);
    }

    console.log(`🔍 [GmailService] Querying real Gmail mailbox for: "${query}" (User: ${userEmail || 'default'})`);

    const auth = createOAuth2Client();
    auth.setCredentials(tokens);

    // Keep session tokens updated if google-auth-library auto-refreshes
    auth.on('tokens', (newTokens) => {
      console.log('🔄 [GmailService] Access token refreshed automatically');
      Object.assign(tokens, newTokens);
    });

    const gmail = google.gmail({ version: 'v1', auth });

    // Clean HTML entities helper
    const decodeHtml = (str) => {
      if (!str) return '';
      return str
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#x2F;/g, '/')
        .replace(/&#x60;/g, '`');
    };

    // Format human readable date
    const formatSmartDate = (dateVal) => {
      if (!dateVal) return '';
      try {
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) return String(dateVal);
        const now = new Date();
        const isToday = d.toDateString() === now.toDateString();
        const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        if (isToday) return `Today at ${timeStr}`;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ` • ${timeStr}`;
      } catch (e) {
        return String(dateVal);
      }
    };

    try {
      const sanitizedQuery = query.trim();
      const qLower = sanitizedQuery.toLowerCase();
      
      // Build effective search queries to catch exact words, prefixes, and common abbreviations
      const searchQueries = [sanitizedQuery];
      if (qLower === 'nyk' || qLower === 'nyc') searchQueries.push('New York', 'Newyork');
      if (qLower === 'blr') searchQueries.push('Bangalore', 'Bengaluru');
      if (qLower === 'maa') searchQueries.push('Chennai', 'Madras');
      if (sanitizedQuery.length >= 3 && !sanitizedQuery.includes(' ')) {
        searchQueries.push(`${sanitizedQuery}*`);
      }

      // Execute search queries
      const foundMessageMap = new Map();
      for (const qStr of searchQueries) {
        try {
          const listRes = await gmail.users.messages.list({
            userId: 'me',
            q: qStr,
            maxResults: maxResults
          });
          const msgList = listRes.data.messages || [];
          for (const m of msgList) {
            if (!foundMessageMap.has(m.id)) {
              foundMessageMap.set(m.id, m);
            }
          }
          if (foundMessageMap.size >= maxResults) break;
        } catch (qErr) {
          console.warn(`[GmailService] Query attempt "${qStr}" note:`, qErr.message);
          if (qErr.message && (qErr.message.includes('invalid_grant') || qErr.code === 401)) {
            throw qErr;
          }
        }
      }

      const messages = Array.from(foundMessageMap.values()).slice(0, maxResults);
      console.log(`✉️ [GmailService] Found ${messages.length} messages matching query: "${query}"`);

      if (messages.length === 0) return [];

      const detailedMessages = await Promise.all(
        messages.map(async (msg) => {
          try {
            const detailRes = await gmail.users.messages.get({
              userId: 'me',
              id: msg.id,
              format: 'full'
            });

            const payload = detailRes.data.payload || {};
            const headers = payload.headers || [];

            const getHeader = (name) => {
              const h = headers.find((item) => item.name.toLowerCase() === name.toLowerCase());
              return h ? h.value : '';
            };

            const rawSubject = getHeader('subject') || '(No Subject)';
            const rawFrom = getHeader('from') || 'Unknown Sender';
            const rawDate = getHeader('date') || '';
            let timestamp = rawDate;
            if (!timestamp && detailRes.data.internalDate) {
              timestamp = new Date(parseInt(detailRes.data.internalDate, 10)).toISOString();
            }

            // Extract sender name and clean email
            let senderName = rawFrom;
            let senderEmail = '';
            const senderMatch = rawFrom.match(/^(.*?)\s*<(.+?)>$/);
            if (senderMatch) {
              senderName = senderMatch[1].replace(/^["']|["']$/g, '').trim() || senderMatch[2];
              senderEmail = senderMatch[2].trim();
            } else if (rawFrom.includes('@')) {
              senderEmail = rawFrom.trim();
              senderName = rawFrom.split('@')[0];
            }

            // Check for attachments in message parts
            let hasAttachments = false;
            let attachmentNames = [];
            const checkParts = (parts) => {
              if (!Array.isArray(parts)) return;
              for (const p of parts) {
                if (p.filename && p.filename.length > 0) {
                  hasAttachments = true;
                  attachmentNames.push(p.filename);
                }
                if (p.parts) checkParts(p.parts);
              }
            };
            if (payload.parts) checkParts(payload.parts);

            const decodedSnippet = decodeHtml(detailRes.data.snippet || '');
            const cleanSubject = decodeHtml(rawSubject);
            const formattedDate = formatSmartDate(timestamp);

            const messageId = msg.id;
            const threadId = detailRes.data.threadId || msg.threadId || msg.id;
            const directEmailUrl = `https://mail.google.com/mail/u/0/#all/${threadId}`;

            // Build rich detailed description
            let description = decodedSnippet;
            if (senderName) {
              description += ` • From: ${senderName}${senderEmail ? ` (${senderEmail})` : ''}`;
            }
            if (hasAttachments && attachmentNames.length > 0) {
              description += ` • 📎 ${attachmentNames.length} attachment(s): ${attachmentNames.slice(0, 2).join(', ')}`;
            }

            console.log(`  📧 Match: "${cleanSubject}" (Message ID: ${messageId}) -> ${directEmailUrl}`);

            return {
              id: messageId,
              messageId: messageId,
              threadId: threadId,
              source: 'gmail',
              title: cleanSubject,
              sender: senderName,
              senderEmail: senderEmail,
              snippet: decodedSnippet,
              description: description,
              formattedDate: formattedDate,
              hasAttachments: hasAttachments,
              attachmentNames: attachmentNames,
              url: directEmailUrl,
              thumbnail: null,
              timestamp: timestamp || new Date().toISOString(),
              relevance: 1.0
            };
          } catch (err) {
            console.warn(`⚠️ [GmailService] Failed to fetch message details for ${msg.id}:`, err.message);
            return null;
          }
        })
      );

      return detailedMessages.filter(Boolean);
    } catch (err) {
      console.error(`❌ [GmailService] Gmail API request failed for query "${query}":`, {
        message: err.message,
        status: err.code || err.status,
        details: err.response?.data?.error || err.response?.data
      });
      throw err;
    }
  }

  searchDemoData(query) {
    const q = query.toLowerCase().trim();
    const demoEmails = [
      {
        id: 'msg_001',
        messageId: 'msg_001',
        threadId: 'thread_001',
        source: 'gmail',
        title: 'Amazon Order Confirmation #114-89201',
        description: 'Thank you for shopping with Amazon. Package arriving tomorrow. • From: shipment-tracking@amazon.com',
        url: 'https://mail.google.com/mail/u/0/#all/thread_001',
        thumbnail: null,
        timestamp: '2026-09-15T14:20:00Z',
        relevance: 1.0
      },
      {
        id: 'msg_002',
        messageId: 'msg_002',
        threadId: 'thread_002',
        source: 'gmail',
        title: 'College Final Year Project Submission',
        description: 'Here is the final report draft for the software engineering project. • From: professor.smith@university.edu',
        url: 'https://mail.google.com/mail/u/0/#all/thread_002',
        thumbnail: null,
        timestamp: '2026-09-14T09:15:00Z',
        relevance: 0.95
      },
      {
        id: 'msg_003',
        messageId: 'msg_003',
        threadId: 'thread_003',
        source: 'gmail',
        title: 'Amazon Web Services Monthly Bill Receipt',
        description: 'Your AWS monthly invoice for server hosting is available. • From: no-reply@amazon.com',
        url: 'https://mail.google.com/mail/u/0/#all/thread_003',
        thumbnail: null,
        timestamp: '2026-09-13T18:30:00Z',
        relevance: 0.98
      },
      {
        id: 'msg_004',
        messageId: 'msg_004',
        threadId: 'thread_004',
        source: 'gmail',
        title: 'September 2026 Travel Flight Confirmation',
        description: 'Air France Booking Reference: AF-9482. Departure 10:45 AM. • From: reservations@airfrance.com',
        url: 'https://mail.google.com/mail/u/0/#all/thread_004',
        thumbnail: null,
        timestamp: '2026-09-09T11:00:00Z',
        relevance: 0.90
      },
      {
        id: 'msg_005',
        messageId: 'msg_005',
        threadId: 'thread_005',
        source: 'gmail',
        title: 'Birthday Celebration Invitation',
        description: 'Join us this Saturday for the surprise birthday party. • From: alex.rivera@gmail.com',
        url: 'https://mail.google.com/mail/u/0/#all/thread_005',
        thumbnail: null,
        timestamp: '2026-09-07T16:45:00Z',
        relevance: 0.92
      }
    ];

    return demoEmails.filter(item => 
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
    );
  }
}

module.exports = new GmailService();
