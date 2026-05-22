import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { isSupabaseConfigured, supabase } from "./supabaseClient";
import TradingChart from "./components/TradingChart.jsx";

const profileStorageKey = "tradePilotProfile";
const disciplineStorageKey = "tradePilotDiscipline";
const activePositionStorageKey = "tradePilotActivePosition";
const activeTradeStorageKey = "tradePilotActiveTrade";
const disclaimerStorageKey = "tradePilotDisclaimerAccepted";
const feedbackStorageKey = "tradePilotFeedback";
const supportStorageKey = "tradePilotSupportMessages";
const onboardingStorageKey = "tradePilotOnboardingComplete";
const streamerModeStorageKey = "tradePilotStreamerMode";
const debugModeStorageKey = "tradePilotDebugMode";
const subscriberStorageKey = "tradePilotSubscribers";
const journalStorageKey = "tradePilotJournal";
const layoutStorageKey = "tradePilotLayout";
const connectionSettingsStorageKey = "tradePilotConnectionSettings";
const watchlistStorageKey = "tradePilotWatchlist";
const installDismissedStorageKey = "tradePilotInstallDismissed";
const workspaceStorageKey = "tradePilotWorkspace";
const alertsStorageKey = "tradePilotAlerts";
const tradePlanStorageKey = "tradePilotTradePlan";
const autoZonesStorageKey = "tradePilotAutoZones";
const connectionModeStorageKey = "tradePilotConnectionMode";
const candleHistoryStorageKey = "tradePilotCandleHistory";
const notificationPrefsStorageKey = "tradePilotNotificationPrefs";
const chartTimeframeStorageKey = "tradePilotChartTimeframe";
const chartPrefsStorageKey = "tradePilotChartPrefs";

const defaultChartPrefs = {
  autoFit: true,
  lockPriceScale: false,
};

function loadChartPrefs() {
  try {
    const raw = localStorage.getItem(chartPrefsStorageKey);
    if (!raw) return { ...defaultChartPrefs };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...defaultChartPrefs };
    return { ...defaultChartPrefs, ...parsed };
  } catch {
    return { ...defaultChartPrefs };
  }
}

const CHART_TIMEFRAME_OPTIONS = [
  { value: "1", label: "1m" },
  { value: "2", label: "2m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1h" },
];

// How long a trade_setup signal stays valid per timeframe.
// After expiry the coach and plan show "no setup" for that timeframe.
const SIGNAL_EXPIRY_MS = {
  "1":  5  * 60 * 1000,
  "2":  10 * 60 * 1000,
  "5":  20 * 60 * 1000,
  "15": 45 * 60 * 1000,
  "30": 90 * 60 * 1000,
  "60": 3  * 60 * 60 * 1000,
};
function getSignalExpiryMs(timeframeValue) {
  const mins = String(Math.round(Math.max(1, Number(timeframeValue) || 1)));
  return SIGNAL_EXPIRY_MS[mins] ?? 30 * 60 * 1000;
}
function makeChartKey(symbol, timeframe) {
  return `${String(symbol || "").toUpperCase()}:${String(timeframe || "").trim()}`;
}

function parseTimeframeMinutes(value) {
  if (value === null || value === undefined) return 1;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return 1;
  const numeric = parseFloat(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (raw.endsWith("h")) return Math.round(numeric * 60);
    if (raw.endsWith("d")) return Math.round(numeric * 60 * 24);
    return Math.max(1, Math.round(numeric));
  }
  return 1;
}

function timeframeLabel(value) {
  const minutes = parseTimeframeMinutes(value);
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function aggregateCandles(candles, targetMinutes) {
  if (!Array.isArray(candles) || !candles.length) return [];
  const minutes = Math.max(1, Math.round(targetMinutes || 1));
  if (minutes <= 1) {
    return candles.map((candle) => ({ ...candle }));
  }
  const bucketMs = minutes * 60 * 1000;
  const buckets = new Map();
  for (const candle of candles) {
    const ts = new Date(candle.timestamp).getTime();
    if (!Number.isFinite(ts)) continue;
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    if (![open, high, low, close].every(Number.isFinite)) continue;
    const bucket = Math.floor(ts / bucketMs) * bucketMs;
    const existing = buckets.get(bucket);
    const volume = Number(candle.volume);
    if (!existing) {
      buckets.set(bucket, {
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : null,
        timeframe: String(minutes),
        timestamp: new Date(bucket).toISOString(),
      });
    } else {
      existing.high = Math.max(existing.high, high);
      existing.low = Math.min(existing.low, low);
      existing.close = close;
      if (Number.isFinite(volume)) existing.volume = (existing.volume ?? 0) + volume;
    }
  }
  return Array.from(buckets.values()).sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

// Acceptable distance of a candle high/low from currentPrice. Anything beyond
// this is treated as stale data from a previous symbol/session and rejected.
function getCandlePriceBand(symbol, timeframeMinutes, currentPrice) {
  const tf = Math.max(1, Math.round(Number(timeframeMinutes) || 1));
  const sym = String(symbol || "").toUpperCase();
  const tightTf = tf <= 5;
  if (!sym || sym === "NQ" || sym === "MNQ" || sym.startsWith("NQ") || sym.startsWith("MNQ")) {
    return tightTf ? 500 : 1000;
  }
  if (sym === "ES" || sym === "MES") return tightTf ? 80 : 160;
  if (sym === "YM" || sym === "MYM") return tightTf ? 1500 : 3000;
  if (sym === "RTY" || sym === "M2K") return tightTf ? 60 : 120;
  if (sym === "CL") return tightTf ? 4 : 8;
  if (sym === "GC") return tightTf ? 80 : 160;
  if (sym.startsWith("BTC")) return tightTf ? 4000 : 8000;
  if (sym.startsWith("ETH")) return tightTf ? 250 : 500;
  if (sym.startsWith("SOL")) return tightTf ? 15 : 30;
  if (sym.startsWith("XRP")) return tightTf ? 0.08 : 0.16;
  // Forex pairs
  if (sym === "XAUUSD" || sym === "XAGUSD") return tightTf ? 30 : 60;
  if (sym.includes("JPY") || sym.includes("HUF")) return tightTf ? 1.5 : 3;
  if (sym.length === 6 && /^[A-Z]{6}$/.test(sym)) return tightTf ? 0.01 : 0.02;
  // Stocks / custom — 5% of price (per spec).
  const px = Number(currentPrice);
  return Number.isFinite(px) && px > 0 ? Math.max(0.01, px * 0.05) : Infinity;
}

// Single candle validator. Returns true when OHLC is sane and the bar is
// within the realistic price band of currentPrice.
function isCandleRealistic(candle, { symbol, currentPrice, timeframeMinutes }) {
  if (!candle) return false;
  const open = Number(candle.open);
  const high = Number(candle.high);
  const low = Number(candle.low);
  const close = Number(candle.close);
  if (![open, high, low, close].every(Number.isFinite)) return false;
  if (high < low) return false;
  if (open < low - 1e-6 || open > high + 1e-6) return false;
  if (close < low - 1e-6 || close > high + 1e-6) return false;
  const cp = Number(currentPrice);
  if (!Number.isFinite(cp) || cp <= 0) return true;
  const band = getCandlePriceBand(symbol, timeframeMinutes, cp);
  if (!Number.isFinite(band)) return true;
  if (Math.abs(high - cp) > band) return false;
  if (Math.abs(low - cp) > band) return false;
  return true;
}

// Filter + telemetry. Returns { valid, rejected, reasons }.
// `reasons` aggregates the count of each rejection reason for debug surfaces.
function filterRealisticCandles(candles, options = {}) {
  const reasons = { broken_ohlc: 0, out_of_band: 0 };
  if (!Array.isArray(candles)) return { valid: [], rejected: 0, reasons };
  const valid = [];
  for (const candle of candles) {
    if (!candle) continue;
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    if (![open, high, low, close].every(Number.isFinite) || high < low
      || open < low - 1e-6 || open > high + 1e-6
      || close < low - 1e-6 || close > high + 1e-6) {
      reasons.broken_ohlc += 1;
      continue;
    }
    if (!isCandleRealistic(candle, options)) {
      reasons.out_of_band += 1;
      continue;
    }
    valid.push(candle);
  }
  return { valid, rejected: candles.length - valid.length, reasons };
}

// New York session anchor. RTH opens 9:30 NY. Returns the most recent 9:30 NY
// instant <= now. Server runs in any TZ; use Intl to convert.
function getRthSessionStart(now = Date.now()) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(now));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const year = get("year"), month = get("month"), day = get("day");
  const hour = get("hour"), minute = get("minute"), second = get("second");
  // Build "today 9:30 NY" by walking back from current NY clock.
  const minutesSinceNyMidnight = hour * 60 + minute + second / 60;
  const minutesSinceOpen = minutesSinceNyMidnight - (9 * 60 + 30);
  if (minutesSinceOpen >= 0) {
    return now - Math.round(minutesSinceOpen * 60_000);
  }
  // Before 9:30 NY today — most recent RTH session start was 9:30 NY yesterday.
  // today's 9:30 NY is `minutesUntilOpen` in the future; yesterday's is 24h before that.
  const minutesUntilOpen = -minutesSinceOpen;
  return now - Math.round((24 * 60 - minutesUntilOpen) * 60_000);
}

function getSessionAnchorMs({ now = Date.now(), candles = [] } = {}) {
  // Prefer RTH 9:30 NY today. If no candles fall inside that window (e.g.
  // overnight session with all timestamps before 9:30), fall back to the
  // most-recent contiguous-day boundary represented in the candles.
  const rth = getRthSessionStart(now);
  if (Array.isArray(candles) && candles.some((c) => {
    const ts = c?.timestamp ? new Date(c.timestamp).getTime() : NaN;
    return Number.isFinite(ts) && ts >= rth;
  })) return rth;
  const recent = Array.isArray(candles) ? candles.at(-1) : null;
  const lastMs = recent?.timestamp ? new Date(recent.timestamp).getTime() : NaN;
  if (Number.isFinite(lastMs)) return lastMs - 4 * 60 * 60 * 1000;
  return rth;
}

function pickFinestCandleSeries(history, symbol) {
  if (!history || typeof history !== "object") return [];
  const sym = String(symbol || "").trim().toUpperCase();
  if (!sym) return [];
  const matches = Object.entries(history).filter(
    ([key, value]) => Array.isArray(value) && value.length && (key === sym || key.startsWith(`${sym}|`)),
  );
  if (!matches.length) return [];
  matches.sort((a, b) => {
    const aTF = a[0].split("|")[1] || "";
    const bTF = b[0].split("|")[1] || "";
    return parseTimeframeMinutes(aTF) - parseTimeframeMinutes(bTF);
  });
  return matches[0][1];
}

const NOTIFY_CRITICAL = "critical";
const NOTIFY_IMPORTANT = "important";
const NOTIFY_INFO = "info";
const NOTIFY_THROTTLE_MS = 60_000;

const defaultNotificationPrefs = {
  toast: true,
  sound: true,
  priceUpdateAlerts: false,
  setupAlerts: true,
};

function isLocalDevHost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

async function safeFetch(url, options = {}, label = "request") {
  if (typeof url !== "string" || !url) {
    return { ok: false, error: `${label}: missing URL` };
  }
  // Block accidental cross-origin localhost calls in production.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url) && !isLocalDevHost()) {
    if (typeof console !== "undefined") {
      console.warn(`[TradePilot] Skipped ${label}: localhost URL not callable in production (${url})`);
    }
    return { ok: false, error: `${label} skipped: localhost endpoint not available in production`, skipped: true };
  }
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      if (typeof console !== "undefined") {
        console.warn(`[TradePilot] ${label} → ${url} → HTTP ${res.status}`);
      }
      return { ok: false, status: res.status, error: `${label} failed: ${res.status}`, url };
    }
    const text = await res.text();
    if (!text) return { ok: true, data: null };
    try {
      return { ok: true, data: JSON.parse(text), status: res.status };
    } catch {
      return { ok: true, data: text, status: res.status };
    }
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, aborted: true };
    if (typeof console !== "undefined") {
      console.warn(`[TradePilot] ${label} → ${url} → ${error?.message || "fetch error"}`);
    }
    return { ok: false, error: error?.message || `${label} failed`, url };
  }
}

function loadNotificationPrefs() {
  try {
    const raw = localStorage.getItem(notificationPrefsStorageKey);
    if (!raw) return { ...defaultNotificationPrefs };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...defaultNotificationPrefs };
    return { ...defaultNotificationPrefs, ...parsed };
  } catch {
    return { ...defaultNotificationPrefs };
  }
}

const MAX_CANDLES_PER_KEY = 300;
const SR_LOOKBACK_CANDLES = 100;

function candleHistoryKey(symbol, timeframe) {
  const sym = String(symbol || "").trim().toUpperCase();
  const tf = String(timeframe || "").trim();
  if (!sym) return "";
  return tf ? `${sym}|${tf}` : sym;
}

function loadCandleHistory() {
  try {
    const raw = localStorage.getItem(candleHistoryStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        out[key] = value
          .filter((candle) => candle && Number.isFinite(Number(candle.close)) && (candle.timestamp || candle.time))
          .slice(-MAX_CANDLES_PER_KEY);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function aggregatePriceTick(history, key, price, timestamp, timeframe) {
  if (!key || !Number.isFinite(Number(price))) return history;
  const numericPrice = Number(price);
  if (numericPrice <= 0) return history;
  const ts = timestamp ? new Date(timestamp).getTime() : Date.now();
  if (!Number.isFinite(ts)) return history;
  const bucketMs = 60 * 1000;
  const bucket = Math.floor(ts / bucketMs) * bucketMs;
  const existing = Array.isArray(history[key]) ? history[key] : [];
  const last = existing[existing.length - 1];
  // Reject obviously-bad ticks (>40% from last close) so a junk feed cannot
  // produce a giant block candle that ruins the chart auto-fit.
  if (last && Number.isFinite(Number(last.close)) && Number(last.close) > 0) {
    const drift = Math.abs(numericPrice - Number(last.close)) / Number(last.close);
    if (drift > 0.4) return history;
  }
  const lastBucket = last ? Math.floor(new Date(last.timestamp).getTime() / bucketMs) * bucketMs : null;
  if (last && lastBucket === bucket) {
    const updated = {
      ...last,
      high: Math.max(Number(last.high), numericPrice),
      low: Math.min(Number(last.low), numericPrice),
      close: numericPrice,
      synthetic: last.synthetic !== false,
    };
    const next = [...existing.slice(0, -1), updated];
    return { ...history, [key]: next };
  }
  const newCandle = {
    open: numericPrice,
    high: numericPrice,
    low: numericPrice,
    close: numericPrice,
    volume: null,
    timeframe: timeframe || "1",
    timestamp: new Date(bucket).toISOString(),
    synthetic: true,
  };
  let next = [...existing, newCandle];
  if (next.length > MAX_CANDLES_PER_KEY) next = next.slice(next.length - MAX_CANDLES_PER_KEY);
  return { ...history, [key]: next };
}

function appendCandle(history, key, candle) {
  if (!key || !candle) return history;
  const open = Number(candle.open);
  const high = Number(candle.high);
  const low = Number(candle.low);
  const close = Number(candle.close);
  if (![open, high, low, close].every(Number.isFinite)) return history;
  const ts = candle.timestamp ? new Date(candle.timestamp).getTime() : Date.now();
  if (!Number.isFinite(ts)) return history;
  const candleObj = {
    open,
    high,
    low,
    close,
    volume: Number.isFinite(Number(candle.volume)) ? Number(candle.volume) : null,
    timeframe: candle.timeframe || null,
    timestamp: new Date(ts).toISOString(),
  };
  const existing = Array.isArray(history[key]) ? history[key] : [];
  const last = existing[existing.length - 1];
  let next;
  if (last && new Date(last.timestamp).getTime() === ts) {
    next = [...existing.slice(0, -1), candleObj];
  } else {
    next = [...existing, candleObj];
  }
  if (next.length > MAX_CANDLES_PER_KEY) next = next.slice(next.length - MAX_CANDLES_PER_KEY);
  return { ...history, [key]: next };
}

function pickCandleSeries(history, symbol, timeframe) {
  if (!history || typeof history !== "object") return [];
  const exact = candleHistoryKey(symbol, timeframe);
  if (exact && Array.isArray(history[exact]) && history[exact].length) return history[exact];
  // If a specific timeframe was requested but no exact match exists, return
  // nothing — do not cross-contaminate 1m candles onto a 5m chart or vice versa.
  if (timeframe && String(timeframe).trim()) return [];
  const symbolOnly = candleHistoryKey(symbol);
  if (symbolOnly) {
    const matches = Object.entries(history)
      .filter(([key, value]) => Array.isArray(value) && value.length && (key === symbolOnly || key.startsWith(`${symbolOnly}|`)));
    if (matches.length) {
      matches.sort((a, b) => {
        const aLast = a[1][a[1].length - 1]?.timestamp || "";
        const bLast = b[1][b[1].length - 1]?.timestamp || "";
        return bLast.localeCompare(aLast);
      });
      return matches[0][1];
    }
  }
  return [];
}

function getMinZoneDistance(market, timeframeMinutes) {
  const tf = Math.max(1, Math.round(Number(timeframeMinutes) || 1));
  const sym = String(market || "").toUpperCase();
  // Tuned per timeframe: 1m=10, 2m=14, 5m=20, 15m=35. The previous floor
  // (1m=20) flagged "zones too compressed" on every routine NQ pullback.
  const nqDefault = tf >= 15 ? 35 : tf >= 5 ? 20 : tf >= 2 ? 14 : 10;
  if (!sym || sym === "NQ" || sym === "MNQ" || sym.startsWith("NQ") || sym.startsWith("MNQ")) {
    return nqDefault;
  }
  if (sym === "ES" || sym === "MES") return tf >= 15 ? 9 : tf >= 5 ? 5 : tf >= 2 ? 3.5 : 2.5;
  if (sym === "YM" || sym === "MYM") return tf >= 15 ? 140 : tf >= 5 ? 80 : tf >= 2 ? 55 : 40;
  if (sym === "RTY" || sym === "M2K") return tf >= 15 ? 6 : tf >= 5 ? 3.5 : tf >= 2 ? 2.5 : 1.8;
  if (sym === "CL") return tf >= 15 ? 0.35 : tf >= 5 ? 0.2 : tf >= 2 ? 0.14 : 0.1;
  if (sym === "GC") return tf >= 15 ? 9 : tf >= 5 ? 5 : tf >= 2 ? 3.5 : 2.5;
  if (sym.startsWith("BTC")) return tf >= 15 ? 280 : tf >= 5 ? 160 : tf >= 2 ? 110 : 75;
  if (sym.startsWith("ETH")) return tf >= 15 ? 18 : tf >= 5 ? 10 : tf >= 2 ? 7 : 5;
  if (sym.startsWith("SOL")) return tf >= 15 ? 2 : tf >= 5 ? 1.2 : tf >= 2 ? 0.8 : 0.5;
  if (sym.startsWith("XRP")) return tf >= 15 ? 0.008 : tf >= 5 ? 0.005 : tf >= 2 ? 0.003 : 0.002;
  if (sym === "SPY" || sym === "QQQ") return tf >= 15 ? 1.1 : tf >= 5 ? 0.7 : tf >= 2 ? 0.45 : 0.3;
  // Forex pairs
  if (sym === "XAUUSD" || sym === "XAGUSD") return tf >= 15 ? 8 : tf >= 5 ? 5 : tf >= 2 ? 3 : 2;
  if (sym.includes("JPY") || sym.includes("HUF")) return tf >= 15 ? 0.3 : tf >= 5 ? 0.18 : tf >= 2 ? 0.12 : 0.08;
  if (sym.length === 6 && /^[A-Z]{6}$/.test(sym)) return tf >= 15 ? 0.0025 : tf >= 5 ? 0.0015 : tf >= 2 ? 0.001 : 0.0006;
  // Stocks (generic) — ATR-based fallback handled by caller
  return nqDefault;
}

function validateZones({ supportZone, resistanceZone, currentPrice, market, timeframeMinutes }) {
  const price = Number(currentPrice);
  if (!supportZone || !resistanceZone || !Number.isFinite(price) || price <= 0) {
    return { valid: false, reason: "Insufficient data to detect zones." };
  }
  const supportCenter = Number(supportZone.center);
  const resistanceCenter = Number(resistanceZone.center);
  if (!Number.isFinite(supportCenter) || !Number.isFinite(resistanceCenter)) {
    return { valid: false, reason: "Invalid zone values." };
  }
  if (supportCenter >= price) {
    return { valid: false, reason: "Support is at or above current price." };
  }
  if (resistanceCenter <= price) {
    return { valid: false, reason: "Resistance is at or below current price." };
  }
  const minDist = getMinZoneDistance(market, timeframeMinutes);
  if (resistanceCenter - supportCenter < minDist) {
    return { valid: false, reason: `Zones too compressed (need ${minDist} pts on this timeframe).` };
  }
  return { valid: true, reason: "" };
}

// Single canonical zone engine.
// Input: raw candle array, currentPrice, timeframe (string|minutes), symbol
// Output: { supportZones, resistanceZones, activeSupport, activeResistance, valid, reason, ...telemetry }
function detectTradeZones(candleSeries, currentPrice, timeframe, symbol, options = {}) {
  const allCandles = Array.isArray(candleSeries) ? candleSeries : [];
  // Restrict to the current session when an anchor is supplied; otherwise cap
  // at the most recent 200 candles. Either way, never consume the entire
  // saved history (that's where the cross-session pollution came from).
  const sessionAnchorMs = Number.isFinite(Number(options.sessionAnchorMs))
    ? Number(options.sessionAnchorMs)
    : null;
  const sessionScoped = sessionAnchorMs !== null
    ? allCandles.filter((c) => {
        const ts = c?.timestamp ? new Date(c.timestamp).getTime() : NaN;
        return Number.isFinite(ts) && ts >= sessionAnchorMs;
      })
    : [];
  // Never fall back to cross-session candles when a session anchor is set.
  // Fewer than 20 session candles will trigger the "Waiting for more" early return below.
  const candles = sessionAnchorMs !== null
    ? sessionScoped.slice(-200)
    : allCandles.slice(-200);
  const market = String(symbol || "").toUpperCase();
  const tfMinutes = typeof timeframe === "number" ? timeframe : parseTimeframeMinutes(timeframe);
  const minDistance = getMinZoneDistance(market, tfMinutes);
  const refPrice = Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0
    ? Number(currentPrice)
    : Number(candles.at(-1)?.close);

  const empty = (reason) => ({
    supportZones: [],
    resistanceZones: [],
    activeSupport: null,
    activeResistance: null,
    sessionHigh: null,
    sessionLow: null,
    trend: "neutral",
    candleCount: candles.length,
    minDistance,
    valid: false,
    reason,
  });

  if (candles.length < 20) {
    return empty("Waiting for more candles to build structure.");
  }
  if (!Number.isFinite(refPrice) || refPrice <= 0) {
    return empty("No price reference yet.");
  }

  let highest = -Infinity;
  let lowest = Infinity;
  let rangeSum = 0;
  let rangeCount = 0;
  // Skip the LAST candle (still forming) — never let the current bar drive structure.
  const stable = candles.slice(0, -1);
  for (const c of stable) {
    if (Number.isFinite(c.high) && c.high > highest) highest = c.high;
    if (Number.isFinite(c.low) && c.low < lowest) lowest = c.low;
    if (Number.isFinite(c.high) && Number.isFinite(c.low)) {
      rangeSum += c.high - c.low;
      rangeCount += 1;
    }
  }
  if (!Number.isFinite(highest) || !Number.isFinite(lowest)) {
    return empty("No usable highs/lows in candle history.");
  }
  const sessionRange = Math.max(highest - lowest, 0.0001);
  const avgCandleRange = rangeCount > 0 ? rangeSum / rangeCount : sessionRange / 20;

  // 5-bar swing pivots — stricter than 3-bar to reduce duplicates.
  const swingHighs = [];
  const swingLows = [];
  for (let i = 2; i < stable.length - 2; i += 1) {
    const c = stable[i];
    if (!Number.isFinite(c.high) || !Number.isFinite(c.low)) continue;
    const prev1 = stable[i - 1], prev2 = stable[i - 2];
    const next1 = stable[i + 1], next2 = stable[i + 2];
    if (c.high >= prev1.high && c.high >= prev2.high && c.high >= next1.high && c.high >= next2.high) {
      swingHighs.push({ price: c.high, idx: i });
    }
    if (c.low <= prev1.low && c.low <= prev2.low && c.low <= next1.low && c.low <= next2.low) {
      swingLows.push({ price: c.low, idx: i });
    }
  }

  // Cluster swings that are within minDistance — collapses duplicate zones.
  const cluster = (points) => {
    if (!points.length) return [];
    const sorted = [...points].sort((a, b) => a.price - b.price);
    const clusters = [];
    for (const p of sorted) {
      const last = clusters.at(-1);
      if (last && p.price - last.center <= minDistance) {
        last.touches += 1;
        last.minPrice = Math.min(last.minPrice, p.price);
        last.maxPrice = Math.max(last.maxPrice, p.price);
        last.center = (last.minPrice + last.maxPrice) / 2;
      } else {
        clusters.push({ center: p.price, minPrice: p.price, maxPrice: p.price, touches: 1 });
      }
    }
    return clusters;
  };

  const highClusters = cluster(swingHighs);
  const lowClusters = cluster(swingLows);

  const zoneHalfWidth = Math.max(avgCandleRange * 0.5, minDistance * 0.15);
  const buildZone = (c) => ({
    min: Number((c.minPrice - zoneHalfWidth).toFixed(4)),
    max: Number((c.maxPrice + zoneHalfWidth).toFixed(4)),
    center: Number(c.center.toFixed(4)),
    touches: c.touches,
  });

  // Resistance must be ABOVE price; support must be BELOW price.
  const resistanceZones = highClusters
    .filter((c) => c.center > refPrice + minDistance * 0.25)
    .map(buildZone)
    .sort((a, b) => a.center - b.center); // nearest first
  const supportZones = lowClusters
    .filter((c) => c.center < refPrice - minDistance * 0.25)
    .map(buildZone)
    .sort((a, b) => b.center - a.center); // nearest first

  const activeSupport = supportZones[0] || null;
  const activeResistance = resistanceZones[0] || null;

  // Trend (simple split-half mean comparison)
  const half = Math.floor(stable.length / 2);
  const avg = (arr) => arr.reduce((sum, c) => sum + ((c.high + c.low) / 2), 0) / Math.max(1, arr.length);
  const firstAvg = avg(stable.slice(0, half));
  const secondAvg = avg(stable.slice(half));
  let trend = "neutral";
  if (secondAvg > firstAvg + sessionRange * 0.05) trend = "bullish";
  else if (secondAvg < firstAvg - sessionRange * 0.05) trend = "bearish";

  if (!activeSupport && !activeResistance) {
    return {
      supportZones,
      resistanceZones,
      activeSupport,
      activeResistance,
      sessionHigh: highest,
      sessionLow: lowest,
      trend,
      candleCount: candles.length,
      minDistance,
      valid: false,
      reason: "No valid support detected yet. No valid resistance detected yet.",
    };
  }
  if (!activeResistance) {
    return {
      supportZones,
      resistanceZones,
      activeSupport,
      activeResistance,
      sessionHigh: highest,
      sessionLow: lowest,
      trend,
      candleCount: candles.length,
      minDistance,
      valid: false,
      reason: "No valid resistance detected yet.",
    };
  }
  if (!activeSupport) {
    return {
      supportZones,
      resistanceZones,
      activeSupport,
      activeResistance,
      sessionHigh: highest,
      sessionLow: lowest,
      trend,
      candleCount: candles.length,
      minDistance,
      valid: false,
      reason: "No valid support detected yet.",
    };
  }
  if (activeResistance.center - activeSupport.center < minDistance) {
    return {
      supportZones,
      resistanceZones,
      activeSupport,
      activeResistance,
      sessionHigh: highest,
      sessionLow: lowest,
      trend,
      candleCount: candles.length,
      minDistance,
      valid: false,
      reason: `Zones too compressed (need ${minDistance} pts on this timeframe).`,
    };
  }

  return {
    supportZones,
    resistanceZones,
    activeSupport,
    activeResistance,
    sessionHigh: highest,
    sessionLow: lowest,
    trend,
    candleCount: candles.length,
    minDistance,
    valid: true,
    reason: "",
  };
}

// Backwards-compatible wrapper used by enrichedZoneDetection.
function detectAutoSRZones(candleSeries, options = {}) {
  const { currentPrice, market, timeframeMinutes, sessionAnchorMs } = options;
  const result = detectTradeZones(candleSeries, currentPrice, timeframeMinutes, market, { sessionAnchorMs });
  return {
    supportZone: result.activeSupport,
    resistanceZone: result.activeResistance,
    supportZones: result.supportZones,
    resistanceZones: result.resistanceZones,
    sessionHigh: result.sessionHigh,
    sessionLow: result.sessionLow,
    trend: result.trend,
    candleCount: result.candleCount,
    zonesValid: result.valid,
    zoneReason: result.reason,
    compressed: result.reason.startsWith("Zones too compressed"),
  };
}

const defaultProfile = {
  traderName: "",
  accountSize: 50000,
  accountType: "Personal Trading Account",
  accountPhase: "evaluation",
  consistencyRuleTarget: 30,
  fundedPlatform: "Manual Mode",
  fundedProvider: "None",
  profitGoal: 3000,
  startingBalance: 50000,
  trailingDrawdown: 2500,
  mainMarket: "MNQ",
  autoSwitchSymbol: true,
  traderExperienceLevel: "intermediate",
  traderStyle: "scalper",
  maxDailyLoss: 500,
  maxTradesPerDay: 5,
  maxContracts: 5,
  maxRiskPerTrade: 100,
  defaultContracts: 1,
  defaultRiskPoints: 10,
  trim1Points: 10,
  trim2Points: 20,
  runnerPoints: 35,
  voiceAlerts: true,
  soundAlerts: true,
};

const pointValues = {
  MNQ: 2,
  NQ: 20,
  ES: 50,
  MES: 5,
  YM: 5,
  MYM: 0.5,
  RTY: 50,
  M2K: 5,
  CL: 1000,
  GC: 100,
  BTC: 1,
  ETH: 1,
  SPY: 1,
  QQQ: 1,
  CUSTOM: 1,
};

const customMarketSpec = { displayName: "Custom Market", pointValue: 1, tickSize: 0.01, marketType: "custom" };

const futuresSymbolMap = {
  NQ: "NQ", "NQ1!": "NQ",
  MNQ: "MNQ", "MNQ1!": "MNQ",
  ES: "ES", "ES1!": "ES",
  MES: "MES", "MES1!": "MES",
  YM: "YM", "YM1!": "YM",
  MYM: "MYM", "MYM1!": "MYM",
  RTY: "RTY", "RTY1!": "RTY",
  M2K: "M2K", "M2K1!": "M2K",
  CL: "CL", "CL1!": "CL",
  GC: "GC", "GC1!": "GC",
  BTC: "BTC", "BTC1!": "BTC",
  ETH: "ETH", "ETH1!": "ETH",
  SPY: "SPY",
  QQQ: "QQQ",
};

function resolveMarketFromSymbol(symbol = "", fallback = "MNQ") {
  const raw = String(symbol || "").trim().toUpperCase();
  if (!raw) {
    const spec = marketSpecs[fallback] || customMarketSpec;
    return { market: fallback, symbol: fallback, marketType: spec.category || "futures", spec };
  }
  // Known symbol in our spec table
  if (marketSpecs[raw]) {
    return { market: raw, symbol: raw, marketType: marketSpecs[raw].category || "stock", spec: marketSpecs[raw] };
  }
  // Futures alias map (e.g. "NQ1!" → "NQ")
  if (futuresSymbolMap[raw]) {
    const code = futuresSymbolMap[raw];
    return { market: code, symbol: raw, marketType: "futures", spec: marketSpecs[code] || customMarketSpec };
  }
  for (const key of Object.keys(futuresSymbolMap)) {
    if (raw.startsWith(key)) {
      const code = futuresSymbolMap[key];
      return { market: code, symbol: raw, marketType: "futures", spec: marketSpecs[code] || customMarketSpec };
    }
  }
  // Dynamic category detection for unlisted symbols
  const cat = getMarketCategory(raw);
  return { market: raw, symbol: raw, marketType: cat, spec: customMarketSpec };
}

function specForMarket(market) {
  if (market && marketSpecs[market]) return marketSpecs[market];
  return customMarketSpec;
}

const marketDefaults = {
  MNQ: 21000,
  NQ: 21000,
  ES: 5800,
  MES: 5800,
  YM: 43000,
  MYM: 43000,
  RTY: 2100,
  M2K: 2100,
  CL: 75,
  GC: 2400,
  BTC: 100000,
  ETH: 3500,
  SPY: 580,
  QQQ: 480,
  // Crypto spot pairs
  BTCUSDT: 100000,
  ETHUSDT: 3500,
  SOLUSDT: 180,
  XRPUSDT: 0.6,
  // Forex major pairs
  EURUSD: 1.0850,
  GBPUSD: 1.2700,
  USDJPY: 155.00,
  AUDUSD: 0.6500,
  USDCAD: 1.3600,
  USDCHF: 0.9000,
  NZDUSD: 0.6000,
  XAUUSD: 2400,
  // Common stocks
  AAPL: 210,
  TSLA: 250,
  NVDA: 900,
  MSFT: 420,
  AMZN: 190,
  GOOGL: 170,
  META: 500,
  AMD: 165,
};

function normalizeFuturesSymbol(symbol = "") {
  const clean = String(symbol || "").toUpperCase();
  if (!clean) return "MNQ";
  if (clean.includes("MNQ")) return "MNQ";
  if (clean.includes("MES")) return "MES";
  if (clean.includes("NQ")) return "NQ";
  if (clean.includes("ES")) return "ES";
  if (clean.includes("MYM")) return "MYM";
  if (clean.includes("YM")) return "YM";
  if (clean.includes("M2K")) return "M2K";
  if (clean.includes("RTY")) return "RTY";
  if (clean.includes("BTC")) return "BTC";
  if (clean.includes("ETH")) return "ETH";
  if (clean.includes("CL")) return "CL";
  if (clean.includes("GC")) return "GC";
  return clean;
}

const markets = Object.keys(marketDefaults);
const marketSpecs = {
  // Futures
  MNQ: { displayName: "Micro Nasdaq 100", pointValue: 2, tickSize: 0.25, category: "futures" },
  NQ:  { displayName: "Nasdaq 100",       pointValue: 20, tickSize: 0.25, category: "futures" },
  ES:  { displayName: "S&P 500",          pointValue: 50, tickSize: 0.25, category: "futures" },
  MES: { displayName: "Micro S&P 500",    pointValue: 5,  tickSize: 0.25, category: "futures" },
  YM:  { displayName: "Dow Futures",      pointValue: 5,  tickSize: 1,    category: "futures" },
  MYM: { displayName: "Micro Dow",        pointValue: 0.5,tickSize: 1,    category: "futures" },
  RTY: { displayName: "Russell 2000",     pointValue: 50, tickSize: 0.1,  category: "futures" },
  M2K: { displayName: "Micro Russell",    pointValue: 5,  tickSize: 0.1,  category: "futures" },
  CL:  { displayName: "Crude Oil",        pointValue: 1000,tickSize: 0.01,category: "futures" },
  GC:  { displayName: "Gold Futures",     pointValue: 100, tickSize: 0.1, category: "futures" },
  BTC: { displayName: "Bitcoin (Futures)",pointValue: 1,  tickSize: 0.01, category: "crypto"  },
  ETH: { displayName: "Ether (Futures)",  pointValue: 1,  tickSize: 0.01, category: "crypto"  },
  // ETFs / Stocks
  SPY: { displayName: "SPY ETF",          pointValue: 1, tickSize: 0.01,  category: "stock"   },
  QQQ: { displayName: "QQQ ETF",          pointValue: 1, tickSize: 0.01,  category: "stock"   },
  AAPL:{ displayName: "Apple Inc.",       pointValue: 1, tickSize: 0.01,  category: "stock"   },
  TSLA:{ displayName: "Tesla Inc.",       pointValue: 1, tickSize: 0.01,  category: "stock"   },
  NVDA:{ displayName: "NVIDIA Corp.",     pointValue: 1, tickSize: 0.01,  category: "stock"   },
  MSFT:{ displayName: "Microsoft Corp.",  pointValue: 1, tickSize: 0.01,  category: "stock"   },
  AMZN:{ displayName: "Amazon.com",       pointValue: 1, tickSize: 0.01,  category: "stock"   },
  GOOGL:{ displayName: "Alphabet Inc.",   pointValue: 1, tickSize: 0.01,  category: "stock"   },
  META:{ displayName: "Meta Platforms",   pointValue: 1, tickSize: 0.01,  category: "stock"   },
  AMD: { displayName: "AMD Inc.",         pointValue: 1, tickSize: 0.01,  category: "stock"   },
  // Crypto spot pairs
  BTCUSDT: { displayName: "Bitcoin/USDT", pointValue: 1, tickSize: 0.01, category: "crypto"   },
  ETHUSDT: { displayName: "Ether/USDT",   pointValue: 1, tickSize: 0.01, category: "crypto"   },
  SOLUSDT: { displayName: "Solana/USDT",  pointValue: 1, tickSize: 0.001,category: "crypto"   },
  XRPUSDT: { displayName: "XRP/USDT",     pointValue: 1, tickSize: 0.0001,category: "crypto"  },
  // Forex pairs
  EURUSD: { displayName: "EUR/USD",       pointValue: 1, tickSize: 0.00001, category: "forex"  },
  GBPUSD: { displayName: "GBP/USD",       pointValue: 1, tickSize: 0.00001, category: "forex"  },
  USDJPY: { displayName: "USD/JPY",       pointValue: 1, tickSize: 0.001,   category: "forex"  },
  AUDUSD: { displayName: "AUD/USD",       pointValue: 1, tickSize: 0.00001, category: "forex"  },
  USDCAD: { displayName: "USD/CAD",       pointValue: 1, tickSize: 0.00001, category: "forex"  },
  USDCHF: { displayName: "USD/CHF",       pointValue: 1, tickSize: 0.00001, category: "forex"  },
  NZDUSD: { displayName: "NZD/USD",       pointValue: 1, tickSize: 0.00001, category: "forex"  },
  XAUUSD: { displayName: "Gold (Spot)",   pointValue: 1, tickSize: 0.01,    category: "forex"  },
};

// Market category presets for the market selector UI
const MARKET_CATEGORIES = {
  futures: { label: "Futures",  symbols: ["NQ","MNQ","ES","MES","YM","MYM","RTY","M2K","CL","GC"] },
  stock:   { label: "Stocks",   symbols: ["SPY","QQQ","AAPL","TSLA","NVDA","MSFT","AMZN","GOOGL","META","AMD"] },
  crypto:  { label: "Crypto",   symbols: ["BTC","ETH","BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT"] },
  forex:   { label: "Forex",    symbols: ["EURUSD","XAUUSD","GBPUSD","USDJPY","AUDUSD","USDCAD","USDCHF","NZDUSD"] },
};

function getMarketCategory(symbol) {
  const sym = String(symbol || "").toUpperCase();
  if (marketSpecs[sym]) return marketSpecs[sym].category || "stock";
  if (sym.endsWith("USDT") || sym.endsWith("USDC") || sym.endsWith("BTC") || sym.endsWith("ETH")) return "crypto";
  if (sym.length === 6 && /^[A-Z]{6}$/.test(sym)) return "forex";
  if (sym === "XAUUSD" || sym === "XAGUSD" || sym === "XPTUSD") return "forex";
  return "stock";
}

function formatPrice(value, symbol) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "—";
  const cat = getMarketCategory(symbol);
  if (cat === "forex") {
    const sym = String(symbol || "").toUpperCase();
    if (sym.includes("JPY") || sym.includes("HUF")) return num.toFixed(3);
    if (sym === "XAUUSD" || sym === "XAGUSD") return num.toFixed(2);
    return num.toFixed(5);
  }
  return num.toFixed(2);
}
const dataSources = ["Manual Mode", "TradingView Webhook", "CSV Import", "Demo Broker", "Market Data API"];
const accountTypeOptions = ["Personal Trading Account", "Funded / Prop Firm Account", "Demo / Practice Account"];
const fundedProviders = ["None", "Lucid Trading", "Apex", "Topstep", "Take Profit Trader", "MyFundedFutures", "Bulenox", "Earn2Trade", "Other"];
const fundedPlatforms = ["Manual Mode", "TradingView Webhook", "Rithmic", "TopstepX", "CSV Import", "Other"];
const navigationTabs = ["Home", "Dashboard", "Journal", "Account"];
const moreTabs = ["Profile", "Settings", "Connections", "Indicator", "Install", "Help", "Support", "QA"];
const authRedirectUrl = "https://tradepilottool.com";
const marketServerUrl = "http://127.0.0.1:8787";
const brokerSamplePayload = {
  platform: "Demo Broker",
  accountId: "SIM-001",
  accountBalance: 50000,
  symbol: "MNQ",
  price: 27462,
  bid: 27461.75,
  ask: 27462.25,
  openPnl: 14,
  realizedPnl: 0,
  position: {
    symbol: "MNQ",
    direction: "long",
    quantity: 1,
    averagePrice: 27455,
    openPnl: 14,
    stop: 27435,
    target: 27495,
  },
  workingOrders: [
    {
      id: "demo-stop-1",
      symbol: "MNQ",
      side: "sell",
      quantity: 1,
      price: 27435,
      type: "stop",
    },
  ],
  fills: [
    {
      id: "demo-fill-1",
      symbol: "MNQ",
      side: "buy",
      quantity: 1,
      price: 27455,
    },
  ],
};


function normalizeAccountType(value) {
  if (value === "funded" || value === "prop" || value === "both" || value === "Funded/prop account") return "Funded / Prop Firm Account";
  if (value === "Demo broker" || value === "demo" || value === "Demo / Practice Account") return "Demo / Practice Account";
  return "Personal Trading Account";
}

function isFundedAccountType(value) {
  return normalizeAccountType(value) === "Funded / Prop Firm Account";
}

const tooltipText = {
  currentPrice: "Current Price = the latest price Trade Pilot is using for calculations.",
  support: "Support = a price area where buyers historically defend and price may bounce.",
  resistance: "Resistance = a price area where sellers historically defend and price may reject.",
  entry: "Entry = the price where you plan to enter the trade.",
  riskPoints: "Risk Points = how many points you are willing to lose before exiting.",
  contracts: "Contracts = how many contracts or shares you are using for the trade.",
  recommendedStop: "Recommended Stop = the suggested exit price if the trade moves against you.",
  trim1: "Trim 1 = your first profit-taking level.",
  trim2: "Trim 2 = your second profit-taking level.",
  runner: "Runner = the final piece you hold for a bigger move.",
  marketBias: "Market Bias = Trade Pilot's read on whether price favors long, short, or waiting.",
  tradeScore: "Trade Score = a 0-100 execution quality read based on location, risk/reward, size, bias, and chop.",
  breakout: "Breakout = price pushing through a key level, usually resistance for longs or support for shorts.",
  pullback: "Pullback = price returning toward support or a breakout area after a move.",
  retest: "Retest = price comes back to check whether a broken level will now hold.",
  stopLoss: "Stop Loss = the planned price where the trade idea is wrong and you exit.",
  target: "Target = the planned area where you take profit.",
};

const todayKey = () => new Date().toISOString().slice(0, 10);

function loadProfile() {
  try {
    const saved = localStorage.getItem(profileStorageKey);
    const profile = saved ? { ...defaultProfile, ...JSON.parse(saved) } : defaultProfile;
    profile.accountType = normalizeAccountType(profile.accountType);
    if (!fundedProviders.includes(profile.fundedProvider)) profile.fundedProvider = defaultProfile.fundedProvider;
    if (!fundedPlatforms.includes(profile.fundedPlatform)) profile.fundedPlatform = defaultProfile.fundedPlatform;
    return profile;
  } catch {
    return defaultProfile;
  }
}

function loadDiscipline() {
  const fallback = { date: todayKey(), tradesTaken: 0, dailyPnl: 0 };

  try {
    const saved = localStorage.getItem(disciplineStorageKey);
    const parsed = saved ? JSON.parse(saved) : fallback;
    return parsed.date === todayKey() ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function loadActivePosition() {
  try {
    const saved = localStorage.getItem(activePositionStorageKey);
    return safeJsonParse(saved, null);
  } catch {
    return null;
  }
}

function defaultActiveTrade(overrides = {}) {
  return {
    contracts: 0,
    currentPrice: 0,
    direction: "long",
    entry: 0,
    isActive: false,
    market: "NQ",
    openedAt: "",
    realizedPL: 0,
    runner: 0,
    source: "manual",
    status: "waiting_entry",
    stop: 0,
    tp1: 0,
    tp2: 0,
    unrealizedPL: 0,
    ...overrides,
  };
}

function normalizeActiveTrade(raw) {
  const trade = raw && typeof raw === "object" ? raw : {};
  const direction = trade.direction === "short" ? "short" : "long";
  return defaultActiveTrade({
    ...trade,
    contracts: safeNumber(trade.contracts, trade.quantity, 0),
    currentPrice: safeNumber(trade.currentPrice, trade.price, 0),
    direction,
    entry: safeNumber(trade.entry, trade.averagePrice, 0),
    isActive: Boolean(trade.isActive),
    market: normalizeFuturesSymbol(trade.market || trade.symbol || "NQ"),
    realizedPL: safeNumber(trade.realizedPL, trade.realizedPnl, 0),
    runner: safeNumber(trade.runner, trade.target, 0),
    status: trade.status || (trade.isActive ? "active" : "waiting_entry"),
    stop: safeNumber(trade.stop, 0),
    tp1: safeNumber(trade.tp1, trade.trim1, 0),
    tp2: safeNumber(trade.tp2, trade.trim2, 0),
    unrealizedPL: safeNumber(trade.unrealizedPL, trade.openPnl, 0),
  });
}

function activeTradeFromPlan(plan, { currentPrice, market, source = "manual", status = "active" } = {}) {
  if (!plan || plan.direction === "none") return defaultActiveTrade({ currentPrice, market, source });
  const normalized = normalizeTradePlan(plan);
  const spec = marketSpecs[market] || customMarketSpec;
  const livePrice = safeNumber(currentPrice, normalized.entry, 0);
  const contracts = safeNumber(normalized.contracts, 1);
  const points = normalized.direction === "short" ? normalized.entry - livePrice : livePrice - normalized.entry;
  return normalizeActiveTrade({
    contracts,
    currentPrice: livePrice,
    direction: normalized.direction,
    entry: normalized.entry,
    isActive: status !== "waiting_entry" && status !== "closed",
    market,
    openedAt: plan.openedAt || new Date().toISOString(),
    realizedPL: 0,
    runner: normalized.runner,
    source,
    status,
    stop: normalized.stop,
    tp1: normalized.trim1,
    tp2: normalized.trim2,
    unrealizedPL: points * spec.pointValue * contracts,
  });
}

function updateActiveTradeProgress(trade, currentPrice, market) {
  const current = normalizeActiveTrade(trade);
  if (!current.isActive && current.status !== "waiting_entry") {
    return { ...current, currentPrice: safeNumber(currentPrice, current.currentPrice), market: market || current.market };
  }
  const livePrice = safeNumber(currentPrice, current.currentPrice, current.entry);
  const spec = marketSpecs[market || current.market] || customMarketSpec;
  const points = current.direction === "short" ? current.entry - livePrice : livePrice - current.entry;
  const hit = (target) => Number.isFinite(Number(target)) && Number(target) > 0 && (current.direction === "short" ? livePrice <= Number(target) : livePrice >= Number(target));
  const stopHit = Number(current.stop) > 0 && (current.direction === "short" ? livePrice >= Number(current.stop) : livePrice <= Number(current.stop));
  let status = current.status || "waiting_entry";
  if (stopHit) status = "closed";
  else if (hit(current.runner)) status = "runner";
  else if (hit(current.tp2)) status = "tp2_hit";
  else if (hit(current.tp1)) status = "tp1_hit";
  else if (current.isActive) status = "active";
  return {
    ...current,
    currentPrice: livePrice,
    isActive: status !== "closed" && current.isActive,
    market: market || current.market,
    status,
    unrealizedPL: points * spec.pointValue * Math.max(1, current.contracts),
  };
}

function loadActiveTrade() {
  try {
    return normalizeActiveTrade(safeJsonParse(localStorage.getItem(activeTradeStorageKey), null));
  } catch {
    return defaultActiveTrade();
  }
}

function loadList(key) {
  return safeArray(safeJsonParse(localStorage.getItem(key), []));
}

function safeJsonParse(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

const defaultLayout = {
  alerts: true,
  chart: true,
  coach: true,
  connections: true,
  fastMode: true,
  journal: true,
  mode: "Pro",
  performanceStats: true,
  propFirmRules: true,
  risk: true,
  score: true,
  tradePlan: true,
  watchlist: true,
  // Chart is the hero — coach + plan immediately under it, then risk/journal/etc.
  cardOrder: ["chart", "coach", "tradePlan", "risk", "propFirmRules", "performanceStats", "watchlist", "alerts", "journal"],
};

const dashboardCardOptions = [
  ["coach", "Trade Coach"],
  ["tradePlan", "Trade Plan"],
  ["chart", "Chart"],
  ["risk", "Risk Guard"],
  ["propFirmRules", "Prop Firm Rules"],
  ["journal", "Journal"],
  ["watchlist", "Watchlist"],
  ["alerts", "Alerts"],
  ["performanceStats", "Performance Stats"],
];

const cardKeyAliases = {
  tradeCoach: "coach",
  riskGuard: "risk",
};

function normalizeCardKey(key) {
  return cardKeyAliases[key] || key;
}

function normalizeCardList(value, fallback = defaultLayout.cardOrder) {
  const allowed = new Set(dashboardCardOptions.map(([key]) => key));
  const normalized = safeArray(value)
    .map(normalizeCardKey)
    .filter((key) => allowed.has(key));
  return normalized.length ? Array.from(new Set(normalized)) : fallback;
}

function normalizeWatchlistItems(value, fallbackMarket = "NQ") {
  const items = safeArray(value)
    .map((item) => {
      if (typeof item === "string") return { id: item, notes: "Watching", symbol: item };
      if (!item || typeof item !== "object") return null;
      const symbol = item.symbol || item.market || item.name;
      return symbol ? { id: item.id || symbol, notes: item.notes || "Watching", symbol } : null;
    })
    .filter(Boolean);
  return items.length ? items : [{ id: fallbackMarket, notes: "Primary market", symbol: fallbackMarket }];
}

function defaultWorkspace() {
  return {
    activeConnection: "manual",
    alerts: [],
    autoZones: {
      openRangeHigh: null,
      openRangeLow: null,
      repeatedRejectionHighs: [],
      repeatedRejectionLows: [],
      resistance: null,
      sessionHigh: null,
      sessionLow: null,
      support: null,
      swingHighs: [],
      swingLows: [],
    },
    cardOrder: defaultLayout.cardOrder,
    journalEntries: [],
    layout: "Pro",
    layoutPrefs: defaultLayout,
    selectedMarket: "NQ",
    tradeHistory: [],
    tradePlan: null,
    version: 2,
    visibleCards: defaultLayout.cardOrder,
    watchlist: [{ id: "NQ", notes: "Primary market", symbol: "NQ" }],
    webhookSignal: null,
  };
}

function migrateWorkspace(raw) {
  const defaults = defaultWorkspace();
  const workspace = raw && typeof raw === "object" ? raw : {};
  const fromVersion = Number(workspace.version || 0);
  const rawLayoutPrefs = workspace.layoutPrefs || workspace.preferred_layout || workspace.layoutSettings || {};
  const visibleCards = normalizeCardList(workspace.visibleCards, defaults.visibleCards);
  const cardOrder = normalizeCardList(workspace.cardOrder || rawLayoutPrefs.cardOrder, defaults.cardOrder);
  const autoZones = workspace.autoZones || {};
  const selectedMarket = workspace.selectedMarket || workspace.market || rawLayoutPrefs.selected_market || defaults.selectedMarket;
  const migrated = {
    ...defaults,
    ...workspace,
    activeConnection: workspace.activeConnection || workspace.connectionMode || defaults.activeConnection,
    alerts: safeArray(workspace.alerts),
    autoZones: {
      ...defaults.autoZones,
      ...autoZones,
      repeatedRejectionHighs: safeArray(autoZones.repeatedRejectionHighs),
      repeatedRejectionLows: safeArray(autoZones.repeatedRejectionLows),
      swingHighs: safeArray(autoZones.swingHighs),
      swingLows: safeArray(autoZones.swingLows),
    },
    cardOrder,
    journalEntries: safeArray(workspace.journalEntries || workspace.tradeJournal),
    layout: workspace.layout || rawLayoutPrefs.mode || defaults.layout,
    layoutPrefs: {
      ...defaultLayout,
      ...rawLayoutPrefs,
      cardOrder,
      mode: workspace.layout || rawLayoutPrefs.mode || defaults.layout,
    },
    selectedMarket,
    tradeHistory: safeArray(workspace.tradeHistory),
    tradePlan: workspace.tradePlan || workspace.plannedTrade || null,
    version: 2,
    visibleCards,
    watchlist: normalizeWatchlistItems(workspace.watchlist, selectedMarket),
    webhookSignal: workspace.webhookSignal || null,
  };
  if (fromVersion !== 2 && import.meta.env.DEV) {
    console.warn("Migrated old workspace state", { fromVersion, toVersion: 2 });
  }
  return migrated;
}

function loadMigratedWorkspace() {
  const rawWorkspace = safeJsonParse(localStorage.getItem(workspaceStorageKey), {});
  const legacyWorkspace = {
    ...rawWorkspace,
    cardOrder: rawWorkspace.cardOrder || safeJsonParse(localStorage.getItem(layoutStorageKey), {}).cardOrder,
    layoutPrefs: rawWorkspace.layoutPrefs || safeJsonParse(localStorage.getItem(layoutStorageKey), {}),
    tradePlan: rawWorkspace.tradePlan || safeJsonParse(localStorage.getItem(tradePlanStorageKey), null) || loadActivePosition(),
    watchlist: rawWorkspace.watchlist || loadList(watchlistStorageKey),
  };
  const migrated = migrateWorkspace(legacyWorkspace);
  if (rawWorkspace?.version !== 2) localStorage.setItem(workspaceStorageKey, JSON.stringify(migrated));
  return migrated;
}

const layoutModePresets = {
  Simple: {
    alerts: false,
    cardOrder: ["chart", "coach", "tradePlan", "risk"],
    chart: true,
    coach: true,
    journal: false,
    performanceStats: false,
    propFirmRules: false,
    risk: true,
    tradePlan: true,
    watchlist: false,
  },
  Pro: {
    alerts: true,
    cardOrder: ["chart", "coach", "tradePlan", "risk", "watchlist", "alerts", "performanceStats"],
    chart: true,
    coach: true,
    journal: false,
    performanceStats: true,
    propFirmRules: false,
    risk: true,
    tradePlan: true,
    watchlist: true,
  },
  Streamer: {
    alerts: false,
    cardOrder: ["chart", "coach", "tradePlan", "risk"],
    chart: true,
    coach: true,
    journal: false,
    performanceStats: false,
    propFirmRules: false,
    risk: true,
    tradePlan: true,
    watchlist: false,
  },
  "Prop Firm": {
    alerts: false,
    cardOrder: ["propFirmRules", "risk", "tradePlan", "coach"],
    chart: false,
    coach: true,
    journal: false,
    performanceStats: false,
    propFirmRules: true,
    risk: true,
    tradePlan: true,
    watchlist: false,
  },
  "Journal Focus": {
    alerts: false,
    cardOrder: ["journal", "performanceStats", "tradePlan", "coach"],
    chart: false,
    coach: true,
    journal: true,
    performanceStats: true,
    propFirmRules: false,
    risk: false,
    tradePlan: true,
    watchlist: false,
  },
};

function profileToDatabase(profile, user, streamerMode) {
  return {
    account_size: profile.accountSize,
    account_type: profile.accountType,
    default_contracts: profile.defaultContracts,
    default_risk_points: profile.defaultRiskPoints,
    email: user.email,
    id: user.id,
    max_daily_loss: profile.maxDailyLoss,
    max_trades_per_day: profile.maxTradesPerDay,
    name: profile.traderName,
    preferred_market: profile.mainMarket,
    runner_points: profile.runnerPoints,
    streamer_mode: streamerMode,
    trader_experience_level: profile.traderExperienceLevel || "intermediate",
    trader_style: profile.traderStyle,
    trim1_points: profile.trim1Points,
    trim2_points: profile.trim2Points,
    updated_at: new Date().toISOString(),
    voice_alerts: profile.voiceAlerts,
  };
}

function profileFromDatabase(row, fallback) {
  if (!row) return fallback;
  return {
    ...fallback,
    accountSize: Number(row.account_size ?? fallback.accountSize),
    accountType: row.account_type || fallback.accountType,
    defaultContracts: Number(row.default_contracts ?? fallback.defaultContracts),
    defaultRiskPoints: Number(row.default_risk_points ?? fallback.defaultRiskPoints),
    mainMarket: row.preferred_market || fallback.mainMarket,
    maxDailyLoss: Number(row.max_daily_loss ?? fallback.maxDailyLoss),
    maxTradesPerDay: Number(row.max_trades_per_day ?? fallback.maxTradesPerDay),
    runnerPoints: Number(row.runner_points ?? fallback.runnerPoints),
    traderExperienceLevel: row.trader_experience_level || fallback.traderExperienceLevel || "intermediate",
    traderName: row.name || fallback.traderName,
    traderStyle: row.trader_style || fallback.traderStyle,
    trim1Points: Number(row.trim1_points ?? fallback.trim1Points),
    trim2Points: Number(row.trim2_points ?? fallback.trim2Points),
    voiceAlerts: row.voice_alerts ?? fallback.voiceAlerts,
    soundAlerts: row.sound_alerts ?? fallback.soundAlerts,
  };
}

const EMPTY_CHART_OVERLAYS = {
  poc: null,
  relVol: null,
  fvgType: null,
  fvgTop: null,
  fvgBottom: null,
  fvgScore: null,
  fvgQuality: null,
};

export default function App() {
  const [workspace, setWorkspace] = useState(() => loadMigratedWorkspace());
  const [profile, setProfile] = useState(() => loadProfile());
  const [discipline, setDiscipline] = useState(() => loadDiscipline());
  const [activePosition, setActivePosition] = useState(() => {
    const savedPlan = workspace.tradePlan || loadActivePosition();
    return savedPlan?.status === "active" || savedPlan?.status === "managing_trade" ? savedPlan : null;
  });
  const [plannedTrade, setPlannedTrade] = useState(() => workspace.tradePlan || loadActivePosition());
  const [activeTrade, setActiveTrade] = useState(() => loadActiveTrade());
  const [activePage, setActivePage] = useState("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(() => localStorage.getItem(disclaimerStorageKey) === "true");
  const [onboardingComplete, setOnboardingComplete] = useState(() => localStorage.getItem(onboardingStorageKey) === "true");
  const [fastMessage, setFastMessage] = useState("Ready for manual execution.");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installBannerDismissed, setInstallBannerDismissed] = useState(() => localStorage.getItem(installDismissedStorageKey) === "true");
  const [feedbackItems, setFeedbackItems] = useState(() => loadList(feedbackStorageKey));
  const [supportMessages, setSupportMessages] = useState(() => loadList(supportStorageKey));
  const [streamerMode, setStreamerMode] = useState(() => localStorage.getItem(streamerModeStorageKey) === "true");
  const [journalEntries, setJournalEntries] = useState(() => safeArray(workspace.journalEntries).length ? workspace.journalEntries : loadList(journalStorageKey));
  const [layoutPrefs, setLayoutPrefs] = useState(() => {
    const saved = safeJsonParse(localStorage.getItem(layoutStorageKey), {});
    return { ...defaultLayout, ...workspace.layoutPrefs, ...saved, cardOrder: normalizeCardList(saved.cardOrder || workspace.cardOrder) };
  });
  const [watchlist, setWatchlist] = useState(() => normalizeWatchlistItems(workspace.watchlist, workspace.selectedMarket || profile.mainMarket));
  const [session, setSession] = useState(null);
  const [authModal, setAuthModal] = useState(null);
  const [authMessage, setAuthMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState("Local workspace");
  const [toastMessage, setToastMessage] = useState("");
  const [webhookDebug, setWebhookDebug] = useState({
    error: "",
    price: "",
    received: "",
    symbol: "",
    updated: "",
    feedStatus: "waiting",
    lastReceivedAt: null,
    rawPayload: null,
    parsedSignal: null,
    candleCount: 0,
    lastCandleTime: null,
    lastTradeSetup: null,
  });
  const [chartOverlays, setChartOverlays] = useState(EMPTY_CHART_OVERLAYS);
  const [debugMode, setDebugMode] = useState(() => {
    try {
      return localStorage.getItem(debugModeStorageKey) === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(debugModeStorageKey, String(debugMode));
    } catch {
      // ignore quota/private mode
    }
  }, [debugMode]);
  // Shift+D toggles Debug Mode globally. Skipped while typing in inputs so
  // capitalising "D" in a field doesn't accidentally flip the panel.
  useEffect(() => {
    const handler = (event) => {
      if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "D" && event.key !== "d") return;
      const target = event.target;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      event.preventDefault();
      setDebugMode((current) => !current);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e) => { if (e.key === "Escape") setMobileMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileMenuOpen]);
  const audioReadyRef = useRef(false);
  const lastClosedTradeRef = useRef("");
  const [autoPrice, setAutoPrice] = useState(true);
  const [dataSource, setDataSource] = useState("Market Data API");
  const [lastUpdated, setLastUpdated] = useState("Manual price");
  const [priceStatus, setPriceStatus] = useState("");
  const [quote, setQuote] = useState(() => {
    const base = marketDefaults[profile.mainMarket] ?? 27500;
    return { bid: base - 0.25, ask: base + 0.25 };
  });
  const [brokerConnection, setBrokerConnection] = useState({
    accountId: "",
    accountBalance: 0,
    connected: false,
    connectionStatus: "Not Connected",
    fills: [],
    openPnl: 0,
    platform: "Not connected",
    position: null,
    realizedPnl: 0,
    updatedAt: null,
    workingOrders: [],
  });

  const [direction, setDirection] = useState("long");
  const [price, setPrice] = useState(marketDefaults[profile.mainMarket] ?? 27400);
  const [priceHistory, setPriceHistory] = useState([]);
  const [candleHistory, setCandleHistory] = useState(() => loadCandleHistory());
  const previousMarketRef = useRef(profile.mainMarket);
  const previousActiveTimeframeRef = useRef("");
  const [activeTimeframe, setActiveTimeframe] = useState("");
  const [tradingViewSignal, setTradingViewSignal] = useState(null);
  const [lastTradeSetupByKey, setLastTradeSetupByKey] = useState({});
  const [priceSource, setPriceSource] = useState("manual");
  const [lastTradeSetup, setLastTradeSetup] = useState(null);
  const [notificationPrefs, setNotificationPrefs] = useState(() => loadNotificationPrefs());
  const [chartTimeframe, setChartTimeframe] = useState(() => {
    try {
      const stored = localStorage.getItem(chartTimeframeStorageKey);
      if (!stored) return "5";
      const minutes = parseTimeframeMinutes(stored);
      return String(minutes);
    } catch {
      return "5";
    }
  });
  const [chartPrefs, setChartPrefs] = useState(() => loadChartPrefs());
  const [chartResetSignal, setChartResetSignal] = useState(0);
  const onResetChart = () => setChartResetSignal((current) => current + 1);
  const lastSignalDedupRef = useRef("");
  const lastNonCriticalNotifyRef = useRef(0);
  const [connectionError, setConnectionError] = useState(null);
  const [isOnline, setIsOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine !== false : true);
  const connectionErrorRef = useRef(null);
  const wasTradingViewConnectedRef = useRef(false);
  const lastSignalKeyRef = useRef(null);
  const lastToastAtRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const reportConnectionError = (source, message) => {
    const now = Date.now();
    setConnectionError((current) => {
      const previous = current && current.source === source ? current : null;
      const next = {
        source,
        message,
        count: (previous?.count || 0) + 1,
        lastSeenAt: now,
        lastToastAt: previous?.lastToastAt || 0,
      };
      connectionErrorRef.current = next;
      return next;
    });
  };

  const clearConnectionError = (source) => {
    setConnectionError((current) => {
      if (!current) return current;
      if (source && current.source !== source) return current;
      connectionErrorRef.current = null;
      return null;
    });
  };
  const [support, setSupport] = useState((marketDefaults[profile.mainMarket] ?? 27400) - 35);
  const [resistance, setResistance] = useState((marketDefaults[profile.mainMarket] ?? 27400) + 50);
  const [entry, setEntry] = useState((marketDefaults[profile.mainMarket] ?? 27400) + 5);
  const [contracts, setContracts] = useState(profile.defaultContracts);
  const [riskPoints, setRiskPoints] = useState(profile.defaultRiskPoints);
  const [recentHigh, setRecentHigh] = useState((marketDefaults[profile.mainMarket] ?? 27400) + 50);
  const [pullbackSupport, setPullbackSupport] = useState((marketDefaults[profile.mainMarket] ?? 27400) - 35);
  const [breakoutLevel, setBreakoutLevel] = useState((marketDefaults[profile.mainMarket] ?? 27400) + 50);
  const [levelBias, setLevelBias] = useState("neutral");
  const previousDataSourceRef = useRef(dataSource);

  useEffect(() => {
    localStorage.setItem(profileStorageKey, JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    try {
      localStorage.setItem(candleHistoryStorageKey, JSON.stringify(candleHistory));
    } catch {
      // localStorage may be full or disabled.
    }
  }, [candleHistory]);

  // Symbol switch — drop every cached candle/key that does not belong to the
  // new active symbol. Stops cross-symbol leakage into the zone engines.
  useEffect(() => {
    const previous = previousMarketRef.current;
    if (previous === profile.mainMarket) return;
    previousMarketRef.current = profile.mainMarket;
    const activeSym = String(profile.mainMarket || "").trim().toUpperCase();
    setCandleHistory((current) => {
      if (!current || typeof current !== "object") return {};
      const next = {};
      for (const [key, value] of Object.entries(current)) {
        const keySym = String(key.split("|")[0] || "").toUpperCase();
        if (keySym === activeSym && Array.isArray(value)) next[key] = value;
      }
      return next;
    });
    setPriceHistory([]);
  }, [profile.mainMarket]);

  // Timeframe switch — drop candle keys for the old timeframe under the current
  // symbol so they cannot pollute zone calculations on the new timeframe.
  useEffect(() => {
    const previous = previousActiveTimeframeRef.current;
    previousActiveTimeframeRef.current = activeTimeframe;
    if (!previous || !activeTimeframe || previous === activeTimeframe) return;
    const activeSym = String(profile.mainMarket || "").trim().toUpperCase();
    const newKey = candleHistoryKey(activeSym, activeTimeframe);
    setCandleHistory((current) => {
      if (!current || typeof current !== "object") return current;
      const next = {};
      for (const [key, value] of Object.entries(current)) {
        const keySym = String(key.split("|")[0] || "").toUpperCase();
        if (keySym !== activeSym || key === newKey) {
          if (Array.isArray(value)) next[key] = value;
        }
      }
      return next;
    });
  }, [activeTimeframe]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prune expired per-chart signals once per minute so the coach and plan
  // cannot stay stuck on a stale LONG/SHORT after the expiry window passes.
  useEffect(() => {
    const timer = setInterval(() => {
      setLastTradeSetupByKey((prev) => {
        const now = Date.now();
        const cleaned = {};
        for (const [key, stored] of Object.entries(prev)) {
          const tf = String(key.split(":")[1] || "5");
          const tfMins = Math.max(1, Number(tf) || 5);
          if (now - stored.receivedAt <= getSignalExpiryMs(tfMins)) cleaned[key] = stored;
        }
        return Object.keys(cleaned).length === Object.keys(prev).length ? prev : cleaned;
      });
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(notificationPrefsStorageKey, JSON.stringify(notificationPrefs));
    } catch {
      // ignore
    }
  }, [notificationPrefs]);

  useEffect(() => {
    try {
      localStorage.setItem(chartTimeframeStorageKey, chartTimeframe);
    } catch {
      // ignore
    }
  }, [chartTimeframe]);

  useEffect(() => {
    try {
      localStorage.setItem(chartPrefsStorageKey, JSON.stringify(chartPrefs));
    } catch {
      // ignore
    }
  }, [chartPrefs]);

  useEffect(() => {
    if (dataSource !== "TradingView Webhook") return;
    const series = pickCandleSeries(candleHistory, profile.mainMarket, activeTimeframe);
    if (series.length < 12) return;
    const zones = detectAutoSRZones(series, {
      currentPrice: price,
      market: profile.mainMarket,
      timeframeMinutes: parseTimeframeMinutes(activeTimeframe),
    });
    if (!zones.zonesValid || !zones.supportZone || !zones.resistanceZone) return;
    setSupport((current) => {
      const target = zones.supportZone.center;
      if (!Number.isFinite(target)) return current;
      if (Math.abs(Number(current) - target) < target * 0.0005) return current;
      return Number(target.toFixed(4));
    });
    setResistance((current) => {
      const target = zones.resistanceZone.center;
      if (!Number.isFinite(target)) return current;
      if (Math.abs(Number(current) - target) < target * 0.0005) return current;
      return Number(target.toFixed(4));
    });
  }, [candleHistory, profile.mainMarket, activeTimeframe, dataSource, price]);

  useEffect(() => {
    const series = pickCandleSeries(candleHistory, profile.mainMarket, activeTimeframe);
    const lastCandle = series.length ? series[series.length - 1] : null;
    setWebhookDebug((current) => {
      const nextCandleCount = series.length;
      const nextCandleTime = lastCandle?.timestamp || null;
      if (current.candleCount === nextCandleCount && current.lastCandleTime === nextCandleTime) {
        return current;
      }
      return { ...current, candleCount: nextCandleCount, lastCandleTime: nextCandleTime };
    });
  }, [candleHistory, profile.mainMarket, activeTimeframe]);

  // Mark feed as stale if 2 minutes pass without any TradingView signal.
  useEffect(() => {
    if (dataSource !== "TradingView Webhook") return undefined;
    const timer = setInterval(() => {
      setWebhookDebug((current) => {
        if (!current.lastReceivedAt) return current;
        const ageMs = Date.now() - current.lastReceivedAt;
        if (ageMs > 120_000 && current.feedStatus !== "stale" && current.feedStatus !== "error") {
          return { ...current, feedStatus: "stale" };
        }
        return current;
      });
    }, 15_000);
    return () => clearInterval(timer);
  }, [dataSource]);

  useEffect(() => {
    localStorage.setItem(disciplineStorageKey, JSON.stringify(discipline));
  }, [discipline]);

  useEffect(() => {
    if (activePosition) {
      localStorage.setItem(activePositionStorageKey, JSON.stringify(activePosition));
    } else {
      localStorage.removeItem(activePositionStorageKey);
    }
  }, [activePosition]);

  useEffect(() => {
    localStorage.setItem(activeTradeStorageKey, JSON.stringify(normalizeActiveTrade(activeTrade)));
  }, [activeTrade]);

  useEffect(() => {
    if (plannedTrade?.status === "active" || plannedTrade?.status === "managing_trade") {
      setActivePosition(plannedTrade);
      setActiveTrade(activeTradeFromPlan(plannedTrade, {
        currentPrice: price,
        market: profile.mainMarket,
        source: dataSource === "Demo Broker" ? "demo" : dataSource === "TradingView Webhook" ? "tradingview" : "manual",
        status: plannedTrade.status === "active" ? "active" : plannedTrade.status,
      }));
    }
  }, [plannedTrade, price, dataSource, profile.mainMarket]);

  useEffect(() => {
    localStorage.setItem(feedbackStorageKey, JSON.stringify(feedbackItems));
  }, [feedbackItems]);

  useEffect(() => {
    localStorage.setItem(supportStorageKey, JSON.stringify(supportMessages));
  }, [supportMessages]);

  useEffect(() => {
    localStorage.setItem(streamerModeStorageKey, String(streamerMode));
  }, [streamerMode]);

  useEffect(() => {
    localStorage.setItem(journalStorageKey, JSON.stringify(safeArray(journalEntries)));
  }, [journalEntries]);

  useEffect(() => {
    localStorage.setItem(layoutStorageKey, JSON.stringify({ ...layoutPrefs, cardOrder: normalizeCardList(layoutPrefs.cardOrder) }));
  }, [layoutPrefs]);

  useEffect(() => {
    localStorage.setItem(watchlistStorageKey, JSON.stringify(normalizeWatchlistItems(watchlist, profile.mainMarket)));
  }, [watchlist]);

  useEffect(() => {
    const nextWorkspace = migrateWorkspace({
      ...workspace,
      activeConnection: dataSource,
      cardOrder: normalizeCardList(layoutPrefs.cardOrder),
      journalEntries: safeArray(journalEntries),
      layout: layoutPrefs.mode || workspace.layout,
      layoutPrefs,
      selectedMarket: profile.mainMarket,
      tradePlan: plannedTrade || null,
      watchlist: normalizeWatchlistItems(watchlist, profile.mainMarket),
    });
    setWorkspace(nextWorkspace);
    localStorage.setItem(workspaceStorageKey, JSON.stringify(nextWorkspace));
    localStorage.setItem(tradePlanStorageKey, JSON.stringify(plannedTrade || null));
    localStorage.setItem(connectionModeStorageKey, dataSource);
  }, [dataSource, journalEntries, layoutPrefs, plannedTrade, profile.mainMarket, watchlist]);

  useEffect(() => {
    const unlockAudio = () => {
      audioReadyRef.current = true;
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthMessage(nextSession ? "Personal dashboard connected." : "Signed out. Local mode is still available.");
      if (nextSession?.user) {
        setAuthModal(null);
        setActivePage("dashboard");
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user || !supabase) return;

    let cancelled = false;
    const loadWorkspace = async () => {
      setSyncStatus("Loading personal dashboard...");

      const [{ data: profileRow }, { data: settingsRow }, { data: activePlan }, { data: journalRows }, { data: watchRows }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle(),
        supabase.from("trade_settings").select("*").eq("user_id", session.user.id).maybeSingle(),
        supabase.from("trade_plans").select("*").eq("user_id", session.user.id).eq("status", "active").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("trade_journal").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(50),
        supabase.from("watchlist").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false }),
      ]);

      if (cancelled) return;

      if (profileRow) {
        setProfile((current) => profileFromDatabase(profileRow, current));
        setStreamerMode(Boolean(profileRow.streamer_mode));
      }

      if (settingsRow) {
        const migratedSettings = migrateWorkspace({
          layoutPrefs: settingsRow.preferred_layout || {},
          selectedMarket: settingsRow.selected_market,
          support: settingsRow.support,
          resistance: settingsRow.resistance,
        });
        setProfile((current) => ({ ...current, ...(settingsRow.risk_settings || {}), mainMarket: settingsRow.selected_market || current.mainMarket }));
        if (Number.isFinite(Number(settingsRow.support))) setSupport(Number(settingsRow.support));
        if (Number.isFinite(Number(settingsRow.resistance))) setResistance(Number(settingsRow.resistance));
        setLayoutPrefs(migratedSettings.layoutPrefs);
        setWorkspace((current) => migrateWorkspace({ ...current, ...migratedSettings }));
      }

      if (activePlan?.plan) {
        const migratedPlan = normalizeTradePlan(activePlan.plan);
        setPlannedTrade(migratedPlan);
        setActivePosition(migratedPlan.status === "active" ? migratedPlan : null);
      }

      if (safeArray(journalRows).length) setJournalEntries(safeArray(journalRows).map((row) => ({ id: row.id, ...(row.entry || {}), stamp: row.created_at })));
      if (safeArray(watchRows).length) setWatchlist(normalizeWatchlistItems(safeArray(watchRows).map((row) => ({ id: row.id, notes: row.notes, symbol: row.symbol })), profile.mainMarket));
      setSyncStatus("Personal dashboard synced");
      setActivePage("dashboard");
    };

    loadWorkspace().catch((error) => setSyncStatus(error.message || "Unable to load personal dashboard"));
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    setContracts(profile.defaultContracts);
  }, [profile.defaultContracts]);

  useEffect(() => {
    setRiskPoints(profile.defaultRiskPoints);
  }, [profile.defaultRiskPoints]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  const installApp = async () => {
    if (!installPrompt) {
      setActivePage("install");
      return;
    }

    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    setInstallBannerDismissed(true);
    localStorage.setItem(installDismissedStorageKey, "true");
  };

  const dismissInstallBanner = () => {
    localStorage.setItem(installDismissedStorageKey, "true");
    setInstallBannerDismissed(true);
  };

  useEffect(() => {
    if (dataSource === "TradingView Webhook") return;
    const knownDefault = marketDefaults[profile.mainMarket];
    if (!Number.isFinite(knownDefault)) return;
    const base = knownDefault;
    const spec = specForMarket(profile.mainMarket);
    const padDown = Math.max(spec.tickSize * 4, base * 0.0013);
    const padUp = Math.max(spec.tickSize * 4, base * 0.0018);
    setPrice(base);
    setSupport(Number((base - padDown).toFixed(2)));
    setResistance(Number((base + padUp).toFixed(2)));
    setEntry(base);
    setRecentHigh(Number((base + padUp).toFixed(2)));
    setPullbackSupport(Number((base - padDown).toFixed(2)));
    setBreakoutLevel(Number((base + padUp).toFixed(2)));
    setLastUpdated(`Market changed to ${profile.mainMarket}`);
  }, [dataSource, profile.mainMarket]);

  useEffect(() => {
    const previousSource = previousDataSourceRef.current;
    if (previousSource === dataSource) return;
    previousDataSourceRef.current = dataSource;
    setPlannedTrade((current) => {
      if (!current || current.sourceMode === dataSource) return current;
      setFastMessage("Plan reset. Generate a new plan from current data.");
      return null;
    });
    setActivePosition((current) => {
      if (!current || current.sourceMode === dataSource) return current;
      return null;
    });
  }, [dataSource]);

  useEffect(() => {
    setActiveTrade((current) => updateActiveTradeProgress(current, price, profile.mainMarket));
  }, [price, profile.mainMarket]);

  useEffect(() => {
    if (!plannedTrade) return;
    const validation = validateTradePlan(plannedTrade);
    if (validation.valid) return;
    setPlannedTrade(null);
    setActivePosition(null);
    setPriceStatus(validation.reason);
    setFastMessage("Plan reset. Generate a new plan from current data.");
  }, [plannedTrade]);

  useEffect(() => {
    if (!plannedTrade) return;
    const activeBias = normalizeActiveBias(levelBias);
    if (activeBias === "neutral") return;
    if (planDirectionMatchesBias(plannedTrade, activeBias)) return;
    setPlannedTrade(null);
    setActivePosition(null);
    setPriceStatus("Bias conflict detected. Plan is outdated.");
    setFastMessage("Bias conflict detected. Plan is outdated.");
    notify("Bias conflict detected. Plan reset.", "failure");
  }, [levelBias, plannedTrade]);

  useEffect(() => {
    if (!autoPrice) {
      setDataSource("Manual Mode");
      setPriceStatus("");
      setLastUpdated("Manual price");
      return undefined;
    }

    setPriceStatus("");
    const canUseLocalMarketServer =
      typeof EventSource !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

    const applyBrokerSnapshot = (snapshot) => {
      setBrokerConnection(snapshot);

      if (snapshot.quote?.symbol === profile.mainMarket) {
        setPrice(snapshot.quote.price);
        setQuote({ bid: snapshot.quote.bid, ask: snapshot.quote.ask });
        setLastUpdated(new Date(snapshot.quote.timestamp || snapshot.updatedAt).toLocaleTimeString());
      } else if (snapshot.updatedAt) {
        setLastUpdated(new Date(snapshot.updatedAt).toLocaleTimeString());
      }
      if (Number.isFinite(Number(snapshot.dailyPnl))) updateDiscipline("dailyPnl", Number(snapshot.dailyPnl));

      if (snapshot.position?.symbol === profile.mainMarket) {
        const brokerPosition = snapshot.position;
        const fallbackStop = getSmartStop({
          direction: brokerPosition.direction,
          entry: brokerPosition.entry,
          resistance,
          riskPoints,
          support,
        }).smartStop;
        const trim1 = brokerPosition.direction === "long" ? brokerPosition.entry + profile.trim1Points : brokerPosition.entry - profile.trim1Points;
        const trim2 = brokerPosition.direction === "long" ? brokerPosition.entry + profile.trim2Points : brokerPosition.entry - profile.trim2Points;
        const runner = brokerPosition.direction === "long" ? brokerPosition.entry + profile.runnerPoints : brokerPosition.entry - profile.runnerPoints;

        const brokerPlan = normalizeTradePlan({
          ...brokerPosition,
          sourceMode: dataSource,
          stop: brokerPosition.stop ?? fallbackStop,
          target: brokerPosition.target ?? runner,
          trim1,
          trim2,
          runner,
        }, {
          contracts: brokerPosition.contracts,
          direction: brokerPosition.direction,
          entry: brokerPosition.entry,
          stop: brokerPosition.stop ?? fallbackStop,
        });
        setDirection(brokerPlan.direction);
        setEntry(brokerPlan.entry);
        setContracts(brokerPlan.contracts);
        setActivePosition({
          ...brokerPlan,
          status: "active",
        });
        setPlannedTrade({
          ...brokerPlan,
          setupType: "Broker Connection",
          status: "active",
        });
        setActiveTrade(activeTradeFromPlan(brokerPlan, {
          currentPrice: snapshot.quote?.price ?? snapshot.price ?? brokerPlan.entry,
          market: brokerPosition.symbol || profile.mainMarket,
          source: "broker",
          status: "active",
        }));
        setFastMessage(`${snapshot.platform} synced an active ${brokerPosition.direction} position.`);
      } else if (snapshot.connected && !snapshot.position) {
        setActivePosition(null);
        setPlannedTrade(null);
        setActiveTrade((current) => normalizeActiveTrade({ ...current, isActive: false, status: "closed" }));
        setFastMessage(`${snapshot.platform} is connected. No active position detected.`);
      }
    };

    if (dataSource === "Broker Connection") {
      if (!canUseLocalMarketServer) {
        setPriceStatus("Broker connection requires the local market server at 127.0.0.1:8787.");
        return undefined;
      }

      const stream = new EventSource(`${marketServerUrl}/api/broker/stream?symbol=${profile.mainMarket}`);
      let demoTimer;

      stream.onmessage = (event) => {
        applyBrokerSnapshot(JSON.parse(event.data));
        setPriceStatus("");
      };

      stream.onerror = () => {
        stream.close();
        wasTradingViewConnectedRef.current = false;
        lastSignalKeyRef.current = null;
        setBrokerConnection((current) => ({ ...current, connected: false, connectionStatus: "Stream disconnected" }));
        setPriceStatus("Broker stream unavailable. Start the local market server, then reconnect.");
      };

      if (brokerConnection.platform === "Demo Broker" && canUseLocalMarketServer) {
        demoTimer = setInterval(() => {
          fetch(`${marketServerUrl}/api/broker/demo/tick?symbol=${profile.mainMarket}`).catch((error) => {
            console.warn("[TradePilot] demo-tick →", `${marketServerUrl}/api/broker/demo/tick`, "→", error?.message || "fetch error");
            setPriceStatus("Demo broker tick unavailable. Start the local market server.");
          });
        }, 1000);
      }

      return () => {
        stream.close();
        if (demoTimer) clearInterval(demoTimer);
      };
    }


    if (dataSource === "Market Data API" && !canUseLocalMarketServer) {
      const controller = new AbortController();
      const refreshServerQuote = async () => {
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setPriceStatus("You appear offline. Reconnecting…");
          return;
        }
        const result = await safeFetch(
          `/api/market/quote?symbol=${encodeURIComponent(profile.mainMarket)}`,
          { signal: controller.signal },
          "market-quote",
        );
        if (result.aborted) return;
        if (!result.ok || result.data?.ok === false) {
          reportConnectionError("market-quote", result.error || result.data?.error || "Market quote unavailable.");
          setPriceStatus("Market quote temporarily unavailable. Showing last known price.");
          return;
        }
        clearConnectionError("market-quote");
        const payload = result.data || {};
        const nextPrice = Number(payload.price);
        if (!Number.isFinite(nextPrice)) {
          setPriceStatus("Market quote returned no price. Showing last known price.");
          return;
        }
        setPrice(nextPrice);
        setQuote({
          bid: Number(payload.bid ?? nextPrice - 0.25),
          ask: Number(payload.ask ?? nextPrice + 0.25),
        });
        setLastUpdated(payload.timestamp ? new Date(payload.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString());
        setPriceStatus(payload.delayed ? "Using delayed futures quote. For exact live chart price, connect TradingView Alerts." : "");
      };

      refreshServerQuote();
      const timer = setInterval(refreshServerQuote, 10000);
      return () => {
        controller.abort();
        clearInterval(timer);
      };
    }

    if (dataSource === "TradingView Webhook") {
      const controller = new AbortController();
      const refreshTradingViewWebhook = async () => {
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          setPriceStatus("You appear offline. Reconnecting…");
          return;
        }
        const result = await safeFetch(
          "/api/webhook/tradingview/latest",
          { signal: controller.signal },
          "tradingview-latest",
        );
        if (result.aborted) return;
        if (!result.ok) {
          reportConnectionError("tradingview", result.error || "TradingView feed unavailable.");
          setWebhookDebug((current) => ({
            ...current,
            error: result.error || "TradingView feed temporarily unavailable.",
            feedStatus: "error",
            updated: new Date().toLocaleTimeString(),
          }));
          setPriceStatus("TradingView feed temporarily unavailable. Retrying…");
          return;
        }
        const payload = result.data || {};
        if (payload.ok === false) {
          reportConnectionError("tradingview", payload.error || "TradingView feed error");
          setPriceStatus("TradingView feed temporarily unavailable. Retrying…");
          return;
        }
        clearConnectionError("tradingview");
        if (!payload.signal) {
          setWebhookDebug((current) => ({
            ...current,
            error: "",
            received: "No",
            feedStatus: "waiting",
            updated: new Date().toLocaleTimeString(),
          }));
          setPriceStatus("Waiting for TradingView alert data.");
          return;
        }
        const signal = payload.signal;
        const signalTime = signal.created_at || signal.timestamp;
        const signalTimeMs = signalTime ? new Date(signalTime).getTime() : 0;
        setWebhookDebug((current) => ({
          ...current,
          error: "",
          price: String(signal.price ?? ""),
          received: "Yes",
          symbol: signal.symbol || "",
          updated: signalTime ? new Date(signalTime).toLocaleTimeString() : new Date().toLocaleTimeString(),
          feedStatus: "connected",
          lastReceivedAt: Date.now(),
          rawPayload: signal,
          parsedSignal: {
            symbol: signal.symbol || null,
            price: Number(signal.price),
            open: Number(signal.candle?.open ?? signal.open),
            high: Number(signal.candle?.high ?? signal.high),
            low: Number(signal.candle?.low ?? signal.low),
            close: Number(signal.candle?.close ?? signal.close),
            signal: signal.signal || null,
            grade: signal.grade || null,
            direction: signal.direction || null,
            timeframe: signal.timeframe || null,
            timestamp: signalTime || null,
          },
        }));
        const incomingSignal = String(signal.signal || "").toLowerCase();
        const incomingScore = Number(signal.setupScore);
        const incomingGrade = signal.grade ? String(signal.grade).toUpperCase() : "";
        const dedupeKey = `${signal.symbol || ""}-${incomingSignal}-${signal.price ?? ""}-${signal.timestamp || signal.created_at || ""}`;
        if (dedupeKey === lastSignalKeyRef.current) return;
        applyAlert(signal);
        // Toast only on real trade_setup signals at B+ or A. price_update is silent
        // background data; below 75 is treated as "no high-quality setup yet".
        const isHighQualitySetup = incomingSignal === "trade_setup"
          && Number.isFinite(incomingScore)
          && incomingScore >= 73
          && (incomingGrade === "A+" || incomingGrade === "A" || incomingGrade === "B+");
        if (isHighQualitySetup) {
          const direction = signal.direction || "setup";
          notify(`${incomingGrade} ${direction} setup received.`, "success", {
            category: NOTIFY_IMPORTANT,
            dedupKey: `setup:${dedupeKey}`,
          });
        }
      };

      refreshTradingViewWebhook();
      const timer = setInterval(refreshTradingViewWebhook, 5000);
      return () => {
        controller.abort();
        clearInterval(timer);
      };
    }

    // Local SSE feed for Market Data API only. TradingView Webhook returned
    // earlier — its price comes from applyAlert and must NEVER be overwritten
    // by another feed.
    if (dataSource === "Market Data API" && canUseLocalMarketServer) {
      const stream = new EventSource(`${marketServerUrl}/api/market/stream?symbol=${profile.mainMarket}`);

      const handleQuote = (event) => {
        const quotePayload = JSON.parse(event.data);
        setPrice(quotePayload.price);
        setQuote({ bid: quotePayload.bid, ask: quotePayload.ask });
        setLastUpdated(new Date(quotePayload.timestamp).toLocaleTimeString());
        setPriceStatus("");
      };

      stream.onmessage = handleQuote;
      stream.addEventListener("quote", handleQuote);

      stream.onerror = () => {
        stream.close();
        setPriceStatus("Live price unavailable. Switch to manual mode.");
      };

      return () => stream.close();
    }

    // Defensive: never run the sine-wave simulator when TradingView is the
    // active source — webhook prices are the source of truth.
    if (dataSource === "TradingView Webhook") return undefined;

    const knownDefault = marketDefaults[profile.mainMarket];
    if (!Number.isFinite(knownDefault) || knownDefault <= 0) {
      setPriceStatus("Custom market detected. Set tick size and point value to enable simulated price.");
      return undefined;
    }
    const base = knownDefault;
    const spec = specForMarket(profile.mainMarket);
    const tick = spec.tickSize || (base > 1000 ? 0.25 : 0.01);
    const timer = setInterval(() => {
      const drift = Math.sin(Date.now() / 12000) * base * 0.0008;
      const noise = (Math.random() - 0.5) * base * 0.0007;
      const rawPrice = base + drift + noise;
      const nextPrice = Number((Math.round(rawPrice / tick) * tick).toFixed(4));
      const spread = Math.max(tick * 2, base * 0.00002);
      setPrice(nextPrice);
      setQuote({
        bid: Number((nextPrice - spread / 2).toFixed(4)),
        ask: Number((nextPrice + spread / 2).toFixed(4)),
      });
      setLastUpdated(new Date().toLocaleTimeString());
    }, 1000);

    return () => clearInterval(timer);
  }, [autoPrice, brokerConnection.platform, dataSource, profile, resistance, riskPoints, support]);

  const engine = useMemo(() => {
    return calculateTrade({
      activePosition,
      contracts,
      direction,
      discipline,
      entry,
      price,
      profile,
      resistance,
      riskPoints,
      support,
    });
  }, [activePosition, contracts, direction, discipline, entry, price, profile, resistance, riskPoints, support]);

  const updateProfile = (key, value) => {
    setProfile((current) => ({ ...current, [key]: value }));
  };

  const updateDiscipline = (key, value) => {
    setDiscipline((current) => ({ ...current, [key]: value }));
  };

  const playBeep = (type = "success") => {
    if (!profile.soundAlerts || !audioReadyRef.current) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const beep = (frequency, start, duration) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, context.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(context.currentTime + start);
      oscillator.stop(context.currentTime + start + duration + 0.03);
    };
    if (type === "failure") {
      beep(220, 0, 0.14);
      beep(180, 0.18, 0.18);
    } else {
      beep(740, 0, 0.12);
    }
    window.setTimeout(() => context.close?.(), 600);
  };

  const notify = (message, type = "info", options = {}) => {
    const category = options.category || NOTIFY_IMPORTANT;
    const dedupKey = options.dedupKey || null;

    // Settings gates
    if (category === NOTIFY_INFO && !notificationPrefs.priceUpdateAlerts) return;
    if (category === NOTIFY_IMPORTANT && !notificationPrefs.setupAlerts) return;

    // Dedup: skip identical message+key combos
    if (dedupKey) {
      const key = `${dedupKey}|${message}`;
      if (lastSignalDedupRef.current === key) return;
      lastSignalDedupRef.current = key;
    }

    // Throttle non-critical to one toast per 30s
    if (category !== NOTIFY_CRITICAL) {
      const now = Date.now();
      if (now - lastNonCriticalNotifyRef.current < NOTIFY_THROTTLE_MS) return;
      lastNonCriticalNotifyRef.current = now;
    }

    if (notificationPrefs.toast) setToastMessage(message);
    if (notificationPrefs.sound && (type === "success" || type === "failure")) playBeep(type);
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToastMessage(""), 2800);
  };

  const savePersonalWorkspace = async () => {
    const riskSettings = {
      defaultContracts: profile.defaultContracts,
      defaultRiskPoints: profile.defaultRiskPoints,
      maxDailyLoss: profile.maxDailyLoss,
      maxRiskPerTrade: profile.maxRiskPerTrade,
      maxTradesPerDay: profile.maxTradesPerDay,
      accountSize: profile.accountSize,
      accountType: profile.accountType,
      accountPhase: profile.accountPhase,
      consistencyRuleTarget: profile.consistencyRuleTarget,
      fundedPlatform: profile.fundedPlatform,
      fundedProvider: profile.fundedProvider,
      profitGoal: profile.profitGoal,
      startingBalance: profile.startingBalance,
      trailingDrawdown: profile.trailingDrawdown,
      traderStyle: profile.traderStyle,
      trim1Points: profile.trim1Points,
      trim2Points: profile.trim2Points,
      runnerPoints: profile.runnerPoints,
      voiceAlerts: profile.voiceAlerts,
      streamerMode,
    };
    const connectionSettings = {
      accountType: profile.accountType,
      dataSource,
      demoModeEnabled: brokerConnection.platform === "Demo Broker",
      fundedProvider: profile.fundedProvider,
      fundedPlatform: profile.fundedPlatform,
      manualFundedRules: {
        accountSize: profile.accountSize,
        consistencyRuleTarget: profile.consistencyRuleTarget,
        maxContracts: profile.maxContracts,
        maxDailyLoss: profile.maxDailyLoss,
        profitGoal: profile.profitGoal,
        startingBalance: profile.startingBalance,
        trailingDrawdown: profile.trailingDrawdown,
      },
    };

    if (!session?.user || !supabase) {
      localStorage.setItem(connectionSettingsStorageKey, JSON.stringify({
        brokerConnection,
        connectionSettings,
        savedAt: new Date().toISOString(),
      }));
      setSyncStatus("Connection settings saved locally");
      return "local";
    }

    await Promise.all([
      supabase.from("profiles").upsert(profileToDatabase(profile, session.user, streamerMode)),
      supabase.from("trade_settings").upsert({
        coach_preferences: { voiceAlerts: profile.voiceAlerts },
        preferred_layout: layoutPrefs,
        risk_settings: { ...riskSettings, connectionSettings },
        selected_market: profile.mainMarket,
        support,
        resistance,
        updated_at: new Date().toISOString(),
        user_id: session.user.id,
      }, { onConflict: "user_id" }),
      plannedTrade
        ? supabase.from("trade_plans").upsert({
            id: plannedTrade.remoteId,
            plan: plannedTrade,
            status: "active",
            updated_at: new Date().toISOString(),
            user_id: session.user.id,
          })
        : Promise.resolve(),
      brokerConnection.platform !== "Not connected"
        ? supabase.from("broker_connections").upsert({
            account_type: profile.accountType,
            metadata: {
              dataSource,
              lastUpdated: brokerConnection.updatedAt,
              readOnly: true,
              streamerSafe: true,
            },
            mode: "read-only",
            platform: brokerConnection.platform || profile.fundedPlatform,
            provider: profile.fundedProvider,
            status: brokerConnection.connectionStatus || "not_connected",
            updated_at: new Date().toISOString(),
            user_id: session.user.id,
          }, { onConflict: "user_id,platform" })
        : Promise.resolve(),
    ]);

    setSyncStatus("Personal dashboard saved");
    return "supabase";
  };

  useEffect(() => {
    if (!session?.user || !supabase) return undefined;
    const timer = setTimeout(() => {
      savePersonalWorkspace().catch((error) => setSyncStatus(error.message || "Save failed"));
    }, 1200);
    return () => clearTimeout(timer);
  }, [layoutPrefs, plannedTrade, profile, resistance, session?.user?.id, streamerMode, support]);

  const startFastTrade = (nextDirection) => {
    const nextEntry = price;
    const stop = getSmartStop({ direction: nextDirection, entry: nextEntry, resistance, riskPoints, support }).smartStop;
    const trim1Points = Math.max(1, Math.abs(Number(profile.trim1Points) || 1));
    const trim2Points = Math.max(trim1Points + 0.25, Math.abs(Number(profile.trim2Points) || trim1Points * 2));
    const runnerPoints = Math.max(trim2Points + 0.25, Math.abs(Number(profile.runnerPoints) || trim2Points * 1.5));
    const trim1 = nextDirection === "long" ? nextEntry + trim1Points : nextEntry - trim1Points;
    const trim2 = nextDirection === "long" ? nextEntry + trim2Points : nextEntry - trim2Points;
    const runner = nextDirection === "long" ? nextEntry + runnerPoints : nextEntry - runnerPoints;
    const nextPlan = normalizeTradePlan({
      direction: nextDirection,
      entry: nextEntry,
      contracts,
      stop,
      target: runner,
      trim1,
      trim2,
      runner,
      setupType: "Fast Mode",
      sourceMode: dataSource,
      status: "planned",
      lastAction: `${nextDirection === "long" ? "Long" : "Short"} loaded from Fast Mode`,
    });

    setDirection(nextDirection);
    setEntry(nextEntry);
    setActivePosition({
      ...nextPlan,
      status: "active",
    });
    setPlannedTrade(nextPlan);
    setActiveTrade(activeTradeFromPlan(nextPlan, {
      currentPrice: price,
      market: profile.mainMarket,
      source: "manual",
      status: "active",
    }));
    setDiscipline((current) => ({ ...current, tradesTaken: current.tradesTaken + 1 }));
    setFastMessage(`${nextDirection === "long" ? "Long" : "Short"} loaded. Entry, stop, trims, and runner are ready.`);
  };

  const applyQuickSetup = (setupType) => {
    const isLong = setupType.includes("Long");
    const nextDirection = isLong ? "long" : "short";
    let plan;

    if (setupType === "Breakout Long") {
      const nextEntry = resistance + 2;
      plan = {
        direction: "long",
        entry: nextEntry,
        stop: resistance - 15,
        trim1: nextEntry + 20,
        trim2: nextEntry + 40,
        runner: nextEntry + 80,
      };
    } else if (setupType === "Pullback Long") {
      const nextEntry = support + 2;
      plan = {
        direction: "long",
        entry: nextEntry,
        stop: support - 20,
        trim1: resistance,
        trim2: resistance + 20,
        runner: resistance + 60,
      };
    } else if (setupType === "Breakdown Short") {
      const nextEntry = support - 2;
      plan = {
        direction: "short",
        entry: nextEntry,
        stop: support + 15,
        trim1: nextEntry - 20,
        trim2: nextEntry - 40,
        runner: nextEntry - 80,
      };
    } else {
      const nextEntry = resistance - 2;
      plan = {
        direction: "short",
        entry: nextEntry,
        stop: resistance + 20,
        trim1: support,
        trim2: support - 20,
        runner: support - 60,
      };
    }

    const nextRisk = Math.abs(plan.entry - plan.stop);
    setDirection(nextDirection);
    setEntry(plan.entry);
    setRiskPoints(nextRisk);
    setPlannedTrade(normalizeTradePlan({
      ...plan,
      contracts,
      sourceMode: dataSource,
      target: plan.runner,
      setupType,
      status: "planned",
      lastAction: `${setupType} plan generated`,
    }));
    setFastMessage(`${setupType} plan loaded. Review the ladder and risk/reward before acting.`);
  };

  const runFastAction = (action) => {
    if (action === "long" || action === "short") {
      startFastTrade(action);
      return;
    }

    if (!activePosition) {
      setFastMessage("No active position detected. Use Long or Short first.");
      return;
    }

    const messages = {
      trim1: "First trim hit. Take partial profit.",
      trim2: "Second trim hit. Move stop tighter and protect the runner.",
      moveStop: "Move stop to breakeven.",
      exit: "Trade marked exited. No broker order was sent.",
    };

    if (action === "exit") {
      setActiveTrade((current) => normalizeActiveTrade({
        ...current,
        currentPrice: price,
        isActive: false,
        realizedPL: current.unrealizedPL,
        status: "closed",
      }));
      setActivePosition(null);
      setPlannedTrade(null);
    } else {
      setActiveTrade((current) => normalizeActiveTrade({
        ...current,
        currentPrice: price,
        isActive: true,
        status: action === "trim1" ? "tp1_hit" : action === "trim2" ? "tp2_hit" : current.status,
      }));
      setActivePosition((current) => ({
        ...current,
        status: action,
        stop: action === "moveStop" ? current.entry : current.stop,
        lastAction: messages[action],
      }));
    }

    setFastMessage(messages[action]);
  };

  const applyAlert = (alert) => {
    const resolved = resolveMarketFromSymbol(alert.symbol || profile.mainMarket, profile.mainMarket);
    const nextMarket = resolved.market;
    const nextPrice = Number(alert.price);
    const rawSignalTime = alert.created_at || alert.receivedAt || alert.timestamp || "";
    const signalKind = alert.signal ? String(alert.signal).toLowerCase() : "";
    const signalKey = `${alert.symbol || ""}-${signalKind}-${alert.price ?? ""}-${rawSignalTime}`;
    if (signalKey === lastSignalKeyRef.current) return;
    lastSignalKeyRef.current = signalKey;
    const signalTime = rawSignalTime || new Date().toISOString();
    const tfRaw = alert.timeframe ? String(alert.timeframe).trim() : "";
    if (tfRaw) setActiveTimeframe(tfRaw);

    setWebhookDebug((current) => ({
      ...current,
      error: "",
      received: "Yes",
      symbol: alert.symbol || resolved.symbol || current.symbol,
      price: Number.isFinite(nextPrice) ? String(nextPrice) : current.price,
      updated: new Date(signalTime).toLocaleTimeString(),
      feedStatus: "connected",
      lastReceivedAt: Date.now(),
      rawPayload: alert,
      parsedSignal: {
        symbol: alert.symbol || resolved.symbol || null,
        price: Number.isFinite(nextPrice) ? nextPrice : null,
        open: Number(alert.candle?.open ?? alert.open),
        high: Number(alert.candle?.high ?? alert.high),
        low: Number(alert.candle?.low ?? alert.low),
        close: Number(alert.candle?.close ?? alert.close),
        signal: signalKind || null,
        grade: alert.grade ? String(alert.grade).toUpperCase() : null,
        direction: alert.direction || null,
        timeframe: tfRaw || null,
        timestamp: signalTime,
        validSetup: signalKind === "trade_setup",
      },
    }));

    if (signalKind === "price_update") {
      const candleFromPriceUpdate = alert.candle && Number.isFinite(Number(alert.candle.close))
        ? alert.candle
        : (Number.isFinite(Number(alert.open)) && Number.isFinite(Number(alert.high)) && Number.isFinite(Number(alert.low)) && Number.isFinite(Number(alert.close)))
          ? { open: alert.open, high: alert.high, low: alert.low, close: alert.close, volume: alert.volume, timeframe: tfRaw, timestamp: signalTime }
          : null;
      if (candleFromPriceUpdate) {
        const key = candleHistoryKey(nextMarket, tfRaw);
        if (key) setCandleHistory((current) => appendCandle(current, key, { ...candleFromPriceUpdate, timestamp: signalTime, timeframe: tfRaw || candleFromPriceUpdate.timeframe || null }));
      } else if (Number.isFinite(nextPrice)) {
        const key = candleHistoryKey(nextMarket, tfRaw || "1");
        if (key) setCandleHistory((current) => aggregatePriceTick(current, key, nextPrice, signalTime, tfRaw || "1"));
      }
      if (Number.isFinite(nextPrice)) setPrice(nextPrice);
      setLastUpdated(signalTime ? new Date(signalTime).toLocaleTimeString() : new Date().toLocaleTimeString());
      const isConnectedNow = Number.isFinite(nextPrice);
      if (isConnectedNow && !wasTradingViewConnectedRef.current) {
        wasTradingViewConnectedRef.current = true;
        const now = Date.now();
        if (now - lastToastAtRef.current > 5000) {
          lastToastAtRef.current = now;
          notify("TradingView feed connected.", "success", { category: NOTIFY_IMPORTANT, dedupKey: "tv-feed-active" });
        }
      }
      setBrokerConnection((prev) => {
        if (
          prev.connected === true
          && prev.platform === "TradingView Webhook"
          && prev.lastSignalAt === signalTime
        ) {
          return prev;
        }
        return {
          ...prev,
          connected: true,
          connectionStatus: "TradingView feed active",
          error: "",
          lastSignalAt: signalTime,
          platform: "TradingView Webhook",
          price: Number.isFinite(nextPrice) ? nextPrice : prev.price,
          quote: Number.isFinite(nextPrice)
            ? { bid: Number((nextPrice - 0.25).toFixed(2)), price: nextPrice, ask: Number((nextPrice + 0.25).toFixed(2)) }
            : prev.quote,
          source: "TradingView Alerts",
          updatedAt: signalTime,
        };
      });
      // price_update carries poc + relativeVolume + FVG fields — capture before early return.
      const puPoc = Number.isFinite(Number(alert.poc)) ? Number(alert.poc) : null;
      const puRelVol = Number.isFinite(Number(alert.relativeVolume)) ? Number(alert.relativeVolume) : null;
      const puFvgTop = Number.isFinite(Number(alert.nearestFvgTop)) ? Number(alert.nearestFvgTop) : null;
      const puFvgBottom = Number.isFinite(Number(alert.nearestFvgBottom)) ? Number(alert.nearestFvgBottom) : null;
      const puFvgType = alert.nearestFvgType && alert.nearestFvgType !== "none"
        ? String(alert.nearestFvgType).toLowerCase() : null;
      const puFvgScore = Number.isFinite(Number(alert.nearestFvgScore)) ? Number(alert.nearestFvgScore) : null;
      const puFvgQuality = alert.nearestFvgQuality ? String(alert.nearestFvgQuality) : null;
      if (puPoc !== null || puRelVol !== null || puFvgType !== null) {
        setChartOverlays((prev) => ({
          ...prev,
          poc: puPoc ?? prev.poc,
          relVol: puRelVol ?? prev.relVol,
          fvgType: puFvgType ?? prev.fvgType,
          fvgTop: puFvgTop ?? prev.fvgTop,
          fvgBottom: puFvgBottom ?? prev.fvgBottom,
          fvgScore: puFvgScore ?? prev.fvgScore,
          fvgQuality: puFvgQuality ?? prev.fvgQuality,
        }));
      }
      return;
    }

    const setupScore = Number.isFinite(Number(alert.setupScore)) ? Number(alert.setupScore) : null;
    const setupGrade = alert.grade ? String(alert.grade).toUpperCase() : null;
    // B+ minimum in Pine is 73; Pine only fires trade_setup when fireLong/fireShort
    // passes all veto + score + cooldown gates, so if it arrived it's already valid.
    // 73 here is defense-in-depth against stale or replayed payloads.
    const isTradeSetup = signalKind === "trade_setup" && Number.isFinite(setupScore) && setupScore >= 73;
    setTradingViewSignal({
      symbol: resolved.symbol,
      market: nextMarket,
      price: Number.isFinite(nextPrice) ? nextPrice : null,
      timeframe: tfRaw || null,
      signal: signalKind || null,
      setupScore,
      grade: setupGrade,
      direction: alert.direction || null,
      timestamp: signalTime,
      candle: alert.candle || null,
      validSetup: isTradeSetup,
    });
    if (isTradeSetup) {
      const tradeSetup = {
        direction: alert.direction || null,
        setupScore,
        grade: setupGrade,
        price: Number.isFinite(nextPrice) ? nextPrice : null,
        timestamp: signalTime,
        symbol: resolved.symbol,
        timeframe: tfRaw || null,
        signal: signalKind,
        validSetup: true,
        vetoPassed: true,
      };
      setLastTradeSetup(tradeSetup);
      setWebhookDebug((current) => ({ ...current, lastTradeSetup: tradeSetup }));
      // Store per chartKey so coach/plan are isolated per symbol+timeframe
      const chartKeyForSignal = makeChartKey(resolved.symbol || nextMarket, tfRaw || "");
      if (chartKeyForSignal) {
        setLastTradeSetupByKey((prev) => ({
          ...prev,
          [chartKeyForSignal]: { ...tradeSetup, receivedAt: Date.now(), chartKey: chartKeyForSignal },
        }));
      }
    }
    setPriceSource("TradingView Webhook");
    const candleFromAlert = alert.candle && Number.isFinite(Number(alert.candle.close))
      ? alert.candle
      : (Number.isFinite(Number(alert.open)) && Number.isFinite(Number(alert.high)) && Number.isFinite(Number(alert.low)) && Number.isFinite(Number(alert.close)))
        ? { open: alert.open, high: alert.high, low: alert.low, close: alert.close, volume: alert.volume, timeframe: tfRaw, timestamp: signalTime }
        : null;
    if (candleFromAlert) {
      const key = candleHistoryKey(nextMarket, tfRaw);
      if (key) setCandleHistory((current) => appendCandle(current, key, { ...candleFromAlert, timestamp: signalTime, timeframe: tfRaw || candleFromAlert.timeframe || null }));
    } else if (Number.isFinite(nextPrice)) {
      const key = candleHistoryKey(nextMarket, tfRaw || "1");
      if (key) setCandleHistory((current) => aggregatePriceTick(current, key, nextPrice, signalTime, tfRaw || "1"));
    }
    const hasSupport = Number.isFinite(Number(alert.support));
    const hasResistance = Number.isFinite(Number(alert.resistance));
    const hasEntry = Number.isFinite(Number(alert.entry));
    const hasStop = Number.isFinite(Number(alert.stop));
    const alertBias = normalizeActiveBias(alert.bias);
    const alertEvent = String(alert.event || alert.type || "").toLowerCase();

    const symbolChanged = nextMarket && nextMarket !== profile.mainMarket;
    const previousMarketDefault = marketDefaults[profile.mainMarket];
    const newMarketDefault = marketDefaults[nextMarket];
    const priceLooksMismatched =
      Number.isFinite(nextPrice) &&
      Number.isFinite(previousMarketDefault) &&
      previousMarketDefault > 0 &&
      Math.abs(nextPrice - previousMarketDefault) / previousMarketDefault > 0.5 &&
      (!Number.isFinite(newMarketDefault) || Math.abs(nextPrice - newMarketDefault) / newMarketDefault < 0.5);

    if (symbolChanged && profile.autoSwitchSymbol !== false) {
      updateProfile("mainMarket", nextMarket);
      setSupport(0);
      setResistance(0);
      setEntry(0);
      setRiskPoints(profile.defaultRiskPoints);
      setLevelBias("neutral");
      setPriceHistory([]);
      setPlannedTrade(null);
      setActivePosition(null);
      setActiveTrade((current) => ({ ...current, isActive: false, status: "waiting_entry", market: nextMarket }));
      setFastMessage(`Symbol changed to ${resolved.symbol}. Cleared previous market data.`);
      if (resolved.marketType === "custom") {
        notify(`Custom market detected: ${resolved.symbol}. Set tick size and point value in Settings.`, "warn");
      }
    } else if (priceLooksMismatched) {
      notify(`Symbol/market mismatch. ${alert.symbol || "Signal"} sent ${nextPrice} but current market is ${profile.mainMarket}.`, "failure");
      setSupport(0);
      setResistance(0);
      setEntry(0);
    }

    if (Number.isFinite(nextPrice)) {
      setPrice(nextPrice);
      setPriceHistory((h) => {
        if (symbolChanged) return [{ close: nextPrice, label: new Date(signalTime).toLocaleTimeString() }];
        const point = { close: nextPrice, label: new Date(signalTime).toLocaleTimeString() };
        const next = [...h, point];
        return next.length > 60 ? next.slice(next.length - 60) : next;
      });
    }
    const nextDirection = alert.direction === "long" || alert.direction === "short"
      ? alert.direction
      : alertBias === "bearish"
        ? "short"
        : alertBias === "bullish"
          ? "long"
          : direction;
    setDirection(nextDirection);
    if (hasSupport) setSupport(Number(alert.support));
    if (hasResistance) setResistance(Number(alert.resistance));
    if (!hasSupport && !hasResistance && dataSource !== "Manual Mode" && Number.isFinite(nextPrice)) {
      const tickSize = resolved.spec.tickSize || 0.01;
      const padBase = Math.abs(nextPrice) * 0.0015;
      const pad = Math.max(tickSize * 4, padBase);
      setSupport(Number((nextPrice - pad).toFixed(2)));
      setResistance(Number((nextPrice + pad).toFixed(2)));
      setFastMessage("TradingView price received. Add levels to generate a stronger plan.");
    }
    if (hasEntry) setEntry(Number(alert.entry));
    else if (Number.isFinite(nextPrice)) setEntry(nextPrice);
    if (hasStop && hasEntry) setRiskPoints(Math.abs(Number(alert.entry) - Number(alert.stop)));
    if (signalTime) setLastUpdated(new Date(signalTime).toLocaleTimeString());
    else setLastUpdated(new Date().toLocaleTimeString());
    if (Number.isFinite(nextPrice)) {
      setQuote({
        bid: Number((nextPrice - 0.25).toFixed(2)),
        ask: Number((nextPrice + 0.25).toFixed(2)),
      });
    }
    if (alertBias !== "neutral") {
      setLevelBias(alertBias);
    } else if (Number.isFinite(nextPrice) && hasSupport && hasResistance) {
      const nextSupport = Number(alert.support);
      const nextResistance = Number(alert.resistance);
      const range = Math.max(1, nextResistance - nextSupport);
      if (Math.abs(nextPrice - nextResistance) <= range * 0.22) setLevelBias("bearish");
      else if (Math.abs(nextPrice - nextSupport) <= range * 0.22) setLevelBias("bullish");
      else setLevelBias("neutral");
    } else {
      setLevelBias("neutral");
    }
    if (hasEntry && hasStop && alert.targets) {
      const targets = Array.isArray(alert.targets) ? alert.targets.map(Number).filter(Number.isFinite) : [];
      if (targets.length) {
        const tvPlan = normalizeTradePlan({
          contracts,
          direction: nextDirection,
          entry: Number(alert.entry),
          runner: targets[2] ?? targets[targets.length - 1],
          setupType: "TradingView Alert",
          sourceMode: "TradingView Webhook",
          status: "planned",
          stop: Number(alert.stop),
          target: targets[targets.length - 1],
          timeframe: tfRaw || null,
          trim1: targets[0],
          trim2: targets[1] ?? targets[0],
        }, {
          contracts,
          direction: nextDirection,
          entry: Number(alert.entry),
          stop: Number(alert.stop),
        });
        setPlannedTrade(tvPlan);
      }
    }
    if (["entry", "tp1", "tp2", "stop", "exit"].includes(alertEvent)) {
      setActiveTrade((current) => {
        if (alertEvent === "entry") {
          const eventPlan = normalizeTradePlan({
            contracts,
            direction: nextDirection,
            entry: safeNumber(alert.entry, nextPrice),
            runner: safeNumber(alert.runner, alert.target, current.runner, nextDirection === "short" ? nextPrice - profile.runnerPoints : nextPrice + profile.runnerPoints),
            sourceMode: "TradingView Webhook",
            status: "active",
            stop: safeNumber(alert.stop, nextDirection === "short" ? nextPrice + profile.defaultRiskPoints : nextPrice - profile.defaultRiskPoints),
            trim1: safeNumber(alert.tp1, alert.trim1, nextDirection === "short" ? nextPrice - profile.trim1Points : nextPrice + profile.trim1Points),
            trim2: safeNumber(alert.tp2, alert.trim2, nextDirection === "short" ? nextPrice - profile.trim2Points : nextPrice + profile.trim2Points),
          });
          setPlannedTrade(eventPlan);
          setActivePosition(eventPlan);
          return activeTradeFromPlan(eventPlan, { currentPrice: nextPrice, market: nextMarket, source: "tradingview", status: "active" });
        }
        if (alertEvent === "exit" || alertEvent === "stop") {
          return normalizeActiveTrade({
            ...current,
            currentPrice: safeNumber(nextPrice, current.currentPrice),
            isActive: false,
            realizedPL: current.realizedPL || current.unrealizedPL,
            status: alertEvent === "stop" ? "stopped" : "closed",
          });
        }
        return normalizeActiveTrade({
          ...current,
          currentPrice: safeNumber(nextPrice, current.currentPrice),
          isActive: true,
          status: alertEvent === "tp1" ? "tp1_hit" : "tp2_hit",
        });
      });
    }
    const isConnectedNow = Number.isFinite(nextPrice);
    if (isConnectedNow && !wasTradingViewConnectedRef.current) {
      wasTradingViewConnectedRef.current = true;
      const now = Date.now();
      if (now - lastToastAtRef.current > 5000) {
        lastToastAtRef.current = now;
        notify("TradingView feed connected.", "success", { category: NOTIFY_IMPORTANT, dedupKey: "tv-feed-active" });
      }
    }
    setBrokerConnection((prev) => {
      if (
        prev.connected === true
        && prev.platform === "TradingView Webhook"
        && prev.lastSignalAt === signalTime
      ) {
        return prev;
      }
      return {
        ...prev,
        connected: true,
        connectionStatus: "TradingView feed active",
        error: "",
        lastSignalAt: signalTime,
        platform: "TradingView Webhook",
        price: Number.isFinite(nextPrice) ? nextPrice : prev.price,
        quote: Number.isFinite(nextPrice)
          ? { bid: Number((nextPrice - 0.25).toFixed(2)), price: nextPrice, ask: Number((nextPrice + 0.25).toFixed(2)) }
          : prev.quote,
        source: "TradingView Alerts",
        updatedAt: signalTime,
      };
    });
    if (dataSource !== "TradingView Webhook") setDataSource("TradingView Webhook");
    if (!autoPrice) setAutoPrice(true);
    // Parse chart overlays (POC, FVG, relative volume, quality) sent by Pine Script v9+.
    const pocVal = Number.isFinite(Number(alert.poc)) ? Number(alert.poc) : null;
    const fvgTop = Number.isFinite(Number(alert.nearestFvgTop)) ? Number(alert.nearestFvgTop) : null;
    const fvgBottom = Number.isFinite(Number(alert.nearestFvgBottom)) ? Number(alert.nearestFvgBottom) : null;
    const fvgType = alert.nearestFvgType && alert.nearestFvgType !== "none" && (fvgTop !== null || fvgBottom !== null)
      ? String(alert.nearestFvgType).toLowerCase()
      : null;
    const relVolVal = Number.isFinite(Number(alert.relativeVolume)) ? Number(alert.relativeVolume) : null;
    const fvgScoreVal = Number.isFinite(Number(alert.nearestFvgScore)) ? Number(alert.nearestFvgScore) : null;
    const fvgQualityVal = alert.nearestFvgQuality ? String(alert.nearestFvgQuality) : null;
    if (pocVal !== null || fvgType !== null || relVolVal !== null) {
      setChartOverlays((prev) => ({
        poc: pocVal ?? prev.poc,
        fvgType: fvgType ?? prev.fvgType,
        fvgTop: fvgTop ?? prev.fvgTop,
        fvgBottom: fvgBottom ?? prev.fvgBottom,
        relVol: relVolVal ?? prev.relVol,
        fvgScore: fvgScoreVal ?? prev.fvgScore,
        fvgQuality: fvgQualityVal ?? prev.fvgQuality,
      }));
    }

    if (isTradeSetup) {
      setPriceStatus(`Trade Pilot: ${setupGrade || "B+"} ${alert.direction === "short" ? "short" : "long"} setup (${setupScore ?? "?"})`);
      setFastMessage(`${setupGrade || "B+"} ${alert.direction === "short" ? "short" : "long"} setup at ${Number.isFinite(nextPrice) ? nextPrice.toFixed(2) : "market price"}.`);
      if (activePage !== "connections") setActivePage("dashboard");
    }
  };

  const applyDemoBrokerSnapshot = (snapshot) => {
    setBrokerConnection({
      ...snapshot,
      connected: true,
      connectionStatus: "Demo Broker Connected",
      platform: "Demo Broker",
      source: "Simulated demo data",
    });
    setDataSource("Demo Broker");
    setAutoPrice(true);
    updateProfile("accountType", "Demo / Practice Account");
    updateProfile("fundedPlatform", "Manual Mode");
    setPrice(snapshot.price || snapshot.quote?.price || marketDefaults[profile.mainMarket] || 27500);
    setQuote({
      bid: Number(snapshot.bid ?? snapshot.quote?.bid ?? ((snapshot.price || 27500) - 0.25)),
      ask: Number(snapshot.ask ?? snapshot.quote?.ask ?? ((snapshot.price || 27500) + 0.25)),
    });
    updateDiscipline("dailyPnl", Number(snapshot.dailyPnl ?? snapshot.openPnl ?? 0));
    setWatchlist((current) => {
      const symbol = snapshot.symbol || profile.mainMarket || "MNQ";
      const demoItem = { id: "demo-broker-watch", notes: "Demo broker price feed active", symbol };
      return [demoItem, ...normalizeWatchlistItems(current, profile.mainMarket).filter((item) => item.id !== demoItem.id && item.symbol !== symbol)].slice(0, 8);
    });
    if (snapshot.position) {
      const demoPlan = normalizeTradePlan({
        ...snapshot.position,
        runner: snapshot.position.target ?? snapshot.position.entry + profile.runnerPoints,
        sourceMode: "Demo Broker",
        setupType: "Demo Broker",
        status: "active",
        stop: snapshot.position.stop ?? snapshot.position.entry - profile.defaultRiskPoints,
        target: snapshot.position.target ?? snapshot.position.entry + profile.runnerPoints,
        trim1: snapshot.position.trim1 ?? snapshot.position.entry + profile.trim1Points,
        trim2: snapshot.position.trim2 ?? snapshot.position.entry + profile.trim2Points,
      }, {
        contracts,
        direction,
        entry: snapshot.position.entry,
        stop: snapshot.position.entry - profile.defaultRiskPoints,
      });
      setActivePosition(demoPlan);
      setPlannedTrade(demoPlan);
      setActiveTrade(activeTradeFromPlan(demoPlan, {
        currentPrice: snapshot.price || snapshot.quote?.price || demoPlan.entry,
        market: snapshot.symbol || profile.mainMarket,
        source: "demo",
        status: "active",
      }));
    }
    setLastUpdated(new Date(snapshot.timestamp || snapshot.updatedAt || Date.now()).toLocaleTimeString());
    setFastMessage("Demo Broker Connected - simulated data is powering the dashboard.");
    setPriceStatus("");
    notify("Demo Broker connected.", "success");
    setActivePage("connections");
  };

  const createLocalDemoBrokerSnapshot = () => {
    const symbol = profile.mainMarket || "MNQ";
    const base = marketDefaults[symbol] || 27500;
    const priceValue = Number((base + 4.5).toFixed(2));
    const entryValue = Number((priceValue - 7.25).toFixed(2));
    const openPnl = Number(((priceValue - entryValue) * (pointValues[symbol] || 2)).toFixed(2));
    return {
      accountBalance: 50000,
      accountId: "DEMO-SIM-001",
      accountName: "Demo Broker",
      accountType: "demo",
      ask: Number((priceValue + 0.25).toFixed(2)),
      bid: Number((priceValue - 0.25).toFixed(2)),
      connected: true,
      connectionStatus: "Demo Broker Connected",
      dailyPnl: openPnl,
      fills: brokerSamplePayload.fills,
      openPnl,
      platform: "Demo Broker",
      position: {
        contracts: 1,
        direction: "long",
        entry: entryValue,
        lastAction: "Demo position generated",
        openPnl,
        status: "active",
        stop: Number((entryValue - 20).toFixed(2)),
        symbol,
        target: Number((entryValue + 40).toFixed(2)),
      },
      price: priceValue,
      quote: {
        ask: Number((priceValue + 0.25).toFixed(2)),
        bid: Number((priceValue - 0.25).toFixed(2)),
        price: priceValue,
        source: "Simulated demo data",
        symbol,
        timestamp: new Date().toISOString(),
      },
      realizedPnl: 0,
      source: "Simulated demo data",
      symbol,
      timestamp: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workingOrders: brokerSamplePayload.workingOrders,
    };
  };

  const activateManualMode = () => {
    setAutoPrice(false);
    setDataSource("Manual Mode");
    updateProfile("accountType", "Personal Trading Account");
    updateProfile("fundedPlatform", "Manual Mode");
    wasTradingViewConnectedRef.current = false;
    lastSignalKeyRef.current = null;
    setBrokerConnection((current) => ({
      ...current,
      connected: false,
      connectionStatus: "Manual Mode Active",
      error: "",
      platform: "Manual Mode",
      source: "Manual entry",
    }));
    setFastMessage("Manual Mode Active - enter price and levels yourself.");
    setPriceStatus("");
    notify("Manual Mode Active", "success");
    setActivePage("connections");
  };

  const activateTradingViewMode = () => {
    setAutoPrice(true);
    setDataSource("TradingView Webhook");
    updateProfile("fundedPlatform", "TradingView Webhook");
    wasTradingViewConnectedRef.current = false;
    lastSignalKeyRef.current = null;
    setBrokerConnection((current) => ({
      ...current,
      connected: false,
      connectionStatus: "Waiting for TradingView alert data",
      error: "",
      platform: "TradingView Webhook",
      source: "Webhook",
    }));
    setFastMessage("Waiting for TradingView alert data.");
    setPriceStatus("");
    setActivePage("connections");
  };

  const startDemoBroker = async () => {
    if (!isLocalDevHost()) {
      applyDemoBrokerSnapshot(createLocalDemoBrokerSnapshot());
      setPriceStatus("Local demo data is active. The market server only runs on localhost:8787.");
      setActivePage("connections");
      return;
    }
    const result = await safeFetch(
      `${marketServerUrl}/api/broker/demo/start`,
      {
        body: JSON.stringify({ symbol: profile.mainMarket }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
      "demo-broker-start",
    );
    if (result.ok && result.data?.snapshot) {
      applyDemoBrokerSnapshot({
        ...result.data.snapshot,
        connectionStatus: "Demo Broker Connected",
        dailyPnl: result.data.snapshot.dailyPnl ?? result.data.snapshot.openPnl ?? 0,
        source: "Simulated demo data",
      });
      setActivePage("connections");
      return;
    }
    applyDemoBrokerSnapshot(createLocalDemoBrokerSnapshot());
    setPriceStatus("Local demo data is active. Start the market server later for streaming ticks.");
    setActivePage("connections");
  };


  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setActivePage("dashboard");
    setSyncStatus("Local workspace");
  };

  const addJournalEntry = async (entryText) => {
    const customEntry = entryText && typeof entryText === "object" ? entryText : null;
    const entry = {
      action: engine.suggestedAction,
      dailyPnl: discipline.dailyPnl,
      market: profile.mainMarket,
      note: customEntry ? customEntry.note || "Trade closed." : entryText,
      plan: plannedTrade,
      price,
      score: engine.score,
      stamp: new Date().toISOString(),
      ...customEntry,
    };
    setJournalEntries((current) => [entry, ...current]);

    if (session?.user && supabase) {
      await supabase.from("trade_journal").insert({ entry, user_id: session.user.id });
      setSyncStatus("Journal saved");
    }
  };

  useEffect(() => {
    if (!activeTrade || activeTrade.status !== "closed") return;
    const closeKey = `${activeTrade.openedAt}-${activeTrade.realizedPL}-${activeTrade.currentPrice}`;
    if (lastClosedTradeRef.current === closeKey) return;
    lastClosedTradeRef.current = closeKey;
    const executionGrade = gradeCompletedTrade({ trade: activeTrade, plan: plannedTrade, profile });
    const closeSetupGrade = getTradeGrade({
      contracts: activeTrade.contracts,
      dailyPnl: discipline.dailyPnl,
      entry: activeTrade.entry,
      maxContracts: profile.maxContracts,
      maxDailyLoss: profile.maxDailyLoss,
      price: activeTrade.currentPrice,
      rewardRisk: calculateRewardRisk({ plan: plannedTrade || activeTrade, pointValue: marketSpecs[activeTrade.market]?.pointValue || customMarketSpec.pointValue }),
      resistance,
      stop: activeTrade.stop,
      support,
      zoneDetection: {},
    });
    const closeDiscipline = gradeDiscipline({
      activeTrade,
      discipline,
      journalEntries,
      plan: plannedTrade,
      profile,
    });
    addJournalEntry({
      contracts: activeTrade.contracts,
      direction: activeTrade.direction,
      disciplineScore: closeDiscipline.score,
      disciplineGrade: closeDiscipline.grade,
      entry: activeTrade.entry,
      executionGrade,
      exit: activeTrade.currentPrice,
      lesson: closeDiscipline.lesson,
      market: activeTrade.market,
      mistakes: closeDiscipline.mistakes,
      nextImprovement: closeDiscipline.nextStep,
      note: `${executionGrade.label}. ${closeDiscipline.lesson}`,
      pnl: activeTrade.realizedPL || activeTrade.unrealizedPL,
      screenshot: "placeholder",
      setupGrade: closeSetupGrade,
      stop: activeTrade.stop,
      targets: [activeTrade.tp1, activeTrade.tp2, activeTrade.runner],
    });
    notify("Trade closed and journaled.", "success");
  }, [activeTrade?.status, activeTrade?.realizedPL, activeTrade?.currentPrice]);

  const activeChartOverlays = chartOverlays ?? EMPTY_CHART_OVERLAYS;

  return (
    <div className="app-shell" style={styles.page}>
      <style>{`
        html,
        body,
        #root {
          width: 100% !important;
          max-width: 100vw !important;
          min-width: 0 !important;
          min-height: 100vh !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #05070d !important;
          overflow-x: hidden !important;
        }
        body {
          display: block !important;
          place-items: unset !important;
          justify-content: unset !important;
          align-items: unset !important;
          overscroll-behavior-x: none !important;
        }
        main { max-width: none !important; }
        *, *::before, *::after { box-sizing: border-box; }
        img, svg, canvas, video { max-width: 100%; }
        .tradepilot-more-menu.closed { display: none; }
        .mobile-overlay.closed { display: none !important; }
        .app-shell {
          width: 100%;
          max-width: 100vw;
          min-height: 100vh;
          overflow-x: hidden;
          background: #05070d;
          padding-left: env(safe-area-inset-left, 0px);
          padding-right: env(safe-area-inset-right, 0px);
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        .tradepilot-header {
          padding-top: max(12px, calc(env(safe-area-inset-top, 0px) + 8px)) !important;
          padding-left: max(18px, env(safe-area-inset-left, 0px)) !important;
          padding-right: max(18px, env(safe-area-inset-right, 0px)) !important;
        }
        .app-container,
        .page-container,
        .dashboard-container {
          width: 100%;
          max-width: 100%;
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          overflow-x: hidden;
        }
        .desktop-dashboard {
          display: grid;
          grid-template-columns: 240px minmax(0, 1fr) 330px;
          gap: 18px;
          width: 100%;
          max-width: 100%;
          min-height: 100vh;
          padding: 18px;
          box-sizing: border-box;
          align-items: start;
          overflow-x: hidden;
        }
        .main-dashboard { min-width: 0; max-width: 100%; display: grid; gap: 18px; }
        .chart-panel { min-height: 520px; }
        .right-panel { min-width: 0; }
        .dashboard-grid {
          width: 100%;
          display: grid;
          grid-template-columns: minmax(420px, 0.95fr) minmax(520px, 1.35fr);
          gap: 24px;
          align-items: start;
          margin-bottom: 24px;
        }
        .full-width-section { grid-column: 1 / -1; }
        @media (max-width: 900px) {
          .desktop-dashboard { grid-template-columns: 1fr; padding: 12px; }
          .left-sidebar, .right-panel { display: none !important; }
          .dashboard-grid { grid-template-columns: 1fr !important; }
          .app-container, .page-container, .dashboard-container { padding: 16px; }
          .home-feature-grid { grid-template-columns: 1fr !important; }
          .chart-panel { min-height: 320px; padding: 12px !important; }
          .tradepilot-chart-wrap { height: 320px !important; max-width: 100% !important; overflow: hidden !important; }
        }
        .mobile-launch-button { display: none !important; }
        .mobile-menu-item { display: none !important; }
        .desktop-nav-item { display: inline-flex !important; }
        .header-market-status { display: none; }
        .mobile-menu-button { display: none !important; }
        @media (max-width: 900px) {
          .desktop-nav-item { display: none !important; }
          .mobile-menu-button { display: inline-flex !important; }
        }
        @media (max-width: 768px) {
          .mobile-menu-item { display: block !important; }
          .mobile-menu-button { display: inline-flex !important; }
          .tradepilot-subtitle,
          .tradepilot-positioning,
          .tradepilot-header-meta,
          .tradepilot-auth-actions { display: none !important; }
          .tradepilot-title { font-size: 24px !important; line-height: 1 !important; margin: 0 !important; }
          .header-market-status {
            align-items: flex-end !important;
            display: flex !important;
            flex-direction: column !important;
            gap: 1px !important;
            white-space: nowrap !important;
          }
          .tradepilot-header {
            align-items: center !important;
            display: grid !important;
            gap: 12px !important;
            grid-template-columns: 1fr auto auto !important;
            padding-bottom: 10px !important;
            padding-left: max(12px, env(safe-area-inset-left, 0px)) !important;
            padding-right: max(12px, env(safe-area-inset-right, 0px)) !important;
            padding-top: max(10px, calc(env(safe-area-inset-top, 0px) + 6px)) !important;
            position: sticky !important;
            top: 0 !important;
            z-index: 200 !important;
          }
          .tradepilot-top-actions { align-items: center !important; gap: 0 !important; justify-content: flex-end !important; position: static !important; width: auto !important; }
          .mobile-menu-button {
            height: 48px !important;
            min-height: 48px !important;
            min-width: 48px !important;
            pointer-events: auto !important;
            position: relative !important;
            width: 48px !important;
            z-index: 1 !important;
          }
          .mobile-drawer {
            background: #05070d !important;
            border-left: 1px solid #1e3a5f !important;
            border-radius: 0 !important;
            box-shadow: -18px 0 44px rgba(0, 0, 0, .45) !important;
            display: grid !important;
            gap: 10px !important;
            height: 100dvh !important;
            left: auto !important;
            max-width: 100vw !important;
            min-width: 0 !important;
            overflow-y: auto !important;
            padding-bottom: max(18px, calc(env(safe-area-inset-bottom, 0px) + 12px)) !important;
            padding-left: 18px !important;
            padding-right: max(18px, env(safe-area-inset-right, 0px)) !important;
            padding-top: max(18px, calc(env(safe-area-inset-top, 0px) + 12px)) !important;
            position: fixed !important;
            right: 0 !important;
            top: 0 !important;
            transform: translateX(0) !important;
            transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
            width: min(86vw, 360px) !important;
            z-index: 10000 !important;
          }
          .mobile-menu-item {
            min-height: 44px !important;
            padding: 12px 14px !important;
          }
          .mobile-drawer.closed {
            display: grid !important;
            transform: translateX(100%) !important;
            visibility: hidden !important;
          }
          .mobile-overlay {
            background: rgba(0, 0, 0, .6) !important;
            border: 0 !important;
            cursor: pointer;
            inset: 0 !important;
            padding: 0 !important;
            position: fixed !important;
            z-index: 9999 !important;
          }
          .mobile-menu-item { display: block !important; width: 100% !important; }
          .dashboard-card-board { display: flex !important; flex-direction: column !important; max-width: 100% !important; width: 100% !important; }
          .dashboard-card-slot { max-width: 100% !important; min-width: 0 !important; width: 100% !important; }
          .card-chart { order: 1; }
          .card-coach { order: 2; }
          .card-tradePlan { order: 3; }
          .card-risk { order: 4; }
          .card-performanceStats { order: 5; }
          .card-alerts, .card-watchlist, .card-propFirmRules { order: 6; }
          .card-journal { order: 7; }
          .onboarding-card { max-width: 100% !important; width: 100% !important; }
          .onboarding-card button { width: 100% !important; }
          .install-banner {
            max-width: 100% !important;
            width: 100% !important;
            padding: 10px 12px !important;
            gap: 8px !important;
            border-radius: 10px !important;
          }
          .install-banner strong { font-size: 14px !important; }
          .install-banner p { font-size: 12px !important; margin: 2px 0 0 !important; }
          .install-banner button {
            flex: 1 1 auto;
            font-size: 13px !important;
            padding: 9px 10px !important;
            min-height: 40px !important;
          }
          .mobile-status-bar { display: grid !important; }
          .mobile-status-bar > div { min-width: 0; }
          .mobile-status-bar strong { display: block; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .tradepilot-feedback { align-items: center; display: flex; font-size: 0 !important; height: 38px; justify-content: center; padding: 0 !important; width: 38px; }
          .tradepilot-feedback::after { content: "?"; font-size: 16px; }
          .home-title { font-size: 42px !important; }
        }
      `}</style>
      <div className="app-container" style={styles.shell}>
        <header className="tradepilot-header" style={styles.header}>
          {/* Col 1 — Brand */}
          <div className="header-brand" style={styles.headerBrand}>
            <p style={styles.eyebrow}>Trade Pilot Alpha</p>
            <h1 className="tradepilot-title" style={styles.title}>Trade Pilot</h1>
            <p className="tradepilot-subtitle" style={styles.subtitle}>
              Plan trades. Manage risk. Avoid emotional entries.
            </p>
            <p className="tradepilot-positioning" style={styles.positioningText}>
              Trade Pilot is an execution assistant for futures traders.
            </p>
            <div className="tradepilot-header-meta" style={styles.headerMeta}>
              <span>{profile.mainMarket}</span>
              <span>{getConnectionStatusLabel(brokerConnection)}</span>
              <span>{session?.user ? session.user.email : "Guest workspace"}</span>
            </div>
          </div>

          {/* Col 2 — Market + price (mobile only, hidden on desktop via CSS) */}
          <div className="header-market-status">
            <div style={{ color: "#64748b", fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {profile.mainMarket}
            </div>
            <div style={{ color: "#e2e8f0", fontSize: "14px", fontWeight: 800 }}>
              {price ? formatPrice(price, profile.mainMarket) : "—"}
            </div>
          </div>

          {/* Col 3 — Desktop: auth + nav; Mobile: hamburger only */}
          <div className="tradepilot-top-actions" style={styles.topActions}>
            <div className="tradepilot-auth-actions" style={styles.authActions}>
              {session?.user ? (
                <>
                  <span style={styles.accountPill}>{session.user.user_metadata?.name || session.user.email}</span>
                  <button onClick={signOut} style={styles.authButton}>Log Out</button>
                </>
              ) : (
                <>
                  <span style={styles.accountPill}>Guest Mode</span>
                  <button onClick={() => setAuthModal("signup")} style={styles.authButton}>Sign Up</button>
                  <button onClick={() => setAuthModal("login")} style={styles.authButton}>Log In</button>
                </>
              )}
            </div>
            {streamerMode ? (
              <button onClick={() => setStreamerMode(false)} style={styles.secondaryButton}>Exit Streamer</button>
            ) : (
              navigationTabs.map((tab) => (
                <button
                  className="desktop-nav-item"
                  key={tab}
                  onClick={() => {
                    setActivePage(tab.toLowerCase());
                    setMobileMenuOpen(false);
                  }}
                  style={{ ...styles.secondaryButton, background: activePage === tab.toLowerCase() ? "#2563eb" : "#27272a" }}
                >
                  {tab}
                </button>
              ))
            )}
            {/* Hamburger — inside header, position:relative, no overlap */}
            <button
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
              className="mobile-menu-button"
              onClick={() => setMobileMenuOpen((o) => !o)}
              style={styles.menuButton}
              type="button"
            >
              {mobileMenuOpen ? (
                <span style={{ color: "#e2e8f0", fontSize: "22px", fontWeight: 300, lineHeight: 1 }}>✕</span>
              ) : (
                <>
                  <span style={styles.menuBar} />
                  <span style={styles.menuBar} />
                  <span style={styles.menuBar} />
                </>
              )}
            </button>
          </div>
        </header>
        <DashboardFrame
          activePage={activePage}
          brokerConnection={brokerConnection}
          discipline={discipline}
          engine={engine}
          journalEntries={journalEntries}
          layoutPrefs={layoutPrefs}
          profile={profile}
          setActivePage={setActivePage}
          setLayoutPrefs={setLayoutPrefs}
          setStreamerMode={setStreamerMode}
          signedIn={Boolean(session?.user)}
          streamerMode={streamerMode}
          watchlist={watchlist}
        >
        {!streamerMode ? <div style={styles.alphaBanner}>Trade Pilot Alpha - educational tool. Not financial advice.</div> : null}
        {!streamerMode ? <AlphaSignup /> : null}
        {!streamerMode && !session?.user ? (
          <div style={styles.guestPrompt}>
            <span>Create a free account to save your trading workspace.</span>
            <button onClick={() => setAuthModal("signup")} style={styles.authButton}>Sign Up</button>
          </div>
        ) : null}
        {!streamerMode && activePage === "dashboard" && !installBannerDismissed ? (
          <InstallBanner
            canInstall={Boolean(installPrompt)}
            onDismiss={dismissInstallBanner}
            onInstall={installApp}
            onInstructions={() => setActivePage("install")}
          />
        ) : null}
        {session?.user && !onboardingComplete ? (
          <OnboardingCard
            onDone={() => {
              localStorage.setItem(onboardingStorageKey, "true");
              setOnboardingComplete(true);
            }}
          />
        ) : null}

        {activePage === "home" ? (
          <HomePage
            signedIn={Boolean(session?.user)}
            onJoinAlpha={() => setAuthModal("signup")}
            onLaunch={() => setActivePage("dashboard")}
          />
        ) : null}
        {activePage === "dashboard" ? (
          <Dashboard
            activePosition={activePosition}
            activeTimeframe={activeTimeframe}
            activeTrade={activeTrade}
            addJournalEntry={addJournalEntry}
            applyAlert={applyAlert}
            applyQuickSetup={applyQuickSetup}
            autoPrice={autoPrice}
            brokerConnection={brokerConnection}
            candleHistory={candleHistory}
            chartPrefs={chartPrefs}
            chartResetSignal={chartResetSignal}
            chartTimeframe={chartTimeframe}
            connectionError={connectionError}
            contracts={contracts}
            debugMode={debugMode}
            isOnline={isOnline}
            lastTradeSetup={lastTradeSetup}
            lastTradeSetupByKey={lastTradeSetupByKey}
            onResetChart={onResetChart}
            setChartPrefs={setChartPrefs}
            setChartTimeframe={setChartTimeframe}
            dataSource={dataSource}
            webhookDebug={webhookDebug}
            direction={direction}
            discipline={discipline}
            engine={engine}
            entry={entry}
            fastMessage={fastMessage}
            journalEntries={journalEntries}
            layoutPrefs={layoutPrefs}
            lastUpdated={lastUpdated}
            notify={notify}
            price={price}
            priceHistory={priceHistory}
            priceSource={priceSource}
            priceStatus={priceStatus}
            plannedTrade={plannedTrade}
            profile={profile}
            quote={quote}
            tradingViewSignal={tradingViewSignal}
            breakoutLevel={breakoutLevel}
            levelBias={levelBias}
            pullbackSupport={pullbackSupport}
            recentHigh={recentHigh}
            resistance={resistance}
            riskPoints={riskPoints}
            runFastAction={runFastAction}
            setAutoPrice={setAutoPrice}
            setActiveTrade={setActiveTrade}
            setActivePosition={setActivePosition}
            setContracts={setContracts}
            setDataSource={setDataSource}
            setDirection={setDirection}
            setEntry={setEntry}
            setPlannedTrade={setPlannedTrade}
            setPrice={setPrice}
            setBreakoutLevel={setBreakoutLevel}
            setLevelBias={setLevelBias}
            setLayoutPrefs={setLayoutPrefs}
            setPullbackSupport={setPullbackSupport}
            setRecentHigh={setRecentHigh}
            setResistance={setResistance}
            setRiskPoints={setRiskPoints}
            setSupport={setSupport}
            streamerMode={streamerMode}
            support={support}
            updateDiscipline={updateDiscipline}
            updateProfile={updateProfile}
            watchlist={watchlist}
          />
        ) : null}
        {activePage === "connections" ? (
          <ConnectionsPage
            activePosition={activePosition}
            activateManualMode={activateManualMode}
            activateTradingViewMode={activateTradingViewMode}
            applyAlert={applyAlert}
            brokerConnection={brokerConnection}
            dataSource={dataSource}
            discipline={discipline}
            engine={engine}
            lastUpdated={lastUpdated}
            price={price}
            profile={profile}
            quote={quote}
            session={session}
            onAuthOpen={setAuthModal}
            notify={notify}
            saveConnectionSettings={savePersonalWorkspace}
            setActivePage={setActivePage}
            setPlannedTrade={setPlannedTrade}
            setActiveTrade={setActiveTrade}
            setPriceStatus={setPriceStatus}
            setWebhookDebug={setWebhookDebug}
            startDemoBroker={startDemoBroker}
            updateProfile={updateProfile}
            webhookDebug={webhookDebug}
          />
        ) : null}
        {activePage === "account" ? (
          <AccountPage
            authMessage={authMessage}
            isConfigured={isSupabaseConfigured}
            layoutPrefs={layoutPrefs}
            session={session}
            setLayoutPrefs={setLayoutPrefs}
            onAuthOpen={setAuthModal}
            signOut={signOut}
            syncStatus={syncStatus}
          />
        ) : null}
        {activePage === "install" ? <InstallPage canInstall={Boolean(installPrompt)} onInstall={installApp} /> : null}
        {activePage === "indicator" ? (
          <IndicatorPage
            applyAlert={applyAlert}
            notify={notify}
            onOpenWizardPage={() => setActivePage("connections")}
          />
        ) : null}
        {activePage === "journal" ? (
          <JournalPage
            activePosition={activePosition}
            addJournalEntry={addJournalEntry}
            discipline={discipline}
            engine={engine}
            journalEntries={journalEntries}
          />
        ) : null}
        {activePage === "profile" ? <ProfilePage profile={profile} updateProfile={updateProfile} /> : null}
        {activePage === "help" ? <HelpPage /> : null}
        {activePage === "support" ? (
          <SupportPage
            messages={supportMessages}
            onSubmit={(message) => setSupportMessages((current) => [{ ...message, stamp: new Date().toLocaleString() }, ...current])}
          />
        ) : null}
        {activePage === "settings" ? (
          <SettingsPage
            applyAlert={applyAlert}
            debugMode={debugMode}
            notificationPrefs={notificationPrefs}
            profile={profile}
            setDebugMode={setDebugMode}
            setNotificationPrefs={setNotificationPrefs}
            updateProfile={updateProfile}
          />
        ) : null}
        {activePage === "qa" ? (
          <QAChecklistPage
            activeTrade={activeTrade}
            brokerConnection={brokerConnection}
            dataSource={dataSource}
            isSupabaseReady={Boolean(supabase && isSupabaseConfigured)}
            layoutPrefs={layoutPrefs}
            plannedTrade={plannedTrade}
            profile={profile}
            webhookDebug={webhookDebug}
          />
        ) : null}
        <AppFooter />
        </DashboardFrame>
      </div>

      {/* Mobile nav overlay — tap-outside closes drawer */}
      {mobileMenuOpen ? (
        <button
          aria-label="Close mobile menu"
          className="mobile-overlay"
          onClick={() => setMobileMenuOpen(false)}
          style={styles.mobileOverlay}
          type="button"
        />
      ) : null}

      {/* Mobile nav drawer — fixed panel, z-index 10000, above chart, below modals */}
      <div
        className={`tradepilot-more-menu mobile-drawer${mobileMenuOpen ? "" : " closed"}`}
        style={styles.moreMenu}
      >
        {/* Auth — shown inside drawer on mobile (hidden from header) */}
        <div style={styles.drawerAuthSection}>
          {session?.user ? (
            <>
              <div style={styles.drawerUserPill}>{session.user.user_metadata?.name || session.user.email}</div>
              <button
                className="mobile-menu-item"
                onClick={() => { signOut(); setMobileMenuOpen(false); }}
                style={{ ...styles.moreMenuItem, color: "#f87171" }}
                type="button"
              >
                Log Out
              </button>
            </>
          ) : (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button
                onClick={() => { setAuthModal("signup"); setMobileMenuOpen(false); }}
                style={{ ...styles.authButton, flex: "1 1 auto" }}
                type="button"
              >
                Sign Up
              </button>
              <button
                onClick={() => { setAuthModal("login"); setMobileMenuOpen(false); }}
                style={{ ...styles.authButton, flex: "1 1 auto" }}
                type="button"
              >
                Log In
              </button>
            </div>
          )}
        </div>
        <div style={styles.drawerDivider} />
        {navigationTabs.map((tab) => (
          <button
            className="mobile-menu-item"
            key={`drawer-${tab}`}
            onClick={() => { setActivePage(tab.toLowerCase()); setMobileMenuOpen(false); }}
            style={{ ...styles.moreMenuItem, background: activePage === tab.toLowerCase() ? "rgba(37,99,235,.18)" : "transparent" }}
            type="button"
          >
            {tab}
          </button>
        ))}
        {moreTabs.map((tab) => (
          <button
            className="mobile-menu-item"
            key={`drawer-more-${tab}`}
            onClick={() => { setActivePage(tab.toLowerCase()); setMobileMenuOpen(false); }}
            style={styles.moreMenuItem}
            type="button"
          >
            {tab}
          </button>
        ))}
        {debugMode ? (
          <button
            className="mobile-menu-item"
            onClick={() => { setActivePage("dashboard"); setMobileMenuOpen(false); }}
            style={{ ...styles.moreMenuItem, color: "#fde68a" }}
            type="button"
          >
            Debug Panel
          </button>
        ) : null}
        <label style={styles.moreToggle}>
          <input
            checked={streamerMode}
            onChange={(e) => setStreamerMode(e.target.checked)}
            type="checkbox"
          />
          Streamer Mode
        </label>
      </div>

      {settingsOpen ? (
        <SettingsModal profile={profile} updateProfile={updateProfile} onClose={() => setSettingsOpen(false)} />
      ) : null}

      {!streamerMode ? <a className="tradepilot-feedback" href="mailto:support@tradepilot.app?subject=Trade%20Pilot%20Alpha%20Feedback" style={styles.feedbackButton}>Feedback</a> : null}
      {toastMessage ? <div style={styles.toast}>{toastMessage}</div> : null}

      {feedbackOpen ? (
        <FeedbackModal
          onClose={() => setFeedbackOpen(false)}
          onSubmit={(item) => {
            setFeedbackItems((current) => [{ ...item, stamp: new Date().toLocaleString() }, ...current]);
            setFeedbackOpen(false);
          }}
        />
      ) : null}

      {authModal ? (
        <AuthModal
          authMessage={authMessage}
          initialMode={authModal}
          isConfigured={isSupabaseConfigured}
          onClose={() => setAuthModal(null)}
          onSignedIn={() => {
            setAuthModal(null);
            setActivePage("dashboard");
          }}
          setAuthMessage={setAuthMessage}
          setProfile={setProfile}
        />
      ) : null}

      {!disclaimerAccepted ? (
        <DisclaimerModal
          onAccept={() => {
            localStorage.setItem(disclaimerStorageKey, "true");
            setDisclaimerAccepted(true);
          }}
        />
      ) : null}
    </div>
  );
}

function DisclaimerModal({ onAccept }) {
  return (
    <div style={{ ...styles.modalBackdrop, zIndex: 40 }}>
      <div style={styles.disclaimerModal}>
        <p style={styles.cardLabel}>Required Disclaimer</p>
        <h2 style={styles.sectionTitle}>Before You Use Trade Pilot</h2>
        <p style={styles.disclaimerText}>
          Trade Pilot is an educational trading assistant designed to help users organize trade ideas and manage risk.
        </p>
        <p style={styles.muted}>
          Trade Pilot is an educational execution assistant. It does not provide financial advice and does not place trades.
        </p>
        <p style={styles.muted}>
          Trade Pilot does not provide financial advice and does not guarantee profits.
        </p>
        <p style={styles.muted}>
          Trading futures, options, and other financial instruments involves substantial risk and may result in the loss of capital.
        </p>
        <p style={styles.muted}>
          Users are fully responsible for their trading decisions and outcomes.
        </p>
        <p style={styles.muted}>
          By using Trade Pilot, you acknowledge that you understand the risks associated with trading.
        </p>
        <button onClick={onAccept} style={styles.acceptButton}>
          I Understand
        </button>
      </div>
    </div>
  );
}

function DashboardFrame({
  activePage,
  brokerConnection,
  children,
  discipline,
  engine,
  journalEntries,
  layoutPrefs,
  profile,
  setActivePage,
  setLayoutPrefs,
  setStreamerMode,
  signedIn,
  streamerMode,
  watchlist,
}) {
  const useDashboardChrome = !streamerMode && (activePage !== "home" || signedIn);

  if (!useDashboardChrome) {
    return <main style={styles.standaloneMain}>{children}</main>;
  }

  return (
    <div className="desktop-dashboard">
      <DesktopSidebar activePage={activePage} setActivePage={setActivePage} setStreamerMode={setStreamerMode} />
      <main className="main-dashboard" style={styles.dashboardMain}>{children}</main>
      <RightInsightsPanel
        brokerConnection={brokerConnection}
        discipline={discipline}
        engine={engine}
        journalEntries={journalEntries}
        layoutPrefs={layoutPrefs}
        profile={profile}
        setLayoutPrefs={setLayoutPrefs}
        watchlist={watchlist}
      />
    </div>
  );
}

function DesktopSidebar({ activePage, setActivePage, setStreamerMode }) {
  const items = ["Home", "Dashboard", "Connections", "Journal", "Account", "Profile", "Settings", "QA"];

  return (
    <aside className="left-sidebar" style={styles.leftSidebar}>
      <div style={styles.sidebarBrand}>Trade Pilot</div>
      <nav style={styles.sidebarNav}>
        {items.map((item) => {
          const page = item.toLowerCase();
          return (
            <button
              key={item}
              onClick={() => setActivePage(page)}
              style={{ ...styles.sidebarButton, background: activePage === page ? "#1d4ed8" : "transparent" }}
            >
              {item}
            </button>
          );
        })}
      </nav>
      <button onClick={() => setStreamerMode(true)} style={styles.sidebarStreamerButton}>Streamer Mode</button>
    </aside>
  );
}

function RightInsightsPanel({ brokerConnection, discipline, engine, journalEntries, layoutPrefs, profile, setLayoutPrefs, watchlist }) {
  const fundedMetrics = getFundedAccountMetrics({ brokerConnection, discipline, profile });
  const fundedWarnings = buildFundedRuleWarnings({ brokerConnection, discipline, profile });
  const safeJournalEntries = safeArray(journalEntries);
  const safeWatchlist = normalizeWatchlistItems(watchlist, profile.mainMarket);
  const analytics = getJournalAnalytics(safeJournalEntries, discipline);
  const modeOptions = ["Simple", "Pro", "Streamer", "Prop Firm", "Journal Focus"];
  const cardToggles = [
    ["coach", "Trade Coach"],
    ["tradePlan", "Trade Plan"],
    ["chart", "Chart"],
    ["risk", "Risk Guard"],
    ["propFirmRules", "Prop Firm Rules"],
    ["journal", "Journal"],
    ["watchlist", "Watchlist"],
    ["alerts", "Alerts"],
    ["performanceStats", "Performance Stats"],
  ];

  return (
    <aside className="right-panel" style={styles.rightPanel}>
      <section style={styles.insightCard}>
        <p style={styles.cardLabel}>Customize Dashboard</p>
        <SelectField
          label="Layout"
          value={layoutPrefs.mode || "Pro"}
          options={modeOptions}
          onChange={(value) => setLayoutPrefs((current) => ({ ...current, mode: value }))}
        />
        <div style={styles.toggleList}>
          {cardToggles.map(([key, label]) => (
            <label key={key} style={styles.compactSwitchRow}>
              <input
                type="checkbox"
                checked={layoutPrefs[key] !== false}
                onChange={(event) => setLayoutPrefs((current) => ({ ...current, [key]: event.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      {layoutPrefs.watchlist !== false ? (
        <section style={styles.insightCard}>
          <p style={styles.cardLabel}>Watchlist</p>
          {safeWatchlist.slice(0, 5).map((item) => (
            <PlanItem key={item.id || item.symbol} title={item.symbol} text={item.notes || "Watching"} />
          ))}
        </section>
      ) : null}

      {layoutPrefs.alerts !== false ? (
        <section style={styles.insightCard}>
          <p style={styles.cardLabel}>Alerts</p>
          <PlanItem title="Connection" text={brokerConnection.connectionStatus || getConnectionStatusLabel(brokerConnection)} />
          <PlanItem title="Coach" text={engine.coachMessage} />
        </section>
      ) : null}

      {layoutPrefs.propFirmRules !== false ? (
        <section style={styles.insightCard}>
          <p style={styles.cardLabel}>Prop Firm Rules</p>
          <Metric label="Daily Loss Left" value={`$${fundedMetrics.dailyRiskRemaining.toFixed(2)}`} />
          <Metric label="Drawdown Left" value={`$${fundedMetrics.drawdownRemaining.toFixed(2)}`} />
          <div style={styles.warningStack}>
            {(fundedWarnings.length ? fundedWarnings : ["Inside guardrails."]).map((warning) => (
              <div key={warning} style={warning.includes("Inside") ? styles.coachPrompt : styles.warningBox}>{warning}</div>
            ))}
          </div>
        </section>
      ) : null}

      {layoutPrefs.performanceStats !== false ? (
        <section style={styles.insightCard}>
          <p style={styles.cardLabel}>Performance Stats</p>
          <Metric label="Win Rate" value={`${analytics.winRate}%`} />
          <Metric label="Total Trades" value={String(analytics.totalTrades)} />
          <Metric label="Profit Factor" value={analytics.profitFactor.toFixed(2)} />
        </section>
      ) : null}

      {layoutPrefs.journal !== false ? (
        <section style={styles.insightCard}>
          <p style={styles.cardLabel}>Journal Notes</p>
          <p style={styles.muted}>{safeJournalEntries[0]?.note || "No note yet."}</p>
        </section>
      ) : null}
    </aside>
  );
}

function CustomizeDashboardPanel({ layoutPrefs, notify, setLayoutPrefs }) {
  const modeOptions = ["Simple", "Pro", "Streamer", "Prop Firm", "Journal Focus"];
  const cardToggles = dashboardCardOptions;
  const cardOrder = normalizeCardOrder(layoutPrefs.cardOrder);
  const applyMode = (mode) => {
    setLayoutPrefs((current) => ({ ...current, ...layoutModePresets[mode], mode }));
    notify?.("Dashboard layout updated.", "success");
  };
  const moveCard = (key, direction) => {
    const index = cardOrder.indexOf(key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= cardOrder.length) return;
    const nextOrder = [...cardOrder];
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
    setLayoutPrefs((current) => ({ ...current, cardOrder: nextOrder }));
    notify?.("Dashboard layout updated.", "success");
  };

  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Customize Dashboard</p>
      <h2 style={styles.sectionTitle}>Layout and Cards</h2>
      <SelectField
        label="Layout Mode"
        value={layoutPrefs.mode || "Pro"}
        options={modeOptions}
        onChange={applyMode}
      />
      <div style={{ ...styles.formGrid, marginTop: "16px" }}>
        {cardToggles.map(([key, label]) => (
          <label key={key} style={styles.switchRow}>
            <input
              type="checkbox"
              checked={layoutPrefs[key] !== false}
              onChange={(event) => {
                setLayoutPrefs((current) => ({ ...current, [key]: event.target.checked }));
                notify?.("Dashboard layout updated.", "success");
              }}
            />
            {label}
          </label>
        ))}
      </div>
      <div style={{ ...styles.warningStack, marginTop: "16px" }}>
        {cardOrder.map((key, index) => {
          const label = cardToggles.find(([value]) => value === key)?.[1] || key;
          return (
            <div
              draggable
              key={key}
              onDragStart={(event) => event.dataTransfer.setData("text/plain", key)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const dragged = event.dataTransfer.getData("text/plain");
                const from = cardOrder.indexOf(dragged);
                const to = cardOrder.indexOf(key);
                if (from < 0 || to < 0 || from === to) return;
                const nextOrder = [...cardOrder];
                nextOrder.splice(from, 1);
                nextOrder.splice(to, 0, dragged);
                setLayoutPrefs((current) => ({ ...current, cardOrder: nextOrder }));
                notify?.("Dashboard layout updated.", "success");
              }}
              style={styles.draggableCardRow}
            >
              <span>{index + 1}. {label}</span>
              <span style={styles.inlineActions}>
                <button type="button" onClick={() => moveCard(key, -1)} style={styles.miniButton}>Up</button>
                <button type="button" onClick={() => moveCard(key, 1)} style={styles.miniButton}>Down</button>
              </span>
            </div>
          );
        })}
      </div>
      <p style={{ ...styles.muted, marginTop: "12px" }}>Preferences save locally and sync to Supabase when signed in.</p>
    </section>
  );
}

function PageTitle({ title, subtitle }) {
  return (
    <section style={styles.pageTitle}>
      <p style={styles.breadcrumb}>Trade Pilot / {title}</p>
      <h2 style={styles.pageTitleText}>{title}</h2>
      <p style={styles.pageSubtitle}>{subtitle}</p>
    </section>
  );
}

function HomePage({ onJoinAlpha, onLaunch, signedIn }) {
  return (
    <main style={styles.homePage}>
      <PageTitle
        title={signedIn ? "Trade Pilot Home" : "Home"}
        subtitle={signedIn ? "Welcome back. Choose your workspace." : "Welcome to Trade Pilot Alpha"}
      />
      <section style={styles.homeHero}>
        <div>
          <p style={styles.cardLabel}>Trade Pilot Alpha</p>
          <h2 className="home-title" style={styles.homeTitle}>Plan trades. Manage risk. Avoid emotional entries.</h2>
          <p style={styles.homeSubtitle}>Trade Pilot is a trading execution assistant for futures traders.</p>
          <div style={styles.heroActions}>
            <button onClick={onLaunch} style={styles.primaryHeroButton}>Launch App</button>
            <button onClick={onJoinAlpha} style={styles.secondaryHeroButton}>Join Alpha</button>
          </div>
        </div>
      </section>

      <section className="home-feature-grid" style={styles.productCardGrid}>
        <FeatureCard title="Risk Guard" text="Stay aware of size, loss limits, and overtrading." />
        <FeatureCard title="Trade Coach" text="Get plain-language prompts before and during a trade." />
        <FeatureCard title="Prop Firm Rules" text="Track drawdown pressure and daily risk rules." />
        <FeatureCard title="Journal & Stats" text="Save notes and review your execution habits." />
      </section>
    </main>
  );
}

function FeatureCard({ title, text }) {
  return (
    <section style={styles.softFeatureCard}>
      <h3 style={styles.featureTitle}>{title}</h3>
      <p style={styles.muted}>{text}</p>
    </section>
  );
}

function OnboardingCard({ onDone }) {
  return (
    <section className="onboarding-card" style={styles.onboardingCard}>
      <div>
        <p style={styles.cardLabel}>First Login</p>
        <h2 style={styles.sectionTitle}>Set up your workspace</h2>
      </div>
      <div style={styles.onboardingSteps}>
        <span>1. Choose your market</span>
        <span>2. Set your risk</span>
        <span>3. Generate your trade plan</span>
      </div>
      <button onClick={onDone} style={styles.settingsButton}>Got it</button>
    </section>
  );
}

function InstallBanner({ canInstall, onDismiss, onInstall, onInstructions }) {
  return (
    <section className="install-banner" style={styles.installBanner}>
      <div>
        <strong>Install Trade Pilot</strong>
        <p style={styles.installBannerText}>Add it to your home screen for a faster app-like experience.</p>
      </div>
      <div style={styles.installBannerActions}>
        <button onClick={canInstall ? onInstall : onInstructions} style={styles.installButton}>
          {canInstall ? "Install Trade Pilot" : "How to Install"}
        </button>
        <button onClick={onDismiss} style={styles.dismissButton}>Not now</button>
      </div>
    </section>
  );
}

function IndicatorPage({ applyAlert, notify, onOpenWizardPage }) {
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState("");
  const webhookUrl = "https://tradepilottool.com/api/webhook/tradingview";

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied to clipboard.");
    } catch {
      setStatus("Clipboard blocked. Select the text manually.");
    }
  };

  const sendTestSignal = async () => {
    if (sending) return;
    setSending(true);
    setStatus("Sending test signal...");
    const now = new Date();
    const payload = {
      symbol: "NQ1!",
      price: 22500.5,
      timeframe: "5",
      open: 22498.0,
      high: 22504.25,
      low: 22495.75,
      close: 22500.5,
      volume: 1240,
      signal: "price_update",
      timestamp: now.toISOString(),
    };
    const isLocalhost = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const apiBase = isLocalhost ? "https://tradepilottool.com" : "";
    try {
      const response = await fetch(`${apiBase}/api/webhook/tradingview`, {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok || result.ok === false) throw new Error(result.error || "Test signal failed.");
      applyAlert?.({ ...payload, candle: { open: payload.open, high: payload.high, low: payload.low, close: payload.close, volume: payload.volume, timeframe: payload.timeframe, timestamp: payload.timestamp } });
      setStatus("Test signal received. Check the dashboard.");
    } catch (error) {
      setStatus(error.message || "Test signal failed.");
      notify?.(error.message || "Test signal failed.", "failure");
    } finally {
      setSending(false);
    }
  };

  return (
    <main style={styles.installPage}>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Trade Pilot Signal Engine</p>
        <h2 style={styles.sectionTitle}>The TradingView indicator that powers Trade Pilot</h2>
        <p style={styles.muted}>Works with any TradingView symbol. No broker API required.</p>
        <p style={styles.muted}>The indicator detects support, resistance, breakouts, breakdowns, bounces, and rejections from your chart, then pushes the live OHLCV candle to Trade Pilot through a webhook alert. The dashboard, coach, and trade plan use this data as the source of truth.</p>
        <div style={{ ...styles.installBannerActions, marginTop: "12px" }}>
          <button onClick={onOpenWizardPage} style={styles.settingsButton}>Open Setup Wizard</button>
          <button onClick={sendTestSignal} disabled={sending} style={{ ...styles.secondaryButton, opacity: sending ? 0.6 : 1 }}>
            {sending ? "Sending..." : "Send Test Signal"}
          </button>
        </div>
        {status ? <p style={{ ...styles.muted, marginTop: "10px" }}>{status}</p> : null}
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Step 1 — Pine Script</p>
        <h2 style={styles.sectionTitle}>Copy the full indicator</h2>
        <p style={styles.muted}>Open the Pine Editor in TradingView, paste this code, click Save, then Add to chart.</p>
        <pre style={{ ...styles.sharePreview, fontSize: "11px", maxHeight: "260px", overflow: "auto" }}>{TRADE_PILOT_PINE_INDICATOR}</pre>
        <button onClick={() => copyText(TRADE_PILOT_PINE_INDICATOR)} style={styles.settingsButton}>Copy Full Indicator</button>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Step 2 — Webhook URL</p>
        <h2 style={styles.sectionTitle}>Paste this into the TradingView alert</h2>
        <pre style={styles.sharePreview}>{webhookUrl}</pre>
        <button onClick={() => copyText(webhookUrl)} style={styles.settingsButton}>Copy Webhook URL</button>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Step 3 — Alert Message</p>
        <h2 style={styles.sectionTitle}>OHLCV alert payload</h2>
        <p style={styles.muted}>The indicator already supplies these messages for each named alert. Use this template if you create a custom alert.</p>
        <pre style={{ ...styles.sharePreview, fontSize: "12px" }}>{TRADE_PILOT_ALERT_MESSAGE}</pre>
        <button onClick={() => copyText(TRADE_PILOT_ALERT_MESSAGE)} style={styles.settingsButton}>Copy Alert Message</button>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Troubleshooting</p>
        <h2 style={styles.sectionTitle}>Common fixes</h2>
        <PlanItem title="No signal received" text="Verify the webhook URL has no trailing whitespace and the alert is set to Once Per Bar Close (not 'Only Once')." />
        <PlanItem title="Wrong symbol on dashboard" text="The webhook trusts the symbol field. If TradingView sends 'NQ1!', the dashboard maps it to NQ. For custom symbols, set tick size and point value in Settings." />
        <PlanItem title="Price differs from chart" text="The indicator sends the bar close. Compare the dashboard's Last Candle close to the matching bar on TradingView — they should be identical." />
        <PlanItem title="Empty chart" text="Trade Pilot waits for at least one candle before drawing. Trigger a new bar in TradingView or click 'Send Test Signal' to verify the pipeline." />
        <PlanItem title="Compile error in Pine" text="Re-copy the indicator from this page. Pine Script v5 is required." />
      </section>
    </main>
  );
}

function InstallPage({ canInstall, onInstall }) {
  return (
    <main style={styles.installPage}>
      <section style={styles.installHero}>
        <div style={styles.installIconWrap}>
          <img src="/icons/icon-192.png" alt="Trade Pilot app icon" style={styles.installIcon} />
        </div>
        <div>
          <p style={styles.cardLabel}>Install App</p>
          <h2 style={styles.tradePlanTitle}>Install Trade Pilot</h2>
          <p style={styles.muted}>Plan trades. Manage risk. Avoid emotional entries from your phone or desktop.</p>
          <button onClick={onInstall} style={styles.generateButton}>
            {canInstall ? "Install Trade Pilot" : "Show Install Instructions"}
          </button>
        </div>
      </section>

      <section style={styles.mainGrid}>
        <div style={styles.card}>
          <p style={styles.cardLabel}>iPhone / iPad</p>
          <h2 style={styles.sectionTitle}>Add to Home Screen</h2>
          <PlanItem title="1. Open in Safari" text="Visit tradepilottool.com in Safari." />
          <PlanItem title="2. Tap Share" text="Use the Share button at the bottom of Safari." />
          <PlanItem title="3. Add to Home Screen" text="Choose Add to Home Screen, then tap Add." />
        </div>

        <div style={styles.card}>
          <p style={styles.cardLabel}>Android</p>
          <h2 style={styles.sectionTitle}>Install from Chrome</h2>
          <PlanItem title="1. Open in Chrome" text="Visit tradepilottool.com in Chrome." />
          <PlanItem title="2. Tap Install" text="Use the browser install prompt or menu." />
          <PlanItem title="3. Launch like an app" text="Trade Pilot will appear on your home screen." />
        </div>

        <div style={styles.card}>
          <p style={styles.cardLabel}>Desktop</p>
          <h2 style={styles.sectionTitle}>Install from Browser</h2>
          <PlanItem title="Chrome / Edge" text="Click the install icon in the address bar." />
          <PlanItem title="Offline support" text="Core app files are cached after the first visit." />
        </div>
      </section>
    </main>
  );
}

function AccountPage({ authMessage, isConfigured, layoutPrefs, onAuthOpen, session, setLayoutPrefs, signOut, syncStatus }) {
  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Account" subtitle="Manage login and subscription." />
      </div>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Personal Dashboard</p>
        <h2 style={styles.sectionTitle}>{session?.user ? "Your Trade Pilot Workspace" : "Save Your Workspace"}</h2>
        <p style={styles.muted}>
          Use Trade Pilot without logging in, or create an account to save settings, layouts, trade plans, journal entries, watchlists, and coach preferences.
        </p>
        <div style={{ ...styles.metricGrid, marginTop: "16px" }}>
          <Metric label="Auth" value={isConfigured ? "Supabase Ready" : "Supabase Not Configured"} tone={isConfigured ? "good" : "warn"} />
          <Metric label="Session" value={session?.user ? "Signed In" : "Local Mode"} />
          <Metric label="Sync" value={syncStatus} />
        </div>
      </section>

      {session?.user ? (
        <section style={styles.card}>
          <p style={styles.cardLabel}>Account</p>
          <h2 style={styles.sectionTitle}>{session.user.email}</h2>
          <PlanItem title="Saved Data" text="Profile, trade settings, active plans, journal entries, watchlist, and layout preferences sync to Supabase." />
          <PlanItem title="Broker Privacy" text="Broker data is private to this user. Broker passwords and API secrets stay server-side." />
          <button onClick={signOut} style={{ ...styles.dismissButton, marginTop: "16px" }}>Sign Out</button>
          {authMessage ? <p style={{ ...styles.muted, marginTop: "12px" }}>{authMessage}</p> : null}
        </section>
      ) : (
        <section style={styles.card}>
          <p style={styles.cardLabel}>Account Access</p>
          <h2 style={styles.sectionTitle}>Start in Guest Mode, Save When Ready</h2>
          <p style={styles.muted}>
            Guest mode saves to this browser only. Create a free account to sync your Trade Pilot workspace, settings, plans, and journal through Supabase.
          </p>
          <div style={styles.inlineActions}>
            <button onClick={() => onAuthOpen("signup")} style={styles.settingsButton}>Sign Up</button>
            <button onClick={() => onAuthOpen("login")} style={styles.dismissButton}>Log In</button>
          </div>
          {authMessage ? <p style={{ ...styles.muted, marginTop: "12px" }}>{authMessage}</p> : null}
        </section>
      )}

      <section style={styles.card}>
        <p style={styles.cardLabel}>Free vs Pro Planning</p>
        <h2 style={styles.sectionTitle}>Pre-Release Access</h2>
        <PlanItem title="Free" text="Manual trade plan, saved profile, and basic journal." />
        <PlanItem title="Pro Later" text="Live broker data, advanced chart, AI trade coach, analytics, TradingView Alerts, and custom layouts." />
        <PlanItem title="Payments" text="Not enabled yet." />
      </section>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Security</p>
        <h2 style={styles.sectionTitle}>Release Checklist</h2>
        <PlanItem title="Email confirmation" text="Keep enabled in Supabase Auth settings." />
        <PlanItem title="Leaked password protection" text="Enable in Supabase Auth password security." />
        <PlanItem title="Auth redirect" text="Use https://tradepilottool.com for confirmation and reset links." />
      </section>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Layout Customization</p>
        <h2 style={styles.sectionTitle}>Show / Hide Dashboard Cards</h2>
        <p style={{ ...styles.muted, marginBottom: "14px" }}>Reordering is reserved for later; these visibility preferences save to your database when signed in.</p>
        <div style={styles.formGrid}>
          {Object.keys(defaultLayout).filter((key) => key !== "mode").map((key) => (
            <label key={key} style={styles.switchRow}>
              <input
                type="checkbox"
                checked={layoutPrefs[key]}
                onChange={(event) => setLayoutPrefs((current) => ({ ...current, [key]: event.target.checked }))}
              />
              {key}
            </label>
          ))}
        </div>
      </section>
    </main>
  );
}

function AuthModal({ authMessage, initialMode, isConfigured, onClose, onSignedIn, setAuthMessage, setProfile }) {
  const [mode, setMode] = useState(initialMode || "login");
  const [form, setForm] = useState({
    accountType: "Personal Trading Account",
    confirmPassword: "",
    email: "",
    name: "",
    password: "",
    preferredMarket: "MNQ",
    rememberMe: true,
    traderType: "intermediate",
  });
  const [message, setMessage] = useState(authMessage || "");

  const submit = async (event) => {
    event.preventDefault();
    if (!isConfigured || !supabase) {
      setMessage("Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable accounts.");
      return;
    }

    try {
      if (mode === "signup") {
        if (form.password !== form.confirmPassword) {
          setMessage("Passwords do not match.");
          return;
        }

        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            emailRedirectTo: authRedirectUrl,
            data: {
              accountType: form.accountType,
              name: form.name,
              preferredMarket: form.preferredMarket,
              traderType: form.traderType,
            },
          },
        });
        if (error) throw error;
        const savedMarket = form.preferredMarket === "crypto" ? "BTC" : form.preferredMarket === "options" ? "SPY" : form.preferredMarket;
        setProfile((current) => ({
          ...current,
          accountType: form.accountType,
          mainMarket: savedMarket,
          traderExperienceLevel: form.traderType,
          traderName: form.name,
        }));
        setMessage("Check your email to verify your Trade Pilot account.");
        setAuthMessage("Check your email to verify your Trade Pilot account.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(form.email, { redirectTo: authRedirectUrl });
        if (error) throw error;
        setMessage("Password reset email sent.");
        setAuthMessage("Password reset email sent.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
        if (error) throw error;
        localStorage.setItem("tradePilotRememberLogin", String(form.rememberMe));
        setAuthMessage("Signed in. Loading your dashboard.");
        onSignedIn();
      }
    } catch (error) {
      setMessage(error.message || "Authentication failed.");
    }
  };

  return (
    <div style={{ ...styles.modalBackdrop, zIndex: 45 }}>
      <section style={styles.modal}>
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.cardLabel}>Account Access</p>
            <h2 style={styles.sectionTitle}>{mode === "signup" ? "Create Account" : mode === "reset" ? "Reset Password" : "Log In"}</h2>
          </div>
          <button onClick={onClose} style={styles.dismissButton}>Close</button>
        </div>
        <p style={styles.muted}>
          Supabase keeps each trader's workspace private. Broker credentials stay out of the frontend.
        </p>
      <div style={styles.segmentGroup}>
        <button onClick={() => setMode("login")} style={{ ...styles.segmentButton, background: mode === "login" ? "#2563eb" : "#27272a" }}>Login</button>
        <button onClick={() => setMode("signup")} style={{ ...styles.segmentButton, background: mode === "signup" ? "#2563eb" : "#27272a" }}>Signup</button>
        <button onClick={() => setMode("reset")} style={{ ...styles.segmentButton, background: mode === "reset" ? "#2563eb" : "#27272a" }}>Reset</button>
      </div>
      <form onSubmit={submit} style={styles.formGrid}>
        {mode === "signup" ? <Field label="Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} /> : null}
        <Field label="Email" type="email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
        {mode !== "reset" ? <Field label="Password" type="password" value={form.password} onChange={(value) => setForm((current) => ({ ...current, password: value }))} /> : null}
        {mode === "signup" ? <Field label="Confirm Password" type="password" value={form.confirmPassword} onChange={(value) => setForm((current) => ({ ...current, confirmPassword: value }))} /> : null}
        {mode === "signup" ? <SelectField label="Trader Type" value={form.traderType} options={["beginner", "intermediate", "advanced"]} onChange={(value) => setForm((current) => ({ ...current, traderType: value }))} /> : null}
        {mode === "signup" ? <SelectField label="Preferred Market" value={form.preferredMarket} options={["MNQ", "NQ", "ES", "MES", "crypto", "options"]} onChange={(value) => setForm((current) => ({ ...current, preferredMarket: value }))} /> : null}
        {mode === "signup" ? <SelectField label="Account Type" value={form.accountType} options={accountTypeOptions} onChange={(value) => setForm((current) => ({ ...current, accountType: value }))} /> : null}
        {mode === "login" ? (
          <label style={styles.switchRow}>
            <input
              type="checkbox"
              checked={form.rememberMe}
              onChange={(event) => setForm((current) => ({ ...current, rememberMe: event.target.checked }))}
            />
            Remember me
          </label>
        ) : null}
        <button style={styles.settingsButton}>{mode === "signup" ? "Create Account" : mode === "reset" ? "Send Reset Email" : "Log In"}</button>
      </form>
      {mode === "login" ? (
        <button onClick={() => setMode("reset")} style={{ ...styles.textButton, marginTop: "12px" }}>Forgot password?</button>
      ) : null}
      {message ? <p style={{ ...styles.muted, marginTop: "12px" }}>{message}</p> : null}
      </section>
    </div>
  );
}

function getEffectiveLayout(layoutPrefs = {}) {
  const mode = layoutPrefs.mode || "Pro";
  const preset = layoutModePresets[mode] || layoutModePresets.Pro;
  return { ...defaultLayout, ...preset, ...layoutPrefs, cardOrder: normalizeCardOrder(layoutPrefs.cardOrder || preset.cardOrder) };
}

function normalizeCardOrder(order = []) {
  const known = dashboardCardOptions.map(([key]) => key);
  const clean = safeArray(order).map(normalizeCardKey).filter((key) => known.includes(key));
  return [...clean, ...known.filter((key) => !clean.includes(key))];
}

function DashboardNextStep({ activeTrade, currentTimeframeSignal, dataSource, hasPlan, hasCandles, support, resistance, timeframe, onMarkActive }) {
  const hasLevels = Number.isFinite(Number(support)) && Number(support) > 0
    && Number.isFinite(Number(resistance)) && Number(resistance) > 0;
  const isTradingView = dataSource === "TradingView Webhook";
  const tf = timeframeLabel(timeframe);

  let message = null;
  let tone = "neutral";
  let action = null;

  if (activeTrade?.isActive) {
    message = "Trade active. Manage risk.";
    tone = "active";
  } else if (hasPlan) {
    message = "Plan ready. Mark active only after you enter.";
    tone = "ready";
    action = { label: "Mark Active", onClick: onMarkActive };
  } else if (isTradingView && !hasCandles) {
    message = `Waiting for TradingView candles on ${tf}.`;
    tone = "waiting";
  } else if (isTradingView && hasCandles && currentTimeframeSignal) {
    const dir = String(currentTimeframeSignal.direction || "").toUpperCase();
    const grade = currentTimeframeSignal.grade || "";
    message = `${grade}${dir ? ` ${dir}` : ""} setup detected on ${tf}. Review the plan.`;
    tone = "signal";
  } else if (isTradingView && hasCandles && !currentTimeframeSignal) {
    message = `No high-quality setup on ${tf} yet.`;
    tone = "neutral";
  } else if (dataSource && dataSource !== "Manual Mode" && !hasLevels) {
    message = `${dataSource} connected. Add support and resistance to generate a plan.`;
    tone = "neutral";
  } else if (hasLevels && !hasPlan) {
    message = "Levels set. Generate a plan or build one manually.";
    action = { label: "Build Plan", onClick: onMarkActive };
  } else {
    message = "Connect a data source, then add support and resistance levels to begin.";
  }

  const toneColor = {
    active: "#3b82f6",
    ready: "#10b981",
    signal: "#facc15",
    waiting: "#64748b",
    neutral: "#475569",
  }[tone] || "#475569";

  return (
    <div style={{ alignItems: "center", background: `${toneColor}12`, border: `1px solid ${toneColor}30`, borderRadius: "12px", display: "flex", fontSize: "13px", gap: "12px", justifyContent: "space-between", margin: "0 0 12px", padding: "10px 16px" }}>
      <span style={{ color: "#94a3b8" }}>{message}</span>
      {action ? (
        <button
          onClick={action.onClick}
          style={{ background: "#2563eb", border: "none", borderRadius: "8px", color: "#f8fafc", cursor: "pointer", fontSize: "12px", fontWeight: 900, padding: "6px 14px", whiteSpace: "nowrap" }}
        >{action.label}</button>
      ) : null}
    </div>
  );
}

function TimeframeSignalBadge({ currentTimeframeSignal, dataSource, symbol, timeframe }) {
  if (dataSource !== "TradingView Webhook") return null;
  const tf = timeframeLabel(timeframe);
  const sym = String(symbol || "").toUpperCase();
  if (!currentTimeframeSignal) {
    return (
      <div style={{ alignItems: "center", background: "rgba(15,23,42,.5)", border: "1px solid #1e293b", borderRadius: "8px", color: "#64748b", display: "flex", fontSize: "12px", fontWeight: 600, gap: "8px", marginBottom: "10px", padding: "6px 12px" }}>
        <span style={{ color: "#334155" }}>◦</span>
        {sym} · {tf} — No high-quality setup yet
      </div>
    );
  }
  const dir = String(currentTimeframeSignal.direction || "").toUpperCase();
  const grade = currentTimeframeSignal.grade || "";
  const age = currentTimeframeSignal.receivedAt ? new Date(currentTimeframeSignal.receivedAt).toLocaleTimeString() : "";
  const dirColor = dir === "LONG" ? "#10b981" : dir === "SHORT" ? "#f87171" : "#94a3b8";
  return (
    <div style={{ alignItems: "center", background: "rgba(15,23,42,.5)", border: "1px solid #1e3a5f", borderRadius: "8px", display: "flex", fontSize: "12px", fontWeight: 600, gap: "8px", marginBottom: "10px", padding: "6px 12px" }}>
      <span style={{ color: "#3b82f6" }}>●</span>
      <span style={{ color: "#94a3b8" }}>{sym} · {tf}</span>
      <span style={{ color: "#475569" }}>—</span>
      <span style={{ color: dirColor }}>{grade}{dir ? ` ${dir}` : " setup"}</span>
      {age ? <span style={{ color: "#334155", marginLeft: "auto" }}>{age}</span> : null}
    </div>
  );
}

function CoachScoreGrid({ disciplineGrade, setupGrade }) {
  const setupTone = setupGrade.grade === "A" ? "#10b981"
    : setupGrade.grade === "B+" || setupGrade.grade === "B" ? "#facc15"
    : setupGrade.grade === "C" ? "#f97316"
    : setupGrade.state === "no_data" || setupGrade.state === "price_only" || setupGrade.state === "no_zones" || setupGrade.state === "waiting_for_setup" ? "#64748b"
    : "#ef4444";
  const discTone = disciplineGrade.grade === "A" ? "#10b981" : disciplineGrade.grade === "B" ? "#facc15" : disciplineGrade.grade === "C" ? "#f97316" : "#ef4444";
  const mistake = disciplineGrade.mistakes[0] || "No active mistake patterns.";
  // For pre-grade states (no data, no zones, etc) suppress the "0/100" pill
  // since it's misleading — show only the friendly label/reason.
  const showScorePill = setupGrade.state === "valid" || setupGrade.state === "low_quality" || setupGrade.state === "invalid";
  return (
    <section style={{ display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", marginBottom: "14px" }}>
      <div style={{ background: "rgba(15,23,42,.78)", border: `1px solid ${setupTone}55`, borderRadius: "14px", padding: "12px 14px" }}>
        <p style={{ ...styles.cardLabel, margin: 0 }}>Setup Score</p>
        <div style={{ alignItems: "baseline", display: "flex", gap: "8px", marginTop: "4px" }}>
          <strong style={{ color: setupTone, fontSize: "26px", fontWeight: 950 }}>{setupGrade.grade}</strong>
          {showScorePill ? <span style={{ color: "#cbd5e1", fontSize: "13px" }}>{setupGrade.score}/100</span> : null}
        </div>
        <p style={{ color: "#94a3b8", fontSize: "12px", lineHeight: 1.4, margin: "6px 0 0" }}>{setupGrade.reason}</p>
      </div>
      <div style={{ background: "rgba(15,23,42,.78)", border: `1px solid ${discTone}55`, borderRadius: "14px", padding: "12px 14px" }}>
        <p style={{ ...styles.cardLabel, margin: 0 }}>Discipline Score</p>
        <div style={{ alignItems: "baseline", display: "flex", gap: "8px", marginTop: "4px" }}>
          <strong style={{ color: discTone, fontSize: "26px", fontWeight: 950 }}>{disciplineGrade.grade}</strong>
          <span style={{ color: "#cbd5e1", fontSize: "13px" }}>{disciplineGrade.score}/100</span>
        </div>
        <p style={{ color: "#94a3b8", fontSize: "12px", lineHeight: 1.4, margin: "6px 0 0" }}>{disciplineGrade.lesson}</p>
      </div>
      <div style={{ background: "rgba(15,23,42,.78)", border: "1px solid #334155", borderRadius: "14px", padding: "12px 14px" }}>
        <p style={{ ...styles.cardLabel, margin: 0 }}>Mistake Watch</p>
        <p style={{ color: "#fca5a5", fontSize: "13px", fontWeight: 800, margin: "6px 0 0" }}>{mistake}</p>
        {disciplineGrade.mistakes.length > 1 ? (
          <p style={{ color: "#94a3b8", fontSize: "12px", margin: "4px 0 0" }}>+{disciplineGrade.mistakes.length - 1} more pattern{disciplineGrade.mistakes.length > 2 ? "s" : ""}</p>
        ) : null}
      </div>
    </section>
  );
}

function SignalSourceCard({ activeSymbol, candleSeries, connectionError, currentPrice, dataSource, isOnline = true, priceSource, timeframe, tradingViewSignal }) {
  const lastCandle = Array.isArray(candleSeries) && candleSeries.length ? candleSeries[candleSeries.length - 1] : null;
  const sourceLabel = dataSource === "TradingView Webhook"
    ? "TradingView Webhook"
    : dataSource === "Demo Broker"
      ? "Demo Broker"
      : dataSource === "Market Data API"
        ? "Live Market Data (delayed)"
        : "Manual";
  const lastSignalText = tradingViewSignal
    ? (tradingViewSignal.timestamp
        ? `Last signal: ${new Date(tradingViewSignal.timestamp).toLocaleTimeString()} · ${Number(tradingViewSignal.price).toFixed(2)}`
        : `Last signal: ${Number(tradingViewSignal.price).toFixed(2)}`)
    : "Not received yet";
  const lastCandleText = lastCandle
    ? `O ${Number(lastCandle.open).toFixed(2)} · H ${Number(lastCandle.high).toFixed(2)} · L ${Number(lastCandle.low).toFixed(2)} · C ${Number(lastCandle.close).toFixed(2)}${lastCandle.timestamp ? ` · ${new Date(lastCandle.timestamp).toLocaleTimeString()}` : ""}`
    : "No candle data";
  const priceMismatch = tradingViewSignal && Number.isFinite(tradingViewSignal.price)
    && Number.isFinite(Number(currentPrice))
    && Math.abs(tradingViewSignal.price - Number(currentPrice)) / Math.max(1, Math.abs(tradingViewSignal.price)) > 0.001;
  let connectionLabel;
  let connectionTone;
  if (!isOnline) {
    connectionLabel = "Offline — reconnecting…";
    connectionTone = "#fca5a5";
  } else if (connectionError) {
    connectionLabel = `Retrying connection (${connectionError.count}× since ${new Date(connectionError.lastSeenAt).toLocaleTimeString()})`;
    connectionTone = "#fbbf24";
  } else if (dataSource === "TradingView Webhook" && !tradingViewSignal) {
    connectionLabel = "Waiting for TradingView alert";
    connectionTone = "#94a3b8";
  } else if (dataSource === "TradingView Webhook") {
    connectionLabel = "TradingView feed active";
    connectionTone = "#10b981";
  } else if (dataSource === "Demo Broker") {
    connectionLabel = "Demo feed active";
    connectionTone = "#94a3b8";
  } else {
    connectionLabel = "Manual mode";
    connectionTone = "#94a3b8";
  }
  return (
    <section style={{ background: "rgba(15,23,42,.78)", border: "1px solid #1e293b", borderRadius: "14px", display: "grid", gap: "8px", margin: "0 0 14px", padding: "12px 16px" }}>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "space-between" }}>
        <p style={{ ...styles.cardLabel, margin: 0 }}>Signal Source</p>
        <div style={{ alignItems: "center", display: "flex", gap: "10px" }}>
          <span style={{ color: connectionTone, fontSize: "12px", fontWeight: 800 }}>{connectionLabel}</span>
          <span style={{ color: priceMismatch ? "#fca5a5" : "#10b981", fontSize: "12px", fontWeight: 800 }}>
            {priceMismatch ? "Price out of sync — refreshing." : "In sync"}
          </span>
        </div>
      </div>
      <div style={{ display: "grid", gap: "4px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div><span style={styles.cardLabel}>Active Symbol</span><strong style={{ color: "#e2e8f0", display: "block" }}>{activeSymbol || "—"}</strong></div>
        <div><span style={styles.cardLabel}>Current Price</span><strong style={{ color: "#e2e8f0", display: "block" }}>{Number.isFinite(Number(currentPrice)) ? Number(currentPrice).toFixed(2) : "—"}</strong></div>
        <div><span style={styles.cardLabel}>Price Source</span><strong style={{ color: "#e2e8f0", display: "block" }}>{priceSource === "TradingView Webhook" ? "TradingView Webhook" : sourceLabel}</strong></div>
        <div><span style={styles.cardLabel}>Timeframe</span><strong style={{ color: "#e2e8f0", display: "block" }}>{timeframe || tradingViewSignal?.timeframe || "—"}</strong></div>
        <div style={{ gridColumn: "1 / -1" }}><span style={styles.cardLabel}>Last TradingView Signal</span><strong style={{ color: "#e2e8f0", display: "block", fontSize: "12px" }}>{lastSignalText}</strong></div>
        <div style={{ gridColumn: "1 / -1" }}><span style={styles.cardLabel}>Last Candle</span><strong style={{ color: "#e2e8f0", display: "block", fontSize: "12px" }}>{lastCandleText}</strong></div>
      </div>
    </section>
  );
}

function SignalDebugPanel({ applyAlert, chartOverlays, currentPrice, dataSource, lastUpdated, notify, priceSource, profile, timeframe, tradingViewSignal, webhookDebug, zoneDiagnostics }) {
  const [collapsed, setCollapsed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const debug = webhookDebug || {};
  const parsed = debug.parsedSignal || null;
  const tradeSetup = debug.lastTradeSetup || null;
  const rawPrice = tradingViewSignal && Number.isFinite(Number(tradingViewSignal.price)) ? Number(tradingViewSignal.price) : null;
  const parsedPrice = Number.isFinite(Number(currentPrice)) ? Number(currentPrice) : null;
  const mismatch = rawPrice !== null && parsedPrice !== null && Math.abs(rawPrice - parsedPrice) / Math.max(1, Math.abs(rawPrice)) > 0.001;
  const hasReceivedAtBackend = debug.received === "Yes" || Boolean(debug.lastReceivedAt);
  const frontendApplied = Boolean(tradingViewSignal);
  const frontendNotApplying = hasReceivedAtBackend && !frontendApplied;

  const feedStatus = debug.feedStatus || (debug.received === "Yes" ? "connected" : "waiting");
  const feedTone = feedStatus === "connected"
    ? { label: "Connected", color: "#10b981", bg: "rgba(16,185,129,.12)" }
    : feedStatus === "stale"
      ? { label: "Stale", color: "#f97316", bg: "rgba(249,115,22,.12)" }
      : feedStatus === "error"
        ? { label: "Error", color: "#ef4444", bg: "rgba(239,68,68,.12)" }
        : { label: "Waiting", color: "#facc15", bg: "rgba(250,204,21,.12)" };

  const lastReceivedLabel = debug.lastReceivedAt
    ? new Date(debug.lastReceivedAt).toLocaleString()
    : (debug.updated || lastUpdated || "—");

  const lastCandleLabel = debug.lastCandleTime
    ? new Date(debug.lastCandleTime).toLocaleString()
    : "—";

  // High-low range — surfaces "TradingView is only sending flat candle data"
  // when the alert pushes a single price per bar instead of true OHLC.
  const hlRange = (Number.isFinite(parsed?.high) && Number.isFinite(parsed?.low))
    ? Math.abs(Number(parsed.high) - Number(parsed.low))
    : null;
  const refPrice = Number.isFinite(parsed?.close)
    ? Math.abs(Number(parsed.close))
    : (Number.isFinite(parsedPrice) ? Math.abs(parsedPrice) : 0);
  const flatRangeThreshold = Math.max(0.01, refPrice * 0.0001);
  const flatCandle = hlRange !== null && hlRange < flatRangeThreshold;

  const sendLocalTestSignal = async () => {
    if (sending) return;
    setSending(true);
    setSendStatus("Sending test signal...");
    const now = new Date();
    const payload = {
      symbol: "NQ",
      price: 27444.25,
      timeframe: "1",
      open: 27440,
      high: 27450,
      low: 27435,
      close: 27444.25,
      volume: 1000,
      relativeVolume: 1.8,
      poc: 27430.5,
      nearestFvgType: "bullish",
      nearestFvgTop: 27460.0,
      nearestFvgBottom: 27448.75,
      signal: "price_update",
      timestamp: now.toISOString(),
    };
    const isLocalhost = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const apiBase = isLocalhost ? "https://tradepilottool.com" : "";
    try {
      const response = await fetch(`${apiBase}/api/webhook/tradingview`, {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        throw new Error(result.error || `Test signal failed (HTTP ${response.status}).`);
      }
      applyAlert?.({
        ...payload,
        candle: {
          open: payload.open,
          high: payload.high,
          low: payload.low,
          close: payload.close,
          volume: payload.volume,
          timeframe: payload.timeframe,
          timestamp: payload.timestamp,
        },
      });
      setSendStatus("Test signal sent. Dashboard, candle, and chart should now be updated.");
      notify?.("Local test signal applied.", "success");
    } catch (error) {
      setSendStatus(error.message || "Test signal failed.");
      notify?.(error.message || "Test signal failed.", "failure");
    } finally {
      setSending(false);
    }
  };

  const rowLabel = { color: "#94a3b8", display: "block", fontSize: "10px", letterSpacing: ".08em", marginBottom: "2px", textTransform: "uppercase" };
  const rowValue = { color: "#e2e8f0", display: "block", fontSize: "13px", fontWeight: 700, wordBreak: "break-word" };

  return (
    <section style={{ background: "rgba(15,23,42,.7)", border: "1px solid #1e293b", borderRadius: "12px", margin: "0 0 14px", padding: "14px 16px" }}>
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "space-between", marginBottom: collapsed ? 0 : "10px" }}>
        <p style={{ ...styles.cardLabel, margin: 0 }}>TradingView Signal Debug</p>
        <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
          <span style={{ background: feedTone.bg, border: `1px solid ${feedTone.color}55`, borderRadius: "999px", color: feedTone.color, fontSize: "11px", fontWeight: 800, letterSpacing: ".06em", padding: "3px 10px", textTransform: "uppercase" }}>
            Feed: {feedTone.label}
          </span>
          <button
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand debug panel" : "Collapse debug panel"}
            onClick={() => setCollapsed((value) => !value)}
            style={{ background: "transparent", border: "1px solid #334155", borderRadius: "8px", color: "#cbd5e1", cursor: "pointer", fontSize: "11px", fontWeight: 800, padding: "4px 10px" }}
            type="button"
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>

      {collapsed ? null : (
      <>
      <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <div><span style={rowLabel}>Last received</span><span style={rowValue}>{lastReceivedLabel}</span></div>
        <div><span style={rowLabel}>Parsed symbol</span><span style={rowValue}>{parsed?.symbol || tradingViewSignal?.symbol || debug.symbol || "—"}</span></div>
        <div><span style={rowLabel}>Parsed price</span><span style={rowValue}>{Number.isFinite(parsed?.price) ? parsed.price.toFixed(2) : "—"}</span></div>
        <div><span style={rowLabel}>Parsed signal type</span><span style={rowValue}>{parsed?.signal || "—"}</span></div>
        <div><span style={rowLabel}>Parsed grade</span><span style={rowValue}>{parsed?.grade || "—"}</span></div>
        <div><span style={rowLabel}>Parsed direction</span><span style={rowValue}>{parsed?.direction || "—"}</span></div>
        <div><span style={rowLabel}>Open / High</span><span style={rowValue}>{Number.isFinite(parsed?.open) ? parsed.open : "—"} / {Number.isFinite(parsed?.high) ? parsed.high : "—"}</span></div>
        <div><span style={rowLabel}>Low / Close</span><span style={rowValue}>{Number.isFinite(parsed?.low) ? parsed.low : "—"} / {Number.isFinite(parsed?.close) ? parsed.close : "—"}</span></div>
        <div><span style={rowLabel}>High − Low range</span><span style={rowValue}>{hlRange === null ? "—" : hlRange.toFixed(4)}</span></div>
        <div><span style={rowLabel}>Candle count</span><span style={rowValue}>{debug.candleCount ?? 0}</span></div>
        <div><span style={rowLabel}>Last candle time</span><span style={rowValue}>{lastCandleLabel}</span></div>
        <div><span style={rowLabel}>Active timeframe</span><span style={rowValue}>{tradingViewSignal?.timeframe || parsed?.timeframe || timeframe || "—"}</span></div>
        <div><span style={rowLabel}>Price source</span><span style={rowValue}>{priceSource || dataSource || "—"}</span></div>
      </div>

      <div style={{ marginTop: "12px" }}>
        <span style={rowLabel}>Last trade_setup signal</span>
        {tradeSetup ? (
          <span style={rowValue}>
            {tradeSetup.grade || "?"} {tradeSetup.direction || "?"} @ {Number.isFinite(tradeSetup.price) ? tradeSetup.price.toFixed(2) : "—"} · {tradeSetup.timestamp ? new Date(tradeSetup.timestamp).toLocaleString() : "—"}
          </span>
        ) : (
          <span style={rowValue}>None received yet.</span>
        )}
      </div>

      <div style={{ marginTop: "12px" }}>
        <span style={rowLabel}>Last raw payload</span>
        <pre style={{ background: "rgba(2,6,23,.85)", border: "1px solid #1e293b", borderRadius: "8px", color: "#cbd5e1", fontSize: "11px", margin: "4px 0 0", maxHeight: "180px", overflow: "auto", padding: "8px 10px" }}>
          {debug.rawPayload ? JSON.stringify(debug.rawPayload, null, 2) : "No payload yet."}
        </pre>
      </div>

      <div style={{ borderTop: "1px solid #1e293b", marginTop: "14px", paddingTop: "12px" }}>
        <p style={{ ...styles.cardLabel, margin: "0 0 8px" }}>Chart Overlays (after applyAlert)</p>
        <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <div>
            <span style={rowLabel}>POC</span>
            <span style={{ ...rowValue, color: chartOverlays.poc !== null && Number.isFinite(chartOverlays.poc) ? "#22d3ee" : "#475569" }}>
              {chartOverlays.poc !== null && Number.isFinite(chartOverlays.poc) ? Number(chartOverlays.poc).toFixed(2) : "—"}
            </span>
          </div>
          <div>
            <span style={rowLabel}>Rel Volume</span>
            <span style={{ ...rowValue, color: chartOverlays.relVol !== null && Number.isFinite(chartOverlays.relVol) ? (chartOverlays.relVol >= 1.5 ? "#86efac" : "#94a3b8") : "#475569" }}>
              {chartOverlays.relVol !== null && Number.isFinite(chartOverlays.relVol) ? `${Number(chartOverlays.relVol).toFixed(2)}x` : "—"}
            </span>
          </div>
          <div>
            <span style={rowLabel}>FVG Type</span>
            <span style={{ ...rowValue, color: chartOverlays.fvgType === "bearish" ? "#f87171" : chartOverlays.fvgType === "bullish" ? "#86efac" : "#475569" }}>
              {chartOverlays.fvgType || "—"}
            </span>
          </div>
          <div>
            <span style={rowLabel}>FVG Top</span>
            <span style={rowValue}>
              {chartOverlays.fvgTop !== null && Number.isFinite(chartOverlays.fvgTop) ? Number(chartOverlays.fvgTop).toFixed(2) : "—"}
            </span>
          </div>
          <div>
            <span style={rowLabel}>FVG Bottom</span>
            <span style={rowValue}>
              {chartOverlays.fvgBottom !== null && Number.isFinite(chartOverlays.fvgBottom) ? Number(chartOverlays.fvgBottom).toFixed(2) : "—"}
            </span>
          </div>
          <div>
            <span style={rowLabel}>Payload has poc?</span>
            <span style={{ ...rowValue, color: debug.rawPayload && "poc" in debug.rawPayload ? "#86efac" : "#f87171" }}>
              {"poc" in (debug.rawPayload || {}) ? `Yes — ${debug.rawPayload.poc}` : "No"}
            </span>
          </div>
          <div>
            <span style={rowLabel}>Payload has relVol?</span>
            <span style={{ ...rowValue, color: debug.rawPayload && "relativeVolume" in debug.rawPayload ? "#86efac" : "#f87171" }}>
              {"relativeVolume" in (debug.rawPayload || {}) ? `Yes — ${debug.rawPayload.relativeVolume}` : "No"}
            </span>
          </div>
          <div>
            <span style={rowLabel}>Payload has FVG?</span>
            <span style={{ ...rowValue, color: debug.rawPayload && "nearestFvgType" in debug.rawPayload ? "#86efac" : "#64748b" }}>
              {"nearestFvgType" in (debug.rawPayload || {}) ? `Yes — ${debug.rawPayload.nearestFvgType}` : "No (trade_setup only)"}
            </span>
          </div>
          <div>
            <span style={rowLabel}>FVG Quality</span>
            <span style={{ ...rowValue, color: chartOverlays.fvgQuality === "A" ? "#86efac" : chartOverlays.fvgQuality === "B" ? "#fde68a" : "#94a3b8" }}>
              {chartOverlays.fvgQuality || "—"}
            </span>
          </div>
          <div>
            <span style={rowLabel}>FVG Score</span>
            <span style={{ ...rowValue, color: chartOverlays.fvgScore !== null && Number.isFinite(chartOverlays.fvgScore) ? (chartOverlays.fvgScore >= 85 ? "#86efac" : chartOverlays.fvgScore >= 70 ? "#fde68a" : "#94a3b8") : "#475569" }}>
              {chartOverlays.fvgScore !== null && Number.isFinite(chartOverlays.fvgScore) ? `${Number(chartOverlays.fvgScore).toFixed(0)} / 100` : "—"}
            </span>
          </div>
        </div>
      </div>

      {feedStatus === "stale" ? (
        <p style={{ background: "rgba(249,115,22,.1)", border: "1px solid rgba(249,115,22,.3)", borderRadius: "8px", color: "#fdba74", fontSize: "12px", fontWeight: 700, margin: "10px 0 0", padding: "8px 10px" }}>
          TradingView feed stale. Check alert is running.
        </p>
      ) : null}
      {frontendNotApplying ? (
        <p style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.3)", borderRadius: "8px", color: "#fecaca", fontSize: "12px", fontWeight: 700, margin: "10px 0 0", padding: "8px 10px" }}>
          Backend received signal, frontend not applying it.
        </p>
      ) : null}
      {flatCandle ? (
        <p style={{ background: "rgba(234,179,8,.1)", border: "1px solid rgba(234,179,8,.3)", borderRadius: "8px", color: "#fde68a", fontSize: "12px", fontWeight: 700, margin: "10px 0 0", padding: "8px 10px" }}>
          TradingView is only sending flat candle data. Switch the alert to "Once Per Bar Close" so each bar delivers real OHLC.
        </p>
      ) : null}
      {mismatch ? (
        <p style={{ color: "#fca5a5", fontSize: "12px", fontWeight: 800, margin: "8px 0 0" }}>
          Mismatch: parsed price differs from latest signal.
        </p>
      ) : null}

      {zoneDiagnostics ? (
        <div style={{ borderTop: "1px solid #1e293b", marginTop: "14px", paddingTop: "12px" }}>
          <p style={{ ...styles.cardLabel, margin: "0 0 8px" }}>Zone Diagnostics</p>
          <div style={{ display: "grid", gap: "10px", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            <div><span style={rowLabel}>Total candles</span><span style={rowValue}>{zoneDiagnostics.totalCandles ?? 0}</span></div>
            <div><span style={rowLabel}>Valid candles</span><span style={rowValue}>{zoneDiagnostics.validCandles ?? 0}</span></div>
            <div><span style={rowLabel}>Session candles</span><span style={{ ...rowValue, color: (zoneDiagnostics.sessionCandleCount ?? 0) >= 20 ? "#5eead4" : "#fde68a" }}>{zoneDiagnostics.sessionCandleCount ?? 0}</span></div>
            <div><span style={rowLabel}>Rejected</span><span style={rowValue}>{zoneDiagnostics.rejected ?? 0}{zoneDiagnostics.rejected ? ` (broken: ${zoneDiagnostics.rejectedReasons?.broken_ohlc ?? 0}, band: ${zoneDiagnostics.rejectedReasons?.out_of_band ?? 0})` : ""}</span></div>
            <div><span style={rowLabel}>Symbol / TF</span><span style={rowValue}>{zoneDiagnostics.symbol || "—"} · {zoneDiagnostics.timeframe || "—"}</span></div>
            <div><span style={rowLabel}>Current price</span><span style={rowValue}>{Number.isFinite(zoneDiagnostics.currentPrice) ? Number(zoneDiagnostics.currentPrice).toFixed(2) : "—"}</span></div>
            <div><span style={rowLabel}>Session start (NY)</span><span style={rowValue}>{zoneDiagnostics.sessionStartLabel || "—"}</span></div>
            <div><span style={rowLabel}>Open range candles</span><span style={rowValue}>{zoneDiagnostics.openRangeCandles ?? 0}</span></div>
            <div><span style={rowLabel}>Open range</span><span style={rowValue}>{zoneDiagnostics.openRangeAvailable && Number.isFinite(zoneDiagnostics.openRangeLow) ? `${Number(zoneDiagnostics.openRangeLow).toFixed(2)} - ${Number(zoneDiagnostics.openRangeHigh).toFixed(2)}` : "Unavailable"}</span></div>
            <div><span style={rowLabel}>Session H / L</span><span style={rowValue}>{Number.isFinite(zoneDiagnostics.sessionHigh) ? `${Number(zoneDiagnostics.sessionHigh).toFixed(2)} / ${Number(zoneDiagnostics.sessionLow).toFixed(2)}` : "—"}</span></div>
            <div><span style={rowLabel}>Swing H / L count</span><span style={rowValue}>{zoneDiagnostics.swingHighs ?? 0} / {zoneDiagnostics.swingLows ?? 0}</span></div>
            <div><span style={rowLabel}>Zone source</span><span style={rowValue}>{zoneDiagnostics.zoneSource || "—"}</span></div>
            <div><span style={rowLabel}>Zones valid</span><span style={{ ...rowValue, color: zoneDiagnostics.zonesValid ? "#5eead4" : "#fca5a5" }}>{zoneDiagnostics.zonesValid ? "Yes" : `No${zoneDiagnostics.zoneReason ? ` — ${zoneDiagnostics.zoneReason}` : ""}`}</span></div>
          </div>
          {zoneDiagnostics.sessionCandleCount > 0 && zoneDiagnostics.sessionCandleCount < 20 ? (
            <p style={{ background: "rgba(56,189,248,.08)", border: "1px solid rgba(56,189,248,.3)", borderRadius: "8px", color: "#7dd3fc", fontSize: "12px", fontWeight: 700, margin: "10px 0 0", padding: "8px 10px" }}>
              Need {20 - zoneDiagnostics.sessionCandleCount} more session candles for reliable zones.
            </p>
          ) : zoneDiagnostics.totalCandles > 0 && zoneDiagnostics.validCandles < 20 ? (
            <p style={{ background: "rgba(56,189,248,.08)", border: "1px solid rgba(56,189,248,.3)", borderRadius: "8px", color: "#7dd3fc", fontSize: "12px", fontWeight: 700, margin: "10px 0 0", padding: "8px 10px" }}>
              Need more candles for reliable zones.
            </p>
          ) : null}
          {zoneDiagnostics.openRangeAvailable === false ? (
            <p style={{ background: "rgba(148,163,184,.08)", border: "1px solid rgba(148,163,184,.25)", borderRadius: "8px", color: "#cbd5e1", fontSize: "12px", fontWeight: 700, margin: "10px 0 0", padding: "8px 10px" }}>
              Open range unavailable for this session.
            </p>
          ) : null}
          {zoneDiagnostics.totalCandles > 0 && zoneDiagnostics.rejected > 0 && zoneDiagnostics.validCandles === 0 ? (
            <p style={{ background: "rgba(234,179,8,.08)", border: "1px solid rgba(234,179,8,.3)", borderRadius: "8px", color: "#fde68a", fontSize: "12px", fontWeight: 700, margin: "10px 0 0", padding: "8px 10px" }}>
              Collecting fresh TradingView candles…
            </p>
          ) : null}
          {zoneDiagnostics.sessionCandleCount === 0 && zoneDiagnostics.validCandles === 0 && zoneDiagnostics.totalCandles === 0 ? (
            <p style={{ background: "rgba(56,189,248,.08)", border: "1px solid rgba(56,189,248,.3)", borderRadius: "8px", color: "#7dd3fc", fontSize: "12px", fontWeight: 700, margin: "10px 0 0", padding: "8px 10px" }}>
              Collecting fresh TradingView candles…
            </p>
          ) : null}
        </div>
      ) : null}

      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "14px" }}>
        <button
          disabled={sending}
          onClick={sendLocalTestSignal}
          style={{
            background: sending ? "#1e293b" : "#2563eb",
            border: "1px solid #3b82f6",
            borderRadius: "10px",
            color: "#f8fafc",
            cursor: sending ? "not-allowed" : "pointer",
            fontSize: "13px",
            fontWeight: 800,
            opacity: sending ? 0.6 : 1,
            padding: "8px 14px",
          }}
        >
          {sending ? "Sending..." : "Send Local Test Signal"}
        </button>
        {sendStatus ? <span style={{ color: "#94a3b8", fontSize: "12px" }}>{sendStatus}</span> : null}
      </div>
      </>
      )}
    </section>
  );
}

function MarkTradeActiveModal({ applyQuickSetup, notify, price, profile, resistance, setActiveTrade, setActivePosition, setPlannedTrade, support, onAddLevels, onClose }) {
  const [view, setView] = useState("checklist");
  const [form, setForm] = useState({
    contracts: String(profile.defaultContracts || 1),
    direction: "long",
    entry: price > 0 ? String(price) : "",
    runner: "",
    stop: "",
    tp1: "",
    tp2: "",
  });

  const hasPrice = price > 0;
  const hasSupport = Number.isFinite(Number(support)) && Number(support) > 0;
  const hasResistance = Number.isFinite(Number(resistance)) && Number(resistance) > 0;

  const e = Number(form.entry), s = Number(form.stop), t1 = Number(form.tp1);
  const t2 = Number(form.tp2), r = Number(form.runner);
  let validationError = null;
  if (!Number.isFinite(e) || e <= 0) validationError = "Entry price is required.";
  else if (!Number.isFinite(s) || s <= 0) validationError = "Stop loss is required.";
  else if (!Number.isFinite(t1) || t1 <= 0) validationError = "Target 1 is required.";
  else if (form.direction === "long") {
    if (s >= e) validationError = "Long trade invalid: stop must be below entry.";
    else if (t1 <= e) validationError = "Long trade invalid: TP1 must be above entry.";
    else if (t2 > 0 && t2 <= t1) validationError = "Long trade invalid: TP2 must be above TP1.";
    else if (r > 0 && r <= (t2 > 0 ? t2 : t1)) validationError = "Long trade invalid: Runner must be above TP2.";
  } else {
    if (s <= e) validationError = "Short trade invalid: stop must be above entry.";
    else if (t1 >= e) validationError = "Short trade invalid: TP1 must be below entry.";
    else if (t2 > 0 && t2 >= t1) validationError = "Short trade invalid: TP2 must be below TP1.";
    else if (r > 0 && r >= (t2 > 0 ? t2 : t1)) validationError = "Short trade invalid: Runner must be below TP2.";
  }
  const manualPlanValid = !validationError && e > 0 && s > 0 && t1 > 0;

  const handleAutoGenerate = () => {
    if (!hasPrice) {
      notify("Connect a data source to get the current price.", "failure");
      return;
    }
    const offset = Math.max(10, Math.round(price * 0.002 * 4) / 4);
    const effSupport = hasSupport ? Number(support) : price - offset;
    const effResistance = hasResistance ? Number(resistance) : price + offset;
    const isShort = form.direction === "short";
    let plan;
    if (isShort) {
      const nextEntry = effSupport - 2;
      plan = { direction: "short", entry: nextEntry, stop: effSupport + 15, trim1: nextEntry - 20, trim2: nextEntry - 40, runner: nextEntry - 80 };
    } else {
      const nextEntry = effResistance + 2;
      plan = { direction: "long", entry: nextEntry, stop: effResistance - 15, trim1: nextEntry + 20, trim2: nextEntry + 40, runner: nextEntry + 80 };
    }
    const normalized = normalizeTradePlan({ ...plan, contracts: Number(profile.defaultContracts) || 1, status: "active" });
    const nextTrade = activeTradeFromPlan(normalized, { currentPrice: price, market: profile?.mainMarket, source: "auto", status: "active" });
    setPlannedTrade?.({ ...normalized, status: "active" });
    setActiveTrade(nextTrade);
    setActivePosition({ ...normalized, openedAt: nextTrade.openedAt, status: "active" });
    notify("Trade plan generated", "success");
    onClose();
  };

  const handleSaveAndMarkActive = () => {
    if (!manualPlanValid) return;
    const plan = normalizeTradePlan({
      contracts: Number(form.contracts) || 1,
      direction: form.direction,
      entry: e,
      runner: r > 0 ? r : undefined,
      stop: s,
      trim1: t1,
      trim2: t2 > 0 ? t2 : undefined,
    });
    const nextTrade = activeTradeFromPlan(plan, { currentPrice: price, market: profile.mainMarket, source: "manual", status: "active" });
    setPlannedTrade?.({ ...plan, status: "active" });
    setActiveTrade(nextTrade);
    setActivePosition({ ...plan, openedAt: nextTrade.openedAt, status: "active" });
    notify("Trade marked active.", "success");
    onClose();
  };

  const field = (label, key, placeholder) => (
    <label key={key} style={{ color: "#a1a1aa", display: "grid", fontSize: "13px", gap: "4px" }}>
      {label}
      <input
        placeholder={placeholder}
        step="0.25"
        style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", color: "#f8fafc", fontSize: "14px", fontWeight: 700, padding: "8px 12px", width: "100%" }}
        type="number"
        value={form[key]}
        onChange={(ev) => setForm((f) => ({ ...f, [key]: ev.target.value }))}
      />
    </label>
  );

  const btn = (label, onClick, variant = "primary", disabled = false) => (
    <button
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={{
        background: disabled ? "#1c1c1e" : variant === "primary" ? "#2563eb" : variant === "success" ? "#16a34a" : variant === "ghost" ? "transparent" : "#0f172a",
        border: variant === "ghost" ? "none" : "1px solid " + (disabled ? "#334155" : variant === "primary" ? "#3b82f6" : variant === "success" ? "#22c55e" : "#334155"),
        borderRadius: "10px",
        color: disabled ? "#52525b" : "#f8fafc",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: "14px",
        fontWeight: 900,
        padding: "11px 18px",
        textAlign: "center",
      }}
    >{label}</button>
  );

  const checkRow = (ok, label) => (
    <div key={label} style={{ alignItems: "center", display: "flex", gap: "10px", padding: "5px 0" }}>
      <span style={{ color: ok ? "#22c55e" : "#ef4444", fontSize: "15px" }}>{ok ? "✓" : "✗"}</span>
      <span style={{ color: ok ? "#94a3b8" : "#f8fafc", fontSize: "13px" }}>{label}</span>
    </div>
  );

  return (
    <div
      style={{ alignItems: "center", background: "rgba(0,0,0,.82)", display: "flex", inset: 0, justifyContent: "center", padding: "16px", position: "fixed", zIndex: 10000 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#05070d", border: "1px solid #1e293b", borderRadius: "20px", boxShadow: "0 32px 80px rgba(0,0,0,.7)", maxHeight: "92vh", maxWidth: "520px", overflowY: "auto", padding: "28px", width: "100%" }}
        onClick={(ev) => ev.stopPropagation()}
      >
        {view === "checklist" ? (
          <>
            <p style={{ color: "#f8fafc", fontSize: "18px", fontWeight: 950, margin: "0 0 6px" }}>Create a Trade Plan First</p>
            <p style={{ color: "#64748b", fontSize: "13px", margin: "0 0 20px" }}>You need a valid plan before marking a trade active.</p>
            <div style={{ marginBottom: "20px" }}>
              {checkRow(hasPrice, `Current price${hasPrice ? ` — ${price}` : " — connect a data source"}`)}
              {checkRow(hasSupport, `Support level${hasSupport ? ` — ${support}` : " — add a support level in the panel"}`)}
              {checkRow(hasResistance, `Resistance level${hasResistance ? ` — ${resistance}` : " — add a resistance level in the panel"}`)}
            </div>
            {(!hasSupport || !hasResistance) ? (
              <p style={{ background: "rgba(59,130,246,.08)", border: "1px solid rgba(59,130,246,.25)", borderRadius: "10px", color: "#93c5fd", fontSize: "12px", marginBottom: "16px", padding: "10px 14px" }}>
                No S/R levels set — plan will be generated from current price ({price > 0 ? price : "no price"}).
              </p>
            ) : null}
            <div style={{ display: "grid", gap: "8px" }}>
              {btn("Auto Generate Plan", handleAutoGenerate, "primary")}
              {btn("Manual Plan Builder", () => setView("manual"), "secondary")}
              {onAddLevels ? btn("Add Levels", onAddLevels, "secondary") : null}
              {btn("Cancel", onClose, "ghost")}
            </div>
          </>
        ) : (
          <>
            <p style={{ color: "#f8fafc", fontSize: "18px", fontWeight: 950, margin: "0 0 6px" }}>Manual Plan Builder</p>
            <p style={{ color: "#64748b", fontSize: "13px", margin: "0 0 20px" }}>Fill in your plan. Validation runs instantly.</p>
            <div style={{ display: "grid", gap: "12px", marginBottom: "16px" }}>
              <label style={{ color: "#a1a1aa", display: "grid", fontSize: "13px", gap: "4px" }}>
                Direction
                <div style={{ display: "flex", gap: "8px" }}>
                  {["long", "short"].map((d) => (
                    <button
                      key={d}
                      onClick={() => setForm((f) => ({ ...f, direction: d }))}
                      style={{
                        background: form.direction === d ? (d === "long" ? "#166534" : "#7f1d1d") : "#0f172a",
                        border: "1px solid " + (form.direction === d ? (d === "long" ? "#22c55e" : "#ef4444") : "#334155"),
                        borderRadius: "8px", color: "#f8fafc", cursor: "pointer", flex: 1, fontWeight: 900, padding: "8px",
                      }}
                    >{d === "long" ? "Long" : "Short"}</button>
                  ))}
                </div>
              </label>
              {field("Entry", "entry", price > 0 ? String(price) : "e.g. 21500")}
              {field("Stop Loss", "stop", form.direction === "long" ? "Below entry" : "Above entry")}
              {field("Target 1 (TP1) *", "tp1", form.direction === "long" ? "Above entry" : "Below entry")}
              {field("Target 2 (TP2) — optional", "tp2", "Optional")}
              {field("Runner — optional", "runner", "Optional")}
              {field("Contracts", "contracts", "1")}
            </div>
            {validationError ? (
              <p style={{ background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.35)", borderRadius: "10px", color: "#fca5a5", fontSize: "13px", marginBottom: "16px", padding: "10px 14px" }}>{validationError}</p>
            ) : manualPlanValid ? (
              <p style={{ background: "rgba(34,197,94,.08)", border: "1px solid rgba(34,197,94,.25)", borderRadius: "10px", color: "#86efac", fontSize: "13px", marginBottom: "16px", padding: "10px 14px" }}>Plan is valid. Ready to save and mark active.</p>
            ) : null}
            <div style={{ display: "grid", gap: "8px" }}>
              {btn("Save Plan & Mark Active", handleSaveAndMarkActive, "success", !manualPlanValid)}
              {btn("Back", () => setView("checklist"), "secondary")}
              {btn("Cancel", onClose, "ghost")}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function LevelsModal({ notify, resistance, setResistance, setSupport, support, onClose }) {
  const [supportInput, setSupportInput] = useState(Number.isFinite(Number(support)) && Number(support) > 0 ? String(support) : "");
  const [resistanceInput, setResistanceInput] = useState(Number.isFinite(Number(resistance)) && Number(resistance) > 0 ? String(resistance) : "");

  const handleSave = () => {
    const nextSupport = Number(supportInput);
    const nextResistance = Number(resistanceInput);
    if (!Number.isFinite(nextSupport) || nextSupport <= 0 || !Number.isFinite(nextResistance) || nextResistance <= 0) {
      notify?.("Enter valid support and resistance prices.", "failure");
      return;
    }
    if (nextResistance <= nextSupport) {
      notify?.("Resistance must be above support.", "failure");
      return;
    }
    setSupport(nextSupport);
    setResistance(nextResistance);
    notify?.("Levels saved.", "success");
    onClose();
  };

  return (
    <div
      style={{ alignItems: "center", background: "rgba(0,0,0,.82)", display: "flex", inset: 0, justifyContent: "center", padding: "16px", position: "fixed", zIndex: 10000 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#05070d", border: "1px solid #1e293b", borderRadius: "20px", boxShadow: "0 32px 80px rgba(0,0,0,.7)", maxWidth: "440px", padding: "28px", width: "100%" }}
        onClick={(ev) => ev.stopPropagation()}
      >
        <p style={{ color: "#f8fafc", fontSize: "18px", fontWeight: 950, margin: "0 0 6px" }}>Add Levels</p>
        <p style={{ color: "#64748b", fontSize: "13px", margin: "0 0 20px" }}>Set support and resistance so the auto plan can size entry, stop, and targets.</p>
        <div style={{ display: "grid", gap: "12px", marginBottom: "16px" }}>
          <label style={{ color: "#a1a1aa", display: "grid", fontSize: "13px", gap: "4px" }}>
            Support
            <input
              placeholder="e.g. 22480"
              step="0.25"
              style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", color: "#f8fafc", fontSize: "14px", fontWeight: 700, padding: "8px 12px", width: "100%" }}
              type="number"
              value={supportInput}
              onChange={(ev) => setSupportInput(ev.target.value)}
            />
          </label>
          <label style={{ color: "#a1a1aa", display: "grid", fontSize: "13px", gap: "4px" }}>
            Resistance
            <input
              placeholder="e.g. 22520"
              step="0.25"
              style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "8px", color: "#f8fafc", fontSize: "14px", fontWeight: 700, padding: "8px 12px", width: "100%" }}
              type="number"
              value={resistanceInput}
              onChange={(ev) => setResistanceInput(ev.target.value)}
            />
          </label>
        </div>
        <div style={{ display: "grid", gap: "8px" }}>
          <button
            onClick={handleSave}
            style={{ background: "#2563eb", border: "1px solid #3b82f6", borderRadius: "10px", color: "#f8fafc", cursor: "pointer", fontSize: "14px", fontWeight: 900, padding: "11px 18px" }}
          >Save Levels</button>
          <button
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: "13px", fontWeight: 700, padding: "8px" }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Dashboard({
  activePosition,
  activeTimeframe,
  activeTrade,
  addJournalEntry,
  applyAlert,
  applyQuickSetup,
  autoPrice,
  brokerConnection,
  candleHistory,
  chartPrefs,
  chartResetSignal,
  chartTimeframe,
  connectionError,
  contracts,
  debugMode,
  isOnline,
  lastTradeSetup,
  lastTradeSetupByKey,
  webhookDebug,
  onResetChart,
  setChartPrefs,
  setChartTimeframe,
  dataSource,
  direction,
  discipline,
  engine,
  entry,
  fastMessage,
  journalEntries,
  layoutPrefs,
  lastUpdated,
  notify,
  price,
  priceHistory,
  priceSource,
  priceStatus,
  plannedTrade,
  profile,
  quote,
  breakoutLevel,
  levelBias,
  pullbackSupport,
  recentHigh,
  resistance,
  riskPoints,
  runFastAction,
  setAutoPrice,
  setContracts,
  setDataSource,
  setDirection,
  setEntry,
  setPrice,
  setPlannedTrade,
  setActiveTrade,
  setActivePosition,
  setBreakoutLevel,
  setLevelBias,
  setLayoutPrefs,
  setPullbackSupport,
  setRecentHigh,
  setResistance,
  setRiskPoints,
  setSupport,
  streamerMode,
  support,
  tradingViewSignal,
  updateDiscipline,
  updateProfile,
  watchlist,
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [journalNote, setJournalNote] = useState("");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [markActiveModalOpen, setMarkActiveModalOpen] = useState(false);
  const [setupDirection, setSetupDirection] = useState("Long");
  const [setupType, setSetupType] = useState("Pullback");
  const safeJournalEntries = safeArray(journalEntries);
  const safeWatchlist = normalizeWatchlistItems(watchlist, profile.mainMarket);
  const effectiveLayout = getEffectiveLayout(layoutPrefs);
  // Per-timeframe signal isolation: only the signal that matches the currently
  // displayed symbol+timeframe feeds the coach, plan, and setup score.
  // Signals for other timeframes are ignored until the user switches to them.
  const activeChartKeyTf = activeTimeframe || chartTimeframe || "5";
  const activeChartKey = makeChartKey(profile.mainMarket, activeChartKeyTf);
  const currentTimeframeSignal = useMemo(() => {
    const stored = lastTradeSetupByKey?.[activeChartKey];
    if (!stored || !Number.isFinite(stored.receivedAt)) return null;
    const expiryMs = getSignalExpiryMs(Number(activeChartKeyTf) || 5);
    if (Date.now() - stored.receivedAt > expiryMs) return null;
    return stored;
  }, [lastTradeSetupByKey, activeChartKey, activeChartKeyTf]);
  const rangePad = Math.max(20, price * 0.01);
  const rangeMin = Math.max(0, price - rangePad);
  const rangeMax = price + rangePad;
  const levelCoach = analyzeKeyLevels({
    breakoutLevel,
    currentPrice: price,
    direction,
    marketBias: levelBias,
    pullbackSupport,
    recentHigh,
    resistance,
    support,
  });
  const baseCandleSeries = useMemo(
    () => {
      const exact = pickCandleSeries(candleHistory, profile.mainMarket, activeTimeframe);
      if (exact.length) return exact;
      return pickFinestCandleSeries(candleHistory, profile.mainMarket);
    },
    [candleHistory, profile.mainMarket, activeTimeframe],
  );
  const chartTimeframeMinutes = parseTimeframeMinutes(chartTimeframe);
  const rawLiveCandleSeries = useMemo(
    () => aggregateCandles(baseCandleSeries, chartTimeframeMinutes),
    [baseCandleSeries, chartTimeframeMinutes],
  );
  // Single source of truth for "candles we trust right now". Drops broken OHLC
  // and bars whose price is implausibly far from the current quote (stale data
  // from a previous symbol, mock seed, or pre-TradingView session).
  const candleFilterResult = useMemo(
    () => filterRealisticCandles(rawLiveCandleSeries, {
      symbol: profile.mainMarket,
      currentPrice: price,
      timeframeMinutes: chartTimeframeMinutes,
    }),
    [rawLiveCandleSeries, profile.mainMarket, price, chartTimeframeMinutes],
  );
  const liveCandleSeries = candleFilterResult.valid;
  const sessionAnchorMs = useMemo(
    () => getSessionAnchorMs({ candles: liveCandleSeries }),
    [liveCandleSeries],
  );
  const displayedTimeframe = timeframeLabel(chartTimeframe);
  const hasLiveCandles = liveCandleSeries.length >= 6;
  const autoSR = useMemo(
    () => detectAutoSRZones(liveCandleSeries, {
      currentPrice: price,
      market: profile.mainMarket,
      timeframeMinutes: chartTimeframeMinutes,
      sessionAnchorMs,
    }),
    [liveCandleSeries, price, profile.mainMarket, chartTimeframeMinutes, sessionAnchorMs],
  );
  // Zone engines always receive validated, session-scoped candles only.
  // Synthetic fallbacks (chartDataToCandles, buildChartData) are no longer
  // passed to zone detection — they were the source of wildly wrong levels.
  const zoneDetection = useMemo(
    () => detectKeyLevelsFromCandles(liveCandleSeries, { entry, price, resistance, support, sessionAnchorMs }),
    [liveCandleSeries, entry, price, resistance, support, sessionAnchorMs],
  );
  const marketStructure = useMemo(
    () => analyzeMarketStructure(liveCandleSeries, { price, resistance, support, sessionAnchorMs }),
    [liveCandleSeries, price, resistance, support, sessionAnchorMs],
  );
  const enrichedZoneDetection = useMemo(() => {
    const base = {
      ...zoneDetection,
      sessionHigh: marketStructure.sessionHigh ?? zoneDetection.sessionHigh,
      sessionLow: marketStructure.sessionLow ?? zoneDetection.sessionLow,
      swingHighs: marketStructure.swingHighs,
      swingLows: marketStructure.swingLows,
      vwap: marketStructure.vwap,
      liquiditySweepHigh: marketStructure.liquiditySweepHigh,
      liquiditySweepLow: marketStructure.liquiditySweepLow,
      marketStructure: marketStructure.marketStructure,
      zonesValid: true,
      zoneReason: "",
    };

    const clearZoneFields = () => {
      delete base.supportZoneLow;
      delete base.supportZoneHigh;
      delete base.supportLevel;
      delete base.resistanceZoneLow;
      delete base.resistanceZoneHigh;
      delete base.resistanceLevel;
      delete base.supportZone;
      delete base.resistanceZone;
      delete base.middleZone;
      delete base.middleZoneLow;
      delete base.middleZoneHigh;
    };

    if (autoSR.zonesValid && autoSR.supportZone && autoSR.resistanceZone) {
      base.supportZoneLow = autoSR.supportZone.min;
      base.supportZoneHigh = autoSR.supportZone.max;
      base.supportLevel = autoSR.supportZone.center;
      base.resistanceZoneLow = autoSR.resistanceZone.min;
      base.resistanceZoneHigh = autoSR.resistanceZone.max;
      base.resistanceLevel = autoSR.resistanceZone.center;
      base.supportZone = `${autoSR.supportZone.min.toFixed(2)} - ${autoSR.supportZone.max.toFixed(2)}`;
      base.resistanceZone = `${autoSR.resistanceZone.min.toFixed(2)} - ${autoSR.resistanceZone.max.toFixed(2)}`;
      const midLow = Number((autoSR.supportZone.center + (autoSR.resistanceZone.center - autoSR.supportZone.center) * 0.38).toFixed(2));
      const midHigh = Number((autoSR.supportZone.center + (autoSR.resistanceZone.center - autoSR.supportZone.center) * 0.62).toFixed(2));
      base.middleZoneLow = midLow;
      base.middleZoneHigh = midHigh;
      base.middleZone = `${midLow.toFixed(2)} - ${midHigh.toFixed(2)}`;
      base.sessionHigh = autoSR.sessionHigh ?? base.sessionHigh;
      base.sessionLow = autoSR.sessionLow ?? base.sessionLow;
      base.candleTrend = autoSR.trend;
      base.candleCount = autoSR.candleCount;
      base.source = "tradingview-candles";
    } else if (autoSR.zoneReason) {
      base.zonesValid = false;
      base.zoneReason = autoSR.zoneReason;
      base.compressed = autoSR.compressed === true;
      base.sessionHigh = autoSR.sessionHigh ?? base.sessionHigh;
      base.sessionLow = autoSR.sessionLow ?? base.sessionLow;
      clearZoneFields();
    }

    // Final unified validation against current price + minimum distance.
    // Catches: support above price, resistance below price, zones too compressed.
    if (base.zonesValid !== false) {
      const finalCheck = validateZones({
        supportZone: { center: Number(base.supportLevel) },
        resistanceZone: { center: Number(base.resistanceLevel) },
        currentPrice: Number(price),
        market: profile.mainMarket,
        timeframeMinutes: chartTimeframeMinutes,
      });
      if (!finalCheck.valid) {
        base.zonesValid = false;
        base.zoneReason = finalCheck.reason;
        base.compressed = finalCheck.reason.startsWith("Zones too compressed");
        clearZoneFields();
      }
    }

    // Validate manual support/resistance state against current price + min distance.
    // If state values are bad and we don't already have valid auto zones, surface that.
    const manualSupport = Number(support);
    const manualResistance = Number(resistance);
    const hasManualLevels = Number.isFinite(manualSupport) && manualSupport > 0
      && Number.isFinite(manualResistance) && manualResistance > 0;
    if (hasManualLevels && Number.isFinite(Number(price)) && Number(price) > 0 && base.zonesValid !== true) {
      const manualValidation = validateZones({
        supportZone: { center: manualSupport },
        resistanceZone: { center: manualResistance },
        currentPrice: Number(price),
        market: profile.mainMarket,
        timeframeMinutes: chartTimeframeMinutes,
      });
      if (!manualValidation.valid) {
        base.zonesValid = false;
        base.zoneReason = manualValidation.reason;
        base.compressed = manualValidation.reason.startsWith("Zones too compressed");
        clearZoneFields();
      }
    }

    return base;
  }, [zoneDetection, marketStructure, autoSR, support, resistance, price, profile.mainMarket, chartTimeframeMinutes]);

  // Telemetry surfaced in the Signal Debug panel so users can see exactly why
  // a zone is or isn't trustworthy.
  const zoneDiagnostics = useMemo(() => {
    const sessionCandleCount = Number.isFinite(sessionAnchorMs)
      ? liveCandleSeries.filter((c) => {
          const ts = c?.timestamp ? new Date(c.timestamp).getTime() : NaN;
          return Number.isFinite(ts) && ts >= sessionAnchorMs;
        }).length
      : 0;
    return {
      totalCandles: rawLiveCandleSeries.length,
      validCandles: liveCandleSeries.length,
      sessionCandleCount,
      rejected: candleFilterResult.rejected,
      rejectedReasons: candleFilterResult.reasons,
      symbol: profile.mainMarket,
      timeframe: activeTimeframe || chartTimeframe,
      currentPrice: price,
      sessionStartMs: sessionAnchorMs,
      sessionStartLabel: sessionAnchorMs ? new Date(sessionAnchorMs).toLocaleString() : null,
      openRangeAvailable: zoneDetection.openRangeAvailable !== false,
      openRangeCandles: Number(zoneDetection.openRangeCandles ?? 0),
      openRangeHigh: zoneDetection.openRangeHigh ?? null,
      openRangeLow: zoneDetection.openRangeLow ?? null,
      sessionHigh: enrichedZoneDetection.sessionHigh ?? null,
      sessionLow: enrichedZoneDetection.sessionLow ?? null,
      swingHighs: Array.isArray(marketStructure.swingHighs) ? marketStructure.swingHighs.length : 0,
      swingLows: Array.isArray(marketStructure.swingLows) ? marketStructure.swingLows.length : 0,
      zoneSource: enrichedZoneDetection.source || zoneDetection.source || "unknown",
      zonesValid: enrichedZoneDetection.zonesValid !== false,
      zoneReason: enrichedZoneDetection.zoneReason || "",
    };
  }, [rawLiveCandleSeries.length, liveCandleSeries, candleFilterResult, profile.mainMarket, activeTimeframe, chartTimeframe, price, sessionAnchorMs, zoneDetection, enrichedZoneDetection, marketStructure]);

  const marketSpec = marketSpecs[profile.mainMarket] ?? customMarketSpec;
  const activeBias = normalizeActiveBias(levelBias);
  const autoTradePlan = getAutoTradePlan({
    accountSize: Number(profile.accountSize || 0),
    activeBias,
    contracts,
    dailyPnl: discipline.dailyPnl,
    marketSpec,
    marketStructure,
    maxContracts: Number(profile.maxContracts || contracts),
    maxDailyLoss: Number(profile.maxDailyLoss || 0),
    maxRisk: Number(profile.maxRiskPerTrade || 0),
    price,
    resistance,
    support,
    tradingViewSignal: currentTimeframeSignal,
    zoneDetection: enrichedZoneDetection,
  });
  const fallbackPlan = {
    contracts,
    direction,
    entry,
    runner: engine.runner,
    setupType: "Manual fallback",
    stop: engine.smartStop,
    target: engine.runner,
    trim1: engine.trim1,
    trim2: engine.trim2,
  };
  const activeTradePlan = buildActiveTradePlan({
    activeBias,
    activePosition,
    autoTradePlan,
    fallbackPlan,
    lastUpdated,
    plannedTrade,
    price,
    source: dataSource,
  });
  const activePlanValidation = activeTradePlan.direction === "none"
    ? { valid: false, reason: activeTradePlan.message || "No trade. Wait for confirmation." }
    : validateTradePlan(activeTradePlan);
  const visualPlan = activeTradePlan.direction === "none" ? normalizeTradePlan(fallbackPlan, fallbackPlan) : activeTradePlan;
  const missedEntry = getMissedEntryMessage({ currentPrice: price, plan: visualPlan });
  const rewardRisk = calculateRewardRisk({ plan: visualPlan, pointValue: marketSpec.pointValue });
  const tradeGrade = getTradeGrade({
    activeBias,
    contracts: visualPlan.contracts ?? contracts,
    dailyPnl: discipline.dailyPnl,
    direction: visualPlan.direction,
    entry: visualPlan.entry,
    maxContracts: profile.maxContracts,
    maxDailyLoss: profile.maxDailyLoss,
    price,
    rewardRisk,
    stop: visualPlan.stop,
    support,
    resistance,
    zoneDetection: enrichedZoneDetection,
  });
  const displayTradeGrade = activeTradePlan.direction === "none" || activePlanValidation.valid === false
    ? { letter: "No Trade", reason: activePlanValidation.reason || "Waiting for valid setup.", score: 0 }
    : tradeGrade;
  const setupGrade = useMemo(() => gradeSetup({
    activeBias,
    candleCount: liveCandleSeries.length,
    contracts: visualPlan.contracts ?? contracts,
    dailyPnl: discipline.dailyPnl,
    dataFresh: dataSource === "TradingView Webhook" || dataSource === "Demo Broker",
    direction: visualPlan.direction || "long",
    entry: visualPlan.entry,
    hasCandles: liveCandleSeries.length >= 6,
    hasLevels: Number.isFinite(Number(support)) && Number(support) > 0 && Number.isFinite(Number(resistance)) && Number(resistance) > 0,
    maxContracts: profile.maxContracts,
    maxDailyLoss: profile.maxDailyLoss,
    price,
    resistance,
    rewardRisk,
    stop: visualPlan.stop,
    support,
    webhookSetupScore: currentTimeframeSignal?.setupScore ?? null,
    webhookSetupGrade: currentTimeframeSignal?.grade ?? null,
    zoneDetection: enrichedZoneDetection,
  }), [activeBias, liveCandleSeries.length, visualPlan.contracts, contracts, discipline.dailyPnl, dataSource, visualPlan.direction, visualPlan.entry, visualPlan.stop, support, resistance, profile.maxContracts, profile.maxDailyLoss, price, rewardRisk, currentTimeframeSignal, enrichedZoneDetection]);
  const disciplineGrade = useMemo(() => gradeDiscipline({
    activeTrade,
    discipline,
    journalEntries: safeJournalEntries,
    plan: visualPlan,
    profile,
  }), [activeTrade, discipline, safeJournalEntries, visualPlan, profile]);
  // Block trade activation any time the setup score isn't a real B/B+/A.
  // Includes the new pre-grade states (no_data, price_only, no_zones, waiting_for_setup).
  const tradeBlockedByGrade = setupGrade.state !== "valid" || setupGrade.grade === "D" || setupGrade.grade === "Invalid";
  const fundedMetrics = getFundedAccountMetrics({ brokerConnection, discipline, profile });
  const fundedWarnings = buildFundedRuleWarnings({
    brokerConnection: {
      ...brokerConnection,
      position: brokerConnection.position || { contracts: visualPlan.contracts ?? contracts },
    },
    discipline,
    profile,
  });
  const simpleBias = activeBias === "bullish" ? "BULLISH" : activeBias === "bearish" ? "BEARISH" : "NEUTRAL";
  const setupName = activeTradePlan.source || (plannedTrade || activePosition ? `${setupType} ${setupDirection}` : "Auto Zone");
  const hasPlan = activeTradePlan.direction !== "none" && activePlanValidation.valid && !rewardRisk.invalid;
  const coachDecision = getCoachDecision({ activeBias, activePosition, activeTradePlan, price, resistance, support, validation: activePlanValidation });
  const liveCoach = getLiveCoachMessage({ activeBias, activeTrade, activePosition, activeTradePlan, autoTradePlan, discipline, engine, price, profile, support, resistance, tradeGrade: displayTradeGrade, visualPlan, zoneDetection: enrichedZoneDetection });

  // ── Unified trade state ─────────────────────────────────────────────
  // Single source of truth. All dashboard cards must derive from this
  // object so they cannot disagree (e.g. "Plan: Waiting" + "Active: TP2").
  const tradeState = useMemo(() => {
    const plan = activeTradePlan;
    const direction = plan?.direction === "short" ? "short" : "long";
    const validationOk = activePlanValidation.valid === true && plan?.direction !== "none" && !rewardRisk.invalid;

    const planLevels = {
      entry: Number(plan?.entry),
      stop: Number(plan?.stop),
      tp1: Number(plan?.trim1 ?? plan?.tp1),
      tp2: Number(plan?.trim2 ?? plan?.tp2),
      runner: Number(plan?.runner ?? plan?.target),
    };
    const allLevelsPresent = Object.values(planLevels).every((v) => Number.isFinite(v) && v > 0);
    const isValidPlan = validationOk && allLevelsPresent;
    const levels = isValidPlan ? planLevels : { entry: null, stop: null, tp1: null, tp2: null, runner: null };

    const priceValue = Number(price);
    const hit = (target) => isValidPlan && Number.isFinite(priceValue) && Number.isFinite(target) && (direction === "long" ? priceValue >= target : priceValue <= target);
    const stopHit = isValidPlan && Number.isFinite(levels.stop) && (direction === "long" ? priceValue <= levels.stop : priceValue >= levels.stop);
    const tp1Hit = hit(levels.tp1);
    const tp2Hit = hit(levels.tp2);
    const runnerHit = hit(levels.runner);

    const closedFlag = activeTrade?.status === "closed";
    const tradeIsActive = Boolean(activeTrade?.isActive) && isValidPlan && !closedFlag;

    let status;
    let manageMessage;
    if (plan?.direction === "none") {
      status = "WAITING";
      manageMessage = "No active trade.";
    } else if (!isValidPlan) {
      status = "INVALID";
      manageMessage = "Plan invalid. Reset and rebuild.";
    } else if (!tradeIsActive) {
      status = "READY";
      manageMessage = "No active trade.";
    } else if (stopHit) {
      status = "COMPLETE";
      manageMessage = "Trade stopped.";
    } else if (runnerHit) {
      status = "COMPLETE";
      manageMessage = "Trade complete. Runner hit.";
    } else if (tp2Hit) {
      status = "MANAGING";
      manageMessage = "Manage runner.";
    } else if (tp1Hit) {
      status = "MANAGING";
      manageMessage = "Move stop to breakeven.";
    } else {
      status = "ACTIVE";
      manageMessage = "Manage risk. Watching TP1.";
    }

    return {
      signal: currentTimeframeSignal || null,
      plan,
      validation: activePlanValidation,
      hasPlan: isValidPlan,
      levels,
      direction,
      progress: { tp1Hit, tp2Hit, runnerHit, stopHit },
      activeTrade: tradeIsActive ? activeTrade : null,
      position: tradeIsActive ? activePosition : null,
      status,
      manageMessage,
      coach: liveCoach,
    };
  }, [activeTradePlan, activePlanValidation, rewardRisk, price, activeTrade, activePosition, liveCoach, currentTimeframeSignal]);

  // Structured coach output. Always answers "what should I do right now?".
  const coachStructured = useMemo(() => {
    const bias = activeBias === "bullish" ? "Bullish" : activeBias === "bearish" ? "Bearish" : "Neutral";
    const dailyLossHit = discipline.dailyPnl <= -Math.abs(profile.maxDailyLoss);
    if (dailyLossHit) {
      return {
        action: "STOP TRADING",
        bias,
        confidence: "Locked",
        why: "Daily loss limit reached.",
        next: "Stop trading for today. Review your journal tomorrow.",
      };
    }
    if (tradeState.status === "INVALID") {
      return {
        action: "WAIT",
        bias,
        confidence: "Low",
        why: tradeState.validation?.reason || "Plan inputs are invalid.",
        next: "Reset the plan and wait for a clean setup.",
      };
    }
    if (tradeState.status === "ACTIVE" || tradeState.status === "MANAGING" || tradeState.status === "COMPLETE") {
      return {
        action: "MANAGE TRADE",
        bias,
        confidence: tradeState.status === "ACTIVE" ? "Engaged" : "High",
        why: tradeState.activeTrade?.direction
          ? `${tradeState.activeTrade.direction.toUpperCase()} trade in progress.`
          : "Trade in progress.",
        next: tradeState.manageMessage,
      };
    }
    if (tradeState.status === "READY") {
      const dir = tradeState.direction === "short" ? "SHORT" : "LONG";
      return {
        action: dir === "SHORT" ? "LOOK SHORT" : "LOOK LONG",
        bias,
        confidence: setupGrade.grade === "A" ? "High" : setupGrade.grade === "B+" || setupGrade.grade === "B" ? "Medium" : "Low",
        why: setupGrade.reason || "Plan is valid and waiting for entry.",
        next: "Mark Trade Active when price reaches your entry.",
      };
    }
    // WAITING — pre-grade states drive copy.
    if (setupGrade.state === "no_data") {
      return { action: "WAIT", bias, confidence: "Low", why: "No price data yet.", next: "Connect TradingView Alerts to begin." };
    }
    if (setupGrade.state === "price_only") {
      return { action: "WAIT", bias, confidence: "Low", why: "Price connected. No setup yet.", next: "Wait for more candles or a Trade Pilot signal." };
    }
    if (setupGrade.state === "no_zones") {
      return { action: "WAIT", bias, confidence: "Low", why: "No support / resistance detected.", next: "Add manual levels or wait for clearer structure." };
    }
    return {
      action: "WAIT",
      bias,
      confidence: "Low",
      why: "No high-quality setup yet.",
      next: "Wait for price to reach support/resistance, or for a Trade Pilot signal.",
    };
  }, [tradeState.status, tradeState.validation?.reason, tradeState.direction, tradeState.manageMessage, tradeState.activeTrade?.direction, activeBias, discipline.dailyPnl, profile.maxDailyLoss, setupGrade.state, setupGrade.grade, setupGrade.reason]);

  const resetTradeState = useCallback((reason) => {
    setActiveTrade((current) => {
      if (!current?.isActive && current?.status === "waiting_entry" && !current?.realizedPL && !current?.unrealizedPL) {
        return current;
      }
      return normalizeActiveTrade({
        ...current,
        isActive: false,
        status: "waiting_entry",
        realizedPL: 0,
        unrealizedPL: 0,
      });
    });
    setActivePosition((current) => (current === null ? current : null));
    setPlannedTrade((current) => (current === null ? current : null));
    if (reason && typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.log("[tradeState] reset:", reason);
    }
  }, [setActiveTrade, setActivePosition, setPlannedTrade]);

  // Auto-clear stale active trade when plan becomes invalid OR disappears.
  // Covers the case where Setup Score says "Invalid" / Plan says "Waiting" but
  // a previous active trade is still flagged isActive — that's the source of
  // the contradictory "Active / TP2 reached" cards.
  useEffect(() => {
    if (!tradeState.hasPlan && activeTrade?.isActive) {
      resetTradeState(`plan unavailable (${tradeState.status})`);
    }
  }, [tradeState.hasPlan, tradeState.status, activeTrade?.isActive, resetTradeState]);

  // Reset on timeframe change.
  const previousTimeframeRef = useRef(chartTimeframeMinutes);
  useEffect(() => {
    if (previousTimeframeRef.current !== chartTimeframeMinutes) {
      previousTimeframeRef.current = chartTimeframeMinutes;
      resetTradeState(`timeframe changed to ${chartTimeframeMinutes}m`);
    }
  }, [chartTimeframeMinutes, resetTradeState]);

  // Reset when symbol changes (defense in depth — applyAlert clears state too).
  const previousSymbolRef = useRef(profile.mainMarket);
  useEffect(() => {
    if (previousSymbolRef.current !== profile.mainMarket) {
      previousSymbolRef.current = profile.mainMarket;
      resetTradeState(`symbol changed to ${profile.mainMarket}`);
    }
  }, [profile.mainMarket, resetTradeState]);

  // Reset when an opposite-direction signal arrives. The previous trade is
  // implicitly invalidated, so any TP/runner flags must be wiped.
  const previousSignalDirectionRef = useRef(currentTimeframeSignal?.direction || null);
  useEffect(() => {
    const next = currentTimeframeSignal?.direction || null;
    const prev = previousSignalDirectionRef.current;
    if (next && prev && next !== prev && (next === "long" || next === "short")) {
      resetTradeState(`signal direction flipped (${prev} → ${next})`);
    }
    previousSignalDirectionRef.current = next;
  }, [currentTimeframeSignal?.direction, resetTradeState]);

  // Debug logging.
  useEffect(() => {
    if (typeof console === "undefined") return;
    // eslint-disable-next-line no-console
    console.log("tradeState", tradeState);
  }, [tradeState.status, tradeState.manageMessage, tradeState.hasPlan, tradeState.activeTrade?.isActive]);

  const riskStatus = engine.disciplineWarnings.some((warning) => warning.includes("Stop") || warning.includes("loss limit reached") || warning.includes("exceeded"))
    ? "Stop Trading"
    : engine.disciplineWarnings.some((warning) => warning.includes("Warning") || warning.includes("approaching") || warning.includes("High risk") || warning.includes("too large") || warning.includes("Contracts"))
      ? "Warning"
      : "Good";

  const generateSelectedPlan = () => {
    if (setupType === "Retest" && setupDirection === "Long") applyQuickSetup("Breakout Long");
    else if (setupType === "Retest" && setupDirection === "Short") applyQuickSetup("Breakdown Short");
    else if (setupType === "Breakout" && setupDirection === "Short") applyQuickSetup("Breakdown Short");
    else applyQuickSetup(setupName);
  };

  const [levelsModalOpen, setLevelsModalOpen] = useState(false);

  const handleAutoGeneratePlan = () => {
    if (!(price > 0)) {
      notify?.("Connect a data source to get the current price.", "failure");
      return;
    }
    if (!autoTradePlan || autoTradePlan.noTrade) {
      const reason = autoTradePlan?.message
        || autoTradePlan?.reason
        || enrichedZoneDetection?.zoneReason
        || "No valid setup yet. Wait for price to reach support/resistance.";
      notify?.(reason, "failure");
      return;
    }
    const candidatePlan = normalizeTradePlan({
      contracts,
      direction: autoTradePlan.direction,
      entry: autoTradePlan.entry,
      runner: autoTradePlan.runner,
      setupType: autoTradePlan.setupType || "Auto Zone",
      sourceMode: dataSource,
      status: "planned",
      stop: autoTradePlan.stop,
      target: autoTradePlan.runner,
      trim1: autoTradePlan.trim1,
      trim2: autoTradePlan.trim2,
    }, {
      contracts,
      direction: autoTradePlan.direction,
      entry: autoTradePlan.entry,
      stop: autoTradePlan.stop,
    });
    const validation = validateTradePlan(candidatePlan);
    if (!validation.valid) {
      notify?.(validation.reason || "Generated plan failed validation.", "failure");
      return;
    }
    setPlannedTrade(candidatePlan);
    setActivePosition(null);
    notify?.("Trade plan generated", "success");
  };

  const handleOpenManualBuilder = () => setMarkActiveModalOpen(true);
  const handleOpenLevelsModal = () => setLevelsModalOpen(true);

  const saveDashboardNote = (event) => {
    event.preventDefault();
    if (!journalNote.trim()) return;
    addJournalEntry(journalNote.trim());
    setJournalNote("");
  };

  const markTradeActive = () => {
    if (tradeBlockedByGrade) {
      notify?.("NO TRADE — setup grade D. Wait for a B+ or A setup.", "failure");
      return;
    }
    // Require fully-validated tradeState before allowing activation.
    // Entry, stop, tp1, tp2, runner all required, plus reward/risk valid.
    if (!tradeState.hasPlan || !hasPlan) {
      notify?.("Plan is incomplete. Need entry, stop, TP1, TP2, and runner before marking active.", "failure");
      setMarkActiveModalOpen(true);
      return;
    }
    if (rewardRisk.invalid || !(Number(rewardRisk.ratio) > 0)) {
      notify?.("Reward/Risk invalid. Adjust stop or targets first.", "failure");
      return;
    }
    const nextTrade = activeTradeFromPlan(visualPlan, {
      currentPrice: price,
      market: profile.mainMarket,
      source: dataSource === "TradingView Webhook" ? "tradingview" : dataSource === "Demo Broker" ? "demo" : "manual",
      status: "active",
    });
    setActiveTrade(nextTrade);
    setActivePosition({ ...visualPlan, openedAt: nextTrade.openedAt, status: "active" });
    setPlannedTrade?.({ ...visualPlan, openedAt: nextTrade.openedAt, status: "active" });
    notify("Trade marked active.", "success");
  };

  const closeActiveTrade = () => {
    if (!activeTrade?.isActive) {
      notify("No active trade to close.", "failure");
      return;
    }
    setActiveTrade((current) => normalizeActiveTrade({
      ...current,
      currentPrice: price,
      isActive: false,
      realizedPL: current.unrealizedPL,
      status: "closed",
    }));
    setActivePosition(null);
    setPlannedTrade?.(null);
    notify("Trade marked closed.", "success");
  };

  const cardOrder = normalizeCardOrder(effectiveLayout.cardOrder);
  const dashboardCards = {
    alerts: effectiveLayout.alerts ? <AutoZonePanel zoneDetection={enrichedZoneDetection} symbol={profile.mainMarket} onAddLevels={handleOpenLevelsModal} onClearZones={() => { setSupport(0); setResistance(0); notify?.("Auto zones cleared.", "success"); }} /> : null,
    chart: effectiveLayout.chart ? <TradeChartPanel
      candleSeries={liveCandleSeries}
      chartOverlays={activeChartOverlays}
      chartPrefs={chartPrefs}
      chartTimeframe={chartTimeframe}
      currentPrice={price}
      debugMode={debugMode}
      entry={hasPlan ? visualPlan.entry : undefined}
      lastTradeSetup={lastTradeSetup}
      onResetChart={onResetChart}
      resetSignal={chartResetSignal}
      runner={hasPlan ? visualPlan.runner ?? visualPlan.target : undefined}
      setChartPrefs={setChartPrefs}
      setChartTimeframe={setChartTimeframe}
      stop={hasPlan ? visualPlan.stop : undefined}
      support={enrichedZoneDetection.supportLevel ?? support}
      resistance={enrichedZoneDetection.resistanceLevel ?? resistance}
      symbol={profile.mainMarket}
      timeframe={displayedTimeframe}
      trim1={hasPlan ? visualPlan.trim1 : undefined}
      trim2={hasPlan ? visualPlan.trim2 : undefined}
      zoneDetection={enrichedZoneDetection}
    /> : null,
    coach: effectiveLayout.coach ? <div style={styles.coachCard}>
      <p style={styles.cardLabel}>Trade Coach</p>
      {/* Structured output: always answers "what should I do right now?". */}
      <div style={{ display: "grid", gap: "8px", marginBottom: "10px" }}>
        <CoachLine label="Action" value={coachStructured.action} tone={coachStructured.action === "WAIT" || coachStructured.action === "STOP TRADING" ? "warn" : "good"} />
        <CoachLine label="Bias" value={coachStructured.bias} />
        <CoachLine label="Confidence" value={coachStructured.confidence} />
        <CoachLine label="Why" value={coachStructured.why} muted />
        <CoachLine label="Next" value={coachStructured.next} muted />
      </div>
      {marketStructure.liquiditySweepHigh || marketStructure.liquiditySweepLow ? (
        <div style={styles.priceWarning}>{marketStructure.structureMessage}</div>
      ) : null}
    </div> : null,
    journal: effectiveLayout.journal ? <section style={styles.card}>
      <p style={styles.cardLabel}>Journal</p>
      <h2 style={styles.sectionTitle}>Notes and Trade History</h2>
      <form onSubmit={saveDashboardNote}>
        <textarea
          style={styles.textArea}
          value={journalNote}
          onChange={(event) => setJournalNote(event.target.value)}
          placeholder="What did you see? What will you do next?"
        />
        <button
          disabled={!journalNote.trim()}
          style={{ ...styles.settingsButton, opacity: journalNote.trim() ? 1 : 0.45, cursor: journalNote.trim() ? "pointer" : "not-allowed" }}
          title={journalNote.trim() ? "Save journal note" : "Type a note first."}
        >Save Note</button>
      </form>
      <div style={{ ...styles.warningStack, marginTop: "14px" }}>
        {safeJournalEntries.length ? (
          safeJournalEntries.slice(0, 4).map((item) => (
            <PlanItem key={item.id || item.stamp} title={item.stamp ? new Date(item.stamp).toLocaleString() : "Journal"} text={item.note || "Saved trade note"} />
          ))
        ) : (
          <p style={{ ...styles.muted, margin: 0 }}>No journal entries yet. Capture what you saw, what you did, and what you'd improve.</p>
        )}
      </div>
    </section> : null,
    performanceStats: effectiveLayout.performanceStats ? <PerformanceStatsCard discipline={discipline} journalEntries={safeJournalEntries} tradeGrade={displayTradeGrade} /> : null,
    propFirmRules: effectiveLayout.propFirmRules ? <PropFirmRulesCard fundedMetrics={fundedMetrics} fundedWarnings={fundedWarnings} profile={profile} /> : null,
    risk: effectiveLayout.risk ? <RiskGuardCard discipline={discipline} fundedMetrics={fundedMetrics} fundedWarnings={fundedWarnings} profile={profile} riskStatus={riskStatus} /> : null,
    tradePlan: effectiveLayout.tradePlan ? <TradePlanCard activeBias={activeBias} activeTradePlan={activeTradePlan} activeTimeframeKey={activeChartKeyTf} autoTradePlan={autoTradePlan} hasPlan={tradeState.hasPlan} missedEntry={missedEntry} onAutoGenerate={enrichedZoneDetection?.zonesValid ? handleAutoGeneratePlan : null} onAddLevels={handleOpenLevelsModal} onOpenManualBuilder={enrichedZoneDetection?.zonesValid ? handleOpenManualBuilder : null} planValidation={activePlanValidation} profile={profile} rewardRisk={rewardRisk} setupName={setupName} symbol={profile.mainMarket} tradeGrade={displayTradeGrade} tradeState={tradeState} visualPlan={visualPlan} zonesValid={enrichedZoneDetection?.zonesValid !== false} /> : null,
    watchlist: effectiveLayout.watchlist ? <WatchlistCard price={price} profile={profile} watchlist={safeWatchlist} /> : null,
  };

  if (streamerMode || effectiveLayout.mode === "Streamer") {
    return (
      <>
        <LivestreamDashboard
          activePosition={activePosition}
          brokerConnection={brokerConnection}
          discipline={discipline}
          engine={engine}
          price={price}
          profile={profile}
          riskStatus={riskStatus}
          visualPlan={hasPlan ? visualPlan : activeTradePlan}
          coachMessage={liveCoach}
          tradeGrade={displayTradeGrade}
        />
        <TradeChartPanel
          candleSeries={liveCandleSeries}
          currentPrice={price}
          debugMode={debugMode}
          entry={hasPlan ? visualPlan.entry : undefined}
          lastTradeSetup={lastTradeSetup}
          runner={hasPlan ? visualPlan.runner ?? visualPlan.target : undefined}
          stop={hasPlan ? visualPlan.stop : undefined}
          support={enrichedZoneDetection.supportLevel ?? support}
          resistance={enrichedZoneDetection.resistanceLevel ?? resistance}
          symbol={profile.mainMarket}
          timeframe={displayedTimeframe}
          trim1={hasPlan ? visualPlan.trim1 : undefined}
          trim2={hasPlan ? visualPlan.trim2 : undefined}
          zoneDetection={enrichedZoneDetection}
        />
      </>
    );
  }

  return (
    <>
      <PageTitle title="Dashboard" subtitle="Plan trades and manage risk." />
      <section className="mobile-status-bar" style={styles.mobileStatusBar}>
        <div>
          <span style={styles.cardLabel}>Market</span>
          <strong>{profile.mainMarket}</strong>
        </div>
        <div>
          <span style={styles.cardLabel}>Price</span>
          <strong>{fmt(price)}</strong>
        </div>
        <div>
          <span style={styles.cardLabel}>Status</span>
          <strong>{dataSource === "TradingView Webhook" ? "TradingView" : getConnectionStatusLabel(brokerConnection)}</strong>
        </div>
      </section>
      <section style={styles.dashboardToolbar}>
        <div style={{ display: "flex", gap: "4px", background: "#0f172a", border: "1px solid #1e293b", borderRadius: "8px", padding: "3px" }}>
          {["Simple", "Pro"].map((m) => (
            <button
              key={m}
              onClick={() => setLayoutPrefs((prev) => ({ ...prev, ...layoutModePresets[m], mode: m }))}
              style={{ background: effectiveLayout.mode === m ? "#2563eb" : "transparent", border: "none", borderRadius: "6px", color: effectiveLayout.mode === m ? "#f8fafc" : "#64748b", cursor: "pointer", fontSize: "12px", fontWeight: 700, padding: "4px 10px" }}
            >{m}</button>
          ))}
        </div>
        <button onClick={() => setCustomizeOpen((open) => !open)} style={styles.settingsButton}>Customize Dashboard</button>
        {(() => {
          const markDisabled = tradeBlockedByGrade || !tradeState.hasPlan || Boolean(tradeState.activeTrade);
          const markTitle = tradeBlockedByGrade
            ? "NO TRADE — setup grade D. Wait for a B+ or A setup."
            : !tradeState.hasPlan
              ? "Generate a valid plan before marking active."
              : tradeState.activeTrade
                ? "Trade is already active."
                : "Mark this trade active";
          return (
            <button
              onClick={markTradeActive}
              disabled={markDisabled}
              style={{ ...styles.settingsButton, opacity: markDisabled ? 0.45 : 1, cursor: markDisabled ? "not-allowed" : "pointer" }}
              title={markTitle}
            >Mark Trade Active</button>
          );
        })()}
        <button
          onClick={closeActiveTrade}
          disabled={!tradeState.activeTrade}
          style={{ ...styles.secondaryButton, opacity: tradeState.activeTrade ? 1 : 0.45, cursor: tradeState.activeTrade ? "pointer" : "not-allowed" }}
          title={tradeState.activeTrade ? "Close and journal this trade" : "No active trade to close."}
        >Close / Journal Trade</button>
        <button
          onClick={async () => {
            const breakdown = buildTradeBreakdownText({
              activeTrade,
              disciplineGrade,
              market: profile.mainMarket,
              rewardRisk,
              setupGrade,
              setupName,
              visualPlan,
            });
            try {
              await navigator.clipboard.writeText(breakdown);
              notify?.("Trade breakdown copied to clipboard.", "success");
            } catch {
              notify?.("Clipboard blocked. Breakdown logged to console.", "warn");
              console.log(breakdown);
            }
          }}
          disabled={!tradeState.hasPlan}
          style={{ ...styles.secondaryButton, opacity: tradeState.hasPlan ? 1 : 0.45, cursor: tradeState.hasPlan ? "pointer" : "not-allowed" }}
          title={tradeState.hasPlan ? "Copy plan + grade to clipboard" : "No plan to share yet."}
        >Share Breakdown</button>
      </section>
      <TimeframeSignalBadge
        currentTimeframeSignal={currentTimeframeSignal}
        dataSource={dataSource}
        symbol={profile.mainMarket}
        timeframe={activeChartKeyTf}
      />
      <DashboardNextStep
        activeTrade={activeTrade}
        currentTimeframeSignal={currentTimeframeSignal}
        dataSource={dataSource}
        hasPlan={hasPlan}
        hasCandles={hasLiveCandles}
        support={support}
        resistance={resistance}
        timeframe={activeChartKeyTf}
        onMarkActive={() => setMarkActiveModalOpen(true)}
      />
      <CoachScoreGrid disciplineGrade={disciplineGrade} setupGrade={setupGrade} />
      {markActiveModalOpen ? (
        <MarkTradeActiveModal
          applyQuickSetup={applyQuickSetup}
          notify={notify}
          price={price}
          profile={profile}
          resistance={resistance}
          setActiveTrade={setActiveTrade}
          setActivePosition={setActivePosition}
          setPlannedTrade={setPlannedTrade}
          support={support}
          onAddLevels={() => { setMarkActiveModalOpen(false); setLevelsModalOpen(true); }}
          onClose={() => setMarkActiveModalOpen(false)}
        />
      ) : null}
      {levelsModalOpen ? (
        <LevelsModal
          notify={notify}
          resistance={resistance}
          setResistance={setResistance}
          setSupport={setSupport}
          support={support}
          onClose={() => setLevelsModalOpen(false)}
        />
      ) : null}
      {customizeOpen ? (
        <CustomizeDashboardPanel layoutPrefs={layoutPrefs} notify={notify} setLayoutPrefs={setLayoutPrefs} />
      ) : null}
      {debugMode ? (
        <SignalDebugPanel
          applyAlert={applyAlert}
          chartOverlays={activeChartOverlays}
          currentPrice={price}
          dataSource={dataSource}
          lastUpdated={lastUpdated}
          notify={notify}
          priceSource={priceSource}
          profile={profile}
          timeframe={activeTimeframe}
          tradingViewSignal={tradingViewSignal}
          webhookDebug={webhookDebug}
          zoneDiagnostics={zoneDiagnostics}
        />
      ) : null}

      <section
        className={`dashboard-card-board mode-${String(effectiveLayout.mode || "Pro").toLowerCase().replace(/\s+/g, "-")}`}
        style={styles.dashboardCardBoard}
      >
        {cardOrder.map((key) => dashboardCards[key] ? (
          <div
            className={`dashboard-card-slot card-${key}`}
            key={key}
            style={{ ...styles.dashboardCardSlot, gridColumn: key === "chart" || (effectiveLayout.mode === "Streamer" && key === "coach") ? "1 / -1" : undefined }}
          >
            {dashboardCards[key]}
          </div>
        ) : null)}
      </section>

      <button onClick={() => setAdvancedOpen((value) => !value)} style={styles.advancedToggle}>
        Advanced Tools {advancedOpen ? "Hide" : "Show"}
      </button>

      <div style={{ display: advancedOpen ? "block" : "none" }}>

      <SignalSourceCard
        activeSymbol={profile.mainMarket}
        candleSeries={liveCandleSeries}
        connectionError={connectionError}
        currentPrice={price}
        dataSource={dataSource}
        isOnline={isOnline}
        priceSource={priceSource}
        timeframe={activeTimeframe}
        tradingViewSignal={tradingViewSignal}
      />

      <section style={{ ...styles.marketTopBar, alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <span style={{ color: "#64748b", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Active Market</span>
          <MarketSelector value={profile.mainMarket} onChange={(value) => updateProfile("mainMarket", value)} />
        </div>
        <div style={styles.marketTopMetric}>
          <span>{marketSpec.displayName}</span>
          <strong>{marketSpec.category === "forex" ? `pip value: ${marketSpec.tickSize}` : `$${marketSpec.pointValue}/point`}</strong>
        </div>
        <div style={styles.marketTopMetric}>
          <span>Tick / Pip Size</span>
          <strong>{marketSpec.tickSize}</strong>
        </div>
        <div style={styles.marketTopMetric}>
          <span>Market Type</span>
          <strong style={{ textTransform: "capitalize", color: getMarketCategory(profile.mainMarket) === "futures" ? "#3b82f6" : getMarketCategory(profile.mainMarket) === "crypto" ? "#f59e0b" : getMarketCategory(profile.mainMarket) === "forex" ? "#8b5cf6" : "#10b981" }}>
            {getMarketCategory(profile.mainMarket)}
          </strong>
        </div>
      </section>

      <ProductUpgradePanel
        brokerConnection={brokerConnection}
        discipline={discipline}
        journalEntries={journalEntries}
        profile={profile}
      />

      <section style={styles.heroGrid}>
        <div style={styles.biasCard}>
          <p style={styles.cardLabel}>
            <span style={styles.labelWithHelp}>
              Market Bias
              <HelpTip text={tooltipText.marketBias} />
            </span>
          </p>
          <div style={{ ...styles.biasText, color: engine.biasColor }}>{engine.bias}</div>
          <p style={styles.muted}>{engine.biasMessage}</p>
          <div style={styles.marketSpecLine}>
            {marketSpec.displayName} · ${marketSpec.pointValue}/point · tick {marketSpec.tickSize}
          </div>
        </div>

        <div style={styles.scoreCard}>
          <div style={styles.scoreTop}>
            <div>
              <p style={styles.cardLabel}>
                <span style={styles.labelWithHelp}>
                  Trade Score
                  <HelpTip text={tooltipText.tradeScore} />
                </span>
              </p>
              <h2 style={styles.scoreText}>{engine.score}/100</h2>
            </div>
            <div style={{ ...styles.confidencePill, background: engine.confidenceColor }}>{engine.confidence}</div>
          </div>
          <div style={styles.scoreTrack}>
            <div style={{ ...styles.scoreFill, width: `${engine.score}%`, background: engine.confidenceColor }} />
          </div>
        </div>

        <div style={styles.coachCard}>
          <p style={styles.cardLabel}>AI Coach</p>
          <p style={styles.coachMessage}>{engine.coachMessage}</p>
          <p style={styles.muted}>{engine.stopReason}</p>
        </div>
      </section>

      <section style={styles.quickEntryCard}>
        <div>
          <p style={styles.cardLabel}>Fast Entry</p>
          <h2 style={styles.sectionTitle}>Quick Setup Buttons</h2>
          <p style={styles.muted}>Auto-fill entry, stop, trims, and runner from current support/resistance.</p>
        </div>
        <div style={styles.quickGrid}>
          <button onClick={() => applyQuickSetup("Breakout Long")} style={{ ...styles.quickButton, background: "#166534" }}>Breakout Long</button>
          <button onClick={() => applyQuickSetup("Pullback Long")} style={{ ...styles.quickButton, background: "#15803d" }}>Pullback Long</button>
          <button onClick={() => applyQuickSetup("Breakdown Short")} style={{ ...styles.quickButton, background: "#991b1b" }}>Breakdown Short</button>
          <button onClick={() => applyQuickSetup("Pullback Short")} style={{ ...styles.quickButton, background: "#b91c1c" }}>Pullback Short</button>
        </div>
      </section>

      {missedEntry ? <div style={styles.missedEntry}>{missedEntry}</div> : null}

      <KeyLevelCoach
        breakoutLevel={breakoutLevel}
        coach={levelCoach}
        currentPrice={price}
        marketBias={levelBias}
        pullbackSupport={pullbackSupport}
        recentHigh={recentHigh}
        rangeMax={rangeMax}
        rangeMin={rangeMin}
        setBreakoutLevel={setBreakoutLevel}
        setMarketBias={setLevelBias}
        setPullbackSupport={setPullbackSupport}
        setRecentHigh={setRecentHigh}
      />

      <section style={styles.visualGrid}>
        <TradeLadder currentPrice={price} plan={visualPlan} />
        <RiskRewardPanel
          contracts={visualPlan.contracts ?? contracts}
          market={profile.mainMarket}
          pointValue={marketSpec.pointValue}
          plan={visualPlan}
          rewardRisk={rewardRisk}
          setupName={setupName}
        />
        <ShareSetupPanel
          contracts={visualPlan.contracts ?? contracts}
          engine={engine}
          market={profile.mainMarket}
          plan={visualPlan}
          rewardRisk={rewardRisk}
        />
      </section>

      <section style={styles.mainGrid}>
        <section style={styles.card}>
          <p style={styles.cardLabel}>Risk Control</p>
          <h2 style={styles.sectionTitle}>Position Size Protection</h2>
          <div style={styles.metricGrid}>
            <Metric label="Dollar / Point" value={`$${engine.dollarPerPoint.toFixed(2)}`} />
            <Metric label="Risk per 10 Points" value={`$${engine.riskPerTenPoints.toFixed(2)}`} />
            <Metric label="Estimated Max Loss" value={`$${engine.estimatedMaxLoss.toFixed(2)}`} tone={engine.estimatedMaxLoss > profile.maxRiskPerTrade ? "bad" : "neutral"} />
            <Metric label="Max Risk / Trade" value={`$${profile.maxRiskPerTrade.toFixed(2)}`} />
          </div>
          <div style={styles.warningStack}>
            {engine.disciplineWarnings
              .filter((warning) => warning.includes("Position size") || warning.includes("High risk") || warning.includes("Contracts"))
              .map((warning) => <div key={warning} style={styles.warningBox}>{warning}</div>)}
          </div>
        </section>

        <section style={styles.card}>
          <p style={styles.cardLabel}>Journal</p>
          <h2 style={styles.sectionTitle}>Session Notes</h2>
          <p style={styles.muted}>Trades taken: {discipline.tradesTaken}. Daily P/L: ${discipline.dailyPnl.toFixed(2)}. Current action: {engine.suggestedAction}.</p>
        </section>
      </section>

      <section style={styles.fastCard}>
        <div>
          <p style={styles.cardLabel}>Fast Mode</p>
          <h2 style={styles.sectionTitle}>Manual Execution Buttons</h2>
          <p style={styles.muted}>{fastMessage}</p>
        </div>
        <div style={styles.fastGrid}>
          <button onClick={() => runFastAction("long")} style={{ ...styles.fastButton, background: "#16a34a" }}>Long</button>
          <button onClick={() => runFastAction("short")} style={{ ...styles.fastButton, background: "#dc2626" }}>Short</button>
          <button onClick={() => runFastAction("trim1")} style={styles.fastButton}>Trim 1 Hit</button>
          <button onClick={() => runFastAction("trim2")} style={styles.fastButton}>Trim 2 Hit</button>
          <button onClick={() => runFastAction("moveStop")} style={styles.fastButton}>Move Stop</button>
          <button onClick={() => runFastAction("exit")} style={{ ...styles.fastButton, background: "#7f1d1d" }}>Exit Trade</button>
        </div>
      </section>

      <main style={styles.mainGrid}>
        <section style={styles.card}>
          <div style={styles.sectionHeader}>
            <div>
              <p style={styles.cardLabel}>Trade Setup</p>
              <h2 style={styles.sectionTitle}>Decision Inputs</h2>
            </div>
            <div style={styles.directionToggle}>
              <button onClick={() => setDirection("long")} style={{ ...styles.toggleButton, background: direction === "long" ? "#16a34a" : "#27272a" }}>
                Long
              </button>
              <button onClick={() => setDirection("short")} style={{ ...styles.toggleButton, background: direction === "short" ? "#dc2626" : "#27272a" }}>
                Short
              </button>
            </div>
          </div>

          <div style={styles.marketPanel}>
            <SelectField label="Market" value={profile.mainMarket} options={markets} onChange={(value) => updateProfile("mainMarket", value)} />
            <SelectField label="Data Source" value={dataSource} options={dataSources} onChange={setDataSource} />
            <label style={styles.switchRow}>
              <input
                type="checkbox"
                checked={autoPrice}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setAutoPrice(checked);
                  if (checked && dataSource === "Manual Mode") setDataSource("Market Data API");
                }}
              />
              Auto Price: {autoPrice ? "ON" : "OFF"}
            </label>
          </div>

          <div style={styles.priceTape}>
            <Metric label={profile.mainMarket} value={price.toFixed(2)} />
            <Metric label="Bid" value={quote.bid.toFixed(2)} />
            <Metric label="Ask" value={quote.ask.toFixed(2)} />
            <Metric label="Updated" value={lastUpdated} />
          </div>

          <div style={styles.dataStatus}>
            <span>Source: {autoPrice ? dataSource : "Manual Mode"}</span>
            <span>Last updated: {lastUpdated}</span>
          </div>
          {priceStatus ? <div style={styles.priceWarning}>{priceStatus}</div> : null}
          {dataSource === "Broker Connection" || dataSource.includes("Tradovate") ? (
            <div style={styles.brokerStatusCard}>
              <span style={{ ...styles.statusPill, background: brokerConnection.connected ? "#166534" : "#3f3f46" }}>
                {brokerConnection.connectionStatus || (brokerConnection.connected ? "Connected" : "Waiting")}
              </span>
              <span>{brokerConnection.platform}</span>
              {!streamerMode ? <span>{brokerConnection.accountId || "No account linked"}</span> : null}
              {!streamerMode ? <span>{brokerConnection.accountType || "Read-only"}</span> : null}
              {!streamerMode ? <span>Balance: ${Number(brokerConnection.accountBalance || 0).toFixed(2)}</span> : null}
              <span>Open P/L: ${Number(brokerConnection.openPnl || 0).toFixed(2)}</span>
              <span>Daily P/L: ${Number(brokerConnection.dailyPnl ?? discipline.dailyPnl ?? 0).toFixed(2)}</span>
              <span>Realized P/L: ${Number(brokerConnection.realizedPnl || 0).toFixed(2)}</span>
            </div>
          ) : null}

          <Control label="Current Price" tooltip={tooltipText.currentPrice} value={price} setValue={setPrice} min={rangeMin} max={rangeMax} disabled={autoPrice} />
          <Control label="Support" tooltip={tooltipText.support} value={support} setValue={setSupport} min={rangeMin} max={rangeMax} />
          <Control label="Resistance" tooltip={tooltipText.resistance} value={resistance} setValue={setResistance} min={rangeMin} max={rangeMax} />
          <Control label="Entry" tooltip={tooltipText.entry} value={entry} setValue={setEntry} min={rangeMin} max={rangeMax} />
          <Control label="Risk Points" tooltip={tooltipText.riskPoints} value={riskPoints} setValue={setRiskPoints} min={1} max={Math.max(10, rangePad / 4)} />
          <Control label="Contracts" tooltip={tooltipText.contracts} value={contracts} setValue={setContracts} min={1} max={20} step={1} />
        </section>

        <section style={styles.card}>
          <p style={styles.cardLabel}>Active Position Detection</p>
          <h2 style={styles.sectionTitle}>{activePosition ? "Position Detected" : "No Active Position"}</h2>
          {brokerConnection.connected ? (
            <p style={{ ...styles.muted, marginBottom: "14px" }}>
              Broker bridge: {brokerConnection.platform}. Recent fills: {brokerConnection.fills?.length ?? 0}.
            </p>
          ) : null}
          <div style={styles.metricGrid}>
            <Metric label="Direction" value={activePosition ? activePosition.direction.toUpperCase() : direction.toUpperCase()} />
            <Metric label="Entry" value={(activePosition?.entry ?? entry).toFixed(2)} />
            <Metric label="Contracts" value={String(activePosition?.contracts ?? contracts)} />
            <Metric label="Stop" value={(activePosition?.stop ?? engine.smartStop).toFixed(2)} />
            <Metric label="Target" value={(activePosition?.target ?? engine.runner).toFixed(2)} />
            <Metric label="Status" value={activePosition?.status ?? "watching"} />
          </div>
        </section>

        <section style={styles.card}>
          <p style={styles.cardLabel}>Position Manager</p>
          <h2 style={styles.sectionTitle}>Trade Management</h2>
          <div style={styles.metricGrid}>
            <Metric label="Entry" value={entry.toFixed(2)} />
            <Metric label="Recommended Stop" tooltip={tooltipText.recommendedStop} value={engine.smartStop.toFixed(2)} />
            <Metric label="Trim 1" tooltip={tooltipText.trim1} value={engine.trim1.toFixed(2)} />
            <Metric label="Trim 2" tooltip={tooltipText.trim2} value={engine.trim2.toFixed(2)} />
            <Metric label="Runner" tooltip={tooltipText.runner} value={engine.runner.toFixed(2)} />
            <Metric label="Open P/L" value={`$${engine.openPnl.toFixed(2)}`} tone={engine.openPnl >= 0 ? "good" : "bad"} />
            <Metric label="Risk Left" value={`$${engine.riskLeft.toFixed(2)}`} />
            <Metric label="Action" value={engine.suggestedAction} tone={engine.actionTone} />
          </div>
        </section>

        <section style={styles.card}>
          <p style={styles.cardLabel}>Discipline Protection</p>
          <h2 style={styles.sectionTitle}>Daily Guardrails</h2>
          <div style={styles.formGrid}>
            <Field label="Trades Taken Today" type="number" value={discipline.tradesTaken} onChange={(value) => updateDiscipline("tradesTaken", value)} />
            <Field label="Current Daily P/L" type="number" value={discipline.dailyPnl} onChange={(value) => updateDiscipline("dailyPnl", value)} />
          </div>
          <div style={styles.warningStack}>
            {engine.disciplineWarnings.map((warning) => (
              <div key={warning} style={styles.warningBox}>{warning}</div>
            ))}
          </div>
        </section>

        <section style={styles.card}>
          <p style={styles.cardLabel}>Auto-Coaching</p>
          <h2 style={styles.sectionTitle}>Execution Prompts</h2>
          <div style={styles.warningStack}>
            {engine.autoCoaching.map((message) => (
              <div key={message} style={styles.coachPrompt}>{message}</div>
            ))}
          </div>
        </section>

        <section style={styles.card}>
          <p style={styles.cardLabel}>Risk Intelligence</p>
          <h2 style={styles.sectionTitle}>Score Factors</h2>
          <ScoreRow label="Location" value={engine.factors.location} />
          <ScoreRow label="Risk Points" value={engine.factors.risk} />
          <ScoreRow label="Reward/Risk" value={engine.factors.reward} />
          <ScoreRow label="Direction" value={engine.factors.direction} />
          <ScoreRow label="Entry Distance" value={engine.factors.distance} />
          <ScoreRow label="Contracts" value={engine.factors.contracts} />
        </section>
      </main>
      </div>
    </>
  );
}


function AutoZonePanel({ zoneDetection, symbol, onClearZones, onAddLevels }) {
  const repeatedRejectionHighs = Array.isArray(zoneDetection?.repeatedRejectionHighs)
    ? zoneDetection.repeatedRejectionHighs
    : [];
  const repeatedRejectionLows = Array.isArray(zoneDetection?.repeatedRejectionLows)
    ? zoneDetection.repeatedRejectionLows
    : [];
  const zonesValid = zoneDetection?.zonesValid !== false;
  const candleCount = Number(zoneDetection?.candleCount) || 0;
  const waitingForCandles = !zonesValid && candleCount < 20;

  const btn = (label, onClick, variant = "primary") => (
    <button
      key={label}
      onClick={onClick}
      style={{
        background: variant === "primary" ? "#2563eb" : "#0f172a",
        border: `1px solid ${variant === "primary" ? "#3b82f6" : "#334155"}`,
        borderRadius: "8px",
        color: "#f8fafc",
        cursor: "pointer",
        fontSize: "12px",
        fontWeight: 800,
        padding: "8px 12px",
      }}
    >{label}</button>
  );

  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Auto Zone Detector</p>
      <h2 style={styles.sectionTitle}>Support / Resistance</h2>
      {!zonesValid ? (
        <div style={{ background: "rgba(234,179,8,.08)", border: "1px solid rgba(234,179,8,.3)", borderRadius: "10px", color: "#fde68a", fontSize: "12px", marginBottom: "10px", padding: "8px 12px" }}>
          {zoneDetection.zoneReason || (zoneDetection.compressed ? "Compressed / no valid zones." : "No valid zones detected.")}
        </div>
      ) : null}
      <div style={styles.metricGrid}>
        <Metric label="Support Zone" value={zonesValid ? (zoneDetection.supportZone || "Manual") : "—"} tone="good" />
        <Metric label="Resistance Zone" value={zonesValid ? (zoneDetection.resistanceZone || "Manual") : "—"} tone="warn" />
        <Metric label="Middle Zone" value={zonesValid ? (zoneDetection.middleZone || "Wait") : "—"} />
        <Metric label="Session High" value={formatOptionalPrice(zoneDetection.sessionHigh, symbol)} />
        <Metric label="Session Low" value={formatOptionalPrice(zoneDetection.sessionLow, symbol)} />
        <Metric label="Open Range" value={zoneDetection.openRange || "Pending"} />
        <Metric label="Swing High" value={formatOptionalPrice(zoneDetection.recentHigh, symbol)} tone="warn" />
        <Metric label="Swing Low" value={formatOptionalPrice(zoneDetection.pullbackSupport, symbol)} tone="good" />
      </div>
      <div style={{ ...styles.coachPrompt, marginTop: "12px" }}>
        Rejection zones: highs {repeatedRejectionHighs.length ? repeatedRejectionHighs.join(", ") : "none yet"} · lows {repeatedRejectionLows.length ? repeatedRejectionLows.join(", ") : "none yet"}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
        {!zonesValid ? (
          <>
            {onAddLevels ? btn("Add Manual Support", onAddLevels, "primary") : null}
            {onAddLevels ? btn("Add Manual Resistance", onAddLevels, "primary") : null}
            {waitingForCandles ? (
              <span style={{
                alignItems: "center",
                background: "rgba(15,23,42,.6)",
                border: "1px solid #334155",
                borderRadius: "8px",
                color: "#94a3b8",
                display: "inline-flex",
                fontSize: "12px",
                fontWeight: 700,
                padding: "8px 12px",
              }}>Waiting for more candles ({candleCount}/20)</span>
            ) : null}
          </>
        ) : (
          <>
            {onAddLevels ? btn("Add Levels", onAddLevels, "primary") : null}
            {onClearZones ? btn("Clear Auto Zones", onClearZones, "secondary") : null}
          </>
        )}
      </div>
      <p style={{ ...styles.muted, marginTop: "12px" }}>{zoneDetection.message}</p>
    </section>
  );
}

function TradePlanCard({ activeBias, activeTradePlan, activeTimeframeKey, autoTradePlan, hasPlan, missedEntry, onAutoGenerate, onAddLevels, onOpenManualBuilder, planValidation, profile, rewardRisk, setupName, symbol, tradeGrade, tradeState, visualPlan, zonesValid = true }) {
  const marketCat = getMarketCategory(symbol || profile?.mainMarket || "");
  const unitLabel = marketCat === "forex" ? "pips" : marketCat === "crypto" ? "$" : marketCat === "stock" ? "shares" : "pts";
  const unitColor = { futures: "#3b82f6", forex: "#a855f7", crypto: "#f59e0b", stock: "#10b981" }[marketCat] || "#64748b";
  const fp = (v) => formatPrice(v, symbol || profile?.mainMarket || "");
  const planSource = activeTradePlan?.source || "Auto Zone";
  const planTf = activeTradePlan?.timeframe ? String(activeTradePlan.timeframe).trim() : null;
  const activeTf = activeTimeframeKey ? String(activeTimeframeKey).trim() : null;
  const planIsFromOtherTf = planTf && activeTf && planTf !== activeTf;
  // Status label is derived from the unified tradeState so the Plan card cannot
  // disagree with the Manage / Active Trade cards.
  const planStatus = (() => {
    switch (tradeState?.status) {
      case "INVALID": return "Invalid plan";
      case "WAITING": return "Waiting for confirmation";
      case "READY": return "Waiting for entry";
      case "ACTIVE": return "Active";
      case "MANAGING": return "Managing trade";
      case "COMPLETE": return "Trade complete";
      default:
        return activeTradePlan?.status === "managing_trade"
          ? "Managing trade"
          : activeTradePlan?.status === "waiting_for_entry"
            ? "Waiting for entry"
            : activeTradePlan?.direction === "none"
              ? "Waiting for confirmation"
              : "Planned";
    }
  })();
  const planDate = activeTradePlan?.lastUpdated ? new Date(activeTradePlan.lastUpdated) : null;
  const planUpdated = planDate && Number.isFinite(planDate.getTime()) ? planDate.toLocaleTimeString() : activeTradePlan?.lastUpdated || "Just now";
  const planActions = (onAutoGenerate || onOpenManualBuilder || onAddLevels) ? (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "14px" }}>
      {onAutoGenerate ? (
        <button
          onClick={onAutoGenerate}
          style={{ background: "#2563eb", border: "1px solid #3b82f6", borderRadius: "10px", color: "#f8fafc", cursor: "pointer", flex: "1 1 160px", fontSize: "13px", fontWeight: 900, padding: "10px 14px" }}
        >Auto Generate Plan</button>
      ) : null}
      {onOpenManualBuilder ? (
        <button
          onClick={onOpenManualBuilder}
          style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "10px", color: "#f8fafc", cursor: "pointer", flex: "1 1 160px", fontSize: "13px", fontWeight: 900, padding: "10px 14px" }}
        >Manual Plan Builder</button>
      ) : null}
      {onAddLevels ? (
        <button
          onClick={onAddLevels}
          style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: "10px", color: "#f8fafc", cursor: "pointer", flex: "1 1 160px", fontSize: "13px", fontWeight: 900, padding: "10px 14px" }}
        >Add Levels</button>
      ) : null}
    </div>
  ) : null;
  return (
    <section style={styles.tradePlanHero}>
      <p style={styles.cardLabel}>Trade Plan</p>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <h2 style={{ ...styles.tradePlanTitle, margin: 0 }}>{hasPlan ? `${setupName} Plan` : "No valid trade yet"}</h2>
        <span style={{ background: unitColor + "22", border: `1px solid ${unitColor}55`, borderRadius: "6px", color: unitColor, fontSize: "11px", fontWeight: 700, padding: "2px 8px", textTransform: "uppercase" }}>{unitLabel}</span>
      </div>
      <div style={{ ...styles.metricGrid, marginBottom: "14px" }}>
        <Metric label="Bias" value={normalizeActiveBias(activeBias)} tone={normalizeActiveBias(activeBias) === "neutral" ? "warn" : "good"} />
        <Metric label="Direction" value={activeTradePlan?.direction === "none" ? "None" : activeTradePlan?.direction || "None"} />
        <Metric label="Source" value={planSource} />
        <Metric label="Status" value={planStatus} />
        <Metric label="Last updated" value={planUpdated} />
      </div>
      {planIsFromOtherTf ? (
        <div style={{ background: "rgba(251,191,36,.08)", border: "1px solid rgba(251,191,36,.25)", borderRadius: "8px", color: "#fbbf24", fontSize: "12px", marginBottom: "10px", padding: "7px 12px" }}>
          Plan is from {timeframeLabel(planTf)}. Switch back or regenerate for {timeframeLabel(activeTf)}.
        </div>
      ) : null}
      {hasPlan ? (
        <>
          <div style={styles.planMetricGrid}>
            <Metric label="Entry" tooltip={tooltipText.entry} value={fp(visualPlan.entry)} />
            <Metric label="Stop" tooltip={tooltipText.stopLoss} value={fp(visualPlan.stop)} tone="bad" />
            <Metric label="TP1" tooltip={tooltipText.trim1} value={fp(visualPlan.trim1)} tone="good" />
            <Metric label="TP2" tooltip={tooltipText.trim2} value={fp(visualPlan.trim2)} tone="good" />
            <Metric label="Runner" tooltip={tooltipText.runner} value={fp(visualPlan.runner ?? visualPlan.target)} tone="good" />
            <Metric label="Risk" value={`$${rewardRisk.risk.toFixed(2)}`} tone={rewardRisk.risk > profile.maxRiskPerTrade ? "bad" : "neutral"} />
            <Metric label="Reward/Risk" value={`${rewardRisk.ratio.toFixed(1)}R`} />
            <Metric label="Trade Grade" tooltip={tooltipText.tradeScore} value={`${tradeGrade.letter} ${tradeGrade.score}/100`} />
            <Metric label="Entry Quality" value={tradeGrade.entryQuality?.label || "Pending"} tone={tradeGrade.entryQuality?.label === "Ideal" ? "good" : tradeGrade.entryQuality?.label === "Chasing" || tradeGrade.entryQuality?.label === "Invalid" ? "bad" : "warn"} />
          </div>
          {tradeGrade.entryQuality?.message ? <div style={tradeGrade.entryQuality.label === "Ideal" ? styles.coachPrompt : styles.priceWarning}>{tradeGrade.entryQuality.message}</div> : null}
          {!autoTradePlan.noTrade ? (
            <div style={{ ...styles.coachPrompt, marginTop: "14px" }}>
              Auto plan: {autoTradePlan.direction.toUpperCase()} entry {fp(autoTradePlan.entry)}, stop {fp(autoTradePlan.stop)}, trims {fp(autoTradePlan.trim1)} / {fp(autoTradePlan.trim2)}, runner {fp(autoTradePlan.runner)}. Risk ${autoTradePlan.riskDollars.toFixed(2)}. R/R {autoTradePlan.rewardRisk.toFixed(1)}. Score {autoTradePlan.score}/100. {autoTradePlan.reason}
            </div>
          ) : null}
          {rewardRisk.invalid || !planValidation?.valid ? <div style={styles.priceWarning}>{planValidation?.reason || rewardRisk.reason || "Invalid plan: targets are on the wrong side of entry."}</div> : null}
          {missedEntry ? <div style={styles.missedEntry}>{missedEntry}</div> : null}
          {planActions}
        </>
      ) : (
        <>
          <p style={styles.emptyPlan}>{!zonesValid ? "Zones not ready. Add manual levels or wait for more candles." : activeTradePlan?.message || "No trade. Wait for confirmation."}</p>
          {planActions}
        </>
      )}
    </section>
  );
}

function RiskGuardCard({ discipline, fundedMetrics, fundedWarnings, profile, riskStatus }) {
  return (
    <section style={styles.rulesCard}>
      <div>
        <p style={styles.cardLabel}>Risk Guard</p>
        <h2 style={styles.sectionTitle}>Stay inside your limits</h2>
      </div>
      <div>
        <div style={styles.rulesGrid}>
          <Metric label="Max Trades" value={String(profile.maxTradesPerDay)} />
          <Metric label="Max Daily Loss" value={`$${profile.maxDailyLoss.toFixed(2)}`} />
          <Metric label="Current P/L" value={`$${discipline.dailyPnl.toFixed(2)}`} tone={discipline.dailyPnl >= 0 ? "good" : "bad"} />
          <Metric label="Risk Status" value={riskStatus} tone={riskStatus === "Good" ? "good" : riskStatus === "Warning" ? "warn" : "bad"} />
          <Metric label="Daily Risk Left" value={`$${fundedMetrics.dailyRiskRemaining.toFixed(2)}`} tone={fundedMetrics.dailyRiskRemaining > 100 ? "good" : "warn"} />
          <Metric label="Drawdown Left" value={`$${fundedMetrics.drawdownRemaining.toFixed(2)}`} tone={fundedMetrics.drawdownRemaining > 500 ? "good" : "warn"} />
        </div>
        <div style={{ ...styles.warningStack, marginTop: "14px" }}>
          {(fundedWarnings.length ? fundedWarnings : ["Inside funded-account guardrails."]).map((warning) => (
            <div key={warning} style={warning.includes("Inside") ? styles.coachPrompt : styles.warningBox}>{warning}</div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PropFirmRulesCard({ fundedMetrics, fundedWarnings, profile }) {
  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Prop Firm Rules</p>
      <h2 style={styles.sectionTitle}>{profile.fundedProvider || "Funded Account"}</h2>
      <div style={styles.metricGrid}>
        <Metric label="Daily Loss Left" value={`$${fundedMetrics.dailyRiskRemaining.toFixed(2)}`} tone={fundedMetrics.dailyRiskRemaining > 100 ? "good" : "warn"} />
        <Metric label="Drawdown Left" value={`$${fundedMetrics.drawdownRemaining.toFixed(2)}`} tone={fundedMetrics.drawdownRemaining > 500 ? "good" : "warn"} />
        <Metric label="Max Contracts" value={String(profile.maxContracts)} />
        <Metric label="Consistency Rule" value={`${profile.consistencyRuleTarget}%`} />
      </div>
      <div style={{ ...styles.warningStack, marginTop: "14px" }}>
        {(fundedWarnings.length ? fundedWarnings : ["Protect payout. Stay inside rule limits."]).map((warning) => (
          <div key={warning} style={warning.includes("Protect") ? styles.coachPrompt : styles.warningBox}>{warning}</div>
        ))}
      </div>
    </section>
  );
}

function WatchlistCard({ price, profile, watchlist }) {
  const items = normalizeWatchlistItems(watchlist, profile.mainMarket);
  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Watchlist</p>
      <h2 style={styles.sectionTitle}>Markets</h2>
      {items.length ? (
        <div style={styles.warningStack}>
          {items.slice(0, 6).map((item) => (
            <PlanItem key={item.id || item.symbol} title={item.symbol} text={item.symbol === profile.mainMarket ? `Current price ${Number(price).toFixed(2)}` : item.notes || "Watching"} />
          ))}
        </div>
      ) : (
        <p style={{ ...styles.muted, margin: 0 }}>No symbols on your watchlist yet. Add markets from Settings to track them here.</p>
      )}
    </section>
  );
}

function PerformanceStatsCard({ discipline, journalEntries, tradeGrade }) {
  const analytics = getJournalAnalytics(journalEntries, discipline);
  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Performance Stats</p>
      <h2 style={styles.sectionTitle}>Execution Snapshot</h2>
      <div style={styles.metricGrid}>
        <Metric label="Trade Grade" value={`${tradeGrade.letter} ${tradeGrade.score}/100`} tone={tradeGrade.score >= 75 ? "good" : tradeGrade.score >= 55 ? "warn" : "bad"} />
        <Metric label="Total Trades" value={String(analytics.totalTrades)} />
        <Metric label="Win Rate" value={`${analytics.winRate}%`} />
        <Metric label="Profit Factor" value={analytics.profitFactor.toFixed(2)} />
        <Metric label="Best Day" value={`$${analytics.bestDay.toFixed(2)}`} tone="good" />
        <Metric label="Worst Day" value={`$${analytics.worstDay.toFixed(2)}`} tone="bad" />
      </div>
    </section>
  );
}


function calculateTrade({ activePosition, contracts, direction, discipline, entry, price, profile, resistance, riskPoints, support }) {
  const pointValue = pointValues[profile.mainMarket] || customMarketSpec.pointValue;
  const isLong = direction === "long";
  const inChop = price >= support && price <= resistance;
  const longTrigger = price > resistance;
  const shortTrigger = price < support;
  const directionAligned = (isLong && longTrigger) || (!isLong && shortTrigger);
  const distanceFromEntry = Math.abs(price - entry);
  const trim1Points = Math.max(1, Math.abs(Number(profile.trim1Points) || 1));
  const trim2Points = Math.max(trim1Points + 0.25, Math.abs(Number(profile.trim2Points) || trim1Points * 2));
  const runnerPoints = Math.max(trim2Points + 0.25, Math.abs(Number(profile.runnerPoints) || trim2Points * 1.5));
  const trim1 = isLong ? entry + trim1Points : entry - trim1Points;
  const trim2 = isLong ? entry + trim2Points : entry - trim2Points;
  const runner = isLong ? entry + runnerPoints : entry - runnerPoints;
  const rewardPoints = Math.abs(trim2 - entry);
  const rewardRisk = riskPoints > 0 ? rewardPoints / riskPoints : 0;
  const { smartStop, stopReason } = getSmartStop({ direction, entry, resistance, riskPoints, support });
  const actualRiskPoints = Math.abs(entry - smartStop);
  const totalRisk = actualRiskPoints * pointValue * contracts;
  const dollarPerPoint = pointValue * contracts;
  const riskPerTenPoints = dollarPerPoint * 10;
  const estimatedMaxLoss = riskPoints * dollarPerPoint;
  const openPnl = (isLong ? price - entry : entry - price) * pointValue * contracts;
  const riskLeft = Math.max(0, totalRisk + Math.min(openPnl, 0));
  const trim1Hit = isLong ? price >= trim1 : price <= trim1;
  const trim2Hit = isLong ? price >= trim2 : price <= trim2;
  const runnerHit = isLong ? price >= runner : price <= runner;
  const stopHit = isLong ? price <= smartStop : price >= smartStop;
  const runnerApproaching = isLong ? price >= runner - 5 : price <= runner + 5;
  const lostStructure = isLong ? price < support : price > resistance;
  const dailyLossUsed = Math.max(0, -discipline.dailyPnl);

  const factors = {
    location: directionAligned ? 20 : inChop ? 4 : 10,
    risk: riskPoints <= profile.defaultRiskPoints ? 15 : riskPoints <= profile.defaultRiskPoints * 1.5 ? 10 : 4,
    reward: rewardRisk >= 2 ? 20 : rewardRisk >= 1.5 ? 15 : rewardRisk >= 1 ? 10 : 3,
    direction: directionAligned ? 15 : inChop ? 4 : 8,
    distance: distanceFromEntry <= riskPoints ? 15 : distanceFromEntry <= riskPoints * 2 ? 9 : 4,
    contracts:
      estimatedMaxLoss > profile.maxRiskPerTrade || totalRisk > profile.accountSize * 0.015
        ? 3
        : contracts <= profile.defaultContracts
          ? 15
          : contracts <= profile.defaultContracts * 1.5
            ? 9
            : 5,
  };

  const chopPenalty = inChop ? 12 : 0;
  const score = Math.max(0, Math.min(100, Object.values(factors).reduce((sum, value) => sum + value, 0) - chopPenalty));
  const confidence = score >= 75 ? "High" : score >= 50 ? "Medium" : "Low";
  const confidenceColor = confidence === "High" ? "#16a34a" : confidence === "Medium" ? "#ca8a04" : "#dc2626";
  const bias = inChop ? "WAIT" : longTrigger ? "LONG TRIGGER" : "SHORT TRIGGER";
  const biasColor = bias === "LONG TRIGGER" ? "#22c55e" : bias === "SHORT TRIGGER" ? "#ef4444" : "#facc15";
  const biasMessage = inChop ? "Price is trapped between support and resistance." : `${bias}. Wait for momentum and clean execution.`;

  let coachMessage = "Stop should be below structure, not random.";
  if (inChop) coachMessage = "Wait. Price is in the middle.";
  else if (longTrigger && isLong) coachMessage = "Long trigger active. Wait for momentum.";
  else if (shortTrigger && !isLong) coachMessage = "Short trigger active. Wait for momentum.";
  if ((isLong && Math.abs(price - support) <= riskPoints) || (!isLong && Math.abs(price - resistance) <= riskPoints)) coachMessage = "Good setup: price near support.";
  if (trim1Hit && !trim2Hit) coachMessage = "First trim hit. Take partial profit.";
  if (totalRisk > profile.accountSize * 0.015 || estimatedMaxLoss > profile.maxRiskPerTrade) coachMessage = "Risk too high. Lower contracts.";
  if (Math.abs(price - entry) > riskPoints * 2) coachMessage = "Do not chase after a big candle.";

  let suggestedAction = "HOLD";
  let actionTone = "neutral";
  if (stopHit || runnerHit || lostStructure) {
    suggestedAction = "EXIT";
    actionTone = "bad";
  } else if (trim2Hit) {
    suggestedAction = "MOVE STOP";
    actionTone = "warn";
  } else if (trim1Hit) {
    suggestedAction = "TRIM";
    actionTone = "good";
  } else if (openPnl < -totalRisk * 0.6) {
    suggestedAction = "EXIT";
    actionTone = "bad";
  }

  const disciplineWarnings = [];
  if (discipline.tradesTaken >= profile.maxTradesPerDay) disciplineWarnings.push("You have exceeded your max trades today. Avoid revenge trading.");
  else if (discipline.tradesTaken >= Math.max(1, profile.maxTradesPerDay - 1)) disciplineWarnings.push("You are near max trades.");
  if (dailyLossUsed >= profile.maxDailyLoss) disciplineWarnings.push("Daily loss limit reached. Consider stopping trading today.");
  else if (dailyLossUsed >= profile.maxDailyLoss * 0.75) disciplineWarnings.push("Daily loss limit approaching.");
  if (contracts > profile.maxContracts) disciplineWarnings.push("Contracts exceed your max contract safety setting.");
  if (estimatedMaxLoss > profile.maxRiskPerTrade) disciplineWarnings.push("Position size too large for this account.");
  if (profile.mainMarket === "MNQ" && profile.accountSize < 2000 && contracts > 3) disciplineWarnings.push("High risk size detected.");
  if (disciplineWarnings.length === 0) disciplineWarnings.push("Discipline guardrails are clear.");

  const autoCoaching = [];
  if (trim1Hit || activePosition?.status === "trim1") autoCoaching.push("Trim 1 reached. Take partial profit.");
  if (trim1Hit || trim2Hit || activePosition?.status === "moveStop") autoCoaching.push("Move stop to breakeven.");
  if (trim2Hit || activePosition?.status === "trim2") autoCoaching.push("Trim 2 reached. Protect the runner.");
  if (runnerApproaching && !runnerHit) autoCoaching.push("Runner target approaching.");
  if (stopHit) autoCoaching.push("Stop hit. Exit plan is active.");
  if (runnerHit) autoCoaching.push("Runner target hit. Consider closing or trailing tight.");
  if (inChop) autoCoaching.push("You are in chop.");
  if (!inChop && directionAligned && Math.abs(price - entry) < riskPoints * 0.35) autoCoaching.push("Price losing momentum.");
  if (lostStructure) autoCoaching.push("Exit if price loses structure.");
  if (autoCoaching.length === 0) autoCoaching.push("Hold plan. Wait for price to reach a decision level.");

  const grade = getSetupGradeLabel(score);

  return {
    actionTone,
    autoCoaching,
    bias,
    biasColor,
    biasMessage,
    coachMessage,
    confidence,
    confidenceColor,
    disciplineWarnings,
    dollarPerPoint,
    estimatedMaxLoss,
    factors,
    grade,
    openPnl,
    riskLeft,
    riskPerTenPoints,
    score,
    smartStop,
    stopReason,
    suggestedAction,
    trim1,
    trim2,
    runner,
  };
}

function analyzeKeyLevels({ breakoutLevel, currentPrice, direction, marketBias, pullbackSupport, recentHigh, resistance, support }) {
  const tolerance = Math.max(2, currentPrice * 0.001);
  const middleLow = pullbackSupport + tolerance * 1.5;
  const middleHigh = recentHigh - tolerance * 1.5;
  const nearSupport = Math.abs(currentPrice - pullbackSupport) <= tolerance || Math.abs(currentPrice - support) <= tolerance;
  const nearResistance = Math.abs(currentPrice - recentHigh) <= tolerance || Math.abs(currentPrice - resistance) <= tolerance;
  const nearBreakout = Math.abs(currentPrice - breakoutLevel) <= tolerance;
  const inMiddle = currentPrice > middleLow && currentPrice < middleHigh;
  const normalizedBias = normalizeActiveBias(marketBias);
  const bullish = normalizedBias === "bullish";
  const bearish = normalizedBias === "bearish";

  let marketState = "Chop / no trade";
  let action = "WAIT";
  let message = "Price is not at a clean decision level. Wait for support, resistance, or a retest.";
  let plan = {
    entry: "Wait for price to reach support, resistance, or a clean retest.",
    stop: "No stop until there is a valid setup.",
    target1: "No target until there is a valid setup.",
    target2: "No runner until there is a valid setup.",
  };

  if (inMiddle) {
    action = "NO TRADE: PRICE IN MIDDLE";
    message = "Middle zone is a bad entry area. Do not chase in the middle.";
  }

  if (bullish && nearSupport) {
    marketState = "Bullish pullback";
    action = "SUPPORT TEST: WATCH FOR BOUNCE";
    message = "Bullish pullback. Wait for support reaction. Do not chase in the middle.";
    plan = {
      entry: `${pullbackSupport.toFixed(2)} to ${(pullbackSupport + 5).toFixed(2)}`,
      stop: `${(pullbackSupport - 20).toFixed(2)} to ${(pullbackSupport - 15).toFixed(2)}`,
      target1: recentHigh.toFixed(2),
      target2: `${(resistance + 10).toFixed(2)} or trail runner`,
    };
  } else if (bearish && nearResistance) {
    marketState = "Bearish pullback";
    action = "LOOK FOR SHORT";
    message = "Bearish pullback. Wait for resistance rejection before looking short.";
    plan = {
      entry: `${(recentHigh - 5).toFixed(2)} to ${recentHigh.toFixed(2)}`,
      stop: `${(recentHigh + 15).toFixed(2)} to ${(recentHigh + 20).toFixed(2)}`,
      target1: pullbackSupport.toFixed(2),
      target2: `${(pullbackSupport - 10).toFixed(2)} or next structure below`,
    };
  } else if (bearish && (nearBreakout || currentPrice >= breakoutLevel)) {
    marketState = "High-of-day resistance";
    action = "LOOK FOR SHORT";
    message = "Price is testing high-of-day resistance with bearish bias. Wait for rejection confirmation.";
    plan = {
      entry: `Rejection below high: ${(breakoutLevel - 1).toFixed(2)}`,
      stop: `Above rejection high near ${(breakoutLevel + 5).toFixed(2)}`,
      target1: pullbackSupport.toFixed(2),
      target2: `${(pullbackSupport - 10).toFixed(2)} or next structure below`,
    };
  } else if (bullish && (nearBreakout || currentPrice > breakoutLevel)) {
    marketState = "Breakout attempt";
    action = "BREAKOUT: WAIT FOR RETEST";
    message = "Breakout attempt. Wait for the level to break and retest before entering.";
    plan = {
      entry: "Resistance break + retest",
      stop: `Below breakout level near ${(breakoutLevel - 5).toFixed(2)}`,
      target1: `+10 points: ${(breakoutLevel + 10).toFixed(2)}`,
      target2: `+20 to +35 points: ${(breakoutLevel + 20).toFixed(2)} to ${(breakoutLevel + 35).toFixed(2)}`,
    };
  } else if (currentPrice < pullbackSupport) {
    marketState = "Support test";
    action = "LOOK FOR SHORT";
    message = "Support failure. Only look short if price accepts below support.";
    plan = {
      entry: `Below support: ${(pullbackSupport - 1).toFixed(2)}`,
      stop: `Back above support: ${(pullbackSupport + 5).toFixed(2)}`,
      target1: `Next structure below: ${(pullbackSupport - 10).toFixed(2)}`,
      target2: `Extended target: ${(pullbackSupport - 25).toFixed(2)}`,
    };
  } else if (bullish && currentPrice > pullbackSupport && currentPrice < recentHigh) {
    marketState = "Trend continuation";
    action = "WAIT";
    message = "Trend continuation, but price is between levels. Wait for pullback or retest.";
  } else if (nearResistance) {
    marketState = "Resistance test";
    action = "WAIT";
    message = "Resistance test. Watch for rejection or breakout and retest.";
  } else if (nearSupport) {
    marketState = "Support test";
    action = "SUPPORT TEST: WATCH FOR BOUNCE";
    message = "Support test. Wait for buyers to defend before entering.";
  }

  return { action, marketState, message, plan };
}

function chartDataToCandles(chartData = []) {
  return safeArray(chartData).map((point, index, list) => {
    const close = Number(point.close || 0);
    const previous = Number(list[index - 1]?.close ?? close);
    const range = Math.max(1, Math.abs(close - previous) * 1.6);
    return {
      close,
      high: close + range * 0.5,
      low: close - range * 0.5,
      open: previous,
      timestamp: point.label,
    };
  });
}

function detectKeyLevelsFromCandles(candles = [], fallback = {}) {
  const clean = safeArray(candles)
    .map((candle) => ({
      close: Number(candle.close),
      high: Number(candle.high ?? candle.close),
      low: Number(candle.low ?? candle.close),
      open: Number(candle.open ?? candle.close),
      timestamp: candle.timestamp,
      ts: candle.timestamp ? new Date(candle.timestamp).getTime() : NaN,
    }))
    .filter((candle) => [candle.close, candle.high, candle.low, candle.open].every(Number.isFinite));

  if (!clean.length) {
    return {
      message: "Add support/resistance manually or connect TradingView alerts.",
      middleZone: "",
      openRange: "",
      resistanceZone: formatOptionalPrice(fallback.resistance),
      sessionHigh: fallback.resistance,
      sessionLow: fallback.support,
      supportZone: formatOptionalPrice(fallback.support),
    };
  }

  // Constrain analysis to current session candles. When no anchor is available,
  // fall back to the most recent 100 candles.
  const sessionAnchorMs = Number.isFinite(Number(fallback.sessionAnchorMs))
    ? Number(fallback.sessionAnchorMs)
    : null;
  const sessionCandles = sessionAnchorMs !== null
    ? clean.filter((c) => Number.isFinite(c.ts) && c.ts >= sessionAnchorMs)
    : clean.slice(-100);
  // Never cross session boundaries: when an anchor is set, only use session candles.
  const recent = sessionAnchorMs !== null
    ? sessionCandles
    : (sessionCandles.length >= 6 ? sessionCandles : clean.slice(-100));

  if (!recent.length) {
    return {
      message: sessionAnchorMs !== null
        ? "Collecting fresh TradingView candles…"
        : "Add support/resistance manually or connect TradingView alerts.",
      openRange: "",
      openRangeAvailable: false,
      openRangeCandles: 0,
      openRangeHigh: null,
      openRangeLow: null,
      sessionCandleCount: 0,
      sessionHigh: null,
      sessionLow: null,
      source: "insufficient",
    };
  }

  const highs = recent.map((candle) => candle.high);
  const lows = recent.map((candle) => candle.low);
  const sessionHigh = Math.max(...highs);
  const sessionLow = Math.min(...lows);
  const priorHigh = recent.length > 1 ? Math.max(...highs.slice(0, -1)) : sessionHigh;
  const priorLow = recent.length > 1 ? Math.min(...lows.slice(0, -1)) : sessionLow;

  // Open range: first 15 minutes of the active session (RTH 9:30 NY).
  // If no candles fall inside that window, openRange is unavailable instead
  // of being faked from "first 6 bars" of the entire history.
  let openRangeHigh = null;
  let openRangeLow = null;
  let openRangeCount = 0;
  let openRangeAvailable = false;
  if (sessionAnchorMs !== null) {
    const orWindow = sessionAnchorMs + 15 * 60_000;
    const orCandles = clean.filter((c) => Number.isFinite(c.ts) && c.ts >= sessionAnchorMs && c.ts <= orWindow);
    openRangeCount = orCandles.length;
    if (orCandles.length) {
      openRangeHigh = Math.max(...orCandles.map((c) => c.high));
      openRangeLow = Math.min(...orCandles.map((c) => c.low));
      openRangeAvailable = true;
    }
  }

  // Swing pivots from the most recent 100 valid candles only.
  const swingPool = recent.slice(-100);
  const swingHighs = [];
  const swingLows = [];
  for (let index = 1; index < swingPool.length - 1; index += 1) {
    if (swingPool[index].high >= swingPool[index - 1].high && swingPool[index].high >= swingPool[index + 1].high) swingHighs.push(swingPool[index].high);
    if (swingPool[index].low <= swingPool[index - 1].low && swingPool[index].low <= swingPool[index + 1].low) swingLows.push(swingPool[index].low);
  }

  const currentPrice = Number(fallback.price || recent.at(-1).close);
  // Rejection zones must lie within a reasonable band of currentPrice — the
  // old engine emitted levels like 43905.37 when stale candles slipped in.
  const rejectionBand = Math.max(Math.abs(currentPrice) * 0.01, sessionHigh - sessionLow);
  const inBand = (level) => Number.isFinite(level)
    && Number.isFinite(currentPrice)
    && Math.abs(level - currentPrice) <= rejectionBand * 4;
  const rejectionPad = Math.max(1, (sessionHigh - sessionLow) * 0.018);
  const rawRejectionHighs = findRepeatedRejectionLevels(
    [...swingHighs, priorHigh, ...(openRangeAvailable ? [openRangeHigh] : []), sessionHigh].filter(inBand),
    rejectionPad,
  );
  const rawRejectionLows = findRepeatedRejectionLevels(
    [...swingLows, priorLow, ...(openRangeAvailable ? [openRangeLow] : []), sessionLow].filter(inBand),
    rejectionPad,
  );
  const rejectionHighs = rawRejectionHighs.filter(inBand);
  const rejectionLows = rawRejectionLows.filter(inBand);

  const supportPool = [
    fallback.support, priorLow,
    ...(openRangeAvailable ? [openRangeLow] : []),
    sessionLow,
    ...swingLows,
    ...rejectionLows,
  ].filter(Number.isFinite).filter((level) => Math.abs(level - currentPrice) <= rejectionBand * 4);
  const resistancePool = [
    fallback.resistance, priorHigh,
    ...(openRangeAvailable ? [openRangeHigh] : []),
    sessionHigh,
    ...swingHighs,
    ...rejectionHighs,
  ].filter(Number.isFinite).filter((level) => Math.abs(level - currentPrice) <= rejectionBand * 4);

  const supportLevel = averageNearest(supportPool, currentPrice, "below");
  const resistanceLevel = averageNearest(resistancePool, currentPrice, "above");
  const zonePad = Math.max(1, (sessionHigh - sessionLow) * 0.015);
  const middleLow = Number((supportLevel + (resistanceLevel - supportLevel) * 0.38).toFixed(2));
  const middleHigh = Number((supportLevel + (resistanceLevel - supportLevel) * 0.62).toFixed(2));

  return {
    breakoutLevel: resistanceLevel,
    repeatedRejectionHighs: Array.isArray(rejectionHighs) ? rejectionHighs : [],
    repeatedRejectionLows: Array.isArray(rejectionLows) ? rejectionLows : [],
    message: "Zones are estimated from recent session swing highs/lows, repeated rejection areas, prior levels, session range, and opening range.",
    middleZone: `${middleLow.toFixed(2)} - ${middleHigh.toFixed(2)}`,
    middleZoneHigh: middleHigh,
    middleZoneLow: middleLow,
    openRange: openRangeAvailable ? `${openRangeLow.toFixed(2)} - ${openRangeHigh.toFixed(2)}` : "",
    openRangeHigh: openRangeAvailable ? openRangeHigh : null,
    openRangeLow: openRangeAvailable ? openRangeLow : null,
    openRangeAvailable,
    openRangeCandles: openRangeCount,
    priorHigh,
    priorLow,
    pullbackSupport: supportLevel,
    recentHigh: resistanceLevel,
    resistanceLevel,
    resistanceZoneHigh: Number((resistanceLevel + zonePad).toFixed(2)),
    resistanceZoneLow: Number((resistanceLevel - zonePad).toFixed(2)),
    resistanceZone: `${(resistanceLevel - zonePad).toFixed(2)} - ${(resistanceLevel + zonePad).toFixed(2)}`,
    sessionHigh,
    sessionLow,
    sessionCandleCount: recent.length,
    sessionAnchorMs,
    source: sessionAnchorMs !== null ? "session-candles" : "recent-100-candles",
    supportLevel,
    supportZoneHigh: Number((supportLevel + zonePad).toFixed(2)),
    supportZoneLow: Number((supportLevel - zonePad).toFixed(2)),
    supportZone: `${(supportLevel - zonePad).toFixed(2)} - ${(supportLevel + zonePad).toFixed(2)}`,
  };
}

// ── Signal Quality Engine helpers ──────────────────────────────────────────────

function calcEMA(prices, period) {
  if (!prices.length) return 0;
  const k = 2 / (period + 1);
  const seed = prices.slice(0, period).reduce((a, b) => a + b, 0) / Math.min(period, prices.length);
  let ema = seed;
  for (let i = Math.min(period, prices.length); i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calcATR(candles, period = 14) {
  if (candles.length < 2) return 0;
  const trs = candles.slice(1).map((c, i) =>
    Math.max(c.high - c.low, Math.abs(c.high - candles[i].close), Math.abs(c.low - candles[i].close))
  );
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

// ───────────────────────────────────────────────────────────────────────────────

// Market Structure Engine — detects swing highs/lows, liquidity sweeps, VWAP proxy, session levels
function analyzeMarketStructure(candles = [], fallback = {}) {
  const clean = safeArray(candles)
    .map((c) => ({
      close: Number(c.close),
      high: Number(c.high ?? c.close),
      low: Number(c.low ?? c.close),
      open: Number(c.open ?? c.close),
      volume: Number(c.volume ?? 1),
      ts: c.timestamp ? new Date(c.timestamp).getTime() : NaN,
    }))
    .filter((c) => [c.close, c.high, c.low, c.open].every(Number.isFinite));

  // Restrict to the active session when an anchor is supplied. Never fall back to
  // cross-session candles — that's what was producing multi-day highs/lows.
  const sessionAnchorMs = Number.isFinite(Number(fallback.sessionAnchorMs))
    ? Number(fallback.sessionAnchorMs)
    : null;
  const sessionScoped = sessionAnchorMs !== null
    ? clean.filter((c) => Number.isFinite(c.ts) && c.ts >= sessionAnchorMs)
    : [];
  const recent = sessionAnchorMs !== null ? sessionScoped : clean.slice(-100);

  const currentPrice = Number(fallback.price ?? recent.at(-1)?.close ?? 0);
  if (!recent.length) {
    return {
      liquiditySweepHigh: null,
      liquiditySweepLow: null,
      marketStructure: "unknown",
      sessionHigh: Number(fallback.resistance ?? currentPrice),
      sessionLow: Number(fallback.support ?? currentPrice),
      structureMessage: "Insufficient candle data. Using manual levels.",
      swingHighs: [],
      swingLows: [],
      vwap: currentPrice,
    };
  }

  // Swing highs and lows (3-bar pivot) — restricted to recent session candles.
  const swingHighs = [];
  const swingLows = [];
  for (let i = 1; i < recent.length - 1; i++) {
    if (recent[i].high > recent[i - 1].high && recent[i].high > recent[i + 1].high) swingHighs.push(recent[i].high);
    if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i + 1].low) swingLows.push(recent[i].low);
  }

  // Session extremes — only from current session candles (or last 100 fallback).
  const sessionHigh = Math.max(...recent.map((c) => c.high));
  const sessionLow = Math.min(...recent.map((c) => c.low));

  // VWAP proxy: weighted average of typical price by volume
  const totalVolume = recent.reduce((sum, c) => sum + c.volume, 0);
  const vwap = totalVolume > 0
    ? Number((recent.reduce((sum, c) => sum + ((c.high + c.low + c.close) / 3) * c.volume, 0) / totalVolume).toFixed(2))
    : Number(((sessionHigh + sessionLow) / 2).toFixed(2));

  // Liquidity sweep detection: price briefly exceeded a prior swing level then reversed
  let liquiditySweepHigh = null;
  let liquiditySweepLow = null;
  if (swingHighs.length >= 2 && recent.length >= 3) {
    const priorSwingHigh = swingHighs[swingHighs.length - 2];
    const last = recent.at(-1);
    const prev = recent.at(-2);
    if (last.high > priorSwingHigh && last.close < priorSwingHigh) liquiditySweepHigh = priorSwingHigh;
    if (prev.high > priorSwingHigh && prev.close < priorSwingHigh) liquiditySweepHigh = priorSwingHigh;
  }
  if (swingLows.length >= 2 && recent.length >= 3) {
    const priorSwingLow = swingLows[swingLows.length - 2];
    const last = recent.at(-1);
    const prev = recent.at(-2);
    if (last.low < priorSwingLow && last.close > priorSwingLow) liquiditySweepLow = priorSwingLow;
    if (prev.low < priorSwingLow && prev.close > priorSwingLow) liquiditySweepLow = priorSwingLow;
  }

  // Market structure: higher highs/higher lows = bullish, lower highs/lower lows = bearish
  let marketStructure = "neutral";
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const risingHighs = swingHighs.at(-1) > swingHighs.at(-2);
    const risingLows = swingLows.at(-1) > swingLows.at(-2);
    const fallingHighs = swingHighs.at(-1) < swingHighs.at(-2);
    const fallingLows = swingLows.at(-1) < swingLows.at(-2);
    if (risingHighs && risingLows) marketStructure = "bullish";
    else if (fallingHighs && fallingLows) marketStructure = "bearish";
    else if (risingHighs && fallingLows) marketStructure = "distribution";
    else if (fallingHighs && risingLows) marketStructure = "accumulation";
  }

  const aboveVwap = currentPrice > vwap;

  // ── EMA trend analysis ────────────────────────────────────────────────────────
  const closes = recent.map((c) => c.close);
  const emaFast = closes.length >= 3 ? calcEMA(closes, Math.min(9, closes.length)) : currentPrice;
  const emaSlow = closes.length >= 5 ? calcEMA(closes, Math.min(21, closes.length)) : currentPrice;
  let emaSlope = "flat";
  if (closes.length >= 8) {
    const oldEma = calcEMA(closes.slice(0, -5), Math.min(9, closes.length - 5));
    const slopePct = Math.abs(oldEma) > 0.01 ? (emaFast - oldEma) / Math.abs(oldEma) : 0;
    if (slopePct > 0.0008) emaSlope = "bullish";
    else if (slopePct < -0.0008) emaSlope = "bearish";
  }

  // ── ATR (14-period) ───────────────────────────────────────────────────────────
  const atr = calcATR(recent, Math.min(14, Math.max(1, recent.length - 1)));

  // ── Consecutive close direction ───────────────────────────────────────────────
  let consecutiveBullish = 0;
  let consecutiveBearish = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const c = recent[i];
    if (c.close > c.open) {
      if (consecutiveBearish > 0) break;
      consecutiveBullish++;
    } else if (c.close < c.open) {
      if (consecutiveBullish > 0) break;
      consecutiveBearish++;
    } else {
      break;
    }
  }

  // ── Momentum score (0–100) ────────────────────────────────────────────────────
  const lastC = recent.at(-1);
  const lastRange = Math.max(0.01, lastC.high - lastC.low);
  const closePct = (lastC.close - lastC.low) / lastRange;
  const momentumScore =
    consecutiveBullish >= 3 ? Math.min(100, 50 + consecutiveBullish * 13) :
    consecutiveBearish >= 3 ? Math.min(100, 50 + consecutiveBearish * 13) :
    consecutiveBullish === 2 ? (closePct >= 0.55 ? 65 : 50) :
    consecutiveBearish === 2 ? (closePct <= 0.45 ? 65 : 50) :
    consecutiveBullish === 1 ? (closePct >= 0.6 ? 40 : 26) :
    consecutiveBearish === 1 ? (closePct <= 0.4 ? 40 : 26) :
    20;

  // ── Chop detection ────────────────────────────────────────────────────────────
  let isChop = false;
  let chopReason = "";
  if (recent.length >= 6 && emaSlope === "flat") {
    const last6 = recent.slice(-6);
    let overlapCount = 0;
    let alterCount = 0;
    for (let i = 1; i < last6.length; i++) {
      const p = last6[i - 1];
      const c = last6[i];
      const pH = Math.max(p.open, p.close);
      const pL = Math.min(p.open, p.close);
      const cH = Math.max(c.open, c.close);
      const cL = Math.min(c.open, c.close);
      const overlap = Math.max(0, Math.min(pH, cH) - Math.max(pL, cL));
      if (overlap / Math.max(0.01, cH - cL) > 0.4) overlapCount++;
      if ((p.close > p.open) !== (c.close > c.open)) alterCount++;
    }
    if (overlapCount >= 3 && alterCount >= 3) {
      isChop = true;
      chopReason = "EMA flat, bodies overlapping, direction alternating.";
    }
  }

  let structureMessage = `Market structure is ${marketStructure}. Price is ${aboveVwap ? "above" : "below"} VWAP (${vwap.toFixed(2)}).`;
  if (isChop) structureMessage += " Chop detected — no directional edge.";
  if (liquiditySweepHigh) structureMessage += ` Liquidity sweep above ${liquiditySweepHigh.toFixed(2)} — watch for reversal.`;
  if (liquiditySweepLow) structureMessage += ` Liquidity sweep below ${liquiditySweepLow.toFixed(2)} — watch for reversal.`;

  return {
    aboveVwap,
    atr,
    chopReason,
    consecutiveBearish,
    consecutiveBullish,
    emaFast,
    emaSlope,
    emaSlow,
    isChop,
    liquiditySweepHigh,
    liquiditySweepLow,
    marketStructure,
    momentumScore,
    sessionHigh,
    sessionLow,
    structureMessage,
    swingHighs,
    swingLows,
    vwap,
  };
}

// Multi-factor signal quality scorer — weights: structure 25, trend 20, momentum 20, confirmation 15, volatility 10, session 10
function scoreSignalQuality({ direction, structure, price }) {
  if (!structure || !direction) {
    return { noTrade: true, noTradeReason: "Insufficient market data.", overallScore: 0, confidence: "No Trade", explanation: "NO TRADE — Insufficient market data." };
  }
  const isLong = direction === "long";
  const ms = structure.marketStructure || "unknown";
  const emaSlope = structure.emaSlope || "flat";
  const emaFast = structure.emaFast ?? price;
  const emaSlow = structure.emaSlow ?? price;
  const isChop = structure.isChop || false;
  const chopReason = structure.chopReason || "";
  const consecutiveBullish = structure.consecutiveBullish ?? 0;
  const consecutiveBearish = structure.consecutiveBearish ?? 0;
  const sessionHigh = structure.sessionHigh ?? price;
  const sessionLow = structure.sessionLow ?? price;
  const atr = structure.atr ?? 0;
  const priceVal = Number(price);

  // ── Hard veto conditions ──────────────────────────────────────────────────────
  if (isChop) {
    return { noTrade: true, noTradeReason: `Market in chop. ${chopReason} Wait for directional momentum.`, overallScore: 0, confidence: "No Trade", explanation: `NO TRADE — Market in chop. ${chopReason}` };
  }
  if (isLong && ms === "bearish") {
    return { noTrade: true, noTradeReason: "Bearish market structure (lower highs + lower lows). No long setups.", overallScore: 5, confidence: "No Trade", explanation: "NO TRADE — Bearish market structure. Price making lower highs and lower lows. Wait for structure reclaim before any long." };
  }
  if (!isLong && ms === "bullish") {
    return { noTrade: true, noTradeReason: "Bullish market structure (higher highs + higher lows). No short setups.", overallScore: 5, confidence: "No Trade", explanation: "NO TRADE — Bullish market structure. Price making higher highs and higher lows. Wait for a confirmed breakdown before any short." };
  }
  if (isLong && emaSlope === "bearish" && priceVal < emaSlow) {
    return { noTrade: true, noTradeReason: "Price below bearish EMA — trend headwind too strong for long.", overallScore: 12, confidence: "No Trade", explanation: "NO TRADE — Price below falling EMA with bearish slope. Long against dominant trend requires very high-quality structure — not present." };
  }
  if (!isLong && emaSlope === "bullish" && priceVal > emaSlow) {
    return { noTrade: true, noTradeReason: "Price above bullish EMA — trend headwind too strong for short.", overallScore: 12, confidence: "No Trade", explanation: "NO TRADE — Price above rising EMA with bullish slope. Short against dominant trend requires very high-quality structure — not present." };
  }

  // ── Factor 1: Structure alignment (0–25) ─────────────────────────────────────
  let structureScore, structureReason;
  if (isLong) {
    if (ms === "bullish")      { structureScore = 25; structureReason = "higher highs and higher lows confirmed"; }
    else if (ms === "accumulation") { structureScore = 18; structureReason = "higher lows forming (accumulation)"; }
    else if (ms === "distribution") { structureScore = 4;  structureReason = "distribution — deteriorating long structure"; }
    else                       { structureScore = 8;  structureReason = "unclear market structure"; }
  } else {
    if (ms === "bearish")      { structureScore = 25; structureReason = "lower highs and lower lows confirmed"; }
    else if (ms === "distribution") { structureScore = 18; structureReason = "lower highs forming (distribution)"; }
    else if (ms === "accumulation") { structureScore = 4;  structureReason = "accumulation — deteriorating short structure"; }
    else                       { structureScore = 8;  structureReason = "unclear market structure"; }
  }

  // ── Factor 2: Trend / EMA alignment (0–20) ───────────────────────────────────
  let trendScore, trendReason;
  if (isLong) {
    if (emaSlope === "bullish" && priceVal > emaSlow)  { trendScore = 20; trendReason = "price above rising EMA — trend aligned"; }
    else if (emaSlope === "bullish" || priceVal > emaFast) { trendScore = 13; trendReason = "partial trend alignment"; }
    else if (emaSlope === "flat")                      { trendScore = 8;  trendReason = "EMA flat — no trend confirmation"; }
    else                                               { trendScore = 3;  trendReason = "price below bearish EMA — trend headwind"; }
  } else {
    if (emaSlope === "bearish" && priceVal < emaSlow)  { trendScore = 20; trendReason = "price below falling EMA — trend aligned"; }
    else if (emaSlope === "bearish" || priceVal < emaFast) { trendScore = 13; trendReason = "partial trend alignment"; }
    else if (emaSlope === "flat")                      { trendScore = 8;  trendReason = "EMA flat — no trend confirmation"; }
    else                                               { trendScore = 3;  trendReason = "price above bullish EMA — trend headwind"; }
  }

  // ── Factor 3: Momentum (0–20) ─────────────────────────────────────────────────
  const consec = isLong ? consecutiveBullish : consecutiveBearish;
  let momentumFactor, momentumReason;
  if (consec >= 3)      { momentumFactor = 20; momentumReason = `${consec} consecutive confirming closes`; }
  else if (consec === 2) { momentumFactor = 14; momentumReason = "2 confirming closes"; }
  else if (consec === 1) { momentumFactor = 7;  momentumReason = "1 confirming close — weak momentum"; }
  else                  { momentumFactor = 1;  momentumReason = "no confirming closes in signal direction"; }

  // ── Factor 4: Confirmation quality (0–15) ────────────────────────────────────
  let confirmScore, confirmReason;
  if (consec >= 2)      { confirmScore = 15; confirmReason = "confirmed hold — multiple closes"; }
  else if (consec === 1) { confirmScore = 8;  confirmReason = "first confirmation close only"; }
  else                  { confirmScore = 0;  confirmReason = "first touch — no confirmation yet"; }

  // ── Factor 5: Volatility quality (0–10) ──────────────────────────────────────
  const sessionRange = Math.max(1, sessionHigh - sessionLow);
  const atrRatio = atr / sessionRange;
  let volatilityScore, volatilityReason;
  if (atrRatio >= 0.04 && atrRatio <= 0.28)  { volatilityScore = 10; volatilityReason = "healthy volatility"; }
  else if (atrRatio > 0.28)                   { volatilityScore = 5;  volatilityReason = "elevated volatility — widen stops"; }
  else                                         { volatilityScore = 2;  volatilityReason = "compressed range"; }

  // ── Factor 6: Session location (0–10) ────────────────────────────────────────
  const pctInSession = sessionRange > 0 ? (priceVal - sessionLow) / sessionRange : 0.5;
  let sessionScore, sessionReason;
  if (isLong && pctInSession <= 0.3)               { sessionScore = 10; sessionReason = "near session low — strong long location"; }
  else if (!isLong && pctInSession >= 0.7)          { sessionScore = 10; sessionReason = "near session high — strong short location"; }
  else if (pctInSession >= 0.38 && pctInSession <= 0.62) { sessionScore = 3;  sessionReason = "mid-range — no session edge"; }
  else                                              { sessionScore = 6;  sessionReason = "reasonable session location"; }

  // ── Total ─────────────────────────────────────────────────────────────────────
  const rawScore = structureScore + trendScore + momentumFactor + confirmScore + volatilityScore + sessionScore;
  // Cap at Aggressive if no confirmation candles
  const maxScore = consec === 0 ? 46 : 100;
  const overallScore = Math.max(0, Math.min(maxScore, rawScore));

  let confidence, noTrade = false, noTradeReason = null;
  if (overallScore >= 72)      confidence = "High Confidence";
  else if (overallScore >= 50) confidence = "Balanced";
  else if (overallScore >= 35) confidence = "Aggressive";
  else {
    confidence = "No Trade";
    noTrade = true;
    noTradeReason = `Low quality setup (${overallScore}/100): ${confirmReason}. ${trendReason}.`;
  }

  const dirLabel = isLong ? "LONG" : "SHORT";
  const explanation = noTrade
    ? `NO TRADE — ${noTradeReason}`
    : `${dirLabel} — ${structureReason}. ${trendReason}. ${confirmReason}. [${confidence}]`;

  return {
    confidence,
    explanation,
    factors: { confirmScore, momentumFactor, sessionScore, structureScore, trendScore, volatilityScore },
    noTrade,
    noTradeReason,
    overallScore,
  };
}

function findRepeatedRejectionLevels(levels = [], pad = 1) {
  const clean = levels.filter(Number.isFinite).sort((a, b) => a - b);
  const clusters = [];
  clean.forEach((level) => {
    const cluster = clusters.find((item) => Math.abs(item.average - level) <= pad);
    if (cluster) {
      cluster.values.push(level);
      cluster.average = cluster.values.reduce((sum, value) => sum + value, 0) / cluster.values.length;
    } else {
      clusters.push({ average: level, values: [level] });
    }
  });
  return clusters
    .filter((cluster) => cluster.values.length >= 2)
    .map((cluster) => Number(cluster.average.toFixed(2)));
}

function averageNearest(levels, price, side) {
  const filtered = levels.filter((level) => side === "below" ? level <= price : level >= price);
  const candidates = (filtered.length ? filtered : levels)
    .sort((a, b) => Math.abs(a - price) - Math.abs(b - price))
    .slice(0, 3);
  return Number((candidates.reduce((sum, level) => sum + level, 0) / Math.max(1, candidates.length)).toFixed(2));
}

function getEntryQuality({ direction = "long", entry, price, resistance, support, zoneDetection = {} }) {
  const range = Math.max(1, Math.abs(Number(resistance) - Number(support)));
  const supportLevel = Number(zoneDetection.supportLevel ?? support);
  const resistanceLevel = Number(zoneDetection.resistanceLevel ?? resistance);
  const nearSupport = Math.abs(Number(entry) - supportLevel) <= range * 0.18;
  const nearResistance = Math.abs(Number(entry) - resistanceLevel) <= range * 0.18;
  const middleLow = Number(zoneDetection.middleZoneLow ?? Number(support) + range * 0.35);
  const middleHigh = Number(zoneDetection.middleZoneHigh ?? Number(resistance) - range * 0.35);
  const inMiddle = Number(entry) > middleLow && Number(entry) < middleHigh;
  const stretched = Math.abs(Number(price) - Number(entry)) > range * 0.35;
  if (inMiddle) return { label: "Invalid", message: "Entry Quality: Invalid - do not enter mid-range." };
  if (direction === "long") {
    if (nearSupport) return { label: "Ideal", message: "Entry Quality: Ideal - long setup is near support/retest." };
    if (Number(entry) > supportLevel + range * 0.5 || stretched) return { label: "Chasing", message: "Entry Quality: Chasing - wait for pullback." };
    return { label: "Late", message: "Entry Quality: Late - needs confirmation." };
  }
  if (nearResistance) return { label: "Ideal", message: "Entry Quality: Ideal - short setup is near resistance/retest." };
  if (Number(entry) < resistanceLevel - range * 0.5 || stretched) return { label: "Chasing", message: "Entry Quality: Chasing - wait for pullback." };
  return { label: "Late", message: "Entry Quality: Late - needs confirmation." };
}

function getSetupGradeLabel(score) {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  return "D";
}

function getTradeGrade({ activeBias = "neutral", contracts, dailyPnl, direction = "long", entry, maxContracts, maxDailyLoss, price, rewardRisk, resistance, stop, support, zoneDetection = {} }) {
  if (rewardRisk?.invalid || rewardRisk?.runnerReward <= 0 || rewardRisk?.ratio <= 0) {
    return {
      letter: "Invalid",
      reason: rewardRisk?.reason || "Invalid plan: targets are on the wrong side of entry.",
      score: 0,
      reasons: [rewardRisk?.reason || "targets are on the wrong side of entry"],
      factors: {},
    };
  }

  const range = Math.max(1, Math.abs(resistance - support));
  const supportLevel = Number(zoneDetection.supportLevel ?? support);
  const resistanceLevel = Number(zoneDetection.resistanceLevel ?? resistance);
  const sessionHigh = Number(zoneDetection.sessionHigh ?? resistanceLevel);
  const sessionLow = Number(zoneDetection.sessionLow ?? supportLevel);
  const middleLow = Number(zoneDetection.middleZoneLow ?? support + range * 0.35);
  const middleHigh = Number(zoneDetection.middleZoneHigh ?? resistance - range * 0.35);
  const openRangeHigh = Number(zoneDetection.openRangeHigh ?? resistanceLevel);
  const openRangeLow = Number(zoneDetection.openRangeLow ?? supportLevel);
  const riskPoints = Math.abs(entry - stop);
  const entryQuality = getEntryQuality({ direction, entry, price, resistance, support, zoneDetection });

  // Factor 1 — Location (20 pts): is entry near S/R, not mid-range?
  const nearSupport = Math.abs(entry - supportLevel) <= range * 0.2;
  const nearResistance = Math.abs(entry - resistanceLevel) <= range * 0.2;
  const nearLevel = nearSupport || nearResistance;
  const middleEntry = entry > middleLow && entry < middleHigh;
  const locationScore = middleEntry ? 2 : nearLevel ? 20 : entryQuality.label === "Chasing" ? 6 : 12;
  const locationReason = middleEntry
    ? "entry is in the no-trade middle zone"
    : nearLevel
      ? "entry is near a key support or resistance level"
      : entryQuality.label === "Chasing"
        ? "entry is chasing — wait for a pullback"
        : "entry is between levels";

  // Factor 2 — Risk/Reward (20 pts): does the plan offer at least 2R to the runner?
  const rrRatio = rewardRisk.ratio;
  const rrScore = rrRatio >= 3 ? 20 : rrRatio >= 2 ? 16 : rrRatio >= 1.5 ? 10 : rrRatio >= 1 ? 5 : 0;
  const rrReason = rrRatio >= 3
    ? `strong ${rrRatio.toFixed(1)}R reward/risk ratio`
    : rrRatio >= 2
      ? `acceptable ${rrRatio.toFixed(1)}R reward/risk`
      : rrRatio >= 1.5
        ? `reward/risk is ${rrRatio.toFixed(1)}R — below ideal 2R`
        : rrRatio >= 1
          ? `reward/risk is only ${rrRatio.toFixed(1)}R — target is too close`
          : "reward does not cover the risk";

  // Factor 3 — Trend Alignment (20 pts): does direction match market bias?
  const normalizedBias = normalizeActiveBias(activeBias);
  const biasAligned = normalizedBias === "neutral" || directionFromBias(normalizedBias) === direction;
  const biasScore = normalizedBias === "neutral" ? 10 : biasAligned ? 20 : 0;
  const biasReason = normalizedBias === "neutral"
    ? "bias is neutral — no trend confirmation either way"
    : biasAligned
      ? `${direction} direction aligns with ${normalizedBias} bias`
      : `${direction} direction trades against ${normalizedBias} bias`;

  // Factor 4 — Breakout / Rejection Confirmation (20 pts): does the setup match price action at the level?
  const priceAtResistance = Math.abs(price - resistanceLevel) <= range * 0.22;
  const priceAtSupport = Math.abs(price - supportLevel) <= range * 0.22;
  const breakoutAbove = price > resistanceLevel;
  const breakdownBelow = price < supportLevel;
  let confirmationScore = 8;
  let confirmationReason = "no clear confirmation yet at a key level";
  if (direction === "long") {
    if (priceAtSupport) { confirmationScore = 20; confirmationReason = "price is testing support — long rejection setup"; }
    else if (breakoutAbove && nearResistance) { confirmationScore = 16; confirmationReason = "breakout above resistance — potential continuation"; }
    else if (breakdownBelow) { confirmationScore = 2; confirmationReason = "price broke below support — against long setup"; }
  } else {
    if (priceAtResistance) { confirmationScore = 20; confirmationReason = "price is testing resistance — short rejection setup"; }
    else if (breakdownBelow && nearSupport) { confirmationScore = 16; confirmationReason = "breakdown below support — potential continuation short"; }
    else if (breakoutAbove) { confirmationScore = 2; confirmationReason = "price broke above resistance — against short setup"; }
  }

  // Factor 5 — Session Context (20 pts): is entry near session high/low or open range?
  const nearSessionHigh = Math.abs(entry - sessionHigh) <= range * 0.18;
  const nearSessionLow = Math.abs(entry - sessionLow) <= range * 0.18;
  const nearOpenRangeHigh = Math.abs(entry - openRangeHigh) <= range * 0.18;
  const nearOpenRangeLow = Math.abs(entry - openRangeLow) <= range * 0.18;
  const sessionContextScore = (
    (direction === "short" && nearSessionHigh) ||
    (direction === "long" && nearSessionLow)
  ) ? 20 : (
    nearOpenRangeHigh || nearOpenRangeLow
  ) ? 14 : (
    nearSessionHigh || nearSessionLow
  ) ? 10 : 6;
  const sessionContextReason = (direction === "short" && nearSessionHigh)
    ? "short entry near session high — strong location"
    : (direction === "long" && nearSessionLow)
      ? "long entry near session low — strong location"
      : (nearOpenRangeHigh || nearOpenRangeLow)
        ? "entry near opening range boundary"
        : (nearSessionHigh || nearSessionLow)
          ? "entry near session extreme but wrong side for direction"
          : "entry is away from session reference levels";

  // Penalty: wrong stop side or risk too wide
  const stopCorrectSide = direction === "short" ? Number(stop) > Number(entry) : Number(stop) < Number(entry);
  const riskTooWide = riskPoints > range * 0.4;
  const dailyLossNear = Number(dailyPnl) <= -Math.abs(Number(maxDailyLoss || 0)) * 0.8;
  const oversized = Number(contracts) > Number(maxContracts || contracts);
  let penalty = 0;
  const penaltyReasons = [];
  if (!stopCorrectSide) { penalty += 30; penaltyReasons.push("stop is on the wrong side of entry"); }
  if (riskTooWide) { penalty += 10; penaltyReasons.push("stop is wider than the setup range"); }
  if (dailyLossNear) { penalty += 12; penaltyReasons.push("daily loss protection is nearly hit"); }
  if (oversized) { penalty += 12; penaltyReasons.push("contract size exceeds your funded limit"); }

  const rawScore = locationScore + rrScore + biasScore + confirmationScore + sessionContextScore - penalty;
  const boundedScore = Math.max(0, Math.min(100, Math.round(rawScore)));
  const letter = getSetupGradeLabel(boundedScore);

  const factors = { location: locationScore, rewardRisk: rrScore, trendAlignment: biasScore, confirmation: confirmationScore, sessionContext: sessionContextScore };
  const allReasons = [locationReason, rrReason, biasReason, confirmationReason, sessionContextReason, ...penaltyReasons];
  const topIssue = allReasons.find((r) => r.includes("wrong side") || r.includes("no-trade") || r.includes("only") || r.includes("against") || r.includes("chasing")) || allReasons[0];
  const reason = penaltyReasons.length
    ? `${letter} grade: ${penaltyReasons[0]}.`
    : boundedScore >= 85
      ? `${letter} grade: ${allReasons[0]}.`
      : `${letter} grade: ${topIssue}.`;

  return { entryQuality, factors, letter, reason, reasons: allReasons, score: boundedScore };
}

function gradeCompletedTrade({ plan, profile, trade }) {
  const safeTrade = normalizeActiveTrade(trade);
  const followedPlan = !plan || Math.abs(Number(plan.entry) - safeTrade.entry) <= 2;
  const respectedStop = safeTrade.status !== "closed" || safeTrade.realizedPL >= -Math.abs(profile.maxRiskPerTrade || 0) * 1.25;
  const oversized = safeTrade.contracts > Number(profile.maxContracts || safeTrade.contracts);
  const rMultiple = safeTrade.realizedPL && profile.maxRiskPerTrade ? safeTrade.realizedPL / Math.max(1, Math.abs(profile.maxRiskPerTrade)) : 0;
  let score = 86;
  const mistakes = [];
  if (!followedPlan) {
    score -= 14;
    mistakes.push("entry drifted from the plan");
  }
  if (!respectedStop) {
    score -= 20;
    mistakes.push("loss exceeded planned risk");
  }
  if (oversized) {
    score -= 18;
    mistakes.push("position size was too high");
  }
  if (safeTrade.status === "tp1_hit" || safeTrade.status === "tp2_hit" || safeTrade.status === "runner") score += 6;
  if (rMultiple < -1) score -= 10;
  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const label = boundedScore >= 85 ? "Execution Grade: A" : boundedScore >= 75 ? "Execution Grade: B" : boundedScore >= 65 ? "Execution Grade: C" : "Execution Grade: D";
  const mistake = mistakes[0] || "No major execution mistake detected.";
  const lesson = mistakes.length ? `Next improvement: ${mistake}.` : "Next improvement: keep following the plan and document the setup.";
  return { label, lesson, mistake, rMultiple: Number(rMultiple.toFixed(2)), score: boundedScore };
}

function gradeSetup({
  activeBias = "neutral",
  candleCount = 0,
  contracts,
  dailyPnl,
  dataFresh = true,
  direction = "long",
  entry,
  hasCandles = false,
  hasLevels = false,
  maxContracts,
  maxDailyLoss,
  price,
  resistance,
  rewardRisk,
  stop,
  support,
  webhookSetupScore = null,
  webhookSetupGrade = null,
  zoneDetection = {},
}) {
  // Useful state matrix — never return bare "Invalid 0/100" with no direction.
  const priceValue = Number(price);
  if (!Number.isFinite(priceValue) || priceValue <= 0) {
    return {
      score: 0,
      grade: "—",
      letter: "—",
      state: "no_data",
      strengths: [],
      warnings: [],
      reason: "Waiting for TradingView data.",
      nextStep: "Connect TradingView Alerts to begin.",
      factors: {},
      entryQuality: null,
      candleCount,
    };
  }
  if (!hasCandles) {
    return {
      score: 0,
      grade: "—",
      letter: "—",
      state: "price_only",
      strengths: [],
      warnings: [],
      reason: "Price connected. Waiting for levels or setup signal.",
      nextStep: "Wait for more candles or send a Trade Pilot trade_setup signal.",
      factors: {},
      entryQuality: null,
      candleCount,
    };
  }
  if (!hasLevels && (!zoneDetection?.zonesValid || !zoneDetection.supportLevel || !zoneDetection.resistanceLevel)) {
    return {
      score: 0,
      grade: "—",
      letter: "—",
      state: "no_zones",
      strengths: [],
      warnings: [],
      reason: "Need support/resistance to score the setup.",
      nextStep: "Add manual levels or wait for clearer structure.",
      factors: {},
      entryQuality: null,
      candleCount,
    };
  }
  if (!Number.isFinite(Number(entry)) || !Number.isFinite(Number(stop))) {
    return {
      score: 0,
      grade: "—",
      letter: "—",
      state: "waiting_for_setup",
      strengths: [],
      warnings: [],
      reason: "No high-quality setup yet.",
      nextStep: "Wait for price to reach support/resistance, or for a Trade Pilot signal.",
      factors: {},
      entryQuality: null,
      candleCount,
    };
  }

  const baseGrade = getTradeGrade({
    activeBias,
    contracts,
    dailyPnl,
    direction,
    entry,
    maxContracts,
    maxDailyLoss,
    price,
    rewardRisk,
    resistance,
    stop,
    support,
    zoneDetection,
  });

  const reasons = Array.isArray(baseGrade.reasons) ? baseGrade.reasons : [];
  const strengths = reasons.filter((r) => /(near|strong|aligns|acceptable|reward\/risk|testing|continuation)/i.test(r));
  const warnings = reasons.filter((r) => /(against|wrong side|chasing|too close|middle|only|exceeds|wider|nearly hit|no clear)/i.test(r));

  let score = baseGrade.score;
  if (!hasCandles) {
    score = Math.min(score, 60);
    warnings.unshift("waiting for candle data from TradingView");
  }
  if (!hasLevels) {
    score = Math.min(score, 60);
    warnings.unshift("support/resistance levels are missing");
  }
  if (!dataFresh) {
    score = Math.min(score, 70);
    warnings.unshift("data feed is stale");
  }
  if (Number.isFinite(Number(webhookSetupScore))) {
    score = Math.round((score + Number(webhookSetupScore)) / 2);
  }
  score = Math.max(0, Math.min(100, score));
  const grade = baseGrade.letter === "Invalid"
    ? "Invalid"
    : webhookSetupGrade && (webhookSetupGrade === "A" || webhookSetupGrade === "B+")
      ? webhookSetupGrade
      : score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : "D";

  let nextStep;
  // For an Invalid plan, surface the exact reason instead of generic copy.
  let invalidReason = null;
  if (grade === "Invalid") {
    const detail = baseGrade.reasons?.find((r) => /(wrong side|target|stop|entry|missing|risk|reward|mid-range|stale)/i.test(r));
    invalidReason = detail || "Plan structure is invalid.";
    nextStep = `Fix: ${invalidReason}`;
  } else if (!hasCandles) {
    nextStep = "Wait for candle data, then re-evaluate.";
  } else if (!hasLevels) {
    nextStep = "Add support and resistance — Auto detection needs a few candles.";
  } else if (grade === "D") {
    nextStep = "No trade. Wait for a B+ or A setup.";
  } else if (grade === "C") {
    nextStep = "Wait for a cleaner location or stronger confirmation candle.";
  } else if (grade === "B") {
    nextStep = "Acceptable setup. Confirm the plan is valid, then size into the trade.";
  } else if (grade === "B+") {
    nextStep = "B+ setup — the indicator confirms entry quality. Follow the plan.";
  } else {
    nextStep = "A setup. Execute your plan. Trim at TP1 and TP2.";
  }

  const state = grade === "Invalid"
    ? "invalid"
    : grade === "D"
      ? "low_quality"
      : grade === "A" || grade === "B+" || grade === "B"
        ? "valid"
        : "low_quality";

  const reason = invalidReason || baseGrade.reason || (warnings[0] ? warnings[0] : (strengths[0] || "setup quality is acceptable"));

  return {
    score,
    grade,
    letter: grade,
    state,
    strengths,
    warnings,
    reason,
    nextStep,
    factors: baseGrade.factors || {},
    entryQuality: baseGrade.entryQuality,
    candleCount,
  };
}

function gradeDiscipline({ activeTrade, discipline = {}, journalEntries = [], plan, profile = {}, recentMistakes = [] }) {
  const safeTrade = activeTrade ? normalizeActiveTrade(activeTrade) : null;
  const trades = safeArray(journalEntries);
  const mistakes = [];
  let score = 100;

  const followedPlan = !plan || !safeTrade?.entry || Math.abs(Number(plan.entry) - safeTrade.entry) <= Math.max(2, Math.abs(plan.entry) * 0.0008);
  if (!followedPlan) { score -= 18; mistakes.push("entry drifted from the plan"); }

  const respectedStop = !safeTrade || safeTrade.status !== "stopped" || safeTrade.realizedPL >= -Math.abs(profile.maxRiskPerTrade || 0) * 1.1;
  if (!respectedStop) { score -= 20; mistakes.push("loss exceeded planned risk"); }

  const oversized = safeTrade?.contracts > Number(profile.maxContracts || safeTrade?.contracts || 0);
  if (oversized) { score -= 18; mistakes.push("position size was too high"); }

  const chased = safeTrade && safeTrade.entryQuality === "Chasing";
  if (chased) { score -= 12; mistakes.push("entered while chasing"); }

  const dailyLoss = Number(discipline.dailyPnl || 0);
  const maxLoss = Math.abs(Number(profile.maxDailyLoss || 0));
  const revenge = (discipline.tradesTaken || 0) >= 4 && dailyLoss < 0 && Math.abs(dailyLoss) >= maxLoss * 0.6;
  if (revenge) { score -= 14; mistakes.push("revenge trading pattern detected"); }

  const trimmed = !safeTrade || safeTrade.status === "tp1_hit" || safeTrade.status === "tp2_hit" || safeTrade.status === "runner" || safeTrade.status === "closed";
  if (safeTrade && !trimmed) { score -= 8; mistakes.push("did not trim at planned levels"); }

  const journaled = trades.length > 0;
  if (!journaled) { score -= 8; mistakes.push("no journal entry yet"); }

  for (const recent of recentMistakes) {
    score -= 6;
    if (!mistakes.includes(recent)) mistakes.push(recent);
  }

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const grade = boundedScore >= 85 ? "A" : boundedScore >= 70 ? "B" : boundedScore >= 55 ? "C" : "D";
  const lesson = mistakes[0]
    ? `Next improvement: ${mistakes[0]}.`
    : "Discipline holding. Keep following the plan and journaling each trade.";
  const nextStep = grade === "D"
    ? "Stop trading for the day. Review the journal."
    : grade === "C"
      ? "Take only A setups. Reset before the next entry."
      : grade === "B"
        ? "Stay disciplined — one slip away from A."
        : "Discipline strong. Keep stacking journal entries.";

  return {
    score: boundedScore,
    grade,
    mistakes,
    lesson,
    nextStep,
  };
}

function buildTradeBreakdownText({ activeTrade, disciplineGrade, market, rewardRisk, setupGrade, setupName, visualPlan }) {
  const trade = activeTrade ? normalizeActiveTrade(activeTrade) : null;
  const rr = rewardRisk?.invalid ? "—" : `${Number(rewardRisk?.ratio || 0).toFixed(2)}R`;
  const lesson = disciplineGrade?.lesson || "Document the lesson next session.";
  const setupLabel = `${setupGrade?.grade || "—"} (${setupGrade?.score ?? 0}/100)`;
  const execLabel = `${disciplineGrade?.grade || "—"} (${disciplineGrade?.score ?? 0}/100)`;
  const direction = trade?.direction || visualPlan?.direction || "—";
  const entry = formatOptionalPrice(trade?.entry ?? visualPlan?.entry);
  const stop = formatOptionalPrice(trade?.stop ?? visualPlan?.stop);
  const target = formatOptionalPrice(visualPlan?.runner ?? visualPlan?.target ?? trade?.runner);
  return [
    "Trade Pilot Breakdown",
    `Market: ${market || "—"}`,
    `Setup: ${setupName || "—"} (${direction})`,
    `Entry: ${entry}  Stop: ${stop}  Target: ${target}`,
    `Grade: ${setupLabel}`,
    `RR: ${rr}`,
    `Execution Score: ${execLabel}`,
    `Lesson: ${lesson}`,
  ].join("\n");
}

function formatOptionalPrice(value, symbol) {
  if (!Number.isFinite(Number(value))) return "Pending";
  if (symbol) return formatPrice(value, symbol);
  return Number(value).toFixed(2);
}

function fmt(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "Pending";
}

function getMissedEntryMessage({ currentPrice, plan }) {
  if (!plan?.entry || !plan?.direction) return "";
  const threshold = 20;
  const missedLong = plan.direction === "long" && currentPrice > plan.entry + threshold;
  const missedShort = plan.direction === "short" && currentPrice < plan.entry - threshold;
  if (!missedLong && !missedShort) return "";
  return "Missed Entry — wait for retest. Do not chase. Wait for pullback, wait for retest, or reset levels.";
}

function getRewardRisk({ plan, pointValue }) {
  if (!plan?.entry || !plan?.stop) {
    return { invalid: true, ratio: 0, reason: "Missing entry or stop.", risk: 0, trim1Reward: 0, trim2Reward: 0, runnerReward: 0 };
  }

  const contracts = plan.contracts || 1;
  const direction = plan.direction === "short" ? "short" : "long";
  const validation = validateTradePlan(plan);
  const riskPoints = direction === "long" ? plan.entry - plan.stop : plan.stop - plan.entry;
  const risk = riskPoints * pointValue * contracts;
  const rewardFor = (target) => {
    const rewardPoints = direction === "long" ? Number(target) - plan.entry : plan.entry - Number(target);
    return rewardPoints * pointValue * contracts;
  };
  const runnerReward = rewardFor(plan.runner ?? plan.target ?? plan.entry);

  return {
    invalid: !validation.valid,
    ratio: risk > 0 && runnerReward > 0 ? runnerReward / risk : 0,
    reason: validation.reason,
    risk: Math.max(0, risk),
    trim1Reward: rewardFor(plan.trim1 ?? plan.entry),
    trim2Reward: rewardFor(plan.trim2 ?? plan.entry),
    runnerReward,
  };
}

function calculateRewardRisk(args) {
  return getRewardRisk(args);
}

function normalizeTradePlan(plan = {}, fallback = {}) {
  if (plan.direction === "none" || plan.noTrade) return { ...plan, direction: "none", noTrade: true };
  const direction = plan.direction === "short" ? "short" : "long";
  const entry = safeNumber(plan.entry, fallback.entry, 0);
  const rawStop = safeNumber(plan.stop, fallback.stop, direction === "long" ? entry - 10 : entry + 10);
  const stop = direction === "long" && rawStop < entry
    ? rawStop
    : direction === "short" && rawStop > entry
      ? rawStop
      : direction === "long"
        ? entry - Math.max(1, Math.abs(rawStop - entry) || 10)
        : entry + Math.max(1, Math.abs(rawStop - entry) || 10);
  const riskPoints = Math.max(1, Math.abs(entry - stop));
  const safeTarget = (value, multiplier) => {
    const number = Number(value);
    const fallbackTarget = direction === "long" ? entry + riskPoints * multiplier : entry - riskPoints * multiplier;
    if (!Number.isFinite(number)) return fallbackTarget;
    return direction === "long" && number > entry ? number : direction === "short" && number < entry ? number : fallbackTarget;
  };
  const trim1 = safeTarget(plan.trim1 ?? fallback.trim1, 1.25);
  const trim2Candidate = safeTarget(plan.trim2 ?? fallback.trim2, 2);
  const trim2 = direction === "long"
    ? Math.max(trim2Candidate, trim1 + riskPoints * 0.25)
    : Math.min(trim2Candidate, trim1 - riskPoints * 0.25);
  const runnerCandidate = safeTarget(plan.runner ?? plan.target ?? fallback.runner ?? fallback.target, 3);
  const runner = direction === "long"
    ? Math.max(runnerCandidate, trim2 + riskPoints * 0.25)
    : Math.min(runnerCandidate, trim2 - riskPoints * 0.25);
  return {
    ...fallback,
    ...plan,
    contracts: safeNumber(plan.contracts, fallback.contracts, 1),
    direction,
    entry,
    runner,
    stop,
    target: runner,
    trim1,
    trim2,
  };
}

function validateTradePlan(plan = {}) {
  const direction = plan.direction === "short" ? "short" : "long";
  const entry = Number(plan.entry);
  const stop = Number(plan.stop);
  const trim1 = Number(plan.trim1);
  const trim2 = Number(plan.trim2);
  const runner = Number(plan.runner ?? plan.target);
  if (![entry, stop, trim1, trim2, runner].every(Number.isFinite)) {
    return { valid: false, reason: "Invalid plan: entry, stop, and targets must be defined." };
  }
  const valid = direction === "long"
    ? stop < entry && trim1 > entry && trim2 > trim1 && runner > trim2
    : stop > entry && trim1 < entry && trim2 < trim1 && runner < trim2;
  return {
    valid,
    reason: valid ? "" : "Invalid plan: targets are on the wrong side of entry.",
  };
}

function normalizeActiveBias(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("bear") || normalized.includes("short")) return "bearish";
  if (normalized.includes("bull") || normalized.includes("long")) return "bullish";
  return "neutral";
}

function directionFromBias(activeBias) {
  const bias = normalizeActiveBias(activeBias);
  if (bias === "bearish") return "short";
  if (bias === "bullish") return "long";
  return "none";
}

function planDirectionMatchesBias(plan, activeBias) {
  const expectedDirection = directionFromBias(activeBias);
  if (expectedDirection === "none") return false;
  return plan?.direction === expectedDirection;
}

function getPlanSourceLabel(source) {
  if (!source) return "Auto Zone";
  if (source === "TradingView Webhook") return "TradingView Alert";
  return source;
}

function buildNoTradePlan({ activeBias = "neutral", lastUpdated = "", message = "No trade. Wait for confirmation.", source = "Coach" } = {}) {
  return {
    bias: normalizeActiveBias(activeBias),
    direction: "none",
    invalid: false,
    lastUpdated,
    message,
    noTrade: true,
    source,
    status: "waiting_for_confirmation",
  };
}

function withActivePlanMetadata(plan, { activeBias, fallbackPlan, lastUpdated, source, status } = {}) {
  if (!plan || plan.noTrade || directionFromBias(activeBias) === "none") {
    return buildNoTradePlan({ activeBias, lastUpdated, source });
  }
  const expectedDirection = directionFromBias(activeBias);
  const normalized = normalizeTradePlan({ ...plan, direction: expectedDirection }, { ...fallbackPlan, direction: expectedDirection });
  const validation = validateTradePlan(normalized);
  return {
    ...normalized,
    bias: normalizeActiveBias(activeBias),
    invalid: !validation.valid,
    invalidReason: validation.reason,
    lastUpdated: lastUpdated || plan.lastUpdated || new Date().toISOString(),
    source: getPlanSourceLabel(plan.source || plan.sourceMode || source),
    status: status || plan.status || "waiting_for_entry",
    tp1: normalized.trim1,
    tp2: normalized.trim2,
  };
}

function buildActiveTradePlan({ activeBias, activePosition, autoTradePlan, fallbackPlan, lastUpdated, plannedTrade, price, source }) {
  const bias = normalizeActiveBias(activeBias);
  const expectedDirection = directionFromBias(bias);
  if (expectedDirection === "none") {
    return buildNoTradePlan({
      activeBias: bias,
      lastUpdated,
      message: "No trade. Wait for confirmation.",
      source: source || "Coach",
    });
  }

  const candidates = [activePosition, plannedTrade, autoTradePlan].filter(Boolean);
  const matchedCandidate = candidates.find((candidate) => !candidate.noTrade && planDirectionMatchesBias(candidate, bias) && validateTradePlan(candidate).valid);
  const selected = matchedCandidate || (!autoTradePlan?.noTrade ? autoTradePlan : null);
  if (!selected) {
    return buildNoTradePlan({
      activeBias: bias,
      lastUpdated,
      message: "Waiting for valid setup.",
      source: source || "Coach",
    });
  }

  const status = activePosition?.status === "active" || activePosition?.status === "managing_trade"
    ? "managing_trade"
    : Number.isFinite(Number(price)) && Number.isFinite(Number(selected.entry)) && (
      expectedDirection === "long" ? Number(price) >= Number(selected.entry) : Number(price) <= Number(selected.entry)
    )
      ? "managing_trade"
      : "waiting_for_entry";

  return withActivePlanMetadata(selected, {
    activeBias: bias,
    fallbackPlan,
    lastUpdated,
    source,
    status,
  });
}

function getCoachDecision({ activeBias, activePosition, activeTradePlan, price, support, resistance, validation }) {
  const bias = normalizeActiveBias(activeBias);
  if (validation && !validation.valid && activeTradePlan?.direction !== "none") {
    return { action: "NO TRADE", message: validation.reason || "Invalid plan: targets are on the wrong side of entry." };
  }
  // Only switch to MANAGE TRADE when the plan itself is real. A stale activePosition
  // with no active plan must not be allowed to drive "TP2 reached" messages.
  const planReal = activeTradePlan?.direction && activeTradePlan.direction !== "none";
  if (planReal && (activeTradePlan?.status === "managing_trade" || activePosition)) {
    return { action: "MANAGE TRADE", message: getTargetProgressMessage({ activePosition, plan: activeTradePlan, price }) };
  }
  if (bias === "neutral" || activeTradePlan?.direction === "none") {
    return { action: "WAIT", message: "Price is between levels. Wait for support, resistance, breakout, or retest." };
  }
  const priceValue = Number(price);
  const supportValue = Number(support);
  const resistanceValue = Number(resistance);
  const range = Math.max(1, Math.abs((Number.isFinite(resistanceValue) ? resistanceValue : priceValue + 10) - (Number.isFinite(supportValue) ? supportValue : priceValue - 10)));
  const nearSupport = Number.isFinite(priceValue) && Number.isFinite(supportValue) && Math.abs(priceValue - supportValue) <= range * 0.22;
  const nearResistance = Number.isFinite(priceValue) && Number.isFinite(resistanceValue) && Math.abs(priceValue - resistanceValue) <= range * 0.22;
  if (bias === "bearish") {
    return {
      action: "LOOK SHORT",
      message: nearResistance ? "Price is rejecting resistance. Watch for short confirmation." : "Bearish bias active. Plan ready. Waiting for entry.",
    };
  }
  return {
    action: "LOOK LONG",
    message: nearSupport ? "Price is near support. Watch for bounce confirmation." : "Bullish bias active. Plan ready. Waiting for entry.",
  };
}

function getTargetProgressMessage({ activePosition, plan, price }) {
  if (!plan || plan.direction === "none") return "Waiting for valid setup.";
  const direction = plan.direction === "short" ? "short" : "long";
  const priceValue = Number(price);
  const entry = Number(plan.entry);
  const stop = Number(plan.stop);
  const tp1 = Number(plan.tp1 ?? plan.trim1);
  const tp2 = Number(plan.tp2 ?? plan.trim2);
  const runner = Number(plan.runner ?? plan.target);
  // Require fully-formed plan inputs before reporting TP progress. Without this,
  // a stale activePosition can drive "TP2 reached" against placeholder zeroes.
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(stop) || stop <= 0) {
    return "Plan incomplete. Set entry and stop before managing the trade.";
  }
  const managing = activePosition || plan.status === "managing_trade" || (Number.isFinite(priceValue) && (direction === "long" ? priceValue >= entry : priceValue <= entry));
  if (!managing) return "Plan ready. Waiting for entry.";
  const hit = (target) => Number.isFinite(priceValue) && Number.isFinite(target) && (direction === "long" ? priceValue >= target : priceValue <= target);
  if (hit(tp2)) return "TP2 reached. Manage runner.";
  if (hit(tp1)) return `TP1 reached. Consider trimming. Next target: TP2 at ${fmt(tp2)}.`;
  return Number.isFinite(tp1) ? `Next target: TP1 at ${fmt(tp1)}.` : "Manage trade. Respect your plan.";
}

function safeNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function getAutoTradePlan({ accountSize, activeBias = "neutral", contracts, dailyPnl, marketSpec, marketStructure = null, maxContracts, maxDailyLoss, maxRisk, price, resistance, support, tradingViewSignal = null, zoneDetection = {} }) {
  // 1) If a fresh webhook trade_setup carries entry/stop/targets, use those first.
  const sig = tradingViewSignal && (tradingViewSignal.signal === "trade_setup" || tradingViewSignal.kind === "trade_setup") ? tradingViewSignal : null;
  const sigEntry = Number(sig?.entry);
  const sigStop = Number(sig?.stop);
  const sigTargets = Array.isArray(sig?.targets) ? sig.targets.map(Number).filter(Number.isFinite) : [];
  const sigDirection = sig?.direction === "long" || sig?.direction === "short" ? sig.direction : null;
  if (sig && sigDirection && Number.isFinite(sigEntry) && Number.isFinite(sigStop) && sigTargets.length >= 2) {
    const tp1 = sigTargets[0];
    const tp2 = sigTargets[1];
    const runner = sigTargets[2] ?? sigTargets[sigTargets.length - 1];
    const validRule = sigDirection === "long"
      ? sigStop < sigEntry && tp1 > sigEntry && tp2 > tp1
      : sigStop > sigEntry && tp1 < sigEntry && tp2 < tp1;
    if (validRule) {
      const riskPoints = Math.abs(sigEntry - sigStop);
      const rewardDollars = Math.abs(runner - sigEntry) * (marketSpec?.pointValue || 1) * Number(contracts || 1);
      const riskDollars = riskPoints * (marketSpec?.pointValue || 1) * Number(contracts || 1);
      return {
        contracts,
        coachMessage: `Trade-setup signal received (${sigDirection}). Plan ready.`,
        direction: sigDirection,
        entry: sigEntry,
        noTrade: false,
        reason: "Plan derived from latest TradingView trade_setup signal.",
        rewardRisk: riskDollars > 0 ? rewardDollars / riskDollars : 0,
        riskDollars,
        runner,
        score: Number.isFinite(Number(sig?.setupScore)) ? Math.max(60, Math.min(95, Math.round(Number(sig.setupScore)))) : 85,
        setupType: "TradingView Signal",
        stop: sigStop,
        trim1: tp1,
        trim2: tp2,
      };
    }
  }

  // 2) Fall back to active zones. NEVER synthesize fake zones near the current price —
  //    if the engine has no real support/resistance, return a no-trade.
  const supportLevel = Number(zoneDetection.supportLevel ?? support);
  const resistanceLevel = Number(zoneDetection.resistanceLevel ?? resistance);
  const priceValue = Number(price);
  const haveSupport = Number.isFinite(supportLevel) && supportLevel > 0 && supportLevel < priceValue;
  const haveResistance = Number.isFinite(resistanceLevel) && resistanceLevel > 0 && resistanceLevel > priceValue;
  if (!haveSupport && !haveResistance) {
    return {
      noTrade: true,
      coachMessage: "No valid setup yet. Wait for price to reach support/resistance.",
      message: "No valid support or resistance above/below price.",
      reason: "Zones missing — auto plan disabled until structure exists.",
      score: 0,
    };
  }
  if (!haveSupport) {
    return {
      noTrade: true,
      coachMessage: "No valid support detected yet.",
      message: "No valid support detected yet.",
      reason: "No swing low below price within timeframe min-distance.",
      score: 0,
    };
  }
  if (!haveResistance) {
    return {
      noTrade: true,
      coachMessage: "No valid resistance detected yet.",
      message: "No valid resistance detected yet.",
      reason: "No swing high above price within timeframe min-distance.",
      score: 0,
    };
  }
  const supportZoneHigh = Number(zoneDetection.supportZoneHigh ?? supportLevel);
  const resistanceZoneLow = Number(zoneDetection.resistanceZoneLow ?? resistanceLevel);
  const range = Math.max(1, resistanceLevel - supportLevel);
  const middleLow = Number(zoneDetection.middleZoneLow ?? supportLevel + range * 0.35);
  const middleHigh = Number(zoneDetection.middleZoneHigh ?? resistanceLevel - range * 0.35);
  const tick = Number(marketSpec.tickSize || 0.25);
  const riskBudget = Math.max(1, Number(maxRisk || accountSize * 0.005 || 1));
  const riskLocked = Number(dailyPnl) <= -Math.abs(Number(maxDailyLoss || 0)) * 0.8;
  const normalizedBias = normalizeActiveBias(activeBias);
  if (normalizedBias === "neutral") {
    return {
      noTrade: true,
      coachMessage: "No trade. Wait for confirmation.",
      message: "No trade. Wait for confirmation.",
      reason: "Bias is neutral. Do not force a long or short plan.",
      score: 35,
    };
  }
  if (priceValue > middleLow && priceValue < middleHigh) {
    return {
      noTrade: true,
      coachMessage: "No trade. Price is mid-range.",
      message: "No trade. Price is mid-range. Wait for support, resistance, breakout, or retest.",
      reason: "Middle-zone entries usually offer poor location and unclear invalidation.",
      score: 35,
    };
  }

  if (riskLocked) {
    return {
      noTrade: true,
      coachMessage: "Risk too high. Lower contracts.",
      message: "Daily loss protection is close. Stop trading or reduce size before taking another setup.",
      reason: "Daily loss protection is close.",
      score: 25,
    };
  }

  const nearSupport = priceValue <= supportZoneHigh || Math.abs(priceValue - supportLevel) <= range * 0.18;
  const nearResistance = priceValue >= resistanceZoneLow || Math.abs(priceValue - resistanceLevel) <= range * 0.18;
  const isLong = normalizedBias === "bullish";
  const direction = isLong ? "long" : "short";
  const entry = roundToTick(priceValue, tick);
  const preferredStopPoints = marketSpec.pointValue >= 20 ? 12 : 16;
  const maxBudgetStopPoints = riskBudget / Math.max(1, marketSpec.pointValue * Number(contracts || 1));
  const stopPoints = roundToTick(Math.max(tick * 8, Math.min(preferredStopPoints, maxBudgetStopPoints || preferredStopPoints, range * 0.22)), tick);
  const structureStop = isLong ? Math.min(supportLevel - tick * 4, entry - tick) : Math.max(resistanceLevel + tick * 4, entry + tick);
  const budgetStop = isLong ? entry - stopPoints : entry + stopPoints;
  const stop = roundToTick(isLong ? Math.min(entry - tick, Math.max(structureStop, budgetStop)) : Math.max(entry + tick, Math.min(structureStop, budgetStop)), tick);
  const riskPoints = Math.abs(entry - stop);
  const trim1 = roundToTick(isLong ? entry + riskPoints * 1.25 : entry - riskPoints * 1.25, tick);
  const trim2 = roundToTick(isLong ? entry + riskPoints * 2 : entry - riskPoints * 2, tick);
  const runner = roundToTick(isLong ? entry + riskPoints * 3 : entry - riskPoints * 3, tick);
  const riskDollars = riskPoints * marketSpec.pointValue * contracts;
  const rewardDollars = Math.abs(runner - entry) * marketSpec.pointValue * contracts;
  const rewardRisk = rewardDollars / Math.max(1, riskDollars);
  const tooManyContracts = Number(contracts) > Number(maxContracts || contracts);
  const accountRiskPercent = accountSize > 0 ? (riskDollars / accountSize) * 100 : 0;
  let score = 88;
  const reasons = [];
  if ((isLong && !nearSupport) || (!isLong && !nearResistance)) {
    score -= 18;
    reasons.push("wait for retest");
  }
  if (riskDollars > riskBudget) {
    score -= 18;
    reasons.push("risk too high");
  }
  if (rewardRisk < 1.8) {
    score -= 14;
    reasons.push("reward/risk is thin");
  }
  if (tooManyContracts) {
    score -= 18;
    reasons.push("lower contracts");
  }
  if (accountRiskPercent > 1) {
    score -= 8;
    reasons.push("account risk is elevated");
  }
  score = Math.max(30, Math.min(96, Math.round(score)));
  const setupLocation = isLong ? "near support" : "near resistance";

  // ── Multi-factor signal quality gate ─────────────────────────────────────────
  // Prefer NO TRADE over a bad trade (Parts 1–8, 12 of quality overhaul)
  const quality = marketStructure
    ? scoreSignalQuality({ direction, structure: marketStructure, price: priceValue })
    : null;

  if (quality?.noTrade) {
    return {
      noTrade: true,
      coachMessage: quality.noTradeReason,
      message: quality.noTradeReason,
      reason: quality.explanation,
      score: Math.max(5, quality.overallScore),
    };
  }

  // Aggressive setups (score 35–49) are hidden by default — surface as no-trade with explanation
  if (quality && quality.confidence === "Aggressive") {
    return {
      noTrade: true,
      coachMessage: `Low confidence setup. ${quality.explanation}`,
      message: `Low confidence: ${quality.noTradeReason || quality.explanation}`,
      reason: quality.explanation,
      score: quality.overallScore,
    };
  }

  // Blend zone score with quality score when quality data is available
  if (quality) score = Math.max(30, Math.min(96, Math.round((score * 0.5) + (quality.overallScore * 0.5))));

  const confidence = quality?.confidence || "Balanced";
  const qualityExplanation = quality?.explanation
    || (isLong ? `LONG — ${setupLocation} with defined risk.` : `SHORT — ${setupLocation} with defined risk.`);
  const coachMessage = qualityExplanation;

  return {
    confidence,
    contracts,
    coachMessage,
    direction,
    entry,
    noTrade: false,
    qualityExplanation,
    qualityScore: quality?.overallScore ?? score,
    reason: reasons.length ? reasons.join("; ") : `Clean ${setupLocation} with defined risk.`,
    rewardRisk,
    riskDollars,
    runner,
    score,
    setupType: "Auto zone plan",
    stop,
    trim1,
    trim2,
  };
}

function roundToTick(value, tick = 0.25) {
  const size = Number(tick) || 0.25;
  return Number((Math.round(Number(value) / size) * size).toFixed(2));
}

function TradeLadder({ currentPrice, plan }) {
  const levels = [
    { color: "#f8fafc", label: "Current", price: currentPrice },
    { color: "#60a5fa", label: "Entry", price: plan.entry },
    { color: "#ef4444", label: "Stop", price: plan.stop },
    { color: "#22c55e", label: "Trim 1", price: plan.trim1 },
    { color: "#16a34a", label: "Trim 2", price: plan.trim2 },
    { color: "#84cc16", label: "Runner", price: plan.runner ?? plan.target },
  ].filter((level) => Number.isFinite(level.price));

  const min = Math.min(...levels.map((level) => level.price));
  const max = Math.max(...levels.map((level) => level.price));
  const span = Math.max(1, max - min);

  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Visual Trade Graph</p>
      <h2 style={styles.sectionTitle}>Price Ladder</h2>
      <div style={styles.ladder}>
        {levels.map((level) => {
          const bottom = ((level.price - min) / span) * 82 + 8;
          return (
            <div key={level.label} style={{ ...styles.ladderLevel, bottom: `${bottom}%`, borderColor: level.color }}>
              <span style={{ color: level.color }}>{level.label}</span>
              <strong>{level.price.toFixed(2)}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RiskRewardPanel({ contracts, market, plan, pointValue, rewardRisk }) {
  const maxReward = Math.max(1, rewardRisk.runnerReward);

  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Risk / Reward Graph</p>
      <h2 style={styles.sectionTitle}>{market} · {contracts} contracts</h2>
      <Metric label="Risk" value={`$${rewardRisk.risk.toFixed(2)}`} tone="bad" />
      <Metric label="Reward to Trim 1" value={`$${rewardRisk.trim1Reward.toFixed(2)}`} tone="good" />
      <Metric label="Reward to Trim 2" value={`$${rewardRisk.trim2Reward.toFixed(2)}`} tone="good" />
      <Metric label="Reward to Runner" value={`$${rewardRisk.runnerReward.toFixed(2)}`} tone="good" />
      <div style={styles.rrTrack}>
        <div style={{ ...styles.rrRisk, width: `${Math.min(100, (rewardRisk.risk / maxReward) * 100)}%` }} />
        <div style={{ ...styles.rrReward, width: "100%" }} />
      </div>
      <p style={styles.rrText}>R:R = {rewardRisk.ratio.toFixed(1)}R · ${pointValue}/point</p>
      <p style={styles.muted}>Entry {plan.entry?.toFixed?.(2)} · Stop {plan.stop?.toFixed?.(2)}</p>
    </section>
  );
}

function ShareSetupPanel({ contracts, engine, market, plan, rewardRisk, setupName = "Manual" }) {
  const [copied, setCopied] = useState(false);
  const direction = plan.direction === "short" ? "Short" : "Long";
  const setupText = [
    "Trade Pilot Setup",
    `Market: ${market}`,
    `Bias: ${direction}`,
    `Setup: ${setupName}`,
    `Entry: ${plan.entry?.toFixed?.(2) ?? "N/A"}`,
    `Stop: ${plan.stop?.toFixed?.(2) ?? "N/A"}`,
    `Trim 1: ${plan.trim1?.toFixed?.(2) ?? "N/A"}`,
    `Trim 2: ${plan.trim2?.toFixed?.(2) ?? "N/A"}`,
    `Runner: ${(plan.runner ?? plan.target)?.toFixed?.(2) ?? "N/A"}`,
    `Contracts: ${contracts}`,
    `Risk: $${rewardRisk.risk.toFixed(2)}`,
    `Reward/Risk: ${rewardRisk.ratio.toFixed(1)}R`,
    `Trade Score: ${engine.score}/100`,
  ].join("\n");

  const copySetup = async () => {
    await navigator.clipboard.writeText(setupText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Share Setup</p>
      <h2 style={styles.sectionTitle}>Clean Trade Plan</h2>
      <pre style={styles.sharePreview}>{setupText}</pre>
      <button onClick={copySetup} style={styles.settingsButton}>{copied ? "Copied" : "Copy Trade Plan"}</button>
      <p style={{ ...styles.muted, marginTop: "12px" }}>Later this can become a shareable URL.</p>
    </section>
  );
}

function buildChartData({ price, entry, stop, support, resistance, trim1, trim2, runner }) {
  const levels = [price, entry, stop, support, resistance, trim1, trim2, runner].filter((value) => Number.isFinite(Number(value)));
  const center = Number(price) || 0;
  const spread = Math.max(8, (Math.max(...levels) - Math.min(...levels)) || center * 0.002);

  return Array.from({ length: 34 }, (_, index) => {
    const wave = Math.sin(index / 2.4) * spread * 0.22;
    const slope = (index - 17) * spread * 0.012;
    const close = index === 33 ? price : center + wave + slope + Math.cos(index / 1.7) * spread * 0.08;
    return {
      close: Number(close.toFixed(2)),
      label: `${index + 1}`,
    };
  });
}

function getLiveCoachMessage({ activeBias, activeTrade, activePosition, activeTradePlan, autoTradePlan, discipline, engine, price, profile, support, resistance, tradeGrade, visualPlan, zoneDetection = {} }) {
  if (discipline.dailyPnl <= -Math.abs(profile.maxDailyLoss)) return "Daily loss limit reached. Stop trading today.";

  // Plan must exist and have a real direction before we can claim a trade is in progress.
  // Otherwise stale `activeTrade.isActive` produces phantom "TP2 reached" messages
  // when the real status is WAITING / INVALID.
  const planValid = Boolean(activeTradePlan)
    && activeTradePlan.direction !== "none"
    && Number.isFinite(Number(visualPlan?.entry))
    && Number.isFinite(Number(visualPlan?.stop));
  const isInTrade = planValid && (activeTrade?.isActive || activePosition || activeTradePlan?.status === "managing_trade");
  if (isInTrade) {
    const isLong = (activePosition?.direction || activeTradePlan?.direction || visualPlan.direction) !== "short";
    const stopHit = isLong ? price <= visualPlan.stop : price >= visualPlan.stop;
    if (stopHit) return "Stop area reached. Respect your plan and exit.";
    const progressMsg = getTargetProgressMessage({ activePosition, plan: activeTradePlan || visualPlan, price });
    if (progressMsg) return progressMsg;
  }

  if (zoneDetection?.zonesValid === false) {
    return "Price connected, but zones are too tight. Wait for clearer structure or add levels manually.";
  }

  if (autoTradePlan?.noTrade) return autoTradePlan.coachMessage || autoTradePlan.message || "No trade. Wait for confirmation.";
  if (autoTradePlan?.qualityExplanation && !activeTrade?.isActive) return autoTradePlan.qualityExplanation;

  const marketCat = getMarketCategory(profile?.mainMarket || "");
  const marketIdleHint = {
    futures: "Respect session highs/lows and wait for a clean break or rejection at structure.",
    stock:   "Watch open volatility and wait for a confirmed range or breakout with volume.",
    crypto:  "Crypto liquidity is dynamic — wait for a clean zone test or volume confirmation.",
    forex:   "Wait for London or NY session momentum before committing to a direction.",
  }[marketCat] || "Waiting for valid setup. Price is between levels — no edge here yet.";

  if (normalizeActiveBias(activeBias) === "neutral" || activeTradePlan?.direction === "none") {
    if (!Number.isFinite(Number(support)) || !Number.isFinite(Number(resistance))) {
      return "Price connected. Add support and resistance levels to generate a plan.";
    }
    return marketIdleHint;
  }
  if (!visualPlan?.entry || !visualPlan?.stop) return "Plan outdated. Regenerate from current market data.";

  if (tradeGrade?.letter === "Invalid") {
    return `Invalid plan: ${tradeGrade.reasons?.[0] || "targets are on the wrong side of entry"}.`;
  }
  if ((activePosition?.contracts || visualPlan.contracts || 0) > profile.maxContracts) {
    return "Contract size exceeds your funded limit. Reduce before entering.";
  }

  // Grade-based coaching with WHY
  const grade = tradeGrade?.letter || "D";
  const score = tradeGrade?.score ?? 0;
  const topReason = tradeGrade?.reasons?.[0];

  if (grade === "A") {
    return `Grade A setup (${score}/100). ${topReason ? `Why: ${topReason}.` : "Clean location, controlled risk, plan is defined."}`;
  }
  if (grade === "B") {
    return `Grade B setup (${score}/100). ${topReason ? `Watch: ${topReason}.` : "Acceptable setup. Follow your plan."}`;
  }
  if (grade === "C") {
    const issue = tradeGrade?.reasons?.find((r) => r.includes("too close") || r.includes("chasing") || r.includes("neutral") || r.includes("middle")) || topReason;
    return `Grade C setup (${score}/100). Caution: ${issue || "setup quality is low"}.`;
  }

  // Grade D — be specific about what is wrong
  const issue = tradeGrade?.reasons?.find((r) => r.includes("wrong side") || r.includes("no-trade") || r.includes("against") || r.includes("only") || r.includes("chasing")) || topReason;
  return `Grade D setup (${score}/100). Do not trade: ${issue || "setup does not meet quality threshold"}.`;
}

function TradeChartPanel({ candleSeries, chartOverlays = {}, chartPrefs, chartTimeframe, currentPrice, debugMode = false, entry, lastTradeSetup, onResetChart, resetSignal, runner, setChartPrefs, setChartTimeframe, stop, support, resistance, symbol, timeframe, trim1, trim2, zoneDetection = {} }) {
  const candles = Array.isArray(candleSeries) ? candleSeries : [];
  const haveEnoughCandles = candles.length >= 20;
  // Defer the "is the spacing reasonable?" decision to the upstream zone
  // engine via zoneDetection.zonesValid. Just sanity-check ordering here so
  // we never render a support line above the price.
  const zoneSpacingValid = (() => {
    if (!Number.isFinite(Number(currentPrice))) return false;
    const cp = Number(currentPrice);
    const supHigh = Number(zoneDetection.supportZoneHigh);
    const resLow = Number(zoneDetection.resistanceZoneLow);
    if (![supHigh, resLow].every(Number.isFinite)) return false;
    return supHigh < cp && resLow > cp;
  })();
  const zonesValid = zoneDetection.zonesValid !== false && haveEnoughCandles && zoneSpacingValid;
  const supportZone = zonesValid
    ? { min: Number(zoneDetection.supportZoneLow), max: Number(zoneDetection.supportZoneHigh) }
    : null;
  const resistanceZone = zonesValid
    ? { min: Number(zoneDetection.resistanceZoneLow), max: Number(zoneDetection.resistanceZoneHigh) }
    : null;
  const plan = {
    entry: Number.isFinite(Number(entry)) ? Number(entry) : null,
    stop: Number.isFinite(Number(stop)) ? Number(stop) : null,
    tp1: Number.isFinite(Number(trim1)) ? Number(trim1) : null,
    tp2: Number.isFinite(Number(trim2)) ? Number(trim2) : null,
    runner: Number.isFinite(Number(runner)) ? Number(runner) : null,
  };

  // Trade setup markers: only for trade_setup signals graded A or B+.
  const tradeSetupGrade = lastTradeSetup?.grade ? String(lastTradeSetup.grade).toUpperCase() : null;
  const setupMarkers = lastTradeSetup
    && (tradeSetupGrade === "A" || tradeSetupGrade === "B+")
    && lastTradeSetup.timestamp
    ? [{
        time: lastTradeSetup.timestamp,
        direction: lastTradeSetup.direction === "short" ? "short" : "long",
        text: `${tradeSetupGrade} ${String(lastTradeSetup.direction || "long").toUpperCase()}`,
      }]
    : [];

  // Responsive chart height — 320 mobile, 480 desktop.
  const isMobile = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(max-width: 720px)").matches
    : false;
  const chartHeight = isMobile ? 320 : 480;
  return (
    <section className="chart-panel" style={styles.chartPanel}>
      <div style={styles.sectionHeader}>
        <div>
          <p style={styles.cardLabel}>Chart View</p>
          <h2 style={styles.sectionTitle}>{symbol || "Live Chart"}{timeframe ? ` · ${timeframe}` : ""}</h2>
        </div>
        <strong style={styles.chartPrice}>{Number.isFinite(Number(currentPrice)) ? Number(currentPrice).toFixed(2) : "—"}</strong>
      </div>
      {setChartTimeframe ? (
        <div style={styles.chartToolbar}>
          <div style={styles.chartTimeframeGroup}>
            {CHART_TIMEFRAME_OPTIONS.map((option) => {
              const isActive = String(chartTimeframe) === option.value;
              return (
                <button
                  key={option.value}
                  onClick={() => setChartTimeframe(option.value)}
                  style={{
                    ...styles.chartTimeframeButton,
                    background: isActive ? "rgba(56, 189, 248, .15)" : "transparent",
                    color: isActive ? "#7dd3fc" : "#94a3b8",
                  }}
                  type="button"
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div style={styles.chartActionGroup}>
            {onResetChart ? (
              <button
                onClick={onResetChart}
                style={styles.chartActionButton}
                title="Refit candles and reset price scale"
                type="button"
              >Reset</button>
            ) : null}
            {setChartPrefs ? (
              <>
                <button
                  onClick={() => setChartPrefs((current) => ({ ...current, autoFit: !current.autoFit }))}
                  style={{
                    ...styles.chartActionButton,
                    color: chartPrefs?.autoFit ? "#5eead4" : "#94a3b8",
                  }}
                  title="Keep chart fit to latest candles"
                  type="button"
                >{chartPrefs?.autoFit ? "Auto Fit ·" : "Auto Fit"}</button>
                <button
                  onClick={() => setChartPrefs((current) => ({ ...current, lockPriceScale: !current.lockPriceScale }))}
                  style={{
                    ...styles.chartActionButton,
                    color: chartPrefs?.lockPriceScale ? "#fdba74" : "#94a3b8",
                  }}
                  title="Prevent vertical price-scale dragging"
                  type="button"
                >{chartPrefs?.lockPriceScale ? "Price 🔒" : "Price 🔓"}</button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
      {!zonesValid && haveEnoughCandles ? (
        <p style={styles.chartZoneNote}>Analyzing market structure…</p>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px", flexWrap: "wrap" }}>
        <span style={{ color: candles.length >= 3 ? "#22c55e" : "#64748b", fontSize: "11px", fontWeight: 700, letterSpacing: ".04em" }}>
          {candles.length} candle{candles.length !== 1 ? "s" : ""}
        </span>
        {candles.length > 0 && (
          <span style={{ color: "#475569", fontSize: "11px" }}>
            {new Date(candles[0].timestamp ?? candles[0].time ?? 0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {" → "}
            {new Date((candles.at(-1).timestamp ?? candles.at(-1).time ?? 0)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
      <div className="tradepilot-chart-wrap" style={{ ...styles.chartWrap, height: `${chartHeight}px` }}>
        <TradingChart
          autoFit={chartPrefs?.autoFit !== false}
          candles={candles}
          currentPrice={currentPrice}
          debugMode={debugMode}
          fvgData={chartOverlays.fvgType ? { type: chartOverlays.fvgType, top: chartOverlays.fvgTop, bottom: chartOverlays.fvgBottom } : null}
          fvgQuality={chartOverlays.fvgQuality ?? null}
          height={chartHeight}
          lockPriceScale={chartPrefs?.lockPriceScale === true}
          markers={setupMarkers}
          plan={plan}
          poc={chartOverlays.poc ?? null}
          relVol={chartOverlays.relVol ?? null}
          resetSignal={resetSignal || 0}
          resistanceZone={resistanceZone}
          showZones={zonesValid}
          supportZone={supportZone}
          symbol={symbol}
          timeframe={timeframe}
        />
      </div>
    </section>
  );
}

function LivestreamDashboard({ activePosition, brokerConnection, coachMessage, discipline, engine, price, profile, riskStatus, tradeGrade, visualPlan }) {
  const contracts = activePosition?.contracts ?? visualPlan.contracts ?? profile.defaultContracts;
  const positionLabel = activePosition ? activePosition.direction.toUpperCase() : "Flat";
  const fundedMetrics = getFundedAccountMetrics({ brokerConnection, discipline, profile });

  return (
    <section style={styles.livestreamPanel}>
      <div style={styles.liveHero}>
        <p style={styles.cardLabel}>Livestream Dashboard</p>
        <p style={styles.liveMarket}>{profile.mainMarket}</p>
        <h2 style={styles.livePrice}>{Number(price).toFixed(2)}</h2>
        <p style={styles.liveSubline}>{coachMessage}</p>
      </div>
      <div style={styles.liveMetricGrid}>
        <Metric label="Position" value={positionLabel} />
        <Metric label="Contracts" value={String(contracts)} />
        <Metric label="Entry" value={Number(visualPlan.entry || 0).toFixed(2)} />
        <Metric label="Trade Score" value={`${tradeGrade.letter} ${tradeGrade.score}/100`} tone={tradeGrade.score >= 75 ? "good" : "warn"} />
        <Metric label="Open P/L" value={`$${engine.openPnl.toFixed(2)}`} tone={engine.openPnl >= 0 ? "good" : "bad"} />
        <Metric label="Daily P/L" value={`$${fundedMetrics.dailyPnl.toFixed(2)}`} />
        <Metric label="Risk Status" value={riskStatus} tone={riskStatus === "Good" ? "good" : "warn"} />
      </div>
    </section>
  );
}

function ProductUpgradePanel({ brokerConnection, discipline, journalEntries, profile }) {
  const analytics = getJournalAnalytics(journalEntries, discipline);
  const equityPoints = getEquityCurvePoints(journalEntries, discipline);

  return (
    <section style={styles.productUpgradeGrid}>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Prop Firm Rule Engine</p>
        <h2 style={styles.sectionTitle}>{profile.fundedProvider}</h2>
        <div style={styles.metricGrid}>
          <Metric label="Account Size" value={`$${Number(profile.accountSize || profile.startingBalance).toLocaleString()}`} />
          <Metric label="Trailing Drawdown" value={`$${Number(profile.trailingDrawdown || 0).toLocaleString()}`} />
          <Metric label="Daily Loss Limit" value={`$${Number(profile.maxDailyLoss || 0).toLocaleString()}`} />
          <Metric label="Profit Target" value={`$${Number(profile.profitGoal || 0).toLocaleString()}`} />
          <Metric label="Max Contracts" value={String(profile.maxContracts)} />
          <Metric label="Consistency Rule" value={`${profile.consistencyRuleTarget}%`} />
          <Metric label="Phase" value={profile.accountPhase} />
        </div>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Equity Curve</p>
        <h2 style={styles.sectionTitle}>Performance Snapshot</h2>
        <div style={styles.equityCurve}>
          {equityPoints.map((point, index) => (
            <span key={`${point}-${index}`} style={{ ...styles.equityBar, height: `${Math.max(8, Math.min(100, Math.abs(point)))}%`, background: point >= 0 ? "#22c55e" : "#ef4444" }} />
          ))}
        </div>
        <div style={styles.metricGrid}>
          <Metric label="Win Rate" value={`${analytics.winRate}%`} />
          <Metric label="Total Trades" value={String(analytics.totalTrades)} />
          <Metric label="Avg Win" value={`$${analytics.averageWin.toFixed(2)}`} />
          <Metric label="Avg Loss" value={`$${analytics.averageLoss.toFixed(2)}`} />
          <Metric label="Profit Factor" value={analytics.profitFactor.toFixed(2)} />
          <Metric label="Max Drawdown" value={`$${analytics.maxDrawdown.toFixed(2)}`} />
          <Metric label="Best Day" value={`$${analytics.bestDay.toFixed(2)}`} />
          <Metric label="Worst Day" value={`$${analytics.worstDay.toFixed(2)}`} />
        </div>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Journal Analytics</p>
        <h2 style={styles.sectionTitle}>Execution Review</h2>
        <PlanItem title="Trade Entry" text="Track entry, exit, direction, setup type, result, notes, and execution grade." />
        <PlanItem title="Screenshots" text="Screenshot upload is planned for a later release." />
        <PlanItem title="Current Grade" text={analytics.totalTrades ? `${analytics.winRate}% win rate from saved notes.` : "Start saving trades to build your stats."} />
      </section>

      <details style={{ ...styles.card, padding: "12px 16px" }}>
        <summary style={{ color: "#94a3b8", cursor: "pointer", fontSize: "13px", fontWeight: 800 }}>
          Advanced — Broker integrations (coming later)
        </summary>
        <div style={{ marginTop: "10px" }}>
          <p style={styles.cardLabel}>Tradovate / Prop Broker</p>
          <p style={styles.muted}>Read-only broker bridges are on the roadmap. Trade Pilot will never place, cancel, or modify trades — TradingView Alerts is the recommended live data source.</p>
          <div style={{ ...styles.metricGrid, marginTop: "10px" }}>
            <Metric label="Connection" value={brokerConnection.connectionStatus || "Not Connected"} />
            <Metric label="Position" value={brokerConnection.position ? brokerConnection.position.direction : "Read-only"} />
            <Metric label="Account Balance" value={`$${Number(brokerConnection.accountBalance || profile.accountSize || 0).toFixed(2)}`} />
          </div>
        </div>
      </details>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Supabase Security</p>
        <h2 style={styles.sectionTitle}>Admin Checklist</h2>
        <PlanItem title="Leaked Password Protection" text="Enable in Supabase Auth security settings." />
        <PlanItem title="Email Confirmations" text="Keep confirmations on for alpha accounts." />
        <PlanItem title="Site URL" text="https://tradepilottool.com" />
        <PlanItem title="Redirect URL" text="https://tradepilottool.com" />
      </section>
    </section>
  );
}

function getJournalAnalytics(journalEntries = [], discipline = {}) {
  const safeEntries = safeArray(journalEntries);
  const results = safeEntries
    .map((entry) => Number(entry.result ?? entry.pnl ?? entry.dailyPnl ?? 0))
    .filter((value) => Number.isFinite(value));
  const wins = results.filter((value) => value > 0);
  const losses = results.filter((value) => value < 0);
  const grossWin = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const running = results.reduce((state, value) => {
    const equity = state.equity + value;
    const peak = Math.max(state.peak, equity);
    return { equity, maxDrawdown: Math.max(state.maxDrawdown, peak - equity), peak };
  }, { equity: 0, maxDrawdown: 0, peak: 0 });

  return {
    averageLoss: losses.length ? grossLoss / losses.length : Math.abs(Number(discipline.dailyPnl || 0)) || 0,
    averageWin: wins.length ? grossWin / wins.length : Math.max(0, Number(discipline.dailyPnl || 0)),
    bestDay: results.length ? Math.max(...results) : Math.max(0, Number(discipline.dailyPnl || 0)),
    maxDrawdown: running.maxDrawdown,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? grossWin : 0,
    totalTrades: safeEntries.length || Number(discipline.tradesTaken || 0),
    winRate: results.length ? Math.round((wins.length / results.length) * 100) : 0,
    worstDay: results.length ? Math.min(...results) : Math.min(0, Number(discipline.dailyPnl || 0)),
  };
}

function getEquityCurvePoints(journalEntries = [], discipline = {}) {
  const points = safeArray(journalEntries).slice(0, 12).reverse().map((entry) => Number(entry.result ?? entry.pnl ?? entry.dailyPnl ?? 0));
  if (points.length) return points;
  const daily = Number(discipline.dailyPnl || 0);
  return [-12, 18, 10, -8, 22, 30, daily || 16];
}

function getSmartStop({ direction, entry, resistance, riskPoints, support }) {
  const isLong = direction === "long";
  const risk = Math.max(1, Math.abs(Number(riskPoints) || 1));
  const structureStop = isLong ? Math.min(Number(support) - 1, entry - 0.25) : Math.max(Number(resistance) + 1, entry + 0.25);
  const fallbackStop = isLong ? entry - risk : entry + risk;
  const structureOnCorrectSide = isLong ? structureStop < entry : structureStop > entry;
  const useStructureStop = structureOnCorrectSide && Math.abs(entry - structureStop) <= risk * 1.5;

  return {
    smartStop: useStructureStop ? structureStop : fallbackStop,
    stopReason: useStructureStop
      ? isLong
        ? "Stop placed below support to protect against a failed breakout."
        : "Stop placed above resistance to protect against a failed breakdown."
      : "Structure is too far away, so stop uses your planned risk points.",
  };
}

function getConnectionStatusLabel(connection) {
  if (connection?.connectionStatus) return connection.connectionStatus;
  if (!connection?.connected) return "Not Connected";
  if (connection.platform === "Demo Broker") return "Demo Connected";
  if (connection.platform === "Tradovate Prop/Funded Read-Only") return "Prop/Funded Read-Only Connected";
  if (connection.platform === "Tradovate Live Read-Only") return "Live Read-Only Connected";
  if (connection.platform === "Tradovate Demo Read-Only") return "Demo Connected";
  if (connection.platform === "TradingView Webhook") return "TradingView Alerts Connected";
  return `${connection.platform} Connected`;
}

function getConnectionStateMessage({ brokerConnection, dataSource, profile }) {
  const platform = brokerConnection?.platform || profile.fundedPlatform;
  if (platform === "Demo Broker" || dataSource === "Demo Broker") return "Demo Broker Connected - simulated data.";
  if (platform === "Manual Mode" || dataSource === "Manual Mode") return "Manual Mode Active - enter price and levels yourself.";
  if (platform === "TradingView Webhook" || dataSource === "TradingView Webhook") {
    return brokerConnection?.connectionStatus === "TradingView feed active"
      ? "TradingView feed active"
      : "Waiting for TradingView alert data.";
  }
  if (platform?.includes("Tradovate") || profile.fundedPlatform === "Tradovate") return "Tradovate API credentials are not configured yet. Add Vercel env vars first.";
  if (profile.accountType === "Funded/prop account") return "Funded account rules active. Broker data may still be manual unless API is connected.";
  return "Not connected. Choose a data source.";
}

function buildBrokerSafetyWarnings({ activePosition, brokerConnection, discipline, engine, profile }) {
  const warnings = [...engine.disciplineWarnings];
  const position = brokerConnection?.position || activePosition;
  const contracts = Number(position?.contracts || 0);
  const dailyLossHit = discipline.dailyPnl <= -Math.abs(profile.maxDailyLoss);

  if (contracts > profile.maxContracts) warnings.push("Position size too large for your profile.");
  if (dailyLossHit) warnings.push("Daily loss limit hit. Stop trading and review.");
  if (discipline.tradesTaken >= profile.maxTradesPerDay) warnings.push("Too many trades today. Further trades increase mistake risk.");
  if (discipline.tradesTaken >= Math.max(3, profile.maxTradesPerDay - 1) && discipline.dailyPnl < 0) warnings.push("Revenge trading risk detected after repeated losses.");
  if (position && !Number.isFinite(Number(position.stop))) warnings.push("Stop missing. Add a defined exit before continuing.");
  if (!position && !activePosition) warnings.push("No trade plan active.");

  return [...new Set(warnings)];
}

function getFundedAccountMetrics({ brokerConnection, discipline, profile }) {
  const accountBalance = Number(brokerConnection.accountBalance || profile.accountSize || profile.startingBalance);
  const startingBalance = Number(profile.startingBalance || profile.accountSize || 0);
  const trailingDrawdown = Number(profile.trailingDrawdown || 0);
  const drawdownFloor = Math.max(startingBalance - trailingDrawdown, accountBalance - trailingDrawdown);
  const drawdownRemaining = Math.max(0, accountBalance - drawdownFloor);
  const dailyPnl = Number(brokerConnection.dailyPnl ?? discipline.dailyPnl ?? 0);
  const dailyLossLimit = Number(profile.maxDailyLoss || 0);
  const dailyRiskRemaining = Math.max(0, dailyLossLimit + dailyPnl);
  const profitGoal = Number(profile.profitGoal || 0);
  const consistencyCap = profitGoal > 0 ? profitGoal * (Number(profile.consistencyRuleTarget || 30) / 100) : 0;

  return {
    accountBalance,
    consistencyCap,
    dailyLossLimit,
    dailyPnl,
    dailyRiskRemaining,
    drawdownFloor,
    drawdownRemaining,
    profitGoal,
  };
}

function buildFundedRuleWarnings({ brokerConnection, discipline, profile }) {
  const warnings = [];
  const position = brokerConnection.position;
  const contracts = Number(position?.contracts || 0);
  const metrics = getFundedAccountMetrics({ brokerConnection, discipline, profile });

  if (metrics.dailyLossLimit > 0 && Math.abs(metrics.dailyPnl) >= metrics.dailyLossLimit * 0.8) warnings.push("Daily loss limit approaching");
  if (metrics.drawdownRemaining <= Math.max(100, Number(profile.trailingDrawdown || 0) * 0.2)) warnings.push("Trailing drawdown risk");
  if (contracts > Number(profile.maxContracts || profile.defaultContracts)) warnings.push("Position size too large");
  if (discipline.tradesTaken >= Number(profile.maxTradesPerDay || 0)) warnings.push("Max trades reached");
  if (metrics.consistencyCap > 0 && Math.max(metrics.dailyPnl, 0) > metrics.consistencyCap) warnings.push("Consistency rule risk");
  if (warnings.length >= 2 || metrics.drawdownRemaining <= 0) warnings.push("Stop trading to protect payout");

  return [...new Set(warnings)];
}

function ConnectionsPage({
  activateManualMode,
  activateTradingViewMode,
  activePosition,
  applyAlert,
  brokerConnection,
  dataSource,
  discipline,
  engine,
  lastUpdated,
  notify,
  onAuthOpen,
  price,
  profile,
  quote,
  saveConnectionSettings,
  setActivePage,
  setActiveTrade,
  setPriceStatus,
  setWebhookDebug,
  startDemoBroker,
  updateProfile,
  webhookDebug,
}) {
  const [tradingViewWizardOpen, setTradingViewWizardOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const statusLabel = getConnectionStatusLabel(brokerConnection);
  const connectionMessage = getConnectionStateMessage({ brokerConnection, dataSource, profile });
  const isFunded = isFundedAccountType(profile.accountType);
  const position = brokerConnection.position || activePosition;
  const safetyWarnings = buildBrokerSafetyWarnings({ activePosition, brokerConnection, discipline, engine, profile });
  const fundedWarnings = buildFundedRuleWarnings({ brokerConnection, discipline, profile });
  const fundedMetrics = getFundedAccountMetrics({ brokerConnection, discipline, profile });

  const activateLucidManualMode = () => {
    activateManualMode();
    updateProfile("accountType", "Funded / Prop Firm Account");
    updateProfile("fundedProvider", "Lucid Trading");
    updateProfile("fundedPlatform", "Manual Mode");
    notify?.("Lucid Manual Mode active", "success");
  };

  const openTradingViewWizard = () => {
    activateTradingViewMode();
    setTradingViewWizardOpen(true);
  };

  const sendTestTradingViewSignal = async (market = "NQ", timeframe = "5m") => {
    const payload = {
      symbol: "NQ1!",
      price: 27444.25,
      timeframe: "5",
      timestamp: new Date().toISOString(),
    };
    const isLocalhost = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const apiBase = isLocalhost ? "https://tradepilottool.com" : "";
    const fetchJsonWithTimeout = async (url, options = {}) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`${apiBase}${url}`, {
          ...options,
          signal: controller.signal,
        });
        const text = await response.text();
        let result;
        try {
          result = text ? JSON.parse(text) : {};
        } catch {
          throw new Error("Webhook returned an unreadable response.");
        }
        return { response, result };
      } finally {
        window.clearTimeout(timeout);
      }
    };

    try {
      const { response, result } = await fetchJsonWithTimeout("/api/webhook/tradingview", {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      console.log("test signal POST result", result);
      if (!response.ok || result.ok === false) throw new Error(result.error || "TradingView webhook error");
      const { response: latestResponse, result: latest } = await fetchJsonWithTimeout("/api/webhook/tradingview/latest", {
        headers: { Accept: "application/json" },
      });
      console.log("latest signal", latest);
      if (!latestResponse.ok || latest.ok === false) throw new Error(latest.error || "Latest TradingView signal unavailable");
      if (!latest.signal) throw new Error("Latest TradingView signal was empty");
      const appliedSignal = {
        ...latest.signal,
        price: payload.price,
        symbol: payload.symbol,
        timeframe: payload.timeframe,
        timestamp: payload.timestamp,
      };
      setWebhookDebug({
        error: "",
        price: String(appliedSignal.price),
        received: "Yes",
        symbol: appliedSignal.symbol,
        updated: new Date().toLocaleTimeString(),
      });
      applyAlert?.(appliedSignal);
      setPriceStatus("TradingView signal received");
      setTradingViewWizardOpen(false);
      setActivePage("dashboard");
      return true;
    } catch (error) {
      const message = error.name === "AbortError" ? "Test signal timed out. Check your connection and try again." : error.message || "TradingView webhook error";
      console.log("test signal failed", message);
      setWebhookDebug({
        error: message,
        price: "",
        received: "No",
        symbol: payload.symbol,
        updated: new Date().toLocaleTimeString(),
      });
      setPriceStatus("Test signal failed.");
      notify?.("Test signal failed.", "failure");
      return false;
    }
  };

  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Connections" subtitle="TradingView Alerts is the primary live data source." />
      </div>

      {/* ── Primary: TradingView Alerts ── */}
      <section style={styles.card}>
        <p style={styles.cardLabel}>Primary Connection</p>
        <h2 style={styles.sectionTitle}>TradingView Alerts</h2>
        <p style={styles.muted}>Use the Trade Pilot Signal Engine indicator to send live price, support, resistance, bias, and event signals directly to your dashboard.</p>
        <div style={{ ...styles.sourceGrid, marginBottom: "16px", marginTop: "14px" }}>
          <SourceOption title="TradingView Alerts" text="Live price, S/R, bias, breakouts, and rejections from your chart." active={dataSource === "TradingView Webhook"} />
          <SourceOption title="Manual Mode" text="Enter levels and price manually. No external connection needed." active={dataSource === "Manual Mode"} />
          <SourceOption title="Demo Broker" text="Simulated price stream for testing and practice." active={brokerConnection.platform === "Demo Broker"} />
        </div>
        <div style={{ ...styles.installBannerActions, marginTop: "4px" }}>
          <button onClick={openTradingViewWizard} style={styles.settingsButton}>Set Up TradingView Alerts</button>
          <button onClick={startDemoBroker} style={styles.secondaryButton}>Connect Demo Broker</button>
          <button onClick={activateLucidManualMode} style={styles.secondaryButton}>Lucid Manual Mode</button>
          <button onClick={activateManualMode} style={styles.dismissButton}>Manual Mode</button>
        </div>
        <div style={{ ...styles.coachPrompt, marginTop: "14px" }}>{connectionMessage}</div>
      </section>

      {/* ── TradingView Signal Status ── */}
      {dataSource === "TradingView Webhook" ? (
        <section style={styles.card}>
          <p style={styles.cardLabel}>Signal Feed</p>
          <h2 style={styles.sectionTitle}>TradingView Webhook Active</h2>
          {(() => {
            const debugSymbol = webhookDebug?.symbol || profile.mainMarket || "";
            const resolvedDebug = resolveMarketFromSymbol(debugSymbol, profile.mainMarket);
            const marketTypeLabel = resolvedDebug.marketType === "futures"
              ? `${resolvedDebug.market} (Futures)`
              : `${resolvedDebug.symbol || "Custom"} (Custom)`;
            const priceSourceLabel = webhookDebug?.received === "Yes" ? "TradingView Webhook" : (dataSource || "Unknown");
            return (
              <>
                <div style={styles.metricGrid}>
                  <Metric label="Last signal received" value={webhookDebug?.received || "No"} tone={webhookDebug?.received === "Yes" ? "good" : "warn"} />
                  <Metric label="Symbol" value={debugSymbol || "None"} />
                  <Metric label="Market Type" value={marketTypeLabel} tone={resolvedDebug.marketType === "custom" ? "warn" : "neutral"} />
                  <Metric label="Price Source" value={priceSourceLabel} />
                  <Metric label="Current Price" value={webhookDebug?.price || "None"} />
                  <Metric label="Last Updated" value={webhookDebug?.updated || "Waiting"} />
                  <Metric label="Error" value={webhookDebug?.error || "None"} tone={webhookDebug?.error ? "bad" : "neutral"} />
                </div>
                {resolvedDebug.marketType === "custom" && webhookDebug?.received === "Yes" ? (
                  <div style={{ ...styles.coachPrompt, marginTop: "12px" }}>
                    Price connected. Choose market settings to continue — set tick size and point value for {resolvedDebug.symbol} in Settings.
                  </div>
                ) : null}
              </>
            );
          })()}
          <div style={{ ...styles.subPanel, marginTop: "14px" }}>
            <p style={styles.cardLabel}>Webhook Endpoint</p>
            <pre style={styles.sharePreview}>POST https://tradepilottool.com/api/webhook/tradingview</pre>
            <p style={{ ...styles.muted, marginTop: "8px" }}>The Trade Pilot Signal Engine indicator sends this payload automatically on every signal:</p>
            <pre style={styles.sharePreview}>{JSON.stringify({ symbol: "{{ticker}}", price: "{{close}}", timeframe: "{{interval}}", open: "{{open}}", high: "{{high}}", low: "{{low}}", close: "{{close}}", volume: "{{volume}}", signal: "price_update", timestamp: "{{timenow}}" }, null, 2)}</pre>
          </div>
        </section>
      ) : null}

      {/* ── Account Settings ── */}
      <section style={styles.card}>
        <p style={styles.cardLabel}>Account Settings</p>
        <h2 style={styles.sectionTitle}>Profile & Platform</h2>
        <div style={styles.formGrid}>
          <SelectField label="Account Type" value={profile.accountType} options={accountTypeOptions} onChange={(value) => updateProfile("accountType", value)} />
          <SelectField label="Platform" value={profile.fundedPlatform} options={fundedPlatforms} onChange={(value) => updateProfile("fundedPlatform", value)} />
          {isFunded ? <SelectField label="Prop Firm" value={profile.fundedProvider} options={fundedProviders} onChange={(value) => updateProfile("fundedProvider", value)} /> : null}
          {isFunded ? <SelectField label="Account Phase" value={profile.accountPhase} options={["evaluation", "funded", "live"]} onChange={(value) => updateProfile("accountPhase", value)} /> : null}
        </div>
        <button
          onClick={async () => {
            try {
              await saveConnectionSettings?.();
              notify?.("Connection saved.", "success");
              setSaveStatus("Connection settings saved.");
            } catch (error) {
              notify?.("Save failed.", "failure");
              setSaveStatus(error.message || "Save failed.");
            }
          }}
          style={{ ...styles.settingsButton, marginTop: "16px" }}
        >Save Connection Settings</button>
        {saveStatus ? <p style={{ ...styles.muted, marginTop: "10px" }}>{saveStatus}</p> : null}
      </section>

      {/* ── Advanced toggle ── */}
      <button
        onClick={() => setShowAdvanced((value) => !value)}
        style={{ ...styles.advancedToggle, marginTop: "8px" }}
      >Advanced / Coming Later {showAdvanced ? "Hide" : "Show"}</button>

      {showAdvanced ? <>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Coming Later</p>
        <h2 style={styles.sectionTitle}>Direct Broker / API Access</h2>
        <p style={styles.muted}>Tradovate, Rithmic, and direct broker integrations are planned for a future release. For the beta, TradingView Alerts is the recommended live data source.</p>
      </section>

      {/* ── Funded / Prop Firm ── */}
      {isFunded ? <>
        <section style={styles.card}>
          <p style={styles.cardLabel}>Funded Account</p>
          <h2 style={styles.sectionTitle}>Prop Firm Metrics</h2>
          <div style={styles.connectionGrid}>
            <Metric label="Provider" value={profile.fundedProvider} />
            <Metric label="Platform" value={profile.fundedPlatform} />
            <Metric label="Phase" value={profile.accountPhase} />
            <Metric label="Daily P/L" value={`$${fundedMetrics.dailyPnl.toFixed(2)}`} tone={fundedMetrics.dailyPnl >= 0 ? "good" : "bad"} />
            <Metric label="Drawdown Remaining" value={`$${fundedMetrics.drawdownRemaining.toFixed(2)}`} tone={fundedMetrics.drawdownRemaining > 500 ? "good" : "warn"} />
            <Metric label="Profit Goal" value={`$${fundedMetrics.profitGoal.toFixed(2)}`} />
          </div>
        </section>
        <section style={styles.card}>
          <p style={styles.cardLabel}>Prop Firm Settings</p>
          <h2 style={styles.sectionTitle}>Funded Risk Rules</h2>
          <div style={styles.formGrid}>
            <SelectField label="Prop Firm" value={profile.fundedProvider} options={fundedProviders} onChange={(value) => updateProfile("fundedProvider", value)} />
            <Field label="Account Size" type="number" value={profile.accountSize} onChange={(value) => updateProfile("accountSize", value)} />
            <Field label="Starting Balance" type="number" value={profile.startingBalance} onChange={(value) => updateProfile("startingBalance", value)} />
            <Field label="Trailing Drawdown" type="number" value={profile.trailingDrawdown} onChange={(value) => updateProfile("trailingDrawdown", value)} />
            <Field label="Daily Loss Limit" type="number" value={profile.maxDailyLoss} onChange={(value) => updateProfile("maxDailyLoss", value)} />
            <Field label="Profit Target" type="number" value={profile.profitGoal} onChange={(value) => updateProfile("profitGoal", value)} />
            <Field label="Max Contracts" type="number" value={profile.maxContracts} onChange={(value) => updateProfile("maxContracts", value)} />
            <Field label="Consistency Rule %" type="number" value={profile.consistencyRuleTarget} onChange={(value) => updateProfile("consistencyRuleTarget", value)} />
          </div>
        </section>
        <section style={styles.safetyCard}>
          <p style={styles.cardLabel}>Prop Firm Rule Monitor</p>
          <h2 style={styles.sectionTitle}>Protect the Payout</h2>
          <div style={styles.warningStack}>
            {(fundedWarnings.length ? fundedWarnings : ["Inside funded-account guardrails."]).map((warning) => (
              <div key={warning} style={warning.includes("Inside") ? styles.coachPrompt : styles.warningBox}>{warning}</div>
            ))}
          </div>
        </section>
      </> : null}

      {/* ── Connection Status ── */}
      <section style={styles.card}>
        <p style={styles.cardLabel}>Connection Status</p>
        <h2 style={styles.sectionTitle}>{statusLabel}</h2>
        {brokerConnection.error ? <div style={{ ...styles.priceWarning, marginBottom: "14px" }}>{brokerConnection.error}</div> : null}
        <div style={styles.connectionGrid}>
          <Metric label="Market" value={profile.mainMarket} />
          <Metric label="Data Source" value={brokerConnection.source || dataSource} />
          <Metric label="Current Price" value={Number(price).toFixed(2)} />
          <Metric label="Bid" value={Number(quote.bid || 0).toFixed(2)} />
          <Metric label="Ask" value={Number(quote.ask || 0).toFixed(2)} />
          <Metric label="Account Type" value={brokerConnection.accountType || profile.accountType || "Not connected"} />
          <Metric label="Position" value={position ? position.direction.toUpperCase() : "Flat"} />
          <Metric label="Open P/L" value={`$${Number(brokerConnection.openPnl ?? engine.openPnl ?? 0).toFixed(2)}`} tone={Number(brokerConnection.openPnl ?? 0) >= 0 ? "good" : "bad"} />
          <Metric label="Daily P/L" value={`$${Number(brokerConnection.dailyPnl ?? discipline.dailyPnl ?? 0).toFixed(2)}`} />
          <Metric label="Last Updated" value={lastUpdated} />
        </div>
      </section>

      {/* ── Demo Broker ── */}
      <section style={styles.card}>
        <p style={styles.cardLabel}>Demo Mode</p>
        <h2 style={styles.sectionTitle}>Simulated Broker</h2>
        <p style={styles.muted}>Simulates live price, position, P/L, and account balance for testing without a live connection.</p>
        <button onClick={startDemoBroker} style={{ ...styles.settingsButton, marginTop: "16px" }}>Connect Demo Broker</button>
        <div style={{ ...styles.metricGrid, marginTop: "16px" }}>
          <Metric label="Bid" value={Number(quote.bid || 0).toFixed(2)} />
          <Metric label="Ask" value={Number(quote.ask || 0).toFixed(2)} />
          <Metric label="Fills" value={String(brokerConnection.fills?.length || 0)} />
        </div>
      </section>

      {/* ── Safety ── */}
      <section style={styles.safetyCard}>
        <p style={styles.cardLabel}>Safety Layer</p>
        <h2 style={styles.sectionTitle}>Broker Safety</h2>
        <div style={styles.warningStack}>
          {safetyWarnings.map((warning) => (
            <div key={warning} style={styles.warningBox}>{warning}</div>
          ))}
        </div>
      </section>
      </> : null}

      {tradingViewWizardOpen ? (
        <TradingViewAlertWizard
          onClose={() => setTradingViewWizardOpen(false)}
          onSendTest={sendTestTradingViewSignal}
        />
      ) : null}
    </main>
  );
}

const TRADE_PILOT_PINE_INDICATOR = `//@version=6
indicator("Trade Pilot Signal Engine", shorttitle="TPSE", overlay=true, max_labels_count=50)

lookback        = input.int(20, "S/R Lookback Bars", minval=5, maxval=200, group="Engine")
emaFastLen      = input.int(9,  "EMA Fast", minval=2, maxval=50,           group="Engine")
emaSlowLen      = input.int(21, "EMA Slow", minval=5, maxval=200,          group="Engine")
minSetupScore   = input.int(75, "Min Setup Score (B+ = 75)", minval=0, maxval=100, group="Engine")
maxPerSession   = input.int(2,  "Max signals per direction per session", minval=1, maxval=10, group="Engine")
cooldownBars    = input.int(8,  "Cooldown bars between signals", minval=0, maxval=200, group="Engine")
sendPriceUpdate = input.bool(true, "Stream price_update on every bar close", group="Engine")

showSignals = input.bool(true,  "Show Signals", group="Display")
showZones   = input.bool(true,  "Show Zones",   group="Display")
showEmas    = input.bool(false, "Show EMAs",    group="Display")
focusMode   = input.bool(false, "Focus Mode", group="Display")

support         = ta.lowest(low,   lookback)
resistance      = ta.highest(high, lookback)
priorSupport    = nz(support[1],    support)
priorResistance = nz(resistance[1], resistance)
emaFast         = ta.ema(close, emaFastLen)
emaSlow         = ta.ema(close, emaSlowLen)

rng       = math.max(priorResistance - priorSupport, syminfo.mintick * 4)
zoneWidth = rng * 0.025

nearSupport    = math.abs(close - priorSupport)    <= rng * 0.18
nearResistance = math.abs(close - priorResistance) <= rng * 0.18
inMidRange     = close > priorSupport + rng * 0.30 and close < priorResistance - rng * 0.30

bullishConfirm = close > open and close >= priorSupport    and low  <= priorSupport    + zoneWidth
bearishConfirm = close < open and close <= priorResistance and high >= priorResistance - zoneWidth

longProximity    = nearSupport ? 25.0 : 0.0
longTrend        = emaFast > emaSlow ? 20.0 : (emaFast < emaSlow ? 0.0 : 10.0)
longRisk         = math.max(close - priorSupport, syminfo.mintick)
longReward       = priorResistance - close
longRR           = longRisk > 0 ? longReward / longRisk : 0.0
longRRScore      = longRR >= 2.0 ? 25.0 : (longRR >= 1.5 ? 18.0 : (longRR >= 1.0 ? 10.0 : 0.0))
longMidScore     = inMidRange ? 0.0 : 15.0
longConfirmScore = bullishConfirm ? 15.0 : 0.0
longSetupScore   = longProximity + longTrend + longRRScore + longMidScore + longConfirmScore

shortProximity    = nearResistance ? 25.0 : 0.0
shortTrend        = emaFast < emaSlow ? 20.0 : (emaFast > emaSlow ? 0.0 : 10.0)
shortRisk         = math.max(priorResistance - close, syminfo.mintick)
shortReward       = close - priorSupport
shortRR           = shortRisk > 0 ? shortReward / shortRisk : 0.0
shortRRScore      = shortRR >= 2.0 ? 25.0 : (shortRR >= 1.5 ? 18.0 : (shortRR >= 1.0 ? 10.0 : 0.0))
shortMidScore     = inMidRange ? 0.0 : 15.0
shortConfirmScore = bearishConfirm ? 15.0 : 0.0
shortSetupScore   = shortProximity + shortTrend + shortRRScore + shortMidScore + shortConfirmScore

qualifiedLong  = longSetupScore  >= minSetupScore and not nearResistance
qualifiedShort = shortSetupScore >= minSetupScore and not nearSupport

activeLong  = qualifiedLong  and longSetupScore  >  shortSetupScore
activeShort = qualifiedShort and shortSetupScore >  longSetupScore

var int sessionLongCount  = 0
var int sessionShortCount = 0
var int lastLongBar       = -10000
var int lastShortBar      = -10000

if session.isfirstbar
    sessionLongCount  := 0
    sessionShortCount := 0

cooldownLongOk  = (bar_index - lastLongBar)  >= cooldownBars
cooldownShortOk = (bar_index - lastShortBar) >= cooldownBars

fireLong  = activeLong  and cooldownLongOk  and sessionLongCount  < maxPerSession
fireShort = activeShort and cooldownShortOk and sessionShortCount < maxPerSession

if fireLong
    lastLongBar := bar_index
    sessionLongCount += 1
if fireShort
    lastShortBar := bar_index
    sessionShortCount += 1

longGrade  = longSetupScore  >= 85 ? "A" : "B+"
shortGrade = shortSetupScore >= 85 ? "A" : "B+"

zonesVisible = showZones and not focusMode
emasVisible  = showEmas  and not focusMode

plot(zonesVisible ? resistance : na, "Resistance", color=color.new(color.red,    65), linewidth=1)
plot(zonesVisible ? support    : na, "Support",    color=color.new(color.green,  65), linewidth=1)
plot(emasVisible  ? emaFast    : na, "EMA Fast",   color=color.new(color.blue,   75), linewidth=1)
plot(emasVisible  ? emaSlow    : na, "EMA Slow",   color=color.new(color.purple, 75), linewidth=1)

bgcolor(focusMode ? color.new(#020617, 80) : na)

if showSignals and fireLong
    label.new(bar_index, low, text="LONG\\n(" + longGrade + ")", style=label.style_label_up, color=color.new(color.green, 10), textcolor=color.white, size=size.small, yloc=yloc.belowbar)

if showSignals and fireShort
    label.new(bar_index, high, text="SHORT\\n(" + shortGrade + ")", style=label.style_label_down, color=color.new(color.red, 10), textcolor=color.white, size=size.small, yloc=yloc.abovebar)

ts = str.format_time(timenow, "yyyy-MM-dd'T'HH:mm:ss'Z'", "UTC")

if sendPriceUpdate
    alert(str.format('{"symbol":"{0}","price":{1,number,#.##########},"timeframe":"{2}","open":{3,number,#.##########},"high":{4,number,#.##########},"low":{5,number,#.##########},"close":{6,number,#.##########},"volume":{7,number,#.##},"signal":"price_update","timestamp":"{8}"}', syminfo.ticker, close, timeframe.period, open, high, low, close, volume, ts), alert.freq_once_per_bar_close)

if fireLong
    alert(str.format('{"symbol":"{0}","price":{1,number,#.##########},"timeframe":"{2}","signal":"trade_setup","direction":"long","setupScore":{3,number,#},"grade":"{4}","timestamp":"{5}"}', syminfo.ticker, close, timeframe.period, longSetupScore, longGrade, ts), alert.freq_once_per_bar_close)

if fireShort
    alert(str.format('{"symbol":"{0}","price":{1,number,#.##########},"timeframe":"{2}","signal":"trade_setup","direction":"short","setupScore":{3,number,#},"grade":"{4}","timestamp":"{5}"}', syminfo.ticker, close, timeframe.period, shortSetupScore, shortGrade, ts), alert.freq_once_per_bar_close)

alertcondition(true,      title="TradePilot Price Update", message='{"symbol":"{{ticker}}","price":{{close}},"timeframe":"{{interval}}","open":{{open}},"high":{{high}},"low":{{low}},"close":{{close}},"volume":{{volume}},"signal":"price_update","timestamp":"{{timenow}}"}')
alertcondition(fireLong,  title="TradePilot Long Setup",   message='{"symbol":"{{ticker}}","price":{{close}},"timeframe":"{{interval}}","signal":"trade_setup","direction":"long","timestamp":"{{timenow}}"}')
alertcondition(fireShort, title="TradePilot Short Setup",  message='{"symbol":"{{ticker}}","price":{{close}},"timeframe":"{{interval}}","signal":"trade_setup","direction":"short","timestamp":"{{timenow}}"}')
`;

// Default alert payload sends real OHLC + volume so the chart renders true
// candles (not flat single-tick bars). Use TradingView "Once Per Bar Close"
// frequency so each alert delivers the closed bar's OHLC.
const TRADE_PILOT_ALERT_MESSAGE = `{
 "symbol": "{{ticker}}",
 "price": {{close}},
 "timeframe": "{{interval}}",
 "open": {{open}},
 "high": {{high}},
 "low": {{low}},
 "close": {{close}},
 "volume": {{volume}},
 "signal": "price_update",
 "timestamp": "{{timenow}}"
}`;

function TradingViewAlertWizard({ onClose, onSendTest }) {
  const [step, setStep] = useState(1);
  const [market, setMarket] = useState("NQ");
  const [sendingTest, setSendingTest] = useState(false);
  const [testStatus, setTestStatus] = useState("");
  const webhookUrl = "https://tradepilottool.com/api/webhook/tradingview";
  const TOTAL_STEPS = 6;

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard may be blocked; text remains selectable
    }
  };

  const handleSendTest = async () => {
    if (sendingTest) return;
    setSendingTest(true);
    setTestStatus("Sending test signal...");
    try {
      const ok = await onSendTest(market, "5");
      setTestStatus(ok ? "Signal received. Check the dashboard — price and levels should update." : "Test failed. Verify the webhook URL is correct and try again.");
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div style={{ ...styles.modalBackdrop, zIndex: 60 }}>
      <section style={styles.modal}>
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.cardLabel}>TradingView Setup — Step {step} of {TOTAL_STEPS}</p>
            <h2 style={styles.sectionTitle}>Connect Trade Pilot Signal Engine</h2>
          </div>
          <button onClick={onClose} style={styles.dismissButton}>Close</button>
        </div>

        <div style={styles.segmentGroup}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((item) => (
            <button key={item} onClick={() => setStep(item)} style={{ ...styles.segmentButton, background: step === item ? "#2563eb" : "#111827" }}>
              {item}
            </button>
          ))}
        </div>

        {step === 1 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 1 — Open Pine Editor</p>
            <h3 style={styles.sectionTitle}>Open the TradingView Pine Editor</h3>
            <p style={styles.muted}>In TradingView, open the chart for the symbol you want to trade, then click <strong>Pine Editor</strong> in the bottom panel. If you have an existing draft open, click the <strong>+</strong> tab and choose <strong>New blank indicator</strong>. Delete every line of starter code so the editor is empty.</p>
            <div style={styles.installBannerActions}>
              <button onClick={() => window.open("https://www.tradingview.com/chart/", "_blank", "noopener,noreferrer")} style={styles.secondaryButton}>Open TradingView</button>
              <button onClick={() => window.open("https://www.tradingview.com/pine-script-docs/en/v5/Introduction.html", "_blank", "noopener,noreferrer")} style={styles.secondaryButton}>Pine Editor Guide</button>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 2 — Paste Full Indicator Code</p>
            <h3 style={styles.sectionTitle}>Paste the Trade Pilot Signal Engine</h3>
            <p style={styles.muted}>Copy the full indicator below and paste it into the empty Pine Editor.</p>
            <pre style={{ ...styles.sharePreview, fontSize: "11px", maxHeight: "260px", overflow: "auto" }}>{TRADE_PILOT_PINE_INDICATOR}</pre>
            <div style={styles.installBannerActions}>
              <button onClick={() => copyText(TRADE_PILOT_PINE_INDICATOR)} style={styles.settingsButton}>Copy Full Indicator</button>
            </div>
            <div style={{ ...styles.coachPrompt, marginTop: "14px" }}>
              The same code lives in <strong>tradingview/TradePilotSignalEngine.pine</strong> in your Trade Pilot repository.
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 3 — Save Script</p>
            <h3 style={styles.sectionTitle}>Save the Script</h3>
            <p style={styles.muted}>Click <strong>Save</strong> in the top-right corner of the Pine Editor. Name the script <strong>Trade Pilot Signal Engine</strong> and confirm. TradingView will compile it — you should see "Saved successfully" and zero errors.</p>
            <ul style={{ ...styles.muted, paddingLeft: "20px", lineHeight: "1.9" }}>
              <li>If you see a compile error, re-copy the full indicator from Step 2.</li>
              <li>Saving lets TradingView find the script later when you create alerts.</li>
            </ul>
          </section>
        ) : null}

        {step === 4 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 4 — Add to Chart</p>
            <h3 style={styles.sectionTitle}>Add the Indicator to Your Chart</h3>
            <p style={styles.muted}>Click <strong>Add to chart</strong> (play icon at the top of the Pine Editor). The indicator will overlay your chart and you should see:</p>
            <ul style={{ ...styles.muted, paddingLeft: "20px", lineHeight: "1.9" }}>
              <li>Red stepline — resistance (highest high over 20 bars)</li>
              <li>Green stepline — support (lowest low over 20 bars)</li>
              <li>Green up triangles — long setups (breakouts and bounces)</li>
              <li>Red down triangles — short setups (breakdowns and rejections)</li>
            </ul>
            <div style={styles.sourceGrid}>
              {["NQ", "MNQ", "ES", "MES"].map((option) => (
                <button key={option} onClick={() => setMarket(option)} style={{ ...styles.sourceButton, borderColor: market === option ? "#38bdf8" : "#334155" }}>
                  <strong>{option}</strong>
                  <span>{marketSpecs[option]?.displayName}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {step === 5 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 5 — Create Alert</p>
            <h3 style={styles.sectionTitle}>Create the TradingView Alert</h3>
            <p style={styles.muted}>Right-click the chart and choose <strong>Add alert</strong> (or press Alt + A). Use these settings:</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" }}>
              {[
                ["Condition", "Trade Pilot Signal Engine"],
                ["Alert", "TradePilot Price Update / Long Setup / Short Setup"],
                ["Trigger", "Once Per Bar Close"],
                ["Expiration", "Open-ended"],
              ].map(([label, value]) => (
                <div key={label} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                  <span style={{ color: "#94a3b8", fontSize: "12px", minWidth: "110px", paddingTop: "2px" }}>{label}</span>
                  <span style={{ color: "#f8fafc", fontSize: "13px", fontWeight: 600 }}>{value}</span>
                </div>
              ))}
            </div>
            <p style={{ ...styles.muted, marginTop: "12px" }}>Create one alert per condition you want to receive (Price Update for live price, Long/Short Setup for tradeable signals).</p>
          </section>
        ) : null}

        {step === 6 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 6 — Paste Webhook URL and Alert Message</p>
            <h3 style={styles.sectionTitle}>Wire Up the Webhook</h3>
            <p style={styles.muted}>In the alert's <strong>Notifications</strong> tab, enable <strong>Webhook URL</strong> and paste:</p>
            <pre style={styles.sharePreview}>{webhookUrl}</pre>
            <div style={styles.installBannerActions}>
              <button onClick={() => copyText(webhookUrl)} style={styles.settingsButton}>Copy Webhook URL</button>
            </div>
            <p style={{ ...styles.muted, marginTop: "14px" }}>Then in the alert's <strong>Message</strong> field paste the JSON template below (the indicator already supplies the right one for each condition — copy this if you build a custom alert):</p>
            <pre style={{ ...styles.sharePreview, fontSize: "11px" }}>{TRADE_PILOT_ALERT_MESSAGE}</pre>
            <div style={styles.installBannerActions}>
              <button onClick={() => copyText(TRADE_PILOT_ALERT_MESSAGE)} style={styles.secondaryButton}>Copy Alert Message</button>
              <button onClick={() => window.open("https://www.tradingview.com/chart/", "_blank", "noopener,noreferrer")} style={styles.secondaryButton}>Open TradingView</button>
            </div>
            <div style={{ ...styles.coachPrompt, marginTop: "14px" }}>
              <strong>Verify:</strong> click <strong>Create</strong> in TradingView, then send a test signal below. The dashboard should update instantly with the price for <strong>{market}</strong>.
            </div>
            <div style={{ ...styles.installBannerActions, marginTop: "10px" }}>
              <button disabled={sendingTest} onClick={handleSendTest} style={{ ...styles.settingsButton, opacity: sendingTest ? 0.7 : 1 }}>
                {sendingTest ? "Sending..." : `Send Test Signal (${market})`}
              </button>
            </div>
            {testStatus ? (
              <div style={{ ...styles.coachPrompt, marginTop: "12px" }}>{testStatus}</div>
            ) : null}
          </section>
        ) : null}

        <div style={{ ...styles.installBannerActions, marginTop: "18px" }}>
          {step > 1 ? <button onClick={() => setStep((s) => s - 1)} style={styles.secondaryButton}>Back</button> : null}
          {step < TOTAL_STEPS ? <button onClick={() => setStep((s) => s + 1)} style={styles.settingsButton}>Continue</button> : null}
          {step === TOTAL_STEPS ? <button onClick={onClose} style={styles.settingsButton}>Done</button> : null}
        </div>
      </section>
    </div>
  );
}


function DataSourcePage({ applyAlert }) {
  const [webhookText, setWebhookText] = useState('{"symbol":"MNQ","price":27500.25,"timeframe":"5m","support":27460,"resistance":27550,"bias":"bullish","timestamp":"2026-04-28T14:30:00.000Z"}');
  const [brokerText, setBrokerText] = useState(JSON.stringify(brokerSamplePayload, null, 2));
  const [brokerStatus, setBrokerStatus] = useState(null);
  const [message, setMessage] = useState("Broker trading is disabled. Trade Pilot only reads data and coaches execution.");

  const applyWebhookPreview = () => {
    try {
      const parsed = JSON.parse(webhookText);
      applyAlert({
        symbol: parsed.symbol,
        price: Number(parsed.price),
        direction: parsed.direction,
        bias: parsed.bias,
        support: Number(parsed.support),
        resistance: Number(parsed.resistance),
        timestamp: parsed.timestamp,
        signalType: parsed.signalType || parsed.bias,
      });
    } catch {
      setMessage("Webhook preview must be valid JSON.");
    }
  };

  const syncBrokerPreview = async () => {
    if (!isLocalDevHost()) {
      setMessage("Broker sync requires the local market server (127.0.0.1:8787) and is disabled in production.");
      return;
    }
    try {
      const parsed = JSON.parse(brokerText);
      const response = await fetch(`${marketServerUrl}/api/broker/sync`, {
        body: JSON.stringify(parsed),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Broker sync failed.");
      setBrokerStatus(result.snapshot);
      setMessage("Broker snapshot synced. Choose Broker Connection on the dashboard to stream it live.");
    } catch (error) {
      setMessage(error.message || "Broker payload must be valid JSON.");
    }
  };

  return (
    <main style={styles.mainGrid}>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Connect Data Source</p>
        <h2 style={styles.sectionTitle}>Read-Only Modes</h2>
        <div style={styles.sourceGrid}>
          <SourceOption title="Manual Mode" text="Use sliders and Fast Mode buttons during live execution." active />
          <SourceOption title="Connect TradingView Alerts" text="Alerts can send symbol, price, timeframe, support, resistance, bias, and timestamp." />
          <SourceOption title="Market Data API" text="Uses the local read-only market server at 127.0.0.1:8787 for streaming prices." />
          <SourceOption title="Tradovate Prop/Funded Read-Only" text="Reads live prop account data when API access is enabled. No order placement." />
          <SourceOption title="CSV Upload" text="Planned manual trade-history import for review and coaching analytics." />
        </div>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Broker Connection</p>
        <h2 style={styles.sectionTitle}>Local Read-Only Bridge</h2>
        <p style={styles.muted}>A brokerage or platform adapter can post snapshots here. Trade Pilot reads positions and fills for coaching; it never sends orders.</p>
        <textarea value={brokerText} onChange={(event) => setBrokerText(event.target.value)} style={styles.textArea} />
        <button onClick={syncBrokerPreview} style={styles.settingsButton}>Sync Broker Snapshot</button>
        {brokerStatus ? (
          <div style={{ ...styles.metricGrid, marginTop: "14px" }}>
            <Metric label="Platform" value={brokerStatus.platform} />
            <Metric label="Account" value={brokerStatus.accountId || "Read-only"} />
            <Metric label="Position" value={brokerStatus.position ? `${brokerStatus.position.direction.toUpperCase()} ${brokerStatus.position.contracts} ${brokerStatus.position.symbol}` : "Flat"} />
            <Metric label="Updated" value={brokerStatus.updatedAt ? new Date(brokerStatus.updatedAt).toLocaleTimeString() : "Pending"} />
          </div>
        ) : null}
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Connect TradingView Alerts</p>
        <h2 style={styles.sectionTitle}>Local Preview</h2>
        <p style={styles.muted}>Paste a sample alert message to populate the dashboard.</p>
        <textarea value={webhookText} onChange={(event) => setWebhookText(event.target.value)} style={styles.textArea} />
        <button onClick={applyWebhookPreview} style={styles.settingsButton}>Apply Alert Preview</button>
        <p style={{ ...styles.muted, marginTop: "12px" }}>{message}</p>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Broker/Platform Plan</p>
        <h2 style={styles.sectionTitle}>Safety-First Integrations</h2>
        <PlanItem title="Tradovate API" text="Use an adapter to post read-only account, position, and fill data into the local bridge." />
        <PlanItem title="NinjaTrader Add-on/Export" text="A local add-on can post snapshots while the platform keeps order control." />
        <PlanItem title="Rithmic / Prop Firm Data" text="Use approved read data only, based on the platform and firm rules." />
        <PlanItem title="CSV / Manual Import" text="Start with uploadable trade history for review and analytics." />
      </section>

      <section style={styles.safetyCard}>
        <p style={styles.cardLabel}>Safety Lock</p>
        <h2 style={styles.sectionTitle}>Auto-Trading Disabled</h2>
        <p style={styles.coachMessage}>Trade Pilot will not place trades automatically.</p>
        <p style={styles.muted}>This app is an execution assistant first: read trade and price data, detect active positions, and coach decisions.</p>
      </section>
    </main>
  );
}

function KeyLevelCoach({
  breakoutLevel,
  coach,
  currentPrice,
  marketBias,
  pullbackSupport,
  recentHigh,
  rangeMax,
  rangeMin,
  setBreakoutLevel,
  setMarketBias,
  setPullbackSupport,
  setRecentHigh,
}) {
  detectKeyLevelsFromCandles([]);

  return (
    <section style={styles.levelCoachGrid}>
      <div style={styles.card}>
        <p style={styles.cardLabel}>Key Level Detection</p>
        <h2 style={styles.sectionTitle}>Manual Levels</h2>
        <div style={styles.formGrid}>
          <Control label="Recent High / Resistance" tooltip={tooltipText.resistance} value={recentHigh} setValue={setRecentHigh} min={rangeMin} max={rangeMax} />
          <Control label="Pullback Support" tooltip={tooltipText.support} value={pullbackSupport} setValue={setPullbackSupport} min={rangeMin} max={rangeMax} />
          <Control label="Breakout Level" tooltip={tooltipText.breakout} value={breakoutLevel} setValue={setBreakoutLevel} min={rangeMin} max={rangeMax} />
          <SelectField label="Market Bias" value={marketBias} options={["bullish", "bearish", "neutral"]} onChange={setMarketBias} />
        </div>
      </div>

      <div style={styles.levelActionCard}>
        <p style={styles.cardLabel}>Pullback Coach</p>
        <h2 style={styles.actionText}>{coach.action}</h2>
        <p style={styles.coachMessage}>{coach.marketState}</p>
        <p style={styles.muted}>{coach.message}</p>
      </div>

      <div style={styles.card}>
        <p style={styles.cardLabel}>Support / Resistance Guidance</p>
        <PlanItem title="Resistance" text="Recent high where price rejected." />
        <PlanItem title="Support" text="Prior breakout area or recent low where buyers defended." />
        <PlanItem title="Middle zone" text="Bad entry area. Wait for a level, pullback, breakout, or retest." />
      </div>

      <div style={styles.card}>
        <p style={styles.cardLabel}>Trade Plan Generator</p>
        <h2 style={styles.sectionTitle}>Simple Plan</h2>
        <div style={styles.metricGrid}>
          <Metric label="Current Price" tooltip={tooltipText.currentPrice} value={currentPrice.toFixed(2)} />
          <Metric label="Entry Zone" tooltip={tooltipText.retest} value={coach.plan.entry} />
          <Metric label="Stop Loss" tooltip={tooltipText.stopLoss} value={coach.plan.stop} />
          <Metric label="Target 1" tooltip={tooltipText.target} value={coach.plan.target1} />
          <Metric label="Target 2 / Runner" tooltip={tooltipText.runner} value={coach.plan.target2} />
        </div>
      </div>
    </section>
  );
}

function JournalPage({ activePosition, addJournalEntry, engine, discipline, journalEntries }) {
  const [note, setNote] = useState("");
  const safeJournalEntries = safeArray(journalEntries);
  const submit = (event) => {
    event.preventDefault();
    if (!note.trim()) return;
    addJournalEntry(note.trim());
    setNote("");
  };

  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Journal" subtitle="Track trades and notes." />
      </div>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Journal</p>
        <h2 style={styles.sectionTitle}>Today&apos;s Execution Snapshot</h2>
        <div style={styles.metricGrid}>
          <Metric label="Trades Taken" value={String(discipline.tradesTaken)} />
          <Metric label="Daily P/L" value={`$${discipline.dailyPnl.toFixed(2)}`} tone={discipline.dailyPnl >= 0 ? "good" : "bad"} />
          <Metric label="Trade Score" value={`${engine.score}/100`} />
          <Metric label="Suggested Action" value={engine.suggestedAction} tone={engine.actionTone} />
        </div>
      </section>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Active Notes</p>
        <h2 style={styles.sectionTitle}>{activePosition ? "Position Context" : "No Active Position"}</h2>
        <p style={styles.muted}>
          {activePosition
            ? `${activePosition.direction.toUpperCase()} from ${activePosition.entry}. Last action: ${activePosition.lastAction}.`
            : "Use Fast Mode or dashboard inputs to create an execution context for review."}
        </p>
      </section>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Personal Journal</p>
        <h2 style={styles.sectionTitle}>Save Trade Notes</h2>
        <form onSubmit={submit}>
          <textarea style={styles.textArea} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What did you see? What did you do well? What needs work?" />
          <button style={styles.settingsButton}>Save Journal Entry</button>
        </form>
        <div style={{ ...styles.warningStack, marginTop: "16px" }}>
          {safeJournalEntries.slice(0, 8).map((entry) => (
            <PlanItem key={entry.id || entry.stamp} title={new Date(entry.stamp).toLocaleString()} text={`${entry.market || ""} ${entry.note || ""}`} />
          ))}
        </div>
      </section>
    </main>
  );
}

function ProfilePage({ profile, updateProfile }) {
  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Profile" subtitle="Trading preferences and account setup." />
      </div>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Profile</p>
        <h2 style={styles.sectionTitle}>Trader Settings</h2>
        <p style={{ ...styles.muted, marginBottom: "18px" }}>Saved locally on this device, and synced to your personal dashboard when signed in.</p>
        <ProfileFields profile={profile} updateProfile={updateProfile} />
      </section>
    </main>
  );
}

function ProfileFields({ profile, updateProfile }) {
  const accountType = normalizeAccountType(profile.accountType);
  const isFunded = isFundedAccountType(accountType);

  return (
    <>
      <div style={styles.formGrid}>
        <Field label="Name" value={profile.traderName} onChange={(value) => updateProfile("traderName", value)} />
        <SelectField label="Experience Level" value={profile.traderExperienceLevel || "intermediate"} options={["beginner", "intermediate", "advanced"]} onChange={(value) => updateProfile("traderExperienceLevel", value)} />
        <SelectField label="Trader Style" value={profile.traderStyle} options={["scalper", "runner", "both"]} onChange={(value) => updateProfile("traderStyle", value)} />
        <SelectField label="Main Market" value={profile.mainMarket} options={markets} onChange={(value) => updateProfile("mainMarket", value)} />
        <SelectField label="Account Type" value={accountType} options={accountTypeOptions} onChange={(value) => updateProfile("accountType", value)} />
        <SelectField label="Platform" value={profile.fundedPlatform} options={fundedPlatforms} onChange={(value) => updateProfile("fundedPlatform", value)} />
        <Field label="Account Size" type="number" value={profile.accountSize} onChange={(value) => updateProfile("accountSize", value)} />
        <Field label="Starting Balance" type="number" value={profile.startingBalance} onChange={(value) => updateProfile("startingBalance", value)} />
        <Field label="Max Risk Per Trade" type="number" value={profile.maxRiskPerTrade} onChange={(value) => updateProfile("maxRiskPerTrade", value)} />
        <Field label="Max Trades Per Day" type="number" value={profile.maxTradesPerDay} onChange={(value) => updateProfile("maxTradesPerDay", value)} />
        <Field label="Max Contracts" type="number" value={profile.maxContracts} onChange={(value) => updateProfile("maxContracts", value)} />
        <Field label="Default Contracts" type="number" value={profile.defaultContracts} onChange={(value) => updateProfile("defaultContracts", value)} />
        <Field label="Default Risk Points" type="number" value={profile.defaultRiskPoints} onChange={(value) => updateProfile("defaultRiskPoints", value)} />
        <Field label="Trim 1 Points" type="number" value={profile.trim1Points} onChange={(value) => updateProfile("trim1Points", value)} />
        <Field label="Trim 2 Points" type="number" value={profile.trim2Points} onChange={(value) => updateProfile("trim2Points", value)} />
        <Field label="Runner Points" type="number" value={profile.runnerPoints} onChange={(value) => updateProfile("runnerPoints", value)} />
      </div>
      {isFunded ? (
        <section style={styles.subPanel}>
          <p style={styles.cardLabel}>Prop Firm Rules</p>
          <h2 style={styles.sectionTitle}>Funded Account</h2>
          <div style={styles.formGrid}>
            <SelectField label="Funded Provider" value={profile.fundedProvider} options={fundedProviders} onChange={(value) => updateProfile("fundedProvider", value)} />
            <SelectField label="Account Phase" value={profile.accountPhase} options={["evaluation", "funded", "live"]} onChange={(value) => updateProfile("accountPhase", value)} />
            <Field label="Trailing Drawdown" type="number" value={profile.trailingDrawdown} onChange={(value) => updateProfile("trailingDrawdown", value)} />
            <Field label="Profit Goal" type="number" value={profile.profitGoal} onChange={(value) => updateProfile("profitGoal", value)} />
            <Field label="Consistency Rule Target %" type="number" value={profile.consistencyRuleTarget} onChange={(value) => updateProfile("consistencyRuleTarget", value)} />
            <Field label="Max Daily Loss" type="number" value={profile.maxDailyLoss} onChange={(value) => updateProfile("maxDailyLoss", value)} />
            <Field label="Max Contracts" type="number" value={profile.maxContracts} onChange={(value) => updateProfile("maxContracts", value)} />
          </div>
        </section>
      ) : null}
      <label style={styles.switchRow}>
        <input type="checkbox" checked={profile.voiceAlerts} onChange={(event) => updateProfile("voiceAlerts", event.target.checked)} />
        Voice alerts on/off
      </label>
      <label style={styles.switchRow}>
        <input type="checkbox" checked={profile.soundAlerts !== false} onChange={(event) => updateProfile("soundAlerts", event.target.checked)} />
        Sound alerts on/off
      </label>
    </>
  );
}

function HelpPage() {
  const topics = [
    ["Support and Resistance", "Support is an area where buyers have shown interest before. Resistance is an area where sellers have pushed back before. These zones help you decide where a trade idea is strong or weak."],
    ["Risk Management", "Risk management means knowing how much you can lose before you enter. Trade Pilot compares your stop, contracts, and account limits so one trade does not become an account problem."],
    ["Stop Loss Placement", "A stop should usually sit beyond a structure level, not at a random number. For a long trade, that often means below support. For a short trade, that often means above resistance."],
    ["Trimming Profits", "Trimming means taking partial profit while keeping part of the trade open. It can reduce pressure and help you follow the plan after the first target hits."],
    ["Runner Contracts", "A runner is the final piece of a position that stays open for a larger move. It works best after risk has been reduced and the trade has room to continue."],
    ["How Trade Pilot Helps Manage Trades", "Trade Pilot organizes price, levels, risk, targets, discipline limits, and coaching prompts in one place so you can make calmer execution decisions."],
  ];

  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Help" subtitle="Learn the trading concepts behind Trade Pilot." />
      </div>
      {topics.map(([title, text]) => (
        <section key={title} style={styles.card}>
          <p style={styles.cardLabel}>Education</p>
          <h2 style={styles.sectionTitle}>{title}</h2>
          <p style={styles.muted}>{text}</p>
        </section>
      ))}
    </main>
  );
}

function SupportPage({ messages, onSubmit }) {
  const [form, setForm] = useState({ name: "", email: "", message: "" });

  const submit = (event) => {
    event.preventDefault();
    if (!form.message.trim()) return;
    onSubmit(form);
    setForm({ name: "", email: "", message: "" });
  };

  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Support" subtitle="Contact support or send feedback." />
      </div>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Support</p>
        <h2 style={styles.sectionTitle}>Contact Trade Pilot</h2>
        <p style={styles.muted}>Email: <a style={styles.link} href="mailto:support@tradepilot.app">support@tradepilot.app</a></p>
        <form onSubmit={submit} style={{ ...styles.warningStack, marginTop: "18px" }}>
          <Field label="Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <Field label="Email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
          <label style={styles.field}>
            <span>Message</span>
            <textarea style={styles.textArea} value={form.message} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} />
          </label>
          <button style={styles.settingsButton}>Submit Support Request</button>
        </form>
      </section>
      <section style={styles.card}>
        <p style={styles.cardLabel}>FAQ</p>
        <PlanItem title="How do I use Trade Pilot?" text="Set your market, price, levels, direction, risk, and contracts. Use the score, coach, and guardrails to decide whether to wait, manage, or exit." />
        <PlanItem title="How does the trade score work?" text="The score blends location, chop, direction, risk, reward-to-risk, distance from entry, and contract size." />
        <PlanItem title="Does Trade Pilot place trades automatically?" text="No. Trade Pilot only assists execution. It does not send broker orders." />
        <PlanItem title="Recent local support requests" text={messages.length ? `${messages.length} saved on this device.` : "No local support messages yet."} />
      </section>
    </main>
  );
}

function SettingsPage({ applyAlert, debugMode, notificationPrefs, profile, setDebugMode, setNotificationPrefs, updateProfile }) {
  const [settingsTab, setSettingsTab] = useState("General");
  const accountType = normalizeAccountType(profile.accountType);
  const isFunded = isFundedAccountType(accountType);
  const tabs = ["General", "Risk Guardrails", "Funded Account", "Trade Defaults", "Alerts", "Advanced"];

  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Settings" subtitle="Customize Trade Pilot." />
      </div>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Settings</p>
        <h2 style={styles.sectionTitle}>Customize Trade Pilot</h2>
        <div style={styles.segmentGroup}>
          {tabs.map((tab) => (
            <button key={tab} onClick={() => setSettingsTab(tab)} style={{ ...styles.segmentButton, background: settingsTab === tab ? "#2563eb" : "#111827" }}>{tab}</button>
          ))}
        </div>
        {settingsTab === "General" ? (
          <div style={styles.formGrid}>
            <Field label="Name" value={profile.traderName} onChange={(value) => updateProfile("traderName", value)} />
            <SelectField label="Experience Level" value={profile.traderExperienceLevel || "intermediate"} options={["beginner", "intermediate", "advanced"]} onChange={(value) => updateProfile("traderExperienceLevel", value)} />
            <SelectField label="Trader Style" value={profile.traderStyle} options={["scalper", "runner", "both"]} onChange={(value) => updateProfile("traderStyle", value)} />
            <SelectField label="Main Market" value={profile.mainMarket} options={markets} onChange={(value) => updateProfile("mainMarket", value)} />
            <SelectField label="Account Type" value={accountType} options={accountTypeOptions} onChange={(value) => updateProfile("accountType", value)} />
            <SelectField label="Platform" value={profile.fundedPlatform} options={fundedPlatforms} onChange={(value) => updateProfile("fundedPlatform", value)} />
            <Field label="Account Size" type="number" value={profile.accountSize} onChange={(value) => updateProfile("accountSize", value)} />
            <Field label="Starting Balance" type="number" value={profile.startingBalance} onChange={(value) => updateProfile("startingBalance", value)} />
          </div>
        ) : null}
        {settingsTab === "General" ? (
          <div style={styles.subPanel}>
            <p style={styles.cardLabel}>TradingView Integration</p>
            <label style={styles.switchRow}>
              <input
                type="checkbox"
                checked={profile.autoSwitchSymbol !== false}
                onChange={(event) => updateProfile("autoSwitchSymbol", event.target.checked)}
              />
              Auto-switch chart to latest TradingView symbol
            </label>
            <p style={{ ...styles.muted, fontSize: "12px", margin: "2px 0 0 24px" }}>
              When enabled, the active market updates automatically when TradingView sends a signal for a different symbol.
            </p>
          </div>
        ) : null}
        {settingsTab === "Advanced" ? (
          <div style={styles.warningStack}>
            <p style={styles.cardLabel}>Developer</p>
            <label style={styles.switchRow}>
              <input
                type="checkbox"
                checked={Boolean(debugMode)}
                onChange={(event) => setDebugMode?.(event.target.checked)}
              />
              Debug Mode (shows TradingView Signal Debug panel on dashboard)
            </label>
            <p style={{ ...styles.muted, fontSize: "12px", margin: "4px 0 0" }}>
              Tip: press <strong style={{ color: "#e2e8f0" }}>Shift + D</strong> anywhere to toggle Debug Mode.
            </p>
          </div>
        ) : null}
        {settingsTab === "Risk Guardrails" ? (
          <div style={styles.formGrid}>
            <Field label="Max Risk Per Trade" type="number" value={profile.maxRiskPerTrade} onChange={(value) => updateProfile("maxRiskPerTrade", value)} />
            <Field label="Max Trades Per Day" type="number" value={profile.maxTradesPerDay} onChange={(value) => updateProfile("maxTradesPerDay", value)} />
            <Field label="Max Contracts" type="number" value={profile.maxContracts} onChange={(value) => updateProfile("maxContracts", value)} />
            {isFunded ? <Field label="Max Daily Loss" type="number" value={profile.maxDailyLoss} onChange={(value) => updateProfile("maxDailyLoss", value)} /> : null}
          </div>
        ) : null}
        {settingsTab === "Funded Account" ? (
          isFunded ? (
            <>
              <p style={styles.cardLabel}>Prop Firm Rules</p>
              <div style={styles.formGrid}>
                <SelectField label="Funded Provider" value={profile.fundedProvider} options={fundedProviders} onChange={(value) => updateProfile("fundedProvider", value)} />
                <SelectField label="Account Phase" value={profile.accountPhase} options={["evaluation", "funded", "live"]} onChange={(value) => updateProfile("accountPhase", value)} />
                <Field label="Account Size" type="number" value={profile.accountSize} onChange={(value) => updateProfile("accountSize", value)} />
                <Field label="Starting Balance" type="number" value={profile.startingBalance} onChange={(value) => updateProfile("startingBalance", value)} />
                <Field label="Trailing Drawdown" type="number" value={profile.trailingDrawdown} onChange={(value) => updateProfile("trailingDrawdown", value)} />
                <Field label="Profit Goal" type="number" value={profile.profitGoal} onChange={(value) => updateProfile("profitGoal", value)} />
                <Field label="Consistency Rule Target %" type="number" value={profile.consistencyRuleTarget} onChange={(value) => updateProfile("consistencyRuleTarget", value)} />
                <Field label="Max Daily Loss" type="number" value={profile.maxDailyLoss} onChange={(value) => updateProfile("maxDailyLoss", value)} />
                <Field label="Max Contracts" type="number" value={profile.maxContracts} onChange={(value) => updateProfile("maxContracts", value)} />
              </div>
            </>
          ) : (
            <p style={styles.muted}>Switch Account Type to Funded / Prop Firm Account to track prop firm rules.</p>
          )
        ) : null}
        {settingsTab === "Trade Defaults" ? (
          <div style={styles.formGrid}>
            <Field label="Default Contracts" type="number" value={profile.defaultContracts} onChange={(value) => updateProfile("defaultContracts", value)} />
            <Field label="Default Risk Points" type="number" value={profile.defaultRiskPoints} onChange={(value) => updateProfile("defaultRiskPoints", value)} />
            <Field label="Trim 1 Points" type="number" value={profile.trim1Points} onChange={(value) => updateProfile("trim1Points", value)} />
            <Field label="Trim 2 Points" type="number" value={profile.trim2Points} onChange={(value) => updateProfile("trim2Points", value)} />
            <Field label="Runner Points" type="number" value={profile.runnerPoints} onChange={(value) => updateProfile("runnerPoints", value)} />
          </div>
        ) : null}
        {settingsTab === "Alerts" ? (
          <div style={styles.warningStack}>
            <p style={styles.muted}>Trade Pilot reduces noise by default. Price updates stay silent — only B+/A trade setups, connection events, TPs, and stops trigger toasts and sounds.</p>
            <label style={styles.switchRow}>
              <input
                type="checkbox"
                checked={notificationPrefs?.toast !== false}
                onChange={(event) => setNotificationPrefs?.((current) => ({ ...current, toast: event.target.checked }))}
              />
              Toast alerts on/off
            </label>
            <label style={styles.switchRow}>
              <input
                type="checkbox"
                checked={notificationPrefs?.sound !== false}
                onChange={(event) => setNotificationPrefs?.((current) => ({ ...current, sound: event.target.checked }))}
              />
              Sound alerts on/off
            </label>
            <label style={styles.switchRow}>
              <input
                type="checkbox"
                checked={notificationPrefs?.setupAlerts !== false}
                onChange={(event) => setNotificationPrefs?.((current) => ({ ...current, setupAlerts: event.target.checked }))}
              />
              Setup alerts (B+ / A) — recommended on
            </label>
            <label style={styles.switchRow}>
              <input
                type="checkbox"
                checked={notificationPrefs?.priceUpdateAlerts === true}
                onChange={(event) => setNotificationPrefs?.((current) => ({ ...current, priceUpdateAlerts: event.target.checked }))}
              />
              Price update alerts (off by default — chart still updates silently)
            </label>
            <hr style={{ borderColor: "#1e293b", margin: "12px 0" }} />
            <label style={styles.switchRow}>
              <input type="checkbox" checked={profile.voiceAlerts} onChange={(event) => updateProfile("voiceAlerts", event.target.checked)} />
              Voice alerts on/off (legacy)
            </label>
          </div>
        ) : null}
      </section>
      <DataSourcePage applyAlert={applyAlert} />
      <section style={styles.card}>
        <p style={styles.cardLabel}>Future Compatibility</p>
        <h2 style={styles.sectionTitle}>Planned Infrastructure</h2>
        <PlanItem title="User Login" text="Reserved for future account identity and syncing." />
        <PlanItem title="Supabase Authentication" text="Can be added later without changing the local dashboard model." />
        <PlanItem title="Paid Subscriptions" text="Subscription gates can wrap premium pages and advanced analytics." />
        <PlanItem title="TradingView Alerts" text="The current alert message is structured for server-side alert handling." />
        <PlanItem title="Broker Data Connections" text="Connections should remain read-only until safety, compliance, and user controls are complete." />
      </section>
    </main>
  );
}

function FeedbackModal({ onClose, onSubmit }) {
  const [feedback, setFeedback] = useState({ type: "Idea", message: "" });

  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.cardLabel}>Feedback</p>
            <h2 style={styles.sectionTitle}>Help Improve Trade Pilot</h2>
          </div>
          <button onClick={onClose} style={styles.closeButton}>Close</button>
        </div>
        <div style={styles.formGrid}>
          <SelectField label="Type" value={feedback.type} options={["Idea", "Bug", "Confusing", "Feature Request"]} onChange={(value) => setFeedback((current) => ({ ...current, type: value }))} />
        </div>
        <label style={{ ...styles.field, marginTop: "14px" }}>
          <span>Feedback</span>
          <textarea style={styles.textArea} value={feedback.message} onChange={(event) => setFeedback((current) => ({ ...current, message: event.target.value }))} />
        </label>
        <button onClick={() => feedback.message.trim() && onSubmit(feedback)} style={styles.settingsButton}>Send Feedback</button>
      </div>
    </div>
  );
}

function SourceOption({ title, text, active }) {
  return (
    <div style={{ ...styles.sourceOption, borderColor: active ? "#38bdf8" : "#27272a" }}>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function QAChecklistPage({ activeTrade, brokerConnection, dataSource, isSupabaseReady, layoutPrefs, plannedTrade, profile, webhookDebug }) {
  const checks = [
    ["Supabase connected", isSupabaseReady],
    ["Auth infrastructure ready", Boolean(isSupabaseConfigured)],
    ["Webhook latest signal received", webhookDebug?.received === "Yes"],
    ["Demo broker works", brokerConnection?.platform === "Demo Broker" || dataSource === "Demo Broker"],
    ["Manual mode works", dataSource === "Manual Mode"],
    ["TradingView mode works", dataSource === "TradingView Webhook" && brokerConnection?.connectionStatus === "TradingView feed active"],
    ["Layout saved", Boolean(layoutPrefs?.mode)],
    ["Sound enabled", profile.soundAlerts !== false],
    ["Active trade detected", Boolean(activeTrade?.isActive)],
    ["Plan validation passed", plannedTrade ? validateTradePlan(plannedTrade).valid : false],
  ];
  return (
    <section style={styles.pageSection}>
      <PageTitle title="QA Checklist" subtitle="Alpha readiness checks for Trade Pilot." />
      <div style={styles.card}>
        <p style={styles.cardLabel}>Dev Mode</p>
        <div style={styles.warningStack}>
          {checks.map(([label, passed]) => (
            <div key={label} style={passed ? styles.coachPrompt : styles.warningBox}>
              {passed ? "Pass" : "Check"} - {label}
            </div>
          ))}
        </div>
        <p style={{ ...styles.muted, marginTop: "14px" }}>Run this before alpha pushes: demo/manual/TradingView, layout, active trade detection, and plan validation should all be checked.</p>
      </div>
    </section>
  );
}

function AlphaSignup() {
  const [form, setForm] = useState({ email: "", market: "MNQ", traderType: "intermediate" });
  const [status, setStatus] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    const email = form.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("Enter a valid email.");
      return;
    }

    const payload = { ...form, email, timestamp: new Date().toISOString() };

    if (isLocalDevHost()) {
      try {
        const response = await fetch(`${marketServerUrl}/api/subscribe`, {
          body: JSON.stringify(payload),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        if (!response.ok) throw new Error("Subscriber endpoint unavailable.");
      } catch (error) {
        console.warn("[TradePilot] subscribe →", `${marketServerUrl}/api/subscribe`, "→", error?.message || "fetch error");
        const saved = loadList(subscriberStorageKey);
        localStorage.setItem(subscriberStorageKey, JSON.stringify([payload, ...saved]));
      }
    } else {
      const saved = loadList(subscriberStorageKey);
      localStorage.setItem(subscriberStorageKey, JSON.stringify([payload, ...saved]));
    }

    setForm((current) => ({ ...current, email: "" }));
    setStatus("You're on the Trade Pilot alpha list.");
  };

  return (
    <section style={styles.signupSection}>
      <div>
        <p style={styles.cardLabel}>Early Access</p>
        <h2 style={styles.sectionTitle}>Join the Trade Pilot alpha list.</h2>
      </div>
      <form onSubmit={submit} style={styles.signupForm}>
        <input
          aria-label="Email"
          placeholder="email@example.com"
          value={form.email}
          onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          style={styles.fieldInput}
        />
        <select value={form.traderType} onChange={(event) => setForm((current) => ({ ...current, traderType: event.target.value }))} style={styles.fieldInput}>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
        <select value={form.market} onChange={(event) => setForm((current) => ({ ...current, market: event.target.value }))} style={styles.fieldInput}>
          {["MNQ", "NQ", "ES", "options", "crypto", "other"].map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <button style={styles.settingsButton}>Join Alpha</button>
      </form>
      {status ? <p style={styles.signupStatus}>{status}</p> : null}
    </section>
  );
}

function AppFooter() {
  return (
    <footer style={styles.footer}>
      <span>Not financial advice.</span>
      <span>Trading involves risk.</span>
      <a href="mailto:support@tradepilottool.com" style={styles.footerLink}>support@tradepilottool.com</a>
      <span>Privacy Policy placeholder</span>
      <span>Terms placeholder</span>
    </footer>
  );
}

function PlanItem({ title, text }) {
  return (
    <div style={styles.planItem}>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function SettingsModal({ profile, updateProfile, onClose }) {
  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.cardLabel}>Profile Settings</p>
            <h2 style={styles.sectionTitle}>Trading Profile</h2>
          </div>
          <button onClick={onClose} style={styles.closeButton}>Close</button>
        </div>

        <div style={styles.formGrid}>
          <Field label="Trader Name" value={profile.traderName} onChange={(value) => updateProfile("traderName", value)} />
          <Field label="Account Size" type="number" value={profile.accountSize} onChange={(value) => updateProfile("accountSize", value)} />
          <SelectField label="Account Type" value={profile.accountType} options={accountTypeOptions} onChange={(value) => updateProfile("accountType", value)} />
          <SelectField label="Main Market" value={profile.mainMarket} options={markets} onChange={(value) => updateProfile("mainMarket", value)} />
          <SelectField label="Trader Style" value={profile.traderStyle} options={["scalper", "runner", "both"]} onChange={(value) => updateProfile("traderStyle", value)} />
          <Field label="Max Daily Loss" type="number" value={profile.maxDailyLoss} onChange={(value) => updateProfile("maxDailyLoss", value)} />
          <Field label="Max Trades Per Day" type="number" value={profile.maxTradesPerDay} onChange={(value) => updateProfile("maxTradesPerDay", value)} />
          <Field label="Default Contracts" type="number" value={profile.defaultContracts} onChange={(value) => updateProfile("defaultContracts", value)} />
          <Field label="Default Risk Points" type="number" value={profile.defaultRiskPoints} onChange={(value) => updateProfile("defaultRiskPoints", value)} />
        </div>
      </div>
    </div>
  );
}

function Control({ label, tooltip, value, setValue, min, max, step = 0.25, disabled = false }) {
  return (
    <div style={styles.control}>
      <div style={styles.controlTop}>
        <span style={styles.labelWithHelp}>
          {label}
          {tooltip ? <HelpTip text={tooltip} /> : null}
        </span>
        <input type="number" value={value} step={step} disabled={disabled} onChange={(event) => setValue(Number(event.target.value))} style={{ ...styles.numberInput, opacity: disabled ? 0.55 : 1 }} />
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => setValue(Number(event.target.value))} style={{ ...styles.range, opacity: disabled ? 0.55 : 1 }} />
    </div>
  );
}

function HelpTip({ text }) {
  const [open, setOpen] = useState(false);

  return (
    <span style={styles.helpWrap}>
      <button
        type="button"
        aria-label="Show help"
        onClick={() => setOpen((current) => !current)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        style={styles.helpButton}
      >
        ?
      </button>
      {open ? <span style={styles.tooltip}>{text}</span> : null}
    </span>
  );
}

function Metric({ label, value, tone = "neutral", tooltip }) {
  const color = tone === "good" ? "#86efac" : tone === "bad" ? "#fca5a5" : tone === "warn" ? "#fde68a" : "#f8fafc";

  return (
    <div style={styles.metric}>
      <p style={styles.metricLabel}>
        <span style={styles.labelWithHelp}>
          {label}
          {tooltip ? <HelpTip text={tooltip} /> : null}
        </span>
      </p>
      <p style={{ ...styles.metricValue, color }}>{value}</p>
    </div>
  );
}

function CoachLine({ label, value, tone = "neutral", muted = false }) {
  const valueColor = tone === "good" ? "#86efac" : tone === "warn" ? "#fde68a" : tone === "bad" ? "#fca5a5" : muted ? "#cbd5e1" : "#f8fafc";
  return (
    <div style={{ alignItems: "baseline", display: "grid", gap: "12px", gridTemplateColumns: "92px 1fr" }}>
      <span style={{ color: "#94a3b8", fontSize: "11px", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</span>
      <span style={{ color: valueColor, fontSize: muted ? "13px" : "14px", fontWeight: muted ? 600 : 800, lineHeight: 1.4 }}>{value}</span>
    </div>
  );
}

function ScoreRow({ label, value }) {
  return (
    <div style={styles.scoreRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label style={styles.field}>
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(type === "number" ? Number(event.target.value) : event.target.value)} style={styles.fieldInput} />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label style={styles.field}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={styles.fieldInput}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

// Searchable market selector with category tabs and custom entry.
function MarketSelector({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [custom, setCustom] = useState("");
  const dropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) { setOpen(false); setSearch(""); } };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const catColors = { futures: "#3b82f6", stock: "#10b981", crypto: "#f59e0b", forex: "#8b5cf6" };
  const cat = getMarketCategory(value);
  const catColor = catColors[cat] || "#64748b";

  const allSymbols = [...new Set([
    ...Object.keys(marketDefaults),
    ...Object.values(MARKET_CATEGORIES).flatMap((c) => c.symbols),
  ])];

  const inTab = (sym) => {
    if (tab === "all") return true;
    return getMarketCategory(sym) === tab;
  };
  const filtered = allSymbols.filter((s) => inTab(s) && (!search || s.toLowerCase().includes(search.toLowerCase())));

  const select = (sym) => { onChange(sym.toUpperCase()); setOpen(false); setSearch(""); setCustom(""); };

  const addCustom = () => { const s = custom.trim().toUpperCase(); if (s) select(s); };

  const tabList = [["all", "All"], ["futures", "Futures"], ["stock", "Stocks"], ["crypto", "Crypto"], ["forex", "Forex"]];

  return (
    <div ref={dropRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          alignItems: "center", background: "#09090b", border: `1px solid ${catColor}55`,
          borderRadius: "10px", color: "#f8fafc", cursor: "pointer", display: "flex",
          fontSize: "15px", fontWeight: 800, gap: "8px", padding: "7px 14px",
        }}
      >
        <span style={{ background: `${catColor}20`, borderRadius: "4px", color: catColor, fontSize: "9px", fontWeight: 900, letterSpacing: "0.08em", padding: "2px 5px", textTransform: "uppercase" }}>{cat}</span>
        {value}
        <span style={{ color: "#64748b", fontSize: "10px" }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div style={{
          background: "#0a0f1e", border: "1px solid #1e293b", borderRadius: "14px",
          boxShadow: "0 24px 64px rgba(0,0,0,.7)", left: 0, minWidth: "280px", maxWidth: "320px",
          padding: "12px", position: "absolute", top: "calc(100% + 6px)", zIndex: 2000,
        }}>
          <input
            autoFocus
            placeholder="Search market…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { if (filtered.length === 1) select(filtered[0]); else if (search) select(search); }
              if (e.key === "Escape") { setOpen(false); setSearch(""); }
            }}
            style={{
              background: "#1e293b", border: "1px solid #334155", borderRadius: "7px",
              color: "#f8fafc", fontSize: "13px", outline: "none", padding: "8px 11px", width: "100%",
              boxSizing: "border-box",
            }}
          />

          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", margin: "8px 0" }}>
            {tabList.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  background: tab === key ? "#1e3a8a" : "#1e293b",
                  border: "none", borderRadius: "5px",
                  color: tab === key ? "#93c5fd" : "#64748b",
                  cursor: "pointer", fontSize: "11px", fontWeight: 700, padding: "3px 8px",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "5px", maxHeight: "190px", overflowY: "auto" }}>
            {filtered.map((sym) => {
              const isCur = sym === value;
              const scat = getMarketCategory(sym);
              const scol = catColors[scat] || "#64748b";
              return (
                <button
                  key={sym}
                  onClick={() => select(sym)}
                  style={{
                    background: isCur ? "#1e3a8a" : "#111827",
                    border: `1px solid ${isCur ? "#3b82f6" : scol + "30"}`,
                    borderRadius: "7px", color: isCur ? "#93c5fd" : "#e2e8f0",
                    cursor: "pointer", fontSize: "12px", fontWeight: 700, padding: "4px 10px",
                  }}
                >
                  {sym}
                </button>
              );
            })}
            {!filtered.length && search && (
              <button
                onClick={() => select(search)}
                style={{
                  background: "#111827", border: "1px solid #334155", borderRadius: "7px",
                  color: "#94a3b8", cursor: "pointer", fontSize: "12px", padding: "4px 10px", width: "100%",
                }}
              >
                Use &quot;{search.toUpperCase()}&quot;
              </button>
            )}
          </div>

          <div style={{ borderTop: "1px solid #1e293b", display: "flex", gap: "6px", marginTop: "10px", paddingTop: "10px" }}>
            <input
              placeholder="Custom symbol (e.g. AAPL)…"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustom()}
              style={{
                background: "#1e293b", border: "1px solid #334155", borderRadius: "6px",
                boxSizing: "border-box", color: "#f8fafc", flex: 1, fontSize: "12px",
                outline: "none", padding: "6px 9px",
              }}
            />
            <button
              onClick={addCustom}
              style={{
                background: "#1e40af", border: "none", borderRadius: "6px", color: "#93c5fd",
                cursor: "pointer", fontSize: "12px", fontWeight: 700, padding: "6px 12px",
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(circle at top left, #172554 0, #050505 34%, #09090b 100%)",
    color: "#f8fafc",
    fontFamily: "Inter, Arial, sans-serif",
    padding: 0,
    width: "100%",
  },
  shell: {
    boxSizing: "border-box",
    margin: 0,
    maxWidth: "none",
    padding: 0,
    width: "100%",
  },
  standaloneMain: {
    width: "100%",
  },
  desktopDashboard: {
    alignItems: "start",
    display: "grid",
    gap: "20px",
    gridTemplateColumns: "240px minmax(0, 1fr) 320px",
    width: "100%",
  },
  dashboardMain: {
    display: "grid",
    gap: "18px",
    minWidth: 0,
    width: "100%",
  },
  leftSidebar: {
    background: "rgba(2, 6, 23, .82)",
    border: "1px solid #1e293b",
    borderRadius: "16px",
    display: "grid",
    gap: "16px",
    padding: "16px",
    position: "sticky",
    top: "20px",
  },
  sidebarBrand: {
    color: "#f8fafc",
    fontSize: "22px",
    fontWeight: 950,
    lineHeight: 1,
    padding: "8px 8px 4px",
  },
  sidebarNav: {
    display: "grid",
    gap: "6px",
  },
  sidebarButton: {
    border: "1px solid transparent",
    borderRadius: "10px",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 900,
    padding: "12px",
    textAlign: "left",
  },
  sidebarStreamerButton: {
    background: "#0e7490",
    border: "1px solid #38bdf8",
    borderRadius: "12px",
    color: "#ecfeff",
    cursor: "pointer",
    fontWeight: 950,
    padding: "12px",
  },
  rightPanel: {
    display: "grid",
    gap: "14px",
    minWidth: 0,
    position: "sticky",
    top: "20px",
  },
  insightCard: {
    background: "rgba(15, 23, 42, .78)",
    border: "1px solid rgba(148, 163, 184, .22)",
    borderRadius: "14px",
    display: "grid",
    gap: "10px",
    padding: "16px",
  },
  dashboardToolbar: {
    alignItems: "center",
    display: "flex",
    gap: "12px",
    justifyContent: "space-between",
    marginBottom: "16px",
    flexWrap: "wrap",
  },
  subPanel: {
    background: "rgba(2, 6, 23, .42)",
    border: "1px solid rgba(148, 163, 184, .18)",
    borderRadius: "14px",
    marginTop: "16px",
    padding: "16px",
  },
  toggleList: {
    display: "grid",
    gap: "8px",
  },
  compactSwitchRow: {
    alignItems: "center",
    color: "#e5e7eb",
    display: "flex",
    fontSize: "13px",
    fontWeight: 800,
    gap: "8px",
  },
  header: {
    alignItems: "center",
    background: "rgba(2, 6, 23, .92)",
    borderBottom: "1px solid #1e293b",
    display: "flex",
    gap: "18px",
    justifyContent: "space-between",
    marginBottom: 0,
    minHeight: "74px",
    padding: "12px 18px",
    position: "relative",
    flexWrap: "wrap",
  },
  headerBrand: {
    maxWidth: "760px",
    textAlign: "left",
  },
  headerMeta: {
    color: "#cbd5e1",
    display: "flex",
    flexWrap: "wrap",
    fontSize: "12px",
    fontWeight: 900,
    gap: "8px",
    justifyContent: "center",
    marginTop: "10px",
  },
  topActions: {
    alignItems: "center",
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 20,
  },
  menuButton: {
    alignItems: "center",
    background: "rgba(15, 23, 42, .96)",
    border: "1px solid rgba(148, 163, 184, .36)",
    borderRadius: "12px",
    boxShadow: "0 12px 30px rgba(0,0,0,.28)",
    cursor: "pointer",
    display: "inline-flex",
    flexDirection: "column",
    gap: "4px",
    height: "48px",
    justifyContent: "center",
    minHeight: "48px",
    minWidth: "48px",
    padding: 0,
    pointerEvents: "auto",
    position: "relative",
    touchAction: "manipulation",
    width: "48px",
    zIndex: 9999,
  },
  menuBar: {
    background: "#e2e8f0",
    borderRadius: "999px",
    display: "block",
    height: "2px",
    width: "18px",
  },
  authActions: {
    alignItems: "center",
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  accountPill: {
    background: "#020617",
    border: "1px solid #334155",
    borderRadius: "999px",
    color: "#dbeafe",
    fontSize: "12px",
    fontWeight: 900,
    maxWidth: "240px",
    overflow: "hidden",
    padding: "9px 12px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  authButton: {
    background: "#0f172a",
    border: "1px solid #38bdf8",
    borderRadius: "10px",
    color: "#e0f2fe",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 900,
    padding: "10px 12px",
  },
  streamerToggle: {
    alignItems: "center",
    background: "#020617",
    border: "1px solid #334155",
    borderRadius: "12px",
    color: "#e5e7eb",
    cursor: "pointer",
    display: "flex",
    fontSize: "13px",
    fontWeight: 900,
    gap: "8px",
    padding: "10px 12px",
  },
  moreWrap: {
    position: "relative",
    zIndex: 30,
  },
  moreMenu: {
    background: "rgba(2, 6, 23, .98)",
    border: "1px solid #334155",
    borderRadius: "14px",
    boxShadow: "0 22px 60px rgba(0,0,0,.36)",
    display: "grid",
    gap: "6px",
    minWidth: "210px",
    padding: "10px",
    position: "absolute",
    right: 0,
    top: "calc(100% + 8px)",
    zIndex: 40,
  },
  mobileOverlay: {
    background: "rgba(0,0,0,.6)",
    border: "none",
    cursor: "pointer",
    inset: 0,
    padding: 0,
    position: "fixed",
    zIndex: 9999,
  },
  drawerAuthSection: {
    borderBottom: "1px solid #1e293b",
    display: "grid",
    gap: "6px",
    paddingBottom: "12px",
  },
  drawerUserPill: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "8px",
    color: "#94a3b8",
    fontSize: "12px",
    overflow: "hidden",
    padding: "8px 12px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  drawerDivider: {
    background: "#1e293b",
    border: "none",
    height: "1px",
    margin: "4px 0",
  },
  moreMenuItem: {
    background: "transparent",
    border: "none",
    borderRadius: "10px",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 900,
    padding: "10px 12px",
    textAlign: "left",
  },
  moreToggle: {
    alignItems: "center",
    borderTop: "1px solid #1e293b",
    color: "#e5e7eb",
    cursor: "pointer",
    display: "flex",
    fontWeight: 900,
    gap: "8px",
    marginTop: "4px",
    padding: "12px",
  },
  riskBanner: {
    background: "rgba(120, 53, 15, .35)",
    border: "1px solid rgba(161, 98, 7, .45)",
    borderRadius: "10px",
    color: "#fde68a",
    fontSize: "12px",
    fontWeight: 800,
    marginBottom: "10px",
    padding: "7px 10px",
  },
  alphaBanner: {
    background: "rgba(14, 165, 233, .12)",
    border: "1px solid rgba(56, 189, 248, .28)",
    borderRadius: "10px",
    color: "#bae6fd",
    fontSize: "13px",
    fontWeight: 800,
    marginBottom: "8px",
    padding: "8px 10px",
  },
  guestPrompt: {
    alignItems: "center",
    background: "rgba(8, 47, 73, .72)",
    border: "1px solid rgba(14, 116, 144, .85)",
    borderRadius: "12px",
    color: "#cffafe",
    display: "flex",
    flexWrap: "wrap",
    fontSize: "13px",
    fontWeight: 900,
    gap: "12px",
    justifyContent: "space-between",
    marginBottom: "12px",
    padding: "10px 12px",
  },
  onboardingCard: {
    alignItems: "center",
    background: "rgba(15, 23, 42, .94)",
    border: "1px solid #334155",
    borderRadius: "16px",
    display: "grid",
    gap: "14px",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    marginBottom: "16px",
    maxWidth: "100%",
    padding: "18px",
    width: "100%",
  },
  onboardingSteps: {
    color: "#e5e7eb",
    display: "grid",
    gap: "8px",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  },
  installBanner: {
    alignItems: "center",
    background: "rgba(15, 23, 42, .85)",
    border: "1px solid rgba(56, 189, 248, .45)",
    borderRadius: "10px",
    display: "flex",
    fontSize: "13px",
    gap: "10px",
    justifyContent: "space-between",
    marginBottom: "12px",
    maxWidth: "100%",
    padding: "8px 14px",
    flexWrap: "wrap",
    width: "100%",
  },
  installBannerText: {
    color: "#a1a1aa",
    fontSize: "13px",
    margin: "4px 0 0",
  },
  installBannerActions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  },
  installButton: {
    background: "#2563eb",
    border: "1px solid #3b82f6",
    borderRadius: "12px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 900,
    padding: "11px 14px",
  },
  dismissButton: {
    background: "#111827",
    border: "1px solid #334155",
    borderRadius: "12px",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 800,
    padding: "11px 14px",
  },
  installPage: {
    display: "grid",
    gap: "16px",
  },
  pageTitle: {
    background: "rgba(15, 23, 42, .78)",
    border: "1px solid rgba(51, 65, 85, .9)",
    borderRadius: "16px",
    marginBottom: "16px",
    padding: "20px",
    textAlign: "left",
  },
  breadcrumb: {
    color: "#7dd3fc",
    fontSize: "12px",
    fontWeight: 900,
    letterSpacing: "0.08em",
    margin: "0 0 8px",
    textTransform: "uppercase",
  },
  pageTitleText: {
    color: "#f8fafc",
    fontSize: "30px",
    lineHeight: 1.1,
    margin: 0,
  },
  pageSubtitle: {
    color: "#a1a1aa",
    fontSize: "15px",
    margin: "8px 0 0",
  },
  fullWidthSection: {
    gridColumn: "1 / -1",
  },
  homePage: {
    display: "grid",
    gap: "24px",
  },
  homeHero: {
    alignItems: "start",
    background: "linear-gradient(135deg, rgba(15, 23, 42, .96), rgba(8, 47, 73, .78))",
    border: "1px solid rgba(56, 189, 248, .35)",
    borderRadius: "22px",
    display: "grid",
    minHeight: "320px",
    padding: "48px",
    textAlign: "left",
  },
  homeTitle: {
    fontSize: "clamp(42px, 7vw, 82px)",
    lineHeight: 1,
    margin: "0 0 18px",
    maxWidth: "none",
  },
  homeSubtitle: {
    color: "#cbd5e1",
    fontSize: "clamp(18px, 2vw, 24px)",
    lineHeight: 1.45,
    margin: "0 0 28px",
  },
  heroActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
  },
  primaryHeroButton: {
    background: "#f8fafc",
    border: "none",
    borderRadius: "14px",
    color: "#020617",
    cursor: "pointer",
    fontSize: "18px",
    fontWeight: 950,
    minHeight: "58px",
    padding: "16px 24px",
  },
  secondaryHeroButton: {
    background: "rgba(14, 165, 233, .14)",
    border: "1px solid #38bdf8",
    borderRadius: "14px",
    color: "#e0f2fe",
    cursor: "pointer",
    fontSize: "18px",
    fontWeight: 950,
    minHeight: "58px",
    padding: "16px 24px",
  },
  productCardGrid: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  },
  softFeatureCard: {
    background: "rgba(15, 23, 42, .76)",
    border: "1px solid rgba(148, 163, 184, .25)",
    borderRadius: "18px",
    padding: "22px",
  },
  featureTitle: {
    fontSize: "20px",
    margin: "0 0 10px",
  },
  installHero: {
    alignItems: "center",
    background: "linear-gradient(135deg, rgba(15, 23, 42, .98), rgba(2, 6, 23, .96))",
    border: "1px solid #334155",
    borderRadius: "18px",
    display: "grid",
    gap: "22px",
    gridTemplateColumns: "120px 1fr",
    padding: "24px",
  },
  installIconWrap: {
    background: "#050505",
    border: "1px solid #334155",
    borderRadius: "26px",
    padding: "12px",
  },
  installIcon: {
    display: "block",
    height: "96px",
    width: "96px",
  },
  eyebrow: {
    color: "#38bdf8",
    fontSize: "12px",
    fontWeight: 800,
    letterSpacing: "0.12em",
    margin: "0 0 8px",
    textTransform: "uppercase",
  },
  title: {
    fontSize: "46px",
    fontWeight: 950,
    lineHeight: 1,
    margin: 0,
  },
  subtitle: {
    color: "#a1a1aa",
    fontSize: "16px",
    margin: "8px 0 0",
  },
  positioningText: {
    color: "#7dd3fc",
    fontSize: "13px",
    fontWeight: 800,
    margin: "6px 0 0",
  },
  settingsButton: {
    background: "#2563eb",
    border: "1px solid #3b82f6",
    borderRadius: "12px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    padding: "12px 18px",
  },
  inlineActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "16px",
  },
  textButton: {
    background: "transparent",
    border: "none",
    color: "#7dd3fc",
    cursor: "pointer",
    fontWeight: 900,
    padding: 0,
  },
  feedbackButton: {
    background: "#0ea5e9",
    border: "1px solid #38bdf8",
    borderRadius: "999px",
    bottom: "14px",
    boxShadow: "0 10px 24px rgba(0,0,0,.28)",
    color: "#00111f",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 900,
    padding: "8px 11px",
    position: "fixed",
    right: "14px",
    zIndex: 15,
  },
  toast: {
    background: "#0f172a",
    border: "1px solid #38bdf8",
    borderRadius: "12px",
    bottom: "64px",
    boxShadow: "0 18px 45px rgba(0,0,0,.35)",
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: 900,
    padding: "12px 14px",
    position: "fixed",
    right: "14px",
    zIndex: 50,
  },
  link: {
    color: "#7dd3fc",
    fontWeight: 800,
  },
  secondaryButton: {
    background: "#1f2937",
    border: "1px solid #3f3f46",
    borderRadius: "12px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    padding: "12px 16px",
  },
  heroGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "16px",
    marginBottom: "16px",
  },
  alphaTopGrid: {
    display: "grid",
    gap: "22px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
    marginBottom: "22px",
  },
  alphaMiddleGrid: {
    display: "grid",
    gap: "22px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
    marginBottom: "22px",
  },
  dashboardGrid: {
    display: "grid",
    gap: "24px",
    gridTemplateColumns: "minmax(420px, 0.95fr) minmax(520px, 1.35fr)",
    alignItems: "start",
    marginBottom: "24px",
    width: "100%",
  },
  mobileStatusBar: {
    background: "rgba(15, 23, 42, .9)",
    border: "1px solid #243b55",
    borderRadius: "14px",
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    marginBottom: "14px",
    padding: "12px",
    width: "100%",
  },
  dashboardCardBoard: {
    alignItems: "start",
    display: "grid",
    gap: "22px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
    marginBottom: "22px",
    width: "100%",
  },
  dashboardCardSlot: {
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  draggableCardRow: {
    alignItems: "center",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "12px",
    color: "#e5e7eb",
    cursor: "grab",
    display: "flex",
    fontWeight: 800,
    justifyContent: "space-between",
    gap: "12px",
    padding: "10px 12px",
  },
  miniButton: {
    background: "#1f2937",
    border: "1px solid #334155",
    borderRadius: "9px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 800,
    padding: "7px 9px",
  },
  rulesCard: {
    background: "rgba(15, 23, 42, .76)",
    border: "1px solid rgba(148, 163, 184, .24)",
    borderRadius: "18px",
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "minmax(220px, .45fr) 1fr",
    marginBottom: "16px",
    padding: "18px",
  },
  rulesGrid: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
  },
  tradePlanHero: {
    background: "rgba(15, 23, 42, .82)",
    border: "1px solid rgba(148, 163, 184, .24)",
    borderRadius: "18px",
    boxShadow: "0 16px 38px rgba(0,0,0,.24)",
    padding: "26px",
  },
  tradePlanTitle: {
    fontSize: "34px",
    lineHeight: 1,
    margin: "0 0 18px",
  },
  planMetricGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
  },
  emptyPlan: {
    color: "#d4d4d8",
    fontSize: "20px",
    fontWeight: 800,
    lineHeight: 1.35,
    margin: 0,
  },
  coachGrid: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    marginBottom: "14px",
  },
  segmentGroup: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
    marginBottom: "12px",
  },
  segmentButton: {
    border: "1px solid #334155",
    borderRadius: "12px",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
    minHeight: "46px",
    padding: "10px",
  },
  generateButton: {
    background: "#2563eb",
    border: "1px solid #3b82f6",
    borderRadius: "14px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "17px",
    fontWeight: 950,
    marginBottom: "12px",
    minHeight: "56px",
    padding: "14px",
    width: "100%",
  },
  advancedToggle: {
    background: "#111827",
    border: "1px solid #334155",
    borderRadius: "14px",
    color: "#e5e7eb",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: 900,
    marginBottom: "16px",
    padding: "13px 16px",
    width: "100%",
  },
  card: {
    background: "rgba(24, 24, 27, .76)",
    border: "1px solid rgba(148, 163, 184, .2)",
    borderRadius: "18px",
    boxShadow: "0 14px 34px rgba(0,0,0,.22)",
    padding: "24px",
  },
  chartPanel: {
    background: "rgba(13, 17, 23, .96)",
    border: "1px solid rgba(110, 122, 145, .35)",
    borderRadius: "16px",
    marginBottom: "22px",
    minHeight: "420px",
    padding: "18px 18px 22px",
    width: "100%",
  },
  chartToolbar: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    justifyContent: "space-between",
    marginBottom: "12px",
  },
  chartTimeframeGroup: {
    background: "rgba(15, 23, 42, .55)",
    border: "1px solid rgba(110, 122, 145, .25)",
    borderRadius: "999px",
    display: "inline-flex",
    gap: "2px",
    padding: "3px",
  },
  chartTimeframeButton: {
    border: "none",
    borderRadius: "999px",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: ".02em",
    padding: "5px 10px",
    transition: "background 120ms ease, color 120ms ease",
  },
  chartActionGroup: {
    alignItems: "center",
    display: "inline-flex",
    gap: "6px",
  },
  chartActionButton: {
    background: "transparent",
    border: "1px solid rgba(110, 122, 145, .25)",
    borderRadius: "999px",
    color: "#94a3b8",
    cursor: "pointer",
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: ".02em",
    padding: "5px 12px",
  },
  chartZoneNote: {
    color: "#64748b",
    fontSize: "12px",
    fontStyle: "italic",
    margin: "0 0 12px",
    padding: "0 4px",
  },
  chartWrap: {
    height: "480px",
    minWidth: 0,
    width: "100%",
  },
  chartNote: {
    color: "#94a3b8",
    fontSize: "13px",
    fontWeight: 800,
    margin: "12px 0 0",
  },
  chartPrice: {
    color: "#facc15",
    fontSize: "28px",
  },
  livestreamPanel: {
    background: "linear-gradient(135deg, rgba(2,6,23,.98), rgba(8,47,73,.92))",
    border: "1px solid #38bdf8",
    borderRadius: "22px",
    display: "grid",
    gap: "24px",
    marginBottom: "22px",
    minHeight: "360px",
    padding: "clamp(26px, 5vw, 56px)",
    placeItems: "center",
    textAlign: "center",
  },
  liveHero: {
    display: "grid",
    gap: "8px",
    justifyItems: "center",
  },
  liveMarket: {
    color: "#bae6fd",
    fontSize: "28px",
    fontWeight: 950,
    margin: 0,
  },
  livePrice: {
    color: "#f8fafc",
    fontSize: "clamp(76px, 11vw, 160px)",
    lineHeight: 1,
    margin: 0,
  },
  liveSubline: {
    color: "#bae6fd",
    fontSize: "18px",
    fontWeight: 900,
    margin: "10px 0 0",
  },
  liveMetricGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    width: "100%",
  },
  liveCoach: {
    background: "#020617",
    border: "1px solid #0e7490",
    borderRadius: "12px",
    color: "#e0f2fe",
    fontSize: "24px",
    fontWeight: 900,
    lineHeight: 1.2,
    padding: "16px",
  },
  fastCard: {
    alignItems: "center",
    background: "rgba(2, 6, 23, .94)",
    border: "1px solid #1d4ed8",
    borderRadius: "16px",
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "minmax(240px, .8fr) 1.2fr",
    marginBottom: "16px",
    padding: "22px",
  },
  quickEntryCard: {
    alignItems: "center",
    background: "rgba(15, 23, 42, .76)",
    border: "1px solid rgba(148, 163, 184, .24)",
    borderRadius: "18px",
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "minmax(240px, .7fr) 1.3fr",
    marginBottom: "16px",
    padding: "22px",
  },
  marketTopBar: {
    alignItems: "end",
    background: "rgba(2, 6, 23, .82)",
    border: "1px solid #1e293b",
    borderRadius: "16px",
    display: "grid",
    gap: "14px",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    marginBottom: "16px",
    padding: "16px",
  },
  marketTopMetric: {
    background: "#09090b",
    border: "1px solid #27272a",
    borderRadius: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "11px 12px",
  },
  quickGrid: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  },
  sourceButton: {
    background: "rgba(15, 23, 42, .9)",
    border: "1px solid #334155",
    borderRadius: "12px",
    color: "#e5e7eb",
    cursor: "pointer",
    display: "grid",
    gap: "5px",
    padding: "14px",
    textAlign: "left",
  },
  quickButton: {
    border: "1px solid rgba(255,255,255,.16)",
    borderRadius: "14px",
    color: "white",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: 900,
    minHeight: "64px",
    padding: "12px",
  },
  missedEntry: {
    background: "#451a03",
    border: "1px solid #f59e0b",
    borderRadius: "14px",
    color: "#fde68a",
    fontSize: "18px",
    fontWeight: 900,
    marginBottom: "16px",
    padding: "16px",
  },
  marketSpecLine: {
    color: "#bae6fd",
    fontSize: "13px",
    fontWeight: 800,
    marginTop: "14px",
  },
  levelCoachGrid: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    marginBottom: "16px",
  },
  visualGrid: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    marginBottom: "16px",
  },
  productUpgradeGrid: {
    display: "grid",
    gap: "18px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
    marginBottom: "22px",
  },
  equityCurve: {
    alignItems: "end",
    background: "#020617",
    border: "1px solid #1e293b",
    borderRadius: "14px",
    display: "flex",
    gap: "8px",
    height: "180px",
    margin: "16px 0",
    padding: "14px",
  },
  equityBar: {
    borderRadius: "999px 999px 0 0",
    flex: 1,
    minWidth: "10px",
  },
  ladder: {
    background: "linear-gradient(180deg, rgba(15,23,42,.9), rgba(2,6,23,.95))",
    border: "1px solid #27272a",
    borderRadius: "14px",
    height: "340px",
    marginTop: "16px",
    overflow: "hidden",
    position: "relative",
  },
  ladderLevel: {
    alignItems: "center",
    borderTop: "2px solid",
    display: "flex",
    justifyContent: "space-between",
    left: "14px",
    paddingTop: "4px",
    position: "absolute",
    right: "14px",
  },
  rrTrack: {
    background: "#111827",
    border: "1px solid #27272a",
    borderRadius: "999px",
    display: "grid",
    gap: "6px",
    margin: "18px 0 10px",
    overflow: "hidden",
    padding: "6px",
  },
  rrRisk: {
    background: "#ef4444",
    borderRadius: "999px",
    height: "12px",
  },
  rrReward: {
    background: "#22c55e",
    borderRadius: "999px",
    height: "12px",
  },
  rrText: {
    color: "#f8fafc",
    fontSize: "22px",
    fontWeight: 900,
    margin: "10px 0",
  },
  sharePreview: {
    background: "#020617",
    border: "1px solid #27272a",
    borderRadius: "12px",
    color: "#dbeafe",
    fontFamily: "Consolas, monospace",
    fontSize: "13px",
    lineHeight: 1.5,
    overflow: "auto",
    padding: "14px",
    whiteSpace: "pre-wrap",
  },
  levelActionCard: {
    background: "linear-gradient(135deg, rgba(30, 64, 175, .9), rgba(8, 47, 73, .88))",
    border: "1px solid #38bdf8",
    borderRadius: "16px",
    boxShadow: "0 18px 45px rgba(0,0,0,.35)",
    padding: "22px",
  },
  actionText: {
    color: "#f8fafc",
    fontSize: "34px",
    fontWeight: 900,
    lineHeight: 1,
    margin: "0 0 14px",
  },
  biasCard: {
    background: "rgba(15, 23, 42, .95)",
    border: "1px solid #334155",
    borderRadius: "16px",
    padding: "24px",
  },
  scoreCard: {
    background: "rgba(24, 24, 27, .95)",
    border: "1px solid #27272a",
    borderRadius: "16px",
    padding: "24px",
  },
  coachCard: {
    background: "rgba(8, 47, 73, .72)",
    border: "1px solid rgba(34, 211, 238, .38)",
    borderRadius: "18px",
    padding: "28px",
  },
  safetyCard: {
    background: "rgba(69, 10, 10, .72)",
    border: "1px solid #991b1b",
    borderRadius: "16px",
    padding: "22px",
  },
  cardLabel: {
    color: "#a1a1aa",
    fontSize: "12px",
    fontWeight: 800,
    margin: "0 0 10px",
    textTransform: "uppercase",
  },
  biasText: {
    fontSize: "48px",
    fontWeight: 900,
    lineHeight: 1,
    marginBottom: "12px",
  },
  muted: {
    color: "#a1a1aa",
    lineHeight: 1.45,
    margin: 0,
  },
  scoreTop: {
    alignItems: "flex-start",
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
  },
  scoreText: {
    fontSize: "42px",
    lineHeight: 1,
    margin: 0,
  },
  confidencePill: {
    borderRadius: "999px",
    color: "white",
    fontSize: "13px",
    fontWeight: 900,
    padding: "8px 12px",
  },
  scoreTrack: {
    background: "#27272a",
    borderRadius: "999px",
    height: "14px",
    marginTop: "24px",
    overflow: "hidden",
  },
  scoreFill: {
    borderRadius: "999px",
    height: "100%",
  },
  coachMessage: {
    color: "#e0f2fe",
    fontSize: "24px",
    fontWeight: 800,
    lineHeight: 1.2,
    margin: "0 0 14px",
  },
  fastGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "10px",
  },
  fastButton: {
    background: "#1e3a8a",
    border: "1px solid #3b82f6",
    borderRadius: "14px",
    color: "white",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: 900,
    minHeight: "58px",
    padding: "12px",
  },
  mainGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
    gap: "22px",
  },
  sectionHeader: {
    alignItems: "center",
    display: "flex",
    gap: "14px",
    justifyContent: "space-between",
    marginBottom: "18px",
  },
  sectionTitle: {
    fontSize: "24px",
    margin: 0,
  },
  directionToggle: {
    display: "flex",
    gap: "8px",
  },
  toggleButton: {
    border: "1px solid #3f3f46",
    borderRadius: "10px",
    color: "white",
    cursor: "pointer",
    fontWeight: 800,
    padding: "10px 14px",
  },
  control: {
    marginBottom: "18px",
  },
  controlTop: {
    alignItems: "center",
    color: "#e4e4e7",
    display: "flex",
    fontSize: "14px",
    fontWeight: 700,
    justifyContent: "space-between",
    marginBottom: "8px",
    gap: "12px",
  },
  marketPanel: {
    background: "#09090b",
    border: "1px solid #27272a",
    borderRadius: "14px",
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    marginBottom: "14px",
    padding: "14px",
  },
  switchRow: {
    alignItems: "center",
    color: "#e4e4e7",
    display: "flex",
    fontSize: "14px",
    fontWeight: 800,
    gap: "10px",
    paddingTop: "24px",
  },
  dataStatus: {
    color: "#a1a1aa",
    display: "flex",
    flexWrap: "wrap",
    fontSize: "13px",
    gap: "12px",
    justifyContent: "space-between",
    marginBottom: "10px",
  },
  brokerStatusCard: {
    alignItems: "center",
    background: "#020617",
    border: "1px solid #1e293b",
    borderRadius: "12px",
    color: "#dbeafe",
    display: "flex",
    flexWrap: "wrap",
    fontSize: "13px",
    fontWeight: 800,
    gap: "10px",
    marginBottom: "12px",
    padding: "10px 12px",
  },
  statusPill: {
    borderRadius: "999px",
    color: "white",
    fontSize: "12px",
    fontWeight: 900,
    padding: "5px 9px",
  },
  priceTape: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    marginBottom: "12px",
  },
  priceWarning: {
    background: "#422006",
    border: "1px solid #a16207",
    borderRadius: "10px",
    color: "#fde68a",
    fontSize: "13px",
    fontWeight: 800,
    marginBottom: "12px",
    padding: "10px",
  },
  labelWithHelp: {
    alignItems: "center",
    display: "inline-flex",
    gap: "6px",
  },
  helpWrap: {
    display: "inline-flex",
    position: "relative",
  },
  helpButton: {
    alignItems: "center",
    background: "#27272a",
    border: "1px solid #3f3f46",
    borderRadius: "999px",
    color: "#e4e4e7",
    cursor: "pointer",
    display: "inline-flex",
    fontSize: "11px",
    fontWeight: 900,
    height: "18px",
    justifyContent: "center",
    lineHeight: 1,
    padding: 0,
    width: "18px",
  },
  tooltip: {
    background: "#020617",
    border: "1px solid #334155",
    borderRadius: "10px",
    boxShadow: "0 16px 35px rgba(0,0,0,.45)",
    color: "#f8fafc",
    fontSize: "13px",
    fontWeight: 600,
    left: "50%",
    lineHeight: 1.4,
    padding: "10px 12px",
    position: "absolute",
    top: "24px",
    transform: "translateX(-50%)",
    width: "230px",
    zIndex: 30,
  },
  numberInput: {
    background: "#09090b",
    border: "1px solid #3f3f46",
    borderRadius: "10px",
    color: "white",
    padding: "8px 10px",
    width: "112px",
  },
  range: {
    width: "100%",
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
    gap: "12px",
  },
  metric: {
    background: "#09090b",
    border: "1px solid #27272a",
    borderRadius: "12px",
    minWidth: 0,
    overflow: "hidden",
    padding: "14px",
  },
  metricLabel: {
    color: "#a1a1aa",
    fontSize: "12px",
    fontWeight: 800,
    margin: "0 0 8px",
    textTransform: "uppercase",
  },
  metricValue: {
    fontSize: "22px",
    fontWeight: 900,
    margin: 0,
    overflowWrap: "anywhere",
    whiteSpace: "normal",
    wordBreak: "break-word",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "14px",
  },
  field: {
    color: "#e4e4e7",
    display: "flex",
    flexDirection: "column",
    fontSize: "14px",
    fontWeight: 800,
    gap: "8px",
  },
  fieldInput: {
    background: "#09090b",
    border: "1px solid #3f3f46",
    borderRadius: "10px",
    color: "white",
    fontSize: "15px",
    padding: "10px 12px",
  },
  warningStack: {
    display: "grid",
    gap: "10px",
    marginTop: "16px",
  },
  warningBox: {
    background: "#422006",
    border: "1px solid #a16207",
    borderRadius: "12px",
    color: "#fde68a",
    fontWeight: 800,
    padding: "12px",
  },
  coachPrompt: {
    background: "#082f49",
    border: "1px solid #0e7490",
    borderRadius: "12px",
    color: "#bae6fd",
    fontWeight: 800,
    padding: "12px",
  },
  scoreRow: {
    alignItems: "center",
    borderBottom: "1px solid #27272a",
    color: "#d4d4d8",
    display: "flex",
    justifyContent: "space-between",
    padding: "12px 0",
  },
  sourceGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  },
  connectionGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
  },
  sourceOption: {
    background: "#09090b",
    border: "1px solid #27272a",
    borderRadius: "14px",
    padding: "14px",
  },
  signupSection: {
    alignItems: "center",
    background: "rgba(15, 23, 42, .94)",
    border: "1px solid #334155",
    borderRadius: "16px",
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    marginTop: "18px",
    padding: "18px",
  },
  signupForm: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  },
  signupStatus: {
    color: "#86efac",
    fontWeight: 900,
    margin: 0,
  },
  footer: {
    alignItems: "center",
    color: "#a1a1aa",
    display: "flex",
    flexWrap: "wrap",
    fontSize: "12px",
    fontWeight: 800,
    gap: "12px",
    justifyContent: "center",
    padding: "22px 0 8px",
    textAlign: "center",
  },
  footerLink: {
    color: "#7dd3fc",
  },
  planItem: {
    borderBottom: "1px solid #27272a",
    padding: "12px 0",
  },
  textArea: {
    background: "#09090b",
    border: "1px solid #3f3f46",
    borderRadius: "12px",
    color: "white",
    fontFamily: "Consolas, monospace",
    minHeight: "140px",
    margin: "16px 0",
    padding: "12px",
    width: "100%",
  },
  modalBackdrop: {
    alignItems: "center",
    background: "rgba(0,0,0,.72)",
    display: "flex",
    inset: 0,
    justifyContent: "center",
    padding: "20px",
    position: "fixed",
    zIndex: 20,
  },
  modal: {
    background: "#18181b",
    border: "1px solid #3f3f46",
    borderRadius: "18px",
    maxHeight: "88vh",
    maxWidth: "860px",
    overflow: "auto",
    padding: "24px",
    width: "100%",
  },
  disclaimerModal: {
    background: "#18181b",
    border: "1px solid #f59e0b",
    borderRadius: "18px",
    boxShadow: "0 24px 70px rgba(0,0,0,.55)",
    maxWidth: "620px",
    padding: "28px",
    width: "100%",
  },
  disclaimerText: {
    color: "#f8fafc",
    fontSize: "18px",
    fontWeight: 800,
    lineHeight: 1.45,
    margin: "18px 0 12px",
  },
  acceptButton: {
    background: "#2563eb",
    border: "1px solid #3b82f6",
    borderRadius: "12px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: 900,
    marginTop: "22px",
    padding: "13px 18px",
    width: "100%",
  },
  modalHeader: {
    alignItems: "center",
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    marginBottom: "20px",
  },
  closeButton: {
    background: "#27272a",
    border: "1px solid #3f3f46",
    borderRadius: "10px",
    color: "white",
    cursor: "pointer",
    fontWeight: 800,
    padding: "10px 14px",
  },
};


