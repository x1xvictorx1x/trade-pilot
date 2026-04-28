import { getTradovateAccounts, getTradovatePositions } from "../../../server/providers/tradovate-readonly.mjs";
import { handleOptions, sendError, sendJson } from "./_utils.js";

export default async function handler(request, response) {
  if (handleOptions(request, response)) return;
  if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed." });

  try {
    let accountId = request.query.accountId || request.query.masterid;
    if (!accountId) {
      const accounts = await getTradovateAccounts("demo");
      const account = Array.isArray(accounts) ? accounts[0] : accounts;
      accountId = account?.id || account?.accountId || "";
    }
    sendJson(response, 200, await getTradovatePositions("demo", accountId));
  } catch (error) {
    sendError(response, error);
  }
}
