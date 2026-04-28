const endpoints = {
  demo: {
    apiBase: "https://demo.tradovateapi.com/v1",
    apiSocket: "wss://demo.tradovateapi.com/v1/websocket",
    mdSocket: "wss://md-demo.tradovateapi.com/v1/websocket",
  },
  live: {
    apiBase: "https://live.tradovateapi.com/v1",
    apiSocket: "wss://live.tradovateapi.com/v1/websocket",
    mdSocket: "wss://md.tradovateapi.com/v1/websocket",
  },
};

const tokenCache = new Map();
const renewWindowMs = 15 * 60 * 1000;

function getMode(mode) {
  const envMode = String(process.env.TRADOVATE_ENV || "demo").toLowerCase();
  if (mode === "prop" || mode === "funded" || envMode === "prop" || envMode === "funded") return "prop";
  if (mode === "live" || envMode === "live") return "live";
  return "demo";
}

function getConfig(mode) {
  const envPrefix = mode === "prop" ? "TRADOVATE_PROP" : mode === "live" ? "TRADOVATE_LIVE" : "TRADOVATE";
  return {
    appId: process.env[`${envPrefix}_APP_ID`] || process.env.TRADOVATE_APP_ID || "TradePilot",
    appVersion: process.env[`${envPrefix}_APP_VERSION`] || process.env.TRADOVATE_APP_VERSION || "0.1.0",
    cid: process.env[`${envPrefix}_CID`] || process.env.TRADOVATE_CID || process.env[`${envPrefix}_CLIENT_ID`] || process.env.TRADOVATE_CLIENT_ID,
    deviceId: process.env[`${envPrefix}_DEVICE_ID`] || process.env.TRADOVATE_DEVICE_ID || "trade-pilot-local",
    name: process.env[`${envPrefix}_USERNAME`] || process.env.TRADOVATE_USERNAME,
    sec: process.env[`${envPrefix}_SEC`] || process.env.TRADOVATE_SEC || process.env[`${envPrefix}_CLIENT_SECRET`] || process.env.TRADOVATE_CLIENT_SECRET,
    password: process.env[`${envPrefix}_API_PASSWORD`] || process.env.TRADOVATE_API_PASSWORD || process.env[`${envPrefix}_PASSWORD`] || process.env.TRADOVATE_PASSWORD,
  };
}

function ensureConfigured(config) {
  const missing = Object.entries(config)
    .filter(([key, value]) => key !== "deviceId" && !value)
    .map(([key]) => key);

  if (missing.length) {
    const error = new Error(`Tradovate read-only credentials missing: ${missing.join(", ")}.`);
    error.status = 400;
    throw error;
  }
}

