import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  AreaSeries,
  createSeriesMarkers,
} from "lightweight-charts";

const CHART_THEME = {
  background: "#020617",
  text: "#cbd5e1",
  grid: "rgba(148, 163, 184, 0.12)",
  border: "rgba(148, 163, 184, 0.25)",
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

function generateDemoCandles(currentPrice, count = 80) {
  const anchor = Number.isFinite(Number(currentPrice)) && Number(currentPrice) > 0 ? Number(currentPrice) : 100;
  const volatility = anchor * 0.0015;
  const nowSec = Math.floor(Date.now() / 1000);
  const startSec = nowSec - count * 60;
  let last = anchor - volatility * count * 0.05;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const time = startSec + i * 60;
    const open = last;
    const drift = Math.sin(i / 6) * volatility * 0.7 + (Math.random() - 0.5) * volatility;
    const close = Math.max(0.0001, open + drift);
    const high = Math.max(open, close) + Math.random() * volatility * 0.6;
    const low = Math.min(open, close) - Math.random() * volatility * 0.6;
    out.push({ time, open, high, low, close });
    last = close;
  }
  // ensure final close lands near currentPrice
  if (out.length) {
    const final = out[out.length - 1];
    const adjust = anchor - final.close;
    if (Math.abs(adjust) > volatility) {
      out[out.length - 1] = {
        ...final,
        close: anchor,
        high: Math.max(final.high, anchor),
        low: Math.min(final.low, anchor),
      };
    }
  }
  return out;
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
  emptyMessage = "Waiting for TradingView candle data.",
  height = 380,
  lockPriceScale = false,
  markers,
  plan,
  resetSignal = 0,
  resistanceZone,
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

  const realCandles = useMemo(() => buildCandleSeriesData(candles), [candles]);
  const usingDemo = realCandles.length < 20;
  const demoCandles = useMemo(
    () => (usingDemo ? generateDemoCandles(currentPrice, Math.max(60, 80 - realCandles.length)) : []),
    [usingDemo, currentPrice, realCandles.length],
  );
  const candleData = useMemo(() => {
    if (!usingDemo) return realCandles;
    if (!realCandles.length) return demoCandles;
    const lastDemoTime = demoCandles.length ? demoCandles[demoCandles.length - 1].time : 0;
    const offset = Math.max(0, lastDemoTime - realCandles[0].time + 60);
    const merged = [
      ...demoCandles,
      ...realCandles.map((c) => ({ ...c, time: c.time + offset })),
    ];
    return merged.sort((a, b) => a.time - b.time);
  }, [usingDemo, realCandles, demoCandles]);

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
      rightPriceScale: {
        borderColor: CHART_THEME.border,
        scaleMargins: { top: 0.15, bottom: 0.15 },
        autoScale: true,
      },
      timeScale: {
        borderColor: CHART_THEME.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
      },
      crosshair: { mode: 1 },
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
      priceLineVisible: false,
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
    upsertArea(supportAreaRef, supportZone, CHART_THEME.support);
    upsertArea(resistanceAreaRef, resistanceZone, CHART_THEME.resistance);
  }, [candleData, supportZone?.min, supportZone?.max, resistanceZone?.min, resistanceZone?.max]);

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

    ensurePriceLine(series, priceLinesRef, "supportTop", supportZone?.max ? {
      price: Number(supportZone.max),
      color: CHART_THEME.support,
      lineStyle: 0,
      lineWidth: 2,
      title: "Support ▲",
    } : null);
    ensurePriceLine(series, priceLinesRef, "supportBottom", supportZone?.min && supportZone.min !== supportZone.max ? {
      price: Number(supportZone.min),
      color: CHART_THEME.support,
      lineStyle: 0,
      lineWidth: 2,
      title: "Support ▼",
    } : null);
    ensurePriceLine(series, priceLinesRef, "resistanceTop", resistanceZone?.max ? {
      price: Number(resistanceZone.max),
      color: CHART_THEME.resistance,
      lineStyle: 0,
      lineWidth: 2,
      title: "Resistance ▲",
    } : null);
    ensurePriceLine(series, priceLinesRef, "resistanceBottom", resistanceZone?.min && resistanceZone.min !== resistanceZone.max ? {
      price: Number(resistanceZone.min),
      color: CHART_THEME.resistance,
      lineStyle: 0,
      lineWidth: 2,
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
  }, [currentPrice, supportZone?.min, supportZone?.max, resistanceZone?.min, resistanceZone?.max, plan?.entry, plan?.stop, plan?.tp1, plan?.tp2, plan?.runner]);

  return (
    <div style={{ position: "relative", width: "100%", height, touchAction: "none" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%", touchAction: "none" }} />
      {usingDemo ? (
        <div
          style={{
            background: "rgba(2, 6, 23, 0.65)",
            border: "1px solid rgba(148, 163, 184, 0.2)",
            borderRadius: "10px",
            color: "#cbd5e1",
            fontSize: "12px",
            left: "12px",
            padding: "6px 10px",
            position: "absolute",
            top: "10px",
          }}
        >
          <strong style={{ color: "#e2e8f0" }}>{symbol || "Demo"}{timeframe ? ` · ${timeframe}` : ""}</strong>
          <span style={{ color: "#94a3b8", marginLeft: "8px" }}>
            {realCandles.length === 0 ? emptyMessage : "Waiting for more TradingView candle data."}
          </span>
        </div>
      ) : null}
    </div>
  );
}
