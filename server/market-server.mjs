import http from "node:http";
import { marketDefaults, normalizeSymbol, quoteFromBase } from "./market-config.mjs";
import { createBrokerBridge } from "./providers/broker-bridge.mjs";
import {
  authenticateTradovate,
  createTradovateReadOnlyProvider,
  findTradovateContract,
  getTradovateAccounts,
  getTradovateChart,
  getTradovateFills,
  getTradovateMarketPrice,
  getTradovateMe,
  getTradovateOrders,
  getTradovatePositions,
  testTradovateDemoAuth,
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
    connected: true,
    connectionStatus: "Demo Broker Connected",
    dailyPnl: openPnl,
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
    source: "Simulated demo data",
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

function normalizeTradovateMode(value) {
  const mode = String(value || "demo").toLowerCase();
  if (mode === "prop" || mode === "funded") return "prop";
  if (mode === "live") return "live";
  return "demo";
}

function getTradovatePlatformLabel(mode) {
  if (mode === "prop" || mode === "funded") return "Tradovate Prop/Funded Read-Only";
  if (mode === "live") return "Tradovate Live Read-Only";
  return "Tradovate Demo Read-Only";
}

function normalizeTradovateSnapshot({ accounts = [], fills = [], market = {}, mode, orders = [], positions = [], symbol }) {
  const normalizedSymbol = normalizeSymbol(symbol);
  const account = Array.isArray(accounts) ? accounts[0] || {} : accounts;
  const positionList = Array.isArray(positions) ? positions : [];
  const orderList = Array.isArray(orders) ? orders : [];
  const fillList = Array.isArray(fills) ? fills : [];
  const position = positionList.find((item) => normalizeSymbol(item.symbol || item.contractName || item.contract?.name || normalizedSymbol) === normalizedSymbol) || positionList[0];
  const fallbackQuote = quoteFromBase(normalizedSymbol, latestQuotes.get(normalizedSymbol)?.price ?? marketDefaults[normalizedSymbol]);
  const quote = market.quote
    ? {
        ask: Number(market.quote.ask ?? market.quote.price ?? fallbackQuote.ask),
        bid: Number(market.quote.bid ?? market.quote.price ?? fallbackQuote.bid),
        price: Number(market.quote.price ?? fallbackQuote.price),
        source: "Tradovate Market Data",
        symbol: normalizedSymbol,
        timestamp: new Date().toISOString(),
      }
    : fallbackQuote;
  const size = Number(position?.netPos ?? position?.quantity ?? position?.contracts ?? 0);
  const entry = Number(position?.netPrice ?? position?.averagePrice ?? position?.entryPrice ?? quote.price);
  const workingOrders = orderList.filter((order) => {
    const status = String(order.ordStatus || order.status || "").toLowerCase();
    return status.includes("working") || status.includes("submitted") || status.includes("accepted") || (!status.includes("filled") && !status.includes("cancel"));
  });
  const openPnl = Number(position?.openPnl ?? position?.unrealizedPnl ?? position?.pnl ?? position?.profitAndLoss ?? 0);
  const realizedPnl = Number(account.realizedPnl ?? account.realizedPnL ?? account.realizedProfitLoss ?? 0);
  const accountOpenPnl = Number(account.openPnl) || 0;
  const dailyPnlRaw = account.dailyPnl ?? account.dailyPnL ?? account.todayPnl ?? account.todayPnL ?? (accountOpenPnl + realizedPnl);
  const dailyPnl = Number.isFinite(Number(dailyPnlRaw)) ? Number(dailyPnlRaw) : openPnl + realizedPnl;
  const accountBalance = Number(account.cashBalance ?? account.netLiq ?? account.balance ?? account.netLiquidation ?? account.netLiquidatingValue ?? 0);
  const accountId = account.id ? String(account.id) : account.accountId ? String(account.accountId) : account.name || "";

  return {
    accountBalance,
    accountId,
    accountName: account.name || account.nickname || accountId || "Tradovate Account",
    accountType: mode === "prop" || mode === "funded" ? "funded/prop" : mode === "live" ? "personal live" : "demo",
    ask: quote.ask,
    bid: quote.bid,
    dailyPnl,
    fills: fillList,
    openPnl,
    platform: getTradovatePlatformLabel(mode),
    position: size
      ? {
          averagePrice: entry,
          contracts: Math.abs(size),
          direction: size > 0 ? "long" : "short",
          entry,
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

async function buildTradovateSnapshot(mode, symbol) {
  const accounts = await getTradovateAccounts(mode);
  const account = Array.isArray(accounts) ? accounts[0] : accounts;
  const accountId = account?.id || account?.accountId || "";
  const [positions, orders, fills, market] = await Promise.all([
    getTradovatePositions(mode, accountId),
    getTradovateOrders(mode),
    getTradovateFills(mode),
    getTradovateMarketPrice(mode, symbol),
  ]);
  const snapshot = brokerBridge.applyPayload(normalizeTradovateSnapshot({ accounts, fills, market, mode, orders, positions, symbol }));
  if (snapshot.quote) latestQuotes.set(snapshot.quote.symbol, snapshot.quote);
  return { accounts, fills, market, orders, positions, snapshot };
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
      accountName: snapshot.accountName,
      accountType: snapshot.accountType,
      connected: snapshot.connected,
      dailyPnl: snapshot.dailyPnl,
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

  if (request.method === "POST" && url.pathname === "/api/tradovate/demo/auth") {
    const payload = await readBody(request);
    sendJson(response, 200, await testTradovateDemoAuth(payload));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/demo/accounts") {
    sendJson(response, 200, await getTradovateAccounts("demo"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/demo/positions") {
    let accountId = url.searchParams.get("accountId") || url.searchParams.get("masterid");
    if (!accountId) {
      const accounts = await getTradovateAccounts("demo");
      const account = Array.isArray(accounts) ? accounts[0] : accounts;
      accountId = account?.id || account?.accountId || "";
    }
    sendJson(response, 200, await getTradovatePositions("demo", accountId));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/demo/fills") {
    sendJson(response, 200, await getTradovateFills("demo"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/demo/contract") {
    sendJson(response, 200, await findTradovateContract("demo", url.searchParams.get("name") || url.searchParams.get("symbol") || "MNQ"));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/demo/chart") {
    sendJson(response, 200, await getTradovateChart("demo", url.searchParams.get("name") || url.searchParams.get("symbol") || "MNQ", {
      bars: url.searchParams.get("bars"),
      elementSize: url.searchParams.get("elementSize"),
    }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/demo/quote") {
    sendJson(response, 200, await getTradovateMarketPrice("demo", url.searchParams.get("name") || url.searchParams.get("symbol") || "MNQ"));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/tradovate/auth") {
    const payload = await readBody(request);
    const mode = normalizeTradovateMode(payload.mode || payload.accountType);
    const token = await authenticateTradovate(mode);
    sendJson(response, 200, {
      accountType: token.accountType,
      connected: true,
      endpoint: token.endpoint.apiBase,
      hasLive: token.hasLive,
      hasMarketData: token.hasMarketData,
      mode: token.mode,
      ordersEnabled: false,
      tokenStatus: "server-only",
      userStatus: token.userStatus,
      websocket: token.endpoint.mdSocket,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/me") {
    sendJson(response, 200, await getTradovateMe(url.searchParams.get("mode")));
    return;
  }

  if (request.method === "GET" && (url.pathname === "/api/tradovate/account" || url.pathname === "/api/tradovate/accounts")) {
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

  if (request.method === "GET" && url.pathname === "/api/tradovate/fills") {
    sendJson(response, 200, await getTradovateFills(url.searchParams.get("mode")));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/tradovate/contract") {
    sendJson(response, 200, await findTradovateContract(url.searchParams.get("mode"), url.searchParams.get("symbol")));
    return;
  }

  if (request.method === "GET" && (url.pathname === "/api/tradovate/market-price" || url.pathname === "/api/tradovate/quote" || url.pathname === "/api/tradovate/price")) {
    const mode = normalizeTradovateMode(url.searchParams.get("mode"));
    const symbol = normalizeSymbol(url.searchParams.get("symbol"));
    const { market, snapshot } = await buildTradovateSnapshot(mode, symbol);
    sendJson(response, 200, { market, snapshot });
    return;
  }

  if (request.method === "POST" && (url.pathname === "/api/tradingview/webhook" || url.pathname === "/api/webhook/tradingview")) {
    const payload = await readBody(request);
    const symbol = normalizeSymbol(payload.symbol);
    const price = Number(payload.price);
    const quote = {
      ask: Number((price + 0.25).toFixed(2)),
      bid: Number((price - 0.25).toFixed(2)),
      price,
      bias: payload.bias,
      signalType: payload.signalType || payload.bias,
      source: "TradingView Webhook",
      support: Number(payload.support),
      resistance: Number(payload.resistance),
      symbol,
      timestamp: payload.timestamp || new Date().toISOString(),
      timeframe: payload.timeframe,
    };
    latestQuotes.set(symbol, quote);
    const snapshot = brokerBridge.applyPayload({
      platform: "TradingView Webhook",
      quote,
      signalType: payload.signalType || payload.bias,
      source: "TradingView Webhook",
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
