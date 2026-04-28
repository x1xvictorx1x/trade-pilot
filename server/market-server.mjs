import http from "node:http";
import { marketDefaults, normalizeSymbol, quoteFromBase } from "./market-config.mjs";
import { createBrokerBridge } from "./providers/broker-bridge.mjs";
import {
  authenticateTradovate,
  createTradovateReadOnlyProvider,
  getTradovateAccounts,
  getTradovateMarketPrice,
  getTradovateOrders,
  getTradovatePositions,
} from "./providers/tradovate-readonly.mjs";

const port = Number(process.env.TRADE_PILOT_MARKET_PORT || 8787);
const brokerBridgeToken = process.env.TRADE_PILOT_BROKER_BRIDGE_TOKEN || "";
const latestQuotes = new Map();
const brokerBridge = createBrokerBridge();
const tradovateProvider = createTradovateReadOnlyProvider();
const subscribers = [];
const demoBrokerState = {
  accountBalance: 50000,
  accountId: "DEMO-SIM-001",
  entry: 27455,
  fills: [],
  price: 27462,
  realizedPnl: 0,
  symbol: "MNQ",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
}

function sendError(response, error) {
  sendJson(response, error.status || 500, { error: error.message || "Server error" });
}

function getQuote(symbol) {
  const normalized = normalizeSymbol(symbol);
  const previous = latestQuotes.get(normalized);
  const quote = quoteFromBase(normalized, previous?.price ?? marketDefaults[normalized]);
  latestQuotes.set(normalized, quote);
  return quote;
}

function streamQuotes(request, response, url) {
  const symbol = normalizeSymbol(url.searchParams.get("symbol"));

  response.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
  });

  const writeQuote = () => {
    response.write(`event: quote\n`);
    response.write(`data: ${JSON.stringify(getQuote(symbol))}\n\n`);
  };

  writeQuote();
  const timer = setInterval(writeQuote, 1000);
  request.on("close", () => clearInterval(timer));
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function hasBrokerBridgeAccess(request) {
  if (!brokerBridgeToken) return true;
  const headerToken = request.headers["x-trade-pilot-token"];
  const authHeader = request.headers.authorization || "";
  return headerToken === brokerBridgeToken || authHeader === `Bearer ${brokerBridgeToken}`;
}

function createDemoBrokerSnapshot(symbolInput) {
  const symbol = normalizeSymbol(symbolInput || demoBrokerState.symbol);
  const base = demoBrokerState.price || marketDefaults[symbol];
  const tick = base > 1000 ? 0.25 : 0.01;
  const nextPrice = Number((Math.round((base + (Math.random() - 0.48) * 3) / tick) * tick).toFixed(2));
  const contracts = 1;
  const pointValue = symbol === "MNQ" ? 2 : symbol === "NQ" ? 20 : symbol === "MES" ? 5 : 1;
  const openPnl = Number(((nextPrice - demoBrokerState.entry) * contracts * pointValue).toFixed(2));

  demoBrokerState.price = nextPrice;
  demoBrokerState.symbol = symbol;

  return {
    accountBalance: demoBrokerState.accountBalance + demoBrokerState.realizedPnl + openPnl,
    accountId: demoBrokerState.accountId,
    ask: Number((nextPrice + tick).toFixed(2)),
    bid: Number((nextPrice - tick).toFixed(2)),
    fills: demoBrokerState.fills.length
      ? demoBrokerState.fills
      : [
          {
            id: "demo-entry-1",
            price: demoBrokerState.entry,
            quantity: contracts,
            side: "buy",
            symbol,
          },
        ],
    openPnl,
    platform: "Demo Broker",
    position: {
      averagePrice: demoBrokerState.entry,
      direction: "long",
      openPnl,
      quantity: contracts,
      status: "active",
      symbol,
    },
    price: nextPrice,
    realizedPnl: demoBrokerState.realizedPnl,
    symbol,
    timestamp: new Date().toISOString(),
    workingOrders: [
      {
        id: "demo-stop-1",
        price: demoBrokerState.entry - 20,
        quantity: contracts,
        side: "sell",
        status: "working",
        symbol,
        type: "stop",
      },
    ],
  };
}

function sendTradovateReadOnlyPlan(response) {
  sendJson(response, 200, {
    connected: false,
    mode: "read-only",
    provider: "Tradovate",
    endpoints: tradovateProvider.endpoints,
    reads: tradovateProvider.capabilities,
    security: "Credentials and OAuth/API tokens stay on the backend. Order placement endpoints are intentionally not implemented.",
    tradingActionsEnabled: false,
  });
}

