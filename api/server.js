import express from "express";
import cors from "cors";
const app = express();
app.use(cors());

const GROQ_KEY = process.env.GROQ_KEY;

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

// ── /weather ─────────────────────────────────────────────────────────
// Optional: pass ?lat=14.5&lon=121.0 to override IP geolocation
app.get("/weather", async (req, res) => {
  try {
    let lat = parseFloat(req.query.lat);
    let lon = parseFloat(req.query.lon);
    let city = req.query.city || null;

    // 1. Get coordinates from the caller's IP if not provided
    if (isNaN(lat) || isNaN(lon)) {
      const ip =
        req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
        req.socket.remoteAddress;

      // ip-api.com is free, no key required (45 req/min limit)
      const geoRes  = await fetch(`http://ip-api.com/json/${ip}?fields=lat,lon,city,regionName,country,status`);
      const geoData = await geoRes.json();

      if (geoData.status !== "success") {
        throw new Error(`Geolocation failed for IP: ${ip}`);
      }
      lat = geoData.lat;
      lon = geoData.lon;
      city = `${geoData.city}, ${geoData.regionName}, ${geoData.country}`;
    }

    // 2. Fetch current temperature + relative humidity from Open-Meteo
    //    (free, no API key needed)
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

    // 3. Calculate Heat Index (Steadman formula, Celsius)
    //    Only meaningful when temp >= 27°C and humidity >= 40%
    const heatIndex = calcHeatIndex(tempC, humidity);

    res.json({
      location:        city || `${lat}, ${lon}`,
      coordinates:     { lat, lon },
      temperature_c:   tempC,
      humidity_pct:    humidity,
      heat_index_c:    heatIndex,
      heat_level:      heatLevel(heatIndex),   // e.g. "Caution", "Danger"
      //location:        { lat, lon }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// ── Heat index helpers ────────────────────────────────────────────────
function calcHeatIndex(tempC, rh) {
  // Convert to °F for the standard Rothfusz regression
  const T = tempC * 9 / 5 + 32;
  const H = rh;

  // Simple estimate (valid for most ranges)
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

  // Below 80°F the formula is unreliable; just return actual temp
  if (T < 80) HI = T;

  // Convert back to °C, round to 1 decimal
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
