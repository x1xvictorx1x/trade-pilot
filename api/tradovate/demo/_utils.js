export function allowCors(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

export function handleOptions(request, response) {
  allowCors(response);
  if (request.method !== "OPTIONS") return false;
  response.status(204).end();
  return true;
}

export function sendJson(response, status, payload) {
  allowCors(response);
  response.status(status).json(payload);
}

export function sendError(response, error) {
  sendJson(response, error.status || 500, {
    error: error.message || "Tradovate demo request failed.",
    ordersEnabled: false,
  });
}
