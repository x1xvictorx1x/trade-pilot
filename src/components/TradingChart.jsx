import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  AreaSeries,
  HistogramSeries,
  createSeriesMarkers,
} from "lightweight-charts";

// TradingView-style dark palette: dim background, soft grid, bright wicks.
const CHART_THEME = {
  background: "#0d1117",
  text: "#d1d4dc",
  grid: "rgba(70, 78, 95, 0.28)",
  border: "rgba(110, 122, 145, 0.45)",
  up: "#22c55e",
  down: "#f43f5e",
  support: "#22c55e",
  resistance: "#f43f5e",
  entry: "#38bdf8",
  stop: "#f97316",
  tp: "#84cc16",
  runner: "#a855f7",
  price: "#facc15",
  glow: "rgba(250, 204, 21, 0.45)",
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
  plan,
  poc = null,
  relVol = null,
  resetSignal = 0,
  resistanceZone,
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
  const [hoverCandle, setHoverCandle] = useState(null);

  const built = useMemo(
    () => buildCandleSeriesData(candles, { symbol, refPrice: currentPrice }),
    [candles, symbol, currentPrice],
  );
  const realCandles = useMemo(() => {
    // Hard-cap to last 300 candles — keeps the chart snappy and matches the
    // history pipeline's MAX_CANDLES_PER_KEY.
    return built.data.length > 300 ? built.data.slice(built.data.length - 300) : built.data;
  }, [built]);
  const volumeData = useMemo(() => {
    if (!Array.isArray(candles)) return [];
    const seen = new Map();
    for (const c of candles) {
      if (!c) continue;
      const time = toSeconds(c.timestamp ?? c.time);
      const vol = Number(c.volume ?? c.vol ?? 0);
      if (!Number.isFinite(time) || vol <= 0) continue;
      const isUp = Number(c.close) >= Number(c.open);
      seen.set(time, { time, value: vol, color: isUp ? "rgba(34,197,94,0.35)" : "rgba(244,63,94,0.35)" });
    }
    const arr = Array.from(seen.values()).sort((a, b) => a.time - b.time);
    return arr.length > 300 ? arr.slice(arr.length - 300) : arr;
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

  // Keep fvgDataRef current on every render so the stable update fn reads fresh data.
  fvgDataRef.current = fvgData;

  // Stable update function — reads from refs, writes directly to overlay DOM element.
  // Called by chart event subscriptions and by the fvgData useEffect.
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
    const isBearish = fd.type === "bearish";
    el.style.display = "block";
    el.style.top = `${y1}px`;
    el.style.height = `${Math.max(2, y2 - y1)}px`;
    el.style.background = isBearish ? "rgba(239,83,80,0.09)" : "rgba(38,198,218,0.09)";
    el.style.borderTop = `1px solid ${isBearish ? "rgba(239,83,80,0.55)" : "rgba(38,198,218,0.55)"}`;
    el.style.borderBottom = `1px solid ${isBearish ? "rgba(239,83,80,0.55)" : "rgba(38,198,218,0.55)"}`;
  };

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
        scaleMargins: { top: 0.15, bottom: 0.15 },
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
      wickUpColor: CHART_THEME.up,
      wickDownColor: CHART_THEME.down,
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
      scaleMargins: { top: 0.85, bottom: 0 },
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

    // FVG box overlay — update pixel position on every chart pan/zoom.
    const handleFvgUpdate = () => {
      if (fvgUpdateRef.current) fvgUpdateRef.current();
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleFvgUpdate);
    chart.subscribeCrosshairMove(handleFvgUpdate);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("orientationchange", handleOrientation);
      if (observer) observer.disconnect();
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleFvgUpdate);
      } catch {
        // ignore
      }
      try {
        chart.unsubscribeCrosshairMove(handleFvgUpdate);
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

  useEffect(() => {
    // Keep ref in sync so chart-recreation effect can access current data.
    candleDataRef.current = candleData;
    if (process.env.NODE_ENV !== "production") {
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
          scaleMargins: { top: 0.15, bottom: 0.15 },
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
    const fixedMarkers = Array.isArray(markers)
      ? markers
          .map((marker) => {
            if (!marker) return null;
            const time = toSeconds(marker.time ?? marker.timestamp);
            if (!Number.isFinite(time)) return null;
            const isShort = marker.direction === "short";
            return {
              time,
              position: marker.position || (isShort ? "aboveBar" : "belowBar"),
              color: marker.color || (isShort ? CHART_THEME.down : CHART_THEME.up),
              shape: marker.shape || (isShort ? "arrowDown" : "arrowUp"),
              text: marker.text || marker.label || (isShort ? "▼ SHORT" : "▲ LONG"),
              size: 1,
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.time - b.time)
          .slice(-1)
      : [];
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
  }, [currentPrice, cleanSupport?.min, cleanSupport?.max, cleanSupport?.center, cleanResistance?.min, cleanResistance?.max, cleanResistance?.center, planValid, plan?.entry, plan?.stop, plan?.tp1, plan?.tp2, plan?.runner, showZones, poc, fvgData?.type, fvgData?.top, fvgData?.bottom]);

  // Tooltip placement — keep it inside the chart bounds. 12px nudge so it
  // doesn't sit directly under the cursor.
  const tooltipStyle = hoverCandle ? {
    background: "rgba(13, 17, 23, .94)",
    border: "1px solid rgba(110, 122, 145, 0.45)",
    borderRadius: "8px",
    color: "#d1d4dc",
    fontSize: "11px",
    fontVariantNumeric: "tabular-nums",
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
      />
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
