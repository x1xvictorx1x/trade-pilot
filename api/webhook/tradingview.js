const latestBySymbol = globalThis.__tradePilotTradingViewAlerts || new Map();
globalThis.__tradePilotTradingViewAlerts = latestBySymbol;

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export default function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    const symbol = String(req.query.symbol || "").trim().toUpperCase();
    const alert = symbol ? latestBySymbol.get(symbol) : latestBySymbol.get("__latest");
    return res.status(200).json({
      connected: Boolean(alert),
      alert: alert || null,
      message: alert ? "Latest TradingView webhook data." : "Waiting for TradingView webhook data.",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  let payload;
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return res.status(400).json({ error: "TradingView webhook payload must be valid JSON." });
  }
  const symbol = String(payload.symbol || "").trim().toUpperCase();
  const price = toNumber(payload.price);

  if (!symbol || price === null) {
    return res.status(400).json({
      error: "TradingView webhook requires symbol and price.",
      required: ["symbol", "price"],
      optional: ["support", "resistance", "bias", "timeframe", "timestamp"],
    });
  }

  const alert = {
    symbol,
    price,
    receivedAt: new Date().toISOString(),
    timestamp: payload.timestamp || new Date().toISOString(),
  };

  const support = toNumber(payload.support);
  const resistance = toNumber(payload.resistance);
  if (support !== null) alert.support = support;
  if (resistance !== null) alert.resistance = resistance;
  if (payload.bias) alert.bias = String(payload.bias).trim().toLowerCase();
  if (payload.timeframe) alert.timeframe = String(payload.timeframe).trim();

  latestBySymbol.set(symbol, alert);
  latestBySymbol.set("__latest", alert);

  return res.status(200).json({
    accepted: true,
    alert,
    message: "TradingView webhook accepted.",
  });
}
