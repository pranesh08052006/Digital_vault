const express = require('express');
const session = require('express-session');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const dns = require('dns');
const https = require('https');
require('dotenv').config();

const authRoutes = require('./backend/routes/authRoutes');
const searchRoutes = require('./backend/routes/searchRoutes');
const notesRoutes = require('./backend/routes/notesRoutes');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'digital_memory_vault_phase1_secret';

// Trust proxy for tunnels/Cloudflare
app.set('trust proxy', 1);

// Enable CORS
app.use(cors({
  origin: true,
  credentials: true
}));

// Express Session configuration
const isProduction = process.env.NODE_ENV === 'production';
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    secure: isProduction ? true : 'auto',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Body Parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate Limiter for API protection
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests from this IP, please try again later.' }
});

app.use('/api/', apiLimiter);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/notes', notesRoutes);

const net = require('net');

// Helper to verify resolved IP is not loopback, private, link-local, multicast, or cloud metadata
function isPrivateIpAddress(ip) {
  if (!ip || typeof ip !== 'string') return true;
  let cleanIp = ip.trim().toLowerCase();

  // 1. Normalize IPv4-mapped IPv6 addresses (e.g., ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (cleanIp.startsWith('::ffff:')) {
    const remainder = cleanIp.slice(7);
    if (remainder.includes('.')) {
      cleanIp = remainder;
    } else if (remainder.includes(':')) {
      const parts = remainder.split(':');
      if (parts.length === 2) {
        const high = parseInt(parts[0], 16);
        const low = parseInt(parts[1], 16);
        if (!isNaN(high) && !isNaN(low)) {
          const o1 = (high >> 8) & 255;
          const o2 = high & 255;
          const o3 = (low >> 8) & 255;
          const o4 = low & 255;
          cleanIp = `${o1}.${o2}.${o3}.${o4}`;
        }
      }
    }
  }

  const ipFamily = net.isIP(cleanIp);
  if (ipFamily === 0) {
    return true; // Not a valid standard IP string -> block
  }

  // 2. Validate IPv4 ranges
  if (ipFamily === 4) {
    const octets = cleanIp.split('.').map(Number);
    if (octets.length !== 4 || octets.some(n => isNaN(n) || n < 0 || n > 255)) {
      return true;
    }
    const [o1, o2, o3] = octets;

    // 0.0.0.0/8 (Current network / "this" network - RFC 1122)
    if (o1 === 0) return true;
    // 10.0.0.0/8 (Private - RFC 1918)
    if (o1 === 10) return true;
    // 100.64.0.0/10 (Shared Address Space / CGNAT - RFC 6598)
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true;
    // 127.0.0.0/8 (Loopback - RFC 1122)
    if (o1 === 127) return true;
    // 169.254.0.0/16 (Link-Local / Cloud Metadata - RFC 3927)
    if (o1 === 169 && o2 === 254) return true;
    // 172.16.0.0/12 (Private - RFC 1918)
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true;
    // 192.0.0.0/24 (IETF Protocol Assignments - RFC 6890)
    if (o1 === 192 && o2 === 0 && o3 === 0) return true;
    // 192.0.2.0/24 (TEST-NET-1 - RFC 5737)
    if (o1 === 192 && o2 === 0 && o3 === 2) return true;
    // 192.88.99.0/24 (6to4 Relay Anycast - RFC 3068)
    if (o1 === 192 && o2 === 88 && o3 === 99) return true;
    // 192.168.0.0/16 (Private - RFC 1918)
    if (o1 === 192 && o2 === 168) return true;
    // 198.18.0.0/15 (Benchmarking - RFC 2544)
    if (o1 === 198 && (o2 === 18 || o2 === 19)) return true;
    // 198.51.100.0/24 (TEST-NET-2 - RFC 5737)
    if (o1 === 198 && o2 === 51 && o3 === 100) return true;
    // 203.0.113.0/24 (TEST-NET-3 - RFC 5737)
    if (o1 === 203 && o2 === 0 && o3 === 113) return true;
    // 224.0.0.0/4 (Multicast) + 240.0.0.0/4 (Reserved) + 255.255.255.255 (Broadcast)
    if (o1 >= 224) return true;

    return false;
  }

  // 3. Validate IPv6 ranges
  if (ipFamily === 6) {
    // Loopback & Unspecified (::1, ::)
    if (cleanIp === '::1' || cleanIp === '::' || cleanIp === '0:0:0:0:0:0:0:1' || cleanIp === '0:0:0:0:0:0:0:0') return true;
    // Unique Local Addresses (fc00::/7 -> fc00... to fdff...)
    if (/^f[cd][0-9a-f]{2}:/i.test(cleanIp) || cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) return true;
    // Link-Local Unicast (fe80::/10 -> fe80... to febf...)
    if (/^fe[89ab][0-9a-f]:/i.test(cleanIp) || cleanIp.startsWith('fe80:')) return true;
    // Multicast (ff00::/8)
    if (/^ff[0-9a-f]{2}:/i.test(cleanIp) || cleanIp.startsWith('ff')) return true;
    // Documentation (2001:db8::/32)
    if (cleanIp.startsWith('2001:db8:') || cleanIp.startsWith('2001:0db8:')) return true;
    // Discard prefix (100::/64)
    if (cleanIp.startsWith('100::')) return true;

    return false;
  }

  return true;
}