async function tradovateFetch(mode, path, options = {}) {
  const token = await authenticateTradovate(mode);
  const endpointMode = mode === "prop" ? "live" : mode;
  const response = await fetch(`${endpoints[endpointMode].apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.errorText || `Tradovate request failed: ${path}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function authenticateTradovate(modeInput = "demo") {
  const mode = getMode(modeInput);
  const cached = tokenCache.get(mode);
  if (cached && cached.expiresAt > Date.now() + renewWindowMs) return cached;
  if (cached && cached.expiresAt > Date.now()) return renewTradovateAccessToken(mode, cached);

  const config = getConfig(mode);
  ensureConfigured(config);
  const endpointMode = mode === "prop" ? "live" : mode;

  const response = await fetch(`${endpoints[endpointMode].apiBase}/auth/accesstokenrequest`, {
    body: JSON.stringify(config),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.accessToken) {
    const error = new Error(data.message || data.errorText || "Tradovate authentication failed.");
    error.status = response.status || 401;
    throw error;
  }

  const expirationDate = data.expirationTime ? Date.parse(data.expirationTime) : NaN;
  const ttl = Number(data.expiresIn || 20 * 60 * 1000);
  const token = {
    accessToken: data.accessToken,
    mdAccessToken: data.mdAccessToken || data.accessToken,
    accountType: mode === "prop" ? "funded/prop" : mode === "live" ? "personal live" : "demo",
    endpoint: endpoints[mode === "prop" ? "live" : mode],
    expiresAt: Number.isFinite(expirationDate) ? expirationDate : Date.now() + (Number.isFinite(ttl) ? ttl : 20 * 60 * 1000),
    hasLive: Boolean(data.hasLive),
    hasMarketData: Boolean(data.hasMarketData),
    mode,
    userStatus: data.userStatus,
    userId: data.userId,
  };
  tokenCache.set(mode, token);
  return token;
}

export async function renewTradovateAccessToken(modeInput = "demo", cachedToken) {
  const mode = getMode(modeInput);
  const cached = cachedToken || tokenCache.get(mode);
  if (!cached?.accessToken) return authenticateTradovate(mode);

  const endpointMode = mode === "prop" ? "live" : mode;
  const response = await fetch(`${endpoints[endpointMode].apiBase}/auth/renewaccesstoken`, {
    body: JSON.stringify({ accessToken: cached.accessToken }),
    headers: {
      Authorization: `Bearer ${cached.accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.accessToken) {
    tokenCache.delete(mode);
    return authenticateTradovate(mode);
  }

  const expirationDate = data.expirationTime ? Date.parse(data.expirationTime) : NaN;
  const renewed = {
    ...cached,
    accessToken: data.accessToken,
    mdAccessToken: data.mdAccessToken || cached.mdAccessToken || data.accessToken,
    expiresAt: Number.isFinite(expirationDate) ? expirationDate : Date.now() + 90 * 60 * 1000,
    hasLive: Boolean(data.hasLive ?? cached.hasLive),
    hasMarketData: Boolean(data.hasMarketData ?? cached.hasMarketData),
    userStatus: data.userStatus ?? cached.userStatus,
  };
  tokenCache.set(mode, renewed);
  return renewed;
}

export async function getTradovateMe(mode = "demo") {
  return tradovateFetch(getMode(mode), "/auth/me");
}

export async function getTradovateAccounts(mode = "demo") {
  return tradovateFetch(getMode(mode), "/account/list");
}

export async function getTradovatePositions(mode = "demo", accountId = "") {
  if (accountId) return tradovateFetch(getMode(mode), `/position/deps?masterid=${encodeURIComponent(accountId)}`);
  return tradovateFetch(getMode(mode), "/position/list");
}

export async function getTradovateOrders(mode = "demo") {
  return tradovateFetch(getMode(mode), "/order/list");
}

export async function getTradovateFills(mode = "demo") {
  return tradovateFetch(getMode(mode), "/fill/list");
}

export async function findTradovateContract(mode = "demo", symbol = "MNQ") {
  const normalized = getTradovateContractName(symbol);
  return tradovateFetch(getMode(mode), `/contract/find?name=${encodeURIComponent(normalized)}`);
}

export async function getTradovateMarketPrice(mode = "demo", symbol = "MNQ") {
  const normalized = getTradovateContractName(symbol);
  const token = await authenticateTradovate(mode);
  const quote = await readMarketDataQuote({ socketUrl: token.endpoint.mdSocket, symbol: normalized, token: token.mdAccessToken });

  return {
    note: quote
      ? "Market-data quote read from Tradovate websocket in server read-only mode."
      : "Market-data websocket endpoint is configured, but no quote was returned before timeout.",
    quote,
    symbol: normalized,
    websocket: endpoints[getMode(mode) === "prop" ? "live" : getMode(mode)].mdSocket,
  };
}

export async function getTradovateChart(mode = "demo", symbol = "MNQ", options = {}) {
  const normalized = getTradovateContractName(symbol);
  const token = await authenticateTradovate(mode);
  const chart = await readMarketDataChart({
    bars: Number(options.bars || 80),
    elementSize: Number(options.elementSize || 5),
    socketUrl: token.endpoint.mdSocket,
    symbol: normalized,
    token: token.mdAccessToken,
  });

  return {
    chart,
    note: chart?.bars?.length
      ? "Chart data read from Tradovate demo market-data websocket in server read-only mode."
      : "Market-data websocket is configured, but no chart bars were returned before timeout.",
    symbol: normalized,
    websocket: token.endpoint.mdSocket,
  };
}

export function getTradovateContractName(symbol = "MNQ") {
  const raw = String(symbol || "MNQ").trim().toUpperCase();
  if (/^[A-Z]{2,}[FGHJKMNQUVXZ]\d{1,2}$/.test(raw)) return raw;

  const root = raw.replace(/[^A-Z]/g, "") || "MNQ";
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const expirations = [
    { code: "H", month: 3 },
    { code: "M", month: 6 },
    { code: "U", month: 9 },
    { code: "Z", month: 12 },
  ];
  const selected = expirations.find((item) => month <= item.month) || expirations[0];
  const contractYear = month <= 12 ? year : year + 1;
  const yearDigit = String(contractYear).slice(-1);
  return `${root}${selected.code}${yearDigit}`;
}

function extractQuote(payload, symbol) {
  const queue = Array.isArray(payload) ? [...payload] : [payload];

  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item)) {
      queue.push(...item);
      continue;
    }

    const candidate = item.props || item.d || item.data || item;
    const quoteEntry = candidate.entries || candidate.Entries;
    if (quoteEntry && typeof quoteEntry === "object") {
      const bidEntry = quoteEntry.Bid || quoteEntry.bid;
      const askEntry = quoteEntry.Offer || quoteEntry.Ask || quoteEntry.offer || quoteEntry.ask;
      const tradeEntry = quoteEntry.Trade || quoteEntry.trade;
      const bid = Number(bidEntry?.price);
      const ask = Number(askEntry?.price);
      const price = Number(tradeEntry?.price);
      const fallbackPrice = Number.isFinite(price) ? price : Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : bid || ask;
      if (Number.isFinite(fallbackPrice)) {
        return {
          ask: Number.isFinite(ask) ? ask : fallbackPrice,
          bid: Number.isFinite(bid) ? bid : fallbackPrice,
          price: fallbackPrice,
        };
      }
    }
    const price = Number(candidate.lastPrice ?? candidate.last ?? candidate.price ?? candidate.tradePrice ?? candidate.mark);
    const bid = Number(candidate.bidPrice ?? candidate.bid);
    const ask = Number(candidate.askPrice ?? candidate.ask);
    const itemSymbol = String(candidate.symbol || candidate.contractName || symbol).toUpperCase();

    if ((Number.isFinite(price) || Number.isFinite(bid) || Number.isFinite(ask)) && itemSymbol.includes(symbol.replace(/^@/, ""))) {
      const fallbackPrice = Number.isFinite(price) ? price : Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : bid || ask;
      return {
        ask: Number.isFinite(ask) ? ask : fallbackPrice,
        bid: Number.isFinite(bid) ? bid : fallbackPrice,
        price: fallbackPrice,
      };
    }

    queue.push(...Object.values(item).filter((value) => value && typeof value === "object"));
  }

  return null;
}

function readMarketDataQuote({ socketUrl, symbol, token }) {
  if (typeof WebSocket === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let requestId = 0;
    let settled = false;
    const socket = new WebSocket(socketUrl);
    const timeout = setTimeout(() => finish(null), 4500);

    const sendRequest = (route, payload) => {
      requestId += 1;
      socket.send(`${route}\n${requestId}\n\n${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
    };

    const finish = (quote) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // best-effort cleanup
      }
      resolve(quote);
    };

    socket.addEventListener("open", () => {
      sendRequest("authorize", token);
    });

    socket.addEventListener("message", (event) => {
      const raw = String(event.data || "");
      if (!raw || raw === "o" || raw === "h") return;
      const body = raw.startsWith("a") ? raw.slice(1) : raw;

      try {
        const parsed = JSON.parse(body);
        const quote = extractQuote(parsed, symbol);
        if (quote) {
          finish(quote);
          return;
        }

        const text = JSON.stringify(parsed);
        if (text.includes("authorize") || text.includes("200") || text.includes("OK")) {
          sendRequest("md/subscribeQuote", { symbol });
        }
      } catch {
        if (raw.toLowerCase().includes("authorize")) sendRequest("md/subscribeQuote", { symbol });
      }
    });

    socket.addEventListener("error", () => finish(null));
    socket.addEventListener("close", () => finish(null));
  });
}

function extractChart(payload) {
  const queue = Array.isArray(payload) ? [...payload] : [payload];

  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== "object") continue;
    if (Array.isArray(item)) {
      queue.push(...item);
      continue;
    }

    const candidate = item.props || item.d || item.data || item;
    const bars = candidate.bars || candidate.chart || candidate.candles || candidate.ohlc;
    if (Array.isArray(bars) && bars.length) {
      return {
        bars: bars.map((bar) => ({
          close: Number(bar.close ?? bar.c ?? bar.price ?? 0),
          high: Number(bar.high ?? bar.h ?? bar.close ?? 0),
          low: Number(bar.low ?? bar.l ?? bar.close ?? 0),
          open: Number(bar.open ?? bar.o ?? bar.close ?? 0),
          timestamp: bar.timestamp || bar.time || bar.t || new Date().toISOString(),
          volume: Number(bar.volume ?? bar.v ?? 0),
        })),
        subscriptionId: candidate.subscriptionId || candidate.id || item.id || "",
      };
    }

    queue.push(...Object.values(item).filter((value) => value && typeof value === "object"));
  }

  return null;
}

