import { createClient } from "@supabase/supabase-js";

const latestBySymbol = globalThis.__tradePilotTradingViewAlerts || new Map();
globalThis.__tradePilotTradingViewAlerts = latestBySymbol;

const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    })
  : null;

export function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeSignal(payload = {}) {
  const symbol = String(payload.symbol || "").trim().toUpperCase();
  const price = toNumber(payload.price);
  if (!symbol || price === null) return { error: "Missing symbol or price" };

  const signal = {
    symbol,
    price,
    receivedAt: new Date().toISOString(),
    timestamp: payload.timestamp || new Date().toISOString(),
  };

  const support = toNumber(payload.support);
  const resistance = toNumber(payload.resistance);
  const entry = toNumber(payload.entry);
  const stop = toNumber(payload.stop);
  if (support !== null) signal.support = support;
  if (resistance !== null) signal.resistance = resistance;
  if (entry !== null) signal.entry = entry;
  if (stop !== null) signal.stop = stop;
  if (payload.bias) signal.bias = String(payload.bias).trim().toLowerCase();
  if (payload.timeframe) signal.timeframe = String(payload.timeframe).trim();
  if (payload.signal) signal.signal = String(payload.signal).trim().toLowerCase();
  if (payload.direction) signal.direction = String(payload.direction).trim().toLowerCase();
  const setupScore = toNumber(payload.setupScore);
  if (setupScore !== null) signal.setupScore = setupScore;
  if (payload.grade) signal.grade = String(payload.grade).trim().toUpperCase();

  const open = toNumber(payload.open);
  const high = toNumber(payload.high);
  const low = toNumber(payload.low);
  const closeValue = toNumber(payload.close);
  const volume = toNumber(payload.volume);
  const hasOhlc = open !== null && high !== null && low !== null && closeValue !== null;
  if (hasOhlc) {
    signal.candle = {
      open,
      high,
      low,
      close: closeValue,
      volume: volume ?? null,
      timeframe: signal.timeframe || null,
      timestamp: signal.timestamp,
    };
  }

  if (Array.isArray(payload.targets)) {
    signal.targets = payload.targets.map(toNumber).filter((value) => value !== null);
  } else if (payload.targets !== undefined && payload.targets !== null) {
    const targets = String(payload.targets)
      .split(",")
      .map((value) => toNumber(value.trim()))
      .filter((value) => value !== null);
    if (targets.length) signal.targets = targets;
  }

  return { signal };
}

export async function saveSignal(signal, rawPayload) {
  latestBySymbol.set(signal.symbol, signal);
  latestBySymbol.set("__latest", signal);

  if (!supabase) return { saved: false, storage: "memory" };

  const { error } = await supabase.from("tradingview_signals").insert({
    bias: signal.bias || null,
    entry: signal.entry ?? null,
    price: signal.price,
    raw_payload: rawPayload,
    resistance: signal.resistance ?? null,
    stop: signal.stop ?? null,
    support: signal.support ?? null,
    symbol: signal.symbol,
    targets: signal.targets || null,
    timeframe: signal.timeframe || null,
  });

  if (error) return { saved: false, storage: "memory", error: error.message };
  return { saved: true, storage: "supabase" };
}

export async function getLatestSignal(symbol = "") {
  if (supabase) {
    let query = supabase
      .from("tradingview_signals")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);
    if (symbol) query = query.eq("symbol", symbol);
    const { data, error } = await query;
    if (!error && data?.[0]) {
      const row = data[0];
      const raw = row.raw_payload || {};
      const candleOpen = toNumber(raw.open);
      const candleHigh = toNumber(raw.high);
      const candleLow = toNumber(raw.low);
      const candleClose = toNumber(raw.close);
      const candleVolume = toNumber(raw.volume);
      const candle = candleOpen !== null && candleHigh !== null && candleLow !== null && candleClose !== null
        ? {
            open: candleOpen,
            high: candleHigh,
            low: candleLow,
            close: candleClose,
            volume: candleVolume ?? null,
            timeframe: row.timeframe || raw.timeframe || null,
            timestamp: row.created_at,
          }
        : null;
      return {
        bias: row.bias,
        created_at: row.created_at,
        entry: row.entry,
        price: Number(row.price),
        resistance: row.resistance,
        stop: row.stop,
        support: row.support,
        symbol: row.symbol,
        targets: row.targets,
        timeframe: row.timeframe,
        timestamp: row.created_at,
        signal: raw.signal ? String(raw.signal).trim().toLowerCase() : null,
        direction: raw.direction ? String(raw.direction).trim().toLowerCase() : null,
        setupScore: toNumber(raw.setupScore),
        grade: raw.grade ? String(raw.grade).trim().toUpperCase() : null,
        candle,
      };
    }
  }

  return symbol ? latestBySymbol.get(symbol) || null : latestBySymbol.get("__latest") || null;
}
