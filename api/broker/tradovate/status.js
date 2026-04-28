import { getUserTradovateStatus } from "../../../server/providers/user-tradovate.mjs";
import { withTradovateHandler } from "./_handler.js";

export default async function handler(request, response) {
  return withTradovateHandler(request, response, "GET", () => getUserTradovateStatus(request));
}
