const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const { generateFallbackOptionChain } = require('./mockData');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

let cookieJar = '';
let lastCookieFetch = 0;

// Fetch fresh NSE cookies
async function getNSECookies() {
  const now = Date.now();
  if (cookieJar && now - lastCookieFetch < 1000 * 60 * 5) {
    return cookieJar;
  }

  return new Promise((resolve) => {
    const options = {
      hostname: 'www.nseindia.com',
      port: 443,
      path: '/option-chain',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity'
      },
      timeout: 3500
    };

    const req = https.request(options, (res) => {
      const setCookie = res.headers['set-cookie'];
      if (setCookie && Array.isArray(setCookie)) {
        cookieJar = setCookie.map(c => c.split(';')[0]).join('; ');
        lastCookieFetch = Date.now();
      }
      res.resume();
      resolve(cookieJar);
    });

    req.on('error', () => {
      resolve(cookieJar);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(cookieJar);
    });

    req.end();
  });
}

// Fetch live option chain from NSE
async function fetchNSEOptionChain(symbol = 'NIFTY', expiry = '') {
  const cookies = await getNSECookies();
  
  return new Promise((resolve, reject) => {
    const queryParams = expiry ? `type=Indices&symbol=${encodeURIComponent(symbol)}&expiry=${encodeURIComponent(expiry)}` : `type=Indices&symbol=${encodeURIComponent(symbol)}`;
    const options = {
      hostname: 'www.nseindia.com',
      port: 443,
      path: `/api/option-chain-v3?${queryParams}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.nseindia.com/option-chain',
        'Cookie': cookies,
        'Accept-Encoding': 'identity'
      },
      timeout: 4000
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`NSE returned status code ${res.statusCode}`));
      }

      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        rawData += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          resolve(parsed);
        } catch (e) {
          reject(new Error('Failed to parse JSON response from NSE'));
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request to NSE timed out'));
    });

    req.end();
  });
}

// Futures index mapping for liveEquity-derivatives
const FUTURES_INDEX_MAP = {
  'NIFTY': 'nse50_fut',
  'BANKNIFTY': 'nifty_bank_fut',
  'FINNIFTY': 'finnifty_fut',
  'MIDCPNIFTY': 'nse50_fut'
};

// Fetch live futures contract from NSE
async function fetchNSEFutures(symbol = 'NIFTY') {
  const cookies = await getNSECookies();
  const indexParam = FUTURES_INDEX_MAP[symbol] || 'nse50_fut';
  
  return new Promise((resolve) => {
    const options = {
      hostname: 'www.nseindia.com',
      port: 443,
      path: `/api/liveEquity-derivatives?index=${encodeURIComponent(indexParam)}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.nseindia.com/market-data/equity-derivatives-watch',
        'Cookie': cookies,
        'Accept-Encoding': 'identity'
      },
      timeout: 4000
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) {
        return resolve(null);
      }
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
            resolve(parsed.data[0]); // Near-month future contract (latest LTP)
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

// Index name mapping for allIndices API
const ALL_INDICES_MAP = {
  'NIFTY': 'NIFTY 50',
  'BANKNIFTY': 'NIFTY BANK',
  'FINNIFTY': 'NIFTY FINANCIAL SERVICES',
  'MIDCPNIFTY': 'NIFTY MIDCAP SELECT'
};

// Fetch live indices data (Open, High, Low, Previous Close) from NSE
async function fetchNSEAllIndices(symbol = 'NIFTY') {
  const cookies = await getNSECookies();
  const targetIndexName = ALL_INDICES_MAP[symbol] || 'NIFTY 50';

  return new Promise((resolve) => {
    const options = {
      hostname: 'www.nseindia.com',
      port: 443,
      path: '/api/allIndices',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.nseindia.com/market-data/live-equity-market',
        'Cookie': cookies,
        'Accept-Encoding': 'identity'
      },
      timeout: 4000
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      let rawData = '';
      res.setEncoding('utf8');
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(rawData);
          if (parsed && Array.isArray(parsed.data)) {
            const indexItem = parsed.data.find(d => 
              d.index === targetIndexName || 
              d.indexSymbol === targetIndexName ||
              (d.index && d.index.toUpperCase() === targetIndexName.toUpperCase())
            ) || parsed.data.find(d => d.index === 'NIFTY 50');
            resolve(indexItem || null);
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

// In-memory option chain cache for post-4:00 PM data
const optionChainCache = new Map();

// Helper: Check if current time in Indian Standard Time (IST) is within 7:00 AM - 4:00 PM
function getISTDateTime() {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  return new Date(istString);
}

function isMarketFetchHours() {
  const istDate = getISTDateTime();
  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const timeInMinutes = hours * 60 + minutes;
  // Active window: 7:00 AM (420 min) to 4:00 PM / 16:00 (960 min)
  return timeInMinutes >= 420 && timeInMinutes < 960;
}

// API endpoint for Option Chain
app.get('/api/option-chain', async (req, res) => {
  const symbol = req.query.symbol || 'NIFTY';
  const expiry = req.query.expiry || '08-Sep-2026';
  const forceLive = req.query.force === 'true';
  const cacheKey = `${symbol}_${expiry}`;
  const isLiveHours = isMarketFetchHours();

  // If outside 7:00 AM - 4:00 PM IST and cache exists, serve cached data immediately
  if (!isLiveHours && !forceLive && optionChainCache.has(cacheKey)) {
    const cachedEntry = optionChainCache.get(cacheKey);
    return res.json({
      success: true,
      live: false,
      cached: true,
      marketClosed: true,
      message: 'Serving post-4:00 PM cached data (Market closed until 7:00 AM IST)',
      timestamp: cachedEntry.timestamp,
      cachedAt: cachedEntry.cachedAt,
      data: cachedEntry.data
    });
  }

  // Otherwise, fetch live from NSE (during 7 AM - 4 PM IST, or initial cold cache populate)
  try {
    const [liveData, futureData, allIndicesData] = await Promise.all([
      fetchNSEOptionChain(symbol, expiry),
      fetchNSEFutures(symbol),
      fetchNSEAllIndices(symbol)
    ]);

    const hasRecords = liveData && liveData.records && Array.isArray(liveData.records.data) && liveData.records.data.length > 0;
    const hasFiltered = liveData && liveData.filtered && Array.isArray(liveData.filtered.data) && liveData.filtered.data.length > 0;
    const hasData = liveData && Array.isArray(liveData.data) && liveData.data.length > 0;

    if (hasRecords || hasFiltered || hasData) {
      const nowIso = new Date().toISOString();
      
      // Inject future contract LTP if available
      if (futureData && futureData.lastPrice) {
        const futLtp = Number(futureData.lastPrice);
        liveData.futureValue = futLtp;
        liveData.futureContract = futureData.contract || '';
        if (liveData.records) {
          liveData.records.futureValue = futLtp;
          liveData.records.futureContract = futureData.contract || '';
        }
      }

      // Inject index OHLC data from allIndices
      if (allIndicesData) {
        const indexInfo = {
          open: Number(allIndicesData.open) || 0,
          high: Number(allIndicesData.high) || 0,
          low: Number(allIndicesData.low) || 0,
          previousClose: Number(allIndicesData.previousClose) || 0,
          last: Number(allIndicesData.last) || 0,
          variation: Number(allIndicesData.variation) || 0,
          percentChange: Number(allIndicesData.percentChange) || 0,
          indexName: allIndicesData.index || 'NIFTY 50'
        };
        liveData.indexInfo = indexInfo;
        if (liveData.records) {
          liveData.records.indexInfo = indexInfo;
        }
      }

      // Cache this latest snapshot
      optionChainCache.set(cacheKey, {
        data: liveData,
        timestamp: nowIso,
        cachedAt: nowIso
      });

      return res.json({
        success: true,
        live: isLiveHours,
        cached: !isLiveHours,
        marketClosed: !isLiveHours,
        message: isLiveHours ? 'Live data retrieved from NSE' : 'Cached post-4:00 PM data',
        timestamp: nowIso,
        data: liveData
      });
    } else {
      throw new Error('NSE returned an empty dataset for this index/expiry');
    }
  } catch (error) {
    console.warn(`[Proxy Warning] ${error.message}. Serving fallback dataset.`);
    const fallbackData = generateFallbackOptionChain(symbol, expiry);
    const nowIso = new Date().toISOString();

    // Fallback realistic future value (e.g. spot + 10-15 pts)
    const spotVal = fallbackData.records?.underlyingValue || 24055.8;
    fallbackData.futureValue = spotVal + 14.5;
    if (fallbackData.records) {
      fallbackData.records.futureValue = spotVal + 14.5;
      fallbackData.records.futureContract = `${symbol} NEAR FUT`;
    }

    fallbackData.indexInfo = {
      open: 23858.0,
      high: 23914.45,
      low: 23786.8,
      previousClose: 24055.8,
      last: spotVal,
      variation: -141.35,
      percentChange: -0.59,
      indexName: symbol === 'NIFTY' ? 'NIFTY 50' : symbol
    };
    if (fallbackData.records) {
      fallbackData.records.indexInfo = fallbackData.indexInfo;
    }

    if (!optionChainCache.has(cacheKey)) {
      optionChainCache.set(cacheKey, {
        data: fallbackData,
        timestamp: nowIso,
        cachedAt: nowIso
      });
    }

    return res.json({
      success: true,
      live: false,
      fallback: true,
      cached: !isLiveHours,
      marketClosed: !isLiveHours,
      error: `Live fetch notice: ${error.message}`,
      timestamp: nowIso,
      data: fallbackData
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 NSE Option Chain Viewer is running on port ${PORT}`);
  console.log(`👉 http://localhost:${PORT}`);
  console.log(`====================================================`);
});
