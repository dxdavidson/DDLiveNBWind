const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
const PORT = 3000;

const cors = require('cors');
app.use(cors());

// Optional: try to use a vendor Chromium build if available (e.g., @sparticuz/chromium)
let chromium;
try {
  chromium = require('@sparticuz/chromium');
} catch (e) {
  chromium = null;
}

async function getLaunchOptions() {
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
      '--single-process',
      '--disable-gpu'
    ],
    timeout: 30000
  };
  if (chromium) {
    try {
      let execPath;
      if (typeof chromium.executablePath === 'function') {
        const maybe = chromium.executablePath();
        // Handle both Promise and direct string return values
        execPath = (maybe && typeof maybe.then === 'function') ? await maybe : maybe;
      } else if (chromium.path) {
        execPath = chromium.path;
      }
      if (execPath) options.executablePath = execPath;
    } catch (e) {
      console.warn('Could not resolve Chromium executable path:', e.message);
    }
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
    console.error('Error fetching or parsing wind data with Puppeteer:', error, { env: process.env.NODE_ENV, hasChromium: !!chromium });
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

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
});