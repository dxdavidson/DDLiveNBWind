console.log("RUNNING SERVER FROM:", __filename);
const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = 3000;

const cors = require('cors');
app.use(cors());

const cacheStore = new Map();

function getCachedValue(key) {
  const entry = cacheStore.get(key);
  if (!entry) {
    return null;
  }
  if (Date.now() >= entry.expiresAt) {
    cacheStore.delete(key);
    return null;
  }
  return entry.value;
}

function setCachedValue(key, value, ttlMs) {
  cacheStore.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

async function getLaunchOptions() {
  const isLinux = process.platform === 'linux';

  const options = {
    headless: true,
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ],
    timeout: 30000
  };

  if (isLinux) {
    try {
      const chromium = require('@sparticuz/chromium');
      const execPath = await chromium.executablePath();
      options.executablePath = execPath;
      options.args = chromium.args;
    } catch (e) {
      console.warn('Linux environment but @sparticuz/chromium not available:', e.message);
    }
  } else {
    // Windows/macOS: use the browser installed by @puppeteer/browsers
    const path = require('path');
    options.executablePath = path.join(
      __dirname,
      'chrome',
      'win64-146.0.7667.0',
      'chrome-win64',
      'chrome.exe'
    );
  }

  return options;
}

app.get('/api/livewind', async (req, res) => {
  let browser;
  try {
    const launchOptions = await getLaunchOptions();
    //console.log('Launching Puppeteer with options', { headless: launchOptions.headless, hasExecutable: !!launchOptions.executablePath, executablePath: typeof launchOptions.executablePath === 'string' ? launchOptions.executablePath : undefined });
    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.goto('http://88.97.23.70:82/', { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait until the table cells update from '---' to actual values (timeout after 10 seconds)
    await page.waitForFunction(() => {
      const latestVariable2 = document.querySelector('#latestVariable2');
      const latestVariable1 = document.querySelector('#latestVariable1');
      const latestTimestampEl = document.querySelector('#latestTimestamp');
      const speed = latestVariable2 ? latestVariable2.textContent.trim() : '---';
      const direction = latestVariable1 ? latestVariable1.textContent.trim() : '---';
      const timestamp = latestTimestampEl ? latestTimestampEl.textContent.trim() : '---';
      return speed !== '---' && direction !== '---' && timestamp !== '---';
    }, { timeout: 10000 });

    const windSpeed = await page.$eval('#latestVariable2', el => el.textContent.trim());
    const windDirection = await page.$eval('#latestVariable1', el => el.textContent.trim());
    const latestTimestamp = await page.$eval('#latestTimestamp', el => el.textContent.trim());

    // Calculate windFrom based on windDirection
    const directionDegrees = parseInt(windDirection, 10);
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(directionDegrees / 45) % 8;
    const windFrom = directions[index];
  

    res.json({ windSpeed, windDirection, latestTimestamp, windFrom });
  } catch (error) {
    //console.error('Error fetching or parsing wind data with Puppeteer:', error, { env: process.env.NODE_ENV, hasChromium: !!chromium });
    console.error('Error fetching or parsing wind data with Puppeteer:', error, { env: process.env.NODE_ENV });
    if (error && error.message && error.message.includes('Failed to launch the browser')) {
      return res.status(500).json({ error: 'Browser failed to launch', details: error.message });
    }
    res.status(500).json({ error: 'Failed to fetch wind data', details: error.message });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error('Error closing browser:', e);
      }
    }
  }
});

