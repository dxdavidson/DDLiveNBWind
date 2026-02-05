console.log("RUNNING SERVER FROM:", __filename);
const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = 3000;

const cors = require('cors');
app.use(cors());

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

app.get('/api/wind', async (req, res) => {
  let browser;
  try {
    const launchOptions = await getLaunchOptions();
    console.log('Launching Puppeteer with options', { headless: launchOptions.headless, hasExecutable: !!launchOptions.executablePath, executablePath: typeof launchOptions.executablePath === 'string' ? launchOptions.executablePath : undefined });
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
  const admiraltyKey = process.env.ADMIRALTY_API_KEY || 'f13ed0b0b62e442cabbd0769c52533f7';
  const url = `https://admiraltyapi.azure-api.net/uktidalapi/api/V1/Stations/${encodeURIComponent(station)}/TidalEvents`;

  // node-fetch v3 is ESM only, so dynamically import it in CommonJS
  const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

  const controller = new AbortController();
  const timeoutMs = 15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
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

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});