import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  AreaSeries,
  HistogramSeries,
  createSeriesMarkers,
} from "lightweight-charts";

// Institutional dark palette — muted teal/red, minimal noise.
const CHART_THEME = {
  background: "#0d1117",
  text: "#d1d4dc",
  grid: "rgba(70, 78, 95, 0.22)",
  border: "rgba(110, 122, 145, 0.35)",
  up: "#26c6da",           // institutional teal (not neon green)
  down: "#ef5350",         // soft red
  wickUp: "rgba(38,198,218,0.65)",
  wickDown: "rgba(239,83,80,0.65)",
  support: "#26c6da",
  resistance: "#ef5350",
  entry: "#38bdf8",
  stop: "#f97316",
  tp: "#84cc16",
  runner: "#a855f7",
  price: "#facc15",
  glow: "rgba(250, 204, 21, 0.45)",
  orLine: "rgba(59,130,246,0.85)",
  orBox: "rgba(30,64,175,0.07)",
  orBoxBorder: "rgba(59,130,246,0.40)",
  orRetestBull: "rgba(34,197,94,0.22)",
  orRetestBear: "rgba(239,83,80,0.22)",
};

const MIN_CANDLES_FOR_LIVE = 20;

function toSeconds(value) {
  if (value === null || value === undefined) return null;
  const millis = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  return Math.floor(millis / 1000);
}

// Per-market floor for minimum visible candle range. Display-only.
function getMinVisibleRange(symbol, refPrice) {
  const sym = String(symbol || "").toUpperCase();
  if (sym === "NQ" || sym === "MNQ" || sym.startsWith("NQ") || sym.startsWith("MNQ")) return 2;
  if (sym === "ES" || sym === "MES" || sym.startsWith("ES") || sym.startsWith("MES")) return 0.5;
  if (sym === "YM" || sym === "MYM") return 5;
  if (sym === "RTY" || sym === "M2K") return 0.4;
  if (sym === "CL") return 0.05;
  if (sym === "GC" || sym === "MGC") return 0.5;
  const px = Number(refPrice);
  return Number.isFinite(px) && px > 0 ? Math.max(0.01, px * 0.001) : 0.5;
}

