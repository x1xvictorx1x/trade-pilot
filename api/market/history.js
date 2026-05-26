const symbolMap = {
  ES: "ES=F",
  MES: "ES=F",
  MNQ: "NQ=F",
  NQ: "NQ=F",
  RTY: "RTY=F",
  YM: "YM=F",
  CL: "CL=F",
  GC: "GC=F",
};

function setCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function normalizeMarket(symbol = "NQ") {
  const upper = String(symbol || "NQ").toUpperCase();
  if (upper.includes("MNQ")) return "MNQ";
  if (upper.includes("NQ")) return "NQ";
  if (upper.includes("MES")) return "MES";
  if (upper.includes("ES")) return "ES";
  if (upper.includes("YM")) return "YM";
  if (upper.includes("RTY")) return "RTY";
  if (upper.includes("CL")) return "CL";
  if (upper.includes("GC")) return "GC";
  return upper;
}

function intervalToMinutes(interval) {
  const str = String(interval || "5m");
  if (str.endsWith("h")) return String(Number(str.slice(0, -1)) * 60);
  if (str.endsWith("m")) return str.slice(0, -1);
  if (str.endsWith("d")) return String(Number(str.slice(0, -1)) * 1440);
  return "5";
}

export default async function handler(request, response) {
  setCors(response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed." });

  const market = normalizeMarket(request.query.symbol || request.query.market || "NQ");
  const yahooSymbol = symbolMap[market] || "NQ=F";
  const interval = request.query.interval || "5m";
  const range = request.query.range || "1mo";
  const timeframeMinutes = intervalToMinutes(interval);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;

  try {
    const quoteResponse = await fetch(url, {
      headers: { "User-Agent": "TradePilot/1.0" },
    });
    const payload = await quoteResponse.json();
    const result = payload?.chart?.result?.[0];

    if (!result) {
      return response.status(502).json({ ok: false, error: "No chart data available." });
    }

    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const quote = result.indicators?.quote?.[0] || {};
    const opens = Array.isArray(quote.open) ? quote.open : [];
    const highs = Array.isArray(quote.high) ? quote.high : [];
    const lows = Array.isArray(quote.low) ? quote.low : [];
    const closes = Array.isArray(quote.close) ? quote.close : [];
    const volumes = Array.isArray(quote.volume) ? quote.volume : [];

    const candles = [];
    for (let i = 0; i < timestamps.length; i++) {
      const open = Number(opens[i]);
      const high = Number(highs[i]);
      const low = Number(lows[i]);
      const close = Number(closes[i]);
      if (![open, high, low, close].every(Number.isFinite)) continue;
      if (close <= 0) continue;
      candles.push({
        timestamp: new Date(timestamps[i] * 1000).toISOString(),
        open,
        high,
        low,
        close,
        volume: Number.isFinite(Number(volumes[i])) ? Number(volumes[i]) : null,
        timeframe: timeframeMinutes,
      });
    }

    return response.status(200).json({
      ok: true,
      market,
      interval,
      timeframe: timeframeMinutes,
      range,
      candles,
      count: candles.length,
    });
  } catch (error) {
    return response.status(502).json({ ok: false, error: error.message || "History unavailable." });
  }
}
