import { handleOptions, sendJson } from "../../tradovate/demo/_utils.js";

export function parseBody(body) {
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

export async function withTradovateHandler(request, response, method, action) {
  if (handleOptions(request, response)) return;
  if (request.method !== method) return sendJson(response, 405, { error: "Method not allowed." });

  try {
    const payload = await action();
    sendJson(response, 200, payload);
  } catch (error) {
    sendJson(response, error.status || 500, {
      connected: false,
      error: error.message || "Tradovate read-only request failed.",
    });
  }
}
