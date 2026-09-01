const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const { generateFallbackOptionChain } = require('./mockData');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
      timeout: 8000
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
      timeout: 9000
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

// API endpoint for Option Chain
app.get('/api/option-chain', async (req, res) => {
  const symbol = req.query.symbol || 'NIFTY';
  const expiry = req.query.expiry || '01-Sep-2026';

  try {
    const liveData = await fetchNSEOptionChain(symbol, expiry);
    if (liveData && (liveData.records || liveData.filtered || liveData.data)) {
      return res.json({
        success: true,
        live: true,
        fallback: false,
        message: 'Live data retrieved from NSE',
        timestamp: new Date().toISOString(),
        data: liveData
      });
    } else {
      throw new Error('Incomplete data received from NSE');
    }
  } catch (error) {
    console.warn(`[Proxy Warning] ${error.message}. Serving fallback dataset.`);
    const fallbackData = generateFallbackOptionChain(symbol, expiry);
    return res.json({
      success: true,
      live: false,
      fallback: true,
      error: `Something went wrong fetching live data: ${error.message}`,
      timestamp: new Date().toISOString(),
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