function normalizeTradovateSnapshot({ accounts = [], mode, orders = [], positions = [], symbol }) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const account = accounts[0] || {};
  const position = positions.find((item) => normalizeSymbol(item.symbol || item.contractName || normalizedSymbol) === normalizedSymbol) || positions[0];
  const quote = quoteFromBase(normalizedSymbol, latestQuotes.get(normalizedSymbol)?.price ?? marketDefaults[normalizedSymbol]);
  const size = Number(position?.netPos ?? position?.quantity ?? position?.contracts ?? 0);
  const entry = Number(position?.netPrice ?? position?.averagePrice ?? position?.entryPrice ?? quote.price);
  const workingOrders = orders.filter((order) => !String(order.ordStatus || order.status || "").toLowerCase().includes("filled"));
  const fills = orders.filter((order) => String(order.ordStatus || order.status || "").toLowerCase().includes("filled"));
  const openPnl = Number(position?.openPnl ?? position?.unrealizedPnl ?? position?.pnl ?? 0);
  const realizedPnl = Number(account.realizedPnl ?? account.realizedPnL ?? 0);

  return {
    accountBalance: Number(account.cashBalance ?? account.netLiq ?? account.balance ?? 0),
    accountId: account.id ? String(account.id) : "",
    ask: quote.ask,
    bid: quote.bid,
    fills,
    openPnl,
    platform: mode === "live" ? "Tradovate Live Read-Only" : "Tradovate Demo Read-Only",
    position: size
      ? {
          averagePrice: entry,
          direction: size > 0 ? "long" : "short",
          openPnl,
          quantity: Math.abs(size),
          status: "active",
          symbol: normalizedSymbol,
        }
      : null,
    price: quote.price,
    realizedPnl,
    symbol: normalizedSymbol,
    timestamp: new Date().toISOString(),
    workingOrders,
  };
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/market/quote") {
      sendJson(response, 200, getQuote(url.searchParams.get("symbol")));
      return;
    }

  if (request.method === "GET" && url.pathname === "/api/market/stream") {
    streamQuotes(request, response, url);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/broker/status") {
    const snapshot = brokerBridge.getSnapshot();
    sendJson(response, 200, {
      accountId: snapshot.accountId,
      accountBalance: snapshot.accountBalance,
      connected: snapshot.connected,
      dataSource: snapshot.source,
      openPnl: snapshot.openPnl,
      platform: snapshot.platform,
      realizedPnl: snapshot.realizedPnl,
      updatedAt: snapshot.updatedAt,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/broker/snapshot") {
    sendJson(response, 200, brokerBridge.getSnapshot());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/broker/stream") {
    brokerBridge.stream(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/broker/sync") {
    if (!hasBrokerBridgeAccess(request)) {
      sendJson(response, 401, { error: "Broker bridge token is required." });
      return;
    }

    const payload = await readBody(request);
    const snapshot = brokerBridge.applyPayload(payload);
    if (snapshot.quote) latestQuotes.set(snapshot.quote.symbol, snapshot.quote);
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/broker/demo/start") {
    const payload = await readBody(request);
    const snapshot = brokerBridge.applyPayload(createDemoBrokerSnapshot(payload.symbol));
    if (snapshot.quote) latestQuotes.set(snapshot.quote.symbol, snapshot.quote);
    sendJson(response, 200, { ok: true, snapshot });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/broker/demo/tick") {
    const snapshot = brokerBridge.applyPayload(createDemoBrokerSnapshot(url.searchParams.get("symbol")));
    if (snapshot.quote) latestQuotes.set(snapshot.quote.symbol, snapshot.quote);
    sendJson(response, 200, snapshot);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/read-only/status") {
    sendTradovateReadOnlyPlan(response);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/auth") {
    const token = await authenticateTradovate(url.searchParams.get("mode"));
    sendJson(response, 200, {
      connected: true,
      endpoint: token.endpoint.apiBase,
      mode: token.mode,
      ordersEnabled: false,
      tokenStatus: "server-only",
      websocket: token.endpoint.mdSocket,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/account") {
    sendJson(response, 200, await getTradovateAccounts(url.searchParams.get("mode")));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/positions") {
    sendJson(response, 200, await getTradovatePositions(url.searchParams.get("mode")));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/orders") {
    sendJson(response, 200, await getTradovateOrders(url.searchParams.get("mode")));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/market-price") {
    const mode = url.searchParams.get("mode") === "live" ? "live" : "demo";
    const symbol = normalizeSymbol(url.searchParams.get("symbol"));
    const [accounts, positions, orders, market] = await Promise.all([
      getTradovateAccounts(mode),
      getTradovatePositions(mode),
      getTradovateOrders(mode),
      getTradovateMarketPrice(mode, symbol),
    ]);
    const snapshot = brokerBridge.applyPayload(normalizeTradovateSnapshot({ accounts, mode, orders, positions, symbol }));
    if (snapshot.quote) latestQuotes.set(snapshot.quote.symbol, snapshot.quote);
    sendJson(response, 200, { market, snapshot });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/tradingview/webhook") {
    const payload = await readBody(request);
    const symbol = normalizeSymbol(payload.symbol);
    const price = Number(payload.price);
    const quote = {
      ask: Number((price + 0.25).toFixed(2)),
      bid: Number((price - 0.25).toFixed(2)),
      price,
      signalType: payload.signalType,
      source: "TradingView Alerts",
      support: Number(payload.support),
      resistance: Number(payload.resistance),
      symbol,
      timestamp: payload.timestamp || new Date().toISOString(),
    };
    latestQuotes.set(symbol, quote);
    const snapshot = brokerBridge.applyPayload({
      platform: "TradingView Webhook",
      quote,
      signalType: payload.signalType,
      source: "TradingView Alerts",
      symbol,
      timestamp: quote.timestamp,
    });
    sendJson(response, 200, { ok: true, quote, snapshot });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/subscribe") {
    const payload = await readBody(request);
    const email = String(payload.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      sendJson(response, 400, { error: "Valid email is required." });
      return;
    }
    const subscriber = {
      email,
      market: payload.market || payload.marketTraded || "MNQ",
      timestamp: payload.timestamp || new Date().toISOString(),
      traderType: payload.traderType || "intermediate",
    };
    subscribers.unshift(subscriber);
    sendJson(response, 200, { ok: true, subscriber });
    return;
  }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendError(response, error);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Trade Pilot market data server running at http://127.0.0.1:${port}`);
  console.log("Read-only mode: this server reads market/broker data and never places trades.");
});