app.get('/api/tides', async (req, res) => {
  // Calls Admiralty API for tidal events. Defaults to station 0223 but can be overridden with ?station=XXXX
  const station = req.query.station || '0223';
  const cacheKey = `tides:${station}`;
  const cacheTtlMs = 10 * 60 * 1000;
  const cached = getCachedValue(cacheKey);
  if (cached) {
    console.log(`[tides] Cache hit for station ${station}; serving cached response`);
    res.set('Cache-Control', 'public, max-age=600');
    return res.json(cached);
  }
  console.log(`[tides] Cache miss for station ${station}; fetching from API`);
  const admiraltyKey = process.env.ADMIRALTY_API_KEY || 'f13ed0b0b62e442cabbd0769c52533f7';
  const url = `https://admiraltyapi.azure-api.net/uktidalapi/api/V1/Stations/${encodeURIComponent(station)}/TidalEvents`;

  // node-fetch v3 is ESM only, so dynamically import it in CommonJS
  const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

  const controller = new AbortController();
  const timeoutMs = 15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log(`[tides] Requesting Admiralty API for station ${station}`);
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
        'Ocp-Apim-Subscription-Key': admiraltyKey,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const bodyText = await response.text();
      return res.status(502).json({ error: 'Admiralty API returned non-OK status', status: response.status, body: bodyText });
    }

    const data = await response.json();
    setCachedValue(cacheKey, data, cacheTtlMs);
    console.log(`[tides] Caching response for station ${station} for ${Math.round(cacheTtlMs / 60000)} minutes`);
    res.set('Cache-Control', 'public, max-age=600');
    return res.json(data);
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Admiralty API request timed out' });
    }
    console.error('Error fetching tides from Admiralty API:', err);
    return res.status(500).json({ error: 'Failed to fetch tides', details: err.message });
  }
});

app.get('/api/weatherforecast', async (req, res) => {
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=56.058&longitude=-2.722&hourly=wind_speed_10m,wind_direction_10m,precipitation_probability&wind_speed_unit=mph';
    const cacheKey = 'weatherforecast';
    const cacheTtlMs = 10 * 60 * 1000;
    const cached = getCachedValue(cacheKey);
    if (cached) {
      console.log('[weatherforecast] Cache hit; serving cached response');
      res.set('Cache-Control', 'public, max-age=600');
      return res.json(cached);
    }
    console.log('[weatherforecast] Cache miss; fetching from API');
    
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    console.log('[weatherforecast] Requesting Open-Meteo API');
    const response = await fetch(url);

    if (!response.ok) {
      const bodyText = await response.text();
      return res.status(502).json({ error: 'Open-Meteo API returned non-OK status', status: response.status, body: bodyText });
    }

    const data = await response.json();
    setCachedValue(cacheKey, data, cacheTtlMs);
    console.log(`[weatherforecast] Caching response for ${Math.round(cacheTtlMs / 60000)} minutes`);
    res.set('Cache-Control', 'public, max-age=600');
    return res.json(data);
  } catch (error) {
    console.error('Error fetching weather forecast:', error);
    res.status(500).json({ error: 'Failed to fetch weather forecast', details: error.message });
  }
});

app.get('/api/waves', async (req, res) => {
  try {
    const url = 'https://marine-api.open-meteo.com/v1/marine?latitude=56.06&longitude=-2.7&daily=wave_height_max&timezone=Europe%2FLondon';
    const cacheKey = 'waves';
    const cacheTtlMs = 10 * 60 * 1000;
    const cached = getCachedValue(cacheKey);
    if (cached) {
      console.log('[waves] Cache hit; serving cached response');
      res.set('Cache-Control', 'public, max-age=600');
      return res.json(cached);
    }
    console.log('[waves] Cache miss; fetching from API');

    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    console.log('[waves] Requesting Open-Meteo marine API');
    const response = await fetch(url);

    if (!response.ok) {
      const bodyText = await response.text();
      return res.status(502).json({ error: 'Open-Meteo marine API returned non-OK status', status: response.status, body: bodyText });
    }

    const data = await response.json();
    setCachedValue(cacheKey, data, cacheTtlMs);
    console.log(`[waves] Caching response for ${Math.round(cacheTtlMs / 60000)} minutes`);
    res.set('Cache-Control', 'public, max-age=600');
    return res.json(data);
  } catch (error) {
    console.error('Error fetching wave data:', error);
    res.status(500).json({ error: 'Failed to fetch wave data', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});