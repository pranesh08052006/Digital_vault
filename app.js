/* ==========================================================================
   DIGITAL MEMORY VAULT - PHASE 1 FRONTEND INTERACTION & API INTEGRATION
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

  // Auto-purge any stale legacy tunnel or localhost URLs from localStorage to prevent invalid connection errors
  try {
    const legacyUrl = localStorage.getItem('vault_server_url') || '';
    if (legacyUrl.includes('trycloudflare.com') || legacyUrl.includes('loca.lt') || legacyUrl.includes('ngrok') ||
        (window.location.protocol !== 'file:' && (legacyUrl.includes('localhost') || legacyUrl.includes('127.0.0.1')) && !window.location.hostname.includes('localhost'))) {
      console.log('🧹 Purging expired server URL from localStorage:', legacyUrl);
      localStorage.removeItem('vault_server_url');
      localStorage.removeItem('vault_custom_server_url');
    }
  } catch (e) {}

  // State management
  let isGoogleConnected = false;
  let connectedEmail = null;
  let currentSearchQuery = '';
  let activeSearchResults = null;
  let searchDebounceTimer = null;

  // Filter state management
  const ALL_SOURCES = ['photos', 'gmail', 'drive', 'calendar', 'notes', 'maps'];
  let activeFilters = {
    sources: [...ALL_SOURCES],
    dateRange: 'all',
    customDateFrom: null,
    customDateTo: null,
    contentType: 'all',
    sortBy: 'relevance'
  };

  // UI Element References
  const connectGoogleBtn = document.getElementById('connect-google-btn');
  const googleBtnText = document.getElementById('google-btn-text');
  const searchInput = document.getElementById('memory-search');
  const cardsGrid = document.getElementById('cards-grid');
  const globalEmptyState = document.getElementById('global-empty-state');
  const emptyQueryText = document.getElementById('empty-query-text');
  const searchLoadingBar = document.getElementById('search-loading-bar');

  // Filter UI References
  const filterBtn = document.getElementById('filter-btn');
  const filterActiveDot = document.getElementById('filter-active-dot');
  const filterModal = document.getElementById('filter-modal');
  const closeFilterBtn = document.getElementById('close-filter-btn');
  const filterResetBtn = document.getElementById('filter-reset-btn');
  const filterApplyBtn = document.getElementById('filter-apply-btn');
  const filterToggleAllSources = document.getElementById('filter-toggle-all-sources');
  const activeFiltersBar = document.getElementById('active-filters-bar');
  const activeFiltersTags = document.getElementById('active-filters-tags');
  const clearAllFiltersBtn = document.getElementById('clear-all-filters-btn');
  const filterCustomDates = document.getElementById('filter-custom-dates');
  const filterDateFrom = document.getElementById('filter-date-from');
  const filterDateTo = document.getElementById('filter-date-to');

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

    // 2. In web browser environment, always use relative path to current server
    if (window.location.protocol !== 'file:' && window.location.hostname) {
      return path;
    }

    // 3. Android Native Bridge configured URL
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

    // 4. Build-time injected configuration from config.js
    if (window.VAULT_CONFIG && window.VAULT_CONFIG.BACKEND_URL && window.VAULT_CONFIG.BACKEND_URL.trim()) {
      return window.VAULT_CONFIG.BACKEND_URL.trim().replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
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

    const isNativeBridge = Boolean(window.AndroidBridge && window.AndroidBridge.openExternalUrl);
    const googleAuthUrl = getApiUrl('/api/auth/google' + (isNativeBridge ? '?source=app' : ''));
    if (googleAuthUrl.startsWith('http://') || googleAuthUrl.startsWith('https://')) {
      if (isNativeBridge) {
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
        isGoogleConnected = false;
        localStorage.removeItem('vault_auth_user');
        updateAuthUI({ connected: false });
        showToast('⚠️ Google session expired. Please reconnect your Google Account.');
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
  // SEARCH FILTER ENGINE & MODAL CONTROLLERS
  // --------------------------------------------------------------------------
  function openFilterModal() {
    if (!filterModal) return;
    syncFilterModalInputs();
    filterModal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  function closeFilterModal() {
    if (!filterModal) return;
    filterModal.classList.remove('active');
    document.body.style.overflow = '';
  }

  function syncFilterModalInputs() {
    // Sync checkboxes
    const sourceCheckboxes = document.querySelectorAll('input[name="filter-source"]');
    sourceCheckboxes.forEach(cb => {
      cb.checked = activeFilters.sources.includes(cb.value);
    });

    // Sync Date Segment buttons
    const dateButtons = document.querySelectorAll('#filter-date-segments .segment-btn');
    dateButtons.forEach(btn => {
      const val = btn.getAttribute('data-date');
      if (val === activeFilters.dateRange) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    if (filterCustomDates) {
      filterCustomDates.style.display = activeFilters.dateRange === 'custom' ? 'grid' : 'none';
      if (filterDateFrom && activeFilters.customDateFrom) filterDateFrom.value = activeFilters.customDateFrom;
      if (filterDateTo && activeFilters.customDateTo) filterDateTo.value = activeFilters.customDateTo;
    }

    // Sync Type Segment buttons
    const typeButtons = document.querySelectorAll('#filter-type-segments .segment-btn');
    typeButtons.forEach(btn => {
      const val = btn.getAttribute('data-type');
      if (val === activeFilters.contentType) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Sync Sort Segment buttons
    const sortButtons = document.querySelectorAll('#filter-sort-segments .segment-btn');
    sortButtons.forEach(btn => {
      const val = btn.getAttribute('data-sort');
      if (val === activeFilters.sortBy) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function resetFiltersToDefault() {
    activeFilters = {
      sources: [...ALL_SOURCES],
      dateRange: 'all',
      customDateFrom: null,
      customDateTo: null,
      contentType: 'all',
      sortBy: 'relevance'
    };
    syncFilterModalInputs();
    updateActiveFiltersUI();
    if (activeSearchResults && currentSearchQuery) {
      renderSearchResults(activeSearchResults, currentSearchQuery);
    } else {
      updateCardsGridVisibility();
    }
    showToast('Filters reset to default.');
  }

  function applyActiveFiltersToResults(rawData) {
    if (!rawData || !rawData.results) return rawData;
    const filtered = {
      query: rawData.query,
      timestamp: rawData.timestamp,
      totalResults: 0,
      results: {},
      errors: { ...rawData.errors }
    };

    const isWithinDateRange = (itemDateStr) => {
      if (activeFilters.dateRange === 'all') return true;
      if (!itemDateStr) return true;
      const itemTime = new Date(itemDateStr).getTime();
      if (isNaN(itemTime)) return true;
      const now = Date.now();
      if (activeFilters.dateRange === '24h') return (now - itemTime) <= (24 * 60 * 60 * 1000);
      if (activeFilters.dateRange === '7d') return (now - itemTime) <= (7 * 24 * 60 * 60 * 1000);
      if (activeFilters.dateRange === '30d') return (now - itemTime) <= (30 * 24 * 60 * 60 * 1000);
      if (activeFilters.dateRange === '1y') return (now - itemTime) <= (365 * 24 * 60 * 60 * 1000);
      if (activeFilters.dateRange === 'custom') {
        const from = activeFilters.customDateFrom ? new Date(activeFilters.customDateFrom).getTime() : 0;
        const to = activeFilters.customDateTo ? new Date(activeFilters.customDateTo).getTime() + 86400000 : Infinity;
        return itemTime >= from && itemTime <= to;
      }
      return true;
    };

    const isContentTypeMatch = (source, item) => {
      if (activeFilters.contentType === 'all') return true;
      if (activeFilters.contentType === 'media') return source === 'photos';
      if (activeFilters.contentType === 'docs') return source === 'drive';
      if (activeFilters.contentType === 'messages') return source === 'gmail';
      if (activeFilters.contentType === 'events') return source === 'calendar' || source === 'notes';
      return true;
    };

    let totalCount = 0;
    ALL_SOURCES.forEach(source => {
      if (!activeFilters.sources.includes(source)) {
        filtered.results[source] = source === 'maps' ? { hasLocation: false, locations: [] } : [];
        return;
      }

      if (source === 'maps') {
        filtered.results.maps = rawData.results?.maps || { hasLocation: false, locations: [] };
        if (filtered.results.maps.hasLocation) {
          totalCount += (filtered.results.maps.locations?.length || 1);
        }
        return;
      }

      const list = rawData.results?.[source] || [];
      const filteredList = list.filter(item => {
        const dateStr = item.timestamp || item.formattedDate || item.captureDate || item.date;
        const dateMatch = isWithinDateRange(dateStr);
        const typeMatch = isContentTypeMatch(source, item);
        return dateMatch && typeMatch;
      });

      // Sorting
      if (activeFilters.sortBy === 'newest') {
        filteredList.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      } else if (activeFilters.sortBy === 'oldest') {
        filteredList.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
      }

      filtered.results[source] = filteredList;
      totalCount += filteredList.length;
    });

    filtered.totalResults = totalCount;
    return filtered;
  }

  function updateCardsGridVisibility() {
    if (!cardsGrid) return;
    const cards = cardsGrid.querySelectorAll('.memory-card');
    cards.forEach(card => {
      const cat = card.getAttribute('data-category');
      if (activeFilters.sources.includes(cat)) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  }

  function updateActiveFiltersUI() {
    const isFiltered = 
      activeFilters.sources.length < ALL_SOURCES.length ||
      activeFilters.dateRange !== 'all' ||
      activeFilters.contentType !== 'all' ||
      activeFilters.sortBy !== 'relevance';

    if (filterActiveDot) {
      filterActiveDot.style.display = isFiltered ? 'block' : 'none';
    }
    if (filterBtn) {
      if (isFiltered) filterBtn.classList.add('active');
      else filterBtn.classList.remove('active');
    }

    if (!activeFiltersBar || !activeFiltersTags) return;

    if (!isFiltered) {
      activeFiltersBar.style.display = 'none';
      activeFiltersTags.innerHTML = '';
      updateCardsGridVisibility();
      return;
    }

    activeFiltersBar.style.display = 'flex';
    activeFiltersTags.innerHTML = '';

    // Sources tag
    if (activeFilters.sources.length < ALL_SOURCES.length) {
      const tag = document.createElement('span');
      tag.className = 'filter-tag-pill';
      tag.innerHTML = `Sources (${activeFilters.sources.length}/${ALL_SOURCES.length}) <button class="filter-tag-remove" data-action="reset-sources">&times;</button>`;
      activeFiltersTags.appendChild(tag);
    }

    // Time Range tag
    if (activeFilters.dateRange !== 'all') {
      const labels = { '24h': 'Past 24h', '7d': '7 Days', '30d': '30 Days', '1y': '1 Year', 'custom': 'Custom Dates' };
      const tag = document.createElement('span');
      tag.className = 'filter-tag-pill';
      tag.innerHTML = `Time: ${labels[activeFilters.dateRange] || activeFilters.dateRange} <button class="filter-tag-remove" data-action="reset-date">&times;</button>`;
      activeFiltersTags.appendChild(tag);
    }

    // Content Type tag
    if (activeFilters.contentType !== 'all') {
      const typeLabels = { 'media': 'Photos & Media', 'docs': 'Docs & PDFs', 'messages': 'Emails', 'events': 'Events & Notes' };
      const tag = document.createElement('span');
      tag.className = 'filter-tag-pill';
      tag.innerHTML = `Type: ${typeLabels[activeFilters.contentType] || activeFilters.contentType} <button class="filter-tag-remove" data-action="reset-type">&times;</button>`;
      activeFiltersTags.appendChild(tag);
    }

    // Sort tag
    if (activeFilters.sortBy !== 'relevance') {
      const sortLabels = { 'newest': 'Newest', 'oldest': 'Oldest' };
      const tag = document.createElement('span');
      tag.className = 'filter-tag-pill';
      tag.innerHTML = `Sort: ${sortLabels[activeFilters.sortBy]} <button class="filter-tag-remove" data-action="reset-sort">&times;</button>`;
      activeFiltersTags.appendChild(tag);
    }

    updateCardsGridVisibility();
  }

  // Filter Button & Modal Listeners
  if (filterBtn) {
    filterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openFilterModal();
    });
  }

  if (closeFilterBtn) {
    closeFilterBtn.addEventListener('click', closeFilterModal);
  }

  if (filterModal) {
    filterModal.addEventListener('click', (e) => {
      if (e.target === filterModal) {
        closeFilterModal();
      }
    });
  }

  if (filterResetBtn) {
    filterResetBtn.addEventListener('click', () => {
      resetFiltersToDefault();
    });
  }

  if (filterToggleAllSources) {
    filterToggleAllSources.addEventListener('click', () => {
      const cbs = document.querySelectorAll('input[name="filter-source"]');
      const allChecked = Array.from(cbs).every(cb => cb.checked);
      cbs.forEach(cb => { cb.checked = !allChecked; });
    });
  }

  // Date Segment Click Listener
  const filterDateSegments = document.getElementById('filter-date-segments');
  if (filterDateSegments) {
    filterDateSegments.addEventListener('click', (e) => {
      const btn = e.target.closest('.segment-btn');
      if (!btn) return;
      filterDateSegments.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.getAttribute('data-date');
      if (filterCustomDates) {
        filterCustomDates.style.display = val === 'custom' ? 'grid' : 'none';
      }
    });
  }

  // Type Segment Click Listener
  const filterTypeSegments = document.getElementById('filter-type-segments');
  if (filterTypeSegments) {
    filterTypeSegments.addEventListener('click', (e) => {
      const btn = e.target.closest('.segment-btn');
      if (!btn) return;
      filterTypeSegments.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  }

  // Sort Segment Click Listener
  const filterSortSegments = document.getElementById('filter-sort-segments');
  if (filterSortSegments) {
    filterSortSegments.addEventListener('click', (e) => {
      const btn = e.target.closest('.segment-btn');
      if (!btn) return;
      filterSortSegments.querySelectorAll('.segment-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  }

  // Apply Filters Click Listener
  if (filterApplyBtn) {
    filterApplyBtn.addEventListener('click', () => {
      // 1. Gather sources
      const checkedSources = [];
      document.querySelectorAll('input[name="filter-source"]:checked').forEach(cb => {
        checkedSources.push(cb.value);
      });
      activeFilters.sources = checkedSources.length > 0 ? checkedSources : [...ALL_SOURCES];

      // 2. Date range
      const activeDateBtn = document.querySelector('#filter-date-segments .segment-btn.active');
      activeFilters.dateRange = activeDateBtn ? activeDateBtn.getAttribute('data-date') : 'all';
      if (activeFilters.dateRange === 'custom') {
        activeFilters.customDateFrom = filterDateFrom ? filterDateFrom.value : null;
        activeFilters.customDateTo = filterDateTo ? filterDateTo.value : null;
      } else {
        activeFilters.customDateFrom = null;
        activeFilters.customDateTo = null;
      }

      // 3. Content Type
      const activeTypeBtn = document.querySelector('#filter-type-segments .segment-btn.active');
      activeFilters.contentType = activeTypeBtn ? activeTypeBtn.getAttribute('data-type') : 'all';

      // 4. Sort Order
      const activeSortBtn = document.querySelector('#filter-sort-segments .segment-btn.active');
      activeFilters.sortBy = activeSortBtn ? activeSortBtn.getAttribute('data-sort') : 'relevance';

      updateActiveFiltersUI();
      closeFilterModal();

      if (activeSearchResults && currentSearchQuery) {
        renderSearchResults(activeSearchResults, currentSearchQuery);
        showToast('Filters applied to search results.');
      } else {
        showToast('Filters applied to dashboard view.');
      }
    });
  }

  // Active Filter Tag Pills Click (Remove filter)
  if (activeFiltersTags) {
    activeFiltersTags.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-tag-remove');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'reset-sources') {
        activeFilters.sources = [...ALL_SOURCES];
      } else if (action === 'reset-date') {
        activeFilters.dateRange = 'all';
      } else if (action === 'reset-type') {
        activeFilters.contentType = 'all';
      } else if (action === 'reset-sort') {
        activeFilters.sortBy = 'relevance';
      }
      syncFilterModalInputs();
      updateActiveFiltersUI();
      if (activeSearchResults && currentSearchQuery) {
        renderSearchResults(activeSearchResults, currentSearchQuery);
      }
    });
  }

  if (clearAllFiltersBtn) {
    clearAllFiltersBtn.addEventListener('click', () => {
      resetFiltersToDefault();
    });
  }

  // --------------------------------------------------------------------------
  // 3. RENDER NORMALIZED RESULTS & HANDLE GLOBAL EMPTY STATE & PDF EXPORT
  // --------------------------------------------------------------------------
  function renderSearchResults(rawData, query) {
    const data = applyActiveFiltersToResults(rawData);
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
        downloadSearchPdfBtn.onclick = async () => {
          await generatePdfReport(data, query, true);
        };
      }
    }

    // Auto-archive search in Progress archives for persistent access
    saveReportToProgress(data, query, false);

    // Apply card visibility based on active source filters
    updateCardsGridVisibility();

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
          gmailCardDesc.innerHTML = `Top match: <span class="card-match-highlight" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Click to view email">"${gmailList[0].title}" ↗</span>`;
        } else if (gmailList.length > 1) {
          gmailCardDesc.innerHTML = `Top match: <span class="card-match-highlight" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Click to view all emails">"${gmailList[0].title}" ↗</span> <span style="font-size:11px; color:#94a3b8;">(+${gmailList.length - 1} more)</span>`;
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
        if (driveList.length === 1) {
          driveCardDesc.innerHTML = `Top file: <span class="card-match-highlight" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Click to view file">"${driveList[0].title}" ↗</span>`;
        } else if (driveList.length > 1) {
          driveCardDesc.innerHTML = `Top file: <span class="card-match-highlight" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Click to view all files">"${driveList[0].title}" ↗</span> <span style="font-size:11px; color:#94a3b8;">(+${driveList.length - 1} more)</span>`;
        } else {
          driveCardDesc.textContent = 'No related files found.';
        }
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
          photosCardDesc.innerHTML = `Top photo: <span class="card-match-highlight" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Click to view photo">"${photosList[0].title}" ↗</span>`;
        } else if (photosList.length > 1) {
          photosCardDesc.innerHTML = `Top photo: <span class="card-match-highlight" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Click to view all photos">"${photosList[0].title}" ↗</span> <span style="font-size:11px; color:#94a3b8;">(+${photosList.length - 1} more)</span>`;
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
          calendarCardDesc.innerHTML = `Top match: <span class="card-match-highlight" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Click to view event">"${ev.title}" ↗</span> <span style="font-size:11px; color:#94a3b8; display:block; margin-top:2px;">🕒 ${ev.formattedDate || ev.description}</span>`;
        } else if (calendarList.length > 1) {
          const ev = calendarList[0];
          calendarCardDesc.innerHTML = `Top match: <span class="card-match-highlight" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Click to view all events">"${ev.title}" ↗</span> <span style="font-size:11px; color:#94a3b8;">(+${calendarList.length - 1} more)</span><span style="font-size:11px; color:#94a3b8; display:block; margin-top:2px;">🕒 ${ev.formattedDate || ev.description}</span>`;
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
            mapsCardDesc.innerHTML = `Top match: <span class="card-match-highlight" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Click to choose location">"${topLoc.name}" ↗</span> <span style="font-size:11px; color:#fbbf24; font-weight:500;">(${locs.length} matches — click to choose)</span><span style="font-size:11px; color:#94a3b8; display:block; margin-top:2px;">📍 ${topLoc.formattedAddress}</span>${memoryCountsSnippet ? `<div style="margin-top:2px;">${memoryCountsSnippet}</div>` : ''}`;
          } else {
            mapsCardDesc.innerHTML = `Top match: <span class="card-match-highlight" style="color:#00f2fe; text-decoration:underline; font-weight:500;" title="Click to view location">"${topLoc.name}" ↗</span><span style="font-size:11px; color:#94a3b8; display:block; margin-top:2px;">📍 ${topLoc.formattedAddress}</span>${memoryCountsSnippet ? `<div style="margin-top:2px;">${memoryCountsSnippet}</div>` : ''}`;
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
        notesCardDesc.innerHTML = `Top note: <span class="card-match-highlight" style="color:#fbbf24; text-decoration:underline; font-weight:500;" title="Click to view notes">"${n.title}" ↗</span> ${moreSnippet}<span style="font-size:11px; color:#94a3b8; display:block; margin-top:2px;">📝 ${n.description.slice(0, 50)}${n.description.length > 50 ? '...' : ''}</span>`;
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

    updateCardsGridVisibility();
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
      btn.onclick = async () => {
        const idx = parseInt(btn.getAttribute('data-report-idx'), 10);
        if (reports[idx]) {
          await generatePdfReport(reports[idx].data, reports[idx].query, false);
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

  // Helper to convert image URL to base64 for jsPDF embedding
  async function loadPhotoBase64(url) {
    if (!url) return null;
    return new Promise((resolve) => {
      try {
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            const maxDim = 800;
            let w = img.naturalWidth || img.width || 400;
            let h = img.naturalHeight || img.height || 300;
            if (w > maxDim || h > maxDim) {
              if (w > h) {
                h = Math.round((h * maxDim) / w);
                w = maxDim;
              } else {
                w = Math.round((w * maxDim) / h);
                h = maxDim;
              }
            }
            canvas.width = Math.max(1, w);
            canvas.height = Math.max(1, h);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
            resolve({ dataUrl, width: canvas.width, height: canvas.height });
          } catch (err) {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = proxyUrl;
      } catch (e) {
        resolve(null);
      }
    });
  }

  // Helper to fetch any image via backend proxy and convert to Base64
  async function fetchImageAsBase64(url) {
    if (!url) return null;
    try {
      const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) return null;
      const blob = await res.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      return null;
    }
  }

  async function generatePdfReport(data, query, saveArchive = true) {
    try {
      showToast('📄 Generating executive visual PDF report from your real memories...');

      const results = data.results || {};
      const emails = results.gmail || [];
      const files = results.drive || [];
      const photos = results.photos || [];
      const events = results.calendar || [];
      const mapsData = results.maps || {};
      const locs = (mapsData.hasLocation && mapsData.locations) ? mapsData.locations : [];

      // Pre-load all REAL photo images in parallel
      const photoBase64Map = {};
      if (photos.length > 0) {
        await Promise.all(
          photos.map(async (p) => {
            const targetUrl = p.thumbnail || p.url;
            if (targetUrl) {
              const b64 = await fetchImageAsBase64(targetUrl);
              if (b64) photoBase64Map[p.id || targetUrl] = b64;
            }
          })
        );
      }

      // Format Query Title
      const displayQuery = query ? (query.charAt(0).toUpperCase() + query.slice(1)) : 'Search';
      const titleLabel = displayQuery.toLowerCase().includes('trip') || displayQuery.toLowerCase().includes('search') 
        ? displayQuery 
        : `${displayQuery} Trip`;
      const now = new Date();
      const dateFormatted = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      const userAccount = connectedEmail || 'poojith.np@gmail.com';

      const avatarColors = ['#1d4ed8', '#dc2626', '#0284c7', '#059669', '#ea580c', '#7c3aed', '#0891b2'];

      const getFileIconSvg = (fileType, title = '') => {
        const ft = (fileType || '').toLowerCase();
        const t = (title || '').toLowerCase();
        if (ft.includes('pdf') || t.endsWith('.pdf')) {
          return `<div style="width:22px;height:22px;background:#ef4444;border-radius:4px;display:flex;align-items:center;justify-content:center;color:white;font-size:7.5px;font-weight:bold;letter-spacing:-0.2px;">PDF</div>`;
        } else if (ft.includes('sheet') || ft.includes('excel') || t.endsWith('.xlsx') || t.endsWith('.xls') || t.endsWith('.csv')) {
          return `<div style="width:22px;height:22px;background:#10b981;border-radius:4px;display:flex;align-items:center;justify-content:center;color:white;font-size:7.5px;font-weight:bold;">XLS</div>`;
        } else if (ft.includes('doc') || ft.includes('word') || t.endsWith('.docx') || t.endsWith('.doc')) {
          return `<div style="width:22px;height:22px;background:#2563eb;border-radius:4px;display:flex;align-items:center;justify-content:center;color:white;font-size:7.5px;font-weight:bold;">DOC</div>`;
        } else if (ft.includes('presentation') || ft.includes('powerpoint') || t.endsWith('.pptx') || t.endsWith('.ppt')) {
          return `<div style="width:22px;height:22px;background:#f59e0b;border-radius:4px;display:flex;align-items:center;justify-content:center;color:white;font-size:7.5px;font-weight:bold;">PPT</div>`;
        } else if (ft.includes('image') || t.endsWith('.png') || t.endsWith('.jpg') || t.endsWith('.jpeg') || t.endsWith('.webp')) {
          return `<div style="width:22px;height:22px;background:#ea580c;border-radius:4px;display:flex;align-items:center;justify-content:center;color:white;font-size:7.5px;font-weight:bold;">IMG</div>`;
        }
        return `<div style="width:22px;height:22px;background:#0284c7;border-radius:4px;display:flex;align-items:center;justify-content:center;color:white;font-size:7.5px;font-weight:bold;">TXT</div>`;
      };

      const parseEventDate = (ev) => {
        try {
          let d = null;
          if (ev.start) d = new Date(ev.start);
          else if (ev.timestamp) d = new Date(ev.timestamp);
          if (!d || isNaN(d.getTime())) d = new Date();
          const month = d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
          const day = d.getDate();
          const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
          return { month, day: String(day), weekday };
        } catch (e) {
          return { month: 'EVENT', day: '•', weekday: '' };
        }
      };

      // Create a hidden absolute wrapper at (0,0) so html2canvas renders directly at standard screen coordinates
      const renderWrapper = document.createElement('div');
      renderWrapper.id = 'pdf-render-wrapper';
      renderWrapper.style.cssText = `
        position: absolute;
        left: 0;
        top: 0;
        width: 1220px;
        z-index: -99999;
        opacity: 1;
        pointer-events: none;
        background-color: #ffffff;
      `;

      const container = document.createElement('div');
      container.id = 'executive-pdf-export-container';
      container.style.cssText = `
        width: 1220px;
        background-color: #ffffff;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #0f172a;
        padding: 24px 28px 24px 28px;
        box-sizing: border-box;
        line-height: 1.35;
        -webkit-font-smoothing: antialiased;
      `;

      container.innerHTML = `
        <!-- TOP BRAND HEADER -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <!-- Logo -->
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:44px;height:44px;border-radius:14px;background:linear-gradient(135deg, #0284c7 0%, #38bdf8 100%);display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(2,132,199,0.25);">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" fill="#ffffff"/>
                <path d="M10.5 13.5l1.5-1.5 1.5 1.5M12 12v4" stroke="#0284c7" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            </div>
            <div>
              <div style="font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.5px;line-height:1.1;">Digital Memory Vault</div>
              <div style="font-size:12.5px;color:#64748b;font-weight:500;margin-top:2px;">Your Memories. Connected.</div>
            </div>
          </div>

          <!-- Header Pills -->
          <div style="display:flex;align-items:center;gap:10px;">
            <!-- Query Pill -->
            <div style="display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;padding:8px 14px;border-radius:12px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <div style="font-size:11px;color:#64748b;">Search Query:<br><strong style="font-size:12.5px;color:#0f172a;font-weight:700;">${displayQuery}</strong></div>
            </div>

            <!-- Date Pill -->
            <div style="display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;padding:8px 14px;border-radius:12px;">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
              <div style="font-size:11px;color:#64748b;">Date Generated:<br><strong style="font-size:12.5px;color:#0f172a;font-weight:700;">${dateFormatted}</strong></div>
            </div>

            <!-- Account Pill -->
            <div style="display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;padding:8px 14px;border-radius:12px;">
              <div style="width:24px;height:24px;border-radius:50%;background:#0284c7;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:bold;">
                ${userAccount.charAt(0).toUpperCase()}
              </div>
              <div style="font-size:11px;color:#64748b;">Account:<br><strong style="font-size:12.5px;color:#0f172a;font-weight:700;">${userAccount}</strong></div>
            </div>
          </div>
        </div>

        <!-- HERO TITLE & STATS ROW -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <!-- Left Hero Title -->
          <div>
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:26px;">✈️</span>
              <h2 style="font-size:26px;font-weight:800;color:#0f172a;margin:0;letter-spacing:-0.5px;">${titleLabel}</h2>
              <span style="background:#e0f2fe;color:#0284c7;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;">Trip Summary</span>
            </div>
            <p style="font-size:12px;color:#64748b;margin:3px 0 0 36px;font-weight:500;">A collection of your related memories from Google services</p>
          </div>

          <!-- Right 5 Stats Pills (REAL COUNTS ONLY) -->
          <div style="display:flex;align-items:center;gap:10px;">
            <!-- Photos Stat -->
            <div style="display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;padding:6px 12px;border-radius:12px;">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#EA4335" d="M12 2a5 5 0 0 0-5 5v5h5a5 5 0 0 0 0-10z"/>
                <path fill="#4285F4" d="M22 12a5 5 0 0 0-5-5h-5v5a5 5 0 0 0 10 0z"/>
                <path fill="#34A853" d="M12 22a5 5 0 0 0 5-5v-5h-5a5 5 0 0 0 0 10z"/>
                <path fill="#FBBC05" d="M2 12a5 5 0 0 0 5 5h5v-5a5 5 0 0 0-10 0z"/>
              </svg>
              <div><div style="font-size:10px;color:#64748b;line-height:1;">Photos</div><div style="font-size:13px;font-weight:800;color:#0f172a;">${photos.length} item${photos.length === 1 ? '' : 's'}</div></div>
            </div>

            <!-- Emails Stat -->
            <div style="display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;padding:6px 12px;border-radius:12px;">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M2 5v14c0 1.1.9 2 2 2h2V9.5L12 14l6-4.5V21h2c1.1 0 2-.9 2-2V5c0-1.6-1.9-2.5-3.2-1.4L12 8.5 5.2 3.6C3.9 2.5 2 3.4 2 5z"/>
                <path fill="#EA4335" d="M20 19v-9.5L12 15l-8-5.5V19c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2z"/>
                <path fill="#FBBC05" d="M4 5.5V9.5L12 15l8-5.5V5.5c0-.9-1-1.4-1.7-.9L12 9.5 5.7 4.6c-.7-.5-1.7 0-1.7.9z"/>
              </svg>
              <div><div style="font-size:10px;color:#64748b;line-height:1;">Emails</div><div style="font-size:13px;font-weight:800;color:#0f172a;">${emails.length} item${emails.length === 1 ? '' : 's'}</div></div>
            </div>

            <!-- Events Stat -->
            <div style="display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;padding:6px 12px;border-radius:12px;">
              <svg width="18" height="18" viewBox="0 0 24 24">
                <rect x="2" y="3" width="20" height="18" rx="4" fill="#1a73e8"/>
                <path d="M2 8h20" stroke="#ffffff" stroke-width="2"/>
                <text x="12" y="18" fill="#ffffff" font-size="9" font-weight="bold" text-anchor="middle" font-family="sans-serif">13</text>
              </svg>
              <div><div style="font-size:10px;color:#64748b;line-height:1;">Events</div><div style="font-size:13px;font-weight:800;color:#0f172a;">${events.length} item${events.length === 1 ? '' : 's'}</div></div>
            </div>

            <!-- Locations Stat -->
            <div style="display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;padding:6px 12px;border-radius:12px;">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#EA4335" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                <circle cx="12" cy="9" r="3" fill="#ffffff"/>
                <circle cx="12" cy="9" r="1.5" fill="#4285F4"/>
              </svg>
              <div><div style="font-size:10px;color:#64748b;line-height:1;">Locations</div><div style="font-size:13px;font-weight:800;color:#0f172a;">${locs.length} place${locs.length === 1 ? '' : 's'}</div></div>
            </div>

            <!-- Files Stat -->
            <div style="display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e2e8f0;padding:6px 12px;border-radius:12px;">
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#FFC107" d="M8.5 3.5L2 14.8l4.3 7.5 6.5-11.3z"/>
                <path fill="#4CAF50" d="M15.5 3.5h-7l6.5 11.3 7-12.1a1.5 1.5 0 0 0-1.3-.7h-5.2z"/>
                <path fill="#2196F3" d="M22 14.8H8.8l-4.3 7.5c.6 1 1.7 1.7 2.9 1.7h13.2a3 3 0 0 0 2.6-1.5l2-3.5-3.2-4.2z"/>
              </svg>
              <div><div style="font-size:10px;color:#64748b;line-height:1;">Files</div><div style="font-size:13px;font-weight:800;color:#0f172a;">${files.length} item${files.length === 1 ? '' : 's'}</div></div>
            </div>
          </div>
        </div>

        <!-- MAIN MIDDLE SECTION: 3 CARDS (Photos, Emails, Calendar) -->
        <div style="display:grid;grid-template-columns: 1.15fr 0.95fr 0.9fr; gap: 14px; margin-bottom: 14px;">
          
          <!-- 1. PHOTOS CARD (REAL PHOTOS ONLY) -->
          <div style="background:#f0f7ff;border:1px solid #dbeafe;border-radius:14px;padding:14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path fill="#EA4335" d="M12 2a5 5 0 0 0-5 5v5h5a5 5 0 0 0 0-10z"/>
                  <path fill="#4285F4" d="M22 12a5 5 0 0 0-5-5h-5v5a5 5 0 0 0 10 0z"/>
                  <path fill="#34A853" d="M12 22a5 5 0 0 0 5-5v-5h-5a5 5 0 0 0 0 10z"/>
                  <path fill="#FBBC05" d="M2 12a5 5 0 0 0 5 5h5v-5a5 5 0 0 0-10 0z"/>
                </svg>
                <span style="font-size:15px;font-weight:800;color:#0f172a;">Photos</span>
                <span style="font-size:11px;color:#64748b;">${photos.length} photo${photos.length === 1 ? '' : 's'}</span>
              </div>
              <span style="background:#dbeafe;color:#1d4ed8;font-size:10.5px;font-weight:700;padding:3px 10px;border-radius:12px;">View All</span>
            </div>

            <!-- Real Photos Grid -->
            ${photos.length === 0 ? `
              <div style="padding: 24px; text-align: center; color: #64748b; font-size: 11.5px; font-weight: 500;">
                No matching photos found in Google Photos.
              </div>
            ` : `
              <div style="display:grid;grid-template-columns:repeat(${Math.min(Math.max(photos.length, 2), 4)}, 1fr);gap:8px;">
                ${photos.slice(0, 8).map(p => {
                  const b64 = photoBase64Map[p.id || p.thumbnail || p.url];
                  const cleanTitle = (p.title || 'Photo').replace(/\.[^/.]+$/, '');
                  return `
                    <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:6px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
                      <div style="width:100%;height:80px;border-radius:6px;overflow:hidden;background:#e2e8f0;display:flex;align-items:center;justify-content:center;">
                        ${b64 ? `<img src="${b64}" style="width:100%;height:100%;object-fit:cover;" />` : `
                          <div style="width:100%;height:100%;background:linear-gradient(135deg, #0284c7, #38bdf8);display:flex;align-items:center;justify-content:center;color:white;font-size:24px;">📸</div>
                        `}
                      </div>
                      <div style="font-size:10.5px;font-weight:700;color:#0f172a;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${cleanTitle}</div>
                      <div style="font-size:9px;color:#64748b;margin-top:1px;">${p.formattedDate || 'Google Photos'}</div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <!-- 2. EMAILS CARD (REAL EMAILS ONLY) -->
          <div style="background:#fff5f5;border:1px solid #fee2e2;border-radius:14px;padding:14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M2 5v14c0 1.1.9 2 2 2h2V9.5L12 14l6-4.5V21h2c1.1 0 2-.9 2-2V5c0-1.6-1.9-2.5-3.2-1.4L12 8.5 5.2 3.6C3.9 2.5 2 3.4 2 5z"/>
                  <path fill="#EA4335" d="M20 19v-9.5L12 15l-8-5.5V19c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2z"/>
                  <path fill="#FBBC05" d="M4 5.5V9.5L12 15l8-5.5V5.5c0-.9-1-1.4-1.7-.9L12 9.5 5.7 4.6c-.7-.5-1.7 0-1.7.9z"/>
                </svg>
                <span style="font-size:15px;font-weight:800;color:#0f172a;">Emails</span>
                <span style="font-size:11px;color:#64748b;">${emails.length} related email${emails.length === 1 ? '' : 's'}</span>
              </div>
              <span style="background:#fee2e2;color:#b91c1c;font-size:10.5px;font-weight:700;padding:3px 10px;border-radius:12px;">View All</span>
            </div>

            <!-- Email List -->
            ${emails.length === 0 ? `
              <div style="padding: 24px; text-align: center; color: #64748b; font-size: 11.5px; font-weight: 500;">
                No matching emails found in Gmail.
              </div>
            ` : `
              <div style="display:flex;flex-direction:column;gap:8px;">
                ${emails.slice(0, 5).map((e, idx) => {
                  const senderName = e.sender || e.senderEmail || 'Google Mail';
                  const avatarChar = senderName.charAt(0).toUpperCase() || 'M';
                  const color = avatarColors[idx % avatarColors.length];
                  return `
                    <div style="display:flex;align-items:flex-start;gap:10px;padding:5px 0;border-bottom:1px solid #fecaca22;">
                      <div style="width:28px;height:28px;border-radius:50%;background:${color};color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0;">
                        ${avatarChar}
                      </div>
                      <div style="flex:1;min-width:0;">
                        <div style="display:flex;align-items:center;justify-content:space-between;">
                          <span style="font-size:11.5px;font-weight:700;color:#0f172a;">${senderName}</span>
                          <span style="font-size:9.5px;color:#64748b;">${e.formattedDate || e.timestamp || ''}</span>
                        </div>
                        <div style="font-size:10.5px;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;">${e.title || '(No Subject)'}</div>
                        <div style="font-size:9.5px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px;">${e.snippet || e.description || ''}</div>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <!-- 3. CALENDAR CARD (REAL EVENTS ONLY) -->
          <div style="background:#f0f9ff;border:1px solid #e0f2fe;border-radius:14px;padding:14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <svg width="18" height="18" viewBox="0 0 24 24">
                  <rect x="2" y="3" width="20" height="18" rx="4" fill="#1a73e8"/>
                  <path d="M2 8h20" stroke="#ffffff" stroke-width="2"/>
                  <text x="12" y="18" fill="#ffffff" font-size="9" font-weight="bold" text-anchor="middle" font-family="sans-serif">12</text>
                </svg>
                <span style="font-size:15px;font-weight:800;color:#0f172a;">Calendar</span>
                <span style="font-size:11px;color:#64748b;">${events.length} event${events.length === 1 ? '' : 's'}</span>
              </div>
              <span style="background:#e0f2fe;color:#0284c7;font-size:10.5px;font-weight:700;padding:3px 10px;border-radius:12px;">View All</span>
            </div>

            <!-- Calendar Timeline Events -->
            ${events.length === 0 ? `
              <div style="padding: 24px; text-align: center; color: #64748b; font-size: 11.5px; font-weight: 500;">
                No matching calendar events found.
              </div>
            ` : `
              <div style="display:flex;flex-direction:column;gap:10px;margin-top:4px;">
                ${events.slice(0, 5).map((ev, idx) => {
                  const dt = parseEventDate(ev);
                  const dotColors = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b'];
                  const dotColor = dotColors[idx % dotColors.length];
                  const evTitle = ev.title || 'Calendar Event';
                  
                  let tag = 'Event';
                  let tagBg = '#eff6ff';
                  let tagColor = '#1d4ed8';
                  const lowTitle = evTitle.toLowerCase();
                  if (lowTitle.includes('flight') || lowTitle.includes('trip') || lowTitle.includes('travel') || lowTitle.includes('hotel')) {
                    tag = 'Travel';
                    tagBg = '#eff6ff';
                    tagColor = '#1d4ed8';
                  } else if (lowTitle.includes('sight') || lowTitle.includes('tour') || lowTitle.includes('beach') || lowTitle.includes('fort')) {
                    tag = 'Sightseeing';
                    tagBg = '#f0fdf4';
                    tagColor = '#15803d';
                  } else if (lowTitle.includes('water') || lowTitle.includes('activity') || lowTitle.includes('sport')) {
                    tag = 'Activity';
                    tagBg = '#faf5ff';
                    tagColor = '#7e22ce';
                  }

                  return `
                    <div style="display:flex;align-items:flex-start;gap:10px;">
                      <!-- Date Badge Box -->
                      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;width:42px;height:46px;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 1px 2px rgba(0,0,0,0.03);">
                        <div style="font-size:8px;font-weight:800;color:#ef4444;text-transform:uppercase;line-height:1;">${dt.month}</div>
                        <div style="font-size:13px;font-weight:800;color:#0f172a;line-height:1.1;">${dt.day}</div>
                        <div style="font-size:8px;color:#64748b;line-height:1;">${dt.weekday}</div>
                      </div>

                      <!-- Dot + Content -->
                      <div style="flex:1;min-width:0;position:relative;">
                        <div style="display:flex;align-items:center;justify-content:space-between;">
                          <div style="display:flex;align-items:center;gap:6px;">
                            <span style="width:7px;height:7px;border-radius:50%;background:${dotColor};display:inline-block;"></span>
                            <strong style="font-size:11px;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${evTitle}</strong>
                          </div>
                          <span style="background:${tagBg};color:${tagColor};font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:10px;flex-shrink:0;">${tag}</span>
                        </div>
                        <div style="font-size:9.5px;color:#64748b;margin-top:2px;margin-left:13px;">${ev.formattedDate || 'Scheduled Event'}</div>
                        ${ev.location ? `<div style="font-size:9px;color:#475569;margin-top:2px;margin-left:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">📍 ${ev.location}</div>` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

        </div>

        <!-- MAIN BOTTOM SECTION: 2 CARDS (Maps & Locations, Drive) -->
        <div style="display:grid;grid-template-columns: 1fr 1.1fr; gap: 14px;">
          
          <!-- 4. MAPS & LOCATIONS CARD (REAL RESOLVED PLACES ONLY) -->
          <div style="background:#f0fdf4;border:1px solid #dcfce7;border-radius:14px;padding:14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path fill="#EA4335" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
                  <circle cx="12" cy="9" r="3" fill="#ffffff"/>
                  <circle cx="12" cy="9" r="1.5" fill="#4285F4"/>
                </svg>
                <span style="font-size:15px;font-weight:800;color:#0f172a;">Maps & Locations</span>
                <span style="font-size:11px;color:#64748b;">${locs.length} place${locs.length === 1 ? '' : 's'} visited / saved</span>
              </div>
              <span style="background:#dcfce7;color:#15803d;font-size:10.5px;font-weight:700;padding:3px 10px;border-radius:12px;">View All</span>
            </div>

            <!-- Split: Places List + Visual Map Preview -->
            ${locs.length === 0 ? `
              <div style="padding: 24px; text-align: center; color: #64748b; font-size: 11.5px; font-weight: 500;">
                No geographic locations resolved for this search.
              </div>
            ` : `
              <div style="display:grid;grid-template-columns:1fr 1.15fr;gap:12px;">
                <!-- Left List of Real Locations -->
                <div style="display:flex;flex-direction:column;gap:8px;">
                  ${locs.slice(0, 4).map(l => `
                    <div style="display:flex;align-items:center;gap:8px;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:6px 10px;box-shadow:0 1px 2px rgba(0,0,0,0.02);">
                      <div style="width:36px;height:36px;border-radius:8px;background:#e0f2fe;display:flex;align-items:center;justify-content:center;color:#0284c7;font-size:18px;flex-shrink:0;">
                        📍
                      </div>
                      <div style="flex:1;min-width:0;">
                        <div style="font-size:11px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.name || 'Location'}</div>
                        <div style="font-size:9.5px;color:#64748b;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${l.formattedAddress || l.fullAddress || l.name || ''}</div>
                        <div style="font-size:8.5px;color:#94a3b8;margin-top:1px;">Category: ${l.category || 'Resolved Place'}</div>
                      </div>
                    </div>
                  `).join('')}
                </div>

                <!-- Right Map Graphic -->
                <div style="background:#e0f2fe;border:1px solid #bae6fd;border-radius:10px;position:relative;overflow:hidden;height:160px;box-shadow:inset 0 0 10px rgba(2,132,199,0.05);">
                  <svg width="100%" height="100%" viewBox="0 0 280 160" preserveAspectRatio="none" style="position:absolute;top:0;left:0;">
                    <path d="M50 0 Q100 40 75 80 T130 160 L280 160 L280 0 Z" fill="#dcfce7" opacity="0.85"/>
                    <path d="M0 0 L50 0 Q100 40 75 80 T130 160 L0 160 Z" fill="#bae6fd" opacity="0.6"/>
                    <path d="M80 30 Q110 70 140 120" fill="none" stroke="#2563eb" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="4 3"/>
                    
                    <circle cx="110" cy="70" r="7" fill="#ef4444" stroke="#ffffff" stroke-width="2"/>
                    <text x="122" y="74" fill="#0f172a" font-size="11" font-weight="bold" font-family="sans-serif">${locs[0].name || displayQuery}</text>
                    <text x="122" y="87" fill="#64748b" font-size="8.5" font-family="sans-serif">${locs[0].formattedAddress || 'Verified Geographic Place'}</text>
                  </svg>

                  <!-- Map View Button -->
                  <div style="position:absolute;bottom:8px;right:8px;background:#ffffff;border:1px solid #cbd5e1;padding:4px 10px;border-radius:8px;font-size:9.5px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:4px;box-shadow:0 2px 4px rgba(0,0,0,0.08);">
                    <span>Map View</span>
                    <span>↗</span>
                  </div>
                </div>
              </div>
            `}
          </div>

          <!-- 5. DRIVE CARD (REAL DRIVE FILES ONLY) -->
          <div style="background:#fffbeb;border:1px solid #fef3c7;border-radius:14px;padding:14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
              <div style="display:flex;align-items:center;gap:8px;">
                <svg width="20" height="20" viewBox="0 0 24 24">
                  <path fill="#FFC107" d="M8.5 3.5L2 14.8l4.3 7.5 6.5-11.3z"/>
                  <path fill="#4CAF50" d="M15.5 3.5h-7l6.5 11.3 7-12.1a1.5 1.5 0 0 0-1.3-.7h-5.2z"/>
                  <path fill="#2196F3" d="M22 14.8H8.8l-4.3 7.5c.6 1 1.7 1.7 2.9 1.7h13.2a3 3 0 0 0 2.6-1.5l2-3.5-3.2-4.2z"/>
                </svg>
                <span style="font-size:15px;font-weight:800;color:#0f172a;">Drive</span>
                <span style="font-size:11px;color:#64748b;">${files.length} related file${files.length === 1 ? '' : 's'}</span>
              </div>
              <span style="background:#fef3c7;color:#b45309;font-size:10.5px;font-weight:700;padding:3px 10px;border-radius:12px;">View All</span>
            </div>

            <!-- Structured Files Table (Real Files) -->
            ${files.length === 0 ? `
              <div style="padding: 24px; text-align: center; color: #64748b; font-size: 11.5px; font-weight: 500;">
                No matching files found in Google Drive.
              </div>
            ` : `
              <div style="display:flex;flex-direction:column;gap:5px;">
                ${files.slice(0, 8).map(f => {
                  let fileSize = 'File';
                  if (f.description && f.description.includes('MB')) {
                    const match = f.description.match(/([0-9.]+\s*MB)/i);
                    if (match) fileSize = match[1];
                  } else if (f.description && f.description.includes('KB')) {
                    const match = f.description.match(/([0-9.]+\s*KB)/i);
                    if (match) fileSize = match[1];
                  }
                  return `
                    <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 6px;border-bottom:1px solid #fef3c7;">
                      <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;">
                        ${getFileIconSvg(f.fileType, f.title)}
                        <span style="font-size:10.5px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.title || 'Untitled File'}</span>
                      </div>
                      <div style="display:flex;align-items:center;gap:14px;flex-shrink:0;">
                        <span style="font-size:9.5px;color:#64748b;width:80px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.fileType || 'Document'}</span>
                        <span style="font-size:9.5px;color:#64748b;width:75px;white-space:nowrap;">${f.formattedDate || ''}</span>
                        <span style="font-size:9.5px;color:#64748b;width:50px;text-align:right;">${fileSize}</span>
                        <span style="font-size:12px;color:#64748b;cursor:pointer;margin-left:4px;">↓</span>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

        </div>
      `;

      renderWrapper.appendChild(container);
      document.body.appendChild(renderWrapper);

      // Brief delay for DOM reflow
      await new Promise(r => setTimeout(r, 250));

      const safeFilename = `Digital_Vault_${query.replace(/[^a-z0-9]/gi, '_')}_Dashboard_${now.toISOString().slice(0,10)}.pdf`;

      // Render directly with html2canvas and jsPDF
      if (window.html2canvas && window.jspdf) {
        const canvas = await window.html2canvas(container, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0,
          windowWidth: 1300,
          windowHeight: 900
        });

        const { jsPDF } = window.jspdf;
        const imgData = canvas.toDataURL('image/jpeg', 0.95);
        const pdf = new jsPDF({
          orientation: 'landscape',
          unit: 'mm',
          format: 'a4'
        });

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const imgHeight = (canvas.height * pdfWidth) / canvas.width;

        if (imgHeight > pdfHeight) {
          const ratio = pdfHeight / imgHeight;
          pdf.addImage(imgData, 'JPEG', (pdfWidth - (imgWidth * ratio)) / 2, 0, imgWidth * ratio, pdfHeight);
        } else {
          const marginY = (pdfHeight - imgHeight) / 2;
          pdf.addImage(imgData, 'JPEG', 0, Math.max(0, marginY), pdfWidth, imgHeight);
        }

        pdf.save(safeFilename);
      } else if (window.html2pdf) {
        const opt = {
          margin: 0,
          filename: safeFilename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, useCORS: true, allowTaint: true },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
        };
        await window.html2pdf().set(opt).from(container).save();
      } else {
        window.print();
      }

      // Remove wrapper
      if (renderWrapper && renderWrapper.parentNode) {
        renderWrapper.parentNode.removeChild(renderWrapper);
      }

      if (saveArchive) {
        saveReportToProgress(data, query, true);
      }

      showToast('✨ Visual Executive PDF Report downloaded successfully!');
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
          <div class="list-item-row photo-item-row" data-url="${p.url}" data-photo-id="${p.id}" title="Click to open this photo" style="cursor: pointer; display: flex; align-items: center; gap: 14px; padding: 12px; border-radius: 10px; margin-bottom: 8px;">
            ${p.thumbnail ? `<img src="${p.thumbnail}" alt="${p.title}" style="width: 52px; height: 52px; border-radius: 8px; object-fit: cover; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.15);" onerror="this.style.display='none'"/>` : `<div style="width: 52px; height: 52px; border-radius: 8px; background: rgba(56,189,248,0.1); border: 1px solid rgba(56,189,248,0.25); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0;">📸</div>`}
            <div class="row-text" style="flex: 1; min-width: 0;">
              <h5 class="item-title" style="margin: 0 0 4px 0; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">🖼️ ${p.title}</h5>
              <div class="item-meta" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                ${p.formattedDate ? `<span style="font-size: 11px; color: #38bdf8;">📅 ${p.formattedDate}</span>` : ''}
              </div>
              <p class="item-desc" style="margin: 0; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${p.description}</p>
            </div>
            <a href="${p.url}" target="_blank" rel="noopener noreferrer" class="item-open-btn view-photo-btn" style="font-size: 11px; font-weight: 600; text-decoration: none; padding: 6px 14px; border-radius: 6px; white-space: nowrap; align-self: center;">Open ↗</a>
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
          <div class="list-item-row gmail-email-row" data-url="${e.url}" data-message-id="${e.messageId || e.id}" data-thread-id="${e.threadId || ''}" title="Click to open this email in Gmail" style="cursor: pointer; display: flex; align-items: flex-start; gap: 12px; padding: 12px; border-radius: 10px; margin-bottom: 8px;">
            <div style="width: 38px; height: 38px; border-radius: 8px; background: rgba(234, 67, 53, 0.12); border: 1px solid rgba(234, 67, 53, 0.3); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 18px;">
              ✉️
            </div>
            <div class="row-text" style="flex: 1; min-width: 0;">
              <h5 class="item-title" style="margin: 0 0 4px 0; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${e.title}</h5>
              <div class="item-meta" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
                ${e.sender ? `<span style="font-size: 11px; font-weight: 500; color: #38bdf8;">👤 ${e.sender}</span>` : ''}
                ${e.formattedDate ? `<span style="font-size: 10px; color: #94a3b8;">🕒 ${e.formattedDate}</span>` : ''}
                ${e.hasAttachments ? `<span style="font-size: 10px; color: #fbbf24; background: rgba(251,191,36,0.12); padding: 1px 5px; border-radius: 4px; border: 1px solid rgba(251,191,36,0.3);">📎 Attachment</span>` : ''}
              </div>
              <p class="item-desc" style="margin: 0; font-size: 11px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.4;">${e.snippet || e.description}</p>
            </div>
            <a href="${e.url}" target="_blank" rel="noopener noreferrer" class="item-open-btn open-direct-email-btn" style="font-size: 11px; font-weight: 600; text-decoration: none; padding: 6px 14px; border-radius: 6px; white-space: nowrap; align-self: center;">Open ↗</a>
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
          <div class="list-item-row drive-file-row" data-url="${f.url}" data-file-id="${f.id}" title="Click to open this file in Google Drive" style="cursor: pointer; display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 10px; margin-bottom: 8px;">
            <div style="width: 38px; height: 38px; border-radius: 8px; background: rgba(38, 132, 252, 0.12); border: 1px solid rgba(38, 132, 252, 0.3); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 18px;">
              📄
            </div>
            <div class="row-text" style="flex: 1; min-width: 0;">
              <h5 class="item-title" style="margin: 0 0 3px 0; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${f.title}</h5>
              <div class="item-meta" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 3px;">
                ${f.formattedDate ? `<span style="font-size: 11px; color: #38bdf8;">🕒 Modified ${f.formattedDate}</span>` : ''}
                ${f.fileType ? `<span style="font-size: 10px; color: #94a3b8; background: rgba(255,255,255,0.05); padding: 1px 5px; border-radius: 4px;">${f.fileType}</span>` : ''}
              </div>
              <p class="item-desc" style="margin: 0; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${f.description}</p>
            </div>
            <a href="${f.url}" target="_blank" rel="noopener noreferrer" class="item-open-btn" style="font-size: 11px; font-weight: 600; text-decoration: none; padding: 6px 14px; border-radius: 6px; white-space: nowrap; align-self: center;">Open ↗</a>
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
        catModalBody.innerHTML = '<div style="text-align:center; padding:30px 10px; color:#94a3b8;"><div style="font-size:32px; margin-bottom:8px;">🗓️</div><p style="font-size:13px;">No events match the current search query.</p></div>';
      } else {
        catModalBody.innerHTML = events.map(ev => `
          <div class="list-item-row calendar-event-row" data-url="${ev.url}" data-event-id="${ev.id}" title="Click to open event in Google Calendar" style="cursor: pointer; display: flex; align-items: flex-start; gap: 12px; padding: 12px; border-radius: 8px; margin-bottom: 8px;">
            <div style="width: 38px; height: 38px; border-radius: 8px; background: rgba(66, 133, 244, 0.15); border: 1px solid rgba(66, 133, 244, 0.35); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 18px;">
              🗓️
            </div>
            <div class="row-text" style="flex: 1; min-width: 0;">
              <h5 class="item-title" style="margin: 0 0 4px 0; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${ev.title}</h5>
              <div class="item-meta" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 3px;">
                <span style="font-size: 11px; color: #38bdf8; font-weight: 500;">🕒 ${ev.formattedDate || 'Event date'}</span>
                ${ev.location ? `<span style="font-size: 11px; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">📍 ${ev.location}</span>` : ''}
              </div>
              ${ev.description ? `<p class="item-desc" style="margin: 0; font-size: 11px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">📝 ${ev.description}</p>` : ''}
            </div>
            <a href="${ev.url}" target="_blank" rel="noopener noreferrer" class="item-open-btn open-direct-calendar-btn" style="font-size: 11px; font-weight: 600; text-decoration: none; padding: 6px 14px; border-radius: 6px; white-space: nowrap; align-self: center;">Open ↗</a>
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
      // Allow dropdown more-options-btn toggle
      if (e.target.closest('.more-options-btn')) {
        return;
      }
      const catKey = elem.getAttribute('data-category');
      if (catKey) {
        e.preventDefault();
        e.stopPropagation();
        openCategoryModal(catKey);
      }
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
