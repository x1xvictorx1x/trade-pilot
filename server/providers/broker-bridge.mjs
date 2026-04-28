import { normalizeSymbol } from "../market-config.mjs";

const emptySnapshot = {
  accountId: "",
  accountBalance: 0,
  accountName: "",
  accountType: "",
  connected: false,
  dailyPnl: 0,
  fills: [],
  openPnl: 0,
  platform: "Not connected",
  position: null,
  quote: null,
  realizedPnl: 0,
  source: "Broker Connection",
  updatedAt: null,
  workingOrders: [],
};

function normalizeDirection(value, quantity = 0) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "long" || raw === "buy") return "long";
  if (raw === "short" || raw === "sell") return "short";
  if (quantity > 0) return "long";
  if (quantity < 0) return "short";
  return "flat";
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeQuote(payload, symbol) {
  const price = finiteNumber(payload.price ?? payload.last ?? payload.mark, null);
  if (price === null) return null;

  const bid = finiteNumber(payload.bid, price);
  const ask = finiteNumber(payload.ask, price);

  return {
    ask,
    bid,
    price,
    source: "Broker Connection",
    symbol,
    timestamp: payload.timestamp || new Date().toISOString(),
  };
}

function normalizePosition(payload, symbol) {
  if (!payload) return null;

  const quantity = finiteNumber(payload.quantity ?? payload.contracts ?? payload.size, 0);
  const direction = normalizeDirection(payload.direction ?? payload.side, quantity);
  if (direction === "flat" || quantity === 0) return null;

  const entry = finiteNumber(payload.averagePrice ?? payload.entry ?? payload.avgPrice, 0);

  return {
    brokerPositionId: payload.id || payload.positionId || "",
    contracts: Math.abs(quantity),
    direction,
    entry,
    lastAction: "Synced from broker connection",
    openPnl: finiteNumber(payload.openPnl ?? payload.unrealizedPnl, 0),
    status: payload.status || "active",
    stop: Number.isFinite(Number(payload.stop)) ? Number(payload.stop) : null,
    symbol,
    target: Number.isFinite(Number(payload.target)) ? Number(payload.target) : null,
    timestamp: payload.timestamp || new Date().toISOString(),
  };
}

function normalizeFill(fill, fallbackSymbol) {
  const symbol = normalizeSymbol(fill.symbol || fallbackSymbol);
  const quantity = finiteNumber(fill.quantity ?? fill.contracts ?? fill.size, 0);

  return {
    id: fill.id || fill.executionId || `${symbol}-${Date.now()}`,
    price: finiteNumber(fill.price ?? fill.fillPrice, 0),
    quantity: Math.abs(quantity),
    side: normalizeDirection(fill.side ?? fill.direction, quantity),
    source: "Broker Connection",
    symbol,
    timestamp: fill.timestamp || new Date().toISOString(),
  };
}

function normalizeWorkingOrder(order, fallbackSymbol) {
  const symbol = normalizeSymbol(order.symbol || fallbackSymbol);
  const quantity = finiteNumber(order.quantity ?? order.contracts ?? order.size, 0);

  return {
    id: order.id || order.orderId || `${symbol}-working-${Date.now()}`,
    price: finiteNumber(order.price ?? order.limitPrice ?? order.stopPrice, 0),
    quantity: Math.abs(quantity),
    side: normalizeDirection(order.side ?? order.direction, quantity),
    status: order.status || "working",
    symbol,
    timestamp: order.timestamp || new Date().toISOString(),
    type: order.type || order.orderType || "unknown",
  };
}

export function createBrokerBridge() {
  let snapshot = { ...emptySnapshot };
  const clients = new Set();

  const publish = () => {
    const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const response of clients) response.write(payload);
  };

  return {
    getSnapshot() {
      return snapshot;
    },

    applyPayload(payload = {}) {
      const positionPayload = payload.position || payload;
      const symbol = normalizeSymbol(positionPayload.symbol || payload.symbol);
      const quote = normalizeQuote(payload.quote || payload, symbol);
      const position = normalizePosition(positionPayload, symbol);
      const fills = Array.isArray(payload.fills)
        ? payload.fills.map((fill) => normalizeFill(fill, symbol)).slice(-50)
        : snapshot.fills;
      const workingOrders = Array.isArray(payload.workingOrders)
        ? payload.workingOrders.map((order) => normalizeWorkingOrder(order, symbol)).slice(-50)
        : snapshot.workingOrders;
      const openPnl = finiteNumber(payload.openPnl ?? payload.unrealizedPnl ?? position?.openPnl, snapshot.openPnl);
      const realizedPnl = finiteNumber(payload.realizedPnl, snapshot.realizedPnl);
      const dailyPnl = finiteNumber(payload.dailyPnl ?? payload.dailyPnL ?? payload.todayPnl ?? payload.todayPnL, openPnl + realizedPnl);
      const accountBalance = finiteNumber(payload.accountBalance ?? payload.balance, snapshot.accountBalance);

      snapshot = {
        accountId: payload.accountId || snapshot.accountId,
        accountBalance,
        accountName: payload.accountName || snapshot.accountName,
        accountType: payload.accountType || snapshot.accountType,
        connected: true,
        dailyPnl,
        fills,
        openPnl,
        platform: payload.platform || snapshot.platform || "Broker Bridge",
        position,
        quote,
        realizedPnl,
        source: "Broker Connection",
        updatedAt: payload.timestamp || new Date().toISOString(),
        workingOrders,
      };

      publish();
      return snapshot;
    },

    stream(request, response) {
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream",
      });

      clients.add(response);
      response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      request.on("close", () => clients.delete(response));
    },
  };
}
