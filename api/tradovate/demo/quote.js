import { getTradovateMarketPrice } from "../../../server/providers/tradovate-readonly.mjs";
import { handleOptions, sendError, sendJson } from "./_utils.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed." });

  try {
    sendJson(response, 200, await getTradovateMarketPrice("demo", request.query.name || request.query.symbol || "MNQ"));
  } catch (error) {
    sendError(response, error);
  }
}
