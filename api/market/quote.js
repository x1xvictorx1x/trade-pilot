const symbolMap = {
  ES: "ES=F",
  MES: "ES=F",
  MNQ: "NQ=F",
  NQ: "NQ=F",
  RTY: "RTY=F",
  YM: "YM=F",
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
  return upper;
}

export default async function handler(request, response) {
  setCors(response);
  if (request.method === "OPTIONS") return response.status(204).end();
  if (request.method !== "GET") return response.status(405).json({ ok: false, error: "Method not allowed." });

  const market = normalizeMarket(request.query.symbol || request.query.market || "NQ");
  const yahooSymbol = symbolMap[market] || "NQ=F";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1m`;

  try {
    const quoteResponse = await fetch(url, {
      headers: {
        "User-Agent": "TradePilot/1.0",
      },
    });
    const payload = await quoteResponse.json();
    const result = payload?.chart?.result?.[0];
    const meta = result?.meta || {};
    const quote = result?.indicators?.quote?.[0] || {};
    const closes = Array.isArray(quote.close) ? quote.close.filter(Number.isFinite) : [];
    const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
    const price = Number(meta.regularMarketPrice ?? closes.at(-1));

    if (!quoteResponse.ok || !Number.isFinite(price)) {
      return response.status(502).json({ ok: false, error: "Market quote unavailable." });
    }

    const bid = Number(meta.bid ?? price - 0.25);
    const ask = Number(meta.ask ?? price + 0.25);
    const timestamp = timestamps.length
      ? new Date(timestamps.at(-1) * 1000).toISOString()
      : new Date().toISOString();

    return response.status(200).json({
      ok: true,
      ask,
      bid,
      delayed: true,
      market,
      price,
      provider: "Yahoo Finance delayed futures quote",
      source: yahooSymbol,
      timestamp,
    });
  } catch (error) {
    return response.status(502).json({ ok: false, error: error.message || "Market quote unavailable." });
  }
}
