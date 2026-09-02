// Storage keys for persisting user preferences
const STORAGE_KEY_STRIKES = 'papa_strike_count';
const STORAGE_KEY_COOLDOWN = 'papa_refresh_cooldown';

// Load stored preferences or fallback to defaults
let savedStrikeDepth = null;
try {
  savedStrikeDepth = parseInt(localStorage.getItem(STORAGE_KEY_STRIKES));
} catch (e) {}
let strikeDepth = (!isNaN(savedStrikeDepth) && savedStrikeDepth > 0) ? savedStrikeDepth : 10; // Default 10 above, 10 below

let savedCooldown = null;
try {
  savedCooldown = parseInt(localStorage.getItem(STORAGE_KEY_COOLDOWN));
} catch (e) {}
let refreshCooldownSeconds = (!isNaN(savedCooldown) && savedCooldown > 0) ? savedCooldown : 30; // Default fixed 30 seconds
let timerSecondsRemaining = refreshCooldownSeconds;

// State
let currentSymbol = 'NIFTY';
let currentExpiry = '';
let timerCountdownInterval = null;
let lastFetchedData = null;
let lastSuccessfulFetchTime = null;

// DOM Elements
const symbolSelect = document.getElementById('symbolSelect');
const expirySelect = document.getElementById('expirySelect');
const strikeCountInput = document.getElementById('strikeCountInput');
const cooldownInput = document.getElementById('cooldownInput');
const lastUpdatedDisplay = document.getElementById('lastUpdatedDisplay');
const timerDisplay = document.getElementById('timerDisplay');
const refreshBtn = document.getElementById('refreshBtn');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const noticeBanner = document.getElementById('noticeBanner');
const noticeMessage = document.getElementById('noticeMessage');
const tableBody = document.getElementById('tableBody');
const tableFoot = document.getElementById('tableFoot');
const toastContainer = document.getElementById('toastContainer');

// Utility: Format numbers to Indian Numbering System (e.g. 1,51,47,600)
function formatIndianNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '-';
  if (num === 0) return '0';
  
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  const rounded = Math.round(absNum * 100) / 100;
  
  const parts = rounded.toString().split('.');
  let integerPart = parts[0];
  const decimalPart = parts.length > 1 ? '.' + parts[1] : '';

  // Indian comma formatting: last 3 digits, then every 2 digits
  let lastThree = integerPart.substring(integerPart.length - 3);
  const otherNumbers = integerPart.substring(0, integerPart.length - 3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  const formatted = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree + decimalPart;
  return (isNegative ? '-' : '') + formatted;
}

// Utility: Format decimal (e.g. LTP / IV)
function formatDecimal(num, decimals = 2) {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return Number(num).toFixed(decimals);
}

// Cumulative standard normal distribution approximation (Abramowitz & Stegun)
function normalCdf(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = (x < 0) ? -1 : 1;
  const absX = Math.abs(x) / Math.sqrt(2.0);

  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);

  return 0.5 * (1.0 + sign * y);
}

// Black-Scholes Delta Calculator
function calculateDelta(spot, strike, ivPct, daysToExpiry, r = 0.068) {
  if (!spot || !strike || daysToExpiry <= 0) {
    return { callDelta: null, putDelta: null };
  }
  const S = Number(spot);
  const K = Number(strike);
  let sigma = Number(ivPct) / 100.0;
  if (!sigma || isNaN(sigma) || sigma <= 0) {
    sigma = 0.12; // Fallback to standard 12% IV if completely missing
  }
  const T = Math.max(daysToExpiry, 0.01) / 365.0; // Time in years

  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const callDelta = normalCdf(d1);
  const putDelta = callDelta - 1.0;

  return {
    callDelta: Number(callDelta.toFixed(2)),
    putDelta: Number(putDelta.toFixed(2))
  };
}

