export const marketDefaults = {
  MNQ: 27500,
  NQ: 27500,
  ES: 6400,
  MES: 6400,
  YM: 47000,
  RTY: 2300,
  CL: 82,
  GC: 2400,
  BTC: 65000,
  ETH: 3200,
  SPY: 640,
  QQQ: 560,
};

export function normalizeSymbol(symbol) {
  const normalized = String(symbol || "MNQ").trim().toUpperCase();
  return marketDefaults[normalized] ? normalized : "MNQ";
}

export function quoteFromBase(symbol, previousPrice) {
  const base = marketDefaults[symbol] ?? marketDefaults.MNQ;
  const tick = base > 1000 ? 0.25 : 0.01;
  const spread = base > 1000 ? 0.5 : 0.02;
  const anchor = Number.isFinite(previousPrice) ? previousPrice : base;
  const maxMove = base > 1000 ? 1.25 : base > 100 ? 0.08 : 0.03;
  const raw = anchor + (Math.random() - 0.5) * maxMove;
  const price = Number((Math.round(raw / tick) * tick).toFixed(2));

  return {
    ask: Number((price + spread / 2).toFixed(2)),
    bid: Number((price - spread / 2).toFixed(2)),
    price,
    source: "Mock Market Data API",
    symbol,
    timestamp: new Date().toISOString(),
  };
}
