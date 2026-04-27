import http from "node:http";
import { marketDefaults, normalizeSymbol, quoteFromBase } from "./market-config.mjs";

const port = Number(process.env.TRADE_PILOT_MARKET_PORT || 8787);
const latestQuotes = new Map();

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json",
  });
  response.end(JSON.stringify(payload));
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

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

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
    sendJson(response, 200, { ok: true, quote });
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Trade Pilot market data server running at http://127.0.0.1:${port}`);
  console.log("Read-only mode: this server never places trades.");
});