// Decompose a Unix-seconds timestamp into ET (America/New_York) wall-clock parts.
// Uses Intl so DST is handled correctly automatically.
function getETComponents(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

// Compute the Opening Range from candle data.
// Returns { orh, orl, ormid, orComplete, orStart, orEnd, orBoxEnd, retestCandle }
function computeOR(candles, orMinutes = 15) {
  const empty = {
    orh: null, orl: null, ormid: null,
    orComplete: false,
    orStart: null, orEnd: null, orBoxEnd: null,
    retestCandle: null,
  };
  if (!Array.isArray(candles) || candles.length === 0) return empty;

  // Find the most recent RTH (9:30 AM ET or later) candle to identify today's session.
  const RTH_OPEN_MIN = 9 * 60 + 30; // 570
  let tradingDate = null;
  for (let i = candles.length - 1; i >= 0; i--) {
    const et = getETComponents(candles[i].time);
    if (et.hour * 60 + et.minute >= RTH_OPEN_MIN) {
      tradingDate = `${et.year}-${String(et.month).padStart(2, "0")}-${String(et.day).padStart(2, "0")}`;
      break;
    }
  }
  if (!tradingDate) return empty;

  const orEndMin = RTH_OPEN_MIN + orMinutes;
  let orh = null, orl = null, orStart = null, orEnd = null;
  const postOrCandles = [];

  for (const c of candles) {
    const et = getETComponents(c.time);
    const dateKey = `${et.year}-${String(et.month).padStart(2, "0")}-${String(et.day).padStart(2, "0")}`;
    if (dateKey !== tradingDate) continue;

    const totalMin = et.hour * 60 + et.minute;
    if (totalMin >= RTH_OPEN_MIN && totalMin < orEndMin) {
      if (orh === null || c.high > orh) orh = c.high;
      if (orl === null || c.low < orl) orl = c.low;
      if (orStart === null) orStart = c.time;
      orEnd = c.time;
    } else if (totalMin >= orEndMin && totalMin < 16 * 60) {
      postOrCandles.push(c);
    }
  }

  if (orh === null || orl === null) return empty;

  const ormid = (orh + orl) / 2;
  const orComplete = postOrCandles.length > 0;
  const orBoxEnd = postOrCandles.length > 0 ? postOrCandles[0].time : orEnd;

  // OR retest detection: price breaks ORH or ORL then returns to touch that level.
  let retestCandle = null;
  if (orComplete) {
    let brokeAbove = false, brokeBelow = false;
    let topDone = false, bottomDone = false;

    for (const c of postOrCandles) {
      if (!brokeAbove && c.high > orh) brokeAbove = true;
      if (!brokeBelow && c.low < orl) brokeBelow = true;

      // Retest ORH from above: candle range straddles ORH after an upside break.
      if (!topDone && brokeAbove && c.low <= orh && c.high >= orh) {
        retestCandle = { time: c.time, price: orh, side: "top" };
        topDone = true;
      }
      // Retest ORL from below: candle range straddles ORL after a downside break.
      if (!bottomDone && brokeBelow && !retestCandle && c.high >= orl && c.low <= orl) {
        retestCandle = { time: c.time, price: orl, side: "bottom" };
        bottomDone = true;
      }
    }
  }

  return { orh, orl, ormid, orComplete, orStart, orEnd, orBoxEnd, retestCandle };
}

function buildCandleSeriesData(candles, options = {}) {
  if (!Array.isArray(candles)) return { data: [], expanded: 0, rejected: 0 };
  const symbol = options.symbol || "";
  const refPrice = Number(options.refPrice);
  const seen = new Map();
  let expanded = 0;
  let rejected = 0;

  // Per-market outlier threshold — candles more than this many points from
  // the current price are almost certainly stale test data or a feed glitch.
  let outlierThreshold = null;
  if (Number.isFinite(refPrice) && refPrice > 0) {
    const sym = String(symbol).toUpperCase();
    if (sym === "NQ" || sym === "MNQ" || sym.startsWith("NQ") || sym.startsWith("MNQ")) outlierThreshold = 1000;
    else if (sym === "ES" || sym === "MES" || sym.startsWith("ES") || sym.startsWith("MES")) outlierThreshold = 100;
    else if (sym === "YM" || sym === "MYM") outlierThreshold = 1000;
    else if (sym === "RTY" || sym === "M2K") outlierThreshold = 50;
    else if (sym.startsWith("BTC")) outlierThreshold = refPrice * 0.08;
    else outlierThreshold = refPrice * 0.10;
  }

  for (const candle of candles) {
    if (!candle) continue;
    const time = toSeconds(candle.timestamp ?? candle.time);
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;
    if (time <= 0) continue;
    // Reject candles whose close is wildly different from current price.
    if (outlierThreshold !== null && Math.abs(close - refPrice) > outlierThreshold) {
      rejected += 1;
      continue;
    }
    let displayHigh = high;
    let displayLow = low;
    const range = Math.abs(displayHigh - displayLow);
    const minRange = getMinVisibleRange(symbol, close);
    if (range < minRange) {
      // Display-only expansion. Trading logic still uses raw OHLC stored upstream.
      displayHigh = close + minRange / 2;
      displayLow = close - minRange / 2;
      expanded += 1;
    }
    seen.set(time, { time, open, high: displayHigh, low: displayLow, close });
  }
  return {
    data: Array.from(seen.values()).sort((a, b) => a.time - b.time),
    expanded,
    rejected,
  };
}

function buildZoneAreaData(zone, candles) {
  if (!zone || !Number.isFinite(Number(zone.min)) || !Number.isFinite(Number(zone.max))) return null;
  if (!Array.isArray(candles) || !candles.length) return null;
  const value = (Number(zone.min) + Number(zone.max)) / 2;
  return candles.map((candle) => ({ time: candle.time, value }));
}

function ensurePriceLine(series, ref, key, options) {
  if (!series) return;
  const existing = ref.current[key];
  if (!options || !Number.isFinite(Number(options.price))) {
    if (existing) {
      try {
        series.removePriceLine(existing);
      } catch {
        // already removed
      }
      delete ref.current[key];
    }
    return;
  }
  if (existing) {
    try {
      existing.applyOptions(options);
      return;
    } catch {
      try {
        series.removePriceLine(existing);
      } catch {
        // ignore
      }
    }
  }
  ref.current[key] = series.createPriceLine(options);
}

export default function TradingChart({
  autoFit = true,
  candles,
  currentPrice,
  debugMode = false,
  emptyMessage = "Waiting for TradingView candles…",
  fvgData = null,
  fvgQuality = null,
  height = 480,
  lockPriceScale = false,
  markers,
  orMinutes = 15,
  plan,
  poc = null,
  relVol = null,
  resetSignal = 0,
  resistanceZone,
  showOR = true,
  showORBox = true,
  showORLabels = true,
  showORRetest = true,
  showZones = true,
  supportZone,
  symbol,
  timeframe,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const supportAreaRef = useRef(null);
  const resistanceAreaRef = useRef(null);
  const markersRef = useRef(null);
  const priceLinesRef = useRef({});
  const hasInitiallyFitRef = useRef(false);
  // Keeps candle data accessible to the chart-creation effect without adding
  // it to that effect's dep array (which would destroy/recreate on every tick).
  const candleDataRef = useRef([]);
  const volumeSeriesRef = useRef(null);
  const volumeDataRef = useRef([]);
  const autoFitRef = useRef(autoFit);
  // Tracks the last symbol|timeframe pair that triggered a fitContent so we
  // re-fit automatically when the user switches timeframe or symbol.
  const lastFitKeyRef = useRef("");
  const fvgOverlayRef = useRef(null);
  // Stable ref holding the latest fvgData so chart event subscriptions can read it
  // without being recreated on every render.
  const fvgDataRef = useRef(fvgData);
  const fvgUpdateRef = useRef(null);

  // OR overlay refs
  const orBoxRef = useRef(null);
  const orRetestRef = useRef(null);
  const orDataRef = useRef(null);
  const orUpdateRef = useRef(null);

  const [hoverCandle, setHoverCandle] = useState(null);

  const built = useMemo(
    () => buildCandleSeriesData(candles, { symbol, refPrice: currentPrice }),
    [candles, symbol, currentPrice],
  );
  const realCandles = built.data;
  const volumeData = useMemo(() => {
    if (!Array.isArray(candles)) return [];
    const seen = new Map();
    for (const c of candles) {
      if (!c) continue;
      const time = toSeconds(c.timestamp ?? c.time);
      const vol = Number(c.volume ?? c.vol ?? 0);
      if (!Number.isFinite(time) || vol <= 0) continue;
      const isUp = Number(c.close) >= Number(c.open);
      seen.set(time, { time, value: vol, color: isUp ? "rgba(38,198,218,0.45)" : "rgba(239,83,80,0.45)" });
    }
    return Array.from(seen.values()).sort((a, b) => a.time - b.time);
  }, [candles]);
  const candleData = realCandles;
  const waitingForCandles = realCandles.length < MIN_CANDLES_FOR_LIVE;
  const visualRangeEnhanced = built.expanded > 0;
  // Reject zones when support and resistance would collide on the same line —
  // collapses to "no zone shown" rather than two duplicates at one price.
  const cleanSupport = supportZone && resistanceZone
    && Number.isFinite(Number(supportZone.center)) && Number.isFinite(Number(resistanceZone.center))
    && Number(supportZone.center) >= Number(resistanceZone.center)
      ? null
      : supportZone;
  const cleanResistance = supportZone && resistanceZone
    && Number.isFinite(Number(supportZone.center)) && Number.isFinite(Number(resistanceZone.center))
    && Number(supportZone.center) >= Number(resistanceZone.center)
      ? null
      : resistanceZone;
  const planValid = Boolean(plan)
    && Number.isFinite(Number(plan.entry)) && Number.isFinite(Number(plan.stop))
    && Number(plan.entry) > 0 && Number(plan.stop) > 0;

  // Compute Opening Range from full candle data (before any display cap).
  const orData = useMemo(
    () => showOR ? computeOR(built.data, orMinutes) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showOR, built.data.length, orMinutes],
  );

  // After every render: update data refs and rebuild the stable overlay update functions
  // so they always close over the latest props without triggering re-renders.
  useLayoutEffect(() => {
    fvgDataRef.current = fvgData;
    orDataRef.current = orData;

    fvgUpdateRef.current = () => {
      const el = fvgOverlayRef.current;
      const series = seriesRef.current;
      if (!el || !series) return;
      const fd = fvgDataRef.current;
      if (!fd || !Number.isFinite(Number(fd.top)) || !Number.isFinite(Number(fd.bottom))) {
        el.style.display = "none";
        return;
      }
      const topPx = series.priceToCoordinate(Number(fd.top));
      const botPx = series.priceToCoordinate(Number(fd.bottom));
      if (topPx === null || botPx === null) {
        el.style.display = "none";
        return;
      }
      const y1 = Math.min(topPx, botPx);
      const y2 = Math.max(topPx, botPx);
      const boxH = Math.max(2, y2 - y1);
      const isBearish = fd.type === "bearish";
      el.style.display = "block";
      el.style.top = `${y1}px`;
      el.style.height = `${boxH}px`;
      el.style.background = isBearish ? "rgba(239,83,80,0.12)" : "rgba(38,198,218,0.12)";
      el.style.borderTop = `1px solid ${isBearish ? "rgba(239,83,80,0.60)" : "rgba(38,198,218,0.60)"}`;
      el.style.borderBottom = `1px solid ${isBearish ? "rgba(239,83,80,0.60)" : "rgba(38,198,218,0.60)"}`;
      const labelEl = el.querySelector(".fvg-center-label");
      if (labelEl) {
        labelEl.style.display = boxH > 16 ? "block" : "none";
        labelEl.style.color = isBearish ? "rgba(239,83,80,0.45)" : "rgba(38,198,218,0.45)";
      }
    };

    // OR overlay update — repositions the OR box and retest rectangle on pan/zoom.
    orUpdateRef.current = () => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      const od = orDataRef.current;
      const boxEl = orBoxRef.current;
      const retestEl = orRetestRef.current;

      if (boxEl) {
        const canDraw = showOR && showORBox && od?.orh != null && od?.orl != null && od?.orStart != null;
        if (!canDraw || !chart || !series) {
          boxEl.style.display = "none";
        } else {
          const x1 = chart.timeScale().timeToCoordinate(od.orStart);
          const x2 = chart.timeScale().timeToCoordinate(od.orBoxEnd ?? od.orEnd);
          const y1 = series.priceToCoordinate(od.orh);
          const y2 = series.priceToCoordinate(od.orl);
          if (x1 == null || x2 == null || y1 == null || y2 == null) {
            boxEl.style.display = "none";
          } else {
            const left = Math.min(x1, x2);
            const right = Math.max(x1, x2);
            const top = Math.min(y1, y2);
            const ht = Math.max(4, Math.abs(y2 - y1));
            boxEl.style.display = "block";
            boxEl.style.left = `${left}px`;
            boxEl.style.width = `${Math.max(2, right - left)}px`;
            boxEl.style.top = `${top}px`;
            boxEl.style.height = `${ht}px`;
            const labelEl = boxEl.querySelector(".or-box-label");
            if (labelEl) labelEl.style.display = showORLabels ? "block" : "none";
          }
        }
      }

      if (retestEl) {
        const canDraw = showOR && showORRetest && od?.retestCandle != null;
        if (!canDraw || !chart || !series) {
          retestEl.style.display = "none";
        } else {
          const rc = od.retestCandle;
          const rx = chart.timeScale().timeToCoordinate(rc.time);
          const ry = series.priceToCoordinate(rc.price);
          if (rx == null || ry == null) {
            retestEl.style.display = "none";
          } else {
            let barW = 14;
            const cd = candleDataRef.current;
            if (cd.length >= 2) {
              const t1 = chart.timeScale().timeToCoordinate(cd[0].time);
              const t2 = chart.timeScale().timeToCoordinate(cd[1].time);
              if (t1 != null && t2 != null) barW = Math.max(8, Math.abs(t2 - t1) * 0.8);
            }
            const boxH = 20;
            const isTop = rc.side === "top";
            const retestBg = isTop ? CHART_THEME.orRetestBear : CHART_THEME.orRetestBull;
            const retestBorder = isTop ? "rgba(239,83,80,0.75)" : "rgba(34,197,94,0.75)";
            const retestTextColor = isTop ? "#fca5a5" : "#86efac";
            retestEl.style.display = "block";
            retestEl.style.left = `${rx - barW / 2}px`;
            retestEl.style.width = `${barW}px`;
            retestEl.style.top = `${ry - boxH / 2}px`;
            retestEl.style.height = `${boxH}px`;
            retestEl.style.background = retestBg;
            retestEl.style.borderColor = retestBorder;
            const labelEl = retestEl.querySelector(".or-retest-label");
            if (labelEl) {
              labelEl.style.color = retestTextColor;
              labelEl.textContent = isTop ? "ORH" : "ORL";
              if (isTop) {
                labelEl.style.top = "auto";
                labelEl.style.bottom = `${boxH + 2}px`;
              } else {
                labelEl.style.top = `${boxH + 2}px`;
                labelEl.style.bottom = "auto";
              }
            }
          }
        }
      }
    };
  });

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: CHART_THEME.background },
        textColor: CHART_THEME.text,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontSize: 12,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: CHART_THEME.grid, style: 0 },
        horzLines: { color: CHART_THEME.grid, style: 0 },
      },
      rightPriceScale: {
        borderColor: CHART_THEME.border,
        scaleMargins: { top: 0.10, bottom: 0.22 },
        autoScale: true,
        entireTextOnly: true,
      },
      timeScale: {
        borderColor: CHART_THEME.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 12,
        minBarSpacing: 4,
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: "rgba(148, 163, 184, .55)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#1a1f2e",
        },
        horzLine: {
          color: "rgba(148, 163, 184, .55)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#1a1f2e",
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
      kineticScroll: {
        touch: true,
        mouse: false,
      },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: CHART_THEME.up,
      downColor: CHART_THEME.down,
      borderUpColor: CHART_THEME.up,
      borderDownColor: CHART_THEME.down,
      wickUpColor: CHART_THEME.wickUp,
      wickDownColor: CHART_THEME.wickDown,
      borderVisible: true,
      wickVisible: true,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    // Volume histogram — bottom 15% of chart, separate hidden price scale.
    const volSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.88, bottom: 0 },
      visible: false,
    });
    volumeSeriesRef.current = volSeries;
    const existingVol = volumeDataRef.current;
    if (existingVol.length) volSeries.setData(existingVol);

    // Load existing data immediately so the chart is never blank after a
    // height-change recreation (the data effect won't re-fire if candleData
    // didn't change, so we seed it here from the ref).
    const existingData = candleDataRef.current;
    if (existingData.length) {
      series.setData(existingData);
      if (autoFitRef.current) {
        chart.timeScale().fitContent();
        hasInitiallyFitRef.current = true;
      }
    }

    // OHLC tooltip — fires on every crosshair move; nulls out when leaving.
    const handleCrosshair = (param) => {
      if (!param || !param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        setHoverCandle(null);
        return;
      }
      const point = param.seriesData?.get(series);
      if (!point) {
        setHoverCandle(null);
        return;
      }
      setHoverCandle({
        x: param.point.x,
        y: param.point.y,
        open: Number(point.open),
        high: Number(point.high),
        low: Number(point.low),
        close: Number(point.close),
      });
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);
    // iOS reflows after rotation — wait a tick then re-measure so the chart
    // doesn't end up clipped by stale width.
    const handleOrientation = () => {
      setTimeout(handleResize, 150);
    };
    window.addEventListener("orientationchange", handleOrientation);

    // ResizeObserver gives us responsive resizing when the parent layout
    // changes (sidebar collapse, drawer open) — not just window resize.
    let observer = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(handleResize);
      observer.observe(containerRef.current);
    }

    // FVG + OR overlays — update pixel position on every chart pan/zoom.
    const handleOverlayUpdate = () => {
      if (fvgUpdateRef.current) fvgUpdateRef.current();
      if (orUpdateRef.current) orUpdateRef.current();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleOverlayUpdate);
    chart.subscribeCrosshairMove(handleOverlayUpdate);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleOrientation);
      if (observer) observer.disconnect();
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleOverlayUpdate);
      } catch {
        // ignore
      }
      try {
        chart.unsubscribeCrosshairMove(handleOverlayUpdate);
      } catch {
        // already disposed
      }
      try {
        chart.unsubscribeCrosshairMove(handleCrosshair);
      } catch {
        // already disposed
      }
      try {
        chart.remove();
      } catch {
        // already disposed
      }
      chartRef.current = null;
      seriesRef.current = null;
      supportAreaRef.current = null;
      resistanceAreaRef.current = null;
      markersRef.current = null;
      volumeSeriesRef.current = null;
      priceLinesRef.current = {};
    };
  }, [height]);

  useEffect(() => {
    autoFitRef.current = autoFit;
  }, [autoFit]);

  useEffect(() => {
    volumeDataRef.current = volumeData;
    if (volumeSeriesRef.current) volumeSeriesRef.current.setData(volumeData);
  }, [volumeData]);

  // Recompute FVG overlay pixel position whenever fvgData changes.
  useEffect(() => {
    if (fvgUpdateRef.current) fvgUpdateRef.current();
  }, [fvgData]);

  // Reposition OR overlays whenever orData or OR visibility settings change.
  useEffect(() => {
    if (orUpdateRef.current) orUpdateRef.current();
  }, [orData, showOR, showORBox, showORRetest, showORLabels]);

  useEffect(() => {
    // Keep ref in sync so chart-recreation effect can access current data.
    candleDataRef.current = candleData;
    if (import.meta.env.DEV) {
      console.log(
        "[TradingChart] candles →", candleData.length,
        `(rejected: ${built.rejected})`,
        "first:", candleData[0] ? `t=${candleData[0].time} o=${candleData[0].open}` : "–",
        "last:", candleData.at(-1) ? `t=${candleData.at(-1).time} c=${candleData.at(-1).close}` : "–",
      );
    }
    if (!seriesRef.current) return;
    seriesRef.current.setData(candleData);
    // Always force autoScale after setData so the price axis re-fits to the
    // current visible data rather than a stale range from a previous symbol/TF.
    if (chartRef.current) {
      chartRef.current.applyOptions({ rightPriceScale: { autoScale: true } });
    }
    // Re-fit the time axis when: (a) this is the first load, or (b) the
    // symbol or timeframe has changed (user switched instruments/TF).
    const fitKey = `${symbol}|${timeframe}`;
    const needsRefit = !hasInitiallyFitRef.current || fitKey !== lastFitKeyRef.current;
    if (needsRefit && candleData.length && chartRef.current && autoFit) {
      chartRef.current.timeScale().fitContent();
      hasInitiallyFitRef.current = true;
      lastFitKeyRef.current = fitKey;
    }
    // Trigger OR overlay reposition after new candle data is rendered.
    if (orUpdateRef.current) orUpdateRef.current();
  }, [candleData, autoFit, symbol, timeframe, built.rejected]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      handleScale: {
        axisPressedMouseMove: !lockPriceScale,
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: !lockPriceScale,
      },
      rightPriceScale: {
        autoScale: lockPriceScale,
      },
    });
  }, [lockPriceScale]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !resetSignal) return;
    try {
      chart.timeScale().fitContent();
      chart.applyOptions({
        rightPriceScale: {
          autoScale: true,
          scaleMargins: { top: 0.10, bottom: 0.22 },
        },
      });
      hasInitiallyFitRef.current = true;
    } catch {
      // ignore
    }
  }, [resetSignal]);

  useEffect(() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return;
    const upsertArea = (ref, zone, color) => {
      const data = buildZoneAreaData(zone, candleData);
      if (!data) {
        if (ref.current) {
          try {
            chart.removeSeries(ref.current);
          } catch {
            // ignore
          }
          ref.current = null;
        }
        return;
      }
      if (!ref.current) {
        ref.current = chart.addSeries(AreaSeries, {
          topColor: `${color}55`,
          bottomColor: `${color}05`,
          lineColor: `${color}aa`,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
      }
      ref.current.setData(data);
    };
    upsertArea(supportAreaRef, showZones ? cleanSupport : null, CHART_THEME.support);
    upsertArea(resistanceAreaRef, showZones ? cleanResistance : null, CHART_THEME.resistance);
  }, [candleData, cleanSupport?.min, cleanSupport?.max, cleanResistance?.min, cleanResistance?.max, showZones]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    // Only render the latest valid setup marker — old arrows just clutter
    // the chart and confuse the user about what is actionable now.
    // Only show the latest signal marker — older ones are noise.
    const allMarkers = Array.isArray(markers)
      ? markers
          .map((marker) => {
            if (!marker) return null;
            const time = toSeconds(marker.time ?? marker.timestamp);
            if (!Number.isFinite(time)) return null;
            const isShort = marker.direction === "short";
            const grade = marker.grade ? ` ${marker.grade}` : "";
            return {
              time,
              position: marker.position || (isShort ? "aboveBar" : "belowBar"),
              color: marker.color || (isShort ? CHART_THEME.down : CHART_THEME.up),
              shape: isShort ? "arrowDown" : "arrowUp",
              text: marker.text || (isShort ? `▼ SHORT${grade}` : `▲ LONG${grade}`),
              size: 1,
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.time - b.time)
      : [];
    // Latest marker bright, previous one faded
    const fixedMarkers = allMarkers.slice(-2).map((m, i, arr) =>
      i < arr.length - 1 ? { ...m, color: "rgba(148,163,184,0.45)" } : m
    );
    if (!markersRef.current) {
      markersRef.current = createSeriesMarkers(series, fixedMarkers);
    } else {
      markersRef.current.setMarkers(fixedMarkers);
    }
  }, [markers]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    ensurePriceLine(series, priceLinesRef, "currentPrice", Number.isFinite(Number(currentPrice)) ? {
      price: Number(currentPrice),
      color: CHART_THEME.price,
      lineStyle: 0,
      lineWidth: 2,
      axisLabelVisible: true,
      title: "",
    } : null);

    // One support line + one resistance line — never duplicates that visually
    // collapse to the same price.
    const supportCenter = cleanSupport && Number.isFinite(Number(cleanSupport.center))
      ? Number(cleanSupport.center)
      : (cleanSupport && Number.isFinite(Number(cleanSupport.min)) && Number.isFinite(Number(cleanSupport.max))
        ? (Number(cleanSupport.min) + Number(cleanSupport.max)) / 2
        : null);
    const resistanceCenter = cleanResistance && Number.isFinite(Number(cleanResistance.center))
      ? Number(cleanResistance.center)
      : (cleanResistance && Number.isFinite(Number(cleanResistance.min)) && Number.isFinite(Number(cleanResistance.max))
        ? (Number(cleanResistance.min) + Number(cleanResistance.max)) / 2
        : null);
    ensurePriceLine(series, priceLinesRef, "support", showZones && Number.isFinite(supportCenter) ? {
      price: supportCenter,
      color: CHART_THEME.support,
      lineStyle: 2,
      lineWidth: 2,
      title: "Support",
    } : null);
    ensurePriceLine(series, priceLinesRef, "resistance", showZones && Number.isFinite(resistanceCenter) && resistanceCenter !== supportCenter ? {
      price: resistanceCenter,
      color: CHART_THEME.resistance,
      lineStyle: 2,
      lineWidth: 2,
      title: "Resistance",
    } : null);

    // Plan price lines only when the plan itself has at least entry + stop.
    ensurePriceLine(series, priceLinesRef, "entry", planValid ? {
      price: Number(plan.entry),
      color: CHART_THEME.entry,
      lineStyle: 0,
      lineWidth: 2,
      title: "Entry",
    } : null);
    ensurePriceLine(series, priceLinesRef, "stop", planValid ? {
      price: Number(plan.stop),
      color: CHART_THEME.stop,
      lineStyle: 0,
      lineWidth: 2,
      title: "Stop",
    } : null);
    ensurePriceLine(series, priceLinesRef, "tp1", planValid && Number.isFinite(Number(plan.tp1)) ? {
      price: Number(plan.tp1),
      color: CHART_THEME.tp,
      lineStyle: 0,
      lineWidth: 1,
      title: "TP1",
    } : null);
    ensurePriceLine(series, priceLinesRef, "tp2", planValid && Number.isFinite(Number(plan.tp2)) ? {
      price: Number(plan.tp2),
      color: CHART_THEME.tp,
      lineStyle: 0,
      lineWidth: 1,
      title: "TP2",
    } : null);
    ensurePriceLine(series, priceLinesRef, "runner", planValid && Number.isFinite(Number(plan.runner)) ? {
      price: Number(plan.runner),
      color: CHART_THEME.runner,
      lineStyle: 0,
      lineWidth: 1,
      title: "Runner",
    } : null);

    // POC — session point of control from Pine Script signal.
    ensurePriceLine(series, priceLinesRef, "poc", Number.isFinite(Number(poc)) ? {
      price: Number(poc),
      color: "#06b6d4",
      lineStyle: 1,
      lineWidth: 1,
      axisLabelVisible: true,
      title: "POC",
    } : null);

    // FVG — nearest fair value gap boundary lines (solid edges, institutional style).
    // The transparent fill is rendered by fvgOverlayRef div (positioned absolutely).
    const isFvgBearish = fvgData?.type === "bearish";
    const fvgEdgeColor = isFvgBearish ? "rgba(239,83,80,0.75)" : "rgba(38,198,218,0.75)";
    ensurePriceLine(series, priceLinesRef, "fvgTop", fvgData && Number.isFinite(Number(fvgData.top)) ? {
      price: Number(fvgData.top),
      color: fvgEdgeColor,
      lineStyle: 0,
      lineWidth: 1,
      axisLabelVisible: true,
      title: isFvgBearish ? "FVG▼" : "FVG▲",
    } : null);
    ensurePriceLine(series, priceLinesRef, "fvgBottom", fvgData && Number.isFinite(Number(fvgData.bottom)) ? {
      price: Number(fvgData.bottom),
      color: fvgEdgeColor,
      lineStyle: 0,
      lineWidth: 1,
      axisLabelVisible: false,
      title: "",
    } : null);

    // OR price lines — ORH and ORL as subtle dashed blue lines; axis label only.
    const orActive = showOR && orData?.orh != null;
    ensurePriceLine(series, priceLinesRef, "orh", orActive ? {
      price: orData.orh,
      color: CHART_THEME.orLine,
      lineStyle: 2,
      lineWidth: 1,
      axisLabelVisible: true,
      title: showORLabels ? "ORH" : "",
    } : null);
    ensurePriceLine(series, priceLinesRef, "orl", orActive ? {
      price: orData.orl,
      color: CHART_THEME.orLine,
      lineStyle: 2,
      lineWidth: 1,
      axisLabelVisible: true,
      title: showORLabels ? "ORL" : "",
    } : null);
    ensurePriceLine(series, priceLinesRef, "ormid", orActive && orData.ormid != null ? {
      price: orData.ormid,
      color: "rgba(59,130,246,0.25)",
      lineStyle: 2,
      lineWidth: 1,
      axisLabelVisible: false,
      title: "",
    } : null);
  }, [
    currentPrice,
    cleanSupport?.min, cleanSupport?.max, cleanSupport?.center,
    cleanResistance?.min, cleanResistance?.max, cleanResistance?.center,
    planValid, plan?.entry, plan?.stop, plan?.tp1, plan?.tp2, plan?.runner,
    showZones, poc,
    fvgData?.type, fvgData?.top, fvgData?.bottom,
    showOR, showORLabels,
    orData?.orh, orData?.orl, orData?.ormid,
  ]);

  // Tooltip placement — keep it inside the chart bounds. 12px nudge so it
  // doesn't sit directly under the cursor.
  const tooltipStyle = hoverCandle ? {
    background: "rgba(13, 17, 23, .94)",
    border: "1px solid rgba(110, 122, 145, 0.45)",
    borderRadius: "8px",
    color: "#d1d4dc",
    fontSize: "11px",
    fontVariantNumeric: "tabular-nums",
    // eslint-disable-next-line react-hooks/refs
    left: Math.min(Math.max(12, hoverCandle.x + 14), Math.max(140, (containerRef.current?.clientWidth || 600) - 150)),
    lineHeight: 1.6,
    padding: "6px 10px",
    pointerEvents: "none",
    position: "absolute",
    top: 12,
    whiteSpace: "nowrap",
    zIndex: 5,
  } : null;
  const hoverRange = hoverCandle ? Math.abs(hoverCandle.high - hoverCandle.low) : 0;

  // OR debug state computed for display
  const orDebugRows = debugMode && orData ? [
    `ORH: ${orData.orh != null ? orData.orh.toFixed(2) : "–"}`,
    `ORL: ${orData.orl != null ? orData.orl.toFixed(2) : "–"}`,
    `OR Complete: ${orData.orComplete ? "Yes" : "No"}`,
    `OR Retest: ${orData.retestCandle ? `Yes (${orData.retestCandle.side === "top" ? "ORH" : "ORL"} @ ${new Date(orData.retestCandle.time * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})` : "No"}`,
  ] : [];

  return (
    <div style={{ position: "relative", width: "100%", height, touchAction: "none" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", touchAction: "none" }} />

      {/* FVG transparent box fill — positioned by priceToCoordinate, updated by chart events */}
      <div
        ref={fvgOverlayRef}
        style={{
          display: "none",
          left: 0,
          pointerEvents: "none",
          position: "absolute",
          right: "60px",
          zIndex: 2,
        }}
      >
        <span
          className="fvg-center-label"
          style={{
            fontSize: "9px",
            fontWeight: 700,
            left: "5px",
            letterSpacing: ".12em",
            position: "absolute",
            top: "50%",
            transform: "translateY(-50%)",
          }}
        >
          FVG
        </span>
      </div>

      {/* OR box — thin blue outline from OR start to OR end, height = ORH to ORL */}
      <div
        ref={orBoxRef}
        style={{
          background: CHART_THEME.orBox,
          border: `1px solid ${CHART_THEME.orBoxBorder}`,
          borderRadius: "2px",
          display: "none",
          pointerEvents: "none",
          position: "absolute",
          zIndex: 2,
        }}
      >
        <span
          className="or-box-label"
          style={{
            color: CHART_THEME.orLine,
            display: showORLabels ? "block" : "none",
            fontSize: "9px",
            fontWeight: 700,
            left: "3px",
            letterSpacing: ".04em",
            position: "absolute",
            top: "2px",
          }}
        >
          OR
        </span>
      </div>

      {/* OR retest indicator — colored bar at retest candle; green=ORL reclaim, red=ORH rejection */}
      <div
        ref={orRetestRef}
        style={{
          border: "1.5px solid",
          borderRadius: "3px",
          display: "none",
          pointerEvents: "none",
          position: "absolute",
          zIndex: 3,
        }}
      >
        <span
          className="or-retest-label"
          style={{
            fontSize: "9px",
            fontWeight: 800,
            left: "50%",
            letterSpacing: ".04em",
            position: "absolute",
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
          }}
        />
      </div>

      {hoverCandle ? (
        <div style={tooltipStyle}>
          <div><span style={{ color: "#94a3b8" }}>O:</span> {hoverCandle.open.toFixed(2)}</div>
          <div><span style={{ color: "#94a3b8" }}>H:</span> {hoverCandle.high.toFixed(2)}</div>
          <div><span style={{ color: "#94a3b8" }}>L:</span> {hoverCandle.low.toFixed(2)}</div>
          <div><span style={{ color: "#94a3b8" }}>C:</span> {hoverCandle.close.toFixed(2)}</div>
          <div><span style={{ color: "#94a3b8" }}>Range:</span> {hoverRange.toFixed(2)}</div>
        </div>
      ) : null}
      {Number.isFinite(relVol) ? (
        <div
          style={{
            background: relVol >= 1.5 ? "rgba(34,197,94,0.15)" : relVol <= 0.6 ? "rgba(234,179,8,0.15)" : "rgba(71,85,105,0.4)",
            border: `1px solid ${relVol >= 1.5 ? "rgba(34,197,94,0.5)" : relVol <= 0.6 ? "rgba(234,179,8,0.5)" : "rgba(71,85,105,0.5)"}`,
            borderRadius: "6px",
            color: relVol >= 1.5 ? "#86efac" : relVol <= 0.6 ? "#fde68a" : "#94a3b8",
            fontSize: "10px",
            fontWeight: 700,
            left: "10px",
            letterSpacing: ".05em",
            padding: "2px 7px",
            position: "absolute",
            top: "10px",
          }}
        >
          Vol {relVol.toFixed(1)}x{fvgQuality && fvgQuality !== "Weak" ? ` · FVG ${fvgQuality}` : ""}
        </div>
      ) : null}
      {debugMode && visualRangeEnhanced ? (
        <div
          style={{
            background: "rgba(234, 179, 8, 0.18)",
            border: "1px solid rgba(234, 179, 8, 0.5)",
            borderRadius: "8px",
            color: "#fde68a",
            fontSize: "10px",
            fontWeight: 800,
            left: "10px",
            letterSpacing: ".06em",
            padding: "3px 8px",
            position: "absolute",
            textTransform: "uppercase",
            top: Number.isFinite(relVol) ? "34px" : "10px",
          }}
        >
          Visual range enhanced
        </div>
      ) : null}
      {debugMode ? (
        <div
          style={{
            background: "rgba(13,17,23,0.88)",
            border: "1px solid rgba(71,85,105,0.6)",
            borderRadius: "8px",
            bottom: "10px",
            color: "#94a3b8",
            fontSize: "10px",
            fontVariantNumeric: "tabular-nums",
            left: "10px",
            lineHeight: 1.7,
            padding: "6px 10px",
            pointerEvents: "none",
            position: "absolute",
            zIndex: 4,
          }}
        >
          <div style={{ color: "#cbd5e1", fontWeight: 700, marginBottom: "2px" }}>Candle Debug</div>
          <div>Raw input: {Array.isArray(candles) ? candles.length : 0}</div>
          <div>After filter: {realCandles.length}</div>
          {built.rejected > 0 && <div style={{ color: "#f97316" }}>Outliers rejected: {built.rejected}</div>}
          <div>
            First:{" "}
            {realCandles[0]
              ? `${new Date(realCandles[0].time * 1000).toISOString().slice(11, 16)}Z  p=${realCandles[0].close.toFixed(2)}`
              : "–"}
          </div>
          <div>
            Last:{" "}
            {realCandles.at(-1)
              ? `${new Date(realCandles.at(-1).time * 1000).toISOString().slice(11, 16)}Z  p=${realCandles.at(-1).close.toFixed(2)}`
              : "–"}
          </div>
          {orDebugRows.length > 0 && (
            <>
              <div style={{ color: "#93c5fd", fontWeight: 700, marginTop: "4px", marginBottom: "2px" }}>Opening Range</div>
              {orDebugRows.map((row) => <div key={row}>{row}</div>)}
            </>
          )}
        </div>
      ) : null}
      {waitingForCandles ? (
        <div
          style={{
            alignItems: "center",
            background: "rgba(13, 17, 23, 0.75)",
            border: "1px solid rgba(110, 122, 145, 0.25)",
            borderRadius: "10px",
            color: "#94a3b8",
            display: "flex",
            flexDirection: "column",
            fontSize: "13px",
            gap: "6px",
            left: "50%",
            padding: "14px 20px",
            pointerEvents: "none",
            position: "absolute",
            top: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
            minWidth: "220px",
          }}
        >
          <span style={{ color: "#cbd5e1", fontSize: "13px", fontWeight: 600 }}>
            {emptyMessage}
          </span>
          <span style={{ color: "#475569", fontSize: "10px", letterSpacing: ".06em", textTransform: "uppercase" }}>
            {realCandles.length} / {MIN_CANDLES_FOR_LIVE} candles · {symbol || "Live"}{timeframe ? ` · ${timeframe}` : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}
