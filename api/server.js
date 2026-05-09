import express from "express";
import cors from "cors";
import Parser from "rss-parser";

const app = express();
app.use(cors());

const GROQ_KEY = process.env.GROQ_KEY;
const rssParser = new Parser();

// ── /quote ────────────────────────────────────────────────────────────
app.get("/quote", async (req, res) => {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "user",
            content: "Generate a short random inspirational quote and not use repetitive quotes. Atleast 5 to 10 words maximum"
          }
        ],
        max_tokens: 100
      })
    });
    const data = await response.json();
    const quoteText = data?.choices?.[0]?.message?.content
      ?.replace(/^["*_]+|["*_]+$/g, "")
      .trim();
    if (!quoteText) throw new Error("No quote found");
    res.json({ quote: quoteText });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ── /weather ──────────────────────────────────────────────────────────
// Optional: pass ?lat=14.5&lon=121.0 to override IP geolocation
app.get("/weather", async (req, res) => {
  try {
    let lat = parseFloat(req.query.lat);
    let lon = parseFloat(req.query.lon);
    let city = req.query.city || null;

    if (isNaN(lat) || isNaN(lon)) {
      const ip =
        req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
        req.socket.remoteAddress;

      const geoRes  = await fetch(`http://ip-api.com/json/${ip}?fields=lat,lon,city,regionName,country,status`);
      const geoData = await geoRes.json();

      if (geoData.status !== "success") {
        throw new Error(`Geolocation failed for IP: ${ip}`);
      }
      lat  = geoData.lat;
      lon  = geoData.lon;
      city = `${geoData.city}, ${geoData.regionName}, ${geoData.country}`;
    }

    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m` +
      `&temperature_unit=celsius`
    );
    const weatherData = await weatherRes.json();
    const current = weatherData.current;

    const tempC    = current.temperature_2m;
    const humidity = current.relative_humidity_2m;
    const heatIndex = calcHeatIndex(tempC, humidity);

    res.json({
      location:      city || `${lat}, ${lon}`,
      coordinates:   { lat, lon },
      temperature_c: tempC,
      humidity_pct:  humidity,
      heat_index_c:  heatIndex,
      heat_level:    heatLevel(heatIndex),
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ── /trends ───────────────────────────────────────────────────────────
app.get("/trends", async (req, res) => {
  try {
    const category = req.query.category || "philippines";

    const prompt = `What is ONE trending positive topic right now in the "${category}" category?

Respond ONLY with valid JSON in this exact format, no extra text:
{
  "category": "${category}",
  "title": "...",
  "summary": "one sentence explanation (max 20 words)",
  "momentum": "rising" or "peak" or "declining"
}`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 150,
        temperature: 0.7
      })
    });

    const data = await response.json();
    const raw  = data?.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("No trend returned from model");

    const clean  = raw.replace(/^```(?:json)?\n?|```$/g, "").trim();
    const parsed = JSON.parse(clean);

    res.json({
      ...parsed,
      generated_at: new Date().toISOString(),
      source: "llm-generated"
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ── /news ─────────────────────────────────────────────────────────────
// No API key needed — powered by Google News RSS
// Optional: ?q=your+search+query   (default: "top news")
// Optional: ?count=5               (default: 5, max: 20)
// Optional: ?lang=en               (default: en)
// Optional: ?country=US            (default: US)
//
// Category topic shortcuts via ?topic=:
//   world, nation, business, technology, entertainment, sports, science, health
app.get("/news", async (req, res) => {
  try {
    const count   = Math.min(parseInt(req.query.count) || 5, 20);
    const lang    = req.query.lang    || "en";
    const country = req.query.country || "US";

    // Topic IDs map to Google News section feeds
    const topicMap = {
      world:         "CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVm5HZ0pWVXlnQVAB",
      nation:        "CAAqIggKIhxDQkFTRHdvSkwyMHZNR1ptZHpWbUVnSmxiaWdBUAE",
      business:      "CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVm5HZ0pWVXlnQVAB",
      technology:    "CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVm5HZ0pWVXlnQVAB",
      entertainment: "CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtVm5HZ0pWVXlnQVAB",
      sports:        "CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVm5HZ0pWVXlnQVAB",
      science:       "CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVm5HZ0pWVXlnQVAB",
      health:        "CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtVm5LQUFQAVgA",
    };

    let feedUrl;
    const topic = req.query.topic?.toLowerCase();

    if (topic && topicMap[topic]) {
      // Section/topic feed
      feedUrl =
        `https://news.google.com/rss/topics/${topicMap[topic]}` +
        `?hl=${lang}-${country}&gl=${country}&ceid=${country}:${lang}`;
    } else {
      // Keyword search feed
      const q = encodeURIComponent(req.query.q || "top news");
      feedUrl =
        `https://news.google.com/rss/search?q=${q}` +
        `&hl=${lang}-${country}&gl=${country}&ceid=${country}:${lang}`;
    }

    const feed = await rssParser.parseURL(feedUrl);

    const articles = feed.items.slice(0, count).map((item) => ({
      title:        cleanTitle(item.title),
      source:       item.source?.name ?? extractSource(item.title),
      url:          item.link,
      published_at: item.pubDate ?? null,
      summary:      item.contentSnippet?.slice(0, 200) ?? null,
    }));

    res.json({
      query:        req.query.q || req.query.topic || "top news",
      total:        articles.length,
      articles,
      fetched_at:   new Date().toISOString(),
      source:       "google-news-rss",
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ── News helpers ──────────────────────────────────────────────────────

// Google News titles often look like: "Headline text - Source Name"
// This strips the trailing " - Source Name" part
function cleanTitle(raw = "") {
  return raw.replace(/\s-\s[^-]+$/, "").trim();
}

// Fallback: extract source from the raw title if item.source is missing
function extractSource(raw = "") {
  const match = raw.match(/\s-\s([^-]+)$/);
  return match ? match[1].trim() : "Unknown";
}

// ── Heat index helpers ────────────────────────────────────────────────
function calcHeatIndex(tempC, rh) {
  const T = tempC * 9 / 5 + 32;
  const H = rh;

  let HI =
    -42.379
    + 2.04901523  * T
    + 10.14333127 * H
    - 0.22475541  * T * H
    - 0.00683783  * T * T
    - 0.05481717  * H * H
    + 0.00122874  * T * T * H
    + 0.00085282  * T * H * H
    - 0.00000199  * T * T * H * H;

  if (T < 80) HI = T;

  return Math.round((HI - 32) * 5 / 9 * 10) / 10;
}

function heatLevel(hiC) {
  if (hiC >= 54) return "Extreme danger";
  if (hiC >= 41) return "Danger";
  if (hiC >= 32) return "Extreme caution";
  if (hiC >= 27) return "Caution";
  return "Normal";
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
