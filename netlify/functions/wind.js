const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

exports.handler = async function(event, context) {
  let browser = null;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.goto('http://88.97.23.70:82/', { waitUntil: 'networkidle0' });

    await page.waitForFunction(() => {
      const speed = document.querySelector('#latestVariable2').textContent.trim();
      const direction = document.querySelector('#latestVariable1').textContent.trim();
      const timestamp = document.querySelector('#latestTimestamp').textContent.trim();
      return speed !== '---' && direction !== '---' && timestamp !== '---';
    }, { timeout: 10000 });

    const windSpeed = await page.$eval('#latestVariable2', el => el.textContent.trim());
    const windDirection = await page.$eval('#latestVariable1', el => el.textContent.trim());
    const latestTimestamp = await page.$eval('#latestTimestamp', el => el.textContent.trim());

    const directionDegrees = parseInt(windDirection, 10);
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(directionDegrees / 45) % 8;
    const windFrom = directions[index];

    await browser.close();

    return {
      statusCode: 200,
      body: JSON.stringify({ windSpeed, windDirection, latestTimestamp, windFrom }),
    };
  } catch (error) {
    if (browser) await browser.close();
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to fetch wind data' }),
    };
  }
};