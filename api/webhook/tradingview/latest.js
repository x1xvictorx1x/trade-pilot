import { getLatestSignal, setCors } from "../_tradingview-store.js";

export default async function handler(req, res) {
  setCors(res);
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  let signal = await getLatestSignal(symbol);

  if (!signal) {
    try {
      const protocol = req.headers["x-forwarded-proto"] || "https";
      const host = req.headers.host;
      const query = symbol ? `?symbol=${encodeURIComponent(symbol)}` : "";
      const response = await fetch(`${protocol}://${host}/api/webhook/tradingview${query}`, {
        headers: { Accept: "application/json" },
      });
      const fallback = await response.json();
      signal = fallback.signal || fallback.alert || null;
    } catch (error) {
      console.warn("TradingView latest fallback failed", error.message);
    }
  }

  return res.status(200).json({
    ok: true,
    signal,
    message: signal ? "Latest TradingView signal." : "Waiting for TradingView alert data.",
  });
}
