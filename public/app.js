// State
let currentSymbol = 'NIFTY';
let currentExpiry = '';
let strikeDepth = 20; // Default 20 above, 20 below
let refreshCooldownSeconds = 30; // Default fixed 30 seconds
let timerSecondsRemaining = 30;
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

// Start Configurable Countdown Timer
function startAutoRefreshTimer(resetToMax = true) {
  if (timerCountdownInterval) {
    clearInterval(timerCountdownInterval);
  }

  if (resetToMax) {
    timerSecondsRemaining = refreshCooldownSeconds;
  }
  updateTimerDisplay();

  timerCountdownInterval = setInterval(() => {
    timerSecondsRemaining--;
    updateTimerDisplay();

    if (timerSecondsRemaining <= 0) {
      clearInterval(timerCountdownInterval);
      fetchOptionChain(true); // Auto trigger
    }
  }, 1000);
}

function updateTimerDisplay() {
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

      // Check Live vs Fallback status
      if (result.live) {
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
      tableBody.innerHTML = `<tr><td colspan="13" style="text-align:center; padding: 25px; color: #ef4444; font-weight: 600;">Data fetch failed: ${failureReason}. No previous data available.</td></tr>`;
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
    tableBody.innerHTML = '<tr><td colspan="13" style="text-align:center; padding: 20px;">No option chain records found.</td></tr>';
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

  // Find max values for badge highlights across the visible set (multiplied by 65)
  const visibleStrikes = [...selectedA, ...(exactMatchStrike ? [exactMatchStrike] : []), ...selectedB];
  let maxCeOI = 0;
  let maxCeVol = 0;
  let maxPeOI = 0;
  let maxPeVol = 0;

  visibleStrikes.forEach(s => {
    const r = strikeMap.get(s);
    if (r) {
      if (r.CE) {
        const ceOi = (Number(r.CE.openInterest) || 0) * LOT_MULTIPLIER;
        const ceVol = (Number(r.CE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if (ceOi > maxCeOI) maxCeOI = ceOi;
        if (ceVol > maxCeVol) maxCeVol = ceVol;
      }
      if (r.PE) {
        const peOi = (Number(r.PE.openInterest) || 0) * LOT_MULTIPLIER;
        const peVol = (Number(r.PE.totalTradedVolume) || 0) * LOT_MULTIPLIER;
        if (peOi > maxPeOI) maxPeOI = peOi;
        if (peVol > maxPeVol) maxPeVol = peVol;
      }
    }
  });

  // Build HTML
  let rowsHtml = '';

  // Render Row Helper Function
  function buildStrikeRowHtml(strike, isExactMatch = false) {
    const item = strikeMap.get(strike) || {};
    const ce = item.CE || {};
    const pe = item.PE || {};

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

    // OI Chg Color Classes
    const ceOiChgClass = (ceOiChg < 0) ? 'text-negative' : (ceOiChg > 0 ? 'text-positive' : '');
    const peOiChgClass = (peOiChg < 0) ? 'text-negative' : (peOiChg > 0 ? 'text-positive' : '');

    // Max Badges
    const ceOiBadge = (ceOi > 0 && ceOi === maxCeOI) ? 'badge-highest-ce' : '';
    const ceVolBadge = (ceVol > 0 && ceVol === maxCeVol) ? 'badge-max-ce' : '';
    const peOiBadge = (peOi > 0 && peOi === maxPeOI) ? 'badge-highest-pe' : '';
    const peVolBadge = (peVol > 0 && peVol === maxPeVol) ? 'badge-max-pe' : '';

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
        <!-- CALLS (CE): IV | OI Chg | OI | Volume | LTP | CALL OI% -->
        <td class="${ceClass}">${formatDecimal(ce.impliedVolatility)}</td>
        <td class="${ceClass} ${ceOiChgClass}">${formatIndianNumber(ceOiChg)}</td>
        <td class="${ceClass}"><span class="${ceOiBadge}">${formatIndianNumber(ceOi)}</span></td>
        <td class="${ceClass}"><span class="${ceVolBadge}">${formatIndianNumber(ceVol)}</span></td>
        <td class="${ceClass}"><strong>${formatDecimal(ce.lastPrice)}</strong></td>
        <td class="${ceClass} cell-oi-pct"><strong>${ceOiPctStr}</strong></td>

        <!-- STRIKE PRICE (CENTER) - Multiples of 100 in Bold -->
        <td class="${strikeClass} ${isMultipleOf100 ? 'strike-bold' : ''}">
          ${strikeDisplayContent}
        </td>

        <!-- PUTS (PE) - Mirrored: PUT OI% | LTP | Volume | OI | OI Chg | IV -->
        <td class="${peClass} cell-oi-pct"><strong>${peOiPctStr}</strong></td>
        <td class="${peClass}"><strong>${formatDecimal(pe.lastPrice)}</strong></td>
        <td class="${peClass}"><span class="${peVolBadge}">${formatIndianNumber(peVol)}</span></td>
        <td class="${peClass}"><span class="${peOiBadge}">${formatIndianNumber(peOi)}</span></td>
        <td class="${peClass} ${peOiChgClass}">${formatIndianNumber(peOiChg)}</td>
        <td class="${peClass}">${formatDecimal(pe.impliedVolatility)}</td>
      </tr>
    `;
  }

  // 1. Render SET A (Above Spot Baseline)
  selectedA.forEach(strike => {
    rowsHtml += buildStrikeRowHtml(strike, false);
  });

  // 2. Render Spot Baseline Divider Bar (Blue row separating Set A and Set B)
  rowsHtml += `
    <tr id="spotDividerRow" class="spot-divider-row">
      <td colspan="13">
        <div class="spot-divider-content">
          <span class="spot-tag-left">▲ SET A (${selectedA.length} Strikes Above Baseline)</span>
          <div class="spot-center-title">
            <span class="spot-label">UNDERLYING SPOT</span>
            <span class="spot-price-badge">${currentSymbol} : ${formatIndianNumber(underlyingValue)}</span>
          </div>
          <span class="spot-tag-right">▼ SET B (${selectedB.length} Strikes Below Baseline)</span>
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
    tableFoot.innerHTML = `
      <!-- Row 1: TOTAL SUMMARY -->
      <tr class="total-row">
        <!-- CALLS (CE) TOTALS: IV | OI Chg | OI | Volume | LTP | CALL OI% -->
        <td class="total-ce">-</td>
        <td class="total-ce">
          <div class="total-cell-stacked">
            <span class="total-line-sum">sum: ${formatIndianNumber(sumVisibleCeOiChg)}</span>
            <span class="total-line-pct">%: ${ceOiChgTotalPctStr}</span>
          </div>
        </td>
        <td class="total-ce">
          <div class="total-cell-stacked">
            <span class="total-line-sum">sum: ${formatIndianNumber(sumVisibleCeOi)}</span>
            <span class="total-line-pct">%: ${ceOiTotalPctStr}</span>
          </div>
        </td>
        <td class="total-ce">-</td>
        <td class="total-ce">-</td>
        <td class="total-ce">
          <div class="total-cell-stacked">
            <span class="total-line-pct">${ceOiTotalPctStr}</span>
          </div>
        </td>

        <!-- STRIKE TOTAL LABEL -->
        <td class="total-strike">TOTAL (${visibleStrikes.length})</td>

        <!-- PUTS (PE) TOTALS: PUT OI% | LTP | Volume | OI | OI Chg | IV -->
        <td class="total-pe">
          <div class="total-cell-stacked">
            <span class="total-line-pct">${peOiTotalPctStr}</span>
          </div>
        </td>
        <td class="total-pe">-</td>
        <td class="total-pe">-</td>
        <td class="total-pe">
          <div class="total-cell-stacked">
            <span class="total-line-sum">sum: ${formatIndianNumber(sumVisiblePeOi)}</span>
            <span class="total-line-pct">%: ${peOiTotalPctStr}</span>
          </div>
        </td>
        <td class="total-pe">
          <div class="total-cell-stacked">
            <span class="total-line-sum">sum: ${formatIndianNumber(sumVisiblePeOiChg)}</span>
            <span class="total-line-pct">%: ${peOiChgTotalPctStr}</span>
          </div>
        </td>
        <td class="total-pe">-</td>
      </tr>

      <!-- Row 2: ITM & OTM BREAKDOWN (Realtime based on visible entries) -->
      <tr class="breakdown-row">
        <!-- CALLS (CE) ITM / OTM: IV | OI Chg | OI | Volume | LTP | CALL OI% -->
        <td class="breakdown-ce">-</td>
        <td class="breakdown-ce">
          <div class="total-cell-stacked">
            <span class="total-line-sum"><span class="tag-itm">ITM:</span> ${formatIndianNumber(sumItmCeOiChg)}</span>
            <span class="total-line-sum"><span class="tag-otm">OTM:</span> ${formatIndianNumber(sumOtmCeOiChg)}</span>
          </div>
        </td>
        <td class="breakdown-ce">
          <div class="total-cell-stacked">
            <span class="total-line-sum"><span class="tag-itm">ITM Call:</span> ${formatIndianNumber(sumItmCeOi)}</span>
            <span class="total-line-sum"><span class="tag-otm">OTM Call:</span> ${formatIndianNumber(sumOtmCeOi)}</span>
          </div>
        </td>
        <td class="breakdown-ce">-</td>
        <td class="breakdown-ce">-</td>
        <td class="breakdown-ce">
          <div class="total-cell-stacked">
            <span class="total-line-pct"><span class="tag-itm">ITM:</span> ${itmCeOiPctStr}</span>
            <span class="total-line-pct"><span class="tag-otm">OTM:</span> ${otmCeOiPctStr}</span>
          </div>
        </td>

        <!-- STRIKE BREAKDOWN LABEL -->
        <td class="breakdown-strike">ITM / OTM</td>

        <!-- PUTS (PE) ITM / OTM: PUT OI% | LTP | Volume | OI | OI Chg | IV -->
        <td class="breakdown-pe">
          <div class="total-cell-stacked">
            <span class="total-line-pct"><span class="tag-itm">ITM:</span> ${itmPeOiPctStr}</span>
            <span class="total-line-pct"><span class="tag-otm">OTM:</span> ${otmPeOiPctStr}</span>
          </div>
        </td>
        <td class="breakdown-pe">-</td>
        <td class="breakdown-pe">-</td>
        <td class="breakdown-pe">
          <div class="total-cell-stacked">
            <span class="total-line-sum"><span class="tag-itm">ITM Put:</span> ${formatIndianNumber(sumItmPeOi)}</span>
            <span class="total-line-sum"><span class="tag-otm">OTM Put:</span> ${formatIndianNumber(sumOtmPeOi)}</span>
          </div>
        </td>
        <td class="breakdown-pe">
          <div class="total-cell-stacked">
            <span class="total-line-sum"><span class="tag-itm">ITM:</span> ${formatIndianNumber(sumItmPeOiChg)}</span>
            <span class="total-line-sum"><span class="tag-otm">OTM:</span> ${formatIndianNumber(sumOtmPeOiChg)}</span>
          </div>
        </td>
        <td class="breakdown-pe">-</td>
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

strikeCountInput.addEventListener('input', (e) => {
  const val = parseInt(e.target.value);
  if (!isNaN(val) && val > 0) {
    strikeDepth = val;
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
      // Reset remaining timer to newly set cooldown and update display immediately
      startAutoRefreshTimer(true);
    }
  });
}

// Initialize immediately on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    fetchOptionChain(false);
  });
} else {
  fetchOptionChain(false);
}
