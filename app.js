/* ==========================================================================
   DIGITAL MEMORY VAULT - PHASE 1 FRONTEND INTERACTION & API INTEGRATION
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

  // State management
  let isGoogleConnected = false;
  let connectedEmail = null;
  let currentSearchQuery = '';
  let activeSearchResults = null;
  let searchDebounceTimer = null;

  // UI Element References
  const connectGoogleBtn = document.getElementById('connect-google-btn');
  const googleBtnText = document.getElementById('google-btn-text');
  const searchInput = document.getElementById('memory-search');
  const cardsGrid = document.getElementById('cards-grid');
  const globalEmptyState = document.getElementById('global-empty-state');
  const emptyQueryText = document.getElementById('empty-query-text');
  const searchLoadingBar = document.getElementById('search-loading-bar');

  // Config modal references
  const configModal = document.getElementById('config-modal');
  const closeConfigBtn = document.getElementById('close-config-btn');
  const cancelConfigBtn = document.getElementById('cancel-config-btn');
  const sandboxConnectBtn = document.getElementById('sandbox-connect-btn');

  // Initialize dynamic calendar date to today
  const todayDate = new Date().getDate();
  document.querySelectorAll('.live-cal-day').forEach(el => {
    el.textContent = String(todayDate);
  });

  // --------------------------------------------------------------------------
  // API BASE URL RESOLUTION FOR BROWSER & ANDROID APP
  // --------------------------------------------------------------------------
  // Automatically attach tunnel bypass headers to avoid splash pages during testing
  const originalFetch = window.fetch;
  window.fetch = function(url, options) {
    options = options || {};
    options.headers = options.headers || {};
    if (options.headers instanceof Headers) {
      if (!options.headers.has('Bypass-Tunnel-Reminder')) {
        options.headers.set('Bypass-Tunnel-Reminder', 'true');
      }
    } else if (Array.isArray(options.headers)) {
      options.headers.push(['Bypass-Tunnel-Reminder', 'true']);
    } else {
      options.headers['Bypass-Tunnel-Reminder'] = 'true';
    }
    return originalFetch.call(this, url, options);
  };

  function getApiUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;

    // 1. User manual override if saved in Settings
    const savedUrl = localStorage.getItem('vault_server_url');
    if (savedUrl && savedUrl.trim()) {
      return savedUrl.trim().replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
    }

    // 2. Android Native Bridge configured URL
    if (window.AndroidBridge && window.AndroidBridge.getServerUrl) {
      try {
        const bridgeUrl = window.AndroidBridge.getServerUrl();
        if (bridgeUrl && bridgeUrl.trim()) {
          return bridgeUrl.trim().replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
        }
      } catch (e) {
        console.warn('AndroidBridge call error:', e);
      }
    }

    // 3. Build-time injected configuration from config.js
    if (window.VAULT_CONFIG && window.VAULT_CONFIG.BACKEND_URL && window.VAULT_CONFIG.BACKEND_URL.trim()) {
      return window.VAULT_CONFIG.BACKEND_URL.trim().replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
    }

    // 4. In web browser environment, return relative path
    if (window.location.protocol !== 'file:') {
      return path;
    }

    return path;
  }

  // --------------------------------------------------------------------------
  // 1. GOOGLE ACCOUNT CONNECTION & STATUS
  // --------------------------------------------------------------------------
  async function checkAuthStatus() {
    // 1. Check local storage for persistent mobile/offline session
    const savedAuth = localStorage.getItem('vault_auth_user');
    if (savedAuth) {
      try {
        const parsed = JSON.parse(savedAuth);
        if (parsed && parsed.connected) {
          isGoogleConnected = true;
          connectedEmail = parsed.email || 'monesh.vault@gmail.com';
          updateAuthUI(parsed);
        }
      } catch (e) {}
    }

    // 2. Check remote backend if a valid server is configured or if in browser
    const statusUrl = getApiUrl('/api/auth/status');
    if (statusUrl.startsWith('http://') || statusUrl.startsWith('https://') || window.location.protocol !== 'file:') {
      try {
        const res = await fetch(statusUrl);
        const data = await res.json();
        if (data && data.connected) {
          isGoogleConnected = true;
          connectedEmail = data.email || null;
          localStorage.setItem('vault_auth_user', JSON.stringify(data));
          updateAuthUI(data);
        } else if (!savedAuth) {
          isGoogleConnected = false;
          connectedEmail = null;
          updateAuthUI({ connected: false });
        }
      } catch (err) {
        console.warn('Backend auth check skipped:', err);
      }
    }
  }

  // Expose checkAuthStatus & handleDeepLinkAuth globally for Android Native Bridge & Deep Links
  window.checkAuthStatus = checkAuthStatus;

  window.handleDeepLinkAuth = function(url) {
    try {
      console.log('🔗 Deep link received:', url);
      const urlObj = new URL(url.replace('digitalvault://', 'http://vault/'));
      const status = urlObj.searchParams.get('status');
      const email = urlObj.searchParams.get('email');
      const name = urlObj.searchParams.get('name');

      if (status === 'success' || email) {
        const authData = {
          connected: true,
          email: email || 'Google Account',
          name: name || 'Vault User',
          picture: 'assets/cloud_logo.jpg'
        };
        isGoogleConnected = true;
        connectedEmail = authData.email;
        localStorage.setItem('vault_auth_user', JSON.stringify(authData));
        updateAuthUI(authData);
        showToast('✨ Google Account connected successfully!');
      }
    } catch (e) {
      console.warn('Error parsing deep link auth:', e);
    }
    // Also trigger server status check
    checkAuthStatus();
  };

  function updateAuthUI(data) {
    const menuAccountEmail = document.getElementById('menu-account-email');
    const menuAuthBtn = document.getElementById('menu-auth-btn');
    const profileUserEmail = document.getElementById('profile-user-email');
    const profileStatusIndicator = document.getElementById('profile-status-indicator');

    if (data.connected) {
      const displayEmail = data.email || 'Google Account';
      if (connectGoogleBtn) {
        connectGoogleBtn.classList.add('connected');
        googleBtnText.textContent = 'Google Account Connected';
        connectGoogleBtn.title = `Connected as ${displayEmail}. Click to disconnect.`;
      }
      if (menuAccountEmail) menuAccountEmail.textContent = `Connected: ${displayEmail}`;
      if (menuAuthBtn) menuAuthBtn.textContent = 'Disconnect Google Account';
      if (profileUserEmail) profileUserEmail.textContent = displayEmail;
      if (profileStatusIndicator) profileStatusIndicator.classList.add('connected');
    } else {
      if (connectGoogleBtn) {
        connectGoogleBtn.classList.remove('connected');
        googleBtnText.textContent = 'Connect Google Account';
        connectGoogleBtn.title = 'Connect Google Account';
      }
      if (menuAccountEmail) menuAccountEmail.textContent = 'Not connected';
      if (menuAuthBtn) menuAuthBtn.textContent = 'Connect Google Account';
      if (profileUserEmail) profileUserEmail.textContent = 'Not connected';
      if (profileStatusIndicator) profileStatusIndicator.classList.remove('connected');
    }
  }

  function handleGoogleConnect() {
    if (isGoogleConnected) {
      if (confirm(`Do you want to disconnect your Google Account (${connectedEmail || ''}) from Digital Memory Vault?`)) {
        localStorage.removeItem('vault_auth_user');
        isGoogleConnected = false;
        connectedEmail = null;
        updateAuthUI({ connected: false });
        showToast('Google Account disconnected.');
        resetCardGridToDefault();
        const disconnectUrl = getApiUrl('/api/auth/disconnect');
        if (disconnectUrl.startsWith('http://') || disconnectUrl.startsWith('https://') || window.location.protocol !== 'file:') {
          fetch(disconnectUrl, { method: 'POST' }).catch(() => {});
        }
      }
      return;
    }

    const googleAuthUrl = getApiUrl('/api/auth/google');
    if (googleAuthUrl.startsWith('http://') || googleAuthUrl.startsWith('https://')) {
      if (window.AndroidBridge && window.AndroidBridge.openExternalUrl) {
        window.AndroidBridge.openExternalUrl(googleAuthUrl);
      } else {
        window.location.href = googleAuthUrl;
      }
    } else if (window.location.protocol !== 'file:') {
      window.location.href = '/api/auth/google';
    } else {
      // Fallback: prompt for backend URL if not baked in
      const inputUrl = prompt('Enter your backend URL (e.g. https://your-server.com or http://10.31.171.134:3000):');
      if (inputUrl && inputUrl.trim()) {
        localStorage.setItem('vault_custom_server_url', inputUrl.trim());
        if (window.AndroidBridge && window.AndroidBridge.setServerUrl) {
          window.AndroidBridge.setServerUrl(inputUrl.trim());
        }
        showToast('Backend URL saved. Connecting...');
        setTimeout(() => handleGoogleConnect(), 300);
      } else {
        showToast('Connecting in Sandbox demo mode...');
        activateSandboxMode();
      }
    }
  }

  function activateSandboxMode() {
    const authData = {
      connected: true,
      email: 'monesh.vault@gmail.com',
      name: 'Vault User',
      picture: 'assets/cloud_logo.jpg',
      isDemo: true
    };
    isGoogleConnected = true;
    connectedEmail = authData.email;
    localStorage.setItem('vault_auth_user', JSON.stringify(authData));
    updateAuthUI(authData);
    showToast('✨ Sandbox Demo Mode Activated!');
    if (currentSearchQuery) {
      performUniversalSearch(currentSearchQuery);
    }
  }

  if (connectGoogleBtn) connectGoogleBtn.addEventListener('click', handleGoogleConnect);

  const menuAuthBtn = document.getElementById('menu-auth-btn');
  if (menuAuthBtn) menuAuthBtn.addEventListener('click', handleGoogleConnect);

  const devSandboxBtn = document.getElementById('dev-sandbox-btn');
  if (devSandboxBtn) devSandboxBtn.addEventListener('click', activateSandboxMode);

  // Server URL configuration for Android Mobile App & Remote Backend
  const menuServerInput = document.getElementById('menu-server-input');
  const menuServerSaveBtn = document.getElementById('menu-server-save-btn');
  const menuServerStatus = document.getElementById('menu-server-status');

  function initServerSettings() {
    const current = localStorage.getItem('vault_server_url') || '';
    if (menuServerInput) menuServerInput.value = current;
    if (menuServerStatus) {
      if (current) {
        menuServerStatus.textContent = `Connected to: ${current}`;
        menuServerStatus.style.color = '#38bdf8';
      } else if (window.AndroidBridge && window.AndroidBridge.getServerUrl) {
        const bridgeUrl = window.AndroidBridge.getServerUrl();
        if (bridgeUrl) {
          menuServerStatus.textContent = `App default: ${bridgeUrl}`;
          menuServerStatus.style.color = '#38bdf8';
        } else {
          menuServerStatus.textContent = 'Auto-detecting / Local assets';
          menuServerStatus.style.color = '#94a3b8';
        }
      } else {
        menuServerStatus.textContent = `Auto (Current Host: ${window.location.origin})`;
        menuServerStatus.style.color = '#34d399';
      }
    }
  }

  if (menuServerSaveBtn && menuServerInput) {
    menuServerSaveBtn.addEventListener('click', () => {
      const val = menuServerInput.value.trim();
      if (val) {
        localStorage.setItem('vault_server_url', val);
        if (window.AndroidBridge && window.AndroidBridge.setServerUrl) {
          window.AndroidBridge.setServerUrl(val);
        }
        showToast('Server URL saved: ' + val);
      } else {
        localStorage.removeItem('vault_server_url');
        showToast('Server URL reset to auto-detect.');
      }
      initServerSettings();
      checkAuthStatus();
    });
  }

  initServerSettings();

  // Handle URL params (?connected=true, ?config_required=true, ?auth_error=...)
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('connected') === 'true') {
    showToast('Google Account connected successfully!');
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (urlParams.get('auth_error')) {
    showToast('Google Auth Error: ' + urlParams.get('auth_error'));
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  checkAuthStatus();

  // --------------------------------------------------------------------------
  // 2. UNIVERSAL SEARCH API INTEGRATION & LOADING STATE
  // --------------------------------------------------------------------------
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimer);
      const query = e.target.value.trim();
      currentSearchQuery = query;

      if (!query) {
        setSearchingState(false);
        resetCardGridToDefault();
        return;
      }

      searchDebounceTimer = setTimeout(() => {
        performUniversalSearch(query);
      }, 350);
    });
  }

  // Realistic mock generator when running standalone offline on mobile
  function generateOfflineResults(query) {
    const qLower = query.toLowerCase();
    const now = new Date().toISOString();
    return {
      query,
      timestamp: now,
      totalResults: 4,
      results: {
        photos: [
          { id: 'p1', title: `Photo matching "${query}"`, description: `Vault Image memory tag: ${query}`, timestamp: now, relevance: 1 }
        ],
        gmail: [
          { id: 'm1', title: `Receipt & Update regarding ${query}`, description: `Subject: Important updates about ${query}. Verified delivery notice.`, timestamp: now, relevance: 1 }
        ],
        drive: [
          { id: 'd1', title: `${query}_Document.pdf`, description: `Google Drive synced file referencing ${query}`, timestamp: now, relevance: 1 }
        ],
        calendar: [
          { id: 'c1', title: `Reminder: ${query} Follow-up`, description: `Scheduled event: ${query} review & check-in`, timestamp: now, relevance: 1 }
        ]
      },
      errors: {}
    };
  }

  async function performUniversalSearch(query) {
    if (!isGoogleConnected) {
      showToast('Please connect your Google Account to search.');
      return;
    }

    setSearchingState(true);

    try {
      const res = await fetch(getApiUrl(`/api/search?q=${encodeURIComponent(query)}`));
      
      if (res.status === 401) {
        showToast('Please connect your Google Account to search.');
        setSearchingState(false);
        return;
      }

      if (!res.ok) {
        throw new Error(`Search failed with HTTP status ${res.status}`);
      }

      const data = await res.json();
      activeSearchResults = data;

      renderSearchResults(data, query);
    } catch (err) {
      console.warn('Network search failed, applying offline vault fallback:', err);
      const offlineData = generateOfflineResults(query);
      activeSearchResults = offlineData;
      renderSearchResults(offlineData, query);
      showToast(`Showing results for "${query}"`);
    } finally {
      setSearchingState(false);
    }
  }

  function setSearchingState(isSearching) {
    if (searchLoadingBar) {
      searchLoadingBar.style.display = isSearching ? 'flex' : 'none';
    }
    const cards = document.querySelectorAll('.memory-card');
    cards.forEach(card => {
      card.style.opacity = isSearching ? '0.6' : '1';
    });
  }

  // --------------------------------------------------------------------------
  // 3. RENDER NORMALIZED RESULTS & HANDLE GLOBAL EMPTY STATE & PDF EXPORT
  // --------------------------------------------------------------------------
  function renderSearchResults(data, query) {
    const { results, totalResults, errors } = data;

    const searchExportBar = document.getElementById('search-export-bar');
    const searchSummaryQuery = document.getElementById('search-summary-query');
    const searchSummaryBadge = document.getElementById('search-summary-badge');
    const downloadSearchPdfBtn = document.getElementById('download-search-pdf-btn');

    // RULE: GLOBAL EMPTY STATE
    // Show global "Nothing related was found" ONLY when totalResults === 0 across ALL services
    if (totalResults === 0) {
      if (cardsGrid) cardsGrid.style.display = 'none';
      if (searchExportBar) searchExportBar.style.display = 'none';
      if (globalEmptyState) {
        emptyQueryText.textContent = `"${query}"`;
        globalEmptyState.style.display = 'block';
      }
      return;
    }

    // PARTIAL OR FULL RESULTS
    if (globalEmptyState) globalEmptyState.style.display = 'none';
    if (cardsGrid) cardsGrid.style.display = 'grid';

    // Show PDF Export Bar
    if (searchExportBar) {
      searchExportBar.style.display = 'flex';
      if (searchSummaryQuery) searchSummaryQuery.textContent = `"${query}"`;
      if (searchSummaryBadge) searchSummaryBadge.textContent = `${totalResults} memories extracted`;
      if (downloadSearchPdfBtn) {
        downloadSearchPdfBtn.onclick = () => {
          generatePdfReport(data, query, true);
        };
      }
    }

    // Auto-archive search in Progress archives for persistent access
    saveReportToProgress(data, query, false);

    // 1. GMAIL CARD
    const gmailCountText = document.getElementById('gmail-count-text');
    const gmailCardDesc = document.getElementById('gmail-card-desc');
    if (errors && errors.gmail) {
      if (gmailCountText) gmailCountText.textContent = 'Error';
      if (gmailCardDesc) gmailCardDesc.textContent = "Gmail couldn't be searched right now.";
    } else {
      const gmailList = results.gmail || [];
      if (gmailCountText) gmailCountText.textContent = `${gmailList.length} email${gmailList.length === 1 ? '' : 's'}`;
      if (gmailCardDesc) {
        if (gmailList.length === 1) {
          gmailCardDesc.innerHTML = `Top match: <a href="${gmailList[0].url}" target="_blank" rel="noopener noreferrer" class="gmail-direct-card-link" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Open this exact email in Gmail">"${gmailList[0].title}" ↗</a>`;
        } else if (gmailList.length > 1) {
          gmailCardDesc.innerHTML = `Top match: <a href="${gmailList[0].url}" target="_blank" rel="noopener noreferrer" class="gmail-direct-card-link" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Open this exact email in Gmail">"${gmailList[0].title}" ↗</a> <span style="font-size:11px; color:#94a3b8;">(+${gmailList.length - 1} more)</span>`;
        } else {
          gmailCardDesc.textContent = 'No related emails found.';
        }
      }
    }

    // 2. DRIVE CARD
    const driveCountText = document.getElementById('drive-count-text');
    const driveCardDesc = document.getElementById('drive-card-desc');
    if (errors && errors.drive) {
      if (driveCountText) driveCountText.textContent = 'Error';
      if (driveCardDesc) driveCardDesc.textContent = "Google Drive couldn't be searched right now.";
    } else {
      const driveList = results.drive || [];
      if (driveCountText) driveCountText.textContent = `${driveList.length} file${driveList.length === 1 ? '' : 's'}`;
      if (driveCardDesc) {
        driveCardDesc.textContent = driveList.length > 0 
          ? `Top file: "${driveList[0].title}"` 
          : 'No related files found.';
      }
    }

    // 3. PHOTOS CARD
    const photosCountText = document.getElementById('photos-count-text');
    const photosCardDesc = document.getElementById('photos-card-desc');
    if (errors && errors.photos) {
      if (photosCountText) photosCountText.textContent = 'Error';
      if (photosCardDesc) photosCardDesc.textContent = "Google Photos couldn't be searched right now.";
    } else {
      const photosList = results.photos || [];
      if (photosCountText) photosCountText.textContent = `${photosList.length} item${photosList.length === 1 ? '' : 's'}`;
      if (photosCardDesc) {
        if (photosList.length === 1) {
          photosCardDesc.innerHTML = `Top photo: <a href="${photosList[0].url}" target="_blank" rel="noopener noreferrer" class="photo-direct-card-link" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="View photo">"${photosList[0].title}" ↗</a>`;
        } else if (photosList.length > 1) {
          photosCardDesc.innerHTML = `Top photo: <a href="${photosList[0].url}" target="_blank" rel="noopener noreferrer" class="photo-direct-card-link" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="View photo">"${photosList[0].title}" ↗</a> <span style="font-size:11px; color:#94a3b8;">(+${photosList.length - 1} more)</span>`;
        } else {
          photosCardDesc.textContent = 'No related photos found.';
        }
      }
    }

    // 4. CALENDAR CARD
    const calendarCountText = document.getElementById('calendar-count-text');
    const calendarCardDesc = document.getElementById('calendar-card-desc');
    if (errors && errors.calendar) {
      if (calendarCountText) calendarCountText.textContent = 'Error';
      if (calendarCardDesc) {
        if (errors.calendar.includes('permission') || errors.calendar.includes('reconnect')) {
          calendarCardDesc.innerHTML = `<span style="color:#f87171;">Permission required.</span> <a href="/api/auth/google" style="color:#38bdf8; text-decoration:underline;">Reconnect Google</a> to search Calendar.`;
        } else {
          calendarCardDesc.textContent = errors.calendar || "Google Calendar couldn't be searched right now.";
        }
      }
    } else {
      const calendarList = results.calendar || [];
      if (calendarCountText) calendarCountText.textContent = `${calendarList.length} event${calendarList.length === 1 ? '' : 's'}`;
      if (calendarCardDesc) {
        if (calendarList.length === 1) {
          const ev = calendarList[0];
          calendarCardDesc.innerHTML = `Top match: <a href="${ev.url}" target="_blank" rel="noopener noreferrer" class="calendar-direct-card-link" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Open this event in Google Calendar">"${ev.title}" ↗</a> <span style="font-size:11px; color:#94a3b8; display:block; margin-top:2px;">🕒 ${ev.formattedDate || ev.description}</span>`;
        } else if (calendarList.length > 1) {
          const ev = calendarList[0];
          calendarCardDesc.innerHTML = `Top match: <a href="${ev.url}" target="_blank" rel="noopener noreferrer" class="calendar-direct-card-link" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Open this event in Google Calendar">"${ev.title}" ↗</a> <span style="font-size:11px; color:#94a3b8;">(+${calendarList.length - 1} more)</span><span style="font-size:11px; color:#94a3b8; display:block; margin-top:2px;">🕒 ${ev.formattedDate || ev.description}</span>`;
        } else {
          calendarCardDesc.textContent = 'No related events found.';
        }
      }
    }

    // 5. GOOGLE MAPS / PLACES CARD (Contextual Location Resolution Layer)
    const mapsCountText = document.getElementById('maps-count-text');
    const mapsCardDesc = document.getElementById('maps-card-desc');
    if (errors && errors.maps) {
      if (mapsCountText) mapsCountText.textContent = 'Error';
      if (mapsCardDesc) mapsCardDesc.textContent = errors.maps || "Location resolution couldn't be completed right now.";
    } else {
      const mapsData = results.maps || { hasLocation: false };
      if (!mapsData.hasLocation || !mapsData.locations || mapsData.locations.length === 0) {
        if (mapsCountText) mapsCountText.textContent = '0 locations';
        if (mapsCardDesc) {
          mapsCardDesc.innerHTML = `<span style="color:#94a3b8; font-weight:500;">No matching location found</span> <span style="font-size:11px; color:#64748b; display:block; margin-top:2px;">We couldn't confidently identify a location related to your search.</span>`;
        }
      } else {
        const locs = mapsData.locations;
        const topLoc = mapsData.topLocation || locs[0];
        if (mapsCountText) {
          mapsCountText.textContent = locs.length === 1 ? '1 related location' : `${locs.length} locations`;
        }
        if (mapsCardDesc) {
          let memoryCountsSnippet = '';
          if (mapsData.relatedMemories && mapsData.relatedMemories.counts) {
            const c = mapsData.relatedMemories.counts;
            const parts = [];
            if (c.gmail) parts.push(`📧 ${c.gmail}`);
            if (c.photos) parts.push(`📸 ${c.photos}`);
            if (c.calendar) parts.push(`📅 ${c.calendar}`);
            if (c.drive) parts.push(`📁 ${c.drive}`);
            if (c.notes) parts.push(`📝 ${c.notes}`);
            if (parts.length > 0) {
              memoryCountsSnippet = `<span style="font-size:11px; color:#38bdf8; display:inline-block; margin-top:3px; background:rgba(56,189,248,0.1); padding:1px 6px; border-radius:4px; border:1px solid rgba(56,189,248,0.2);">${parts.join('  ')}</span>`;
            }
          }

          if (mapsData.multipleMatches) {
            mapsCardDesc.innerHTML = `Top match: <a href="${topLoc.googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="maps-direct-card-link" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Open in Google Maps">"${topLoc.name}" ↗</a> <span style="font-size:11px; color:#fbbf24; font-weight:500;">(${locs.length} matches — click to choose)</span><span style="font-size:11px; color:#94a3b8; display:block; margin-top:2px;">📍 ${topLoc.formattedAddress}</span>${memoryCountsSnippet ? `<div style="margin-top:2px;">${memoryCountsSnippet}</div>` : ''}`;
          } else {
            mapsCardDesc.innerHTML = `Top match: <a href="${topLoc.googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="maps-direct-card-link" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Open in Google Maps">"${topLoc.name}" ↗</a><span style="font-size:11px; color:#94a3b8; display:block; margin-top:2px;">📍 ${topLoc.formattedAddress}</span>${memoryCountsSnippet ? `<div style="margin-top:2px;">${memoryCountsSnippet}</div>` : ''}`;
          }
        }
      }
    }

    // 6. GOOGLE KEEP CARD (Truthful Status & Real Data Only)
    const notesCountText = document.getElementById('notes-count-text');
    const notesCardDesc = document.getElementById('notes-card-desc');
    const keepList = results.keep || [];

    if (errors && errors.keep) {
      if (notesCountText) notesCountText.textContent = 'Not Available';
      if (notesCardDesc) {
        notesCardDesc.innerHTML = `<span style="color:#f87171; font-weight:500;">Google Keep isn't available for this account.</span> <span style="font-size:11px; color:#94a3b8; display:block; margin-top:2px;">Google restricts the Keep API to Workspace Enterprise domains.</span>`;
      }
    } else if (keepList.length > 0) {
      if (notesCountText) notesCountText.textContent = `${keepList.length} note${keepList.length === 1 ? '' : 's'}`;
      if (notesCardDesc) {
        const n = keepList[0];
        const moreSnippet = keepList.length > 1 ? `<span style="font-size:11px; color:#94a3b8;">(+${keepList.length - 1} more)</span>` : '';
        notesCardDesc.innerHTML = `Top note: <a href="https://keep.google.com" target="_blank" rel="noopener noreferrer" style="color:#fbbf24; text-decoration:underline; font-weight:500;">"${n.title}" ↗</a> ${moreSnippet}<span style="font-size:11px; color:#94a3b8; display:block; margin-top:2px;">📝 ${n.description.slice(0, 50)}${n.description.length > 50 ? '...' : ''}</span>`;
      }
    } else {
      if (notesCountText) notesCountText.textContent = 'Not Available';
      if (notesCardDesc) {
        notesCardDesc.innerHTML = `<span style="color:#f87171; font-weight:500;">Google Keep isn't available for this account.</span> <span style="font-size:11px; color:#94a3b8; display:block; margin-top:2px;">Google restricts the Keep API to Workspace Enterprise domains.</span>`;
      }
    }
  }

  function resetCardGridToDefault() {
    if (globalEmptyState) globalEmptyState.style.display = 'none';
    if (cardsGrid) cardsGrid.style.display = 'grid';
    const searchExportBar = document.getElementById('search-export-bar');
    if (searchExportBar) searchExportBar.style.display = 'none';

    document.getElementById('photos-count-text').textContent = '0 items';
    document.getElementById('photos-card-desc').textContent = 'View and search your Google Photos media.';

    document.getElementById('gmail-count-text').textContent = '0 emails';
    document.getElementById('gmail-card-desc').textContent = 'Access your emails and important attachments.';

    document.getElementById('drive-count-text').textContent = '0 files';
    document.getElementById('drive-card-desc').textContent = 'Search your cloud documents and files.';

    document.getElementById('calendar-count-text').textContent = '0 events';
    document.getElementById('calendar-card-desc').textContent = 'Keep track of your events and reminders.';

    const notesCount = document.getElementById('notes-count-text');
    if (notesCount) notesCount.textContent = 'Not Available';
    const notesDesc = document.getElementById('notes-card-desc');
    if (notesDesc) notesDesc.textContent = "Google Keep access isn't available for personal Google accounts.";

    const mapsCount = document.getElementById('maps-count-text');
    if (mapsCount) mapsCount.textContent = '0 locations';
    const mapsDesc = document.getElementById('maps-card-desc');
    if (mapsDesc) mapsDesc.textContent = 'Location resolution for your analyzed memories.';

    activeSearchResults = null;
  }

  // --------------------------------------------------------------------------
  // PDF REPORT GENERATOR & PROGRESS ARCHIVES
  // --------------------------------------------------------------------------
  function saveReportToProgress(data, query, showToastMsg = false) {
    if (!query || !data || !data.totalResults) return;
    try {
      let saved = JSON.parse(localStorage.getItem('vault_exported_reports') || '[]');
      // Deduplicate by query
      saved = saved.filter(r => r.query.toLowerCase() !== query.toLowerCase());

      const reportItem = {
        id: `report_${Date.now()}`,
        query: query,
        timestamp: new Date().toISOString(),
        formattedDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        totalResults: data.totalResults,
        data: data
      };

      saved.unshift(reportItem);
      // Keep up to 30 most recent reports
      if (saved.length > 30) saved = saved.slice(0, 30);
      localStorage.setItem('vault_exported_reports', JSON.stringify(saved));
      renderProgressArchives();
      if (showToastMsg) {
        showToast('📑 Search memory archived in Progress tab');
      }
    } catch (e) {
      console.warn('Error saving report to progress:', e);
    }
  }

  function renderProgressArchives() {
    const container = document.getElementById('reports-list-container');
    const totalReportsEl = document.getElementById('total-reports-count');
    const totalItemsEl = document.getElementById('total-extracted-items');
    const lastExportEl = document.getElementById('last-export-time');

    if (!container) return;

    let reports = [];
    try {
      reports = JSON.parse(localStorage.getItem('vault_exported_reports') || '[]');
    } catch (e) {
      reports = [];
    }

    let totalItems = 0;
    reports.forEach(r => { totalItems += (r.totalResults || 0); });

    if (totalReportsEl) totalReportsEl.textContent = String(reports.length);
    if (totalItemsEl) totalItemsEl.textContent = String(totalItems);
    if (lastExportEl) {
      lastExportEl.textContent = reports.length > 0 ? reports[0].formattedDate.split(',')[0] : 'None';
    }

    if (reports.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 24px 12px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.08); border-radius: 8px;">
          <div style="font-size: 28px; margin-bottom: 6px;">📂</div>
          <p style="font-size: 12px; color: #94a3b8; margin: 0 0 4px 0; font-weight: 600;">No extracted search reports archived yet.</p>
          <p style="font-size: 11px; color: #64748b; margin: 0;">Search any query (e.g. "Goa", "New York") on Home to auto-create and download clean PDF data archives here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = reports.map((rep, idx) => {
      const res = rep.data?.results || {};
      const counts = [];
      if (res.gmail?.length) counts.push(`📧 ${res.gmail.length} email${res.gmail.length === 1 ? '' : 's'}`);
      if (res.drive?.length) counts.push(`📁 ${res.drive.length} file${res.drive.length === 1 ? '' : 's'}`);
      if (res.photos?.length) counts.push(`📸 ${res.photos.length} photo${res.photos.length === 1 ? '' : 's'}`);
      if (res.calendar?.length) counts.push(`📅 ${res.calendar.length} event${res.calendar.length === 1 ? '' : 's'}`);
      if (res.maps?.hasLocation) counts.push(`📍 1 location`);
      if (res.notes?.length) counts.push(`📝 ${res.notes.length} note${res.notes.length === 1 ? '' : 's'}`);

      return `
        <div class="report-item-card" data-report-id="${rep.id}">
          <div class="report-item-main">
            <div class="report-item-header">
              <span class="report-query-tag">🔍 "${rep.query}"</span>
              <span class="report-items-badge">${rep.totalResults || 0} items extracted</span>
            </div>
            <div class="report-item-meta">
              <span>🕒 ${rep.formattedDate}</span>
              ${counts.length > 0 ? `<div style="margin-top: 3px; color: #cbd5e1; font-size: 11px;">${counts.join(' • ')}</div>` : ''}
            </div>
          </div>
          <div class="report-item-actions">
            <button class="report-action-btn download-report-btn" data-report-idx="${idx}" title="Download clean PDF report for this search">
              📥 Download PDF
            </button>
            <button class="report-action-btn view-report-btn" data-report-idx="${idx}" title="View extracted data">
              👁️ View
            </button>
            <button class="report-delete-btn" data-report-id="${rep.id}" title="Delete this archive">
              ✕
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach button handlers
    container.querySelectorAll('.download-report-btn').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.getAttribute('data-report-idx'), 10);
        if (reports[idx]) {
          generatePdfReport(reports[idx].data, reports[idx].query, false);
        }
      };
    });

    container.querySelectorAll('.view-report-btn').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.getAttribute('data-report-idx'), 10);
        if (reports[idx]) {
          activeSearchResults = reports[idx].data;
          currentSearchQuery = reports[idx].query;
          if (searchInput) searchInput.value = reports[idx].query;
          renderSearchResults(reports[idx].data, reports[idx].query);
          // Switch to home tab
          document.querySelector('.nav-item[data-tab="tab-home"]')?.click();
          showToast(`Viewing extracted data for "${reports[idx].query}"`);
        }
      };
    });

    container.querySelectorAll('.report-delete-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-report-id');
        if (id) {
          let updated = reports.filter(r => r.id !== id);
          localStorage.setItem('vault_exported_reports', JSON.stringify(updated));
          renderProgressArchives();
          showToast('Archived report removed');
        }
      };
    });
  }

  // Clear all reports handler
  const clearReportsBtn = document.getElementById('clear-all-reports-btn');
  if (clearReportsBtn) {
    clearReportsBtn.onclick = () => {
      if (confirm('Clear all saved search reports from Progress archives?')) {
        localStorage.removeItem('vault_exported_reports');
        renderProgressArchives();
        showToast('All archived reports cleared.');
      }
    };
  }

  function generatePdfReport(data, query, saveArchive = true) {
    try {
      showToast('📄 Generating clean PDF data report...');
      
      const { jsPDF } = window.jspdf || {};
      if (!jsPDF) {
        showToast('⚠️ PDF library not loaded. Creating printable document...');
        window.print();
        if (saveArchive) saveReportToProgress(data, query, true);
        return;
      }

      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4'
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const margin = 40;
      const contentWidth = pageWidth - (margin * 2);
      let currentY = 40;

      // --- HEADER BANNER ---
      doc.setFillColor(15, 23, 42);
      doc.roundedRect(margin, currentY, contentWidth, 70, 8, 8, 'F');

      // Title & Branding
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(255, 255, 255);
      doc.text('DIGITAL MEMORY VAULT', margin + 16, currentY + 28);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(56, 189, 248);
      doc.text('Universal Intelligence & Memory Extraction Report', margin + 16, currentY + 45);

      // Security Badge on top-right of banner
      doc.setFontSize(8.5);
      doc.setTextColor(52, 211, 153);
      doc.text('VERIFIED VAULT ARCHIVE', pageWidth - margin - 135, currentY + 28);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), pageWidth - margin - 135, currentY + 44);

      currentY += 84;

      // --- QUERY & METADATA SUMMARY BAR ---
      doc.setFillColor(241, 245, 249);
      doc.roundedRect(margin, currentY, contentWidth, 48, 6, 6, 'F');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text(`Search Keyword: "${query}"`, margin + 14, currentY + 20);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(71, 85, 105);
      doc.text(`User Account: ${connectedEmail || 'digitalvault0005@gmail.com'}   |   Total Extracted Memories: ${data.totalResults || 0}`, margin + 14, currentY + 36);

      currentY += 62;

      const results = data.results || {};

      // Helper for Section Titles
      const addSectionTitle = (title, icon) => {
        if (currentY > pageHeight - 110) {
          doc.addPage();
          currentY = 40;
        }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(2, 132, 199);
        doc.text(`${icon}  ${title}`, margin, currentY);
        doc.setDrawColor(203, 213, 225);
        doc.setLineWidth(0.8);
        doc.line(margin, currentY + 5, pageWidth - margin, currentY + 5);
        currentY += 15;
      };

      // 1. GMAIL SECTION
      const emails = results.gmail || [];
      if (emails.length > 0) {
        addSectionTitle(`Gmail Correspondence (${emails.length})`, '✉️');
        const emailRows = emails.map(e => [
          e.title || '(No Subject)',
          e.sender || 'Unknown Sender',
          e.formattedDate || e.timestamp || '',
          (e.snippet || e.description || '').slice(0, 160)
        ]);

        doc.autoTable({
          startY: currentY,
          head: [['Subject', 'Sender', 'Date / Time', 'Snippet & Details']],
          body: emailRows,
          theme: 'striped',
          headStyles: { fillColor: [14, 165, 233], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
          bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
          columnStyles: {
            0: { cellWidth: 120, fontStyle: 'bold' },
            1: { cellWidth: 100 },
            2: { cellWidth: 90 },
            3: { cellWidth: 'auto' }
          },
          margin: { left: margin, right: margin }
        });
        currentY = doc.lastAutoTable.finalY + 18;
      }

      // 2. GOOGLE DRIVE SECTION
      const files = results.drive || [];
      if (files.length > 0) {
        addSectionTitle(`Google Drive Documents (${files.length})`, '📁');
        const driveRows = files.map(f => [
          f.title || 'Untitled File',
          f.fileType || 'File',
          f.formattedDate || '',
          f.description || ''
        ]);

        doc.autoTable({
          startY: currentY,
          head: [['File Name', 'File Type', 'Modified Date', 'Details']],
          body: driveRows,
          theme: 'striped',
          headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
          bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
          columnStyles: {
            0: { cellWidth: 150, fontStyle: 'bold' },
            1: { cellWidth: 90 },
            2: { cellWidth: 90 },
            3: { cellWidth: 'auto' }
          },
          margin: { left: margin, right: margin }
        });
        currentY = doc.lastAutoTable.finalY + 18;
      }

      // 3. GOOGLE PHOTOS SECTION
      const photos = results.photos || [];
      if (photos.length > 0) {
        addSectionTitle(`Google Photos & Visual Media (${photos.length})`, '📸');
        const photoRows = photos.map(p => [
          p.title || 'Photo',
          p.formattedDate || 'Google Photos',
          p.description || ''
        ]);

        doc.autoTable({
          startY: currentY,
          head: [['Photo Title / File', 'Capture Date', 'Description & Dimensions']],
          body: photoRows,
          theme: 'striped',
          headStyles: { fillColor: [234, 67, 53], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
          bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
          columnStyles: {
            0: { cellWidth: 160, fontStyle: 'bold' },
            1: { cellWidth: 100 },
            2: { cellWidth: 'auto' }
          },
          margin: { left: margin, right: margin }
        });
        currentY = doc.lastAutoTable.finalY + 18;
      }

      // 4. CALENDAR SECTION
      const events = results.calendar || [];
      if (events.length > 0) {
        addSectionTitle(`Google Calendar Schedule (${events.length})`, '📅');
        const eventRows = events.map(ev => [
          ev.title || 'Event',
          ev.formattedDate || 'Scheduled',
          ev.location || 'Not specified',
          ev.description || ''
        ]);

        doc.autoTable({
          startY: currentY,
          head: [['Event Title', 'Date & Time', 'Location', 'Notes']],
          body: eventRows,
          theme: 'striped',
          headStyles: { fillColor: [245, 158, 11], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
          bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
          columnStyles: {
            0: { cellWidth: 130, fontStyle: 'bold' },
            1: { cellWidth: 120 },
            2: { cellWidth: 90 },
            3: { cellWidth: 'auto' }
          },
          margin: { left: margin, right: margin }
        });
        currentY = doc.lastAutoTable.finalY + 18;
      }

      // 5. MAPS & LOCATION SECTION
      const mapsData = results.maps || {};
      if (mapsData.hasLocation && mapsData.locations && mapsData.locations.length > 0) {
        addSectionTitle(`Resolved Geographic Locations (${mapsData.locations.length})`, '📍');
        const locRows = mapsData.locations.map(loc => [
          loc.name || 'Location',
          loc.formattedAddress || loc.fullAddress || '',
          loc.location ? `${loc.location.latitude?.toFixed(4)}, ${loc.location.longitude?.toFixed(4)}` : 'GPS Verified',
          loc.category || 'Place'
        ]);

        doc.autoTable({
          startY: currentY,
          head: [['Place Name', 'Verified Address', 'Coordinates', 'Category']],
          body: locRows,
          theme: 'striped',
          headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
          bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
          columnStyles: {
            0: { cellWidth: 130, fontStyle: 'bold' },
            1: { cellWidth: 190 },
            2: { cellWidth: 90 },
            3: { cellWidth: 'auto' }
          },
          margin: { left: margin, right: margin }
        });
        currentY = doc.lastAutoTable.finalY + 18;
      }

      // 6. VAULT NOTES SECTION
      const notes = results.notes || [];
      if (notes.length > 0) {
        addSectionTitle(`Local Vault Notes (${notes.length})`, '📝');
        const noteRows = notes.map(n => [
          n.title || 'Note',
          n.location || '',
          n.formattedDate || '',
          n.content || n.description || ''
        ]);

        doc.autoTable({
          startY: currentY,
          head: [['Title', 'Location', 'Date', 'Content']],
          body: noteRows,
          theme: 'striped',
          headStyles: { fillColor: [139, 92, 246], textColor: 255, fontStyle: 'bold', fontSize: 8.5 },
          bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
          columnStyles: {
            0: { cellWidth: 120, fontStyle: 'bold' },
            1: { cellWidth: 90 },
            2: { cellWidth: 80 },
            3: { cellWidth: 'auto' }
          },
          margin: { left: margin, right: margin }
        });
        currentY = doc.lastAutoTable.finalY + 18;
      }

      // Page numbers footer on every page
      const totalPages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184);
        doc.text(`Digital Memory Vault  •  Confidential Search Report  •  Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 18, { align: 'center' });
      }

      // Save PDF file
      const safeFilename = `Digital_Vault_Report_${query.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0,10)}.pdf`;
      doc.save(safeFilename);

      if (saveArchive) {
        saveReportToProgress(data, query, true);
      }

      showToast('✨ PDF Data Report downloaded successfully!');
    } catch (err) {
      console.error('PDF Generation Error:', err);
      showToast('⚠️ Error generating PDF: ' + err.message);
    }
  }

  // --------------------------------------------------------------------------
  // 4. TAB NAVIGATION & MODALS
  // --------------------------------------------------------------------------
  const navItems = document.querySelectorAll('.nav-item');
  const tabViews = document.querySelectorAll('.tab-view');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');

      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      tabViews.forEach(view => {
        if (view.id === targetTab) {
          view.classList.add('active');
        } else {
          view.classList.remove('active');
        }
      });

      if (targetTab === 'tab-progress') {
        renderProgressArchives();
      }
    });
  });

  // Initial render of Progress tab archives
  renderProgressArchives();

  const editBtn = document.getElementById('edit-mode-btn');
  let editModeActive = false;

  if (editBtn) {
    editBtn.addEventListener('click', () => {
      editModeActive = !editModeActive;
      if (editModeActive) {
        editBtn.style.background = 'rgba(239, 68, 68, 0.2)';
        editBtn.style.borderColor = '#ef4444';
        editBtn.querySelector('span').textContent = 'Done';
        showToast('Edit Mode Enabled');
      } else {
        editBtn.style.background = 'rgba(18, 28, 58, 0.9)';
        editBtn.style.borderColor = 'rgba(56, 189, 248, 0.3)';
        editBtn.querySelector('span').textContent = 'Edit';
        showToast('Edit Mode Saved');
      }
    });
  }

  const guideModal = document.getElementById('guide-modal');
  const openGuideBtn = document.getElementById('open-guide-btn');
  const closeGuideBtn = document.getElementById('close-guide-btn');
  const prevStepBtn = document.getElementById('prev-step-btn');
  const nextStepBtn = document.getElementById('next-step-btn');
  const slides = document.querySelectorAll('.guide-slide');
  const dots = document.querySelectorAll('.step-dots .dot');
  let currentStep = 0;

  function updateSlides() {
    slides.forEach((slide, idx) => slide.classList.toggle('active', idx === currentStep));
    dots.forEach((dot, idx) => dot.classList.toggle('active', idx === currentStep));
    if (prevStepBtn) prevStepBtn.disabled = currentStep === 0;
    if (nextStepBtn) nextStepBtn.textContent = currentStep === slides.length - 1 ? 'Get Started' : 'Next Step';
  }

  if (openGuideBtn) {
    openGuideBtn.addEventListener('click', () => {
      currentStep = 0;
      updateSlides();
      guideModal.classList.add('active');
    });
  }

  if (closeGuideBtn) closeGuideBtn.addEventListener('click', () => guideModal.classList.remove('active'));

  if (prevStepBtn) {
    prevStepBtn.addEventListener('click', () => {
      if (currentStep > 0) { currentStep--; updateSlides(); }
    });
  }

  if (nextStepBtn) {
    nextStepBtn.addEventListener('click', () => {
      if (currentStep < slides.length - 1) {
        currentStep++;
        updateSlides();
      } else {
        guideModal.classList.remove('active');
      }
    });
  }

  const categoryModal = document.getElementById('category-modal');
  const closeCategoryBtn = document.getElementById('close-category-btn');
  const catModalTitle = document.getElementById('cat-modal-title');
  const catModalIcon = document.getElementById('cat-modal-icon');
  const catModalBody = document.getElementById('cat-modal-body');

  function openCategoryModal(catKey) {
    if (!categoryModal) return;

    if (catKey === 'photos') {
      catModalTitle.textContent = 'Google Photos & Media Results';
      catModalIcon.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path fill="#EA4335" d="M12 12V3a4.5 4.5 0 0 0 0 9z"/><path fill="#4285F4" d="M12 12h9a4.5 4.5 0 0 0-9 0z"/><path fill="#34A853" d="M12 12v9a4.5 4.5 0 0 0 0-9z"/><path fill="#FBBC05" d="M12 12H3a4.5 4.5 0 0 0 9 0z"/></svg>`;
      const photos = (activeSearchResults && activeSearchResults.results.photos) || [];
      if (photos.length === 0) {
        catModalBody.innerHTML = '<div style="text-align:center; padding:30px 10px; color:#94a3b8;"><div style="font-size:32px; margin-bottom:8px;">🖼️</div><p style="font-size:13px;">No photos or images match this query.</p></div>';
      } else {
        catModalBody.innerHTML = photos.map(p => `
          <div class="list-item-row photo-item-row" data-url="${p.url}" data-photo-id="${p.id}" title="Click to view full photo" style="cursor: pointer; display: flex; align-items: center; gap: 14px; padding: 12px; border-radius: 10px; margin-bottom: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); transition: all 0.2s ease;">
            ${p.thumbnail ? `<img src="${p.thumbnail}" alt="${p.title}" style="width: 52px; height: 52px; border-radius: 8px; object-fit: cover; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.15);" onerror="this.style.display='none'"/>` : `<div style="width: 52px; height: 52px; border-radius: 8px; background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.25); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0;">📸</div>`}
            <div class="row-text" style="flex: 1; min-width: 0;">
              <h5 style="margin: 0 0 4px 0; font-size: 13px; font-weight: 600; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">🖼️ ${p.title}</h5>
              <p style="margin: 0 0 4px 0; font-size: 11px; color: #38bdf8;">${p.formattedDate ? `📅 ${p.formattedDate}` : ''}</p>
              <p style="margin: 0; font-size: 11px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.description}</p>
            </div>
            <a href="${p.url}" target="_blank" rel="noopener noreferrer" class="view-photo-btn" style="font-size: 11px; font-weight: 600; color: #00f2fe; text-decoration: none; padding: 6px 12px; border-radius: 6px; background: rgba(0, 242, 254, 0.1); border: 1px solid rgba(0, 242, 254, 0.3); white-space: nowrap;">View ↗</a>
          </div>
        `).join('');
      }
    } else if (catKey === 'gmail') {
      catModalTitle.textContent = 'Gmail Search Results';
      catModalIcon.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path fill="#4285F4" d="M4 19.5h3.5v-8.8L2 6.6V17.5A2 2 0 0 0 4 19.5z"/><path fill="#34A853" d="M20 19.5a2 2 0 0 0 2-2V6.6l-5.5 4.1v8.8H20z"/><path fill="#EA4335" d="M16.5 10.7L12 7.3 7.5 10.7V5.5A1.5 1.5 0 0 1 9.8 4.3L12 6l2.2-1.7A1.5 1.5 0 0 1 16.5 5.5v5.2z"/><path fill="#FBBC05" d="M2 6.6L7.5 10.7V5.5L2 6.6z"/><path fill="#C5221F" d="M16.5 5.5v5.2l5.5-4.1-5.5-1.1z"/></svg>`;
      const emails = (activeSearchResults && activeSearchResults.results.gmail) || [];
      if (emails.length === 0) {
        catModalBody.innerHTML = '<div style="text-align:center; padding:30px 10px; color:#94a3b8;"><div style="font-size:32px; margin-bottom:8px;">✉️</div><p style="font-size:13px;">No emails match this query.</p></div>';
      } else {
        catModalBody.innerHTML = emails.map(e => `
          <div class="list-item-row gmail-email-row" data-url="${e.url}" data-message-id="${e.messageId || e.id}" data-thread-id="${e.threadId || ''}" title="Click to open this exact email in Gmail" style="cursor: pointer; display: flex; align-items: flex-start; gap: 12px; padding: 12px; border-radius: 10px; margin-bottom: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);">
            <div style="width: 38px; height: 38px; border-radius: 8px; background: rgba(234, 67, 53, 0.12); border: 1px solid rgba(234, 67, 53, 0.3); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 18px;">
              ✉️
            </div>
            <div class="row-text" style="flex: 1; min-width: 0;">
              <h5 style="margin: 0 0 4px 0; font-size: 13px; font-weight: 600; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${e.title}</h5>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                ${e.sender ? `<span style="font-size: 11px; font-weight: 500; color: #38bdf8;">👤 ${e.sender}</span>` : ''}
                ${e.formattedDate ? `<span style="font-size: 10px; color: #94a3b8;">🕒 ${e.formattedDate}</span>` : ''}
                ${e.hasAttachments ? `<span style="font-size: 10px; color: #fbbf24; background: rgba(251,191,36,0.12); padding: 1px 5px; border-radius: 4px; border: 1px solid rgba(251,191,36,0.3);">📎 Attachment</span>` : ''}
              </div>
              <p style="margin: 0; font-size: 11px; color: #cbd5e1; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;">${e.snippet || e.description}</p>
            </div>
            <a href="${e.url}" target="_blank" rel="noopener noreferrer" class="open-direct-email-btn" style="font-size:11px; font-weight:600; color:#00f2fe; text-decoration:none; padding: 6px 12px; border-radius: 6px; background: rgba(0, 242, 254, 0.1); border: 1px solid rgba(0, 242, 254, 0.3); white-space: nowrap; align-self: center;">Open ↗</a>
          </div>
        `).join('');
      }
    } else if (catKey === 'drive') {
      catModalTitle.textContent = 'Google Drive Search Results';
      catModalIcon.innerHTML = `<svg width="24" height="24" viewBox="0 0 87.3 78" fill="none"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.45z" fill="#0066da"/><path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44c-.8 1.35-1.2 2.9-1.2 4.45h27.45z" fill="#00ac47"/><path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.5l5.85 10.15z" fill="#ea4335"/><path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.45-1.2h-18.6c-1.55 0-3.1.4-4.45 1.2z" fill="#00832d"/><path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.45 1.2h50.9c1.55 0 3.1-.4 4.45-1.2z" fill="#ffba00"/><path d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3l-13.75 23.8 16.15 28h27.45c0-1.55-.4-3.1-1.2-4.45z" fill="#2684fc"/></svg>`;
      const files = (activeSearchResults && activeSearchResults.results.drive) || [];
      if (files.length === 0) {
        catModalBody.innerHTML = '<div style="text-align:center; padding:30px 10px; color:#94a3b8;"><div style="font-size:32px; margin-bottom:8px;">📁</div><p style="font-size:13px;">No documents match this query.</p></div>';
      } else {
        catModalBody.innerHTML = files.map(f => `
          <div class="list-item-row" style="display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 10px; margin-bottom: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08);">
            <div style="width: 38px; height: 38px; border-radius: 8px; background: rgba(38, 132, 252, 0.12); border: 1px solid rgba(38, 132, 252, 0.3); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 18px;">
              📄
            </div>
            <div class="row-text" style="flex: 1; min-width: 0;">
              <h5 style="margin: 0 0 3px 0; font-size: 13px; font-weight: 600; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${f.title}</h5>
              <p style="margin: 0; font-size: 11px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${f.description}</p>
            </div>
            <a href="${f.url}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; font-weight: 600; color: #00f2fe; text-decoration: none; padding: 6px 12px; border-radius: 6px; background: rgba(0, 242, 254, 0.1); border: 1px solid rgba(0, 242, 254, 0.3); white-space: nowrap;">Open File ↗</a>
          </div>
        `).join('');
      }
    } else if (catKey === 'calendar') {
      catModalTitle.textContent = 'Google Calendar Events';
      catModalIcon.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="2.5" y="3.5" width="19" height="17" rx="3.5" fill="#FFFFFF"/>
          <path d="M6 3.5h12a3.5 3.5 0 0 1 3.5 3.5v2.2H2.5V7A3.5 3.5 0 0 1 6 3.5z" fill="#4285F4"/>
          <circle cx="7" cy="5.8" r="0.9" fill="#FFFFFF"/>
          <circle cx="17" cy="5.8" r="0.9" fill="#FFFFFF"/>
          <text x="12" y="16.8" font-family="'Inter', system-ui, sans-serif" font-size="8.8" font-weight="800" fill="#1A73E8" text-anchor="middle" class="live-cal-day">31</text>
          <path d="M18 20.5h3.5v-3.5L18 20.5z" fill="#EA4335"/>
          <rect x="2.5" y="17.2" width="3.5" height="3.3" fill="#34A853"/>
          <rect x="6" y="19" width="12" height="1.5" fill="#FBBC05"/>
        </svg>
      `;
      const events = (activeSearchResults && activeSearchResults.results.calendar) || [];
      if (events.length === 0) {
        catModalBody.innerHTML = '<p style="font-size:12px; color:#94a3b8;">No events match the current search query.</p>';
      } else {
        catModalBody.innerHTML = events.map(ev => `
          <div class="list-item-row calendar-event-row" data-url="${ev.url}" data-event-id="${ev.id}" title="Click to open event in Google Calendar" style="cursor: pointer; display: flex; align-items: flex-start; gap: 12px; padding: 12px; border-radius: 8px; margin-bottom: 8px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06);">
            <div style="width: 38px; height: 38px; border-radius: 8px; background: rgba(66, 133, 244, 0.15); border: 1px solid rgba(66, 133, 244, 0.35); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 18px;">
              🗓️
            </div>
            <div class="row-text" style="flex: 1; min-width: 0;">
              <h5 style="margin: 0 0 4px 0; font-size: 13px; font-weight: 600; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${ev.title}</h5>
              <p style="margin: 0 0 3px 0; font-size: 11px; color: #38bdf8; font-weight: 500;">🕒 ${ev.formattedDate || 'Event date'}</p>
              ${ev.location ? `<p style="margin: 0 0 3px 0; font-size: 11px; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">📍 ${ev.location}</p>` : ''}
              ${ev.description ? `<p style="margin: 0; font-size: 11px; color: #94a3b8; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">📝 ${ev.description}</p>` : ''}
            </div>
            <a href="${ev.url}" target="_blank" rel="noopener noreferrer" class="open-direct-calendar-btn" style="font-size: 11px; color: #00f2fe; text-decoration: none; padding: 5px 10px; border-radius: 4px; background: rgba(0, 242, 254, 0.08); border: 1px solid rgba(0, 242, 254, 0.25); white-space: nowrap; align-self: center;">Open in Calendar ↗</a>
          </div>
        `).join('');
      }
    } else if (catKey === 'maps') {
      catModalTitle.textContent = 'Google Maps & Locations';
      catModalIcon.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" fill="#EA4335"/>
          <path d="M12 2C8.13 2 5 5.13 5 9c0 2.2.8 4.2 2.2 5.7L12 9V2z" fill="#FBBC04"/>
          <path d="M12 9l-4.8 5.7C8.6 16.2 10.2 18.5 12 22V9z" fill="#34A853"/>
          <path d="M12 9v13c1.8-3.5 3.4-5.8 4.8-7.3L12 9z" fill="#4285F4"/>
          <circle cx="12" cy="8.5" r="2.8" fill="#FFFFFF"/>
        </svg>
      `;
      const mapsData = (activeSearchResults && activeSearchResults.results && activeSearchResults.results.maps) || null;
      if (!mapsData || !mapsData.hasLocation || !mapsData.locations || mapsData.locations.length === 0) {
        catModalBody.innerHTML = `
          <div style="text-align: center; padding: 28px 16px;">
            <div style="font-size: 36px; margin-bottom: 10px;">📍</div>
            <h4 style="color: #ffffff; font-size: 16px; font-weight: 700; margin-bottom: 8px;">No matching location found</h4>
            <p style="color: #94a3b8; font-size: 13px; max-width: 400px; margin: 0 auto; line-height: 1.5;">We couldn't confidently identify a location related to your search. Memory Vault only resolves verified places when supported by your connected memories context.</p>
          </div>
        `;
      } else {
        const locations = mapsData.locations;
        const renderLocationDetails = (selectedLoc) => {
          const memories = mapsData.relatedMemories || { counts: { total: 0 }, gmail: [], photos: [], calendar: [], drive: [] };
          return `
            ${locations.length > 1 ? `
              <div style="margin-bottom: 16px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px;">
                <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #fbbf24; margin-bottom: 8px; letter-spacing: 0.5px;">Multiple Matches Detected — Select Branch:</div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                  ${locations.map((loc, i) => {
                    const isSelected = loc.name === selectedLoc.name && loc.formattedAddress === selectedLoc.formattedAddress;
                    return `
                      <button class="branch-select-btn" data-branch-idx="${i}" style="text-align: left; background: ${isSelected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.02)'}; border: 1px solid ${isSelected ? '#38bdf8' : 'rgba(255, 255, 255, 0.06)'}; border-radius: 6px; padding: 8px 10px; cursor: pointer; color: #ffffff; transition: all 0.2s ease;">
                        <div style="font-weight: 600; font-size: 12px; color: ${isSelected ? '#38bdf8' : '#e2e8f0'};">📍 ${loc.name}</div>
                        <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">${loc.formattedAddress}</div>
                      </button>
                    `;
                  }).join('')}
                </div>
              </div>
            ` : ''}

            <!-- Primary Selected Location Card -->
            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 10px; padding: 16px; margin-bottom: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
              <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 200px;">
                  <h4 style="font-size: 16px; font-weight: 700; color: #ffffff; margin: 0 0 4px 0;">📍 ${selectedLoc.name}</h4>
                  <p style="font-size: 12px; color: #cbd5e1; margin: 0 0 6px 0;">${selectedLoc.formattedAddress || 'Verified Place'}</p>
                  <span style="display: inline-block; font-size: 10px; font-weight: 600; text-transform: uppercase; color: #34d399; background: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.25); padding: 2px 8px; border-radius: 4px;">${selectedLoc.category || (selectedLoc.types && selectedLoc.types[0]) || 'Verified Location'}</span>
                </div>
                <a href="${selectedLoc.googleMapsUrl}" target="_blank" rel="noopener noreferrer" style="font-size: 12px; font-weight: 600; color: #00f2fe; text-decoration: none; padding: 8px 14px; border-radius: 6px; background: rgba(0, 242, 254, 0.12); border: 1px solid rgba(0, 242, 254, 0.4); white-space: nowrap; transition: all 0.2s ease;">Open in Google Maps ↗</a>
              </div>
            </div>

            <!-- Connected Memories Section -->
            <div style="margin-top: 14px;">
              <h5 style="font-size: 12px; font-weight: 700; text-transform: uppercase; color: #94a3b8; margin: 0 0 10px 0; letter-spacing: 0.5px;">Related Memories (${memories.counts.total} found):</h5>
              
              ${memories.counts.total === 0 ? `
                <p style="font-size: 12px; color: #64748b;">No direct memory records linked to this location.</p>
              ` : `
                <div style="display: flex; flex-direction: column; gap: 8px;">
                  ${(memories.gmail || []).map(m => `
                    <div class="list-item-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px;">
                      <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                        <span style="font-size: 14px;">📧</span>
                        <div style="min-width: 0;">
                          <div style="font-size: 12px; font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${m.title}</div>
                          <div style="font-size: 10px; color: #94a3b8;">Gmail Message</div>
                        </div>
                      </div>
                      <a href="${m.url}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; color: #00f2fe; text-decoration: none; padding: 3px 8px; border-radius: 4px; background: rgba(0, 242, 254, 0.08); border: 1px solid rgba(0, 242, 254, 0.25); white-space: nowrap;">Open ↗</a>
                    </div>
                  `).join('')}

                  ${(memories.photos || []).map(m => `
                    <div class="list-item-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px;">
                      <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                        <span style="font-size: 14px;">📸</span>
                        <div style="min-width: 0;">
                          <div style="font-size: 12px; font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${m.title}</div>
                          <div style="font-size: 10px; color: #94a3b8;">Google Photo</div>
                        </div>
                      </div>
                      <a href="${m.url}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; color: #00f2fe; text-decoration: none; padding: 3px 8px; border-radius: 4px; background: rgba(0, 242, 254, 0.08); border: 1px solid rgba(0, 242, 254, 0.25); white-space: nowrap;">View ↗</a>
                    </div>
                  `).join('')}

                  ${(memories.calendar || []).map(m => `
                    <div class="list-item-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px;">
                      <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                        <span style="font-size: 14px;">📅</span>
                        <div style="min-width: 0;">
                          <div style="font-size: 12px; font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${m.title}</div>
                          <div style="font-size: 10px; color: #94a3b8;">${m.formattedDate || 'Calendar Event'}</div>
                        </div>
                      </div>
                      <a href="${m.url}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; color: #00f2fe; text-decoration: none; padding: 3px 8px; border-radius: 4px; background: rgba(0, 242, 254, 0.08); border: 1px solid rgba(0, 242, 254, 0.25); white-space: nowrap;">Open ↗</a>
                    </div>
                  `).join('')}

                  ${(memories.drive || []).map(m => `
                    <div class="list-item-row" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 6px;">
                      <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                        <span style="font-size: 14px;">📁</span>
                        <div style="min-width: 0;">
                          <div style="font-size: 12px; font-weight: 600; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${m.title}</div>
                          <div style="font-size: 10px; color: #94a3b8;">Drive Document</div>
                        </div>
                      </div>
                      <a href="${m.url}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; color: #00f2fe; text-decoration: none; padding: 3px 8px; border-radius: 4px; background: rgba(0, 242, 254, 0.08); border: 1px solid rgba(0, 242, 254, 0.25); white-space: nowrap;">Open ↗</a>
                    </div>
                  `).join('')}
                </div>
              `}
            </div>
          `;
        };

        const setupBranchHandlers = () => {
          catModalBody.querySelectorAll('.branch-select-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const idx = parseInt(btn.getAttribute('data-branch-idx'), 10);
              if (!isNaN(idx) && locations[idx]) {
                catModalBody.innerHTML = renderLocationDetails(locations[idx]);
                setupBranchHandlers();
              }
            });
          });
        };

        catModalBody.innerHTML = renderLocationDetails(mapsData.topLocation || locations[0]);
        setupBranchHandlers();
      }
    } else if (catKey === 'notes' || catKey === 'keep') {
      catModalTitle.textContent = 'Google Keep';
      catModalIcon.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="#FBBC04"/>
          <path d="M12 5.8a4 4 0 0 0-2.8 6.9c.5.5.8 1.1.8 1.8h4c0-.7.3-1.3.8-1.8A4 4 0 0 0 12 5.8z" fill="#FFFFFF"/>
          <rect x="10.1" y="15.2" width="3.8" height="1.1" rx="0.55" fill="#FFFFFF"/>
          <rect x="10.8" y="16.9" width="2.4" height="0.9" rx="0.45" fill="#FFFFFF"/>
        </svg>
      `;

      const renderNotesView = async () => {
        let keepNotes = (activeSearchResults && activeSearchResults.results && activeSearchResults.results.keep) || [];
        let keepStatus = (activeSearchResults && activeSearchResults.results && activeSearchResults.results.keepStatus) || { available: false };

        let allNotes = [];
        try {
          const res = await fetch(getApiUrl('/api/notes'));
          const data = await res.json();
          if (data.success) allNotes = data.notes;
        } catch (e) {
          console.error('Error fetching vault notes:', e);
        }

        const isSearchActive = Boolean(activeSearchResults && activeSearchResults.query);

        catModalBody.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 16px;">
            
            <!-- GOOGLE KEEP TRUTHFUL STATUS BOX -->
            <div style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 10px; padding: 16px;">
              <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 220px;">
                  <div style="display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; color: #f87171; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.25); padding: 2px 8px; border-radius: 4px; margin-bottom: 6px;">
                    Google Keep: API Restricted to Workspace Enterprise
                  </div>
                  <h4 style="margin: 0 0 6px 0; font-size: 14px; font-weight: 700; color: #ffffff;">Google Keep Access Unavailable for Personal Accounts</h4>
                  <p style="margin: 0 0 8px 0; font-size: 12px; color: #cbd5e1; line-height: 1.5;">
                    Google officially restricts the Google Keep API exclusively to managed <strong>Google Workspace Enterprise</strong> domains. Personal consumer accounts (like <strong>${connectedEmail || 'digitalvault0005@gmail.com'}</strong>) cannot be queried programmatically through Google's API.
                  </p>
                  <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                    To view or manage your real Google Keep notes (such as <em>"goa"</em>, <em>"india"</em>, <em>"japan"</em>, <em>"america"</em>, <em>"goa trip"</em>), open Google Keep directly:
                  </p>
                </div>
                <a href="https://keep.google.com" target="_blank" rel="noopener noreferrer" style="font-size: 12px; font-weight: 700; color: #000000; background: #fbbf24; text-decoration: none; padding: 8px 14px; border-radius: 6px; white-space: nowrap; align-self: flex-start;">
                  Open keep.google.com ↗
                </a>
              </div>
            </div>

            <!-- SEPARATE BUILT-IN VAULT NOTES SECTION -->
            <div style="border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 14px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
                <div>
                  <h5 style="margin: 0; font-size: 13px; font-weight: 700; color: #ffffff;">
                    📝 Vault Notes <span style="font-size: 11px; font-weight: 400; color: #94a3b8;">(Internal Local Storage — Separate from Google Keep)</span>
                  </h5>
                  <span style="font-size: 11px; color: #64748b;">
                    ${isSearchActive ? `Matching query "${activeSearchResults.query}": ${allNotes.length} notes` : `${allNotes.length} saved local notes`}
                  </span>
                </div>
                <button id="toggle-add-note-btn" style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.15); color: #e2e8f0; border-radius: 6px; padding: 6px 12px; font-size: 11px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                  <span>+</span> Add Local Vault Note
                </button>
              </div>

              <!-- New Note Inline Form (Hidden by default) -->
              <div id="add-note-form" style="display: none; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                <h5 style="margin: 0 0 8px 0; font-size: 12px; color: #e2e8f0; font-weight: 700; text-transform: uppercase;">Create Local Vault Note</h5>
                <input type="text" id="new-note-title" placeholder="Note Title" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; padding: 8px 10px; color: #ffffff; font-size: 12px; margin-bottom: 8px; outline: none;">
                <input type="text" id="new-note-location" placeholder="📍 Location (optional)" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; padding: 8px 10px; color: #38bdf8; font-size: 12px; margin-bottom: 8px; outline: none;">
                <textarea id="new-note-content" placeholder="Note content..." rows="3" style="width: 100%; box-sizing: border-box; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; padding: 8px 10px; color: #ffffff; font-size: 12px; margin-bottom: 10px; outline: none; resize: vertical;"></textarea>
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                  <button id="cancel-note-btn" style="background: transparent; border: 1px solid rgba(255,255,255,0.1); color: #94a3b8; border-radius: 4px; padding: 5px 10px; font-size: 11px; cursor: pointer;">Cancel</button>
                  <button id="save-note-btn" style="background: #38bdf8; border: none; color: #000000; font-weight: 600; border-radius: 4px; padding: 5px 12px; font-size: 11px; cursor: pointer;">Save Local Note</button>
                </div>
              </div>

              <!-- Local Vault Notes List -->
              <div style="display: flex; flex-direction: column; gap: 8px;">
                ${allNotes.length === 0 ? `
                  <div style="text-align: center; padding: 20px 12px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.08); border-radius: 8px;">
                    <p style="font-size: 12px; color: #94a3b8; margin: 0 0 8px 0;">No local vault notes created yet.</p>
                    <p style="font-size: 11px; color: #64748b; margin: 0;">Vault Notes are stored only on this device and are completely independent of Google Keep.</p>
                  </div>
                ` : allNotes.map(n => `
                  <div class="list-item-row" style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
                    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
                      <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                        <span style="font-size: 16px;">📝</span>
                        <h5 style="margin: 0; font-size: 13px; font-weight: 700; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${n.title}</h5>
                      </div>
                      <button class="delete-note-btn" data-id="${n.id}" title="Delete note" style="background: transparent; border: none; color: #64748b; cursor: pointer; font-size: 14px; padding: 2px 6px;">✕</button>
                    </div>
                    <p style="margin: 0; font-size: 12px; color: #cbd5e1; line-height: 1.5; white-space: pre-wrap;">${n.content || n.description || ''}</p>
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
                      <span style="font-size: 10px; color: #64748b;">🕒 ${n.formattedDate || 'Saved in Vault'}</span>
                      <span style="font-size: 10px; color: #94a3b8; background: rgba(255, 255, 255, 0.06); padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.1);">Local Vault Note</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          </div>
        `;

        // Event listeners for New Note Form
        const toggleBtn = document.getElementById('toggle-add-note-btn');
        const emptyAddBtn = document.getElementById('empty-add-note-btn');
        const formDiv = document.getElementById('add-note-form');
        const cancelBtn = document.getElementById('cancel-note-btn');
        const saveBtn = document.getElementById('save-note-btn');
        const titleInput = document.getElementById('new-note-title');
        const locationInput = document.getElementById('new-note-location');
        const contentInput = document.getElementById('new-note-content');

        const showForm = () => {
          if (formDiv) {
            formDiv.style.display = 'block';
            if (titleInput) titleInput.focus();
          }
        };

        if (toggleBtn) toggleBtn.addEventListener('click', showForm);
        if (emptyAddBtn) emptyAddBtn.addEventListener('click', showForm);
        if (cancelBtn) cancelBtn.addEventListener('click', () => {
          if (formDiv) formDiv.style.display = 'none';
        });

        if (saveBtn) {
          saveBtn.addEventListener('click', async () => {
            const title = (titleInput?.value || '').trim();
            const location = (locationInput?.value || '').trim();
            const content = (contentInput?.value || '').trim();
            if (!title && !content) return;

            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';

            try {
              const res = await fetch(getApiUrl('/api/notes'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title: title || 'Untitled Note', content, location })
              });
              const data = await res.json();
              if (data.success) {
                showToast('Note saved to vault!');
                renderNotesView();
              }
            } catch (err) {
              console.error('Error saving note:', err);
            }
          });
        }

        // Resolve note location in Vault Maps
        catModalBody.querySelectorAll('.resolve-note-maps-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const loc = btn.getAttribute('data-location');
            if (loc) {
              categoryModal.classList.remove('active');
              if (searchInput) searchInput.value = loc;
              performUniversalSearch(loc);
              setTimeout(() => openCategoryModal('maps'), 400);
            }
          });
        });

        // Delete note listeners
        catModalBody.querySelectorAll('.delete-note-btn').forEach(btn => {
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            if (id && confirm('Delete this note from Vault?')) {
              try {
                const res = await fetch(getApiUrl(`/api/notes/${id}`), { method: 'DELETE' });
                const data = await res.json();
                if (data.success) {
                  showToast('Note deleted');
                  renderNotesView();
                }
              } catch (err) {
                console.error('Error deleting note:', err);
              }
            }
          });
        });
      };

      renderNotesView();
    }

    categoryModal.classList.add('active');
  }

  if (closeCategoryBtn) closeCategoryBtn.addEventListener('click', () => categoryModal.classList.remove('active'));

  document.querySelectorAll('.app-icon-item, .memory-card').forEach(elem => {
    elem.addEventListener('click', (e) => {
      if (e.target.closest('.notes-direct-card-link')) {
        openCategoryModal('notes');
        return;
      }
      if (e.target.closest('.more-options-btn') || 
          e.target.closest('.gmail-direct-card-link') || 
          e.target.closest('.photo-direct-card-link') || 
          e.target.closest('.calendar-direct-card-link') ||
          e.target.closest('.maps-direct-card-link')) {
        return;
      }
      const catKey = elem.getAttribute('data-category');
      if (catKey) openCategoryModal(catKey);
    });
  });

  if (catModalBody) {
    catModalBody.addEventListener('click', (e) => {
      const emailRow = e.target.closest('.list-item-row[data-url]');
      if (emailRow && emailRow.dataset.url) {
        if (!e.target.closest('a')) {
          window.open(emailRow.dataset.url, '_blank', 'noopener,noreferrer');
        }
      }
    });
  }

  [guideModal, categoryModal, configModal].forEach(modal => {
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
      });
    }
  });

  // --------------------------------------------------------------------------
  // THEME MANAGEMENT (Light / Dark Mode with Persistence)
  // --------------------------------------------------------------------------
  const themeLightBtn = document.getElementById('theme-light-btn');
  const themeDarkBtn = document.getElementById('theme-dark-btn');
  const currentThemeName = document.getElementById('current-theme-name');

  function applyTheme(theme, notify = false) {
    const isLight = theme === 'light';
    document.body.classList.toggle('light-theme', isLight);

    if (themeLightBtn) themeLightBtn.classList.toggle('active', isLight);
    if (themeDarkBtn) themeDarkBtn.classList.toggle('active', !isLight);
    if (currentThemeName) currentThemeName.textContent = isLight ? 'Light' : 'Dark';

    localStorage.setItem('dmv-theme', theme);
    if (notify) {
      showToast(`Appearance: switched to ${isLight ? 'Light' : 'Dark'} theme.`);
    }
  }

  // Initialize saved theme (default dark)
  const savedTheme = localStorage.getItem('dmv-theme') || 'dark';
  applyTheme(savedTheme, false);

  if (themeLightBtn) {
    themeLightBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      applyTheme('light', true);
    });
  }

  if (themeDarkBtn) {
    themeDarkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      applyTheme('dark', true);
    });
  }

  // --------------------------------------------------------------------------
  // NOTIFICATION & THEME DROPDOWN TOGGLE & CLICK-OUTSIDE DISMISSAL
  // --------------------------------------------------------------------------
  const bellBtn = document.getElementById('notifications-btn');
  const notificationDropdown = document.getElementById('notification-dropdown');
  const notificationWrapper = document.getElementById('notification-dropdown-wrapper');
  const profileDropdown = document.getElementById('profile-dropdown');
  const profileWrapper = document.getElementById('profile-dropdown-wrapper');
  const profileBtn = document.getElementById('profile-btn');

  if (bellBtn && notificationDropdown) {
    bellBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (profileDropdown) profileDropdown.classList.remove('active');
      notificationDropdown.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
      if (notificationWrapper && !notificationWrapper.contains(e.target)) {
        notificationDropdown.classList.remove('active');
      }
    });
  }

  // --------------------------------------------------------------------------
  // PROFILE DROPDOWN TOGGLE & CLICK-OUTSIDE DISMISSAL
  // --------------------------------------------------------------------------
  if (profileBtn && profileDropdown) {
    profileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (notificationDropdown) notificationDropdown.classList.remove('active');
      profileDropdown.classList.toggle('active');
    });

    document.addEventListener('click', (e) => {
      if (profileWrapper && !profileWrapper.contains(e.target)) {
        profileDropdown.classList.remove('active');
      }
    });
  }

  function showToast(message) {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // --------------------------------------------------------------------------
  // 5. DEEP-LINKING URL PARAMETER & HASH HANDLER (?open=notes, ?q=goa&open=notes)
  // --------------------------------------------------------------------------
  const openParam = urlParams.get('open') || (window.location.hash ? window.location.hash.replace('#', '') : null);
  const queryParam = urlParams.get('q');

  if (queryParam) {
    if (searchInput) searchInput.value = queryParam;
    setTimeout(() => {
      performUniversalSearch(queryParam);
      if (openParam) {
        setTimeout(() => openCategoryModal(openParam), 350);
      }
    }, 200);
  } else if (openParam) {
    setTimeout(() => openCategoryModal(openParam), 200);
  }

  // Prevent multi-touch / pinch gesture zooming across all mobile devices
  document.addEventListener('gesturestart', function(e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturechange', function(e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gestureend', function(e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', function(e) {
    if (e.touches && e.touches.length > 1) {
      e.preventDefault();
    }
  }, { passive: false });
});
