import { getLatestSignal, setCors } from "../_tradingview-store.js";

export default async function handler(req, res) {
  setCors(res);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  const signal = await getLatestSignal(symbol);

  return res.status(200).json({
    ok: true,
    signal,
    message: signal ? "Latest TradingView signal." : "Waiting for TradingView alert data.",
  });
}