function readMarketDataChart({ bars, elementSize, socketUrl, symbol, token }) {
  if (typeof WebSocket === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    let requestId = 0;
    let settled = false;
    const socket = new WebSocket(socketUrl);
    const timeout = setTimeout(() => finish(null), 6500);

    const sendRequest = (route, payload) => {
      requestId += 1;
      socket.send(`${route}\n${requestId}\n\n${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
    };

    const finish = (chart) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // best-effort cleanup
      }
      resolve(chart);
    };

    const requestChart = () => {
      sendRequest("md/getChart", {
        chartDescription: {
          elementSize,
          elementSizeUnit: "UnderlyingUnits",
          underlyingType: "MinuteBar",
          withHistogram: false,
        },
        symbol,
        timeRange: {
          asCloseAsTimestamp: new Date().toISOString(),
          closestTimestamp: new Date().toISOString(),
          closestTickId: 0,
          itemCount: bars,
        },
      });
    };

    socket.addEventListener("open", () => {
      sendRequest("authorize", token);
    });

    socket.addEventListener("message", (event) => {
      const raw = String(event.data || "");
      if (!raw || raw === "o" || raw === "h") return;
      const body = raw.startsWith("a") ? raw.slice(1) : raw;

      try {
        const parsed = JSON.parse(body);
        const chart = extractChart(parsed);
        if (chart) {
          finish(chart);
          return;
        }

        const text = JSON.stringify(parsed);
        if (text.includes("authorize") || text.includes("200") || text.includes("OK")) requestChart();
      } catch {
        if (raw.toLowerCase().includes("authorize")) requestChart();
      }
    });

    socket.addEventListener("error", () => finish(null));
    socket.addEventListener("close", () => finish(null));
  });
}

export function createTradovateReadOnlyProvider() {
  return {
    capabilities: [
      "account balance",
      "open positions",
      "working orders",
      "filled orders",
      "current price",
      "realized P/L",
      "open P/L",
    ],
    endpoints,
    mode: "read-only",
    ordersEnabled: false,
    provider: "Tradovate",
  };
}
