import {
  connectUserTradovate,
  disconnectUserTradovate,
  getUserTradovateAccounts,
  getUserTradovateFills,
  getUserTradovateOrders,
  getUserTradovatePositions,
  getUserTradovateQuote,
  getUserTradovateStatus,
} from "../../../server/providers/user-tradovate.mjs";
import { handleOptions, sendJson } from "../../tradovate/demo/_utils.js";

function parseBody(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function getAction(request) {
  const action = request.query?.action;
  return Array.isArray(action) ? action[0] : action;
}

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;

  const action = getAction(request);
  const method = request.method;
  const routes = {
    accounts: ["GET", () => getUserTradovateAccounts(request)],
    connect: ["POST", () => connectUserTradovate(request, parseBody(request.body))],
    disconnect: ["POST", () => disconnectUserTradovate(request)],
    fills: ["GET", () => getUserTradovateFills(request)],
    orders: ["GET", () => getUserTradovateOrders(request)],
    positions: ["GET", () => getUserTradovatePositions(request, request.query?.accountId || request.query?.masterid || "")],
    quote: ["GET", () => getUserTradovateQuote(request, request.query?.symbol || "MNQ")],
    status: ["GET", () => getUserTradovateStatus(request)],
  };

  const route = routes[action];
  if (!route) return sendJson(response, 404, { connected: false, error: "Tradovate route not found." });
  if (method !== route[0]) return sendJson(response, 405, { connected: false, error: "Method not allowed." });

  try {
    sendJson(response, 200, await route[1]());
  } catch (error) {
    sendJson(response, error.status || 500, {
      connected: false,
      error: error.message || "Tradovate read-only request failed.",
    });
  }
}