// Parse expiry date string (e.g. 08-Sep-2026) to remaining days
function parseDaysToExpiry(expiryStr) {
  if (!expiryStr) return 7;
  const parts = expiryStr.split('-');
  if (parts.length < 3) return 7;
  const day = parseInt(parts[0]);
  const monthMap = {
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
  };
  const month = monthMap[parts[1]] ?? 8;
  const year = parseInt(parts[2]);
  const expiryDate = new Date(Date.UTC(year, month, day, 15, 30, 0)); // 3:30 PM IST expiry
  const now = new Date();
  const diffMs = expiryDate.getTime() - now.getTime();
  const diffDays = Math.max(0.05, diffMs / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Utility: Format date & time in Standard Indian Time (IST) with second precision
function formatIndianDateTime(dateObj = new Date()) {
  if (!dateObj) return '-';
  const options = {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };
  return new Intl.DateTimeFormat('en-IN', options).format(dateObj) + ' IST';
}

// Toast Popup Notification (with Indian Standard Time)
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = '✅';
  if (type === 'warning') icon = '⚠️';
  if (type === 'error') icon = '❌';

  const timeStr = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  }) + ' IST';

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-msg">${message}</span>
    <span class="toast-time">${timeStr}</span>
  `;

  toastContainer.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Auto remove after 4.5 seconds for errors, 3.5s for normal
  const duration = (type === 'error') ? 5000 : 3500;
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 250);
  }, duration);
}

// Helper: Check if current time in Indian Standard Time (IST) is within 7:00 AM - 4:00 PM
function isMarketActiveHoursIST() {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istDate = new Date(istString);
  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  // Active window: 7:00 AM (420 min) to 4:00 PM / 16:00 (960 min)
  return timeInMinutes >= 420 && timeInMinutes < 960;
}

// Start Configurable Countdown Timer (Runs 7:00 AM - 4:00 PM IST; Pauses after 4:00 PM)
function startAutoRefreshTimer(resetToMax = true) {
  if (timerCountdownInterval) {
    clearInterval(timerCountdownInterval);
    timerCountdownInterval = null;
  }

  // After 4:00 PM IST until 7:00 AM IST: No auto-refresh (uses cached data, manual refresh only)
  if (!isMarketActiveHoursIST()) {
    if (timerDisplay) {
      timerDisplay.textContent = 'Paused (Resumes 7 AM)';
    }
    // Background watcher to automatically resume auto-refresh when morning 7:00 AM IST arrives
    timerCountdownInterval = setInterval(() => {
      if (isMarketActiveHoursIST()) {
        clearInterval(timerCountdownInterval);
        startAutoRefreshTimer(true);
        fetchOptionChain(true); // First morning auto-refresh
      }
    }, 15000);
    return;
  }

  if (resetToMax) {
    timerSecondsRemaining = refreshCooldownSeconds;
  }
  updateTimerDisplay();

  timerCountdownInterval = setInterval(() => {
    // If time passes 4:00 PM IST during countdown, pause auto-refresh
    if (!isMarketActiveHoursIST()) {
      clearInterval(timerCountdownInterval);
      startAutoRefreshTimer(false);
      return;
    }

    timerSecondsRemaining--;
    updateTimerDisplay();

    if (timerSecondsRemaining <= 0) {
      clearInterval(timerCountdownInterval);
      fetchOptionChain(true); // Auto trigger
    }
  }, 1000);
}

function updateTimerDisplay() {
  if (!isMarketActiveHoursIST()) {
    timerDisplay.textContent = 'Paused (Resumes 7 AM)';
    return;
  }
  const mins = Math.floor(timerSecondsRemaining / 60);
  const secs = timerSecondsRemaining % 60;
  const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  timerDisplay.textContent = `${formatted} (${timerSecondsRemaining}s)`;
}

// Fetch Option Chain Data from Local Proxy Server
async function fetchOptionChain(isAutoRefresh = false) {
  try {
    statusBadge.className = 'status-badge';
    statusText.textContent = 'Fetching...';

    const url = `/api/option-chain?symbol=${encodeURIComponent(currentSymbol)}&expiry=${encodeURIComponent(currentExpiry)}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status} (${response.statusText || 'Error'})`);
    }

    const result = await response.json();

    if (result.success && result.data) {
      lastFetchedData = result.data;
      lastSuccessfulFetchTime = new Date();
      
      // Update Indian Standard Time (IST) display with date and second
      if (lastUpdatedDisplay) {
        lastUpdatedDisplay.textContent = formatIndianDateTime(lastSuccessfulFetchTime);
      }

      // Update Expiry Dropdown if available in records
      if (result.data.records && result.data.records.expiryDates) {
        updateExpiryDropdown(result.data.records.expiryDates);
      }

      // Check Live vs Cached vs Fallback status
      if (result.cached || result.marketClosed) {
        statusBadge.className = 'status-badge cached';
        statusText.textContent = 'Cached (4 PM)';
        noticeBanner.classList.add('hidden');
        showToast('Using Post-4 PM Cached Data', 'success');
      } else if (result.live) {
        statusBadge.className = 'status-badge live';
        statusText.textContent = 'Live NSE';
        noticeBanner.classList.add('hidden');
        showToast('Data Refreshed (Live NSE)', 'success');
      } else {
        statusBadge.className = 'status-badge fallback';
        statusText.textContent = 'Fallback Data';
        noticeBanner.classList.remove('hidden');
        noticeMessage.textContent = result.error || 'NSE live fetch failed. Showing cached fallback data.';
        showToast('Data Refreshed (Fallback Dataset)', 'warning');
      }

      renderTable(result.data);
    } else {
      throw new Error(result.error || 'Invalid or empty data payload received');
    }
  } catch (error) {
    console.error('Fetch error:', error);
    const failureReason = error.message || 'Network disconnected or server unavailable';
    
    statusBadge.className = 'status-badge error';
    statusText.textContent = 'Fetch Failed';

    const lastTimeStr = lastSuccessfulFetchTime ? formatIndianDateTime(lastSuccessfulFetchTime) : 'Never';

    // Show side toast error notification with failure reason
    showToast(`Data fetch failed: ${failureReason}`, 'error');

    // Show top banner with persistent explanation and last active data time
    noticeBanner.classList.remove('hidden');
    noticeMessage.textContent = `Data fetch failed (${failureReason}). Preserving last fetched data from ${lastTimeStr}.`;

    // DO NOT clear existing table data on network/fetch disconnection
    if (!lastFetchedData) {
      tableBody.innerHTML = `<tr><td colspan="15" style="text-align:center; padding: 25px; color: #ef4444; font-weight: 600;">Data fetch failed: ${failureReason}. No previous data available.</td></tr>`;
    }
  } finally {
    // Re-schedule next timer based on configured cooldown
    startAutoRefreshTimer(true);
  }
}

// Update Expiry Dates dropdown
function updateExpiryDropdown(expiryDates) {
  if (!Array.isArray(expiryDates) || expiryDates.length === 0) return;

  const previousValue = expirySelect.value;
  expirySelect.innerHTML = '';

  expiryDates.forEach(date => {
    const opt = document.createElement('option');
    opt.value = date;
    opt.textContent = date;
    expirySelect.appendChild(opt);
  });

  if (currentExpiry && expiryDates.includes(currentExpiry)) {
    expirySelect.value = currentExpiry;
  } else if (previousValue && expiryDates.includes(previousValue)) {
    expirySelect.value = previousValue;
    currentExpiry = previousValue;
  } else {
    currentExpiry = expiryDates[0];
    expirySelect.value = currentExpiry;
  }
}

// Render Option Chain Table with Set A, Set B, Baseline Divider & Golden Exact Match
function renderTable(payload) {
  let records = [];
  let underlyingValue = 24055.8;
  let futureValue = null;

  if (payload.futureValue) {
    futureValue = Number(payload.futureValue);
  } else if (payload.records && payload.records.futureValue) {
    futureValue = Number(payload.records.futureValue);
  }

  if (payload.filtered && payload.filtered.data) {
    records = payload.filtered.data;
  } else if (payload.records && payload.records.data) {
    records = payload.records.data;
  } else if (Array.isArray(payload.data)) {
    records = payload.data;
  } else if (Array.isArray(payload)) {
    records = payload;
  }

  if (payload.records && payload.records.underlyingValue) {
    underlyingValue = Number(payload.records.underlyingValue);
  } else if (records.length > 0 && records[0].CE && records[0].CE.underlyingValue) {
    underlyingValue = Number(records[0].CE.underlyingValue);
  }

  if (!futureValue) {
    futureValue = underlyingValue;
  }

  // Update F: Value and 65 Multiplier in Badges
  const futBadgeEl = document.getElementById('futHeaderBadge');
  if (futBadgeEl) {
    futBadgeEl.textContent = `F: ${formatIndianNumber(futureValue)}`;
  }
  const brandBadgeEl = document.getElementById('brandBadge');
  if (brandBadgeEl) {
    brandBadgeEl.textContent = `65•${currentSymbol}`;
  }

  // Filter records by selected expiry if multiple are present
  const currentExpiryValue = expirySelect.value || currentExpiry;
  let filteredRecords = records.filter(r => {
    if (!r.expiryDates && !r.CE?.expiryDate && !r.PE?.expiryDate) return true;
    return (r.expiryDates === currentExpiryValue || r.CE?.expiryDate === currentExpiryValue || r.PE?.expiryDate === currentExpiryValue);
  });

  if (filteredRecords.length === 0) {
    filteredRecords = records;
  }

  // Deduplicate by strikePrice
  const strikeMap = new Map();
  filteredRecords.forEach(r => {
    const strike = Number(r.strikePrice);
    if (!isNaN(strike) && !strikeMap.has(strike)) {
      strikeMap.set(strike, r);
    }
  });

  const allStrikes = Array.from(strikeMap.keys()).sort((a, b) => a - b);
  if (allStrikes.length === 0) {
    tableBody.innerHTML = '<tr><td colspan="15" style="text-align:center; padding: 20px;">No option chain records found.</td></tr>';
    return;
  }

  // Separate into SET A (Strikes > underlyingValue) and SET B (Strikes < underlyingValue)
  // Check for Exact Match (Strike === underlyingValue)
  const setA_Strikes = allStrikes.filter(s => s > underlyingValue).sort((a, b) => a - b); // Ascending: closest to spot first
  const setB_Strikes = allStrikes.filter(s => s < underlyingValue).sort((a, b) => b - a); // Descending: closest to spot first
  const exactMatchStrike = allStrikes.find(s => s === underlyingValue);

  // User configured depth: slice N above and N below
  const count = Math.max(1, parseInt(strikeCountInput.value) || strikeDepth);
  
  const selectedA = setA_Strikes.slice(0, count).sort((a, b) => b - a); // Display descending (highest on top)
  const selectedB = setB_Strikes.slice(0, count).sort((a, b) => b - a); // Display descending (closest to spot on top)

  const LOT_MULTIPLIER = 65;

  // Find max values for badge highlights and compute fallback ATM IV
  const visibleStrikes = [...selectedA, ...(exactMatchStrike ? [exactMatchStrike] : []), ...selectedB];
  let maxCeOI = 0;
  let maxCeVol = 0;
  let maxCeOiChg = 0;
  let maxPeOI = 0;
  let maxPeVol = 0;
  let maxPeOiChg = 0;
  const validIvs = [];

  visibleStrikes.forEach(s => {
    const r = strikeMap.get(s);
    if (r) {
      if (r.CE) {
        const ceOi = (Number(r.CE.openInterest) || 0) * LOT_MULTIPLIER;
        const ceOiChg = (Number(r.CE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
        const ceVol = (Number(r.CE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if (ceOi > maxCeOI) maxCeOI = ceOi;
        if (ceVol > maxCeVol) maxCeVol = ceVol;
        if (ceOiChg > maxCeOiChg) maxCeOiChg = ceOiChg;
        if (Number(r.CE.impliedVolatility) > 0) validIvs.push(Number(r.CE.impliedVolatility));
      }
      if (r.PE) {
        const peOi = (Number(pe.openInterest) || 0) * LOT_MULTIPLIER;
        const peOiChg = (Number(pe.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
        const peVol = (Number(pe.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if (peOi > maxPeOI) maxPeOI = peOi;
        if (peVol > maxPeVol) maxPeVol = peVol;
        if (peOiChg > maxPeOiChg) maxPeOiChg = peOiChg;
        if (Number(r.PE.impliedVolatility) > 0) validIvs.push(Number(r.PE.impliedVolatility));
      }
    }
  });

  const fallbackAtmIv = validIvs.length > 0 ? (validIvs.reduce((a, b) => a + b, 0) / validIvs.length) : 12.0;

  // -------------------------------------------------------------
  // Calculate Resistance (R3: 3 Params [OI, OI Chg, Vol]) for CALLS (CE):
  // Start from 1st ITM row (closest strike < spot). If any of the 3 (OI, OI Chg, Volume)
  // is at 100% max, take that strike. If not, go UP into OTM (ascending from spot)
  // until the first 100% max is found.
  // -------------------------------------------------------------
  let resistanceStrike3 = null;

  // Check 1st ITM strike for Calls (or exact match if present)
  const candidateCeItmStrikes = exactMatchStrike ? [exactMatchStrike, ...setB_Strikes] : setB_Strikes;
  if (candidateCeItmStrikes.length > 0) {
    const firstItmCe = candidateCeItmStrikes[0];
    const item = strikeMap.get(firstItmCe);
    if (item && item.CE) {
      const oi = (Number(item.CE.openInterest) || 0) * LOT_MULTIPLIER;
      const oic = (Number(item.CE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
      const vol = (Number(item.CE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
      if ((maxCeOI > 0 && oi === maxCeOI) || (maxCeOiChg > 0 && oic === maxCeOiChg) || (maxCeVol > 0 && vol === maxCeVol)) {
        resistanceStrike3 = firstItmCe;
      }
    }
  }

  // If not at 1st ITM strike, scan UP into OTM strikes (ascending from spot upwards)
  if (!resistanceStrike3) {
    for (const strike of setA_Strikes) {
      const item = strikeMap.get(strike);
      if (item && item.CE) {
        const oi = (Number(item.CE.openInterest) || 0) * LOT_MULTIPLIER;
        const oic = (Number(item.CE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
        const vol = (Number(item.CE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if ((maxCeOI > 0 && oi === maxCeOI) || (maxCeOiChg > 0 && oic === maxCeOiChg) || (maxCeVol > 0 && vol === maxCeVol)) {
          resistanceStrike3 = strike;
          break;
        }
      }
    }
  }

  // -------------------------------------------------------------
  // Calculate Resistance (R2: 2 Params [OI, Volume ONLY]) for CALLS (CE):
  // -------------------------------------------------------------
  let resistanceStrike2 = null;
  if (candidateCeItmStrikes.length > 0) {
    const firstItmCe = candidateCeItmStrikes[0];
    const item = strikeMap.get(firstItmCe);
    if (item && item.CE) {
      const oi = (Number(item.CE.openInterest) || 0) * LOT_MULTIPLIER;
      const vol = (Number(item.CE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
      if ((maxCeOI > 0 && oi === maxCeOI) || (maxCeVol > 0 && vol === maxCeVol)) {
        resistanceStrike2 = firstItmCe;
      }
    }
  }
  if (!resistanceStrike2) {
    for (const strike of setA_Strikes) {
      const item = strikeMap.get(strike);
      if (item && item.CE) {
        const oi = (Number(item.CE.openInterest) || 0) * LOT_MULTIPLIER;
        const vol = (Number(item.CE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if ((maxCeOI > 0 && oi === maxCeOI) || (maxCeVol > 0 && vol === maxCeVol)) {
          resistanceStrike2 = strike;
          break;
        }
      }
    }
  }

  // -------------------------------------------------------------
  // Calculate Support (S3: 3 Params [OI, OI Chg, Vol]) for PUTS (PE):
  // Start from 1st ITM row (closest strike > spot). If any of the 3 (OI, OI Chg, Volume)
  // is at 100% max, take that strike. If not, go DOWN into OTM (descending from spot)
  // until the first 100% max is found.
  // -------------------------------------------------------------
  let supportStrike3 = null;

  // Check 1st ITM strike for Puts (or exact match if present)
  const candidatePeItmStrikes = exactMatchStrike ? [exactMatchStrike, ...setA_Strikes] : setA_Strikes;
  if (candidatePeItmStrikes.length > 0) {
    const firstItmPe = candidatePeItmStrikes[0];
    const item = strikeMap.get(firstItmPe);
    if (item && item.PE) {
      const oi = (Number(item.PE.openInterest) || 0) * LOT_MULTIPLIER;
      const oic = (Number(item.PE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
      const vol = (Number(item.PE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
      if ((maxPeOI > 0 && oi === maxPeOI) || (maxPeOiChg > 0 && oic === maxPeOiChg) || (maxPeVol > 0 && vol === maxPeVol)) {
        supportStrike3 = firstItmPe;
      }
    }
  }

  // If not at 1st ITM strike, scan DOWN into OTM strikes (descending from spot downwards)
  if (!supportStrike3) {
    for (const strike of setB_Strikes) {
      const item = strikeMap.get(strike);
      if (item && item.PE) {
        const oi = (Number(item.PE.openInterest) || 0) * LOT_MULTIPLIER;
        const oic = (Number(item.PE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
        const vol = (Number(item.PE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if ((maxPeOI > 0 && oi === maxPeOI) || (maxPeOiChg > 0 && oic === maxPeOiChg) || (maxPeVol > 0 && vol === maxPeVol)) {
          supportStrike3 = strike;
          break;
        }
      }
    }
  }

  // -------------------------------------------------------------
  // Calculate Support (S2: 2 Params [OI, Volume ONLY]) for PUTS (PE):
  // -------------------------------------------------------------
  let supportStrike2 = null;
  if (candidatePeItmStrikes.length > 0) {
    const firstItmPe = candidatePeItmStrikes[0];
    const item = strikeMap.get(firstItmPe);
    if (item && item.PE) {
      const oi = (Number(item.PE.openInterest) || 0) * LOT_MULTIPLIER;
      const vol = (Number(item.PE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
      if ((maxPeOI > 0 && oi === maxPeOI) || (maxPeVol > 0 && vol === maxPeVol)) {
        supportStrike2 = firstItmPe;
      }
    }
  }
  if (!supportStrike2) {
    for (const strike of setB_Strikes) {
      const item = strikeMap.get(strike);
      if (item && item.PE) {
        const oi = (Number(item.PE.openInterest) || 0) * LOT_MULTIPLIER;
        const vol = (Number(item.PE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if ((maxPeOI > 0 && oi === maxPeOI) || (maxPeVol > 0 && vol === maxPeVol)) {
          supportStrike2 = strike;
          break;
        }
      }
    }
  }

  // Helper to retrieve or freeze 09:20 AM IST Fixed Levels (RF3, RF2, SF3, SF2)
  function getOrUpdateFixedRS(symbol, r3, r2, s3, s2) {
    const now = new Date();
    const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const istDate = new Date(istString);
    const todayDateString = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const currentMinutes = istDate.getHours() * 60 + istDate.getMinutes();
    const isPast920 = currentMinutes >= (9 * 60 + 20); // 9:20 AM IST = 560 mins

    const storageKey = `papa_fixed_levels_v2_${symbol}_${todayDateString}`;
    let fixedLevels = null;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        fixedLevels = JSON.parse(raw);
      }
    } catch (e) {}

    // 1. If already locked today at or after 9:20 AM, return locked values
    if (fixedLevels && (fixedLevels.rf3 || fixedLevels.rf2) && (fixedLevels.sf3 || fixedLevels.sf2)) {
      return fixedLevels;
    }

    // 2. If current time is 09:20 AM or later and we have valid levels, lock them permanently for today
    if (isPast920 && (r3 || r2) && (s3 || s2)) {
      fixedLevels = {
        date: todayDateString,
        symbol: symbol,
        rf3: r3 || r2,
        rf2: r2 || r3,
        sf3: s3 || s2,
        sf2: s2 || s3,
        lockedAt: '09:20 AM IST'
      };
      try {
        localStorage.setItem(storageKey, JSON.stringify(fixedLevels));
      } catch (e) {}
      return fixedLevels;
    }

    // 3. If before 09:20 AM today or during night/off-hours, check if there's any recent locked value for this symbol
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(`papa_fixed_levels_v2_${symbol}_`)) {
          const cached = JSON.parse(localStorage.getItem(key));
          if (cached && (cached.rf3 || cached.rf2) && (cached.sf3 || cached.sf2)) {
            return cached;
          }
        }
      }
    } catch (e) {}

    // 4. Live calculated fallback: Return current calculated levels so badges are NEVER empty
    return {
      date: todayDateString,
      symbol: symbol,
      rf3: r3 || r2,
      rf2: r2 || r3,
      sf3: s3 || s2,
      sf2: s2 || s3,
      lockedAt: 'Calculated'
    };
  }

  const fixedRS = getOrUpdateFixedRS(currentSymbol, resistanceStrike3, resistanceStrike2, supportStrike3, supportStrike2);
  const displayRf3 = fixedRS?.rf3 || resistanceStrike3 || resistanceStrike2;
  const displayRf2 = fixedRS?.rf2 || resistanceStrike2 || resistanceStrike3;
  const displaySf3 = fixedRS?.sf3 || supportStrike3 || supportStrike2;
  const displaySf2 = fixedRS?.sf2 || supportStrike2 || supportStrike3;

  // Update R, RF3, RF2, S, SF3, SF2 Badges in Super Headers
  const badgeResistance = document.getElementById('badgeResistance');
  const badgeRf3 = document.getElementById('badgeRf3');
  const badgeRf2 = document.getElementById('badgeRf2');
  const badgeSupport = document.getElementById('badgeSupport');
  const badgeSf3 = document.getElementById('badgeSf3');
  const badgeSf2 = document.getElementById('badgeSf2');

  if (badgeResistance) {
    badgeResistance.textContent = resistanceStrike3 ? `R: ${formatIndianNumber(resistanceStrike3)}` : 'R: -';
  }
  if (badgeRf3) {
    badgeRf3.textContent = displayRf3 ? `RF3: ${formatIndianNumber(displayRf3)}` : 'RF3: -';
    badgeRf3.title = displayRf3 ? `Resistance Fixed (3 Params: OI, OI Chg, Vol): ${formatIndianNumber(displayRf3)}` : 'RF3 (3-param)';
  }
  if (badgeRf2) {
    badgeRf2.textContent = displayRf2 ? `RF2: ${formatIndianNumber(displayRf2)}` : 'RF2: -';
    badgeRf2.title = displayRf2 ? `Resistance Fixed (2 Params: OI, Vol): ${formatIndianNumber(displayRf2)}` : 'RF2 (2-param)';
  }
  if (badgeSupport) {
    badgeSupport.textContent = supportStrike3 ? `S: ${formatIndianNumber(supportStrike3)}` : 'S: -';
  }
  if (badgeSf3) {
    badgeSf3.textContent = displaySf3 ? `SF3: ${formatIndianNumber(displaySf3)}` : 'SF3: -';
    badgeSf3.title = displaySf3 ? `Support Fixed (3 Params: OI, OI Chg, Vol): ${formatIndianNumber(displaySf3)}` : 'SF3 (3-param)';
  }
  if (badgeSf2) {
    badgeSf2.textContent = displaySf2 ? `SF2: ${formatIndianNumber(displaySf2)}` : 'SF2: -';
    badgeSf2.title = displaySf2 ? `Support Fixed (2 Params: OI, Vol): ${formatIndianNumber(displaySf2)}` : 'SF2 (2-param)';
  }

  // Helper function to render 2-line stacked cell with relative percentage & highlight badges
  function renderRelativeCell(val, maxVal, isCe, isOiChg = false) {
    const formattedVal = formatIndianNumber(val);
    const isMax = (val > 0 && maxVal > 0 && val === maxVal);
    let relPct = 0;
    let formattedPct = '-';

    if (maxVal > 0 && val > 0) {
      relPct = (val / maxVal) * 100;
      formattedPct = isMax ? '100%' : (relPct.toFixed(1) + '%');
    } else if (isOiChg && val < 0) {
      formattedPct = '0.0%';
    } else if (val === 0) {
      formattedPct = '0.0%';
    }

    if (isMax && val > 0) {
      const maxClass = isCe ? 'cell-highlight-max-ce' : 'cell-highlight-max-pe';
      return `<div class="${maxClass}"><span class="cell-val-main">${formattedVal}</span><span class="cell-val-sub">100%</span></div>`;
    }

    if (relPct >= 75) {
      return `<div class="cell-highlight-high"><span class="cell-val-main">${formattedVal}</span><span class="cell-val-sub">${formattedPct}</span></div>`;
    }

    let valColorClass = '';
    let pctColorClass = '';
    if (isOiChg) {
      if (val < 0) {
        valColorClass = 'text-negative';
        pctColorClass = 'text-negative';
      } else if (val > 0) {
        valColorClass = 'text-positive';
      }
    }

    return `<div class="cell-stacked-num"><span class="cell-val-main ${valColorClass}">${formattedVal}</span><span class="cell-val-sub ${pctColorClass}">${formattedPct}</span></div>`;
  }

  // Build HTML
  let rowsHtml = '';

  // Extract index OHLC data (Open, High, Low, Previous Close)
  const indexInfo = payload.indexInfo || payload.records?.indexInfo || {
    open: 23858,
    high: 23914.45,
    low: 23786.8,
    previousClose: 24055.8
  };

  // Spot difference from Previous Close (Spot - PreviousClose)
  const prevCloseVal = Number(indexInfo.previousClose) || underlyingValue;
  const spotPrevCloseDiff = underlyingValue - prevCloseVal;
  const spotPrevCloseDiffStr = (spotPrevCloseDiff > 0 ? '+' : '') + spotPrevCloseDiff.toFixed(2);

  // Future difference from Spot (Future - Spot)
  const spotFutDiff = futureValue - underlyingValue;
  const spotFutDiffStr = (spotFutDiff > 0 ? '+' : '') + spotFutDiff.toFixed(2);

  // Range calculation (R = High - Low)
  const highVal = Number(indexInfo.high) || 0;
  const lowVal = Number(indexInfo.low) || 0;
  const rangeVal = highVal - lowVal;
  const rangeStr = (rangeVal % 1 === 0) ? rangeVal.toString() : rangeVal.toFixed(2);

  // Calculate days to expiry for quantitative Delta calculation
  const daysToExpiry = parseDaysToExpiry(currentExpiryValue);

  // Render Row Helper Function
  function buildStrikeRowHtml(strike, isExactMatch = false) {
    const item = strikeMap.get(strike) || {};
    const ce = item.CE || {};
    const pe = item.PE || {};

    const ceRawIv = Number(ce.impliedVolatility) || 0;
    const peRawIv = Number(pe.impliedVolatility) || 0;

    // Use Put-Call Parity / shared strike IV fallback so deep ITM/OTM strikes never miss Delta
    const ceEffectiveIv = (ceRawIv > 0) ? ceRawIv : ((peRawIv > 0) ? peRawIv : fallbackAtmIv);
    const peEffectiveIv = (peRawIv > 0) ? peRawIv : ((ceRawIv > 0) ? ceRawIv : fallbackAtmIv);

    // Calculate Real-Time Delta for Calls and Puts using Black-Scholes
    const ceDeltaRes = calculateDelta(underlyingValue, strike, ceEffectiveIv, daysToExpiry, 0.068);
    const peDeltaRes = calculateDelta(underlyingValue, strike, peEffectiveIv, daysToExpiry, 0.068);
    const ceDeltaStr = ceDeltaRes.callDelta !== null ? (ceDeltaRes.callDelta > 0 ? '+' : '') + ceDeltaRes.callDelta.toFixed(2) : '-';
    const peDeltaStr = peDeltaRes.putDelta !== null ? peDeltaRes.putDelta.toFixed(2) : '-';

    // Multiply OI, OI Change, and Volume by 65
    const ceOi = (Number(ce.openInterest) || 0) * LOT_MULTIPLIER;
    const ceOiChg = (Number(ce.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
    const ceVol = (Number(ce.totalTradedVolume) || 0) * LOT_MULTIPLIER;

    const peOi = (Number(pe.openInterest) || 0) * LOT_MULTIPLIER;
    const peOiChg = (Number(pe.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
    const peVol = (Number(pe.totalTradedVolume) || 0) * LOT_MULTIPLIER;

    const isCeItm = strike < underlyingValue;
    const isPeItm = strike > underlyingValue;

    const ceClass = isCeItm ? 'ce-itm' : 'ce-otm';
    const peClass = isPeItm ? 'pe-itm' : 'pe-otm';

    // Highlight Golden color if exact match
    const strikeClass = isExactMatch ? 'exact-match-strike' : 'cell-strike';
    const rowClass = isExactMatch ? 'exact-match-row' : '';

    // Calculate Change in OI% (with respect to OI, with negative values allowed and styled in red)
    let ceOiChgPctStr = '-';
    let ceOiChgPctClass = '';
    if (ceOi !== 0) {
      const cePct = (ceOiChg / ceOi) * 100;
      ceOiChgPctStr = (cePct > 0 ? '+' : '') + cePct.toFixed(1) + '%';
      ceOiChgPctClass = (cePct < 0) ? 'text-negative' : (cePct > 0 ? 'text-positive' : '');
    }

    let peOiChgPctStr = '-';
    let peOiChgPctClass = '';
    if (peOi !== 0) {
      const pePct = (peOiChg / peOi) * 100;
      peOiChgPctStr = (pePct > 0 ? '+' : '') + pePct.toFixed(1) + '%';
      peOiChgPctClass = (pePct < 0) ? 'text-negative' : (peOiChg > 0 ? 'text-positive' : '');
    }

    // Calculate CALL OI% and PUT OI% (Percentage of their sum for this strike row)
    const totalOiSum = ceOi + peOi;

    let ceOiPctStr = '-';
    let peOiPctStr = '-';

    if (totalOiSum > 0) {
      const cePct = (ceOi / totalOiSum) * 100;
      const pePct = (peOi / totalOiSum) * 100;
      ceOiPctStr = cePct.toFixed(1) + '%';
      peOiPctStr = pePct.toFixed(1) + '%';
    }

    // Strike bold formatting: Only multiples of 100 are shown in bold
    const isMultipleOf100 = (Number(strike) % 100 === 0);
    const formattedStrike = formatIndianNumber(strike);
    const strikeDisplayContent = isExactMatch 
      ? `<span class="golden-badge">${formattedStrike}</span>` 
      : (isMultipleOf100 ? `<strong>${formattedStrike}</strong>` : formattedStrike);

    return `
      <tr class="${rowClass}">
        <!-- CALLS (CE): Delta | IV | OI Chg | OI | Volume | LTP | CHG OI% | CALL OI% -->
        <td class="${ceClass} col-delta">${ceDeltaStr}</td>
        <td class="${ceClass} col-iv">${formatDecimal(ce.impliedVolatility)}</td>
        <td class="${ceClass} col-oichg">${renderRelativeCell(ceOiChg, maxCeOiChg, true, true)}</td>
        <td class="${ceClass} col-oi">${renderRelativeCell(ceOi, maxCeOI, true, false)}</td>
        <td class="${ceClass} col-vol">${renderRelativeCell(ceVol, maxCeVol, true, false)}</td>
        <td class="${ceClass} col-ltp"><strong>${formatDecimal(ce.lastPrice)}</strong></td>
        <td class="${ceClass} ${ceOiChgPctClass} col-oichg-pct"><strong>${ceOiChgPctStr}</strong></td>
        <td class="${ceClass} cell-oi-pct col-oi-pct"><strong>${ceOiPctStr}</strong></td>

        <!-- STRIKE PRICE (CENTER) - Multiples of 100 in Bold -->
        <td class="${strikeClass} ${isMultipleOf100 ? 'strike-bold' : ''} col-strike">
          ${strikeDisplayContent}
        </td>

        <!-- PUTS (PE) - Mirrored: PUT OI% | CHG OI% | LTP | Volume | OI | OI Chg | IV | Delta -->
        <td class="${peClass} cell-oi-pct col-oi-pct"><strong>${peOiPctStr}</strong></td>
        <td class="${peClass} ${peOiChgPctClass} col-oichg-pct"><strong>${peOiChgPctStr}</strong></td>
        <td class="${peClass} col-ltp"><strong>${formatDecimal(pe.lastPrice)}</strong></td>
        <td class="${peClass} col-vol">${renderRelativeCell(peVol, maxPeVol, false, false)}</td>
        <td class="${peClass} col-oi">${renderRelativeCell(peOi, maxPeOI, false, false)}</td>
        <td class="${peClass} col-oichg">${renderRelativeCell(peOiChg, maxPeOiChg, false, true)}</td>
        <td class="${peClass} col-iv">${formatDecimal(pe.impliedVolatility)}</td>
        <td class="${peClass} col-delta">${peDeltaStr}</td>
      </tr>
    `;
  }

  // 1. Render SET A (Above Spot Baseline)
  selectedA.forEach(strike => {
    rowsHtml += buildStrikeRowHtml(strike, false);
  });

  // 2. Render Spot Baseline Divider Bar (Blue row with SPOT (prevClose diff), F (spot diff), and O, H, L, R)
  rowsHtml += `
    <tr id="spotDividerRow" class="spot-divider-row">
      <td colspan="17">
        <div class="spot-divider-content">
          <div class="spot-center-title">
            <span class="spot-price-badge">SPOT: ${formatIndianNumber(underlyingValue)} (${spotPrevCloseDiffStr})</span>
            <span class="spot-price-badge">F: ${formatIndianNumber(futureValue)} (${spotFutDiffStr})</span>
            <span class="spot-ohlc-badge">
              <span class="spot-ohlc-item"><span class="spot-ohlc-label">O:</span> ${formatIndianNumber(indexInfo.open)}</span>
              <span class="spot-ohlc-item"><span class="spot-ohlc-label">H:</span> ${formatIndianNumber(indexInfo.high)}</span>
              <span class="spot-ohlc-item"><span class="spot-ohlc-label">L:</span> ${formatIndianNumber(indexInfo.low)}</span>
              <span class="spot-ohlc-item"><span class="spot-ohlc-label">R:</span> ${rangeStr}</span>
            </span>
          </div>
        </div>
      </td>
    </tr>
  `;

  // 2b. If exact match exists, render right at baseline with Golden highlight
  if (exactMatchStrike) {
    rowsHtml += buildStrikeRowHtml(exactMatchStrike, true);
  }

  // 3. Render SET B (Below Spot Baseline)
  selectedB.forEach(strike => {
    rowsHtml += buildStrikeRowHtml(strike, false);
  });

  tableBody.innerHTML = rowsHtml;

  // Calculate sum of OI and OI Change ONLY for the visible strikes displayed on the page (multiplied by 65)
  let sumVisibleCeOi = 0;
  let sumVisibleCeOiChg = 0;
  let sumVisiblePeOi = 0;
  let sumVisiblePeOiChg = 0;

  // Breakdown calculations:
  // ITM Call (Yellow Call side) = Set B strikes (< spot)
  // OTM Call (White Call side) = Set A strikes (> spot)
  // ITM Put (Yellow Put side) = Set A strikes (> spot)
  // OTM Put (White Put side) = Set B strikes (< spot)
  let sumItmCeOi = 0;
  let sumItmCeOiChg = 0;
  let sumOtmCeOi = 0;
  let sumOtmCeOiChg = 0;

  let sumItmPeOi = 0;
  let sumItmPeOiChg = 0;
  let sumOtmPeOi = 0;
  let sumOtmPeOiChg = 0;

  selectedA.forEach(s => {
    const item = strikeMap.get(s);
    if (item) {
      if (item.CE) {
        sumOtmCeOi += (Number(item.CE.openInterest) || 0) * LOT_MULTIPLIER;
        sumOtmCeOiChg += (Number(item.CE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
      }
      if (item.PE) {
        sumItmPeOi += (Number(item.PE.openInterest) || 0) * LOT_MULTIPLIER;
        sumItmPeOiChg += (Number(item.PE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
      }
    }
  });

  selectedB.forEach(s => {
    const item = strikeMap.get(s);
    if (item) {
      if (item.CE) {
        sumItmCeOi += (Number(item.CE.openInterest) || 0) * LOT_MULTIPLIER;
        sumItmCeOiChg += (Number(item.CE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
      }
      if (item.PE) {
        sumOtmPeOi += (Number(item.PE.openInterest) || 0) * LOT_MULTIPLIER;
        sumOtmPeOiChg += (Number(item.PE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
      }
    }
  });

  // Include exact match strike if present
  if (exactMatchStrike) {
    const item = strikeMap.get(exactMatchStrike);
    if (item) {
      if (item.CE) {
        sumItmCeOi += (Number(item.CE.openInterest) || 0) * LOT_MULTIPLIER;
        sumItmCeOiChg += (Number(item.CE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
      }
      if (item.PE) {
        sumItmPeOi += (Number(item.PE.openInterest) || 0) * LOT_MULTIPLIER;
        sumItmPeOiChg += (Number(item.PE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
      }
    }
  }

  sumVisibleCeOi = sumItmCeOi + sumOtmCeOi;
  sumVisibleCeOiChg = sumItmCeOiChg + sumOtmCeOiChg;
  sumVisiblePeOi = sumItmPeOi + sumOtmPeOi;
  sumVisiblePeOiChg = sumItmPeOiChg + sumOtmPeOiChg;

  // Calculate percentages for overall totals
  const totalVisibleOiSum = sumVisibleCeOi + sumVisiblePeOi;
  let ceOiTotalPctStr = '-';
  let peOiTotalPctStr = '-';
  if (totalVisibleOiSum > 0) {
    ceOiTotalPctStr = ((sumVisibleCeOi / totalVisibleOiSum) * 100).toFixed(1) + '%';
    peOiTotalPctStr = ((sumVisiblePeOi / totalVisibleOiSum) * 100).toFixed(1) + '%';
  }

  const absTotalOiChgSum = Math.abs(sumVisibleCeOiChg) + Math.abs(sumVisiblePeOiChg);
  let ceOiChgTotalPctStr = '-';
  let peOiChgTotalPctStr = '-';
  if (absTotalOiChgSum > 0) {
    ceOiChgTotalPctStr = ((Math.abs(sumVisibleCeOiChg) / absTotalOiChgSum) * 100).toFixed(1) + '%';
    peOiChgTotalPctStr = ((Math.abs(sumVisiblePeOiChg) / absTotalOiChgSum) * 100).toFixed(1) + '%';
  }

  // Calculate percentages for ITM vs OTM within Calls and Puts
  let itmCeOiPctStr = '-';
  let otmCeOiPctStr = '-';
  if (sumVisibleCeOi > 0) {
    itmCeOiPctStr = ((sumItmCeOi / sumVisibleCeOi) * 100).toFixed(1) + '%';
    otmCeOiPctStr = ((sumOtmCeOi / sumVisibleCeOi) * 100).toFixed(1) + '%';
  }

  let itmPeOiPctStr = '-';
  let otmPeOiPctStr = '-';
  if (sumVisiblePeOi > 0) {
    itmPeOiPctStr = ((sumItmPeOi / sumVisiblePeOi) * 100).toFixed(1) + '%';
    otmPeOiPctStr = ((sumOtmPeOi / sumVisiblePeOi) * 100).toFixed(1) + '%';
  }

  // Render Table Footer Rows (Row 1: OVERALL TOTALS, Row 2: ITM / OTM BREAKDOWN)
  if (tableFoot) {
    const totalCeChgPctVal = sumVisibleCeOi !== 0 ? ((sumVisibleCeOiChg / sumVisibleCeOi) * 100) : 0;
    const totalCeChgPctStr = sumVisibleCeOi !== 0 ? ((totalCeChgPctVal > 0 ? '+' : '') + totalCeChgPctVal.toFixed(1) + '%') : '-';
    const totalCeChgClass = sumVisibleCeOi !== 0 ? (totalCeChgPctVal < 0 ? 'text-negative' : (totalCeChgPctVal > 0 ? 'text-positive' : '')) : '';

    const totalPeChgPctVal = sumVisiblePeOi !== 0 ? ((sumVisiblePeOiChg / sumVisiblePeOi) * 100) : 0;
    const totalPeChgPctStr = sumVisiblePeOi !== 0 ? ((totalPeChgPctVal > 0 ? '+' : '') + totalPeChgPctVal.toFixed(1) + '%') : '-';
    const totalPeChgClass = sumVisiblePeOi !== 0 ? (totalPeChgPctVal < 0 ? 'text-negative' : (totalPeChgPctVal > 0 ? 'text-positive' : '')) : '';

    const itmCeChgPctStr = sumItmCeOi !== 0 ? (((sumItmCeOiChg / sumItmCeOi) * 100 > 0 ? '+' : '') + ((sumItmCeOiChg / sumItmCeOi) * 100).toFixed(1) + '%') : '-';
    const otmCeChgPctStr = sumOtmCeOi !== 0 ? (((sumOtmCeOiChg / sumOtmCeOi) * 100 > 0 ? '+' : '') + ((sumOtmCeOiChg / sumOtmCeOi) * 100).toFixed(1) + '%') : '-';

    const itmPeChgPctStr = sumItmPeOi !== 0 ? (((sumItmPeOiChg / sumItmPeOi) * 100 > 0 ? '+' : '') + ((sumItmPeOiChg / sumItmPeOi) * 100).toFixed(1) + '%') : '-';
    const otmPeChgPctStr = sumOtmPeOi !== 0 ? (((sumOtmPeOiChg / sumOtmPeOi) * 100 > 0 ? '+' : '') + ((sumOtmPeOiChg / sumOtmPeOi) * 100).toFixed(1) + '%') : '-';

    tableFoot.innerHTML = `
      <!-- Row 1: TOTAL SUMMARY -->
      <tr class="total-row">
        <!-- CALLS (CE) TOTALS: Delta | IV | OI Chg | OI | Volume | LTP | CHG OI% | CALL OI% -->
        <td class="total-ce col-delta">-</td>
        <td class="total-ce col-iv">-</td>
        <td class="total-ce col-oichg">
          <div class="total-cell-stacked">
            <span class="total-line-sum">${formatIndianNumber(sumVisibleCeOiChg)}</span>
            <span class="total-line-pct">${ceOiChgTotalPctStr}</span>
          </div>
        </td>
        <td class="total-ce col-oi">
          <div class="total-cell-stacked">
            <span class="total-line-sum">${formatIndianNumber(sumVisibleCeOi)}</span>
            <span class="total-line-pct">${ceOiTotalPctStr}</span>
          </div>
        </td>
        <td class="total-ce col-vol">-</td>
        <td class="total-ce col-ltp">-</td>
        <td class="total-ce col-oichg-pct">
          <div class="total-cell-stacked">
            <span class="total-line-sum ${totalCeChgClass}"><strong>${totalCeChgPctStr}</strong></span>
          </div>
        </td>
        <td class="total-ce col-oi-pct">
          <div class="total-cell-stacked">
            <span class="total-line-pct">${ceOiTotalPctStr}</span>
          </div>
        </td>

        <!-- STRIKE TOTAL LABEL -->
        <td class="total-strike col-strike">TOTAL (${visibleStrikes.length})</td>

        <!-- PUTS (PE) TOTALS: PUT OI% | CHG OI% | LTP | Volume | OI | OI Chg | IV | Delta -->
        <td class="total-pe col-oi-pct">
          <div class="total-cell-stacked">
            <span class="total-line-pct">${peOiTotalPctStr}</span>
          </div>
        </td>
        <td class="total-pe col-oichg-pct">
          <div class="total-cell-stacked">
            <span class="total-line-sum ${totalPeChgClass}"><strong>${totalPeChgPctStr}</strong></span>
          </div>
        </td>
        <td class="total-pe col-ltp">-</td>
        <td class="total-pe col-vol">-</td>
        <td class="total-pe col-oi">
          <div class="total-cell-stacked">
            <span class="total-line-sum">${formatIndianNumber(sumVisiblePeOi)}</span>
            <span class="total-line-pct">${peOiTotalPctStr}</span>
          </div>
        </td>
        <td class="total-pe col-oichg">
          <div class="total-cell-stacked">
            <span class="total-line-sum">${formatIndianNumber(sumVisiblePeOiChg)}</span>
            <span class="total-line-pct">${peOiChgTotalPctStr}</span>
          </div>
        </td>
        <td class="total-pe col-iv">-</td>
        <td class="total-pe col-delta">-</td>
      </tr>

      <!-- Row 2: ITM & OTM BREAKDOWN (Realtime based on visible entries) -->
      <tr class="breakdown-row">
        <!-- CALLS (CE) ITM / OTM: Delta | IV | OI Chg | OI | Volume | LTP | CHG OI% | CALL OI% -->
        <td class="breakdown-ce col-delta">-</td>
        <td class="breakdown-ce col-iv">-</td>
        <td class="breakdown-ce col-oichg">
          <div class="breakdown-cell-stacked">
            <div class="breakdown-line"><span class="tag-itm">ITM</span><span class="val-itm">${formatIndianNumber(sumItmCeOiChg)}</span></div>
            <div class="breakdown-line"><span class="tag-otm">OTM</span><span class="val-otm">${formatIndianNumber(sumOtmCeOiChg)}</span></div>
          </div>
        </td>
        <td class="breakdown-ce col-oi">
          <div class="breakdown-cell-stacked">
            <div class="breakdown-line"><span class="tag-itm">ITM</span><span class="val-itm">${formatIndianNumber(sumItmCeOi)}</span></div>
            <div class="breakdown-line"><span class="tag-otm">OTM</span><span class="val-otm">${formatIndianNumber(sumOtmCeOi)}</span></div>
          </div>
        </td>
        <td class="breakdown-ce col-vol">-</td>
        <td class="breakdown-ce col-ltp">-</td>
        <td class="breakdown-ce col-oichg-pct">
          <div class="breakdown-cell-stacked">
            <div class="breakdown-line"><span class="tag-itm">ITM</span><span class="val-itm">${itmCeChgPctStr}</span></div>
            <div class="breakdown-line"><span class="tag-otm">OTM</span><span class="val-otm">${otmCeChgPctStr}</span></div>
          </div>
        </td>
        <td class="breakdown-ce col-oi-pct">
          <div class="breakdown-cell-stacked">
            <div class="breakdown-line"><span class="tag-itm">ITM</span><span class="val-itm">${itmCeOiPctStr}</span></div>
            <div class="breakdown-line"><span class="tag-otm">OTM</span><span class="val-otm">${otmCeOiPctStr}</span></div>
          </div>
        </td>

        <!-- STRIKE BREAKDOWN LABEL -->
        <td class="breakdown-strike col-strike">ITM / OTM</td>

        <!-- PUTS (PE) ITM / OTM: PUT OI% | CHG OI% | LTP | Volume | OI | OI Chg | IV | Delta -->
        <td class="breakdown-pe col-oi-pct">
          <div class="breakdown-cell-stacked">
            <div class="breakdown-line"><span class="tag-itm">ITM</span><span class="val-itm">${itmPeOiPctStr}</span></div>
            <div class="breakdown-line"><span class="tag-otm">OTM</span><span class="val-otm">${otmPeOiPctStr}</span></div>
          </div>
        </td>
        <td class="breakdown-pe col-oichg-pct">
          <div class="breakdown-cell-stacked">
            <div class="breakdown-line"><span class="tag-itm">ITM</span><span class="val-itm">${itmPeChgPctStr}</span></div>
            <div class="breakdown-line"><span class="tag-otm">OTM</span><span class="val-otm">${otmPeChgPctStr}</span></div>
          </div>
        </td>
        <td class="breakdown-pe col-ltp">-</td>
        <td class="breakdown-pe col-vol">-</td>
        <td class="breakdown-pe col-oi">
          <div class="breakdown-cell-stacked">
            <div class="breakdown-line"><span class="tag-itm">ITM</span><span class="val-itm">${formatIndianNumber(sumItmPeOi)}</span></div>
            <div class="breakdown-line"><span class="tag-otm">OTM</span><span class="val-otm">${formatIndianNumber(sumOtmPeOi)}</span></div>
          </div>
        </td>
        <td class="breakdown-pe col-oichg">
          <div class="breakdown-cell-stacked">
            <div class="breakdown-line"><span class="tag-itm">ITM</span><span class="val-itm">${formatIndianNumber(sumItmPeOiChg)}</span></div>
            <div class="breakdown-line"><span class="tag-otm">OTM</span><span class="val-otm">${formatIndianNumber(sumOtmPeOiChg)}</span></div>
          </div>
        </td>
        <td class="breakdown-pe col-iv">-</td>
        <td class="breakdown-pe col-delta">-</td>
      </tr>
    `;
  }

  // Auto-scroll table container internally to center the spot baseline divider row
  setTimeout(() => {
    const tableContainer = document.querySelector('.table-container');
    const spotRow = document.getElementById('spotDividerRow');
    if (tableContainer && spotRow) {
      const containerHeight = tableContainer.clientHeight;
      const rowOffsetTop = spotRow.offsetTop;
      const rowHeight = spotRow.clientHeight;
      tableContainer.scrollTop = rowOffsetTop - (containerHeight / 2) + (rowHeight / 2);
    }
  }, 30);
}

// Event Listeners
refreshBtn.addEventListener('click', () => {
  fetchOptionChain(false);
});

symbolSelect.addEventListener('change', (e) => {
  currentSymbol = e.target.value;
  fetchOptionChain(false);
});

expirySelect.addEventListener('change', (e) => {
  currentExpiry = e.target.value;
  // Automatically reload data from server when expiry date changes
  fetchOptionChain(false);
});

// Apply restored values to input fields
if (strikeCountInput) {
  strikeCountInput.value = strikeDepth;
}
if (cooldownInput) {
  cooldownInput.value = refreshCooldownSeconds;
}

strikeCountInput.addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  if (!isNaN(val) && val > 0) {
    strikeDepth = val;
    try {
      localStorage.setItem(STORAGE_KEY_STRIKES, val.toString());
    } catch (err) {}
    if (lastFetchedData) {
      renderTable(lastFetchedData);
    }
  }
});

if (cooldownInput) {
  cooldownInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    if (!isNaN(val) && val > 0) {
      refreshCooldownSeconds = val;
      try {
        localStorage.setItem(STORAGE_KEY_COOLDOWN, val.toString());
      } catch (err) {}
      // Reset remaining timer to newly set cooldown and update display immediately
      startAutoRefreshTimer(true);
    }
  });
}

// Initialize immediately on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (strikeCountInput) strikeCountInput.value = strikeDepth;
    if (cooldownInput) cooldownInput.value = refreshCooldownSeconds;
    fetchOptionChain(false);
  });
} else {
  if (strikeCountInput) strikeCountInput.value = strikeDepth;
  if (cooldownInput) cooldownInput.value = refreshCooldownSeconds;
  fetchOptionChain(false);
}
