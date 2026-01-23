require("dotenv").config();
const { chromium } = require("playwright");
const axios = require("axios");
const crypto = require("crypto");

const KEYWORDS = [
  "blender",
  "posture corrector",
  "led lights",
  "pet hair remover"
];

function signPayload(body, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
}

async function scrapeKeyword(keyword) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const ads = [];

  page.on("response", async (response) => {
    const url = response.url();

    if (url.includes("ads/library/async/search_ads")) {
      try {
        const json = await response.json();
        const results = json?.payload?.results || [];

        for (const ad of results) {
          ads.push({
            id: ad.ad_archive_id,
            page_name: ad.page_name,
            ad_text: ad.ad_creative_body,
            creative_url: ad.ad_snapshot_url,
            start_date: ad.start_date,
            platform: (ad.publisher_platform || []).join(","),
            keyword,
            raw_json: ad
          });
        }
      } catch {}
    }
  });

  const url = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${encodeURIComponent(keyword)}`;

  await page.goto(url, { waitUntil: "networkidle" });

  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 6000);
    await page.waitForTimeout(2500);
  }

  await browser.close();
  return ads;
}

async function sendToWebhook(ads) {
  if (ads.length === 0) return;

  const body = JSON.stringify({ ads });
  const signature = signPayload(body, process.env.WEBHOOK_SECRET);

  await axios.post(process.env.WEBHOOK_URL, body, {
    headers: {
      "Content-Type": "application/json",
      "x-signature": signature
    }
  });

  console.log(`Sent ${ads.length} ads`);
}

(async () => {
  for (const keyword of KEYWORDS) {
    console.log("Scraping:", keyword);
    const ads = await scrapeKeyword(keyword);
    await sendToWebhook(ads);
  }

  process.exit();
})();
