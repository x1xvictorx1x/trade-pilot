import { testTradovateDemoAuth } from "../../../server/providers/tradovate-readonly.mjs";
import { handleOptions, sendJson } from "./_utils.js";

function getAuthInput(body) {
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

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  if (request.method !== "POST") return sendJson(response, 405, { error: "Method not allowed." });

  try {
    sendJson(response, 200, await testTradovateDemoAuth(getAuthInput(request.body)));
  } catch (error) {
    sendJson(response, error.status || 500, {
      connected: false,
      error: error.message || "Tradovate demo authentication failed.",
    });
  }
}