// Custom HTTPS Agent enforcing DNS validation directly during TCP connection establishment
const secureImageAgent = new https.Agent({
  keepAlive: false,
  lookup: (hostname, options, callback) => {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }
    dns.lookup(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses || addresses.length === 0) {
        return callback(new Error('DNS resolution returned no addresses'));
      }
      for (const entry of addresses) {
        if (isPrivateIpAddress(entry.address)) {
          return callback(new Error(`Host resolved to restricted IP: ${entry.address}`));
        }
      }
      if (options && options.all) {
        return callback(null, addresses);
      }
      callback(null, addresses[0].address, addresses[0].family);
    });
  }
});

// Image proxy to bypass CORS for PDF generation and canvas rendering with strict SSRF & size protections
app.get('/api/proxy-image', (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl || typeof imageUrl !== 'string') {
    return res.status(400).send('Missing url parameter');
  }

  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch (e) {
    return res.status(400).send('Invalid URL format');
  }

  // 1. Protocol must be HTTPS
  if (parsed.protocol !== 'https:') {
    return res.status(400).send('Only HTTPS URLs are supported');
  }

  // 2. Strict Hostname Allowlist matching actual app image sources
  const hostname = parsed.hostname.toLowerCase();
  const isAllowedHost =
    hostname === 'googleusercontent.com' ||
    hostname.endsWith('.googleusercontent.com') ||
    hostname === 'drive.google.com' ||
    hostname === 'ssl.gstatic.com' ||
    hostname === 'images.unsplash.com';

  if (!isAllowedHost) {
    return res.status(403).send('Target domain is not permitted');
  }

  // 3. Prevent IP literals in URL host
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':') || hostname === 'localhost') {
    return res.status(403).send('IP address and localhost hosts are not permitted');
  }

  // 4. Execute HTTPS request with socket-level IP validation & zero redirects
  const requestOptions = {
    agent: secureImageAgent,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    timeout: 8000
  };

  const proxyReq = https.get(parsed.toString(), requestOptions, (upstreamRes) => {
    // 5. Zero-redirect policy: reject any 3xx redirect to prevent redirect-based SSRF
    if (upstreamRes.statusCode >= 300 && upstreamRes.statusCode < 400) {
      upstreamRes.resume();
      return res.status(403).send('Redirects are not permitted for image proxy');
    }

    if (upstreamRes.statusCode !== 200) {
      upstreamRes.resume();
      return res.status(upstreamRes.statusCode).send('Failed to fetch upstream image');
    }

    // 6. Enforce image Content-Type
    const contentType = upstreamRes.headers['content-type'] || '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      upstreamRes.resume();
      return res.status(400).send('Target resource is not a valid image');
    }

    // 7. Streaming response size limit (10MB max) before buffering
    const MAX_BYTES = 10 * 1024 * 1024;
    const chunks = [];
    let receivedBytes = 0;
    let aborted = false;

    upstreamRes.on('data', (chunk) => {
      if (aborted) return;
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BYTES) {
        aborted = true;
        upstreamRes.destroy();
        if (!res.headersSent) {
          return res.status(413).send('Image exceeds maximum allowed size (10MB)');
        }
      }
      chunks.push(chunk);
    });

    upstreamRes.on('end', () => {
      if (!aborted && !res.headersSent) {
        const imageBuffer = Buffer.concat(chunks);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(imageBuffer);
      }
    });

    upstreamRes.on('error', (streamErr) => {
      console.error('Image stream error:', streamErr.message);
      if (!res.headersSent) {
        res.status(500).send('Stream error');
      }
    });
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).send('Upstream image timeout');
    }
  });

  proxyReq.on('error', (err) => {
    console.error('Image proxy connection error:', err.message);
    if (!res.headersSent) {
      res.status(403).send('Image proxy connection failed or restricted: ' + err.message);
    }
  });
});

// Serve static frontend files (preserving 100% of existing UI)
app.use(express.static(path.join(__dirname)));

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

let server = null;
if (require.main === module) {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 Digital Memory Vault Server running on port ${PORT} (0.0.0.0)`);
    console.log(`🔗 Local URL: http://localhost:${PORT}`);
    console.log(`🔗 LAN URL:   http://10.31.171.134:${PORT}`);
    console.log(`=======================================================`);
  });
}

process.on('unhandledRejection', (reason, promise) => {
  console.warn('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

module.exports = { app, server, isPrivateIpAddress, secureImageAgent };

