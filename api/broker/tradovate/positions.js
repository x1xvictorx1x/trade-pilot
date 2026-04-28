import { getUserTradovatePositions } from "../../../server/providers/user-tradovate.mjs";
import { withTradovateHandler } from "./_handler.js";

export default async function handler(request, response) {
  const accountId = request.query?.accountId || request.query?.masterid || "";
  return withTradovateHandler(request, response, "GET", () => getUserTradovatePositions(request, accountId));
}
