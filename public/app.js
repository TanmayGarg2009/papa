// State
let currentSymbol = 'NIFTY';
let currentExpiry = '01-Sep-2026';
let strikeDepth = 20; // Default 20 above, 20 below
let timerSecondsRemaining = 0;
let timerCountdownInterval = null;
let lastFetchedData = null;

// DOM Elements
const symbolSelect = document.getElementById('symbolSelect');
const expirySelect = document.getElementById('expirySelect');
const strikeCountInput = document.getElementById('strikeCountInput');
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

// Utility: Dynamic random interval generator strictly between 1 and 3 minutes (61s - 179s)
function getNextRandomIntervalSeconds() {
  const minSeconds = 61;  // > 1 minute (60s excluded)
  const maxSeconds = 179; // < 3 minutes (180s excluded)
  const randomSeconds = Math.floor(Math.random() * (maxSeconds - minSeconds + 1)) + minSeconds;
  return randomSeconds;
}

// Toast Popup Notification
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = '✅';
  if (type === 'warning') icon = '⚠️';
  if (type === 'error') icon = '❌';

  const timeStr = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

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

  // Auto remove after 3.5 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 250);
  }, 3500);
}

// Start Random Countdown Timer
function startRandomAutoRefreshTimer() {
  if (timerCountdownInterval) {
    clearInterval(timerCountdownInterval);
  }

  timerSecondsRemaining = getNextRandomIntervalSeconds();
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
      throw new Error(`HTTP error ${response.status}`);
    }

    const result = await response.json();

    if (result.success && result.data) {
      lastFetchedData = result.data;
      
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
        noticeMessage.textContent = result.error || 'Something went wrong fetching live data from NSE. Showing fallback data.';
        showToast('Data Refreshed (Fallback Dataset)', 'warning');
      }

      renderTable(result.data);
    } else {
      throw new Error(result.error || 'Invalid data structure received');
    }
  } catch (error) {
    console.error('Fetch error:', error);
    statusBadge.className = 'status-badge fallback';
    statusText.textContent = 'Error / Offline';
    noticeBanner.classList.remove('hidden');
    noticeMessage.textContent = `Something went wrong: ${error.message}`;
    showToast('Something went wrong refreshing data', 'error');
  } finally {
    // Re-schedule next random timer strictly between 1 and 3 minutes
    startRandomAutoRefreshTimer();
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

  if (expiryDates.includes(previousValue)) {
    expirySelect.value = previousValue;
  } else if (expiryDates.includes(currentExpiry)) {
    expirySelect.value = currentExpiry;
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

  // Find max values for badge highlights across the visible set
  const visibleStrikes = [...selectedA, ...(exactMatchStrike ? [exactMatchStrike] : []), ...selectedB];
  let maxCeOI = 0;
  let maxCeVol = 0;
  let maxPeOI = 0;
  let maxPeVol = 0;

  visibleStrikes.forEach(s => {
    const r = strikeMap.get(s);
    if (r) {
      if (r.CE) {
        if ((r.CE.openInterest || 0) > maxCeOI) maxCeOI = r.CE.openInterest;
        if ((r.CE.totalTradedVolume || 0) > maxCeVol) maxCeVol = r.CE.totalTradedVolume;
      }
      if (r.PE) {
        if ((r.PE.openInterest || 0) > maxPeOI) maxPeOI = r.PE.openInterest;
        if ((r.PE.totalTradedVolume || 0) > maxPeVol) maxPeVol = r.PE.totalTradedVolume;
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

    const isCeItm = strike < underlyingValue;
    const isPeItm = strike > underlyingValue;

    const ceClass = isCeItm ? 'ce-itm' : 'ce-otm';
    const peClass = isPeItm ? 'pe-itm' : 'pe-otm';

    // Highlight Golden color if exact match
    const strikeClass = isExactMatch ? 'exact-match-strike' : 'cell-strike';
    const rowClass = isExactMatch ? 'exact-match-row' : '';

    // OI Chg Color Classes
    const ceOiChgClass = (ce.changeinOpenInterest < 0) ? 'text-negative' : (ce.changeinOpenInterest > 0 ? 'text-positive' : '');
    const peOiChgClass = (pe.changeinOpenInterest < 0) ? 'text-negative' : (pe.changeinOpenInterest > 0 ? 'text-positive' : '');

    // Max Badges
    const ceOiBadge = (ce.openInterest && ce.openInterest === maxCeOI) ? 'badge-highest-ce' : '';
    const ceVolBadge = (ce.totalTradedVolume && ce.totalTradedVolume === maxCeVol) ? 'badge-max-ce' : '';
    const peOiBadge = (pe.openInterest && pe.openInterest === maxPeOI) ? 'badge-highest-pe' : '';
    const peVolBadge = (pe.totalTradedVolume && pe.totalTradedVolume === maxPeVol) ? 'badge-max-pe' : '';

    // Calculate CALL OI% and PUT OI% (Percentage of their sum for this strike row)
    const ceOiNum = Number(ce.openInterest) || 0;
    const peOiNum = Number(pe.openInterest) || 0;
    const totalOiSum = ceOiNum + peOiNum;

    let ceOiPctStr = '-';
    let peOiPctStr = '-';

    if (totalOiSum > 0) {
      const cePct = (ceOiNum / totalOiSum) * 100;
      const pePct = (peOiNum / totalOiSum) * 100;
      ceOiPctStr = cePct.toFixed(1) + '%';
      peOiPctStr = pePct.toFixed(1) + '%';
    }

    return `
      <tr class="${rowClass}">
        <!-- CALLS (CE) -->
        <td class="${ceClass}">${formatDecimal(ce.impliedVolatility)}</td>
        <td class="${ceClass} ${ceOiChgClass}">${formatIndianNumber(ce.changeinOpenInterest)}</td>
        <td class="${ceClass}"><span class="${ceVolBadge}">${formatIndianNumber(ce.totalTradedVolume)}</span></td>
        <td class="${ceClass}"><strong>${formatDecimal(ce.lastPrice)}</strong></td>
        <td class="${ceClass}"><span class="${ceOiBadge}">${formatIndianNumber(ce.openInterest)}</span></td>
        <td class="${ceClass} cell-oi-pct"><strong>${ceOiPctStr}</strong></td>

        <!-- STRIKE PRICE (CENTER) -->
        <td class="${strikeClass}">
          ${isExactMatch ? `<span class="golden-badge">${formatIndianNumber(strike)}</span>` : `<strong>${formatIndianNumber(strike)}</strong>`}
        </td>

        <!-- PUTS (PE) -->
        <td class="${peClass} cell-oi-pct"><strong>${peOiPctStr}</strong></td>
        <td class="${peClass}"><span class="${peOiBadge}">${formatIndianNumber(pe.openInterest)}</span></td>
        <td class="${peClass}"><strong>${formatDecimal(pe.lastPrice)}</strong></td>
        <td class="${peClass}"><span class="${peVolBadge}">${formatIndianNumber(pe.totalTradedVolume)}</span></td>
        <td class="${peClass} ${peOiChgClass}">${formatIndianNumber(pe.changeinOpenInterest)}</td>
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

  // Calculate sum of OI and OI Change ONLY for the visible strikes displayed on the page
  let sumVisibleCeOi = 0;
  let sumVisibleCeOiChg = 0;
  let sumVisiblePeOi = 0;
  let sumVisiblePeOiChg = 0;

  visibleStrikes.forEach(s => {
    const item = strikeMap.get(s);
    if (item) {
      if (item.CE) {
        sumVisibleCeOi += Number(item.CE.openInterest) || 0;
        sumVisibleCeOiChg += Number(item.CE.changeinOpenInterest) || 0;
      }
      if (item.PE) {
        sumVisiblePeOi += Number(item.PE.openInterest) || 0;
        sumVisiblePeOiChg += Number(item.PE.changeinOpenInterest) || 0;
      }
    }
  });

  // Calculate percentages for OI and OI Change sums
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

  // Render Table Footer Row (matching Top Header colors with Sum & Percentage)
  if (tableFoot) {
    tableFoot.innerHTML = `
      <tr class="total-row">
        <!-- CALLS (CE) TOTALS -->
        <td class="total-ce">-</td>
        <td class="total-ce">
          <div class="total-cell-stacked">
            <span class="total-line-sum">sum: ${formatIndianNumber(sumVisibleCeOiChg)}</span>
            <span class="total-line-pct">%: ${ceOiChgTotalPctStr}</span>
          </div>
        </td>
        <td class="total-ce">-</td>
        <td class="total-ce">-</td>
        <td class="total-ce">
          <div class="total-cell-stacked">
            <span class="total-line-sum">sum: ${formatIndianNumber(sumVisibleCeOi)}</span>
            <span class="total-line-pct">%: ${ceOiTotalPctStr}</span>
          </div>
        </td>
        <td class="total-ce">
          <div class="total-cell-stacked">
            <span class="total-line-pct">${ceOiTotalPctStr}</span>
          </div>
        </td>

        <!-- STRIKE TOTAL LABEL -->
        <td class="total-strike">TOTAL (${visibleStrikes.length})</td>

        <!-- PUTS (PE) TOTALS -->
        <td class="total-pe">
          <div class="total-cell-stacked">
            <span class="total-line-pct">${peOiTotalPctStr}</span>
          </div>
        </td>
        <td class="total-pe">
          <div class="total-cell-stacked">
            <span class="total-line-sum">sum: ${formatIndianNumber(sumVisiblePeOi)}</span>
            <span class="total-line-pct">%: ${peOiTotalPctStr}</span>
          </div>
        </td>
        <td class="total-pe">-</td>
        <td class="total-pe">-</td>
        <td class="total-pe">
          <div class="total-cell-stacked">
            <span class="total-line-sum">sum: ${formatIndianNumber(sumVisiblePeOiChg)}</span>
            <span class="total-line-pct">%: ${peOiChgTotalPctStr}</span>
          </div>
        </td>
        <td class="total-pe">-</td>
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

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  fetchOptionChain(false);
});
