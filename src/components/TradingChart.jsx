import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  AreaSeries,
  createSeriesMarkers,
} from "lightweight-charts";

// TradingView-style dark palette: dim background, low-contrast grid, bright wicks.
const CHART_THEME = {
  background: "#0b1015",
  text: "#d1d4dc",
  grid: "rgba(54, 60, 78, 0.45)",
  border: "rgba(74, 85, 104, 0.6)",
  up: "#26a69a",
  down: "#ef5350",
  support: "#26a69a",
  resistance: "#ef5350",
  entry: "#38bdf8",
  stop: "#f97316",
  tp: "#22c55e",
  runner: "#a855f7",
  price: "#facc15",
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
  if (!Array.isArray(candles)) return { data: [], expanded: 0 };
  const symbol = options.symbol || "";
  const seen = new Map();
  let expanded = 0;
  for (const candle of candles) {
    if (!candle) continue;
    const time = toSeconds(candle.timestamp ?? candle.time);
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;
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
  emptyMessage = "Collecting TradingView candle data…",
  height = 480,
  lockPriceScale = false,
  markers,
  plan,
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

  const built = useMemo(() => buildCandleSeriesData(candles, { symbol }), [candles, symbol]);
  const realCandles = useMemo(() => {
    // Hard-cap to last 300 candles — keeps the chart snappy and matches the
    // history pipeline's MAX_CANDLES_PER_KEY.
    return built.data.length > 300 ? built.data.slice(built.data.length - 300) : built.data;
  }, [built]);
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
        vertLines: { color: CHART_THEME.grid, style: 1 },
        horzLines: { color: CHART_THEME.grid, style: 1 },
      },
      rightPriceScale: {
        borderColor: CHART_THEME.border,
        scaleMargins: { top: 0.1, bottom: 0.12 },
        autoScale: true,
        entireTextOnly: true,
      },
      timeScale: {
        borderColor: CHART_THEME.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 8,
        minBarSpacing: 2,
      },
      crosshair: {
        mode: 1,
        vertLine: { color: CHART_THEME.border, width: 1, style: 3, labelBackgroundColor: "#1a1f2e" },
        horzLine: { color: CHART_THEME.border, width: 1, style: 3, labelBackgroundColor: "#1a1f2e" },
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

    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    // ResizeObserver gives us responsive resizing when the parent layout
    // changes (sidebar collapse, drawer open) — not just window resize.
    let observer = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(handleResize);
      observer.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      if (observer) observer.disconnect();
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
      priceLinesRef.current = {};
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(candleData);
    if (!hasInitiallyFitRef.current && candleData.length && chartRef.current && autoFit) {
      chartRef.current.timeScale().fitContent();
      hasInitiallyFitRef.current = true;
    }
  }, [candleData, autoFit]);

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
    const fixedMarkers = Array.isArray(markers)
      ? markers
          .map((marker) => {
            if (!marker) return null;
            const time = toSeconds(marker.time ?? marker.timestamp);
            if (!Number.isFinite(time)) return null;
            return {
              time,
              position: marker.position || (marker.direction === "short" ? "aboveBar" : "belowBar"),
              color: marker.color || (marker.direction === "short" ? CHART_THEME.down : CHART_THEME.up),
              shape: marker.shape || (marker.direction === "short" ? "arrowDown" : "arrowUp"),
              text: marker.text || marker.label || "",
            };
          })
          .filter(Boolean)
          .sort((a, b) => a.time - b.time)
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
      lineWidth: 1,
      title: "Price",
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
  }, [currentPrice, cleanSupport?.min, cleanSupport?.max, cleanSupport?.center, cleanResistance?.min, cleanResistance?.max, cleanResistance?.center, planValid, plan?.entry, plan?.stop, plan?.tp1, plan?.tp2, plan?.runner, showZones]);

  return (
    <div style={{ position: "relative", width: "100%", height, touchAction: "none" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", touchAction: "none" }} />
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
            top: "10px",
          }}
        >
          Visual range enhanced
        </div>
      ) : null}
      {waitingForCandles ? (
        <div
          style={{
            alignItems: "center",
            background: "rgba(11, 16, 21, 0.86)",
            border: "1px solid rgba(74, 85, 104, 0.55)",
            borderRadius: "12px",
            color: "#d1d4dc",
            display: "flex",
            flexDirection: "column",
            fontSize: "13px",
            gap: "4px",
            left: "50%",
            padding: "12px 16px",
            position: "absolute",
            top: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
            minWidth: "240px",
          }}
        >
          <strong style={{ color: "#e2e8f0", fontSize: "13px", letterSpacing: ".04em" }}>
            {symbol || "Live"}{timeframe ? ` · ${timeframe}` : ""}
          </strong>
          <span style={{ color: "#94a3b8" }}>
            {emptyMessage}
          </span>
          <span style={{ color: "#64748b", fontSize: "11px" }}>
            {realCandles.length} / {MIN_CANDLES_FOR_LIVE} candles received
          </span>
        </div>
      ) : null}
    </div>
  );
}
