# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server (frontend only, hot reload)
npm run build        # Production build → dist/
npm run lint         # ESLint (react-hooks + react-refresh rules)
npm run preview      # Serve the dist/ build locally
npm run market:mock  # Start local market server on port 8787
```

There are no tests. No test runner is configured.

The **local market server** (`npm run market:mock`) is required for broker connections, Tradovate read-only mode, and the SSE price stream. The frontend detects `window.location.hostname === "localhost"` or `"127.0.0.1"` to decide whether to use it.

Environment variables needed for full functionality (`.env.local`):
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

## Architecture

### Deployment split

| Layer | Where it runs | Purpose |
|---|---|---|
| `src/` | Browser (Vite/React PWA) | All UI, state, business logic |
| `api/` | Vercel serverless functions | Webhook receiver, market quote, Tradovate proxy |
| `server/` | Local Node.js process (port 8787) | SSE price stream, broker bridge, Tradovate auth |

The app works without the local server or Vercel functions — it falls back to a simulated sine-wave price ticker.

### Frontend: one monolithic component

`src/App.jsx` (~8,700 lines) contains every React component, all state, and all business logic in a single file. There is no separate state management library. Key sections:

- **Lines 1–616**: Constants, market specs, defaults, pure utility functions (`safeNumber`, `normalizeActiveTrade`, `migrateWorkspace`, etc.)
- **Lines 617–1990**: `App()` component — all `useState`/`useEffect` hooks, data-source polling logic, broker snapshot handlers, `applyAlert`, `savePersonalWorkspace`
- **Lines 1991–3162**: App render tree and page routing (`activePage` string: `"home"`, `"dashboard"`, `"journal"`, `"account"`, `"connections"`, etc.)
- **Lines 3163–5060**: Sub-components rendered by App (`Dashboard`, `TradePlanCard`, `RiskGuardCard`, `ConnectionsPage`, etc.) — all defined as module-level functions but receive all data as props
- **Lines 5061–8700+**: Pure engine functions (`calculateTrade`, `getTradeGrade`, `getAutoTradePlan`, `analyzeMarketStructure`, `normalizeTradePlan`, etc.) and style objects

### Data source polling (`src/App.jsx:943–1191`)

A single large `useEffect` keyed on `[autoPrice, brokerConnection.platform, dataSource, profile, resistance, riskPoints, support]` manages all price feeds:

1. **Manual Mode** — no polling, user inputs price
2. **TradingView Webhook** — polls `GET /api/webhook/tradingview/latest` every 2.5s; deduplication uses numeric millisecond comparison of `created_at`
3. **Market Data API** (deployed) — polls `GET /api/market/quote` every 10s (Yahoo Finance delayed)
4. **Market Data API / TradingView** (local) — opens SSE stream at `ws://127.0.0.1:8787/api/market/stream`
5. **Tradovate modes** — polls `GET 127.0.0.1:8787/api/tradovate/quote?mode=demo|prop|live` every 5s
6. **Fallback** — simulated sine-wave price tick every 1s

### Trade engine functions

All are pure functions — no side effects, no React hooks:

- **`calculateTrade()`** — 6-factor score (0–100) + coach message + suggested action + discipline warnings. Used as `useMemo` engine in `App`.
- **`getTradeGrade()`** — 5-factor score (location 20, R:R 20, trend alignment 20, breakout/rejection confirmation 20, session context 20). Outputs grade A/B/C/D + per-factor reasons for the coach to explain WHY.
- **`getAutoTradePlan()`** — generates a plan from zone detection when no manual plan exists.
- **`analyzeMarketStructure()`** — detects swing highs/lows, VWAP proxy, liquidity sweeps, market structure state (bullish/bearish/distribution/accumulation).
- **`normalizeTradePlan()`** — sanitizes a plan object; if `direction === "none"` returns early with `{ direction: "none", noTrade: true }`.
- **`validateTradePlan()`** — checks stop/targets are on the correct side of entry.
- **`buildActiveTradePlan()`** — selects the best valid plan from activePosition, plannedTrade, autoTradePlan; returns a no-trade plan if none are valid.

### TradingView webhook pipeline

```
TradingView alert → POST /api/webhook/tradingview/index.js
  → normalizeSignal() validates symbol + price
  → saveSignal() writes to globalThis.__tradePilotTradingViewAlerts Map + Supabase tradingview_signals table
  → Frontend polls GET /api/webhook/tradingview/latest every 2.5s
  → applyAlert() updates price/levels/direction/plan state
```

Signal deduplication: frontend compares `new Date(signal.created_at || signal.timestamp).getTime()` against last seen ms value — not string equality.

### Supabase tables

| Table | Key use |
|---|---|
| `profiles` | Trader name, market, risk settings, experience level |
| `trade_settings` | Per-user market/layout/S-R preferences |
| `trade_plans` | Active plan persisted across sessions |
| `trade_journal` | Closed trade history (entry JSONB) |
| `broker_connections` | Connection metadata (read-only mode, encrypted credentials) |
| `watchlist` | Watched symbols |
| `tradingview_signals` | Webhook signal history |

All tables have RLS enabled. Signals can be inserted without auth (`user_id is null`). The frontend client uses the anon key only — service role key is server-side only.

### Connection state

`brokerConnection` state object is the single source of truth for connection status shown in the UI. `connected: false` must be set on any stream error — the `onerror` handler on EventSource must update it or the dashboard will show stale "Connected" status.

`dataSource` (string) controls which polling branch is active. Changing `dataSource` restarts the polling `useEffect`. `applyAlert()` only sets `dataSource` to `"TradingView Webhook"` if it isn't already set — avoid triggering unnecessary effect restarts.

## Hard constraints

- **Broker connections are read-only.** Do not add order placement, cancellation, or modification endpoints anywhere. This is a legal/audit requirement.
- **No service role key in browser code.** Only `VITE_SUPABASE_ANON_KEY` goes to the frontend.
- **Coach and plan must never contradict.** If `getTradeGrade` returns grade D, `getLiveCoachMessage` must not say "clean setup". The grade reasons flow directly into the coach message.
- **`normalizeTradePlan` must preserve `direction: "none"`.** Plans with `noTrade: true` must not be silently converted to long setups.
- **Grading scale is A/B/C/D** (≥85/≥70/≥55/<55). Do not use "Avoid" or "A+".

## Current priority fixes

Before adding new features, stabilize these:

1. Mobile menu
- No horizontal overflow
- Drawer must stay inside viewport
- Overlay closes menu
- Hide email on mobile header

2. State sync
- `brokerConnection` and `dataSource` are the source of truth
- Settings, Connections, Dashboard, and Streamer Mode must always show the same active connection
- No stale Manual/TradingView mismatch

3. Trade coach reliability
- Coach must always show: Action, Bias, Confidence, Message, Why, Next
- Coach cannot say manage target unless `activeTrade.isActive === true`
- If price is connected but no support/resistance exists, coach should guide user to add levels

4. Trade plan reliability
- No long targets below entry
- No short targets above entry
- If plan invalid, show a clear warning and do not grade it
- Switching connection mode clears stale plans

5. TradingView workflow
- Send Test Signal must POST to `/api/webhook/tradingview`
- After success, immediately fetch `/api/webhook/tradingview/latest`
- Update dashboard state
- Close modal after success
- Play success sound

6. Workspace crash prevention
- All saved localStorage/Supabase workspace state must pass through `migrateWorkspace`
- Undefined arrays must default to []
- App should never crash from old saved state

## Required workflow

Before pushing:
1. Run `npm run build`
2. Fix all build errors
3. Commit with a clear message
4. Push to main
5. Do not push if build fails
