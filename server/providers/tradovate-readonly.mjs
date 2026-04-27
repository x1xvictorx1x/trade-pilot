export function createTradovateReadOnlyProvider() {
  throw new Error(
    "Tradovate read-only market data is not configured yet. Add credentials, exchange market-data permissions, and a read-only quote adapter before enabling this provider.",
  );
}
