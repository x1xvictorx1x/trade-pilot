import { connectUserTradovate } from "../../../server/providers/user-tradovate.mjs";
import { parseBody, withTradovateHandler } from "./_handler.js";

export default async function handler(request, response) {
  return withTradovateHandler(request, response, "POST", () =>
    connectUserTradovate(request, parseBody(request.body))
  );
}
