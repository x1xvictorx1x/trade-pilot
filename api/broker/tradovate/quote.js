import { getUserTradovateQuote } from "../../../server/providers/user-tradovate.mjs";
import { withTradovateHandler } from "./_handler.js";

export default async function handler(request, response) {
  const symbol = request.query?.symbol || "MNQ";
  return withTradovateHandler(request, response, "GET", () => getUserTradovateQuote(request, symbol));
}
