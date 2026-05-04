import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
} from "lightweight-charts";

const CHART_THEME = {
  background: "rgba(2, 6, 23, 0)",
  text: "#cbd5e1",
  grid: "rgba(148, 163, 184, 0.06)",
  border: "rgba(148, 163, 184, 0.2)",
  up: "#10b981",
  down: "#ef4444",
  support: "#10b981",
  resistance: "#ef4444",
  entry: "#38bdf8",
  stop: "#f97316",
  tp: "#22c55e",
  runner: "#a855f7",
  price: "#facc15",
};

function toSeconds(value) {
  if (value === null || value === undefined) return null;
  const millis = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(millis)) return null;
  return Math.floor(millis / 1000);
}

function buildCandleSeriesData(candles) {
  if (!Array.isArray(candles)) return [];
  const seen = new Map();
  for (const candle of candles) {
    if (!candle) continue;
    const time = toSeconds(candle.timestamp ?? candle.time);
    const open = Number(candle.open);
    const high = Number(candle.high);
    const low = Number(candle.low);
    const close = Number(candle.close);
    if (!Number.isFinite(time) || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;
    seen.set(time, { time, open, high, low, close });
  }
  return Array.from(seen.values()).sort((a, b) => a.time - b.time);
}

function ensurePriceLine(series, ref, key, options) {
  if (!series) return;
  const existing = ref.current[key];
  if (!options || !Number.isFinite(Number(options.price))) {
    if (existing) {
      try {
        series.removePriceLine(existing);
      } catch {
        // Already removed.
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
  candles,
  currentPrice,
  supportZone,
  resistanceZone,
  plan,
  markers,
  symbol,
  timeframe,
  height = 380,
  emptyMessage = "Waiting for TradingView candle data.",
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const markersRef = useRef(null);
  const priceLinesRef = useRef({});

  const candleData = useMemo(() => buildCandleSeriesData(candles), [candles]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: CHART_THEME.background },
        textColor: CHART_THEME.text,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: CHART_THEME.grid },
        horzLines: { color: CHART_THEME.grid },
      },
      rightPriceScale: { borderColor: CHART_THEME.border },
      timeScale: { borderColor: CHART_THEME.border, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: CHART_THEME.up,
      downColor: CHART_THEME.down,
      borderUpColor: CHART_THEME.up,
      borderDownColor: CHART_THEME.down,
      wickUpColor: CHART_THEME.up,
      wickDownColor: CHART_THEME.down,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      try {
        chart.remove();
      } catch {
        // Already disposed.
      }
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
      priceLinesRef.current = {};
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(candleData);
    if (candleData.length && chartRef.current) {
      chartRef.current.timeScale().fitContent();
    }
  }, [candleData]);

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
    const priceLines = priceLinesRef.current;

    ensurePriceLine(series, priceLinesRef, "currentPrice", Number.isFinite(Number(currentPrice)) ? {
      price: Number(currentPrice),
      color: CHART_THEME.price,
      lineStyle: 0,
      lineWidth: 1,
      title: "Price",
    } : null);

    ensurePriceLine(series, priceLinesRef, "supportTop", supportZone?.max ? {
      price: Number(supportZone.max),
      color: CHART_THEME.support,
      lineStyle: 2,
      lineWidth: 1,
      title: "Support ▲",
    } : null);
    ensurePriceLine(series, priceLinesRef, "supportBottom", supportZone?.min ? {
      price: Number(supportZone.min),
      color: CHART_THEME.support,
      lineStyle: 2,
      lineWidth: 1,
      title: "Support ▼",
    } : null);
    ensurePriceLine(series, priceLinesRef, "resistanceTop", resistanceZone?.max ? {
      price: Number(resistanceZone.max),
      color: CHART_THEME.resistance,
      lineStyle: 2,
      lineWidth: 1,
      title: "Resistance ▲",
    } : null);
    ensurePriceLine(series, priceLinesRef, "resistanceBottom", resistanceZone?.min ? {
      price: Number(resistanceZone.min),
      color: CHART_THEME.resistance,
      lineStyle: 2,
      lineWidth: 1,
      title: "Resistance ▼",
    } : null);

    ensurePriceLine(series, priceLinesRef, "entry", plan?.entry ? {
      price: Number(plan.entry),
      color: CHART_THEME.entry,
      lineStyle: 0,
      lineWidth: 2,
      title: "Entry",
    } : null);
    ensurePriceLine(series, priceLinesRef, "stop", plan?.stop ? {
      price: Number(plan.stop),
      color: CHART_THEME.stop,
      lineStyle: 0,
      lineWidth: 2,
      title: "Stop",
    } : null);
    ensurePriceLine(series, priceLinesRef, "tp1", plan?.tp1 ? {
      price: Number(plan.tp1),
      color: CHART_THEME.tp,
      lineStyle: 0,
      lineWidth: 1,
      title: "TP1",
    } : null);
    ensurePriceLine(series, priceLinesRef, "tp2", plan?.tp2 ? {
      price: Number(plan.tp2),
      color: CHART_THEME.tp,
      lineStyle: 0,
      lineWidth: 1,
      title: "TP2",
    } : null);
    ensurePriceLine(series, priceLinesRef, "runner", plan?.runner ? {
      price: Number(plan.runner),
      color: CHART_THEME.runner,
      lineStyle: 0,
      lineWidth: 1,
      title: "Runner",
    } : null);

    return () => {
      // do not clear lines on every render; cleanup happens on unmount
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPrice, supportZone?.min, supportZone?.max, resistanceZone?.min, resistanceZone?.max, plan?.entry, plan?.stop, plan?.tp1, plan?.tp2, plan?.runner]);

  const showEmptyState = candleData.length === 0;

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {showEmptyState ? (
        <div
          style={{
            alignItems: "center",
            background: "rgba(2, 6, 23, 0.8)",
            borderRadius: "12px",
            color: "#94a3b8",
            display: "flex",
            flexDirection: "column",
            fontSize: "13px",
            gap: "6px",
            inset: 0,
            justifyContent: "center",
            padding: "24px",
            position: "absolute",
            textAlign: "center",
          }}
        >
          <strong style={{ color: "#e2e8f0", fontSize: "14px" }}>{symbol || "No symbol"}{timeframe ? ` · ${timeframe}` : ""}</strong>
          <span>{emptyMessage}</span>
          <span style={{ color: "#64748b", fontSize: "12px" }}>
            Add the Trade Pilot Signal Engine indicator on TradingView and create an alert with the OHLCV webhook payload.
          </span>
        </div>
      ) : null}
    </div>
  );
}
