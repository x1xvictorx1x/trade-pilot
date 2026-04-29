import { getLatestSignal, normalizeSignal, saveSignal, setCors } from "./_tradingview-store.js";

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    const symbol = String(req.query.symbol || "").trim().toUpperCase();
    const signal = await getLatestSignal(symbol);
    return res.status(200).json({
      ok: true,
      connected: Boolean(signal),
      signal,
      alert: signal,
      message: signal ? "Latest TradingView signal." : "Waiting for TradingView alert data.",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  let payload;
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  } catch {
    return res.status(400).json({ ok: false, error: "Payload must be valid JSON" });
  }

  console.log("TradingView webhook received", JSON.stringify(payload));

  const { signal, error } = normalizeSignal(payload);
  if (error) {
    return res.status(400).json({ ok: false, error });
  }

  const storage = await saveSignal(signal, payload);
  if (storage.error) console.warn("TradingView signal database save failed", storage.error);

  return res.status(200).json({
    ok: true,
    received: true,
    symbol: signal.symbol,
    price: signal.price,
    storage: storage.storage,
  });
}
