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

// Standard normal probability density function (PDF)
function normalPdf(x) {
  return (1.0 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
}

// Black-Scholes Greeks Calculator (Delta, Gamma, Theta)
function calculateGreeks(spot, strike, ivPct, daysToExpiry, r = 0.068) {
  const S = Number(spot);
  const K = Number(strike);
  let sigma = Number(ivPct) / 100.0;
  if (!sigma || isNaN(sigma) || sigma <= 0) sigma = 0.12; // Fallback to 12% if missing
  const T = Math.max(daysToExpiry, 0.01) / 365.0; // Time in years

  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const deltaCall = normalCdf(d1);
  const deltaPut = deltaCall - 1.0;
  const gamma = normalPdf(d1) / (S * sigma * Math.sqrt(T));

  // 1-day theta (annualized theta / 365)
  const thetaCall = (-(S * normalPdf(d1) * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normalCdf(d2)) / 365.0;
  const thetaPut  = (-(S * normalPdf(d1) * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * normalCdf(-d2)) / 365.0;

  return { deltaCall, deltaPut, gamma, thetaCall, thetaPut };
}

// Backward-compatible Black-Scholes Delta Calculator
function calculateDelta(spot, strike, ivPct, daysToExpiry, r = 0.068) {
  if (!spot || !strike || daysToExpiry <= 0) {
    return { callDelta: null, putDelta: null };
  }
  const g = calculateGreeks(spot, strike, ivPct, daysToExpiry, r);
  return {
    callDelta: Number(g.deltaCall.toFixed(2)),
    putDelta: Number(g.deltaPut.toFixed(2))
  };
}

// Compute theoretical option price using 2nd-order Taylor expansion with intraday Theta decay
function calculateRevLTP(ltp, delta, gamma, theta, targetSpot, currentSpot) {
  if (ltp === null || ltp === undefined || isNaN(ltp) || ltp <= 0) return 0;
  const dS = targetSpot - currentSpot;
  // 1/7 of daily theta accounts for 1 active trading session hour decay
  const theoretical = ltp + (delta * dS + 0.5 * gamma * dS * dS + theta / 7.0);
  return Math.max(0.05, Number(theoretical.toFixed(2)));
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

// Background Worker Timer for 100% reliable execution in background / inactive tabs
let bgWorker = null;
let nextRefreshTimestamp = null;
let isFetchingNow = false;

try {
  const workerScript = `
    let intervalId = null;
    self.onmessage = function(e) {
      if (e.data === 'start') {
        if (intervalId) clearInterval(intervalId);
        intervalId = setInterval(() => {
          self.postMessage('tick');
        }, 1000);
      } else if (e.data === 'stop') {
        if (intervalId) clearInterval(intervalId);
        intervalId = null;
      }
    };
  `;
  const blob = new Blob([workerScript], { type: 'application/javascript' });
  bgWorker = new Worker(URL.createObjectURL(blob));
  bgWorker.onmessage = function(e) {
    if (e.data === 'tick') {
      onTimerTick();
    }
  };
} catch (e) {
  console.warn('Web Worker background timer fallback', e);
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
    if (bgWorker) bgWorker.postMessage('stop');
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

  if (resetToMax || !nextRefreshTimestamp || Date.now() >= nextRefreshTimestamp) {
    nextRefreshTimestamp = Date.now() + (refreshCooldownSeconds * 1000);
    timerSecondsRemaining = refreshCooldownSeconds;
  } else {
    const remainingMs = nextRefreshTimestamp - Date.now();
    timerSecondsRemaining = Math.max(0, Math.ceil(remainingMs / 1000));
  }
  updateTimerDisplay();

  if (bgWorker) {
    bgWorker.postMessage('start');
  } else {
    timerCountdownInterval = setInterval(() => {
      onTimerTick();
    }, 1000);
  }
}

function onTimerTick() {
  if (!isMarketActiveHoursIST()) {
    startAutoRefreshTimer(false);
    return;
  }

  if (!nextRefreshTimestamp) {
    nextRefreshTimestamp = Date.now() + (refreshCooldownSeconds * 1000);
  }

  const remainingMs = nextRefreshTimestamp - Date.now();
  timerSecondsRemaining = Math.max(0, Math.ceil(remainingMs / 1000));
  updateTimerDisplay();

  if (remainingMs <= 0) {
    if (bgWorker) bgWorker.postMessage('stop');
    if (timerCountdownInterval) {
      clearInterval(timerCountdownInterval);
      timerCountdownInterval = null;
    }
    if (!isFetchingNow) {
      fetchOptionChain(true);
    }
  }
}

// Ensure instant refresh catch-up when tab regains visibility or focus
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isMarketActiveHoursIST()) {
    const remainingMs = nextRefreshTimestamp ? (nextRefreshTimestamp - Date.now()) : 0;
    if (remainingMs <= 0) {
      if (!isFetchingNow) fetchOptionChain(true);
    } else {
      timerSecondsRemaining = Math.max(0, Math.ceil(remainingMs / 1000));
      updateTimerDisplay();
    }
  }
});

window.addEventListener('focus', () => {
  if (isMarketActiveHoursIST()) {
    const remainingMs = nextRefreshTimestamp ? (nextRefreshTimestamp - Date.now()) : 0;
    if (remainingMs <= 0) {
      if (!isFetchingNow) fetchOptionChain(true);
    } else {
      timerSecondsRemaining = Math.max(0, Math.ceil(remainingMs / 1000));
      updateTimerDisplay();
    }
  }
});

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
    isFetchingNow = true;
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
      tableBody.innerHTML = `<tr><td colspan="19" style="text-align:center; padding: 25px; color: #ef4444; font-weight: 600;">Data fetch failed: ${failureReason}. No previous data available.</td></tr>`;
    }
  } finally {
    isFetchingNow = false;
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
  try {
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
      tableBody.innerHTML = '<tr><td colspan="19" style="text-align:center; padding: 20px;">No option chain records found.</td></tr>';
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

    // -------------------------------------------------------------
    // Calculate 100% Benchmarks:
    // CALLS (CE): 100% is taken ONLY from 1st ITM row (closest strike < spot, or exact match)
    //             to the last OTM row (highest visible strike > spot).
    // PUTS (PE):  100% is taken ONLY from 1st ITM row (closest strike > spot, or exact match)
    //             to the last OTM row (lowest visible strike < spot).
    // Deep ITM rows calculate relative percentage with respect to this 100% benchmark (e.g. 113%).
    // -------------------------------------------------------------

    // 1st ITM strike for Calls (closest strike < spot, or exact match if present)
    const firstItmCeStrike = exactMatchStrike ?? (setB_Strikes.length > 0 ? setB_Strikes[0] : null);
    // OTM strikes for Calls (all strikes > spot displayed)
    const otmCeStrikes = selectedA;
    const ceBenchmarkStrikes = [
      ...(firstItmCeStrike !== null && firstItmCeStrike !== undefined ? [firstItmCeStrike] : []),
      ...otmCeStrikes
    ];

    // 1st ITM strike for Puts (closest strike > spot, or exact match if present)
    const firstItmPeStrike = exactMatchStrike ?? (setA_Strikes.length > 0 ? setA_Strikes[0] : null);
    // OTM strikes for Puts (all strikes < spot displayed)
    const otmPeStrikes = selectedB;
    const peBenchmarkStrikes = [
      ...(firstItmPeStrike !== null && firstItmPeStrike !== undefined ? [firstItmPeStrike] : []),
      ...otmPeStrikes
    ];

    let maxCeOI = 0;
    let maxCeVol = 0;
    let maxCeOiChg = 0;
    let maxPeOI = 0;
    let maxPeVol = 0;
    let maxPeOiChg = 0;
    const validIvs = [];

    // 1. Scan CE Benchmark Range [1st ITM ... all OTM] for 100% Max CE OI, Vol, OI Chg
    ceBenchmarkStrikes.forEach(s => {
      const r = strikeMap.get(s);
      if (r && r.CE) {
        const ceOi = (Number(r.CE.openInterest) || 0) * LOT_MULTIPLIER;
        const ceOiChg = (Number(r.CE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
        const ceVol = (Number(r.CE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if (ceOi > maxCeOI) maxCeOI = ceOi;
        if (ceVol > maxCeVol) maxCeVol = ceVol;
        if (ceOiChg > maxCeOiChg) maxCeOiChg = ceOiChg;
      }
    });

    // 2. Scan PE Benchmark Range [1st ITM ... all OTM] for 100% Max PE OI, Vol, OI Chg
    peBenchmarkStrikes.forEach(s => {
      const r = strikeMap.get(s);
      if (r && r.PE) {
        const peOi = (Number(r.PE.openInterest) || 0) * LOT_MULTIPLIER;
        const peOiChg = (Number(r.PE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
        const peVol = (Number(r.PE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if (peOi > maxPeOI) maxPeOI = peOi;
        if (peVol > maxPeVol) maxPeVol = peVol;
        if (peOiChg > maxPeOiChg) maxPeOiChg = peOiChg;
      }
    });

    // Collect valid IVs from all visible strikes for quantitative Delta calculation
    const visibleStrikes = [...selectedA, ...(exactMatchStrike ? [exactMatchStrike] : []), ...selectedB];
    let atmStrike = null;
    let minAtmDiff = Infinity;
    visibleStrikes.forEach(s => {
      const diff = Math.abs(Number(s) - underlyingValue);
      if (diff < minAtmDiff) {
        minAtmDiff = diff;
        atmStrike = s;
      }
    });

    visibleStrikes.forEach(s => {
      const r = strikeMap.get(s);
      if (r) {
        if (r.CE && Number(r.CE.impliedVolatility) > 0) validIvs.push(Number(r.CE.impliedVolatility));
        if (r.PE && Number(r.PE.impliedVolatility) > 0) validIvs.push(Number(r.PE.impliedVolatility));
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
    if (firstItmCeStrike !== null && firstItmCeStrike !== undefined) {
      const item = strikeMap.get(firstItmCeStrike);
      if (item && item.CE) {
        const oi = (Number(item.CE.openInterest) || 0) * LOT_MULTIPLIER;
        const oic = (Number(item.CE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
        const vol = (Number(item.CE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if ((maxCeOI > 0 && oi === maxCeOI) || (maxCeOiChg > 0 && oic === maxCeOiChg) || (maxCeVol > 0 && vol === maxCeVol)) {
          resistanceStrike3 = firstItmCeStrike;
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
    if (firstItmCeStrike !== null && firstItmCeStrike !== undefined) {
      const item = strikeMap.get(firstItmCeStrike);
      if (item && item.CE) {
        const oi = (Number(item.CE.openInterest) || 0) * LOT_MULTIPLIER;
        const vol = (Number(item.CE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if ((maxCeOI > 0 && oi === maxCeOI) || (maxCeVol > 0 && vol === maxCeVol)) {
          resistanceStrike2 = firstItmCeStrike;
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
    if (firstItmPeStrike !== null && firstItmPeStrike !== undefined) {
      const item = strikeMap.get(firstItmPeStrike);
      if (item && item.PE) {
        const oi = (Number(item.PE.openInterest) || 0) * LOT_MULTIPLIER;
        const oic = (Number(item.PE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
        const vol = (Number(item.PE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if ((maxPeOI > 0 && oi === maxPeOI) || (maxPeOiChg > 0 && oic === maxPeOiChg) || (maxPeVol > 0 && vol === maxPeVol)) {
          supportStrike3 = firstItmPeStrike;
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
    if (firstItmPeStrike !== null && firstItmPeStrike !== undefined) {
      const item = strikeMap.get(firstItmPeStrike);
      if (item && item.PE) {
        const oi = (Number(item.PE.openInterest) || 0) * LOT_MULTIPLIER;
        const vol = (Number(item.PE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if ((maxPeOI > 0 && oi === maxPeOI) || (maxPeVol > 0 && vol === maxPeVol)) {
          supportStrike2 = firstItmPeStrike;
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

    // -------------------------------------------------------------
    // Pre-calculate Reversal Spot Map across allStrikes
    // cEos(K) = K - (putLtpAtNextStrike || ceLtp)
    // pEos(K + step) = cEos(K)  (symmetrical boundary equilibrium)
    // -------------------------------------------------------------
    const revSpotMap = new Map();
    for (let i = 0; i < allStrikes.length; i++) {
      const s = allStrikes[i];
      const itm = strikeMap.get(s);
      const ceLtp = Number(itm?.CE?.lastPrice) || 0;
      const nextS = (i < allStrikes.length - 1) ? allStrikes[i + 1] : null;
      const nextItm = nextS !== null ? strikeMap.get(nextS) : null;
      const putLtpAtNext = Number(nextItm?.PE?.lastPrice) || 0;
      const ceRevSpot = s - (putLtpAtNext > 0 ? putLtpAtNext : (ceLtp > 0 ? ceLtp : 0));
      revSpotMap.set(s, { ceRevSpot, peRevSpot: 0 });
    }

    for (let i = 0; i < allStrikes.length; i++) {
      const s = allStrikes[i];
      const entry = revSpotMap.get(s);
      if (i > 0) {
        const prevS = allStrikes[i - 1];
        entry.peRevSpot = revSpotMap.get(prevS).ceRevSpot;
      } else {
        const itm = strikeMap.get(s);
        const peLtp = Number(itm?.PE?.lastPrice) || 0;
        entry.peRevSpot = s - peLtp;
      }
    }

    // Key In-Range Reversal Targets:
    // Support strike K_sup (Calls hedged against support) -> targetCallSpot = Reversal Support level of K_sup
    // Resistance strike K_res (Puts hedged against resistance) -> targetPutSpot = Reversal Resistance level of K_res
    const kSup = supportStrike3 || supportStrike2 || (setB_Strikes.length > 0 ? setB_Strikes[0] : underlyingValue);
    const kRes = resistanceStrike3 || resistanceStrike2 || (setA_Strikes.length > 0 ? setA_Strikes[0] : underlyingValue);

    const targetCallSpot = (revSpotMap.get(kSup)?.peRevSpot > 0) ? revSpotMap.get(kSup).peRevSpot : underlyingValue;
    const targetPutSpot = (revSpotMap.get(kRes)?.ceRevSpot > 0) ? revSpotMap.get(kRes).ceRevSpot : underlyingValue;

    // Helper function to render 2-line stacked cell with relative percentage & highlight badges
    function renderRelativeCell(val, maxVal, isCe, isOiChg = false, inlineSuffix = '') {
      const formattedVal = formatIndianNumber(val);
      const displayVal = inlineSuffix 
        ? `${formattedVal}&nbsp;<span class="cell-oichg-pct-bracket">${inlineSuffix}</span>` 
        : formattedVal;
      const isExact100 = (val > 0 && maxVal > 0 && val === maxVal);
      let relPct = 0;
      let formattedPct = '-';

      if (maxVal > 0 && val > 0) {
        relPct = (val / maxVal) * 100;
        if (isExact100) {
          formattedPct = '100%';
        } else if (relPct >= 100) {
          formattedPct = (relPct % 1 === 0 ? relPct.toFixed(0) : relPct.toFixed(1)) + '%';
        } else {
          formattedPct = relPct.toFixed(1) + '%';
        }
      } else if (isOiChg && val < 0) {
        formattedPct = '0.0%';
      } else if (val === 0) {
        formattedPct = '0.0%';
      }

      if (isExact100) {
        const maxClass = isCe ? 'cell-highlight-max-ce' : 'cell-highlight-max-pe';
        return `<div class="${maxClass}"><span class="cell-val-main">${displayVal}</span><span class="cell-val-sub">100%</span></div>`;
      }

      if (relPct >= 75) {
        return `<div class="cell-highlight-high"><span class="cell-val-main">${displayVal}</span><span class="cell-val-sub">${formattedPct}</span></div>`;
      }

      let valColorClass = '';
      let pctColorClass = '';
      if (isOiChg && val < 0) {
        valColorClass = 'text-negative';
        pctColorClass = 'text-negative';
      }

      return `<div class="cell-stacked-num"><span class="cell-val-main ${valColorClass}">${displayVal}</span><span class="cell-val-sub ${pctColorClass}">${formattedPct}</span></div>`;
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

    // Helper to retrieve or freeze 09:20 AM IST Fixed OHLC (HF, LF, RF)
    function getOrUpdateFixedOHLC(symbol, h, l) {
      const now = new Date();
      const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
      const istDate = new Date(istString);
      const todayDateString = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
      const currentMinutes = istDate.getHours() * 60 + istDate.getMinutes();
      const isPast920 = currentMinutes >= (9 * 60 + 20); // 9:20 AM IST = 560 mins

      const storageKey = `papa_fixed_ohlc_v1_${symbol}_${todayDateString}`;
      let fixedOhlc = null;
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          fixedOhlc = JSON.parse(raw);
        }
      } catch (e) {}

      // 1. If already locked today at or after 9:20 AM, return locked values
      if (fixedOhlc && fixedOhlc.hf && fixedOhlc.lf) {
        return fixedOhlc;
      }

      // 2. If past 9:20 AM and we have valid numbers, lock them permanently for today
      if (isPast920 && h > 0 && l > 0) {
        const diff = Number((h - l).toFixed(2));
        fixedOhlc = {
          date: todayDateString,
          symbol: symbol,
          hf: h,
          lf: l,
          rf: diff,
          lockedAt: '09:20 AM IST'
        };
        try {
          localStorage.setItem(storageKey, JSON.stringify(fixedOhlc));
        } catch (e) {}
        return fixedOhlc;
      }

      // 3. If before 09:20 AM today or during night/off-hours, check if there's any recent locked value for this symbol
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(`papa_fixed_ohlc_v1_${symbol}_`)) {
            const cached = JSON.parse(localStorage.getItem(key));
            if (cached && cached.hf && cached.lf) {
              return cached;
            }
          }
        }
      } catch (e) {}

      // 4. Live calculated fallback: Return current live values so badges are NEVER empty
      const diff = Number((h - l).toFixed(2));
      return {
        date: todayDateString,
        symbol: symbol,
        hf: h,
        lf: l,
        rf: diff,
        lockedAt: 'Calculated'
      };
    }

    const fixedOhlc = getOrUpdateFixedOHLC(currentSymbol, highVal, lowVal);
    const displayHf = fixedOhlc?.hf || highVal;
    const displayLf = fixedOhlc?.lf || lowVal;
    const displayRfVal = fixedOhlc?.rf ?? (displayHf - displayLf);
    const displayRfStr = (displayRfVal % 1 === 0) ? displayRfVal.toString() : Number(displayRfVal).toFixed(2);

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

      // Calculate Real-Time Greeks for Calls and Puts using Black-Scholes
      const ceGreeks = calculateGreeks(underlyingValue, strike, ceEffectiveIv, daysToExpiry, 0.068);
      const peGreeks = calculateGreeks(underlyingValue, strike, peEffectiveIv, daysToExpiry, 0.068);
      const ceDeltaStr = ceGreeks.deltaCall !== null && !isNaN(ceGreeks.deltaCall) ? (ceGreeks.deltaCall > 0 ? '+' : '') + ceGreeks.deltaCall.toFixed(2) : '-';
      const peDeltaStr = peGreeks.deltaPut !== null && !isNaN(peGreeks.deltaPut) ? peGreeks.deltaPut.toFixed(2) : '-';

      // Theoretical estimated option price if index reaches key In-Range Support/Resistance level
      const ceRevLtp = calculateRevLTP(Number(ce.lastPrice), ceGreeks.deltaCall, ceGreeks.gamma, ceGreeks.thetaCall, targetCallSpot, underlyingValue);
      const peRevLtp = calculateRevLTP(Number(pe.lastPrice), peGreeks.deltaPut, peGreeks.gamma, peGreeks.thetaPut, targetPutSpot, underlyingValue);

      // Reversal boundary level for this strike
      const strikeRevData = revSpotMap.get(strike) || {};
      const ceRevSpot = strikeRevData.ceRevSpot ?? (strike - (Number(ce.lastPrice) || 0));
      const peRevSpot = strikeRevData.peRevSpot ?? (strike - (Number(pe.lastPrice) || 0));

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

      // 1. Strike individual Change in OI% (with respect to OI) for the inline bracket in OI CHG cell
      let ceStrikeOiChgPctStr = '-';
      if (ceOi !== 0) {
        const cePct = (ceOiChg / ceOi) * 100;
        ceStrikeOiChgPctStr = (cePct > 0 ? '+' : '') + cePct.toFixed(1) + '%';
      }

      let peStrikeOiChgPctStr = '-';
      if (peOi !== 0) {
        const pePct = (peOiChg / peOi) * 100;
        peStrikeOiChgPctStr = (pePct > 0 ? '+' : '') + pePct.toFixed(1) + '%';
      }

      // 2. Dedicated CHG OI% Column using user's formula: (oi chg / (|oichg(call)| + |oichg(put)|)) * 100
      const totalAbsRowOiChg = Math.abs(ceOiChg) + Math.abs(peOiChg);

      let ceOiChgPctStr = '-';
      let ceOiChgPctClass = '';
      if (totalAbsRowOiChg > 0) {
        const cePct = (ceOiChg / totalAbsRowOiChg) * 100;
        ceOiChgPctStr = (cePct > 0 ? '+' : '') + cePct.toFixed(1) + '%';
        ceOiChgPctClass = (cePct < 0) ? 'text-negative' : (cePct > 0 ? 'text-positive' : '');
      }

      let peOiChgPctStr = '-';
      let peOiChgPctClass = '';
      if (totalAbsRowOiChg > 0) {
        const pePct = (peOiChg / totalAbsRowOiChg) * 100;
        peOiChgPctStr = (pePct > 0 ? '+' : '') + pePct.toFixed(1) + '%';
        peOiChgPctClass = (pePct < 0) ? 'text-negative' : (pePct > 0 ? 'text-positive' : '');
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
      const strikeInner = isMultipleOf100 ? `<strong>${formattedStrike}</strong>` : formattedStrike;
      const strikeDisplayContent = isExactMatch 
        ? `<span class="golden-badge">${formattedStrike}</span>` 
        : strikeInner;

      return `
        <tr class="${rowClass}">
          <!-- CALLS (CE): Delta | IV | OI Chg | OI | Volume | LTP | CHG OI% | CALL OI% | Rev(LTP/Spot) -->
          <td class="${ceClass} col-delta">${ceDeltaStr}</td>
          <td class="${ceClass} col-iv">${formatDecimal(ce.impliedVolatility)}</td>
          <td class="${ceClass} col-oichg">${renderRelativeCell(ceOiChg, maxCeOiChg, true, true, (ceOi !== 0 && ceStrikeOiChgPctStr !== '-') ? `(${ceStrikeOiChgPctStr})` : '')}</td>
          <td class="${ceClass} col-oi">${renderRelativeCell(ceOi, maxCeOI, true, false)}</td>
          <td class="${ceClass} col-vol">${renderRelativeCell(ceVol, maxCeVol, true, false)}</td>
          <td class="${ceClass} col-ltp">${formatDecimal(ce.lastPrice)}</td>
          <td class="${ceClass} ${ceOiChgPctClass} col-oichg-pct">${ceOiChgPctStr}</td>
          <td class="${ceClass} cell-oi-pct col-oi-pct">${ceOiPctStr}</td>
          <td class="${ceClass} col-rev">
            <div class="rev-cell">
              <span class="rev-ltp">${ceRevLtp > 0 ? formatDecimal(ceRevLtp) : '-'}</span>
              <span class="rev-spot">${ceRevSpot > 0 ? Math.round(ceRevSpot) : '-'}</span>
            </div>
          </td>

          <!-- STRIKE PRICE (CENTER) - Multiples of 100 in Bold -->
          <td class="${strikeClass} ${isMultipleOf100 ? 'strike-bold' : ''} col-strike">
            ${strikeDisplayContent}
          </td>

          <!-- PUTS (PE) - Mirrored: Rev(LTP/Spot) | PUT OI% | CHG OI% | LTP | Volume | OI | OI Chg | IV | Delta -->
          <td class="${peClass} col-rev">
            <div class="rev-cell">
              <span class="rev-ltp">${peRevLtp > 0 ? formatDecimal(peRevLtp) : '-'}</span>
              <span class="rev-spot">${peRevSpot > 0 ? Math.round(peRevSpot) : '-'}</span>
            </div>
          </td>
          <td class="${peClass} cell-oi-pct col-oi-pct">${peOiPctStr}</td>
          <td class="${peClass} ${peOiChgPctClass} col-oichg-pct">${peOiChgPctStr}</td>
          <td class="${peClass} col-ltp">${formatDecimal(pe.lastPrice)}</td>
          <td class="${peClass} col-vol">${renderRelativeCell(peVol, maxPeVol, false, false)}</td>
          <td class="${peClass} col-oi">${renderRelativeCell(peOi, maxPeOI, false, false)}</td>
          <td class="${peClass} col-oichg">${renderRelativeCell(peOiChg, maxPeOiChg, false, true, (peOi !== 0 && peStrikeOiChgPctStr !== '-') ? `(${peStrikeOiChgPctStr})` : '')}</td>
          <td class="${peClass} col-iv">${formatDecimal(pe.impliedVolatility)}</td>
          <td class="${peClass} col-delta">${peDeltaStr}</td>
        </tr>
      `;
    }

    // 1. Render SET A (Above Spot Baseline)
    selectedA.forEach(strike => {
      rowsHtml += buildStrikeRowHtml(strike, false);
    });

    // Extract Advances, Unchange, Declines data (A, U, D)
    const advDecData = payload.advanceDecline || payload.records?.advanceDecline || {
      advances: 2016,
      unchange: 115,
      declines: 1517
    };
    const advCount = Number(advDecData.advances) || 0;
    const uncCount = Number(advDecData.unchange) || 0;
    const decCount = Number(advDecData.declines) || 0;
    const totalAud = advCount + uncCount + decCount;
    const advPctStr = totalAud > 0 ? ((advCount / totalAud) * 100).toFixed(1) + '%' : '0.0%';
    const uncPctStr = totalAud > 0 ? ((uncCount / totalAud) * 100).toFixed(1) + '%' : '0.0%';
    const decPctStr = totalAud > 0 ? ((decCount / totalAud) * 100).toFixed(1) + '%' : '0.0%';

    // 2. Render Spot Baseline Divider Bar (Blue row with SPOT, AUD, F, and O, H, L, R + HF, LF, RF)
    rowsHtml += `
      <tr id="spotDividerRow" class="spot-divider-row">
        <td colspan="19">
          <div class="spot-divider-content">
            <div class="spot-center-title">
              <span class="spot-price-badge">SPOT: ${formatIndianNumber(underlyingValue)} (${spotPrevCloseDiffStr})</span>
              <span class="spot-aud-badge" title="Market Breadth: Advances (A), Unchanged (U), Declines (D) | Total: ${formatIndianNumber(totalAud)}">
                <span class="aud-item aud-a"><span class="aud-label">A:</span> ${formatIndianNumber(advCount)} <span class="aud-pct">(${advPctStr})</span></span>
                <span class="aud-item aud-u"><span class="aud-label">U:</span> ${formatIndianNumber(uncCount)} <span class="aud-pct">(${uncPctStr})</span></span>
                <span class="aud-item aud-d"><span class="aud-label">D:</span> ${formatIndianNumber(decCount)} <span class="aud-pct">(${decPctStr})</span></span>
              </span>
              <span class="spot-price-badge">F: ${formatIndianNumber(futureValue)} (${spotFutDiffStr})</span>
              <span class="spot-ohlc-badge" title="Live Index OHLC (Open, High, Low, Range)">
                <span class="spot-ohlc-item"><span class="spot-ohlc-label">O:</span> ${formatIndianNumber(indexInfo.open)}</span>
                <span class="spot-ohlc-item"><span class="spot-ohlc-label">H:</span> ${formatIndianNumber(indexInfo.high)}</span>
                <span class="spot-ohlc-item"><span class="spot-ohlc-label">L:</span> ${formatIndianNumber(indexInfo.low)}</span>
                <span class="spot-ohlc-item"><span class="spot-ohlc-label">R:</span> ${rangeStr}</span>
              </span>
              <span class="spot-ohlc-badge spot-fixed-ohlc-badge" title="09:20 AM Fixed OHLC (High Fixed, Low Fixed, Range Fixed)">
                <span class="spot-ohlc-item"><span class="spot-ohlc-label fixed-label">HF:</span> ${formatIndianNumber(displayHf)}</span>
                <span class="spot-ohlc-item"><span class="spot-ohlc-label fixed-label">LF:</span> ${formatIndianNumber(displayLf)}</span>
                <span class="spot-ohlc-item"><span class="spot-ohlc-label fixed-label">RF:</span> ${displayRfStr}</span>
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

    // Calculate sum and averages across ALL columns for the visible strikes displayed on the page
    let sumVisibleCeOi = 0;
    let sumVisibleCeOiChg = 0;
    let sumVisibleCeVol = 0;
    let sumVisibleCeDelta = 0;
    let countCeDelta = 0;
    let sumVisibleCeIv = 0;
    let countCeIv = 0;
    let sumVisibleCeLtp = 0;
    let countCeLtp = 0;

    let sumItmCeOi = 0;
    let sumItmCeOiChg = 0;
    let sumItmCeVol = 0;
    let sumItmCeDelta = 0;
    let countItmCeDelta = 0;
    let sumItmCeIv = 0;
    let countItmCeIv = 0;
    let sumItmCeLtp = 0;
    let countItmCeLtp = 0;

    let sumOtmCeOi = 0;
    let sumOtmCeOiChg = 0;
    let sumOtmCeVol = 0;
    let sumOtmCeDelta = 0;
    let countOtmCeDelta = 0;
    let sumOtmCeIv = 0;
    let countOtmCeIv = 0;
    let sumOtmCeLtp = 0;
    let countOtmCeLtp = 0;

    let sumVisiblePeOi = 0;
    let sumVisiblePeOiChg = 0;
    let sumVisiblePeVol = 0;
    let sumVisiblePeDelta = 0;
    let countPeDelta = 0;
    let sumVisiblePeIv = 0;
    let countPeIv = 0;
    let sumVisiblePeLtp = 0;
    let countPeLtp = 0;

    let sumItmPeOi = 0;
    let sumItmPeOiChg = 0;
    let sumItmPeVol = 0;
    let sumItmPeDelta = 0;
    let countItmPeDelta = 0;
    let sumItmPeIv = 0;
    let countItmPeIv = 0;
    let sumItmPeLtp = 0;
    let countItmPeLtp = 0;

    let sumOtmPeOi = 0;
    let sumOtmPeOiChg = 0;
    let sumOtmPeVol = 0;
    let sumOtmPeDelta = 0;
    let countOtmPeDelta = 0;
    let sumOtmPeIv = 0;
    let countOtmPeIv = 0;
    let sumOtmPeLtp = 0;
    let countOtmPeLtp = 0;

    // Process Set A (Strikes > Spot) -> OTM Calls, ITM Puts
    selectedA.forEach(s => {
      const item = strikeMap.get(s);
      if (item) {
        if (item.CE) {
          sumOtmCeOi += (Number(item.CE.openInterest) || 0) * LOT_MULTIPLIER;
          sumOtmCeOiChg += (Number(item.CE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
          sumOtmCeVol += (Number(item.CE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
          if (Number(item.CE.lastPrice) > 0) {
            sumOtmCeLtp += Number(item.CE.lastPrice);
            countOtmCeLtp++;
          }
          if (Number(item.CE.impliedVolatility) > 0) {
            sumOtmCeIv += Number(item.CE.impliedVolatility);
            countOtmCeIv++;
          }
          const deltaRes = calculateDelta(underlyingValue, s, Number(item.CE.impliedVolatility) || fallbackAtmIv, daysToExpiry, 0.068);
          if (deltaRes.callDelta !== null) {
            sumOtmCeDelta += deltaRes.callDelta;
            countOtmCeDelta++;
          }
        }
        if (item.PE) {
          sumItmPeOi += (Number(item.PE.openInterest) || 0) * LOT_MULTIPLIER;
          sumItmPeOiChg += (Number(item.PE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
          sumItmPeVol += (Number(item.PE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
          if (Number(item.PE.lastPrice) > 0) {
            sumItmPeLtp += Number(item.PE.lastPrice);
            countItmPeLtp++;
          }
          if (Number(item.PE.impliedVolatility) > 0) {
            sumItmPeIv += Number(item.PE.impliedVolatility);
            countItmPeIv++;
          }
          const deltaRes = calculateDelta(underlyingValue, s, Number(item.PE.impliedVolatility) || fallbackAtmIv, daysToExpiry, 0.068);
          if (deltaRes.putDelta !== null) {
            sumItmPeDelta += deltaRes.putDelta;
            countItmPeDelta++;
          }
        }
      }
    });

    // Process Set B (Strikes < Spot) -> ITM Calls, OTM Puts
    selectedB.forEach(s => {
      const item = strikeMap.get(s);
      if (item) {
        if (item.CE) {
          sumItmCeOi += (Number(item.CE.openInterest) || 0) * LOT_MULTIPLIER;
          sumItmCeOiChg += (Number(item.CE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
          sumItmCeVol += (Number(item.CE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
          if (Number(item.CE.lastPrice) > 0) {
            sumItmCeLtp += Number(item.CE.lastPrice);
            countItmCeLtp++;
          }
          if (Number(item.CE.impliedVolatility) > 0) {
            sumItmCeIv += Number(item.CE.impliedVolatility);
            countItmCeIv++;
          }
          const deltaRes = calculateDelta(underlyingValue, s, Number(item.CE.impliedVolatility) || fallbackAtmIv, daysToExpiry, 0.068);
          if (deltaRes.callDelta !== null) {
            sumItmCeDelta += deltaRes.callDelta;
            countItmCeDelta++;
          }
        }
        if (item.PE) {
          sumOtmPeOi += (Number(item.PE.openInterest) || 0) * LOT_MULTIPLIER;
          sumOtmPeOiChg += (Number(item.PE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
          sumOtmPeVol += (Number(item.PE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
          if (Number(item.PE.lastPrice) > 0) {
            sumOtmPeLtp += Number(item.PE.lastPrice);
            countOtmPeLtp++;
          }
          if (Number(item.PE.impliedVolatility) > 0) {
            sumOtmPeIv += Number(item.PE.impliedVolatility);
            countOtmPeIv++;
          }
          const deltaRes = calculateDelta(underlyingValue, s, Number(item.PE.impliedVolatility) || fallbackAtmIv, daysToExpiry, 0.068);
          if (deltaRes.putDelta !== null) {
            sumOtmPeDelta += deltaRes.putDelta;
            countOtmPeDelta++;
          }
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
          sumItmCeVol += (Number(item.CE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
          if (Number(item.CE.lastPrice) > 0) {
            sumItmCeLtp += Number(item.CE.lastPrice);
            countItmCeLtp++;
          }
          if (Number(item.CE.impliedVolatility) > 0) {
            sumItmCeIv += Number(item.CE.impliedVolatility);
            countItmCeIv++;
          }
          const deltaRes = calculateDelta(underlyingValue, exactMatchStrike, Number(item.CE.impliedVolatility) || fallbackAtmIv, daysToExpiry, 0.068);
          if (deltaRes.callDelta !== null) {
            sumItmCeDelta += deltaRes.callDelta;
            countItmCeDelta++;
          }
        }
        if (item.PE) {
          sumItmPeOi += (Number(item.PE.openInterest) || 0) * LOT_MULTIPLIER;
          sumItmPeOiChg += (Number(item.PE.changeinOpenInterest) || 0) * LOT_MULTIPLIER;
          sumItmPeVol += (Number(item.PE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
          if (Number(item.PE.lastPrice) > 0) {
            sumItmPeLtp += Number(item.PE.lastPrice);
            countItmPeLtp++;
          }
          if (Number(item.PE.impliedVolatility) > 0) {
            sumItmPeIv += Number(item.PE.impliedVolatility);
            countItmPeIv++;
          }
          const deltaRes = calculateDelta(underlyingValue, exactMatchStrike, Number(item.PE.impliedVolatility) || fallbackAtmIv, daysToExpiry, 0.068);
          if (deltaRes.putDelta !== null) {
            sumItmPeDelta += deltaRes.putDelta;
            countItmPeDelta++;
          }
        }
      }
    }

    sumVisibleCeOi = sumItmCeOi + sumOtmCeOi;
    sumVisibleCeOiChg = sumItmCeOiChg + sumOtmCeOiChg;
    sumVisibleCeVol = sumItmCeVol + sumOtmCeVol;

    sumVisiblePeOi = sumItmPeOi + sumOtmPeOi;
    sumVisiblePeOiChg = sumItmPeOiChg + sumOtmPeOiChg;
    sumVisiblePeVol = sumItmPeVol + sumOtmPeVol;

    // Averages for Calls
    const countTotalCeDelta = countItmCeDelta + countOtmCeDelta;
    const avgCeDelta = countTotalCeDelta > 0 ? (sumItmCeDelta + sumOtmCeDelta) / countTotalCeDelta : 0;
    const avgCeDeltaStr = (avgCeDelta > 0 ? '+' : '') + avgCeDelta.toFixed(2);
    const itmCeDeltaStr = countItmCeDelta > 0 ? ((sumItmCeDelta / countItmCeDelta) > 0 ? '+' : '') + (sumItmCeDelta / countItmCeDelta).toFixed(2) : '-';
    const otmCeDeltaStr = countOtmCeDelta > 0 ? ((sumOtmCeDelta / countOtmCeDelta) > 0 ? '+' : '') + (sumOtmCeDelta / countOtmCeDelta).toFixed(2) : '-';

    const countTotalCeIv = countItmCeIv + countOtmCeIv;
    const avgCeIv = countTotalCeIv > 0 ? (sumItmCeIv + sumOtmCeIv) / countTotalCeIv : 0;
    const avgCeIvStr = avgCeIv > 0 ? avgCeIv.toFixed(1) : '-';
    const itmCeIvStr = countItmCeIv > 0 ? (sumItmCeIv / countItmCeIv).toFixed(1) : '-';
    const otmCeIvStr = countOtmCeIv > 0 ? (sumOtmCeIv / countOtmCeIv).toFixed(1) : '-';

    const countTotalCeLtp = countItmCeLtp + countOtmCeLtp;
    const avgCeLtp = countTotalCeLtp > 0 ? (sumItmCeLtp + sumOtmCeLtp) / countTotalCeLtp : 0;
    const avgCeLtpStr = avgCeLtp > 0 ? avgCeLtp.toFixed(2) : '-';
    const itmCeLtpStr = countItmCeLtp > 0 ? (sumItmCeLtp / countItmCeLtp).toFixed(2) : '-';
    const otmCeLtpStr = countOtmCeLtp > 0 ? (sumOtmCeLtp / countOtmCeLtp).toFixed(2) : '-';

    // Averages for Puts
    const countTotalPeDelta = countItmPeDelta + countOtmPeDelta;
    const avgPeDelta = countTotalPeDelta > 0 ? (sumItmPeDelta + sumOtmPeDelta) / countTotalPeDelta : 0;
    const avgPeDeltaStr = avgPeDelta.toFixed(2);
    const itmPeDeltaStr = countItmPeDelta > 0 ? (sumItmPeDelta / countItmPeDelta).toFixed(2) : '-';
    const otmPeDeltaStr = countOtmPeDelta > 0 ? (sumOtmPeDelta / countOtmPeDelta).toFixed(2) : '-';

    const countTotalPeIv = countItmPeIv + countOtmPeIv;
    const avgPeIv = countTotalPeIv > 0 ? (sumItmPeIv + sumOtmPeIv) / countTotalPeIv : 0;
    const avgPeIvStr = avgPeIv > 0 ? avgPeIv.toFixed(1) : '-';
    const itmPeIvStr = countItmPeIv > 0 ? (sumItmPeIv / countItmPeIv).toFixed(1) : '-';
    const otmPeIvStr = countOtmPeIv > 0 ? (sumOtmPeIv / countOtmPeIv).toFixed(1) : '-';

    const countTotalPeLtp = countItmPeLtp + countOtmPeLtp;
    const avgPeLtp = countTotalPeLtp > 0 ? (sumItmPeLtp + sumOtmPeLtp) / countTotalPeLtp : 0;
    const avgPeLtpStr = avgPeLtp > 0 ? avgPeLtp.toFixed(2) : '-';
    const itmPeLtpStr = countItmPeLtp > 0 ? (sumItmPeLtp / countItmPeLtp).toFixed(2) : '-';
    const otmPeLtpStr = countOtmPeLtp > 0 ? (sumOtmPeLtp / countOtmPeLtp).toFixed(2) : '-';

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

    const totalVisibleVolSum = sumVisibleCeVol + sumVisiblePeVol;
    let ceVolTotalPctStr = '-';
    let peVolTotalPctStr = '-';
    if (totalVisibleVolSum > 0) {
      ceVolTotalPctStr = ((sumVisibleCeVol / totalVisibleVolSum) * 100).toFixed(1) + '%';
      peVolTotalPctStr = ((sumVisiblePeVol / totalVisibleVolSum) * 100).toFixed(1) + '%';
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
        <!-- Row 1: TOTAL SUMMARY (All 19 Columns Populated) -->
        <tr class="total-row">
          <!-- CALLS (CE) TOTALS: Delta | IV | OI Chg | OI | Volume | LTP | CHG OI% | CALL OI% | Rev(LTP/Spot) -->
          <td class="total-ce col-delta">
            <div class="total-cell-stacked">
              <span class="total-line-sum">${avgCeDeltaStr}</span>
              <span class="total-line-pct">Avg</span>
            </div>
          </td>
          <td class="total-ce col-iv">
            <div class="total-cell-stacked">
              <span class="total-line-sum">${avgCeIvStr}</span>
              <span class="total-line-pct">Avg</span>
            </div>
          </td>
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
          <td class="total-ce col-vol">
            <div class="total-cell-stacked">
              <span class="total-line-sum">${formatIndianNumber(sumVisibleCeVol)}</span>
              <span class="total-line-pct">${ceVolTotalPctStr}</span>
            </div>
          </td>
          <td class="total-ce col-ltp">
            <div class="total-cell-stacked">
              <span class="total-line-sum">${avgCeLtpStr}</span>
              <span class="total-line-pct">Avg</span>
            </div>
          </td>
          <td class="total-ce col-oichg-pct">
            <div class="total-cell-stacked">
              <span class="total-line-sum ${totalCeChgClass}"><strong>${totalCeChgPctStr}</strong></span>
              <span class="total-line-pct">Net%</span>
            </div>
          </td>
          <td class="total-ce col-oi-pct">
            <div class="total-cell-stacked">
              <span class="total-line-sum"><strong>${ceOiTotalPctStr}</strong></span>
              <span class="total-line-pct">Share</span>
            </div>
          </td>
          <td class="total-ce col-rev">
            <div class="total-cell-stacked">
              <span class="total-line-sum">-</span>
              <span class="total-line-pct">-</span>
            </div>
          </td>

          <!-- STRIKE TOTAL LABEL -->
          <td class="total-strike col-strike">TOTAL (${visibleStrikes.length})</td>

          <!-- PUTS (PE) TOTALS: Rev(LTP/Spot) | PUT OI% | CHG OI% | LTP | Volume | OI | OI Chg | IV | Delta -->
          <td class="total-pe col-rev">
            <div class="total-cell-stacked">
              <span class="total-line-sum">-</span>
              <span class="total-line-pct">-</span>
            </div>
          </td>
          <td class="total-pe col-oi-pct">
            <div class="total-cell-stacked">
              <span class="total-line-sum"><strong>${peOiTotalPctStr}</strong></span>
              <span class="total-line-pct">Share</span>
            </div>
          </td>
          <td class="total-pe col-oichg-pct">
            <div class="total-cell-stacked">
              <span class="total-line-sum ${totalPeChgClass}"><strong>${totalPeChgPctStr}</strong></span>
              <span class="total-line-pct">Net%</span>
            </div>
          </td>
          <td class="total-pe col-ltp">
            <div class="total-cell-stacked">
              <span class="total-line-sum">${avgPeLtpStr}</span>
              <span class="total-line-pct">Avg</span>
            </div>
          </td>
          <td class="total-pe col-vol">
            <div class="total-cell-stacked">
              <span class="total-line-sum">${formatIndianNumber(sumVisiblePeVol)}</span>
              <span class="total-line-pct">${peVolTotalPctStr}</span>
            </div>
          </td>
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
          <td class="total-pe col-iv">
            <div class="total-cell-stacked">
              <span class="total-line-sum">${avgPeIvStr}</span>
              <span class="total-line-pct">Avg</span>
            </div>
          </td>
          <td class="total-pe col-delta">
            <div class="total-cell-stacked">
              <span class="total-line-sum">${avgPeDeltaStr}</span>
              <span class="total-line-pct">Avg</span>
            </div>
          </td>
        </tr>

        <!-- Row 2: ITM & OTM BREAKDOWN (All 19 Columns Populated cleanly without clutter) -->
        <tr class="breakdown-row">
          <!-- CALLS (CE) ITM / OTM: Delta | IV | OI Chg | OI | Volume | LTP | CHG OI% | CALL OI% | Rev(LTP/Spot) -->
          <td class="breakdown-ce col-delta">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${itmCeDeltaStr}</span>
              <span class="val-otm">${otmCeDeltaStr}</span>
            </div>
          </td>
          <td class="breakdown-ce col-iv">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${itmCeIvStr}</span>
              <span class="val-otm">${otmCeIvStr}</span>
            </div>
          </td>
          <td class="breakdown-ce col-oichg">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${formatIndianNumber(sumItmCeOiChg)}</span>
              <span class="val-otm">${formatIndianNumber(sumOtmCeOiChg)}</span>
            </div>
          </td>
          <td class="breakdown-ce col-oi">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${formatIndianNumber(sumItmCeOi)}</span>
              <span class="val-otm">${formatIndianNumber(sumOtmCeOi)}</span>
            </div>
          </td>
          <td class="breakdown-ce col-vol">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${formatIndianNumber(sumItmCeVol)}</span>
              <span class="val-otm">${formatIndianNumber(sumOtmCeVol)}</span>
            </div>
          </td>
          <td class="breakdown-ce col-ltp">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${itmCeLtpStr}</span>
              <span class="val-otm">${otmCeLtpStr}</span>
            </div>
          </td>
          <td class="breakdown-ce col-oichg-pct">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${itmCeChgPctStr}</span>
              <span class="val-otm">${otmCeChgPctStr}</span>
            </div>
          </td>
          <td class="breakdown-ce col-oi-pct">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${itmCeOiPctStr}</span>
              <span class="val-otm">${otmCeOiPctStr}</span>
            </div>
          </td>
          <td class="breakdown-ce col-rev">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">-</span>
              <span class="val-otm">-</span>
            </div>
          </td>

          <!-- STRIKE BREAKDOWN LABEL (Labels row 1 as ITM and row 2 as OTM) -->
          <td class="breakdown-strike col-strike">
            <div class="breakdown-cell-stacked">
              <span class="val-itm-label">ITM</span>
              <span class="val-otm-label">OTM</span>
            </div>
          </td>

          <!-- PUTS (PE) ITM / OTM: Rev(LTP/Spot) | PUT OI% | CHG OI% | LTP | Volume | OI | OI Chg | IV | Delta -->
          <td class="breakdown-pe col-rev">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">-</span>
              <span class="val-otm">-</span>
            </div>
          </td>
          <td class="breakdown-pe col-oi-pct">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${itmPeOiPctStr}</span>
              <span class="val-otm">${otmPeOiPctStr}</span>
            </div>
          </td>
          <td class="breakdown-pe col-oichg-pct">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${itmPeChgPctStr}</span>
              <span class="val-otm">${otmPeChgPctStr}</span>
            </div>
          </td>
          <td class="breakdown-pe col-ltp">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${itmPeLtpStr}</span>
              <span class="val-otm">${otmPeLtpStr}</span>
            </div>
          </td>
          <td class="breakdown-pe col-vol">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${formatIndianNumber(sumItmPeVol)}</span>
              <span class="val-otm">${formatIndianNumber(sumOtmPeVol)}</span>
            </div>
          </td>
          <td class="breakdown-pe col-oi">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${formatIndianNumber(sumItmPeOi)}</span>
              <span class="val-otm">${formatIndianNumber(sumOtmPeOi)}</span>
            </div>
          </td>
          <td class="breakdown-pe col-oichg">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${formatIndianNumber(sumItmPeOiChg)}</span>
              <span class="val-otm">${formatIndianNumber(sumOtmPeOiChg)}</span>
            </div>
          </td>
          <td class="breakdown-pe col-iv">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${itmPeIvStr}</span>
              <span class="val-otm">${otmPeIvStr}</span>
            </div>
          </td>
          <td class="breakdown-pe col-delta">
            <div class="breakdown-cell-stacked">
              <span class="val-itm">${itmPeDeltaStr}</span>
              <span class="val-otm">${otmPeDeltaStr}</span>
            </div>
          </td>
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
  } catch (err) {
    console.error('Error in renderTable:', err);
  }
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

// ============================================================
// Market Mood Index (MMI) Interactive Dial & Live Feed
// ============================================================
let mmiDataCache = null;

function formatMmiRelativeTime(dateString) {
  if (!dateString) return 'Updated recently';
  try {
    const d = new Date(dateString);
    const now = new Date();
    const diffMs = Math.max(0, now - d);
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return 'Updated just now';
    if (diffMins < 60) return `Updated ${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `Updated ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `Updated ${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  } catch (e) {
    return 'Updated recently';
  }
}

function updateMMIUI(data) {
  if (!data) return;
  mmiDataCache = data;

  const val = Number(data.currentValue) || 43.87;
  const valStr = val.toFixed(2);
  const zone = data.zone || 'fear';
  const label = data.label || 'Fear';
  const color = data.color || '#ff9923';
  const angle = (typeof data.angle === 'number') ? data.angle : (3 * val - 150);

  // 1. Header Trigger Badge
  const triggerVal = document.getElementById('mmiTriggerValue');
  const triggerZone = document.getElementById('mmiTriggerZone');
  const triggerDot = document.getElementById('mmiTriggerDot');

  if (triggerVal) {
    triggerVal.textContent = valStr;
    triggerVal.style.color = color;
  }
  if (triggerZone) {
    triggerZone.textContent = label;
  }
  if (triggerDot) {
    triggerDot.style.backgroundColor = color;
    triggerDot.style.boxShadow = `0 0 6px ${color}`;
  }

  // 2. Flyout Card Dial Elements
  const activeZoneImg = document.getElementById('mmiActiveZoneImg');
  const pointerSvg = document.getElementById('mmiPointerSvg');
  const pointerPath = document.getElementById('mmiPointerPath');
  const dialVal = document.getElementById('mmiDialValue');
  const dialUpdated = document.getElementById('mmiDialUpdated');

  if (activeZoneImg) {
    activeZoneImg.src = `images/mmi/indicator_parts/${zone}.svg`;
  }
  if (pointerSvg) {
    pointerSvg.style.transform = `rotate(${angle}deg)`;
  }
  if (pointerPath) {
    pointerPath.setAttribute('fill', color);
  }
  if (dialVal) {
    dialVal.textContent = valStr;
    dialVal.style.color = color;
  }
  if (dialUpdated) {
    dialUpdated.textContent = formatMmiRelativeTime(data.date);
  }

  // 3. Sentiment Description Box
  const zoneBadge = document.getElementById('mmiZoneBadge');
  const zoneRange = document.getElementById('mmiZoneRange');
  const zoneDesc = document.getElementById('mmiZoneDesc');

  const rangeMap = {
    'ef': '(< 30)',
    'fear': '(30 — 50)',
    'greed': '(50 — 70)',
    'eg': '(> 70)'
  };

  if (zoneBadge) {
    zoneBadge.textContent = `${label.toUpperCase()} ZONE`;
    zoneBadge.style.backgroundColor = color;
  }
  if (zoneRange) {
    zoneRange.textContent = rangeMap[zone] || '';
  }
  if (zoneDesc) {
    zoneDesc.textContent = data.description || '';
    zoneDesc.style.setProperty('white-space', 'normal', 'important');
    zoneDesc.style.setProperty('word-break', 'normal', 'important');
    zoneDesc.style.setProperty('overflow-wrap', 'break-word', 'important');
    zoneDesc.style.setProperty('display', 'block', 'important');
    zoneDesc.style.setProperty('width', '100%', 'important');
  }

  // 4. Historical Comparisons
  if (data.historical) {
    const histYest = document.getElementById('mmiHistYesterday');
    const histWeek = document.getElementById('mmiHistLastWeek');
    const histMonth = document.getElementById('mmiHistLastMonth');
    const histYear = document.getElementById('mmiHistLastYear');

    if (histYest && data.historical.lastDay != null) histYest.textContent = Number(data.historical.lastDay).toFixed(2);
    if (histWeek && data.historical.lastWeek != null) histWeek.textContent = Number(data.historical.lastWeek).toFixed(2);
    if (histMonth && data.historical.lastMonth != null) histMonth.textContent = Number(data.historical.lastMonth).toFixed(2);
    if (histYear && data.historical.lastYear != null) histYear.textContent = Number(data.historical.lastYear).toFixed(2);
  }
}

async function fetchMMI() {
  try {
    const res = await fetch('/api/mmi');
    if (!res.ok) return;
    const json = await res.json();
    if (json && json.success && json.data) {
      updateMMIUI(json.data);
    }
  } catch (err) {
    console.warn('[MMI Fetch Warning]', err);
  }
}

function initMMI() {
  const container = document.getElementById('mmiContainer');
  const card = document.getElementById('mmiCard');
  let hoverTimer = null;

  if (container && card) {
    const showCard = () => {
      clearTimeout(hoverTimer);
      const rect = container.getBoundingClientRect();
      card.style.top = `${rect.bottom + 6}px`;
      card.style.left = `${Math.max(8, rect.left)}px`;
      card.classList.add('is-open');
    };

    const hideCard = () => {
      hoverTimer = setTimeout(() => {
        card.classList.remove('is-open');
      }, 150);
    };

    container.addEventListener('mouseenter', showCard);
    container.addEventListener('mouseleave', hideCard);

    card.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimer);
    });

    card.addEventListener('mouseleave', hideCard);

    // Close when click outside
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target) && !card.contains(e.target)) {
        card.classList.remove('is-open');
      }
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        card.classList.remove('is-open');
      }
    });
  }

  fetchMMI();
  setInterval(fetchMMI, 60000);
}

// Initialize immediately on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (strikeCountInput) strikeCountInput.value = strikeDepth;
    if (cooldownInput) cooldownInput.value = refreshCooldownSeconds;
    initMMI();
    fetchOptionChain(false);
  });
} else {
  if (strikeCountInput) strikeCountInput.value = strikeDepth;
  if (cooldownInput) cooldownInput.value = refreshCooldownSeconds;
  initMMI();
  fetchOptionChain(false);
}
