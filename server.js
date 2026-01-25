const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors()); // Enable CORS for all origins

app.get('/api/wind', async (req, res) => {
  console.log("V2 /api/wind called");

  try {
    console.log("Launching browser...");
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', "--disable-dev-shm-usage","--disable-gpu","--no-zygote"] });
    const page = await browser.newPage();
    await page.goto('http://88.97.23.70:82/', { waitUntil: 'networkidle0' });

    // Wait until the table cells update from '---' to actual values (timeout after 10 seconds)
    await page.waitForFunction(() => {
      const speed = document.querySelector('#latestVariable2').textContent.trim();
      const direction = document.querySelector('#latestVariable1').textContent.trim();
      const timestamp = document.querySelector('#latestTimestamp').textContent.trim();
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

    await browser.close();

    res.json({ windSpeed, windDirection, latestTimestamp, windFrom });
  } catch (error) {
    console.error('Error fetching or parsing wind data with Puppeteer:', error);
    res.status(500).json({ error: 'Failed to fetch wind data' });
  }
});


app.get('/', (req, res) => {
  res.send('DDLiveNBWind proxy server is running');
});

app.get("/health", (req, res) => {
  res.send("ok");
});


app.listen(PORT, "0.0.0.0", () => {
  console.log(`V4 Proxy server running on port ${PORT}`);
});