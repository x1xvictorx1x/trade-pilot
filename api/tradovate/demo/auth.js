import { authenticateTradovate } from "../../../server/providers/tradovate-readonly.mjs";
import { handleOptions, sendError, sendJson } from "./_utils.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  try {
    const token = await authenticateTradovate("demo");
    sendJson(response, 200, {
      connected: true,
      endpoint: token.endpoint.apiBase,
      hasLive: token.hasLive,
      hasMarketData: token.hasMarketData,
      marketDataWebsocket: token.endpoint.mdSocket,
      mode: "demo",
      ordersEnabled: false,
      tokenStatus: "server-only",
      userStatus: token.userStatus,
      websocket: token.endpoint.apiSocket,
    });
  } catch (error) {
    sendError(response, error);
  }
}
