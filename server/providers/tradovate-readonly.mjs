const endpoints = {
  demo: {
    apiBase: "https://demo.tradovateapi.com/v1",
    mdSocket: "wss://md-demo.tradovateapi.com/v1/websocket",
  },
  live: {
    apiBase: "https://live.tradovateapi.com/v1",
    mdSocket: "wss://md.tradovateapi.com/v1/websocket",
  },
};

const tokenCache = new Map();

function getMode(mode) {
  return mode === "live" ? "live" : "demo";
}

function getConfig(mode) {
  const envPrefix = mode === "live" ? "TRADOVATE_LIVE" : "TRADOVATE";
  return {
    appId: process.env[`${envPrefix}_APP_ID`] || process.env.TRADOVATE_APP_ID || "TradePilot",
    appVersion: process.env[`${envPrefix}_APP_VERSION`] || process.env.TRADOVATE_APP_VERSION || "0.1.0",
    cid: process.env[`${envPrefix}_CLIENT_ID`] || process.env.TRADOVATE_CLIENT_ID,
    deviceId: process.env[`${envPrefix}_DEVICE_ID`] || process.env.TRADOVATE_DEVICE_ID || "trade-pilot-local",
    name: process.env[`${envPrefix}_USERNAME`] || process.env.TRADOVATE_USERNAME,
    sec: process.env[`${envPrefix}_CLIENT_SECRET`] || process.env.TRADOVATE_CLIENT_SECRET,
    password: process.env[`${envPrefix}_PASSWORD`] || process.env.TRADOVATE_PASSWORD,
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
  const response = await fetch(`${endpoints[mode].apiBase}${path}`, {
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
  if (cached && cached.expiresAt > Date.now() + 60000) return cached;

  const config = getConfig(mode);
  ensureConfigured(config);

  const response = await fetch(`${endpoints[mode].apiBase}/auth/accesstokenrequest`, {
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

  const ttl = Number(data.expirationTime || data.expiresIn || 20 * 60 * 1000);
  const token = {
    accessToken: data.accessToken,
    endpoint: endpoints[mode],
    expiresAt: Date.now() + (Number.isFinite(ttl) ? ttl : 20 * 60 * 1000),
    mode,
  };
  tokenCache.set(mode, token);
  return token;
}

export async function getTradovateAccounts(mode = "demo") {
  return tradovateFetch(getMode(mode), "/account/list");
}

export async function getTradovatePositions(mode = "demo") {
  return tradovateFetch(getMode(mode), "/position/list");
}

export async function getTradovateOrders(mode = "demo") {
  return tradovateFetch(getMode(mode), "/order/list");
}

export async function getTradovateMarketPrice(mode = "demo", symbol = "MNQ") {
  const normalized = String(symbol || "MNQ").trim().toUpperCase();
  return {
    note: "Market-data websocket scaffolding is configured. Live quote subscription is the next adapter step.",
    quote: null,
    symbol: normalized,
    websocket: endpoints[getMode(mode)].mdSocket,
  };
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
