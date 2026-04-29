import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { isSupabaseConfigured, supabase } from "./supabaseClient";

const profileStorageKey = "tradePilotProfile";
const disciplineStorageKey = "tradePilotDiscipline";
const activePositionStorageKey = "tradePilotActivePosition";
const disclaimerStorageKey = "tradePilotDisclaimerAccepted";
const feedbackStorageKey = "tradePilotFeedback";
const supportStorageKey = "tradePilotSupportMessages";
const onboardingStorageKey = "tradePilotOnboardingComplete";
const streamerModeStorageKey = "tradePilotStreamerMode";
const subscriberStorageKey = "tradePilotSubscribers";
const journalStorageKey = "tradePilotJournal";
const layoutStorageKey = "tradePilotLayout";
const connectionSettingsStorageKey = "tradePilotConnectionSettings";
const watchlistStorageKey = "tradePilotWatchlist";
const installDismissedStorageKey = "tradePilotInstallDismissed";
const workspaceStorageKey = "tradePilotWorkspace";
const alertsStorageKey = "tradePilotAlerts";
const tradePlanStorageKey = "tradePilotTradePlan";
const autoZonesStorageKey = "tradePilotAutoZones";
const connectionModeStorageKey = "tradePilotConnectionMode";

const defaultProfile = {
  traderName: "",
  accountSize: 50000,
  accountType: "Personal Trading Account",
  accountPhase: "evaluation",
  consistencyRuleTarget: 30,
  fundedPlatform: "Manual Mode",
  fundedProvider: "None",
  profitGoal: 3000,
  startingBalance: 50000,
  trailingDrawdown: 2500,
  mainMarket: "MNQ",
  traderExperienceLevel: "intermediate",
  traderStyle: "scalper",
  maxDailyLoss: 500,
  maxTradesPerDay: 5,
  maxContracts: 5,
  maxRiskPerTrade: 100,
  defaultContracts: 1,
  defaultRiskPoints: 10,
  trim1Points: 10,
  trim2Points: 20,
  runnerPoints: 35,
  voiceAlerts: true,
  soundAlerts: true,
};

const pointValues = {
  MNQ: 2,
  NQ: 20,
  ES: 50,
  MES: 5,
  YM: 5,
  MYM: 0.5,
  RTY: 50,
  M2K: 5,
  CL: 1000,
  GC: 100,
  BTC: 1,
  ETH: 1,
  SPY: 1,
  QQQ: 1,
};

const marketDefaults = {
  MNQ: 27500,
  NQ: 27500,
  ES: 6400,
  MES: 6400,
  YM: 47000,
  MYM: 47000,
  RTY: 2300,
  M2K: 2300,
  CL: 82,
  GC: 2400,
  BTC: 65000,
  ETH: 3200,
  SPY: 640,
  QQQ: 560,
};

function normalizeFuturesSymbol(symbol = "") {
  const clean = String(symbol).toUpperCase();
  if (clean.includes("MNQ")) return "MNQ";
  if (clean.includes("MES")) return "MES";
  if (clean.includes("NQ")) return "NQ";
  if (clean.includes("ES")) return "ES";
  return clean || "MNQ";
}

const markets = Object.keys(marketDefaults);
const marketSpecs = {
  MNQ: { displayName: "Micro Nasdaq 100", pointValue: 2, tickSize: 0.25 },
  NQ: { displayName: "Nasdaq 100", pointValue: 20, tickSize: 0.25 },
  ES: { displayName: "S&P 500", pointValue: 50, tickSize: 0.25 },
  MES: { displayName: "Micro S&P 500", pointValue: 5, tickSize: 0.25 },
  YM: { displayName: "Dow Futures", pointValue: 5, tickSize: 1 },
  MYM: { displayName: "Micro Dow Futures", pointValue: 0.5, tickSize: 1 },
  RTY: { displayName: "Russell 2000", pointValue: 50, tickSize: 0.1 },
  M2K: { displayName: "Micro Russell 2000", pointValue: 5, tickSize: 0.1 },
  CL: { displayName: "Crude Oil", pointValue: 1000, tickSize: 0.01 },
  GC: { displayName: "Gold", pointValue: 100, tickSize: 0.1 },
  BTC: { displayName: "Bitcoin", pointValue: 1, tickSize: 0.01 },
  ETH: { displayName: "Ethereum", pointValue: 1, tickSize: 0.01 },
  SPY: { displayName: "SPY ETF", pointValue: 1, tickSize: 0.01 },
  QQQ: { displayName: "QQQ ETF", pointValue: 1, tickSize: 0.01 },
};
const dataSources = ["Manual Mode", "TradingView Webhook", "CSV Import", "Tradovate Demo Read-Only", "Tradovate Prop/Funded Read-Only", "Tradovate Live Read-Only", "Demo Broker", "Market Data API"];
const accountTypeOptions = ["Personal Trading Account", "Funded / Prop Firm Account", "Demo / Practice Account"];
const fundedProviders = ["None", "Lucid Trading", "Apex", "Topstep", "Take Profit Trader", "MyFundedFutures", "Bulenox", "Earn2Trade", "Other"];
const fundedPlatforms = ["Manual Mode", "TradingView Webhook", "Tradovate", "Rithmic", "TopstepX", "CSV Import", "Other"];
const navigationTabs = ["Home", "Dashboard", "Journal", "Account"];
const moreTabs = ["Profile", "Settings", "Connections", "Install", "Help", "Support"];
const authRedirectUrl = "https://tradepilottool.com";
const marketServerUrl = "http://127.0.0.1:8787";
const tradovateApiBase = typeof window !== "undefined" && ["127.0.0.1", "localhost"].includes(window.location.hostname) ? marketServerUrl : "";
const brokerSamplePayload = {
  platform: "Demo Broker",
  accountId: "SIM-001",
  accountBalance: 50000,
  symbol: "MNQ",
  price: 27462,
  bid: 27461.75,
  ask: 27462.25,
  openPnl: 14,
  realizedPnl: 0,
  position: {
    symbol: "MNQ",
    direction: "long",
    quantity: 1,
    averagePrice: 27455,
    openPnl: 14,
    stop: 27435,
    target: 27495,
  },
  workingOrders: [
    {
      id: "demo-stop-1",
      symbol: "MNQ",
      side: "sell",
      quantity: 1,
      price: 27435,
      type: "stop",
    },
  ],
  fills: [
    {
      id: "demo-fill-1",
      symbol: "MNQ",
      side: "buy",
      quantity: 1,
      price: 27455,
    },
  ],
};

const tradovateModes = {
  demo: "Tradovate Demo Read-Only",
  prop: "Tradovate Prop/Funded Read-Only",
  live: "Tradovate Live Read-Only",
};

function normalizeAccountType(value) {
  if (value === "funded" || value === "prop" || value === "both" || value === "Funded/prop account") return "Funded / Prop Firm Account";
  if (value === "Demo broker" || value === "demo" || value === "Demo / Practice Account") return "Demo / Practice Account";
  return "Personal Trading Account";
}

function isFundedAccountType(value) {
  return normalizeAccountType(value) === "Funded / Prop Firm Account";
}

const tooltipText = {
  currentPrice: "Current Price = the latest price Trade Pilot is using for calculations.",
  support: "Support = a price area where buyers historically defend and price may bounce.",
  resistance: "Resistance = a price area where sellers historically defend and price may reject.",
  entry: "Entry = the price where you plan to enter the trade.",
  riskPoints: "Risk Points = how many points you are willing to lose before exiting.",
  contracts: "Contracts = how many contracts or shares you are using for the trade.",
  recommendedStop: "Recommended Stop = the suggested exit price if the trade moves against you.",
  trim1: "Trim 1 = your first profit-taking level.",
  trim2: "Trim 2 = your second profit-taking level.",
  runner: "Runner = the final piece you hold for a bigger move.",
  marketBias: "Market Bias = Trade Pilot's read on whether price favors long, short, or waiting.",
  tradeScore: "Trade Score = a 0-100 execution quality read based on location, risk/reward, size, bias, and chop.",
  breakout: "Breakout = price pushing through a key level, usually resistance for longs or support for shorts.",
  pullback: "Pullback = price returning toward support or a breakout area after a move.",
  retest: "Retest = price comes back to check whether a broken level will now hold.",
  stopLoss: "Stop Loss = the planned price where the trade idea is wrong and you exit.",
  target: "Target = the planned area where you take profit.",
};

const todayKey = () => new Date().toISOString().slice(0, 10);

function loadProfile() {
  try {
    const saved = localStorage.getItem(profileStorageKey);
    const profile = saved ? { ...defaultProfile, ...JSON.parse(saved) } : defaultProfile;
    profile.accountType = normalizeAccountType(profile.accountType);
    if (!fundedProviders.includes(profile.fundedProvider)) profile.fundedProvider = defaultProfile.fundedProvider;
    if (!fundedPlatforms.includes(profile.fundedPlatform)) profile.fundedPlatform = defaultProfile.fundedPlatform;
    return profile;
  } catch {
    return defaultProfile;
  }
}

function loadDiscipline() {
  const fallback = { date: todayKey(), tradesTaken: 0, dailyPnl: 0 };

  try {
    const saved = localStorage.getItem(disciplineStorageKey);
    const parsed = saved ? JSON.parse(saved) : fallback;
    return parsed.date === todayKey() ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function loadActivePosition() {
  try {
    const saved = localStorage.getItem(activePositionStorageKey);
    return safeJsonParse(saved, null);
  } catch {
    return null;
  }
}

function loadList(key) {
  return safeArray(safeJsonParse(localStorage.getItem(key), []));
}

function safeJsonParse(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

const defaultLayout = {
  alerts: true,
  chart: true,
  coach: true,
  connections: true,
  fastMode: true,
  journal: true,
  mode: "Pro",
  performanceStats: true,
  propFirmRules: true,
  risk: true,
  score: true,
  tradePlan: true,
  watchlist: true,
  cardOrder: ["coach", "tradePlan", "chart", "risk", "propFirmRules", "journal", "watchlist", "alerts", "performanceStats"],
};

const dashboardCardOptions = [
  ["coach", "Trade Coach"],
  ["tradePlan", "Trade Plan"],
  ["chart", "Chart"],
  ["risk", "Risk Guard"],
  ["propFirmRules", "Prop Firm Rules"],
  ["journal", "Journal"],
  ["watchlist", "Watchlist"],
  ["alerts", "Alerts"],
  ["performanceStats", "Performance Stats"],
];

const cardKeyAliases = {
  tradeCoach: "coach",
  riskGuard: "risk",
};

function normalizeCardKey(key) {
  return cardKeyAliases[key] || key;
}

function normalizeCardList(value, fallback = defaultLayout.cardOrder) {
  const allowed = new Set(dashboardCardOptions.map(([key]) => key));
  const normalized = safeArray(value)
    .map(normalizeCardKey)
    .filter((key) => allowed.has(key));
  return normalized.length ? Array.from(new Set(normalized)) : fallback;
}

function normalizeWatchlistItems(value, fallbackMarket = "NQ") {
  const items = safeArray(value)
    .map((item) => {
      if (typeof item === "string") return { id: item, notes: "Watching", symbol: item };
      if (!item || typeof item !== "object") return null;
      const symbol = item.symbol || item.market || item.name;
      return symbol ? { id: item.id || symbol, notes: item.notes || "Watching", symbol } : null;
    })
    .filter(Boolean);
  return items.length ? items : [{ id: fallbackMarket, notes: "Primary market", symbol: fallbackMarket }];
}

function defaultWorkspace() {
  return {
    activeConnection: "manual",
    alerts: [],
    autoZones: {
      openRangeHigh: null,
      openRangeLow: null,
      repeatedRejectionHighs: [],
      repeatedRejectionLows: [],
      resistance: null,
      sessionHigh: null,
      sessionLow: null,
      support: null,
      swingHighs: [],
      swingLows: [],
    },
    cardOrder: defaultLayout.cardOrder,
    journalEntries: [],
    layout: "Pro",
    layoutPrefs: defaultLayout,
    selectedMarket: "NQ",
    tradeHistory: [],
    tradePlan: null,
    version: 2,
    visibleCards: defaultLayout.cardOrder,
    watchlist: [{ id: "NQ", notes: "Primary market", symbol: "NQ" }],
    webhookSignal: null,
  };
}

function migrateWorkspace(raw) {
  const defaults = defaultWorkspace();
  const workspace = raw && typeof raw === "object" ? raw : {};
  const fromVersion = Number(workspace.version || 0);
  const rawLayoutPrefs = workspace.layoutPrefs || workspace.preferred_layout || workspace.layoutSettings || {};
  const visibleCards = normalizeCardList(workspace.visibleCards, defaults.visibleCards);
  const cardOrder = normalizeCardList(workspace.cardOrder || rawLayoutPrefs.cardOrder, defaults.cardOrder);
  const autoZones = workspace.autoZones || {};
  const selectedMarket = workspace.selectedMarket || workspace.market || rawLayoutPrefs.selected_market || defaults.selectedMarket;
  const migrated = {
    ...defaults,
    ...workspace,
    activeConnection: workspace.activeConnection || workspace.connectionMode || defaults.activeConnection,
    alerts: safeArray(workspace.alerts),
    autoZones: {
      ...defaults.autoZones,
      ...autoZones,
      repeatedRejectionHighs: safeArray(autoZones.repeatedRejectionHighs),
      repeatedRejectionLows: safeArray(autoZones.repeatedRejectionLows),
      swingHighs: safeArray(autoZones.swingHighs),
      swingLows: safeArray(autoZones.swingLows),
    },
    cardOrder,
    journalEntries: safeArray(workspace.journalEntries || workspace.tradeJournal),
    layout: workspace.layout || rawLayoutPrefs.mode || defaults.layout,
    layoutPrefs: {
      ...defaultLayout,
      ...rawLayoutPrefs,
      cardOrder,
      mode: workspace.layout || rawLayoutPrefs.mode || defaults.layout,
    },
    selectedMarket,
    tradeHistory: safeArray(workspace.tradeHistory),
    tradePlan: workspace.tradePlan || workspace.plannedTrade || null,
    version: 2,
    visibleCards,
    watchlist: normalizeWatchlistItems(workspace.watchlist, selectedMarket),
    webhookSignal: workspace.webhookSignal || null,
  };
  if (fromVersion !== 2 && import.meta.env.DEV) {
    console.warn("Migrated old workspace state", { fromVersion, toVersion: 2 });
  }
  return migrated;
}

function loadMigratedWorkspace() {
  const rawWorkspace = safeJsonParse(localStorage.getItem(workspaceStorageKey), {});
  const legacyWorkspace = {
    ...rawWorkspace,
    cardOrder: rawWorkspace.cardOrder || safeJsonParse(localStorage.getItem(layoutStorageKey), {}).cardOrder,
    layoutPrefs: rawWorkspace.layoutPrefs || safeJsonParse(localStorage.getItem(layoutStorageKey), {}),
    tradePlan: rawWorkspace.tradePlan || safeJsonParse(localStorage.getItem(tradePlanStorageKey), null) || loadActivePosition(),
    watchlist: rawWorkspace.watchlist || loadList(watchlistStorageKey),
  };
  const migrated = migrateWorkspace(legacyWorkspace);
  if (rawWorkspace?.version !== 2) localStorage.setItem(workspaceStorageKey, JSON.stringify(migrated));
  return migrated;
}

const layoutModePresets = {
  Simple: {
    alerts: false,
    cardOrder: ["coach", "tradePlan", "risk"],
    chart: false,
    coach: true,
    journal: false,
    performanceStats: false,
    propFirmRules: false,
    risk: true,
    tradePlan: true,
    watchlist: false,
  },
  Pro: {
    alerts: true,
    cardOrder: ["chart", "coach", "tradePlan", "risk", "watchlist", "alerts", "performanceStats"],
    chart: true,
    coach: true,
    journal: false,
    performanceStats: true,
    propFirmRules: false,
    risk: true,
    tradePlan: true,
    watchlist: true,
  },
  Streamer: {
    alerts: false,
    cardOrder: ["chart", "coach", "tradePlan", "risk"],
    chart: true,
    coach: true,
    journal: false,
    performanceStats: false,
    propFirmRules: false,
    risk: true,
    tradePlan: true,
    watchlist: false,
  },
  "Prop Firm": {
    alerts: false,
    cardOrder: ["propFirmRules", "risk", "tradePlan", "coach"],
    chart: false,
    coach: true,
    journal: false,
    performanceStats: false,
    propFirmRules: true,
    risk: true,
    tradePlan: true,
    watchlist: false,
  },
  "Journal Focus": {
    alerts: false,
    cardOrder: ["journal", "performanceStats", "tradePlan", "coach"],
    chart: false,
    coach: true,
    journal: true,
    performanceStats: true,
    propFirmRules: false,
    risk: false,
    tradePlan: true,
    watchlist: false,
  },
};

function profileToDatabase(profile, user, streamerMode) {
  return {
    account_size: profile.accountSize,
    account_type: profile.accountType,
    default_contracts: profile.defaultContracts,
    default_risk_points: profile.defaultRiskPoints,
    email: user.email,
    id: user.id,
    max_daily_loss: profile.maxDailyLoss,
    max_trades_per_day: profile.maxTradesPerDay,
    name: profile.traderName,
    preferred_market: profile.mainMarket,
    runner_points: profile.runnerPoints,
    streamer_mode: streamerMode,
    trader_experience_level: profile.traderExperienceLevel || "intermediate",
    trader_style: profile.traderStyle,
    trim1_points: profile.trim1Points,
    trim2_points: profile.trim2Points,
    updated_at: new Date().toISOString(),
    voice_alerts: profile.voiceAlerts,
  };
}

function profileFromDatabase(row, fallback) {
  if (!row) return fallback;
  return {
    ...fallback,
    accountSize: Number(row.account_size ?? fallback.accountSize),
    accountType: row.account_type || fallback.accountType,
    defaultContracts: Number(row.default_contracts ?? fallback.defaultContracts),
    defaultRiskPoints: Number(row.default_risk_points ?? fallback.defaultRiskPoints),
    mainMarket: row.preferred_market || fallback.mainMarket,
    maxDailyLoss: Number(row.max_daily_loss ?? fallback.maxDailyLoss),
    maxTradesPerDay: Number(row.max_trades_per_day ?? fallback.maxTradesPerDay),
    runnerPoints: Number(row.runner_points ?? fallback.runnerPoints),
    traderExperienceLevel: row.trader_experience_level || fallback.traderExperienceLevel || "intermediate",
    traderName: row.name || fallback.traderName,
    traderStyle: row.trader_style || fallback.traderStyle,
    trim1Points: Number(row.trim1_points ?? fallback.trim1Points),
    trim2Points: Number(row.trim2_points ?? fallback.trim2Points),
    voiceAlerts: row.voice_alerts ?? fallback.voiceAlerts,
    soundAlerts: row.sound_alerts ?? fallback.soundAlerts,
  };
}

export default function App() {
  const [workspace, setWorkspace] = useState(() => loadMigratedWorkspace());
  const [profile, setProfile] = useState(() => loadProfile());
  const [discipline, setDiscipline] = useState(() => loadDiscipline());
  const [activePosition, setActivePosition] = useState(() => workspace.tradePlan || loadActivePosition());
  const [plannedTrade, setPlannedTrade] = useState(() => workspace.tradePlan || loadActivePosition());
  const [activePage, setActivePage] = useState("home");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(() => localStorage.getItem(disclaimerStorageKey) === "true");
  const [onboardingComplete, setOnboardingComplete] = useState(() => localStorage.getItem(onboardingStorageKey) === "true");
  const [fastMessage, setFastMessage] = useState("Ready for manual execution.");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installBannerDismissed, setInstallBannerDismissed] = useState(() => localStorage.getItem(installDismissedStorageKey) === "true");
  const [feedbackItems, setFeedbackItems] = useState(() => loadList(feedbackStorageKey));
  const [supportMessages, setSupportMessages] = useState(() => loadList(supportStorageKey));
  const [streamerMode, setStreamerMode] = useState(() => localStorage.getItem(streamerModeStorageKey) === "true");
  const [journalEntries, setJournalEntries] = useState(() => safeArray(workspace.journalEntries).length ? workspace.journalEntries : loadList(journalStorageKey));
  const [layoutPrefs, setLayoutPrefs] = useState(() => {
    const saved = safeJsonParse(localStorage.getItem(layoutStorageKey), {});
    return { ...defaultLayout, ...workspace.layoutPrefs, ...saved, cardOrder: normalizeCardList(saved.cardOrder || workspace.cardOrder) };
  });
  const [watchlist, setWatchlist] = useState(() => normalizeWatchlistItems(workspace.watchlist, workspace.selectedMarket || profile.mainMarket));
  const [session, setSession] = useState(null);
  const [authModal, setAuthModal] = useState(null);
  const [authMessage, setAuthMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState("Local workspace");
  const [toastMessage, setToastMessage] = useState("");
  const [webhookDebug, setWebhookDebug] = useState({
    error: "",
    price: "",
    received: "",
    symbol: "",
    updated: "",
  });
  const audioReadyRef = useRef(false);
  const [autoPrice, setAutoPrice] = useState(true);
  const [dataSource, setDataSource] = useState("Market Data API");
  const [lastUpdated, setLastUpdated] = useState("Manual price");
  const [priceStatus, setPriceStatus] = useState("");
  const [quote, setQuote] = useState(() => {
    const base = marketDefaults[profile.mainMarket] ?? 27500;
    return { bid: base - 0.25, ask: base + 0.25 };
  });
  const [brokerConnection, setBrokerConnection] = useState({
    accountId: "",
    accountBalance: 0,
    connected: false,
    connectionStatus: "Not Connected",
    fills: [],
    openPnl: 0,
    platform: "Not connected",
    position: null,
    realizedPnl: 0,
    updatedAt: null,
    workingOrders: [],
  });

  const [direction, setDirection] = useState("long");
  const [price, setPrice] = useState(marketDefaults[profile.mainMarket] ?? 27400);
  const [support, setSupport] = useState((marketDefaults[profile.mainMarket] ?? 27400) - 35);
  const [resistance, setResistance] = useState((marketDefaults[profile.mainMarket] ?? 27400) + 50);
  const [entry, setEntry] = useState((marketDefaults[profile.mainMarket] ?? 27400) + 5);
  const [contracts, setContracts] = useState(profile.defaultContracts);
  const [riskPoints, setRiskPoints] = useState(profile.defaultRiskPoints);
  const [recentHigh, setRecentHigh] = useState((marketDefaults[profile.mainMarket] ?? 27400) + 50);
  const [pullbackSupport, setPullbackSupport] = useState((marketDefaults[profile.mainMarket] ?? 27400) - 35);
  const [breakoutLevel, setBreakoutLevel] = useState((marketDefaults[profile.mainMarket] ?? 27400) + 50);
  const [levelBias, setLevelBias] = useState("bullish");
  const previousDataSourceRef = useRef(dataSource);

  useEffect(() => {
    localStorage.setItem(profileStorageKey, JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    localStorage.setItem(disciplineStorageKey, JSON.stringify(discipline));
  }, [discipline]);

  useEffect(() => {
    if (activePosition) {
      localStorage.setItem(activePositionStorageKey, JSON.stringify(activePosition));
    } else {
      localStorage.removeItem(activePositionStorageKey);
    }
  }, [activePosition]);

  useEffect(() => {
    if (plannedTrade) setActivePosition(plannedTrade);
  }, [plannedTrade]);

  useEffect(() => {
    localStorage.setItem(feedbackStorageKey, JSON.stringify(feedbackItems));
  }, [feedbackItems]);

  useEffect(() => {
    localStorage.setItem(supportStorageKey, JSON.stringify(supportMessages));
  }, [supportMessages]);

  useEffect(() => {
    localStorage.setItem(streamerModeStorageKey, String(streamerMode));
  }, [streamerMode]);

  useEffect(() => {
    localStorage.setItem(journalStorageKey, JSON.stringify(safeArray(journalEntries)));
  }, [journalEntries]);

  useEffect(() => {
    localStorage.setItem(layoutStorageKey, JSON.stringify({ ...layoutPrefs, cardOrder: normalizeCardList(layoutPrefs.cardOrder) }));
  }, [layoutPrefs]);

  useEffect(() => {
    localStorage.setItem(watchlistStorageKey, JSON.stringify(normalizeWatchlistItems(watchlist, profile.mainMarket)));
  }, [watchlist]);

  useEffect(() => {
    const nextWorkspace = migrateWorkspace({
      ...workspace,
      activeConnection: dataSource,
      cardOrder: normalizeCardList(layoutPrefs.cardOrder),
      journalEntries: safeArray(journalEntries),
      layout: layoutPrefs.mode || workspace.layout,
      layoutPrefs,
      selectedMarket: profile.mainMarket,
      tradePlan: plannedTrade || null,
      watchlist: normalizeWatchlistItems(watchlist, profile.mainMarket),
    });
    setWorkspace(nextWorkspace);
    localStorage.setItem(workspaceStorageKey, JSON.stringify(nextWorkspace));
    localStorage.setItem(tradePlanStorageKey, JSON.stringify(plannedTrade || null));
    localStorage.setItem(connectionModeStorageKey, dataSource);
  }, [dataSource, journalEntries, layoutPrefs, plannedTrade, profile.mainMarket, watchlist]);

  useEffect(() => {
    const unlockAudio = () => {
      audioReadyRef.current = true;
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, []);

  useEffect(() => {
    if (!supabase) return undefined;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthMessage(nextSession ? "Personal dashboard connected." : "Signed out. Local mode is still available.");
      if (nextSession?.user) {
        setAuthModal(null);
        setActivePage("dashboard");
      }
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user || !supabase) return;

    let cancelled = false;
    const loadWorkspace = async () => {
      setSyncStatus("Loading personal dashboard...");

      const [{ data: profileRow }, { data: settingsRow }, { data: activePlan }, { data: journalRows }, { data: watchRows }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle(),
        supabase.from("trade_settings").select("*").eq("user_id", session.user.id).maybeSingle(),
        supabase.from("trade_plans").select("*").eq("user_id", session.user.id).eq("status", "active").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("trade_journal").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(50),
        supabase.from("watchlist").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false }),
      ]);

      if (cancelled) return;

      if (profileRow) {
        setProfile((current) => profileFromDatabase(profileRow, current));
        setStreamerMode(Boolean(profileRow.streamer_mode));
      }

      if (settingsRow) {
        const migratedSettings = migrateWorkspace({
          layoutPrefs: settingsRow.preferred_layout || {},
          selectedMarket: settingsRow.selected_market,
          support: settingsRow.support,
          resistance: settingsRow.resistance,
        });
        setProfile((current) => ({ ...current, ...(settingsRow.risk_settings || {}), mainMarket: settingsRow.selected_market || current.mainMarket }));
        if (Number.isFinite(Number(settingsRow.support))) setSupport(Number(settingsRow.support));
        if (Number.isFinite(Number(settingsRow.resistance))) setResistance(Number(settingsRow.resistance));
        setLayoutPrefs(migratedSettings.layoutPrefs);
        setWorkspace((current) => migrateWorkspace({ ...current, ...migratedSettings }));
      }

      if (activePlan?.plan) {
        const migratedPlan = normalizeTradePlan(activePlan.plan);
        setPlannedTrade(migratedPlan);
        setActivePosition(migratedPlan.status === "active" ? migratedPlan : null);
      }

      if (safeArray(journalRows).length) setJournalEntries(safeArray(journalRows).map((row) => ({ id: row.id, ...(row.entry || {}), stamp: row.created_at })));
      if (safeArray(watchRows).length) setWatchlist(normalizeWatchlistItems(safeArray(watchRows).map((row) => ({ id: row.id, notes: row.notes, symbol: row.symbol })), profile.mainMarket));
      setSyncStatus("Personal dashboard synced");
      setActivePage("dashboard");
    };

    loadWorkspace().catch((error) => setSyncStatus(error.message || "Unable to load personal dashboard"));
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    setContracts(profile.defaultContracts);
  }, [profile.defaultContracts]);

  useEffect(() => {
    setRiskPoints(profile.defaultRiskPoints);
  }, [profile.defaultRiskPoints]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  const installApp = async () => {
    if (!installPrompt) {
      setActivePage("install");
      return;
    }

    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
    setInstallBannerDismissed(true);
    localStorage.setItem(installDismissedStorageKey, "true");
  };

  const dismissInstallBanner = () => {
    localStorage.setItem(installDismissedStorageKey, "true");
    setInstallBannerDismissed(true);
  };

  useEffect(() => {
    if (dataSource === "TradingView Webhook") return;
    const base = marketDefaults[profile.mainMarket] ?? 27400;
    setPrice(base);
    setSupport(base - Math.max(10, base * 0.0013));
    setResistance(base + Math.max(10, base * 0.0018));
    setEntry(base);
    setRecentHigh(base + Math.max(10, base * 0.0018));
    setPullbackSupport(base - Math.max(10, base * 0.0013));
    setBreakoutLevel(base + Math.max(10, base * 0.0018));
    setLastUpdated(`Market changed to ${profile.mainMarket}`);
  }, [dataSource, profile.mainMarket]);

  useEffect(() => {
    const previousSource = previousDataSourceRef.current;
    if (previousSource === dataSource) return;
    previousDataSourceRef.current = dataSource;
    setPlannedTrade((current) => {
      if (!current || current.sourceMode === dataSource) return current;
      setFastMessage("Plan reset. Generate a new plan from current data.");
      return null;
    });
    setActivePosition((current) => {
      if (!current || current.sourceMode === dataSource) return current;
      return null;
    });
  }, [dataSource]);

  useEffect(() => {
    if (!plannedTrade) return;
    const validation = validateTradePlan(plannedTrade);
    if (validation.valid) return;
    setPlannedTrade(null);
    setActivePosition(null);
    setPriceStatus(validation.reason);
    setFastMessage("Plan reset. Generate a new plan from current data.");
  }, [plannedTrade]);

  useEffect(() => {
    if (!autoPrice) {
      setDataSource("Manual Mode");
      setPriceStatus("");
      setLastUpdated("Manual price");
      return undefined;
    }

    setPriceStatus("");
    const canUseLocalMarketServer =
      typeof EventSource !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

    const applyBrokerSnapshot = (snapshot) => {
      setBrokerConnection(snapshot);

      if (snapshot.quote?.symbol === profile.mainMarket) {
        setPrice(snapshot.quote.price);
        setQuote({ bid: snapshot.quote.bid, ask: snapshot.quote.ask });
        setLastUpdated(new Date(snapshot.quote.timestamp || snapshot.updatedAt).toLocaleTimeString());
      } else if (snapshot.updatedAt) {
        setLastUpdated(new Date(snapshot.updatedAt).toLocaleTimeString());
      }
      if (Number.isFinite(Number(snapshot.dailyPnl))) updateDiscipline("dailyPnl", Number(snapshot.dailyPnl));

      if (snapshot.position?.symbol === profile.mainMarket) {
        const brokerPosition = snapshot.position;
        const fallbackStop = getSmartStop({
          direction: brokerPosition.direction,
          entry: brokerPosition.entry,
          resistance,
          riskPoints,
          support,
        }).smartStop;
        const trim1 = brokerPosition.direction === "long" ? brokerPosition.entry + profile.trim1Points : brokerPosition.entry - profile.trim1Points;
        const trim2 = brokerPosition.direction === "long" ? brokerPosition.entry + profile.trim2Points : brokerPosition.entry - profile.trim2Points;
        const runner = brokerPosition.direction === "long" ? brokerPosition.entry + profile.runnerPoints : brokerPosition.entry - profile.runnerPoints;

        const brokerPlan = normalizeTradePlan({
          ...brokerPosition,
          sourceMode: dataSource,
          stop: brokerPosition.stop ?? fallbackStop,
          target: brokerPosition.target ?? runner,
          trim1,
          trim2,
          runner,
        }, {
          contracts: brokerPosition.contracts,
          direction: brokerPosition.direction,
          entry: brokerPosition.entry,
          stop: brokerPosition.stop ?? fallbackStop,
        });
        setDirection(brokerPlan.direction);
        setEntry(brokerPlan.entry);
        setContracts(brokerPlan.contracts);
        setActivePosition({
          ...brokerPlan,
          status: "active",
        });
        setPlannedTrade({
          ...brokerPlan,
          setupType: "Broker Connection",
          status: "active",
        });
        setFastMessage(`${snapshot.platform} synced an active ${brokerPosition.direction} position.`);
      } else if (snapshot.connected && !snapshot.position) {
        setActivePosition(null);
        setPlannedTrade(null);
        setFastMessage(`${snapshot.platform} is connected. No active position detected.`);
      }
    };

    if (dataSource === "Broker Connection") {
      if (!canUseLocalMarketServer) {
        setPriceStatus("Broker connection requires the local market server at 127.0.0.1:8787.");
        return undefined;
      }

      const stream = new EventSource(`${marketServerUrl}/api/broker/stream?symbol=${profile.mainMarket}`);
      let demoTimer;

      stream.onmessage = (event) => {
        applyBrokerSnapshot(JSON.parse(event.data));
        setPriceStatus("");
      };

      stream.onerror = () => {
        stream.close();
        setPriceStatus("Broker stream unavailable. Start the local market server, then reconnect.");
      };

      if (brokerConnection.platform === "Demo Broker") {
        demoTimer = setInterval(() => {
          fetch(`${marketServerUrl}/api/broker/demo/tick?symbol=${profile.mainMarket}`).catch(() => {
            setPriceStatus("Demo broker tick unavailable. Start the local market server.");
          });
        }, 1000);
      }

      return () => {
        stream.close();
        if (demoTimer) clearInterval(demoTimer);
      };
    }

    if (dataSource.includes("Tradovate") && canUseLocalMarketServer) {
      const mode = dataSource === tradovateModes.prop ? "prop" : dataSource === tradovateModes.live ? "live" : "demo";
      const refreshTradovateSnapshot = async () => {
        try {
          const response = await fetch(`${marketServerUrl}/api/tradovate/quote?mode=${mode}&symbol=${profile.mainMarket}`);
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Tradovate read-only data unavailable.");
          applyBrokerSnapshot(result.snapshot || result);
          setPriceStatus("");
        } catch (error) {
          setPriceStatus(`${error.message || "Tradovate unavailable."} Use TradingView Alerts or Manual Mode as fallback.`);
        }
      };

      refreshTradovateSnapshot();
      const timer = setInterval(refreshTradovateSnapshot, 5000);
      return () => clearInterval(timer);
    }

    if (dataSource === "TradingView Webhook") {
      let lastWebhookTimestamp = "";
      const refreshTradingViewWebhook = async () => {
        try {
          const response = await fetch("/api/webhook/tradingview/latest");
          const result = await response.json();
          if (!response.ok || result.ok === false) throw new Error(result.error || "TradingView alerts unavailable.");
          if (!result.signal) {
            setWebhookDebug((current) => ({
              ...current,
              error: "",
              received: "No",
              updated: new Date().toLocaleTimeString(),
            }));
            setPriceStatus("Waiting for TradingView alert data.");
            return;
          }
          const signalTime = result.signal.created_at || result.signal.timestamp;
          setWebhookDebug({
            error: "",
            price: String(result.signal.price ?? ""),
            received: "Yes",
            symbol: result.signal.symbol || "",
            updated: signalTime ? new Date(signalTime).toLocaleTimeString() : new Date().toLocaleTimeString(),
          });
          if (signalTime === lastWebhookTimestamp) return;
          lastWebhookTimestamp = signalTime;
          applyAlert(result.signal);
          setPriceStatus("TradingView signal received");
          notify("TradingView signal received.", "success");
        } catch (error) {
          setWebhookDebug((current) => ({
            ...current,
            error: error.message || "TradingView webhook error",
            updated: new Date().toLocaleTimeString(),
          }));
          setPriceStatus(error.message || "TradingView alerts unavailable.");
          notify(error.message || "TradingView webhook error", "failure");
        }
      };

      refreshTradingViewWebhook();
      const timer = setInterval(refreshTradingViewWebhook, 2500);
      return () => clearInterval(timer);
    }

    if ((dataSource === "Market Data API" || dataSource === "TradingView Webhook") && canUseLocalMarketServer) {
      const stream = new EventSource(`${marketServerUrl}/api/market/stream?symbol=${profile.mainMarket}`);

      const handleQuote = (event) => {
        const quotePayload = JSON.parse(event.data);
        setPrice(quotePayload.price);
        setQuote({ bid: quotePayload.bid, ask: quotePayload.ask });
        setLastUpdated(new Date(quotePayload.timestamp).toLocaleTimeString());
        setPriceStatus("");
      };

      stream.onmessage = handleQuote;
      stream.addEventListener("quote", handleQuote);

      stream.onerror = () => {
        stream.close();
        setPriceStatus("Live price unavailable. Switch to manual mode.");
      };

      return () => stream.close();
    }

    const base = marketDefaults[profile.mainMarket] ?? 27400;
    const timer = setInterval(() => {
      const drift = Math.sin(Date.now() / 12000) * base * 0.0008;
      const noise = (Math.random() - 0.5) * base * 0.0007;
      const tick = base > 1000 ? 0.25 : base > 100 ? 0.01 : 0.01;
      const rawPrice = base + drift + noise;
      const nextPrice = Number((Math.round(rawPrice / tick) * tick).toFixed(2));
      const spread = base > 1000 ? 0.5 : base > 100 ? 0.02 : 0.02;
      setPrice(nextPrice);
      setQuote({
        bid: Number((nextPrice - spread / 2).toFixed(2)),
        ask: Number((nextPrice + spread / 2).toFixed(2)),
      });
      setLastUpdated(new Date().toLocaleTimeString());
    }, 1000);

    return () => clearInterval(timer);
  }, [autoPrice, brokerConnection.platform, dataSource, profile, resistance, riskPoints, support]);

  const engine = useMemo(() => {
    return calculateTrade({
      activePosition,
      contracts,
      direction,
      discipline,
      entry,
      price,
      profile,
      resistance,
      riskPoints,
      support,
    });
  }, [activePosition, contracts, direction, discipline, entry, price, profile, resistance, riskPoints, support]);

  const updateProfile = (key, value) => {
    setProfile((current) => ({ ...current, [key]: value }));
  };

  const updateDiscipline = (key, value) => {
    setDiscipline((current) => ({ ...current, [key]: value }));
  };

  const playBeep = (type = "success") => {
    if (!profile.soundAlerts || !audioReadyRef.current) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const beep = (frequency, start, duration) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, context.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(context.currentTime + start);
      oscillator.stop(context.currentTime + start + duration + 0.03);
    };
    if (type === "failure") {
      beep(220, 0, 0.14);
      beep(180, 0.18, 0.18);
    } else {
      beep(740, 0, 0.12);
    }
    window.setTimeout(() => context.close?.(), 600);
  };

  const notify = (message, type = "info") => {
    setToastMessage(message);
    if (type === "success" || type === "failure") playBeep(type);
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToastMessage(""), 2800);
  };

  const savePersonalWorkspace = async () => {
    const riskSettings = {
      defaultContracts: profile.defaultContracts,
      defaultRiskPoints: profile.defaultRiskPoints,
      maxDailyLoss: profile.maxDailyLoss,
      maxRiskPerTrade: profile.maxRiskPerTrade,
      maxTradesPerDay: profile.maxTradesPerDay,
      accountSize: profile.accountSize,
      accountType: profile.accountType,
      accountPhase: profile.accountPhase,
      consistencyRuleTarget: profile.consistencyRuleTarget,
      fundedPlatform: profile.fundedPlatform,
      fundedProvider: profile.fundedProvider,
      profitGoal: profile.profitGoal,
      startingBalance: profile.startingBalance,
      trailingDrawdown: profile.trailingDrawdown,
      traderStyle: profile.traderStyle,
      trim1Points: profile.trim1Points,
      trim2Points: profile.trim2Points,
      runnerPoints: profile.runnerPoints,
      voiceAlerts: profile.voiceAlerts,
      streamerMode,
    };
    const connectionSettings = {
      accountType: profile.accountType,
      dataSource,
      demoModeEnabled: brokerConnection.platform === "Demo Broker",
      fundedProvider: profile.fundedProvider,
      fundedPlatform: profile.fundedPlatform,
      manualFundedRules: {
        accountSize: profile.accountSize,
        consistencyRuleTarget: profile.consistencyRuleTarget,
        maxContracts: profile.maxContracts,
        maxDailyLoss: profile.maxDailyLoss,
        profitGoal: profile.profitGoal,
        startingBalance: profile.startingBalance,
        trailingDrawdown: profile.trailingDrawdown,
      },
    };

    if (!session?.user || !supabase) {
      localStorage.setItem(connectionSettingsStorageKey, JSON.stringify({
        brokerConnection,
        connectionSettings,
        savedAt: new Date().toISOString(),
      }));
      setSyncStatus("Connection settings saved locally");
      return "local";
    }

    await Promise.all([
      supabase.from("profiles").upsert(profileToDatabase(profile, session.user, streamerMode)),
      supabase.from("trade_settings").upsert({
        coach_preferences: { voiceAlerts: profile.voiceAlerts },
        preferred_layout: layoutPrefs,
        risk_settings: { ...riskSettings, connectionSettings },
        selected_market: profile.mainMarket,
        support,
        resistance,
        updated_at: new Date().toISOString(),
        user_id: session.user.id,
      }, { onConflict: "user_id" }),
      plannedTrade
        ? supabase.from("trade_plans").upsert({
            id: plannedTrade.remoteId,
            plan: plannedTrade,
            status: "active",
            updated_at: new Date().toISOString(),
            user_id: session.user.id,
          })
        : Promise.resolve(),
      brokerConnection.platform !== "Not connected"
        ? supabase.from("broker_connections").upsert({
            account_type: profile.accountType,
            metadata: {
              dataSource,
              lastUpdated: brokerConnection.updatedAt,
              readOnly: true,
              streamerSafe: true,
            },
            mode: "read-only",
            platform: brokerConnection.platform || profile.fundedPlatform,
            provider: profile.fundedProvider,
            status: brokerConnection.connectionStatus || "not_connected",
            updated_at: new Date().toISOString(),
            user_id: session.user.id,
          }, { onConflict: "user_id,platform" })
        : Promise.resolve(),
    ]);

    setSyncStatus("Personal dashboard saved");
    return "supabase";
  };

  useEffect(() => {
    if (!session?.user || !supabase) return undefined;
    const timer = setTimeout(() => {
      savePersonalWorkspace().catch((error) => setSyncStatus(error.message || "Save failed"));
    }, 1200);
    return () => clearTimeout(timer);
  }, [layoutPrefs, plannedTrade, profile, resistance, session?.user?.id, streamerMode, support]);

  const startFastTrade = (nextDirection) => {
    const nextEntry = price;
    const stop = getSmartStop({ direction: nextDirection, entry: nextEntry, resistance, riskPoints, support }).smartStop;
    const trim1Points = Math.max(1, Math.abs(Number(profile.trim1Points) || 1));
    const trim2Points = Math.max(trim1Points + 0.25, Math.abs(Number(profile.trim2Points) || trim1Points * 2));
    const runnerPoints = Math.max(trim2Points + 0.25, Math.abs(Number(profile.runnerPoints) || trim2Points * 1.5));
    const trim1 = nextDirection === "long" ? nextEntry + trim1Points : nextEntry - trim1Points;
    const trim2 = nextDirection === "long" ? nextEntry + trim2Points : nextEntry - trim2Points;
    const runner = nextDirection === "long" ? nextEntry + runnerPoints : nextEntry - runnerPoints;
    const nextPlan = normalizeTradePlan({
      direction: nextDirection,
      entry: nextEntry,
      contracts,
      stop,
      target: runner,
      trim1,
      trim2,
      runner,
      setupType: "Fast Mode",
      sourceMode: dataSource,
      status: "planned",
      lastAction: `${nextDirection === "long" ? "Long" : "Short"} loaded from Fast Mode`,
    });

    setDirection(nextDirection);
    setEntry(nextEntry);
    setActivePosition({
      ...nextPlan,
      status: "active",
    });
    setPlannedTrade(nextPlan);
    setDiscipline((current) => ({ ...current, tradesTaken: current.tradesTaken + 1 }));
    setFastMessage(`${nextDirection === "long" ? "Long" : "Short"} loaded. Entry, stop, trims, and runner are ready.`);
  };

  const applyQuickSetup = (setupType) => {
    const isLong = setupType.includes("Long");
    const nextDirection = isLong ? "long" : "short";
    let plan;

    if (setupType === "Breakout Long") {
      const nextEntry = resistance + 2;
      plan = {
        direction: "long",
        entry: nextEntry,
        stop: resistance - 15,
        trim1: nextEntry + 20,
        trim2: nextEntry + 40,
        runner: nextEntry + 80,
      };
    } else if (setupType === "Pullback Long") {
      const nextEntry = support + 2;
      plan = {
        direction: "long",
        entry: nextEntry,
        stop: support - 20,
        trim1: resistance,
        trim2: resistance + 20,
        runner: resistance + 60,
      };
    } else if (setupType === "Breakdown Short") {
      const nextEntry = support - 2;
      plan = {
        direction: "short",
        entry: nextEntry,
        stop: support + 15,
        trim1: nextEntry - 20,
        trim2: nextEntry - 40,
        runner: nextEntry - 80,
      };
    } else {
      const nextEntry = resistance - 2;
      plan = {
        direction: "short",
        entry: nextEntry,
        stop: resistance + 20,
        trim1: support,
        trim2: support - 20,
        runner: support - 60,
      };
    }

    const nextRisk = Math.abs(plan.entry - plan.stop);
    setDirection(nextDirection);
    setEntry(plan.entry);
    setRiskPoints(nextRisk);
    setPlannedTrade(normalizeTradePlan({
      ...plan,
      contracts,
      sourceMode: dataSource,
      target: plan.runner,
      setupType,
      status: "planned",
      lastAction: `${setupType} plan generated`,
    }));
    setFastMessage(`${setupType} plan loaded. Review the ladder and risk/reward before acting.`);
  };

  const runFastAction = (action) => {
    if (action === "long" || action === "short") {
      startFastTrade(action);
      return;
    }

    if (!activePosition) {
      setFastMessage("No active position detected. Use Long or Short first.");
      return;
    }

    const messages = {
      trim1: "First trim hit. Take partial profit.",
      trim2: "Second trim hit. Move stop tighter and protect the runner.",
      moveStop: "Move stop to breakeven.",
      exit: "Trade marked exited. No broker order was sent.",
    };

    if (action === "exit") {
      setActivePosition(null);
      setPlannedTrade(null);
    } else {
      setActivePosition((current) => ({
        ...current,
        status: action,
        stop: action === "moveStop" ? current.entry : current.stop,
        lastAction: messages[action],
      }));
    }

    setFastMessage(messages[action]);
  };

  const applyAlert = (alert) => {
    const nextMarket = normalizeFuturesSymbol(alert.symbol || profile.mainMarket);
    const nextPrice = Number(alert.price);
    const signalTime = alert.created_at || alert.receivedAt || alert.timestamp || new Date().toISOString();
    const hasSupport = Number.isFinite(Number(alert.support));
    const hasResistance = Number.isFinite(Number(alert.resistance));
    const hasEntry = Number.isFinite(Number(alert.entry));
    const hasStop = Number.isFinite(Number(alert.stop));
    if (nextMarket && nextMarket !== profile.mainMarket) updateProfile("mainMarket", nextMarket);
    if (Number.isFinite(nextPrice)) setPrice(nextPrice);
    const nextDirection = alert.direction === "long" || alert.direction === "short"
      ? alert.direction
      : alert.bias === "bearish"
        ? "short"
        : alert.bias === "bullish"
          ? "long"
          : direction;
    setDirection(nextDirection);
    if (hasSupport) setSupport(Number(alert.support));
    if (hasResistance) setResistance(Number(alert.resistance));
    if (!hasSupport && !hasResistance && dataSource !== "Manual Mode" && Number.isFinite(nextPrice)) {
      const pad = Math.max(8, Math.abs(nextPrice) * 0.0015);
      setSupport(Number((nextPrice - pad).toFixed(2)));
      setResistance(Number((nextPrice + pad).toFixed(2)));
      setFastMessage("TradingView price received. Add levels to generate a stronger plan.");
    }
    if (hasEntry) setEntry(Number(alert.entry));
    else if (Number.isFinite(nextPrice)) setEntry(nextPrice);
    if (hasStop && hasEntry) setRiskPoints(Math.abs(Number(alert.entry) - Number(alert.stop)));
    if (signalTime) setLastUpdated(new Date(signalTime).toLocaleTimeString());
    else setLastUpdated(new Date().toLocaleTimeString());
    if (Number.isFinite(nextPrice)) {
      setQuote({
        bid: Number((nextPrice - 0.25).toFixed(2)),
        ask: Number((nextPrice + 0.25).toFixed(2)),
      });
    }
    if (alert.bias) setLevelBias(alert.bias);
    if (hasEntry && hasStop && alert.targets) {
      const targets = Array.isArray(alert.targets) ? alert.targets.map(Number).filter(Number.isFinite) : [];
      if (targets.length) {
        const tvPlan = normalizeTradePlan({
          contracts,
          direction: nextDirection,
          entry: Number(alert.entry),
          runner: targets[2] ?? targets[targets.length - 1],
          setupType: "TradingView Alert",
          sourceMode: "TradingView Webhook",
          status: "planned",
          stop: Number(alert.stop),
          target: targets[targets.length - 1],
          trim1: targets[0],
          trim2: targets[1] ?? targets[0],
        }, {
          contracts,
          direction: nextDirection,
          entry: Number(alert.entry),
          stop: Number(alert.stop),
        });
        setPlannedTrade(tvPlan);
      }
    }
    setBrokerConnection((current) => ({
      ...current,
      connected: true,
      connectionStatus: "TradingView signal received",
      error: "",
      lastSignalAt: signalTime,
      platform: "TradingView Webhook",
      price: Number.isFinite(nextPrice) ? nextPrice : current.price,
      quote: Number.isFinite(nextPrice)
        ? { bid: Number((nextPrice - 0.25).toFixed(2)), price: nextPrice, ask: Number((nextPrice + 0.25).toFixed(2)) }
        : current.quote,
      source: "TradingView Alerts",
      updatedAt: signalTime,
    }));
    setDataSource("TradingView Webhook");
    setAutoPrice(true);
    setPriceStatus("TradingView signal received");
    setFastMessage(!hasSupport && !hasResistance
      ? `TradingView price received. ${nextMarket} updated at ${Number.isFinite(nextPrice) ? nextPrice.toFixed(2) : "market price"}. Add levels to generate plan.`
      : `TradingView signal received. ${nextMarket} updated at ${Number.isFinite(nextPrice) ? nextPrice.toFixed(2) : "market price"}.`);
    if (activePage !== "connections") setActivePage("dashboard");
  };

  const applyDemoBrokerSnapshot = (snapshot) => {
    setBrokerConnection({
      ...snapshot,
      connected: true,
      connectionStatus: "Demo Broker Connected",
      platform: "Demo Broker",
      source: "Simulated demo data",
    });
    setDataSource("Demo Broker");
    setAutoPrice(true);
    updateProfile("accountType", "Demo / Practice Account");
    updateProfile("fundedPlatform", "Manual Mode");
    setPrice(snapshot.price || snapshot.quote?.price || marketDefaults[profile.mainMarket] || 27500);
    setQuote({
      bid: Number(snapshot.bid ?? snapshot.quote?.bid ?? ((snapshot.price || 27500) - 0.25)),
      ask: Number(snapshot.ask ?? snapshot.quote?.ask ?? ((snapshot.price || 27500) + 0.25)),
    });
    updateDiscipline("dailyPnl", Number(snapshot.dailyPnl ?? snapshot.openPnl ?? 0));
    setWatchlist((current) => {
      const symbol = snapshot.symbol || profile.mainMarket || "MNQ";
      const demoItem = { id: "demo-broker-watch", notes: "Demo broker price feed active", symbol };
      return [demoItem, ...normalizeWatchlistItems(current, profile.mainMarket).filter((item) => item.id !== demoItem.id && item.symbol !== symbol)].slice(0, 8);
    });
    if (snapshot.position) {
      const demoPlan = normalizeTradePlan({
        ...snapshot.position,
        runner: snapshot.position.target ?? snapshot.position.entry + profile.runnerPoints,
        sourceMode: "Demo Broker",
        setupType: "Demo Broker",
        status: "active",
        stop: snapshot.position.stop ?? snapshot.position.entry - profile.defaultRiskPoints,
        target: snapshot.position.target ?? snapshot.position.entry + profile.runnerPoints,
        trim1: snapshot.position.trim1 ?? snapshot.position.entry + profile.trim1Points,
        trim2: snapshot.position.trim2 ?? snapshot.position.entry + profile.trim2Points,
      }, {
        contracts,
        direction,
        entry: snapshot.position.entry,
        stop: snapshot.position.entry - profile.defaultRiskPoints,
      });
      setActivePosition(demoPlan);
      setPlannedTrade(demoPlan);
    }
    setLastUpdated(new Date(snapshot.timestamp || snapshot.updatedAt || Date.now()).toLocaleTimeString());
    setFastMessage("Demo Broker Connected - simulated data is powering the dashboard.");
    setPriceStatus("");
    notify("Demo Broker connected.", "success");
    setActivePage("connections");
  };

  const createLocalDemoBrokerSnapshot = () => {
    const symbol = profile.mainMarket || "MNQ";
    const base = marketDefaults[symbol] || 27500;
    const priceValue = Number((base + 4.5).toFixed(2));
    const entryValue = Number((priceValue - 7.25).toFixed(2));
    const openPnl = Number(((priceValue - entryValue) * (pointValues[symbol] || 2)).toFixed(2));
    return {
      accountBalance: 50000,
      accountId: "DEMO-SIM-001",
      accountName: "Demo Broker",
      accountType: "demo",
      ask: Number((priceValue + 0.25).toFixed(2)),
      bid: Number((priceValue - 0.25).toFixed(2)),
      connected: true,
      connectionStatus: "Demo Broker Connected",
      dailyPnl: openPnl,
      fills: brokerSamplePayload.fills,
      openPnl,
      platform: "Demo Broker",
      position: {
        contracts: 1,
        direction: "long",
        entry: entryValue,
        lastAction: "Demo position generated",
        openPnl,
        status: "active",
        stop: Number((entryValue - 20).toFixed(2)),
        symbol,
        target: Number((entryValue + 40).toFixed(2)),
      },
      price: priceValue,
      quote: {
        ask: Number((priceValue + 0.25).toFixed(2)),
        bid: Number((priceValue - 0.25).toFixed(2)),
        price: priceValue,
        source: "Simulated demo data",
        symbol,
        timestamp: new Date().toISOString(),
      },
      realizedPnl: 0,
      source: "Simulated demo data",
      symbol,
      timestamp: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      workingOrders: brokerSamplePayload.workingOrders,
    };
  };

  const activateManualMode = () => {
    setAutoPrice(false);
    setDataSource("Manual Mode");
    updateProfile("accountType", "Personal Trading Account");
    updateProfile("fundedPlatform", "Manual Mode");
    setBrokerConnection((current) => ({
      ...current,
      connected: false,
      connectionStatus: "Manual Mode Active",
      error: "",
      platform: "Manual Mode",
      source: "Manual entry",
    }));
    setFastMessage("Manual Mode Active - enter price and levels yourself.");
    setPriceStatus("");
    notify("Manual Mode Active", "success");
    setActivePage("connections");
  };

  const activateTradingViewMode = () => {
    setAutoPrice(true);
    setDataSource("TradingView Webhook");
    updateProfile("fundedPlatform", "TradingView Webhook");
    setBrokerConnection((current) => ({
      ...current,
      connected: false,
      connectionStatus: "Waiting for TradingView alert data",
      error: "",
      platform: "TradingView Webhook",
      source: "Webhook",
    }));
    setFastMessage("Waiting for TradingView alert data.");
    setPriceStatus("");
    notify("Waiting for TradingView Alerts");
    setActivePage("connections");
  };

  const startDemoBroker = async () => {
    try {
      const response = await fetch(`${marketServerUrl}/api/broker/demo/start`, {
        body: JSON.stringify({ symbol: profile.mainMarket }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Demo broker unavailable.");

      applyDemoBrokerSnapshot({
        ...result.snapshot,
        connectionStatus: "Demo Broker Connected",
        dailyPnl: result.snapshot.dailyPnl ?? result.snapshot.openPnl ?? 0,
        source: "Simulated demo data",
      });
      setActivePage("connections");
    } catch {
      applyDemoBrokerSnapshot(createLocalDemoBrokerSnapshot());
      setPriceStatus("Local demo data is active. Start the market server later for streaming ticks.");
      setActivePage("connections");
    }
  };

  const connectTradovateReadOnly = async (mode) => {
    const platform = mode === "prop" ? tradovateModes.prop : mode === "live" ? tradovateModes.live : tradovateModes.demo;
    setBrokerConnection((current) => ({
      ...current,
      connected: false,
      connectionStatus: "Connecting",
      error: "",
      platform,
    }));
    setPriceStatus("");

    try {
      if (mode === "demo") {
        const response = await fetch(`${tradovateApiBase}/api/tradovate/demo/auth`, { method: "POST" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Tradovate demo authentication failed.");

        const [accountsResponse, positionsResponse, fillsResponse, contractResponse, chartResponse] = await Promise.all([
          fetch(`${tradovateApiBase}/api/tradovate/demo/accounts`),
          fetch(`${tradovateApiBase}/api/tradovate/demo/positions`),
          fetch(`${tradovateApiBase}/api/tradovate/demo/fills`),
          fetch(`${tradovateApiBase}/api/tradovate/demo/contract?symbol=${encodeURIComponent(profile.mainMarket)}`),
          fetch(`${tradovateApiBase}/api/tradovate/demo/chart?symbol=${encodeURIComponent(profile.mainMarket)}`),
        ]);
        const [accounts, positions, fills, contract, chart] = await Promise.all([
          accountsResponse.json(),
          positionsResponse.json(),
          fillsResponse.json(),
          contractResponse.json(),
          chartResponse.json(),
        ]);
        if (!accountsResponse.ok) throw new Error(accounts.error || "Tradovate demo accounts unavailable.");

        const account = Array.isArray(accounts) ? accounts[0] || {} : accounts;
        const positionList = Array.isArray(positions) ? positions : [];
        const position = positionList[0];
        const bars = chart?.chart?.bars || [];
        const latestBar = bars.at?.(-1) || {};
        const nextPrice = Number(latestBar.close || price);
        const nextSnapshot = {
          accountBalance: Number(account.cashBalance ?? account.netLiq ?? account.balance ?? profile.accountSize),
          accountId: account.id ? String(account.id) : account.accountId ? String(account.accountId) : "",
          accountName: account.name || account.nickname || "Tradovate Demo Account",
          accountType: "demo",
          ask: Number((nextPrice + 0.25).toFixed(2)),
          bid: Number((nextPrice - 0.25).toFixed(2)),
          connected: true,
          connectionStatus: "Demo Connected",
          dailyPnl: 0,
          error: "",
          fills: Array.isArray(fills) ? fills : [],
          openPnl: Number(position?.openPnl ?? position?.unrealizedPnl ?? 0),
          platform,
          position: position
            ? {
                contracts: Math.abs(Number(position.netPos ?? position.quantity ?? position.contracts ?? 0)),
                direction: Number(position.netPos ?? position.quantity ?? 0) < 0 ? "short" : "long",
                entry: Number(position.netPrice ?? position.averagePrice ?? position.entryPrice ?? nextPrice),
                openPnl: Number(position.openPnl ?? position.unrealizedPnl ?? 0),
                status: "active",
                symbol: profile.mainMarket,
              }
            : null,
          price: nextPrice,
          realizedPnl: 0,
          source: "Tradovate Demo API",
          symbol: profile.mainMarket,
          tradovateContract: contract,
          tradovateChart: chart,
        };

        setBrokerConnection(nextSnapshot);
        if (Number.isFinite(nextPrice)) setPrice(nextPrice);
        setQuote({ bid: nextSnapshot.bid, ask: nextSnapshot.ask });
        setDataSource(tradovateModes.demo);
        setAutoPrice(true);
        setFastMessage("Tradovate Demo read-only connected. Trading actions remain disabled.");
        setActivePage("dashboard");
        return;
      }

      const response = await fetch(`${marketServerUrl}/api/tradovate/auth`, {
        body: JSON.stringify({ mode }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Tradovate read-only connection failed.");

      const snapshotResponse = await fetch(`${marketServerUrl}/api/tradovate/quote?mode=${mode}&symbol=${profile.mainMarket}`);
      const snapshot = await snapshotResponse.json();
      if (!snapshotResponse.ok) throw new Error(snapshot.error || "Tradovate market data unavailable.");

      const nextSnapshot = {
        ...(snapshot.snapshot || snapshot),
        accountType: mode === "prop" ? "funded/prop" : mode === "live" ? "personal live" : "demo",
        connectionStatus: mode === "prop" ? "Prop/Funded Read-Only Connected" : mode === "live" ? "Live Read-Only Connected" : "Demo Connected",
        error: "",
        platform,
      };
      setBrokerConnection(nextSnapshot);
      if (Number.isFinite(Number(nextSnapshot.price))) setPrice(Number(nextSnapshot.price));
      if (Number.isFinite(Number(nextSnapshot.bid)) && Number.isFinite(Number(nextSnapshot.ask))) {
        setQuote({ bid: Number(nextSnapshot.bid), ask: Number(nextSnapshot.ask) });
      }
      if (Number.isFinite(Number(nextSnapshot.dailyPnl))) updateDiscipline("dailyPnl", Number(nextSnapshot.dailyPnl));
      setDataSource(mode === "prop" ? tradovateModes.prop : mode === "live" ? tradovateModes.live : tradovateModes.demo);
      setAutoPrice(true);
      setFastMessage(`${mode === "prop" ? "Prop/Funded" : mode === "live" ? "Live" : "Demo"} Tradovate read-only connected. Trading actions remain disabled.`);
      setActivePage("dashboard");
    } catch {
      const message = "Tradovate API credentials are not configured yet. Add Vercel env vars first.";
      setBrokerConnection((current) => ({
        ...current,
        connected: false,
        connectionStatus: "Not configured yet",
        error: message,
        platform,
      }));
      setPriceStatus(message);
      notify("Tradovate credentials missing.", "failure");
      setActivePage("connections");
    }
  };

  const applyUserTradovateConnection = (result) => {
    const firstPosition = Array.isArray(result.positions) ? result.positions[0] : null;
    const position = firstPosition
      ? {
          contracts: Math.abs(Number(firstPosition.netPos ?? firstPosition.quantity ?? firstPosition.contracts ?? 0)),
          direction: Number(firstPosition.netPos ?? firstPosition.quantity ?? 0) < 0 ? "short" : "long",
          entry: Number(firstPosition.netPrice ?? firstPosition.averagePrice ?? firstPosition.entryPrice ?? price),
          openPnl: Number(firstPosition.openPnl ?? firstPosition.unrealizedPnl ?? 0),
          status: "active",
          symbol: profile.mainMarket,
        }
      : null;
    setBrokerConnection({
      accountName: result.accountName || "Tradovate Account",
      accountType: result.accountType || "demo",
      connected: true,
      connectionStatus: "Tradovate Connected",
      error: "",
      expirationTime: result.expirationTime,
      fills: result.fills || [],
      hasFunded: result.hasFunded,
      hasLive: result.hasLive,
      hasMarketData: result.hasMarketData,
      openPnl: Number(position?.openPnl || 0),
      platform: "Tradovate",
      position,
      provider: result.provider || "",
      quote: result.quote || null,
      readOnly: true,
      accounts: result.accounts || [],
      selectedAccountId: result.selectedAccountId,
      source: "User-owned Tradovate read-only",
      username: result.username,
      workingOrders: [],
    });
    if (position) setActivePosition(position);
    if (result.quote?.price) setPrice(Number(result.quote.price));
    if (Number.isFinite(Number(result.quote?.bid)) && Number.isFinite(Number(result.quote?.ask))) {
      setQuote({ bid: Number(result.quote.bid), ask: Number(result.quote.ask) });
    }
    setDataSource("Tradovate Read-Only");
    setAutoPrice(true);
    setLastUpdated(new Date().toLocaleTimeString());
    if (result.hasFunded || result.accountType === "funded") {
      updateProfile("accountType", "Funded / Prop Firm Account");
      updateProfile("fundedPlatform", "Tradovate");
    }
    if (result.provider) updateProfile("fundedProvider", result.provider);
    setFastMessage(result.message || "Tradovate Connected. Read-only mode active.");
    setPriceStatus("");
    notify("Tradovate connected.", "success");
  };

  const applyUserTradovateDisconnect = () => {
    setBrokerConnection((current) => ({
      ...current,
      connected: false,
      connectionStatus: "Disconnected",
      error: "",
      platform: "Tradovate",
      source: "Disconnected",
    }));
    setDataSource("Manual Mode");
    setFastMessage("Tradovate disconnected. Manual Mode is active.");
    notify("Tradovate disconnected");
  };

  const applyUserTradovateAccount = (account) => {
    setBrokerConnection((current) => ({
      ...current,
      accountName: account?.name || current.accountName,
      selectedAccountId: account?.id ? String(account.id) : current.selectedAccountId,
    }));
    notify("Active Tradovate account set");
  };

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setActivePage("dashboard");
    setSyncStatus("Local workspace");
  };

  const addJournalEntry = async (entryText) => {
    const entry = {
      action: engine.suggestedAction,
      dailyPnl: discipline.dailyPnl,
      market: profile.mainMarket,
      note: entryText,
      plan: plannedTrade,
      price,
      score: engine.score,
      stamp: new Date().toISOString(),
    };
    setJournalEntries((current) => [entry, ...current]);

    if (session?.user && supabase) {
      await supabase.from("trade_journal").insert({ entry, user_id: session.user.id });
      setSyncStatus("Journal saved");
    }
  };

  return (
    <div className="app-shell" style={styles.page}>
      <style>{`
        html,
        body,
        #root {
          width: 100% !important;
          max-width: 100% !important;
          min-width: 100% !important;
          min-height: 100vh !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #05070d !important;
          overflow-x: hidden !important;
        }
        body {
          display: block !important;
          place-items: unset !important;
          justify-content: unset !important;
          align-items: unset !important;
        }
        main { max-width: none !important; }
        *, *::before, *::after { box-sizing: border-box; }
        img, svg, canvas, video { max-width: 100%; }
        .app-shell { width: 100%; min-height: 100vh; overflow-x: hidden; background: #05070d; }
        .app-container,
        .page-container,
        .dashboard-container {
          width: 100%;
          max-width: 100%;
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          overflow-x: hidden;
        }
        .desktop-dashboard {
          display: grid;
          grid-template-columns: 240px minmax(0, 1fr) 330px;
          gap: 18px;
          width: 100%;
          max-width: 100%;
          min-height: 100vh;
          padding: 18px;
          box-sizing: border-box;
          align-items: start;
          overflow-x: hidden;
        }
        .main-dashboard { min-width: 0; max-width: 100%; display: grid; gap: 18px; }
        .chart-panel { min-height: 520px; }
        .right-panel { min-width: 0; }
        .dashboard-grid {
          width: 100%;
          display: grid;
          grid-template-columns: minmax(420px, 0.95fr) minmax(520px, 1.35fr);
          gap: 24px;
          align-items: start;
          margin-bottom: 24px;
        }
        .full-width-section { grid-column: 1 / -1; }
        @media (max-width: 900px) {
          .desktop-dashboard { grid-template-columns: 1fr; padding: 12px; }
          .left-sidebar, .right-panel { display: none !important; }
          .dashboard-grid { grid-template-columns: 1fr !important; }
          .app-container, .page-container, .dashboard-container { padding: 16px; }
          .home-feature-grid { grid-template-columns: 1fr !important; }
          .chart-panel { min-height: 300px; }
          .tradepilot-chart-wrap { height: 300px !important; }
        }
        .mobile-launch-button { display: none !important; }
        .mobile-menu-item { display: none !important; }
        .desktop-nav-item { display: none !important; }
        .mobile-menu-button { display: inline-flex !important; }
        @media (max-width: 760px) {
          .desktop-nav-item { display: none !important; }
          .mobile-menu-item { display: block !important; }
          .mobile-menu-button { display: inline-flex !important; }
          .mobile-launch-button { display: inline-flex !important; align-items: center; }
          .tradepilot-title { font-size: 34px !important; }
          .tradepilot-header { align-items: center !important; padding-top: 8px !important; }
          .tradepilot-top-actions { position: static !important; width: 100%; justify-content: center !important; }
          .tradepilot-subtitle,
          .tradepilot-positioning,
          .tradepilot-header-meta,
          .tradepilot-auth-actions { display: none !important; }
          .tradepilot-title { font-size: 24px !important; line-height: 1 !important; margin: 0 !important; }
          .tradepilot-header { align-items: center !important; display: flex !important; gap: 10px !important; justify-content: space-between !important; padding: 10px 12px !important; }
          .tradepilot-top-actions { margin-left: auto !important; position: static !important; width: auto !important; justify-content: flex-end !important; gap: 8px !important; }
          .mobile-drawer {
            background: #05070d !important;
            border-left: 1px solid #1e3a5f !important;
            border-radius: 0 !important;
            box-shadow: -18px 0 44px rgba(0, 0, 0, .45) !important;
            display: grid !important;
            gap: 10px !important;
            height: 100vh !important;
            left: auto !important;
            max-width: 100vw !important;
            overflow-y: auto !important;
            padding: 18px !important;
            position: fixed !important;
            right: 0 !important;
            top: 0 !important;
            transform: translateX(0) !important;
            width: min(85vw, 360px) !important;
            z-index: 9999 !important;
          }
          .mobile-drawer.closed { transform: translateX(100%) !important; }
          .mobile-overlay {
            background: rgba(0, 0, 0, .6) !important;
            border: 0 !important;
            cursor: pointer;
            inset: 0 !important;
            padding: 0 !important;
            position: fixed !important;
            z-index: 9998 !important;
          }
          .mobile-menu-item { display: block !important; width: 100% !important; }
          .dashboard-card-board { display: flex !important; flex-direction: column !important; max-width: 100% !important; width: 100% !important; }
          .dashboard-card-slot { max-width: 100% !important; min-width: 0 !important; width: 100% !important; }
          .card-coach { order: 2; }
          .card-tradePlan { order: 3; }
          .card-chart { order: 4; }
          .card-risk { order: 5; }
          .card-journal { order: 6; }
          .card-performanceStats { order: 7; }
          .card-alerts, .card-watchlist, .card-propFirmRules { order: 8; }
          .onboarding-card { max-width: 100% !important; width: 100% !important; }
          .onboarding-card button { width: 100% !important; }
          .install-banner { max-width: 100% !important; width: 100% !important; }
          .install-banner button { flex: 1 1 100%; }
          .mobile-status-bar { display: grid !important; }
          .mobile-status-bar > div { min-width: 0; }
          .mobile-status-bar strong { display: block; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .tradepilot-feedback { align-items: center; display: flex; font-size: 0 !important; height: 38px; justify-content: center; padding: 0 !important; width: 38px; }
          .tradepilot-feedback::after { content: "?"; font-size: 16px; }
          .home-title { font-size: 42px !important; }
        }
      `}</style>
      <div className="app-container" style={styles.shell}>
        <header className="tradepilot-header" style={styles.header}>
          <div style={styles.headerBrand}>
            <p style={styles.eyebrow}>Trade Pilot Alpha</p>
            <h1 className="tradepilot-title" style={styles.title}>Trade Pilot</h1>
            <p className="tradepilot-subtitle" style={styles.subtitle}>
              Plan trades. Manage risk. Avoid emotional entries.
            </p>
            <p className="tradepilot-positioning" style={styles.positioningText}>
              Trade Pilot is an execution assistant for futures traders.
            </p>
            <div className="tradepilot-header-meta" style={styles.headerMeta}>
              <span>{profile.mainMarket}</span>
              <span>{getConnectionStatusLabel(brokerConnection)}</span>
              <span>{session?.user ? session.user.email : "Guest workspace"}</span>
            </div>
          </div>

          <div className="tradepilot-top-actions" style={styles.topActions}>
            <div className="tradepilot-auth-actions" style={styles.authActions}>
              {session?.user ? (
                <>
                  <span style={styles.accountPill}>{session.user.user_metadata?.name || session.user.email}</span>
                  <button onClick={signOut} style={styles.authButton}>Log Out</button>
                </>
              ) : (
                <>
                  <span style={styles.accountPill}>Guest Mode</span>
                  <button onClick={() => setAuthModal("signup")} style={styles.authButton}>Sign Up</button>
                  <button onClick={() => setAuthModal("login")} style={styles.authButton}>Log In</button>
                </>
              )}
            </div>
            {streamerMode ? (
              <button onClick={() => setStreamerMode(false)} style={styles.secondaryButton}>Exit Streamer</button>
            ) : (
              <>
                {navigationTabs.map((tab) => (
                  <button
                    className="desktop-nav-item"
                    key={tab}
                    onClick={() => {
                      setActivePage(tab.toLowerCase());
                      setMoreMenuOpen(false);
                    }}
                    style={{ ...styles.secondaryButton, background: activePage === tab.toLowerCase() ? "#2563eb" : "#27272a" }}
                  >
                    {tab}
                  </button>
                ))}
                <button
                  className="mobile-launch-button"
                  onClick={() => {
                    setActivePage("dashboard");
                    setMoreMenuOpen(false);
                  }}
                  style={styles.secondaryButton}
                >
                  Launch App
                </button>
                <div style={styles.moreWrap}>
                  <button
                    aria-label={moreMenuOpen ? "Close menu" : "Open menu"}
                    className="mobile-menu-button"
                    onClick={() => setMoreMenuOpen((open) => !open)}
                    style={styles.menuButton}
                  >
                    <span style={styles.menuBar} />
                    <span style={styles.menuBar} />
                    <span style={styles.menuBar} />
                  </button>
                  {moreMenuOpen ? (
                    <button
                      aria-label="Close mobile menu"
                      className="mobile-overlay"
                      onClick={() => setMoreMenuOpen(false)}
                      style={styles.mobileOverlay}
                    />
                  ) : null}
                  {moreMenuOpen ? (
                    <div className="tradepilot-more-menu mobile-drawer" style={styles.moreMenu}>
                      {navigationTabs.map((tab) => (
                        <button
                          className="mobile-menu-item"
                          key={`mobile-${tab}`}
                          onClick={() => {
                            setActivePage(tab.toLowerCase());
                            setMoreMenuOpen(false);
                          }}
                          style={styles.moreMenuItem}
                        >
                          {tab}
                        </button>
                      ))}
                      {moreTabs.map((tab) => (
                        <button
                          className="mobile-menu-item"
                          key={tab}
                          onClick={() => {
                            setActivePage(tab.toLowerCase());
                            setMoreMenuOpen(false);
                          }}
                          style={styles.moreMenuItem}
                        >
                          {tab}
                        </button>
                      ))}
                      <label style={styles.moreToggle}>
                        <input
                          type="checkbox"
                          checked={streamerMode}
                          onChange={(event) => setStreamerMode(event.target.checked)}
                        />
                        Streamer Mode
                      </label>
                      {session?.user ? (
                        <button
                          className="mobile-menu-item"
                          onClick={() => {
                            signOut();
                            setMoreMenuOpen(false);
                          }}
                          style={styles.moreMenuItem}
                        >
                          Log Out
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </header>
        <DashboardFrame
          activePage={activePage}
          brokerConnection={brokerConnection}
          discipline={discipline}
          engine={engine}
          journalEntries={journalEntries}
          layoutPrefs={layoutPrefs}
          profile={profile}
          setActivePage={setActivePage}
          setLayoutPrefs={setLayoutPrefs}
          setStreamerMode={setStreamerMode}
          signedIn={Boolean(session?.user)}
          streamerMode={streamerMode}
          watchlist={watchlist}
        >
        {!streamerMode ? <div style={styles.alphaBanner}>Trade Pilot Alpha - educational tool. Not financial advice.</div> : null}
        {!streamerMode && !session?.user ? (
          <div style={styles.guestPrompt}>
            <span>Create a free account to save your trading workspace.</span>
            <button onClick={() => setAuthModal("signup")} style={styles.authButton}>Sign Up</button>
          </div>
        ) : null}
        {!streamerMode && activePage !== "home" && !installBannerDismissed ? (
          <InstallBanner
            canInstall={Boolean(installPrompt)}
            onDismiss={dismissInstallBanner}
            onInstall={installApp}
            onInstructions={() => setActivePage("install")}
          />
        ) : null}
        {session?.user && !onboardingComplete ? (
          <OnboardingCard
            onDone={() => {
              localStorage.setItem(onboardingStorageKey, "true");
              setOnboardingComplete(true);
            }}
          />
        ) : null}

        {activePage === "home" ? (
          <HomePage
            signedIn={Boolean(session?.user)}
            onJoinAlpha={() => setAuthModal("signup")}
            onLaunch={() => setActivePage("dashboard")}
          />
        ) : null}
        {activePage === "dashboard" ? (
          <Dashboard
            activePosition={activePosition}
            addJournalEntry={addJournalEntry}
            applyQuickSetup={applyQuickSetup}
            autoPrice={autoPrice}
            brokerConnection={brokerConnection}
            contracts={contracts}
            dataSource={dataSource}
            direction={direction}
            discipline={discipline}
            engine={engine}
            entry={entry}
            fastMessage={fastMessage}
            journalEntries={journalEntries}
            layoutPrefs={layoutPrefs}
            lastUpdated={lastUpdated}
            notify={notify}
            price={price}
            priceStatus={priceStatus}
            plannedTrade={plannedTrade}
            profile={profile}
            quote={quote}
            breakoutLevel={breakoutLevel}
            levelBias={levelBias}
            pullbackSupport={pullbackSupport}
            recentHigh={recentHigh}
            resistance={resistance}
            riskPoints={riskPoints}
            runFastAction={runFastAction}
            setAutoPrice={setAutoPrice}
            setContracts={setContracts}
            setDataSource={setDataSource}
            setDirection={setDirection}
            setEntry={setEntry}
            setPrice={setPrice}
            setBreakoutLevel={setBreakoutLevel}
            setLevelBias={setLevelBias}
            setLayoutPrefs={setLayoutPrefs}
            setPullbackSupport={setPullbackSupport}
            setRecentHigh={setRecentHigh}
            setResistance={setResistance}
            setRiskPoints={setRiskPoints}
            setSupport={setSupport}
            streamerMode={streamerMode}
            support={support}
            updateDiscipline={updateDiscipline}
            updateProfile={updateProfile}
            watchlist={watchlist}
          />
        ) : null}
        {activePage === "connections" ? (
          <ConnectionsPage
            activePosition={activePosition}
            activateManualMode={activateManualMode}
            activateTradingViewMode={activateTradingViewMode}
            applyAlert={applyAlert}
            brokerConnection={brokerConnection}
            dataSource={dataSource}
            discipline={discipline}
            engine={engine}
            lastUpdated={lastUpdated}
            price={price}
            profile={profile}
            quote={quote}
            session={session}
            onAuthOpen={setAuthModal}
            onUserTradovateAccount={applyUserTradovateAccount}
            onUserTradovateDisconnected={applyUserTradovateDisconnect}
            onUserTradovateConnected={applyUserTradovateConnection}
            connectTradovateReadOnly={connectTradovateReadOnly}
            notify={notify}
            saveConnectionSettings={savePersonalWorkspace}
            setActivePage={setActivePage}
            startDemoBroker={startDemoBroker}
            updateProfile={updateProfile}
            webhookDebug={webhookDebug}
          />
        ) : null}
        {activePage === "account" ? (
          <AccountPage
            authMessage={authMessage}
            isConfigured={isSupabaseConfigured}
            layoutPrefs={layoutPrefs}
            session={session}
            setLayoutPrefs={setLayoutPrefs}
            onAuthOpen={setAuthModal}
            signOut={signOut}
            syncStatus={syncStatus}
          />
        ) : null}
        {activePage === "install" ? <InstallPage canInstall={Boolean(installPrompt)} onInstall={installApp} /> : null}
        {activePage === "journal" ? (
          <JournalPage
            activePosition={activePosition}
            addJournalEntry={addJournalEntry}
            discipline={discipline}
            engine={engine}
            journalEntries={journalEntries}
          />
        ) : null}
        {activePage === "profile" ? <ProfilePage profile={profile} updateProfile={updateProfile} /> : null}
        {activePage === "help" ? <HelpPage /> : null}
        {activePage === "support" ? (
          <SupportPage
            messages={supportMessages}
            onSubmit={(message) => setSupportMessages((current) => [{ ...message, stamp: new Date().toLocaleString() }, ...current])}
          />
        ) : null}
        {activePage === "settings" ? (
          <SettingsPage
            applyAlert={applyAlert}
            profile={profile}
            updateProfile={updateProfile}
          />
        ) : null}
        {!streamerMode ? <AlphaSignup /> : null}
        <AppFooter />
        </DashboardFrame>
      </div>

      {settingsOpen ? (
        <SettingsModal profile={profile} updateProfile={updateProfile} onClose={() => setSettingsOpen(false)} />
      ) : null}

      {!streamerMode ? <a className="tradepilot-feedback" href="mailto:support@tradepilot.app?subject=Trade%20Pilot%20Alpha%20Feedback" style={styles.feedbackButton}>Feedback</a> : null}
      {toastMessage ? <div style={styles.toast}>{toastMessage}</div> : null}

      {feedbackOpen ? (
        <FeedbackModal
          onClose={() => setFeedbackOpen(false)}
          onSubmit={(item) => {
            setFeedbackItems((current) => [{ ...item, stamp: new Date().toLocaleString() }, ...current]);
            setFeedbackOpen(false);
          }}
        />
      ) : null}

      {authModal ? (
        <AuthModal
          authMessage={authMessage}
          initialMode={authModal}
          isConfigured={isSupabaseConfigured}
          onClose={() => setAuthModal(null)}
          onSignedIn={() => {
            setAuthModal(null);
            setActivePage("dashboard");
          }}
          setAuthMessage={setAuthMessage}
          setProfile={setProfile}
        />
      ) : null}

      {!disclaimerAccepted ? (
        <DisclaimerModal
          onAccept={() => {
            localStorage.setItem(disclaimerStorageKey, "true");
            setDisclaimerAccepted(true);
          }}
        />
      ) : null}
    </div>
  );
}

function DisclaimerModal({ onAccept }) {
  return (
    <div style={{ ...styles.modalBackdrop, zIndex: 40 }}>
      <div style={styles.disclaimerModal}>
        <p style={styles.cardLabel}>Required Disclaimer</p>
        <h2 style={styles.sectionTitle}>Before You Use Trade Pilot</h2>
        <p style={styles.disclaimerText}>
          Trade Pilot is an educational trading assistant designed to help users organize trade ideas and manage risk.
        </p>
        <p style={styles.muted}>
          Trade Pilot is an educational execution assistant. It does not provide financial advice and does not place trades.
        </p>
        <p style={styles.muted}>
          Trade Pilot does not provide financial advice and does not guarantee profits.
        </p>
        <p style={styles.muted}>
          Trading futures, options, and other financial instruments involves substantial risk and may result in the loss of capital.
        </p>
        <p style={styles.muted}>
          Users are fully responsible for their trading decisions and outcomes.
        </p>
        <p style={styles.muted}>
          By using Trade Pilot, you acknowledge that you understand the risks associated with trading.
        </p>
        <button onClick={onAccept} style={styles.acceptButton}>
          I Understand
        </button>
      </div>
    </div>
  );
}

function DashboardFrame({
  activePage,
  brokerConnection,
  children,
  discipline,
  engine,
  journalEntries,
  layoutPrefs,
  profile,
  setActivePage,
  setLayoutPrefs,
  setStreamerMode,
  signedIn,
  streamerMode,
  watchlist,
}) {
  const useDashboardChrome = !streamerMode && (activePage !== "home" || signedIn);

  if (!useDashboardChrome) {
    return <main style={styles.standaloneMain}>{children}</main>;
  }

  return (
    <div className="desktop-dashboard">
      <DesktopSidebar activePage={activePage} setActivePage={setActivePage} setStreamerMode={setStreamerMode} />
      <main className="main-dashboard" style={styles.dashboardMain}>{children}</main>
      <RightInsightsPanel
        brokerConnection={brokerConnection}
        discipline={discipline}
        engine={engine}
        journalEntries={journalEntries}
        layoutPrefs={layoutPrefs}
        profile={profile}
        setLayoutPrefs={setLayoutPrefs}
        watchlist={watchlist}
      />
    </div>
  );
}

function DesktopSidebar({ activePage, setActivePage, setStreamerMode }) {
  const items = ["Home", "Dashboard", "Connections", "Journal", "Account", "Profile", "Settings"];

  return (
    <aside className="left-sidebar" style={styles.leftSidebar}>
      <div style={styles.sidebarBrand}>Trade Pilot</div>
      <nav style={styles.sidebarNav}>
        {items.map((item) => {
          const page = item.toLowerCase();
          return (
            <button
              key={item}
              onClick={() => setActivePage(page)}
              style={{ ...styles.sidebarButton, background: activePage === page ? "#1d4ed8" : "transparent" }}
            >
              {item}
            </button>
          );
        })}
      </nav>
      <button onClick={() => setStreamerMode(true)} style={styles.sidebarStreamerButton}>Streamer Mode</button>
    </aside>
  );
}

function RightInsightsPanel({ brokerConnection, discipline, engine, journalEntries, layoutPrefs, profile, setLayoutPrefs, watchlist }) {
  const fundedMetrics = getFundedAccountMetrics({ brokerConnection, discipline, profile });
  const fundedWarnings = buildFundedRuleWarnings({ brokerConnection, discipline, profile });
  const safeJournalEntries = safeArray(journalEntries);
  const safeWatchlist = normalizeWatchlistItems(watchlist, profile.mainMarket);
  const analytics = getJournalAnalytics(safeJournalEntries, discipline);
  const modeOptions = ["Simple", "Pro", "Streamer", "Prop Firm", "Journal Focus"];
  const cardToggles = [
    ["coach", "Trade Coach"],
    ["tradePlan", "Trade Plan"],
    ["chart", "Chart"],
    ["risk", "Risk Guard"],
    ["propFirmRules", "Prop Firm Rules"],
    ["journal", "Journal"],
    ["watchlist", "Watchlist"],
    ["alerts", "Alerts"],
    ["performanceStats", "Performance Stats"],
  ];

  return (
    <aside className="right-panel" style={styles.rightPanel}>
      <section style={styles.insightCard}>
        <p style={styles.cardLabel}>Customize Dashboard</p>
        <SelectField
          label="Layout"
          value={layoutPrefs.mode || "Pro"}
          options={modeOptions}
          onChange={(value) => setLayoutPrefs((current) => ({ ...current, mode: value }))}
        />
        <div style={styles.toggleList}>
          {cardToggles.map(([key, label]) => (
            <label key={key} style={styles.compactSwitchRow}>
              <input
                type="checkbox"
                checked={layoutPrefs[key] !== false}
                onChange={(event) => setLayoutPrefs((current) => ({ ...current, [key]: event.target.checked }))}
              />
              {label}
            </label>
          ))}
        </div>
      </section>

      {layoutPrefs.watchlist !== false ? (
        <section style={styles.insightCard}>
          <p style={styles.cardLabel}>Watchlist</p>
          {safeWatchlist.slice(0, 5).map((item) => (
            <PlanItem key={item.id || item.symbol} title={item.symbol} text={item.notes || "Watching"} />
          ))}
        </section>
      ) : null}

      {layoutPrefs.alerts !== false ? (
        <section style={styles.insightCard}>
          <p style={styles.cardLabel}>Alerts</p>
          <PlanItem title="Connection" text={brokerConnection.connectionStatus || getConnectionStatusLabel(brokerConnection)} />
          <PlanItem title="Coach" text={engine.coachMessage} />
        </section>
      ) : null}

      {layoutPrefs.propFirmRules !== false ? (
        <section style={styles.insightCard}>
          <p style={styles.cardLabel}>Prop Firm Rules</p>
          <Metric label="Daily Loss Left" value={`$${fundedMetrics.dailyRiskRemaining.toFixed(2)}`} />
          <Metric label="Drawdown Left" value={`$${fundedMetrics.drawdownRemaining.toFixed(2)}`} />
          <div style={styles.warningStack}>
            {(fundedWarnings.length ? fundedWarnings : ["Inside guardrails."]).map((warning) => (
              <div key={warning} style={warning.includes("Inside") ? styles.coachPrompt : styles.warningBox}>{warning}</div>
            ))}
          </div>
        </section>
      ) : null}

      {layoutPrefs.performanceStats !== false ? (
        <section style={styles.insightCard}>
          <p style={styles.cardLabel}>Performance Stats</p>
          <Metric label="Win Rate" value={`${analytics.winRate}%`} />
          <Metric label="Total Trades" value={String(analytics.totalTrades)} />
          <Metric label="Profit Factor" value={analytics.profitFactor.toFixed(2)} />
        </section>
      ) : null}

      {layoutPrefs.journal !== false ? (
        <section style={styles.insightCard}>
          <p style={styles.cardLabel}>Journal Notes</p>
          <p style={styles.muted}>{safeJournalEntries[0]?.note || "No note yet."}</p>
        </section>
      ) : null}
    </aside>
  );
}

function CustomizeDashboardPanel({ layoutPrefs, notify, setLayoutPrefs }) {
  const modeOptions = ["Simple", "Pro", "Streamer", "Prop Firm", "Journal Focus"];
  const cardToggles = dashboardCardOptions;
  const cardOrder = normalizeCardOrder(layoutPrefs.cardOrder);
  const applyMode = (mode) => {
    setLayoutPrefs((current) => ({ ...current, ...layoutModePresets[mode], mode }));
    notify?.("Dashboard layout updated.", "success");
  };
  const moveCard = (key, direction) => {
    const index = cardOrder.indexOf(key);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= cardOrder.length) return;
    const nextOrder = [...cardOrder];
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
    setLayoutPrefs((current) => ({ ...current, cardOrder: nextOrder }));
    notify?.("Dashboard layout updated.", "success");
  };

  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Customize Dashboard</p>
      <h2 style={styles.sectionTitle}>Layout and Cards</h2>
      <SelectField
        label="Layout Mode"
        value={layoutPrefs.mode || "Pro"}
        options={modeOptions}
        onChange={applyMode}
      />
      <div style={{ ...styles.formGrid, marginTop: "16px" }}>
        {cardToggles.map(([key, label]) => (
          <label key={key} style={styles.switchRow}>
            <input
              type="checkbox"
              checked={layoutPrefs[key] !== false}
              onChange={(event) => {
                setLayoutPrefs((current) => ({ ...current, [key]: event.target.checked }));
                notify?.("Dashboard layout updated.", "success");
              }}
            />
            {label}
          </label>
        ))}
      </div>
      <div style={{ ...styles.warningStack, marginTop: "16px" }}>
        {cardOrder.map((key, index) => {
          const label = cardToggles.find(([value]) => value === key)?.[1] || key;
          return (
            <div
              draggable
              key={key}
              onDragStart={(event) => event.dataTransfer.setData("text/plain", key)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const dragged = event.dataTransfer.getData("text/plain");
                const from = cardOrder.indexOf(dragged);
                const to = cardOrder.indexOf(key);
                if (from < 0 || to < 0 || from === to) return;
                const nextOrder = [...cardOrder];
                nextOrder.splice(from, 1);
                nextOrder.splice(to, 0, dragged);
                setLayoutPrefs((current) => ({ ...current, cardOrder: nextOrder }));
                notify?.("Dashboard layout updated.", "success");
              }}
              style={styles.draggableCardRow}
            >
              <span>{index + 1}. {label}</span>
              <span style={styles.inlineActions}>
                <button type="button" onClick={() => moveCard(key, -1)} style={styles.miniButton}>Up</button>
                <button type="button" onClick={() => moveCard(key, 1)} style={styles.miniButton}>Down</button>
              </span>
            </div>
          );
        })}
      </div>
      <p style={{ ...styles.muted, marginTop: "12px" }}>Preferences save locally and sync to Supabase when signed in.</p>
    </section>
  );
}

function PageTitle({ title, subtitle }) {
  return (
    <section style={styles.pageTitle}>
      <p style={styles.breadcrumb}>Trade Pilot / {title}</p>
      <h2 style={styles.pageTitleText}>{title}</h2>
      <p style={styles.pageSubtitle}>{subtitle}</p>
    </section>
  );
}

function HomePage({ onJoinAlpha, onLaunch, signedIn }) {
  return (
    <main style={styles.homePage}>
      <PageTitle
        title={signedIn ? "Trade Pilot Home" : "Home"}
        subtitle={signedIn ? "Welcome back. Choose your workspace." : "Welcome to Trade Pilot Alpha"}
      />
      <section style={styles.homeHero}>
        <div>
          <p style={styles.cardLabel}>Trade Pilot Alpha</p>
          <h2 className="home-title" style={styles.homeTitle}>Plan trades. Manage risk. Avoid emotional entries.</h2>
          <p style={styles.homeSubtitle}>Trade Pilot is a trading execution assistant for futures traders.</p>
          <div style={styles.heroActions}>
            <button onClick={onLaunch} style={styles.primaryHeroButton}>Launch App</button>
            <button onClick={onJoinAlpha} style={styles.secondaryHeroButton}>Join Alpha</button>
          </div>
        </div>
      </section>

      <section className="home-feature-grid" style={styles.productCardGrid}>
        <FeatureCard title="Risk Guard" text="Stay aware of size, loss limits, and overtrading." />
        <FeatureCard title="Trade Coach" text="Get plain-language prompts before and during a trade." />
        <FeatureCard title="Prop Firm Rules" text="Track drawdown pressure and daily risk rules." />
        <FeatureCard title="Journal & Stats" text="Save notes and review your execution habits." />
      </section>
    </main>
  );
}

function FeatureCard({ title, text }) {
  return (
    <section style={styles.softFeatureCard}>
      <h3 style={styles.featureTitle}>{title}</h3>
      <p style={styles.muted}>{text}</p>
    </section>
  );
}

function OnboardingCard({ onDone }) {
  return (
    <section className="onboarding-card" style={styles.onboardingCard}>
      <div>
        <p style={styles.cardLabel}>First Login</p>
        <h2 style={styles.sectionTitle}>Set up your workspace</h2>
      </div>
      <div style={styles.onboardingSteps}>
        <span>1. Choose your market</span>
        <span>2. Set your risk</span>
        <span>3. Generate your trade plan</span>
      </div>
      <button onClick={onDone} style={styles.settingsButton}>Got it</button>
    </section>
  );
}

function InstallBanner({ canInstall, onDismiss, onInstall, onInstructions }) {
  return (
    <section className="install-banner" style={styles.installBanner}>
      <div>
        <strong>Install Trade Pilot</strong>
        <p style={styles.installBannerText}>Add it to your home screen for a faster app-like experience.</p>
      </div>
      <div style={styles.installBannerActions}>
        <button onClick={canInstall ? onInstall : onInstructions} style={styles.installButton}>
          {canInstall ? "Install Trade Pilot" : "How to Install"}
        </button>
        <button onClick={onDismiss} style={styles.dismissButton}>Not now</button>
      </div>
    </section>
  );
}

function InstallPage({ canInstall, onInstall }) {
  return (
    <main style={styles.installPage}>
      <section style={styles.installHero}>
        <div style={styles.installIconWrap}>
          <img src="/icons/icon-192.png" alt="Trade Pilot app icon" style={styles.installIcon} />
        </div>
        <div>
          <p style={styles.cardLabel}>Install App</p>
          <h2 style={styles.tradePlanTitle}>Install Trade Pilot</h2>
          <p style={styles.muted}>Plan trades. Manage risk. Avoid emotional entries from your phone or desktop.</p>
          <button onClick={onInstall} style={styles.generateButton}>
            {canInstall ? "Install Trade Pilot" : "Show Install Instructions"}
          </button>
        </div>
      </section>

      <section style={styles.mainGrid}>
        <div style={styles.card}>
          <p style={styles.cardLabel}>iPhone / iPad</p>
          <h2 style={styles.sectionTitle}>Add to Home Screen</h2>
          <PlanItem title="1. Open in Safari" text="Visit tradepilottool.com in Safari." />
          <PlanItem title="2. Tap Share" text="Use the Share button at the bottom of Safari." />
          <PlanItem title="3. Add to Home Screen" text="Choose Add to Home Screen, then tap Add." />
        </div>

        <div style={styles.card}>
          <p style={styles.cardLabel}>Android</p>
          <h2 style={styles.sectionTitle}>Install from Chrome</h2>
          <PlanItem title="1. Open in Chrome" text="Visit tradepilottool.com in Chrome." />
          <PlanItem title="2. Tap Install" text="Use the browser install prompt or menu." />
          <PlanItem title="3. Launch like an app" text="Trade Pilot will appear on your home screen." />
        </div>

        <div style={styles.card}>
          <p style={styles.cardLabel}>Desktop</p>
          <h2 style={styles.sectionTitle}>Install from Browser</h2>
          <PlanItem title="Chrome / Edge" text="Click the install icon in the address bar." />
          <PlanItem title="Offline support" text="Core app files are cached after the first visit." />
        </div>
      </section>
    </main>
  );
}

function AccountPage({ authMessage, isConfigured, layoutPrefs, onAuthOpen, session, setLayoutPrefs, signOut, syncStatus }) {
  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Account" subtitle="Manage login and subscription." />
      </div>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Personal Dashboard</p>
        <h2 style={styles.sectionTitle}>{session?.user ? "Your Trade Pilot Workspace" : "Save Your Workspace"}</h2>
        <p style={styles.muted}>
          Use Trade Pilot without logging in, or create an account to save settings, layouts, trade plans, journal entries, watchlists, and coach preferences.
        </p>
        <div style={{ ...styles.metricGrid, marginTop: "16px" }}>
          <Metric label="Auth" value={isConfigured ? "Supabase Ready" : "Supabase Not Configured"} tone={isConfigured ? "good" : "warn"} />
          <Metric label="Session" value={session?.user ? "Signed In" : "Local Mode"} />
          <Metric label="Sync" value={syncStatus} />
        </div>
      </section>

      {session?.user ? (
        <section style={styles.card}>
          <p style={styles.cardLabel}>Account</p>
          <h2 style={styles.sectionTitle}>{session.user.email}</h2>
          <PlanItem title="Saved Data" text="Profile, trade settings, active plans, journal entries, watchlist, and layout preferences sync to Supabase." />
          <PlanItem title="Broker Privacy" text="Broker data is private to this user. Broker passwords and API secrets stay server-side." />
          <button onClick={signOut} style={{ ...styles.dismissButton, marginTop: "16px" }}>Sign Out</button>
          {authMessage ? <p style={{ ...styles.muted, marginTop: "12px" }}>{authMessage}</p> : null}
        </section>
      ) : (
        <section style={styles.card}>
          <p style={styles.cardLabel}>Account Access</p>
          <h2 style={styles.sectionTitle}>Start in Guest Mode, Save When Ready</h2>
          <p style={styles.muted}>
            Guest mode saves to this browser only. Create a free account to sync your Trade Pilot workspace, settings, plans, and journal through Supabase.
          </p>
          <div style={styles.inlineActions}>
            <button onClick={() => onAuthOpen("signup")} style={styles.settingsButton}>Sign Up</button>
            <button onClick={() => onAuthOpen("login")} style={styles.dismissButton}>Log In</button>
          </div>
          {authMessage ? <p style={{ ...styles.muted, marginTop: "12px" }}>{authMessage}</p> : null}
        </section>
      )}

      <section style={styles.card}>
        <p style={styles.cardLabel}>Free vs Pro Planning</p>
        <h2 style={styles.sectionTitle}>Pre-Release Access</h2>
        <PlanItem title="Free" text="Manual trade plan, saved profile, and basic journal." />
        <PlanItem title="Pro Later" text="Live broker data, advanced chart, AI trade coach, analytics, TradingView Alerts, and custom layouts." />
        <PlanItem title="Payments" text="Not enabled yet." />
      </section>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Security</p>
        <h2 style={styles.sectionTitle}>Release Checklist</h2>
        <PlanItem title="Email confirmation" text="Keep enabled in Supabase Auth settings." />
        <PlanItem title="Leaked password protection" text="Enable in Supabase Auth password security." />
        <PlanItem title="Auth redirect" text="Use https://tradepilottool.com for confirmation and reset links." />
      </section>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Layout Customization</p>
        <h2 style={styles.sectionTitle}>Show / Hide Dashboard Cards</h2>
        <p style={{ ...styles.muted, marginBottom: "14px" }}>Reordering is reserved for later; these visibility preferences save to your database when signed in.</p>
        <div style={styles.formGrid}>
          {Object.keys(defaultLayout).filter((key) => key !== "mode").map((key) => (
            <label key={key} style={styles.switchRow}>
              <input
                type="checkbox"
                checked={layoutPrefs[key]}
                onChange={(event) => setLayoutPrefs((current) => ({ ...current, [key]: event.target.checked }))}
              />
              {key}
            </label>
          ))}
        </div>
      </section>
    </main>
  );
}

function AuthModal({ authMessage, initialMode, isConfigured, onClose, onSignedIn, setAuthMessage, setProfile }) {
  const [mode, setMode] = useState(initialMode || "login");
  const [form, setForm] = useState({
    accountType: "Personal Trading Account",
    confirmPassword: "",
    email: "",
    name: "",
    password: "",
    preferredMarket: "MNQ",
    rememberMe: true,
    traderType: "intermediate",
  });
  const [message, setMessage] = useState(authMessage || "");

  const submit = async (event) => {
    event.preventDefault();
    if (!isConfigured || !supabase) {
      setMessage("Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable accounts.");
      return;
    }

    try {
      if (mode === "signup") {
        if (form.password !== form.confirmPassword) {
          setMessage("Passwords do not match.");
          return;
        }

        const { error } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: {
            emailRedirectTo: authRedirectUrl,
            data: {
              accountType: form.accountType,
              name: form.name,
              preferredMarket: form.preferredMarket,
              traderType: form.traderType,
            },
          },
        });
        if (error) throw error;
        const savedMarket = form.preferredMarket === "crypto" ? "BTC" : form.preferredMarket === "options" ? "SPY" : form.preferredMarket;
        setProfile((current) => ({
          ...current,
          accountType: form.accountType,
          mainMarket: savedMarket,
          traderExperienceLevel: form.traderType,
          traderName: form.name,
        }));
        setMessage("Check your email to verify your Trade Pilot account.");
        setAuthMessage("Check your email to verify your Trade Pilot account.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(form.email, { redirectTo: authRedirectUrl });
        if (error) throw error;
        setMessage("Password reset email sent.");
        setAuthMessage("Password reset email sent.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
        if (error) throw error;
        localStorage.setItem("tradePilotRememberLogin", String(form.rememberMe));
        setAuthMessage("Signed in. Loading your dashboard.");
        onSignedIn();
      }
    } catch (error) {
      setMessage(error.message || "Authentication failed.");
    }
  };

  return (
    <div style={{ ...styles.modalBackdrop, zIndex: 45 }}>
      <section style={styles.modal}>
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.cardLabel}>Account Access</p>
            <h2 style={styles.sectionTitle}>{mode === "signup" ? "Create Account" : mode === "reset" ? "Reset Password" : "Log In"}</h2>
          </div>
          <button onClick={onClose} style={styles.dismissButton}>Close</button>
        </div>
        <p style={styles.muted}>
          Supabase keeps each trader's workspace private. Broker credentials stay out of the frontend.
        </p>
      <div style={styles.segmentGroup}>
        <button onClick={() => setMode("login")} style={{ ...styles.segmentButton, background: mode === "login" ? "#2563eb" : "#27272a" }}>Login</button>
        <button onClick={() => setMode("signup")} style={{ ...styles.segmentButton, background: mode === "signup" ? "#2563eb" : "#27272a" }}>Signup</button>
        <button onClick={() => setMode("reset")} style={{ ...styles.segmentButton, background: mode === "reset" ? "#2563eb" : "#27272a" }}>Reset</button>
      </div>
      <form onSubmit={submit} style={styles.formGrid}>
        {mode === "signup" ? <Field label="Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} /> : null}
        <Field label="Email" type="email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
        {mode !== "reset" ? <Field label="Password" type="password" value={form.password} onChange={(value) => setForm((current) => ({ ...current, password: value }))} /> : null}
        {mode === "signup" ? <Field label="Confirm Password" type="password" value={form.confirmPassword} onChange={(value) => setForm((current) => ({ ...current, confirmPassword: value }))} /> : null}
        {mode === "signup" ? <SelectField label="Trader Type" value={form.traderType} options={["beginner", "intermediate", "advanced"]} onChange={(value) => setForm((current) => ({ ...current, traderType: value }))} /> : null}
        {mode === "signup" ? <SelectField label="Preferred Market" value={form.preferredMarket} options={["MNQ", "NQ", "ES", "MES", "crypto", "options"]} onChange={(value) => setForm((current) => ({ ...current, preferredMarket: value }))} /> : null}
        {mode === "signup" ? <SelectField label="Account Type" value={form.accountType} options={accountTypeOptions} onChange={(value) => setForm((current) => ({ ...current, accountType: value }))} /> : null}
        {mode === "login" ? (
          <label style={styles.switchRow}>
            <input
              type="checkbox"
              checked={form.rememberMe}
              onChange={(event) => setForm((current) => ({ ...current, rememberMe: event.target.checked }))}
            />
            Remember me
          </label>
        ) : null}
        <button style={styles.settingsButton}>{mode === "signup" ? "Create Account" : mode === "reset" ? "Send Reset Email" : "Log In"}</button>
      </form>
      {mode === "login" ? (
        <button onClick={() => setMode("reset")} style={{ ...styles.textButton, marginTop: "12px" }}>Forgot password?</button>
      ) : null}
      {message ? <p style={{ ...styles.muted, marginTop: "12px" }}>{message}</p> : null}
      </section>
    </div>
  );
}

function getEffectiveLayout(layoutPrefs = {}) {
  const mode = layoutPrefs.mode || "Pro";
  const preset = layoutModePresets[mode] || layoutModePresets.Pro;
  return { ...defaultLayout, ...preset, ...layoutPrefs, cardOrder: normalizeCardOrder(layoutPrefs.cardOrder || preset.cardOrder) };
}

function normalizeCardOrder(order = []) {
  const known = dashboardCardOptions.map(([key]) => key);
  const clean = safeArray(order).map(normalizeCardKey).filter((key) => known.includes(key));
  return [...clean, ...known.filter((key) => !clean.includes(key))];
}

function Dashboard({
  activePosition,
  addJournalEntry,
  applyQuickSetup,
  autoPrice,
  brokerConnection,
  contracts,
  dataSource,
  direction,
  discipline,
  engine,
  entry,
  fastMessage,
  journalEntries,
  layoutPrefs,
  lastUpdated,
  notify,
  price,
  priceStatus,
  plannedTrade,
  profile,
  quote,
  breakoutLevel,
  levelBias,
  pullbackSupport,
  recentHigh,
  resistance,
  riskPoints,
  runFastAction,
  setAutoPrice,
  setContracts,
  setDataSource,
  setDirection,
  setEntry,
  setPrice,
  setBreakoutLevel,
  setLevelBias,
  setLayoutPrefs,
  setPullbackSupport,
  setRecentHigh,
  setResistance,
  setRiskPoints,
  setSupport,
  streamerMode,
  support,
  updateDiscipline,
  updateProfile,
  watchlist,
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [journalNote, setJournalNote] = useState("");
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [setupDirection, setSetupDirection] = useState("Long");
  const [setupType, setSetupType] = useState("Pullback");
  const safeJournalEntries = safeArray(journalEntries);
  const safeWatchlist = normalizeWatchlistItems(watchlist, profile.mainMarket);
  const effectiveLayout = getEffectiveLayout(layoutPrefs);
  const rangePad = Math.max(20, price * 0.01);
  const rangeMin = Math.max(0, price - rangePad);
  const rangeMax = price + rangePad;
  const levelCoach = analyzeKeyLevels({
    breakoutLevel,
    currentPrice: price,
    direction,
    marketBias: levelBias,
    pullbackSupport,
    recentHigh,
    resistance,
    support,
  });
  const chartData = useMemo(
    () => buildChartData({ price, entry, stop: engine.smartStop, support, resistance, trim1: engine.trim1, trim2: engine.trim2, runner: engine.runner }),
    [engine.runner, engine.smartStop, engine.trim1, engine.trim2, entry, price, resistance, support],
  );
  const zoneDetection = useMemo(
    () => detectKeyLevelsFromCandles(chartDataToCandles(chartData), { entry, price, resistance, support }),
    [chartData, entry, price, resistance, support],
  );
  const marketSpec = marketSpecs[profile.mainMarket] ?? marketSpecs.MNQ;
  const autoTradePlan = getAutoTradePlan({
    accountSize: Number(profile.accountSize || 0),
    contracts,
    dailyPnl: discipline.dailyPnl,
    marketSpec,
    maxContracts: Number(profile.maxContracts || contracts),
    maxDailyLoss: Number(profile.maxDailyLoss || 0),
    maxRisk: Number(profile.maxRiskPerTrade || 0),
    price,
    resistance,
    support,
    zoneDetection,
  });
  const fallbackPlan = {
    contracts,
    direction,
    entry,
    runner: engine.runner,
    setupType: "Manual fallback",
    stop: engine.smartStop,
    target: engine.runner,
    trim1: engine.trim1,
    trim2: engine.trim2,
  };
  const visualPlan = normalizeTradePlan(plannedTrade ?? activePosition ?? (!autoTradePlan.noTrade ? autoTradePlan : fallbackPlan), fallbackPlan);
  const missedEntry = getMissedEntryMessage({ currentPrice: price, plan: visualPlan });
  const rewardRisk = calculateRewardRisk({ plan: visualPlan, pointValue: marketSpec.pointValue });
  const tradeGrade = getTradeGrade({
    contracts: visualPlan.contracts ?? contracts,
    dailyPnl: discipline.dailyPnl,
    entry: visualPlan.entry,
    maxContracts: profile.maxContracts,
    maxDailyLoss: profile.maxDailyLoss,
    price,
    rewardRisk,
    stop: visualPlan.stop,
    support,
    resistance,
    zoneDetection,
  });
  const fundedMetrics = getFundedAccountMetrics({ brokerConnection, discipline, profile });
  const fundedWarnings = buildFundedRuleWarnings({
    brokerConnection: {
      ...brokerConnection,
      position: brokerConnection.position || { contracts: visualPlan.contracts ?? contracts },
    },
    discipline,
    profile,
  });
  const simpleBias = engine.bias.includes("LONG") ? "LONG" : engine.bias.includes("SHORT") ? "SHORT" : "WAIT";
  const simpleAction = simpleBias === "LONG" ? "Look Long" : simpleBias === "SHORT" ? "Look Short" : "No trade";
  const setupName = plannedTrade || activePosition ? `${setupType} ${setupDirection}` : "Auto Zone";
  const hasPlan = Boolean(plannedTrade || activePosition || !autoTradePlan.noTrade);
  const liveCoach = getLiveCoachMessage({ activePosition, autoTradePlan, discipline, engine, price, profile, tradeGrade, visualPlan });
  const riskStatus = engine.disciplineWarnings.some((warning) => warning.includes("Stop") || warning.includes("loss limit reached") || warning.includes("exceeded"))
    ? "Stop Trading"
    : engine.disciplineWarnings.some((warning) => warning.includes("Warning") || warning.includes("approaching") || warning.includes("High risk") || warning.includes("too large") || warning.includes("Contracts"))
      ? "Warning"
      : "Good";

  const generateSelectedPlan = () => {
    if (setupType === "Retest" && setupDirection === "Long") applyQuickSetup("Breakout Long");
    else if (setupType === "Retest" && setupDirection === "Short") applyQuickSetup("Breakdown Short");
    else if (setupType === "Breakout" && setupDirection === "Short") applyQuickSetup("Breakdown Short");
    else applyQuickSetup(setupName);
  };

  const saveDashboardNote = (event) => {
    event.preventDefault();
    if (!journalNote.trim()) return;
    addJournalEntry(journalNote.trim());
    setJournalNote("");
  };

  const cardOrder = normalizeCardOrder(effectiveLayout.cardOrder);
  const dashboardCards = {
    alerts: effectiveLayout.alerts ? <AutoZonePanel zoneDetection={zoneDetection} /> : null,
    chart: effectiveLayout.chart ? <TradeChartPanel
      chartData={chartData}
      currentPrice={price}
      entry={visualPlan.entry}
      runner={visualPlan.runner ?? visualPlan.target}
      stop={visualPlan.stop}
      support={zoneDetection.supportLevel ?? support}
      resistance={zoneDetection.resistanceLevel ?? resistance}
      trim1={visualPlan.trim1}
      trim2={visualPlan.trim2}
      zoneDetection={zoneDetection}
    /> : null,
    coach: effectiveLayout.coach ? <div style={styles.coachCard}>
      <p style={styles.cardLabel}>Trade Coach</p>
      <div style={styles.coachGrid}>
        <Metric label="Bias" tooltip={tooltipText.marketBias} value={simpleBias} tone={simpleBias === "WAIT" ? "warn" : "good"} />
        <Metric label="Market" value={profile.mainMarket} />
        <Metric label="Action" value={levelCoach.action === "WAIT" ? simpleAction : levelCoach.action} tone={simpleBias === "WAIT" ? "warn" : "good"} />
        <Metric label="Grade" value={`${tradeGrade.letter} ${tradeGrade.score}/100`} tone={tradeGrade.score >= 75 ? "good" : tradeGrade.score >= 55 ? "warn" : "bad"} />
      </div>
      <p style={styles.coachMessage}>{levelCoach.message}</p>
      {autoTradePlan.noTrade ? <div style={styles.priceWarning}>{autoTradePlan.message}</div> : null}
      <p style={styles.muted}>{autoTradePlan.coachMessage || tradeGrade.reason}</p>
    </div> : null,
    journal: effectiveLayout.journal ? <section style={styles.card}>
      <p style={styles.cardLabel}>Journal</p>
      <h2 style={styles.sectionTitle}>Notes and Trade History</h2>
      <form onSubmit={saveDashboardNote}>
        <textarea
          style={styles.textArea}
          value={journalNote}
          onChange={(event) => setJournalNote(event.target.value)}
          placeholder="What did you see? What will you do next?"
        />
        <button style={styles.settingsButton}>Save Note</button>
      </form>
      <div style={{ ...styles.warningStack, marginTop: "14px" }}>
        {(safeJournalEntries.length ? safeJournalEntries.slice(0, 4) : [{ id: "empty", stamp: new Date().toISOString(), note: "No journal entries yet." }]).map((item) => (
          <PlanItem key={item.id || item.stamp} title={item.stamp ? new Date(item.stamp).toLocaleString() : "Journal"} text={item.note || "Saved trade note"} />
        ))}
      </div>
    </section> : null,
    performanceStats: effectiveLayout.performanceStats ? <PerformanceStatsCard discipline={discipline} journalEntries={safeJournalEntries} tradeGrade={tradeGrade} /> : null,
    propFirmRules: effectiveLayout.propFirmRules ? <PropFirmRulesCard fundedMetrics={fundedMetrics} fundedWarnings={fundedWarnings} profile={profile} /> : null,
    risk: effectiveLayout.risk ? <RiskGuardCard discipline={discipline} fundedMetrics={fundedMetrics} fundedWarnings={fundedWarnings} profile={profile} riskStatus={riskStatus} /> : null,
    tradePlan: effectiveLayout.tradePlan ? <TradePlanCard autoTradePlan={autoTradePlan} hasPlan={hasPlan} missedEntry={missedEntry} profile={profile} rewardRisk={rewardRisk} setupName={setupName} tradeGrade={tradeGrade} visualPlan={visualPlan} /> : null,
    watchlist: effectiveLayout.watchlist ? <WatchlistCard price={price} profile={profile} watchlist={safeWatchlist} /> : null,
  };

  if (streamerMode || effectiveLayout.mode === "Streamer") {
    return (
      <>
        <LivestreamDashboard
          activePosition={activePosition}
          brokerConnection={brokerConnection}
          discipline={discipline}
          engine={engine}
          price={price}
          profile={profile}
          riskStatus={riskStatus}
          visualPlan={visualPlan}
          coachMessage={liveCoach}
          tradeGrade={tradeGrade}
        />
        <TradeChartPanel
          chartData={chartData}
          currentPrice={price}
          entry={visualPlan.entry}
          runner={visualPlan.runner ?? visualPlan.target}
          stop={visualPlan.stop}
          support={zoneDetection.supportLevel ?? support}
          resistance={zoneDetection.resistanceLevel ?? resistance}
          trim1={visualPlan.trim1}
          trim2={visualPlan.trim2}
          zoneDetection={zoneDetection}
        />
      </>
    );
  }

  return (
    <>
      <PageTitle title="Dashboard" subtitle="Plan trades and manage risk." />
      <section className="mobile-status-bar" style={styles.mobileStatusBar}>
        <div>
          <span style={styles.cardLabel}>Market</span>
          <strong>{profile.mainMarket}</strong>
        </div>
        <div>
          <span style={styles.cardLabel}>Price</span>
          <strong>{fmt(price)}</strong>
        </div>
        <div>
          <span style={styles.cardLabel}>Status</span>
          <strong>{dataSource === "TradingView Webhook" ? "TradingView" : getConnectionStatusLabel(brokerConnection)}</strong>
        </div>
      </section>
      <section style={styles.dashboardToolbar}>
        <button onClick={() => setCustomizeOpen((open) => !open)} style={styles.settingsButton}>Customize Dashboard</button>
        <span style={styles.muted}>Layout: {layoutPrefs.mode || "Pro"}</span>
      </section>
      {customizeOpen ? (
        <CustomizeDashboardPanel layoutPrefs={layoutPrefs} notify={notify} setLayoutPrefs={setLayoutPrefs} />
      ) : null}
      <section
        className={`dashboard-card-board mode-${String(effectiveLayout.mode || "Pro").toLowerCase().replace(/\s+/g, "-")}`}
        style={styles.dashboardCardBoard}
      >
        {cardOrder.map((key) => dashboardCards[key] ? (
          <div
            className={`dashboard-card-slot card-${key}`}
            key={key}
            style={{ ...styles.dashboardCardSlot, gridColumn: key === "chart" || (effectiveLayout.mode === "Streamer" && key === "coach") ? "1 / -1" : undefined }}
          >
            {dashboardCards[key]}
          </div>
        ) : null)}
      </section>
      {false ? <>
      <section className="dashboard-grid" style={styles.dashboardGrid}>
        {effectiveLayout.coach ? <div style={styles.coachCard}>
          <p style={styles.cardLabel}>Trade Coach</p>
          <div style={styles.coachGrid}>
            <Metric label="Bias" tooltip={tooltipText.marketBias} value={simpleBias} tone={simpleBias === "WAIT" ? "warn" : "good"} />
            <Metric label="Market" value={profile.mainMarket} />
            <Metric label="Action" value={levelCoach.action === "WAIT" ? simpleAction : levelCoach.action} tone={simpleBias === "WAIT" ? "warn" : "good"} />
            <Metric label="Grade" value={`${tradeGrade.letter} ${tradeGrade.score}/100`} tone={tradeGrade.score >= 75 ? "good" : tradeGrade.score >= 55 ? "warn" : "bad"} />
          </div>
          <p style={styles.coachMessage}>{levelCoach.message}</p>
          {autoTradePlan.noTrade ? <div style={styles.priceWarning}>{autoTradePlan.message}</div> : null}
          <p style={styles.muted}>{autoTradePlan.coachMessage || tradeGrade.reason}</p>
        </div> : null}
        <ManualLiveWorkflow
          accountSize={profile.accountSize}
          contracts={contracts}
          dataSource={dataSource}
          dailyPnl={discipline.dailyPnl}
          entry={entry}
          market={profile.mainMarket}
          price={price}
          resistance={resistance}
          runner={engine.runner}
          setAutoPrice={setAutoPrice}
          setContracts={setContracts}
          setDataSource={setDataSource}
          setEntry={setEntry}
          setPrice={setPrice}
          setResistance={setResistance}
          setRiskPoints={setRiskPoints}
          setSupport={setSupport}
          stop={engine.smartStop}
          support={support}
          trim1={engine.trim1}
          trim2={engine.trim2}
          updateDiscipline={updateDiscipline}
          updateProfile={updateProfile}
        />
      </section>

      <section style={styles.alphaMiddleGrid}>
        {effectiveLayout.tradePlan ? <section style={styles.tradePlanHero}>
          <p style={styles.cardLabel}>Trade Plan</p>
          <h2 style={styles.tradePlanTitle}>{hasPlan ? `${setupName} Plan` : "No valid trade yet"}</h2>
          {hasPlan ? (
            <>
              <div style={styles.planMetricGrid}>
                <Metric label="Entry" tooltip={tooltipText.entry} value={visualPlan.entry.toFixed(2)} />
                <Metric label="Stop" tooltip={tooltipText.stopLoss} value={visualPlan.stop.toFixed(2)} tone="bad" />
                <Metric label="Trim 1" tooltip={tooltipText.trim1} value={visualPlan.trim1.toFixed(2)} tone="good" />
                <Metric label="Trim 2" tooltip={tooltipText.trim2} value={visualPlan.trim2.toFixed(2)} tone="good" />
                <Metric label="Runner" tooltip={tooltipText.runner} value={(visualPlan.runner ?? visualPlan.target).toFixed(2)} tone="good" />
                <Metric label="Risk" value={`$${rewardRisk.risk.toFixed(2)}`} tone={rewardRisk.risk > profile.maxRiskPerTrade ? "bad" : "neutral"} />
                <Metric label="Reward/Risk" value={`${rewardRisk.ratio.toFixed(1)}R`} />
                <Metric label="Trade Grade" tooltip={tooltipText.tradeScore} value={`${tradeGrade.letter} ${tradeGrade.score}/100`} />
              </div>
              {!autoTradePlan.noTrade ? (
                <div style={{ ...styles.coachPrompt, marginTop: "14px" }}>
                  Auto plan: {autoTradePlan.direction.toUpperCase()} entry {autoTradePlan.entry.toFixed(2)}, stop {autoTradePlan.stop.toFixed(2)}, trims {autoTradePlan.trim1.toFixed(2)} / {autoTradePlan.trim2.toFixed(2)}, runner {autoTradePlan.runner.toFixed(2)}. Risk ${autoTradePlan.riskDollars.toFixed(2)}. R/R {autoTradePlan.rewardRisk.toFixed(1)}. Score {autoTradePlan.score}/100. {autoTradePlan.reason}
                </div>
              ) : null}
              {missedEntry ? <div style={styles.missedEntry}>{missedEntry}</div> : null}
            </>
          ) : (
            <p style={styles.emptyPlan}>No valid trade yet. Wait for price to reach support, resistance, breakout, or retest.</p>
          )}
        </section> : null}

        <section style={styles.quickEntryCard}>
          <p style={styles.cardLabel}>Quick Entry</p>
          <h2 style={styles.sectionTitle}>Generate a plan</h2>
          <div style={styles.segmentGroup}>
            {["Long", "Short"].map((option) => (
              <button key={option} onClick={() => setSetupDirection(option)} style={{ ...styles.segmentButton, background: setupDirection === option ? "#2563eb" : "#111827" }}>{option} Setup</button>
            ))}
          </div>
          <div style={styles.segmentGroup}>
            {["Breakout", "Pullback", "Retest"].map((option) => (
              <button key={option} onClick={() => setSetupType(option)} style={{ ...styles.segmentButton, background: setupType === option ? "#334155" : "#111827" }}>{option}</button>
            ))}
          </div>
          <button onClick={generateSelectedPlan} style={styles.generateButton}>Generate Trade Plan</button>
          <p style={styles.muted}>Trading execution assistant. Not a signal service.</p>
        </section>
      </section>

      {effectiveLayout.chart ? <TradeChartPanel
        chartData={chartData}
        currentPrice={price}
        entry={visualPlan.entry}
        runner={visualPlan.runner ?? visualPlan.target}
        stop={visualPlan.stop}
        support={zoneDetection.supportLevel ?? support}
        resistance={zoneDetection.resistanceLevel ?? resistance}
        trim1={visualPlan.trim1}
        trim2={visualPlan.trim2}
        zoneDetection={zoneDetection}
      /> : null}

      <section style={styles.alphaMiddleGrid}>
        {effectiveLayout.risk ? <section style={styles.rulesCard}>
          <div>
            <p style={styles.cardLabel}>Risk Control</p>
            <h2 style={styles.sectionTitle}>Stay inside your limits</h2>
          </div>
          <div style={styles.rulesGrid}>
            <Metric label="Max Trades" value={String(profile.maxTradesPerDay)} />
            <Metric label="Max Daily Loss" value={`$${profile.maxDailyLoss.toFixed(2)}`} />
            <Metric label="Current P/L" value={`$${discipline.dailyPnl.toFixed(2)}`} tone={discipline.dailyPnl >= 0 ? "good" : "bad"} />
            <Metric label="Risk Status" value={riskStatus} tone={riskStatus === "Good" ? "good" : riskStatus === "Warning" ? "warn" : "bad"} />
            <Metric label="Daily Risk Left" value={`$${fundedMetrics.dailyRiskRemaining.toFixed(2)}`} tone={fundedMetrics.dailyRiskRemaining > 100 ? "good" : "warn"} />
            <Metric label="Drawdown Left" value={`$${fundedMetrics.drawdownRemaining.toFixed(2)}`} tone={fundedMetrics.drawdownRemaining > 500 ? "good" : "warn"} />
          </div>
          <div style={styles.warningStack}>
            {(fundedWarnings.length ? fundedWarnings : ["Inside funded-account guardrails."]).map((warning) => (
              <div key={warning} style={warning.includes("Inside") ? styles.coachPrompt : styles.warningBox}>{warning}</div>
            ))}
          </div>
        </section> : null}

        {effectiveLayout.journal ? <section style={styles.card}>
          <p style={styles.cardLabel}>Journal</p>
          <h2 style={styles.sectionTitle}>Quick note</h2>
          <form onSubmit={saveDashboardNote}>
            <textarea
              style={styles.textArea}
              value={journalNote}
              onChange={(event) => setJournalNote(event.target.value)}
              placeholder="What did you see? What will you do next?"
            />
            <button style={styles.settingsButton}>Save Note</button>
          </form>
          {journalEntries?.[0] ? (
            <p style={{ ...styles.muted, marginTop: "12px" }}>Last note: {journalEntries[0].note}</p>
          ) : null}
        </section> : null}
      </section>

      <section style={styles.alphaMiddleGrid}>
        {effectiveLayout.alerts ? <AutoZonePanel zoneDetection={zoneDetection} /> : null}
        {effectiveLayout.propFirmRules ? <FundedManualPanel profile={profile} updateProfile={updateProfile} /> : null}
      </section>
      </> : null}

      <button onClick={() => setAdvancedOpen((value) => !value)} style={styles.advancedToggle}>
        Advanced Tools {advancedOpen ? "Hide" : "Show"}
      </button>

      <div style={{ display: advancedOpen ? "block" : "none" }}>

      <section style={styles.marketTopBar}>
        <SelectField label="Market" value={profile.mainMarket} options={markets} onChange={(value) => updateProfile("mainMarket", value)} />
        <div style={styles.marketTopMetric}>
          <span>{marketSpec.displayName}</span>
          <strong>${marketSpec.pointValue}/point</strong>
        </div>
        <div style={styles.marketTopMetric}>
          <span>Tick Size</span>
          <strong>{marketSpec.tickSize}</strong>
        </div>
      </section>

      <ProductUpgradePanel
        brokerConnection={brokerConnection}
        discipline={discipline}
        journalEntries={journalEntries}
        profile={profile}
      />

      <section style={styles.heroGrid}>
        <div style={styles.biasCard}>
          <p style={styles.cardLabel}>
            <span style={styles.labelWithHelp}>
              Market Bias
              <HelpTip text={tooltipText.marketBias} />
            </span>
          </p>
          <div style={{ ...styles.biasText, color: engine.biasColor }}>{engine.bias}</div>
          <p style={styles.muted}>{engine.biasMessage}</p>
          <div style={styles.marketSpecLine}>
            {marketSpec.displayName} · ${marketSpec.pointValue}/point · tick {marketSpec.tickSize}
          </div>
        </div>

        <div style={styles.scoreCard}>
          <div style={styles.scoreTop}>
            <div>
              <p style={styles.cardLabel}>
                <span style={styles.labelWithHelp}>
                  Trade Score
                  <HelpTip text={tooltipText.tradeScore} />
                </span>
              </p>
              <h2 style={styles.scoreText}>{engine.score}/100</h2>
            </div>
            <div style={{ ...styles.confidencePill, background: engine.confidenceColor }}>{engine.confidence}</div>
          </div>
          <div style={styles.scoreTrack}>
            <div style={{ ...styles.scoreFill, width: `${engine.score}%`, background: engine.confidenceColor }} />
          </div>
        </div>

        <div style={styles.coachCard}>
          <p style={styles.cardLabel}>AI Coach</p>
          <p style={styles.coachMessage}>{engine.coachMessage}</p>
          <p style={styles.muted}>{engine.stopReason}</p>
        </div>
      </section>

      <section style={styles.quickEntryCard}>
        <div>
          <p style={styles.cardLabel}>Fast Entry</p>
          <h2 style={styles.sectionTitle}>Quick Setup Buttons</h2>
          <p style={styles.muted}>Auto-fill entry, stop, trims, and runner from current support/resistance.</p>
        </div>
        <div style={styles.quickGrid}>
          <button onClick={() => applyQuickSetup("Breakout Long")} style={{ ...styles.quickButton, background: "#166534" }}>Breakout Long</button>
          <button onClick={() => applyQuickSetup("Pullback Long")} style={{ ...styles.quickButton, background: "#15803d" }}>Pullback Long</button>
          <button onClick={() => applyQuickSetup("Breakdown Short")} style={{ ...styles.quickButton, background: "#991b1b" }}>Breakdown Short</button>
          <button onClick={() => applyQuickSetup("Pullback Short")} style={{ ...styles.quickButton, background: "#b91c1c" }}>Pullback Short</button>
        </div>
      </section>

      {missedEntry ? <div style={styles.missedEntry}>{missedEntry}</div> : null}

      <KeyLevelCoach
        breakoutLevel={breakoutLevel}
        coach={levelCoach}
        currentPrice={price}
        marketBias={levelBias}
        pullbackSupport={pullbackSupport}
        recentHigh={recentHigh}
        rangeMax={rangeMax}
        rangeMin={rangeMin}
        setBreakoutLevel={setBreakoutLevel}
        setMarketBias={setLevelBias}
        setPullbackSupport={setPullbackSupport}
        setRecentHigh={setRecentHigh}
      />

      <section style={styles.visualGrid}>
        <TradeLadder currentPrice={price} plan={visualPlan} />
        <RiskRewardPanel
          contracts={visualPlan.contracts ?? contracts}
          market={profile.mainMarket}
          pointValue={marketSpec.pointValue}
          plan={visualPlan}
          rewardRisk={rewardRisk}
          setupName={setupName}
        />
        <ShareSetupPanel
          contracts={visualPlan.contracts ?? contracts}
          engine={engine}
          market={profile.mainMarket}
          plan={visualPlan}
          rewardRisk={rewardRisk}
        />
      </section>

      <section style={styles.mainGrid}>
        <section style={styles.card}>
          <p style={styles.cardLabel}>Risk Control</p>
          <h2 style={styles.sectionTitle}>Position Size Protection</h2>
          <div style={styles.metricGrid}>
            <Metric label="Dollar / Point" value={`$${engine.dollarPerPoint.toFixed(2)}`} />
            <Metric label="Risk per 10 Points" value={`$${engine.riskPerTenPoints.toFixed(2)}`} />
            <Metric label="Estimated Max Loss" value={`$${engine.estimatedMaxLoss.toFixed(2)}`} tone={engine.estimatedMaxLoss > profile.maxRiskPerTrade ? "bad" : "neutral"} />
            <Metric label="Max Risk / Trade" value={`$${profile.maxRiskPerTrade.toFixed(2)}`} />
          </div>
          <div style={styles.warningStack}>
            {engine.disciplineWarnings
              .filter((warning) => warning.includes("Position size") || warning.includes("High risk") || warning.includes("Contracts"))
              .map((warning) => <div key={warning} style={styles.warningBox}>{warning}</div>)}
          </div>
        </section>

        <section style={styles.card}>
          <p style={styles.cardLabel}>Journal</p>
          <h2 style={styles.sectionTitle}>Session Notes</h2>
          <p style={styles.muted}>Trades taken: {discipline.tradesTaken}. Daily P/L: ${discipline.dailyPnl.toFixed(2)}. Current action: {engine.suggestedAction}.</p>
        </section>
      </section>

      <section style={styles.fastCard}>
        <div>
          <p style={styles.cardLabel}>Fast Mode</p>
          <h2 style={styles.sectionTitle}>Manual Execution Buttons</h2>
          <p style={styles.muted}>{fastMessage}</p>
        </div>
        <div style={styles.fastGrid}>
          <button onClick={() => runFastAction("long")} style={{ ...styles.fastButton, background: "#16a34a" }}>Long</button>
          <button onClick={() => runFastAction("short")} style={{ ...styles.fastButton, background: "#dc2626" }}>Short</button>
          <button onClick={() => runFastAction("trim1")} style={styles.fastButton}>Trim 1 Hit</button>
          <button onClick={() => runFastAction("trim2")} style={styles.fastButton}>Trim 2 Hit</button>
          <button onClick={() => runFastAction("moveStop")} style={styles.fastButton}>Move Stop</button>
          <button onClick={() => runFastAction("exit")} style={{ ...styles.fastButton, background: "#7f1d1d" }}>Exit Trade</button>
        </div>
      </section>

      <main style={styles.mainGrid}>
        <section style={styles.card}>
          <div style={styles.sectionHeader}>
            <div>
              <p style={styles.cardLabel}>Trade Setup</p>
              <h2 style={styles.sectionTitle}>Decision Inputs</h2>
            </div>
            <div style={styles.directionToggle}>
              <button onClick={() => setDirection("long")} style={{ ...styles.toggleButton, background: direction === "long" ? "#16a34a" : "#27272a" }}>
                Long
              </button>
              <button onClick={() => setDirection("short")} style={{ ...styles.toggleButton, background: direction === "short" ? "#dc2626" : "#27272a" }}>
                Short
              </button>
            </div>
          </div>

          <div style={styles.marketPanel}>
            <SelectField label="Market" value={profile.mainMarket} options={markets} onChange={(value) => updateProfile("mainMarket", value)} />
            <SelectField label="Data Source" value={dataSource} options={dataSources} onChange={setDataSource} />
            <label style={styles.switchRow}>
              <input
                type="checkbox"
                checked={autoPrice}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setAutoPrice(checked);
                  if (checked && dataSource === "Manual Mode") setDataSource("Market Data API");
                }}
              />
              Auto Price: {autoPrice ? "ON" : "OFF"}
            </label>
          </div>

          <div style={styles.priceTape}>
            <Metric label={profile.mainMarket} value={price.toFixed(2)} />
            <Metric label="Bid" value={quote.bid.toFixed(2)} />
            <Metric label="Ask" value={quote.ask.toFixed(2)} />
            <Metric label="Updated" value={lastUpdated} />
          </div>

          <div style={styles.dataStatus}>
            <span>Source: {autoPrice ? dataSource : "Manual Mode"}</span>
            <span>Last updated: {lastUpdated}</span>
          </div>
          {priceStatus ? <div style={styles.priceWarning}>{priceStatus}</div> : null}
          {dataSource === "Broker Connection" || dataSource.includes("Tradovate") ? (
            <div style={styles.brokerStatusCard}>
              <span style={{ ...styles.statusPill, background: brokerConnection.connected ? "#166534" : "#3f3f46" }}>
                {brokerConnection.connectionStatus || (brokerConnection.connected ? "Connected" : "Waiting")}
              </span>
              <span>{brokerConnection.platform}</span>
              {!streamerMode ? <span>{brokerConnection.accountId || "No account linked"}</span> : null}
              {!streamerMode ? <span>{brokerConnection.accountType || "Read-only"}</span> : null}
              {!streamerMode ? <span>Balance: ${Number(brokerConnection.accountBalance || 0).toFixed(2)}</span> : null}
              <span>Open P/L: ${Number(brokerConnection.openPnl || 0).toFixed(2)}</span>
              <span>Daily P/L: ${Number(brokerConnection.dailyPnl ?? discipline.dailyPnl ?? 0).toFixed(2)}</span>
              <span>Realized P/L: ${Number(brokerConnection.realizedPnl || 0).toFixed(2)}</span>
            </div>
          ) : null}

          <Control label="Current Price" tooltip={tooltipText.currentPrice} value={price} setValue={setPrice} min={rangeMin} max={rangeMax} disabled={autoPrice} />
          <Control label="Support" tooltip={tooltipText.support} value={support} setValue={setSupport} min={rangeMin} max={rangeMax} />
          <Control label="Resistance" tooltip={tooltipText.resistance} value={resistance} setValue={setResistance} min={rangeMin} max={rangeMax} />
          <Control label="Entry" tooltip={tooltipText.entry} value={entry} setValue={setEntry} min={rangeMin} max={rangeMax} />
          <Control label="Risk Points" tooltip={tooltipText.riskPoints} value={riskPoints} setValue={setRiskPoints} min={1} max={Math.max(10, rangePad / 4)} />
          <Control label="Contracts" tooltip={tooltipText.contracts} value={contracts} setValue={setContracts} min={1} max={20} step={1} />
        </section>

        <section style={styles.card}>
          <p style={styles.cardLabel}>Active Position Detection</p>
          <h2 style={styles.sectionTitle}>{activePosition ? "Position Detected" : "No Active Position"}</h2>
          {brokerConnection.connected ? (
            <p style={{ ...styles.muted, marginBottom: "14px" }}>
              Broker bridge: {brokerConnection.platform}. Recent fills: {brokerConnection.fills?.length ?? 0}.
            </p>
          ) : null}
          <div style={styles.metricGrid}>
            <Metric label="Direction" value={activePosition ? activePosition.direction.toUpperCase() : direction.toUpperCase()} />
            <Metric label="Entry" value={(activePosition?.entry ?? entry).toFixed(2)} />
            <Metric label="Contracts" value={String(activePosition?.contracts ?? contracts)} />
            <Metric label="Stop" value={(activePosition?.stop ?? engine.smartStop).toFixed(2)} />
            <Metric label="Target" value={(activePosition?.target ?? engine.runner).toFixed(2)} />
            <Metric label="Status" value={activePosition?.status ?? "watching"} />
          </div>
        </section>

        <section style={styles.card}>
          <p style={styles.cardLabel}>Position Manager</p>
          <h2 style={styles.sectionTitle}>Trade Management</h2>
          <div style={styles.metricGrid}>
            <Metric label="Entry" value={entry.toFixed(2)} />
            <Metric label="Recommended Stop" tooltip={tooltipText.recommendedStop} value={engine.smartStop.toFixed(2)} />
            <Metric label="Trim 1" tooltip={tooltipText.trim1} value={engine.trim1.toFixed(2)} />
            <Metric label="Trim 2" tooltip={tooltipText.trim2} value={engine.trim2.toFixed(2)} />
            <Metric label="Runner" tooltip={tooltipText.runner} value={engine.runner.toFixed(2)} />
            <Metric label="Open P/L" value={`$${engine.openPnl.toFixed(2)}`} tone={engine.openPnl >= 0 ? "good" : "bad"} />
            <Metric label="Risk Left" value={`$${engine.riskLeft.toFixed(2)}`} />
            <Metric label="Action" value={engine.suggestedAction} tone={engine.actionTone} />
          </div>
        </section>

        <section style={styles.card}>
          <p style={styles.cardLabel}>Discipline Protection</p>
          <h2 style={styles.sectionTitle}>Daily Guardrails</h2>
          <div style={styles.formGrid}>
            <Field label="Trades Taken Today" type="number" value={discipline.tradesTaken} onChange={(value) => updateDiscipline("tradesTaken", value)} />
            <Field label="Current Daily P/L" type="number" value={discipline.dailyPnl} onChange={(value) => updateDiscipline("dailyPnl", value)} />
          </div>
          <div style={styles.warningStack}>
            {engine.disciplineWarnings.map((warning) => (
              <div key={warning} style={styles.warningBox}>{warning}</div>
            ))}
          </div>
        </section>

        <section style={styles.card}>
          <p style={styles.cardLabel}>Auto-Coaching</p>
          <h2 style={styles.sectionTitle}>Execution Prompts</h2>
          <div style={styles.warningStack}>
            {engine.autoCoaching.map((message) => (
              <div key={message} style={styles.coachPrompt}>{message}</div>
            ))}
          </div>
        </section>

        <section style={styles.card}>
          <p style={styles.cardLabel}>Risk Intelligence</p>
          <h2 style={styles.sectionTitle}>Score Factors</h2>
          <ScoreRow label="Location" value={engine.factors.location} />
          <ScoreRow label="Risk Points" value={engine.factors.risk} />
          <ScoreRow label="Reward/Risk" value={engine.factors.reward} />
          <ScoreRow label="Direction" value={engine.factors.direction} />
          <ScoreRow label="Entry Distance" value={engine.factors.distance} />
          <ScoreRow label="Contracts" value={engine.factors.contracts} />
        </section>
      </main>
      </div>
    </>
  );
}

function ManualLiveWorkflow({
  accountSize,
  contracts,
  dataSource,
  dailyPnl,
  entry,
  market,
  price,
  resistance,
  runner,
  setAutoPrice,
  setContracts,
  setDataSource,
  setEntry,
  setPrice,
  setResistance,
  setRiskPoints,
  setSupport,
  stop,
  support,
  trim1,
  trim2,
  updateDiscipline,
  updateProfile,
}) {
  const updateStop = (value) => setRiskPoints(Math.max(0.25, Math.abs(Number(entry) - Number(value))));
  const updateTargetPoints = (key, value) => updateProfile(key, Math.max(0.25, Math.abs(Number(value) - Number(entry))));

  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Non-API Live Workflow</p>
      <h2 style={styles.sectionTitle}>Manual / TradingView</h2>
      <div style={styles.sourceGrid}>
        {["Manual Mode", "TradingView Webhook", "CSV Import", "Tradovate Prop/Funded Read-Only"].map((option) => (
          <button
            key={option}
            onClick={() => {
              setDataSource(option);
              setAutoPrice(option === "TradingView Webhook");
            }}
            style={{ ...styles.sourceButton, borderColor: dataSource === option ? "#38bdf8" : "#334155" }}
            type="button"
          >
            <strong>{option === "TradingView Webhook" ? "Connect TradingView Alerts" : option}</strong>
            <span>{option.includes("Tradovate") ? "Connect from Connections" : option === "TradingView Webhook" ? "Receive TradingView alerts" : "Works now"}</span>
          </button>
        ))}
      </div>
      <div style={{ ...styles.formGrid, marginTop: "16px" }}>
        <SelectField label="Market" value={market} options={markets} onChange={(value) => updateProfile("mainMarket", value)} />
        <Field label="Current Price" type="number" value={price} onChange={setPrice} />
        <Field label="Support" type="number" value={support} onChange={setSupport} />
        <Field label="Resistance" type="number" value={resistance} onChange={setResistance} />
        <Field label="Entry" type="number" value={entry} onChange={setEntry} />
        <Field label="Stop" type="number" value={stop} onChange={updateStop} />
        <Field label="Trim 1" type="number" value={trim1} onChange={(value) => updateTargetPoints("trim1Points", value)} />
        <Field label="Trim 2" type="number" value={trim2} onChange={(value) => updateTargetPoints("trim2Points", value)} />
        <Field label="Runner" type="number" value={runner} onChange={(value) => updateTargetPoints("runnerPoints", value)} />
        <Field label="Contracts" type="number" value={contracts} onChange={setContracts} />
        <Field label="Account Size" type="number" value={accountSize} onChange={(value) => updateProfile("accountSize", value)} />
        <Field label="Daily P/L" type="number" value={dailyPnl} onChange={(value) => updateDiscipline("dailyPnl", value)} />
      </div>
      <p style={{ ...styles.muted, marginTop: "12px" }}>TradingView Alerts can post to /api/webhook/tradingview. Tradovate prop/live stays read-only and falls back to manual if API access is unavailable.</p>
    </section>
  );
}

function AutoZonePanel({ zoneDetection }) {
  const repeatedRejectionHighs = Array.isArray(zoneDetection?.repeatedRejectionHighs)
    ? zoneDetection.repeatedRejectionHighs
    : [];
  const repeatedRejectionLows = Array.isArray(zoneDetection?.repeatedRejectionLows)
    ? zoneDetection.repeatedRejectionLows
    : [];

  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Auto Zone Detector</p>
      <h2 style={styles.sectionTitle}>Support / Resistance</h2>
      <div style={styles.metricGrid}>
        <Metric label="Support Zone" value={zoneDetection.supportZone || "Manual"} tone="good" />
        <Metric label="Resistance Zone" value={zoneDetection.resistanceZone || "Manual"} tone="warn" />
        <Metric label="Middle Zone" value={zoneDetection.middleZone || "Wait"} />
        <Metric label="Session High" value={formatOptionalPrice(zoneDetection.sessionHigh)} />
        <Metric label="Session Low" value={formatOptionalPrice(zoneDetection.sessionLow)} />
        <Metric label="Open Range" value={zoneDetection.openRange || "Pending"} />
        <Metric label="Swing High" value={formatOptionalPrice(zoneDetection.recentHigh)} tone="warn" />
        <Metric label="Swing Low" value={formatOptionalPrice(zoneDetection.pullbackSupport)} tone="good" />
      </div>
      <div style={{ ...styles.coachPrompt, marginTop: "12px" }}>
        Rejection zones: highs {repeatedRejectionHighs.length ? repeatedRejectionHighs.join(", ") : "none yet"} · lows {repeatedRejectionLows.length ? repeatedRejectionLows.join(", ") : "none yet"}
      </div>
      <p style={{ ...styles.muted, marginTop: "12px" }}>{zoneDetection.message}</p>
    </section>
  );
}

function TradePlanCard({ autoTradePlan, hasPlan, missedEntry, profile, rewardRisk, setupName, tradeGrade, visualPlan }) {
  return (
    <section style={styles.tradePlanHero}>
      <p style={styles.cardLabel}>Trade Plan</p>
      <h2 style={styles.tradePlanTitle}>{hasPlan ? `${setupName} Plan` : "No valid trade yet"}</h2>
      {hasPlan ? (
        <>
          <div style={styles.planMetricGrid}>
            <Metric label="Entry" tooltip={tooltipText.entry} value={visualPlan.entry.toFixed(2)} />
            <Metric label="Stop" tooltip={tooltipText.stopLoss} value={visualPlan.stop.toFixed(2)} tone="bad" />
            <Metric label="Trim 1" tooltip={tooltipText.trim1} value={visualPlan.trim1.toFixed(2)} tone="good" />
            <Metric label="Trim 2" tooltip={tooltipText.trim2} value={visualPlan.trim2.toFixed(2)} tone="good" />
            <Metric label="Runner" tooltip={tooltipText.runner} value={(visualPlan.runner ?? visualPlan.target).toFixed(2)} tone="good" />
            <Metric label="Risk" value={`$${rewardRisk.risk.toFixed(2)}`} tone={rewardRisk.risk > profile.maxRiskPerTrade ? "bad" : "neutral"} />
            <Metric label="Reward/Risk" value={`${rewardRisk.ratio.toFixed(1)}R`} />
            <Metric label="Trade Grade" tooltip={tooltipText.tradeScore} value={`${tradeGrade.letter} ${tradeGrade.score}/100`} />
          </div>
          {!autoTradePlan.noTrade ? (
            <div style={{ ...styles.coachPrompt, marginTop: "14px" }}>
              Auto plan: {autoTradePlan.direction.toUpperCase()} entry {autoTradePlan.entry.toFixed(2)}, stop {autoTradePlan.stop.toFixed(2)}, trims {autoTradePlan.trim1.toFixed(2)} / {autoTradePlan.trim2.toFixed(2)}, runner {autoTradePlan.runner.toFixed(2)}. Risk ${autoTradePlan.riskDollars.toFixed(2)}. R/R {autoTradePlan.rewardRisk.toFixed(1)}. Score {autoTradePlan.score}/100. {autoTradePlan.reason}
            </div>
          ) : null}
          {rewardRisk.invalid ? <div style={styles.priceWarning}>{rewardRisk.reason || "Invalid plan: targets are on the wrong side of entry."}</div> : null}
          {missedEntry ? <div style={styles.missedEntry}>{missedEntry}</div> : null}
        </>
      ) : (
        <p style={styles.emptyPlan}>No valid trade yet. Wait for price to reach support, resistance, breakout, or retest.</p>
      )}
    </section>
  );
}

function RiskGuardCard({ discipline, fundedMetrics, fundedWarnings, profile, riskStatus }) {
  return (
    <section style={styles.rulesCard}>
      <div>
        <p style={styles.cardLabel}>Risk Guard</p>
        <h2 style={styles.sectionTitle}>Stay inside your limits</h2>
      </div>
      <div>
        <div style={styles.rulesGrid}>
          <Metric label="Max Trades" value={String(profile.maxTradesPerDay)} />
          <Metric label="Max Daily Loss" value={`$${profile.maxDailyLoss.toFixed(2)}`} />
          <Metric label="Current P/L" value={`$${discipline.dailyPnl.toFixed(2)}`} tone={discipline.dailyPnl >= 0 ? "good" : "bad"} />
          <Metric label="Risk Status" value={riskStatus} tone={riskStatus === "Good" ? "good" : riskStatus === "Warning" ? "warn" : "bad"} />
          <Metric label="Daily Risk Left" value={`$${fundedMetrics.dailyRiskRemaining.toFixed(2)}`} tone={fundedMetrics.dailyRiskRemaining > 100 ? "good" : "warn"} />
          <Metric label="Drawdown Left" value={`$${fundedMetrics.drawdownRemaining.toFixed(2)}`} tone={fundedMetrics.drawdownRemaining > 500 ? "good" : "warn"} />
        </div>
        <div style={{ ...styles.warningStack, marginTop: "14px" }}>
          {(fundedWarnings.length ? fundedWarnings : ["Inside funded-account guardrails."]).map((warning) => (
            <div key={warning} style={warning.includes("Inside") ? styles.coachPrompt : styles.warningBox}>{warning}</div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PropFirmRulesCard({ fundedMetrics, fundedWarnings, profile }) {
  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Prop Firm Rules</p>
      <h2 style={styles.sectionTitle}>{profile.fundedProvider || "Funded Account"}</h2>
      <div style={styles.metricGrid}>
        <Metric label="Daily Loss Left" value={`$${fundedMetrics.dailyRiskRemaining.toFixed(2)}`} tone={fundedMetrics.dailyRiskRemaining > 100 ? "good" : "warn"} />
        <Metric label="Drawdown Left" value={`$${fundedMetrics.drawdownRemaining.toFixed(2)}`} tone={fundedMetrics.drawdownRemaining > 500 ? "good" : "warn"} />
        <Metric label="Max Contracts" value={String(profile.maxContracts)} />
        <Metric label="Consistency Rule" value={`${profile.consistencyRuleTarget}%`} />
      </div>
      <div style={{ ...styles.warningStack, marginTop: "14px" }}>
        {(fundedWarnings.length ? fundedWarnings : ["Protect payout. Stay inside rule limits."]).map((warning) => (
          <div key={warning} style={warning.includes("Protect") ? styles.coachPrompt : styles.warningBox}>{warning}</div>
        ))}
      </div>
    </section>
  );
}

function WatchlistCard({ price, profile, watchlist }) {
  const items = normalizeWatchlistItems(watchlist, profile.mainMarket);
  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Watchlist</p>
      <h2 style={styles.sectionTitle}>Markets</h2>
      <div style={styles.warningStack}>
        {items.slice(0, 6).map((item) => (
          <PlanItem key={item.id || item.symbol} title={item.symbol} text={item.symbol === profile.mainMarket ? `Current price ${Number(price).toFixed(2)}` : item.notes || "Watching"} />
        ))}
      </div>
    </section>
  );
}

function PerformanceStatsCard({ discipline, journalEntries, tradeGrade }) {
  const analytics = getJournalAnalytics(journalEntries, discipline);
  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Performance Stats</p>
      <h2 style={styles.sectionTitle}>Execution Snapshot</h2>
      <div style={styles.metricGrid}>
        <Metric label="Trade Grade" value={`${tradeGrade.letter} ${tradeGrade.score}/100`} tone={tradeGrade.score >= 75 ? "good" : tradeGrade.score >= 55 ? "warn" : "bad"} />
        <Metric label="Total Trades" value={String(analytics.totalTrades)} />
        <Metric label="Win Rate" value={`${analytics.winRate}%`} />
        <Metric label="Profit Factor" value={analytics.profitFactor.toFixed(2)} />
        <Metric label="Best Day" value={`$${analytics.bestDay.toFixed(2)}`} tone="good" />
        <Metric label="Worst Day" value={`$${analytics.worstDay.toFixed(2)}`} tone="bad" />
      </div>
    </section>
  );
}

function FundedManualPanel({ profile, updateProfile }) {
  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Funded Account Mode</p>
      <h2 style={styles.sectionTitle}>Manual Rule Setup</h2>
      <div style={styles.formGrid}>
        <SelectField label="Prop Firm" value={profile.fundedProvider} options={fundedProviders} onChange={(value) => updateProfile("fundedProvider", value)} />
        <Field label="Account Size" type="number" value={profile.accountSize} onChange={(value) => updateProfile("accountSize", value)} />
        <Field label="Daily Loss Limit" type="number" value={profile.maxDailyLoss} onChange={(value) => updateProfile("maxDailyLoss", value)} />
        <Field label="Trailing Drawdown" type="number" value={profile.trailingDrawdown} onChange={(value) => updateProfile("trailingDrawdown", value)} />
        <Field label="Profit Target" type="number" value={profile.profitGoal} onChange={(value) => updateProfile("profitGoal", value)} />
        <Field label="Max Contracts" type="number" value={profile.maxContracts} onChange={(value) => updateProfile("maxContracts", value)} />
        <Field label="Consistency Rule %" type="number" value={profile.consistencyRuleTarget} onChange={(value) => updateProfile("consistencyRuleTarget", value)} />
        <SelectField label="Account Phase" value={profile.accountPhase} options={["evaluation", "funded", "live"]} onChange={(value) => updateProfile("accountPhase", value)} />
      </div>
    </section>
  );
}

function calculateTrade({ activePosition, contracts, direction, discipline, entry, price, profile, resistance, riskPoints, support }) {
  const pointValue = pointValues[profile.mainMarket] || 2;
  const isLong = direction === "long";
  const inChop = price >= support && price <= resistance;
  const longTrigger = price > resistance;
  const shortTrigger = price < support;
  const directionAligned = (isLong && longTrigger) || (!isLong && shortTrigger);
  const distanceFromEntry = Math.abs(price - entry);
  const trim1Points = Math.max(1, Math.abs(Number(profile.trim1Points) || 1));
  const trim2Points = Math.max(trim1Points + 0.25, Math.abs(Number(profile.trim2Points) || trim1Points * 2));
  const runnerPoints = Math.max(trim2Points + 0.25, Math.abs(Number(profile.runnerPoints) || trim2Points * 1.5));
  const trim1 = isLong ? entry + trim1Points : entry - trim1Points;
  const trim2 = isLong ? entry + trim2Points : entry - trim2Points;
  const runner = isLong ? entry + runnerPoints : entry - runnerPoints;
  const rewardPoints = Math.abs(trim2 - entry);
  const rewardRisk = riskPoints > 0 ? rewardPoints / riskPoints : 0;
  const { smartStop, stopReason } = getSmartStop({ direction, entry, resistance, riskPoints, support });
  const actualRiskPoints = Math.abs(entry - smartStop);
  const totalRisk = actualRiskPoints * pointValue * contracts;
  const dollarPerPoint = pointValue * contracts;
  const riskPerTenPoints = dollarPerPoint * 10;
  const estimatedMaxLoss = riskPoints * dollarPerPoint;
  const openPnl = (isLong ? price - entry : entry - price) * pointValue * contracts;
  const riskLeft = Math.max(0, totalRisk + Math.min(openPnl, 0));
  const trim1Hit = isLong ? price >= trim1 : price <= trim1;
  const trim2Hit = isLong ? price >= trim2 : price <= trim2;
  const runnerHit = isLong ? price >= runner : price <= runner;
  const stopHit = isLong ? price <= smartStop : price >= smartStop;
  const runnerApproaching = isLong ? price >= runner - 5 : price <= runner + 5;
  const lostStructure = isLong ? price < support : price > resistance;
  const dailyLossUsed = Math.max(0, -discipline.dailyPnl);

  const factors = {
    location: directionAligned ? 20 : inChop ? 4 : 10,
    risk: riskPoints <= profile.defaultRiskPoints ? 15 : riskPoints <= profile.defaultRiskPoints * 1.5 ? 10 : 4,
    reward: rewardRisk >= 2 ? 20 : rewardRisk >= 1.5 ? 15 : rewardRisk >= 1 ? 10 : 3,
    direction: directionAligned ? 15 : inChop ? 4 : 8,
    distance: distanceFromEntry <= riskPoints ? 15 : distanceFromEntry <= riskPoints * 2 ? 9 : 4,
    contracts:
      estimatedMaxLoss > profile.maxRiskPerTrade || totalRisk > profile.accountSize * 0.015
        ? 3
        : contracts <= profile.defaultContracts
          ? 15
          : contracts <= profile.defaultContracts * 1.5
            ? 9
            : 5,
  };

  const chopPenalty = inChop ? 12 : 0;
  const score = Math.max(0, Math.min(100, Object.values(factors).reduce((sum, value) => sum + value, 0) - chopPenalty));
  const confidence = score >= 75 ? "High" : score >= 50 ? "Medium" : "Low";
  const confidenceColor = confidence === "High" ? "#16a34a" : confidence === "Medium" ? "#ca8a04" : "#dc2626";
  const bias = inChop ? "WAIT" : longTrigger ? "LONG TRIGGER" : "SHORT TRIGGER";
  const biasColor = bias === "LONG TRIGGER" ? "#22c55e" : bias === "SHORT TRIGGER" ? "#ef4444" : "#facc15";
  const biasMessage = inChop ? "Price is trapped between support and resistance." : `${bias}. Wait for momentum and clean execution.`;

  let coachMessage = "Stop should be below structure, not random.";
  if (inChop) coachMessage = "Wait. Price is in the middle.";
  else if (longTrigger && isLong) coachMessage = "Long trigger active. Wait for momentum.";
  else if (shortTrigger && !isLong) coachMessage = "Short trigger active. Wait for momentum.";
  if ((isLong && Math.abs(price - support) <= riskPoints) || (!isLong && Math.abs(price - resistance) <= riskPoints)) coachMessage = "Good setup: price near support.";
  if (trim1Hit && !trim2Hit) coachMessage = "First trim hit. Take partial profit.";
  if (totalRisk > profile.accountSize * 0.015 || estimatedMaxLoss > profile.maxRiskPerTrade) coachMessage = "Risk too high. Lower contracts.";
  if (Math.abs(price - entry) > riskPoints * 2) coachMessage = "Do not chase after a big candle.";

  let suggestedAction = "HOLD";
  let actionTone = "neutral";
  if (stopHit || runnerHit || lostStructure) {
    suggestedAction = "EXIT";
    actionTone = "bad";
  } else if (trim2Hit) {
    suggestedAction = "MOVE STOP";
    actionTone = "warn";
  } else if (trim1Hit) {
    suggestedAction = "TRIM";
    actionTone = "good";
  } else if (openPnl < -totalRisk * 0.6) {
    suggestedAction = "EXIT";
    actionTone = "bad";
  }

  const disciplineWarnings = [];
  if (discipline.tradesTaken >= profile.maxTradesPerDay) disciplineWarnings.push("You have exceeded your max trades today. Avoid revenge trading.");
  else if (discipline.tradesTaken >= Math.max(1, profile.maxTradesPerDay - 1)) disciplineWarnings.push("You are near max trades.");
  if (dailyLossUsed >= profile.maxDailyLoss) disciplineWarnings.push("Daily loss limit reached. Consider stopping trading today.");
  else if (dailyLossUsed >= profile.maxDailyLoss * 0.75) disciplineWarnings.push("Daily loss limit approaching.");
  if (contracts > profile.maxContracts) disciplineWarnings.push("Contracts exceed your max contract safety setting.");
  if (estimatedMaxLoss > profile.maxRiskPerTrade) disciplineWarnings.push("Position size too large for this account.");
  if (profile.mainMarket === "MNQ" && profile.accountSize < 2000 && contracts > 3) disciplineWarnings.push("High risk size detected.");
  if (disciplineWarnings.length === 0) disciplineWarnings.push("Discipline guardrails are clear.");

  const autoCoaching = [];
  if (trim1Hit || activePosition?.status === "trim1") autoCoaching.push("Trim 1 reached. Take partial profit.");
  if (trim1Hit || trim2Hit || activePosition?.status === "moveStop") autoCoaching.push("Move stop to breakeven.");
  if (trim2Hit || activePosition?.status === "trim2") autoCoaching.push("Trim 2 reached. Protect the runner.");
  if (runnerApproaching && !runnerHit) autoCoaching.push("Runner target approaching.");
  if (stopHit) autoCoaching.push("Stop hit. Exit plan is active.");
  if (runnerHit) autoCoaching.push("Runner target hit. Consider closing or trailing tight.");
  if (inChop) autoCoaching.push("You are in chop.");
  if (!inChop && directionAligned && Math.abs(price - entry) < riskPoints * 0.35) autoCoaching.push("Price losing momentum.");
  if (lostStructure) autoCoaching.push("Exit if price loses structure.");
  if (autoCoaching.length === 0) autoCoaching.push("Hold plan. Wait for price to reach a decision level.");

  return {
    actionTone,
    autoCoaching,
    bias,
    biasColor,
    biasMessage,
    coachMessage,
    confidence,
    confidenceColor,
    disciplineWarnings,
    factors,
    openPnl,
    dollarPerPoint,
    estimatedMaxLoss,
    riskLeft,
    riskPerTenPoints,
    score,
    smartStop,
    stopReason,
    suggestedAction,
    trim1,
    trim2,
    runner,
  };
}

function analyzeKeyLevels({ breakoutLevel, currentPrice, direction, marketBias, pullbackSupport, recentHigh, resistance, support }) {
  const tolerance = Math.max(2, currentPrice * 0.001);
  const middleLow = pullbackSupport + tolerance * 1.5;
  const middleHigh = recentHigh - tolerance * 1.5;
  const nearSupport = Math.abs(currentPrice - pullbackSupport) <= tolerance || Math.abs(currentPrice - support) <= tolerance;
  const nearResistance = Math.abs(currentPrice - recentHigh) <= tolerance || Math.abs(currentPrice - resistance) <= tolerance;
  const nearBreakout = Math.abs(currentPrice - breakoutLevel) <= tolerance;
  const inMiddle = currentPrice > middleLow && currentPrice < middleHigh;
  const bullish = marketBias === "bullish" || direction === "long";
  const bearish = marketBias === "bearish" || direction === "short";

  let marketState = "Chop / no trade";
  let action = "WAIT";
  let message = "Price is not at a clean decision level. Wait for support, resistance, or a retest.";
  let plan = {
    entry: "Wait for price to reach support, resistance, or a clean retest.",
    stop: "No stop until there is a valid setup.",
    target1: "No target until there is a valid setup.",
    target2: "No runner until there is a valid setup.",
  };

  if (inMiddle) {
    action = "NO TRADE: PRICE IN MIDDLE";
    message = "Middle zone is a bad entry area. Do not chase in the middle.";
  }

  if (bullish && nearSupport) {
    marketState = "Bullish pullback";
    action = "SUPPORT TEST: WATCH FOR BOUNCE";
    message = "Bullish pullback. Wait for support reaction. Do not chase in the middle.";
    plan = {
      entry: `${pullbackSupport.toFixed(2)} to ${(pullbackSupport + 5).toFixed(2)}`,
      stop: `${(pullbackSupport - 20).toFixed(2)} to ${(pullbackSupport - 15).toFixed(2)}`,
      target1: recentHigh.toFixed(2),
      target2: `${(resistance + 10).toFixed(2)} or trail runner`,
    };
  } else if (bearish && nearResistance) {
    marketState = "Bearish pullback";
    action = "LOOK FOR SHORT";
    message = "Bearish pullback. Wait for resistance rejection before looking short.";
    plan = {
      entry: `${(recentHigh - 5).toFixed(2)} to ${recentHigh.toFixed(2)}`,
      stop: `${(recentHigh + 15).toFixed(2)} to ${(recentHigh + 20).toFixed(2)}`,
      target1: pullbackSupport.toFixed(2),
      target2: `${(pullbackSupport - 10).toFixed(2)} or next structure below`,
    };
  } else if (nearBreakout || currentPrice > breakoutLevel) {
    marketState = "Breakout attempt";
    action = "BREAKOUT: WAIT FOR RETEST";
    message = "Breakout attempt. Wait for the level to break and retest before entering.";
    plan = {
      entry: "Resistance break + retest",
      stop: `Below breakout level near ${(breakoutLevel - 5).toFixed(2)}`,
      target1: `+10 points: ${(breakoutLevel + 10).toFixed(2)}`,
      target2: `+20 to +35 points: ${(breakoutLevel + 20).toFixed(2)} to ${(breakoutLevel + 35).toFixed(2)}`,
    };
  } else if (currentPrice < pullbackSupport) {
    marketState = "Support test";
    action = "LOOK FOR SHORT";
    message = "Support failure. Only look short if price accepts below support.";
    plan = {
      entry: `Below support: ${(pullbackSupport - 1).toFixed(2)}`,
      stop: `Back above support: ${(pullbackSupport + 5).toFixed(2)}`,
      target1: `Next structure below: ${(pullbackSupport - 10).toFixed(2)}`,
      target2: `Extended target: ${(pullbackSupport - 25).toFixed(2)}`,
    };
  } else if (bullish && currentPrice > pullbackSupport && currentPrice < recentHigh) {
    marketState = "Trend continuation";
    action = "WAIT";
    message = "Trend continuation, but price is between levels. Wait for pullback or retest.";
  } else if (nearResistance) {
    marketState = "Resistance test";
    action = "WAIT";
    message = "Resistance test. Watch for rejection or breakout and retest.";
  } else if (nearSupport) {
    marketState = "Support test";
    action = "SUPPORT TEST: WATCH FOR BOUNCE";
    message = "Support test. Wait for buyers to defend before entering.";
  }

  return { action, marketState, message, plan };
}

function chartDataToCandles(chartData = []) {
  return safeArray(chartData).map((point, index, list) => {
    const close = Number(point.close || 0);
    const previous = Number(list[index - 1]?.close ?? close);
    const range = Math.max(1, Math.abs(close - previous) * 1.6);
    return {
      close,
      high: close + range * 0.5,
      low: close - range * 0.5,
      open: previous,
      timestamp: point.label,
    };
  });
}

function detectKeyLevelsFromCandles(candles = [], fallback = {}) {
  const clean = safeArray(candles)
    .map((candle) => ({
      close: Number(candle.close),
      high: Number(candle.high ?? candle.close),
      low: Number(candle.low ?? candle.close),
      open: Number(candle.open ?? candle.close),
      timestamp: candle.timestamp,
    }))
    .filter((candle) => [candle.close, candle.high, candle.low, candle.open].every(Number.isFinite));

  if (!clean.length) {
    return {
      message: "Add support/resistance manually or connect TradingView alerts.",
      middleZone: "",
      openRange: "",
      resistanceZone: formatOptionalPrice(fallback.resistance),
      sessionHigh: fallback.resistance,
      sessionLow: fallback.support,
      supportZone: formatOptionalPrice(fallback.support),
    };
  }

  const highs = clean.map((candle) => candle.high);
  const lows = clean.map((candle) => candle.low);
  const sessionHigh = Math.max(...highs);
  const sessionLow = Math.min(...lows);
  const priorHigh = Math.max(...highs.slice(0, -1));
  const priorLow = Math.min(...lows.slice(0, -1));
  const openRangeCandles = clean.slice(0, Math.min(6, clean.length));
  const openRangeHigh = Math.max(...openRangeCandles.map((candle) => candle.high));
  const openRangeLow = Math.min(...openRangeCandles.map((candle) => candle.low));
  const swingHighs = [];
  const swingLows = [];

  for (let index = 1; index < clean.length - 1; index += 1) {
    if (clean[index].high >= clean[index - 1].high && clean[index].high >= clean[index + 1].high) swingHighs.push(clean[index].high);
    if (clean[index].low <= clean[index - 1].low && clean[index].low <= clean[index + 1].low) swingLows.push(clean[index].low);
  }

  const currentPrice = Number(fallback.price || clean.at(-1).close);
  const rejectionPad = Math.max(1, (sessionHigh - sessionLow) * 0.018);
  const rejectionHighs = findRepeatedRejectionLevels([...swingHighs, priorHigh, openRangeHigh, sessionHigh], rejectionPad);
  const rejectionLows = findRepeatedRejectionLevels([...swingLows, priorLow, openRangeLow, sessionLow], rejectionPad);
  const supportLevel = averageNearest([fallback.support, priorLow, openRangeLow, sessionLow, ...swingLows, ...rejectionLows].filter(Number.isFinite), currentPrice, "below");
  const resistanceLevel = averageNearest([fallback.resistance, priorHigh, openRangeHigh, sessionHigh, ...swingHighs, ...rejectionHighs].filter(Number.isFinite), currentPrice, "above");
  const zonePad = Math.max(1, (sessionHigh - sessionLow) * 0.015);
  const middleLow = Number((supportLevel + (resistanceLevel - supportLevel) * 0.38).toFixed(2));
  const middleHigh = Number((supportLevel + (resistanceLevel - supportLevel) * 0.62).toFixed(2));

  return {
    breakoutLevel: resistanceLevel,
    repeatedRejectionHighs: Array.isArray(rejectionHighs) ? rejectionHighs : [],
    repeatedRejectionLows: Array.isArray(rejectionLows) ? rejectionLows : [],
    message: "Zones are estimated from recent swing highs/lows, repeated rejection areas, prior levels, session range, and opening range.",
    middleZone: `${middleLow.toFixed(2)} - ${middleHigh.toFixed(2)}`,
    middleZoneHigh: middleHigh,
    middleZoneLow: middleLow,
    openRange: `${openRangeLow.toFixed(2)} - ${openRangeHigh.toFixed(2)}`,
    openRangeHigh,
    openRangeLow,
    priorHigh,
    priorLow,
    pullbackSupport: supportLevel,
    recentHigh: resistanceLevel,
    resistanceLevel,
    resistanceZoneHigh: Number((resistanceLevel + zonePad).toFixed(2)),
    resistanceZoneLow: Number((resistanceLevel - zonePad).toFixed(2)),
    resistanceZone: `${(resistanceLevel - zonePad).toFixed(2)} - ${(resistanceLevel + zonePad).toFixed(2)}`,
    sessionHigh,
    sessionLow,
    source: "mock/manual candles",
    supportLevel,
    supportZoneHigh: Number((supportLevel + zonePad).toFixed(2)),
    supportZoneLow: Number((supportLevel - zonePad).toFixed(2)),
    supportZone: `${(supportLevel - zonePad).toFixed(2)} - ${(supportLevel + zonePad).toFixed(2)}`,
  };
}

function findRepeatedRejectionLevels(levels = [], pad = 1) {
  const clean = levels.filter(Number.isFinite).sort((a, b) => a - b);
  const clusters = [];
  clean.forEach((level) => {
    const cluster = clusters.find((item) => Math.abs(item.average - level) <= pad);
    if (cluster) {
      cluster.values.push(level);
      cluster.average = cluster.values.reduce((sum, value) => sum + value, 0) / cluster.values.length;
    } else {
      clusters.push({ average: level, values: [level] });
    }
  });
  return clusters
    .filter((cluster) => cluster.values.length >= 2)
    .map((cluster) => Number(cluster.average.toFixed(2)));
}

function averageNearest(levels, price, side) {
  const filtered = levels.filter((level) => side === "below" ? level <= price : level >= price);
  const candidates = (filtered.length ? filtered : levels)
    .sort((a, b) => Math.abs(a - price) - Math.abs(b - price))
    .slice(0, 3);
  return Number((candidates.reduce((sum, level) => sum + level, 0) / Math.max(1, candidates.length)).toFixed(2));
}

function getTradeGrade({ contracts, dailyPnl, entry, maxContracts, maxDailyLoss, price, rewardRisk, resistance, stop, support, zoneDetection = {} }) {
  if (rewardRisk?.invalid || rewardRisk?.runnerReward <= 0 || rewardRisk?.ratio <= 0) {
    return {
      letter: "Invalid",
      reason: rewardRisk?.reason || "Invalid plan: targets are on the wrong side of entry.",
      score: 0,
      reasons: [rewardRisk?.reason || "targets are on the wrong side of entry"],
    };
  }
  const range = Math.max(1, Math.abs(resistance - support));
  const supportLevel = Number(zoneDetection.supportLevel ?? support);
  const resistanceLevel = Number(zoneDetection.resistanceLevel ?? resistance);
  const nearSupport = Math.abs(entry - supportLevel) <= range * 0.2;
  const nearResistance = Math.abs(entry - resistanceLevel) <= range * 0.2;
  const middleLow = Number(zoneDetection.middleZoneLow ?? support + range * 0.35);
  const middleHigh = Number(zoneDetection.middleZoneHigh ?? resistance - range * 0.35);
  const middleEntry = entry > middleLow && entry < middleHigh;
  const stopOutsideStructure = stop < support || stop > resistance;
  const riskPoints = Math.abs(entry - stop);
  let score = 100;
  const reasons = [];

  if (!nearSupport && !nearResistance) {
    score -= 18;
    reasons.push("entry was too far from support/resistance");
  }
  if (rewardRisk.ratio < 1.5) {
    score -= 18;
    reasons.push("risk/reward is thin");
  }
  if (riskPoints > range * 0.35) {
    score -= 12;
    reasons.push("stop size is wider than the setup");
  }
  if (!stopOutsideStructure) {
    score -= 14;
    reasons.push("stop is inside the range");
  }
  if (Number(contracts) > Number(maxContracts || 1)) {
    score -= 18;
    reasons.push("contract size is above your funded limit");
  }
  if (middleEntry) {
    score -= 16;
    reasons.push("entry is in the middle/no-trade zone");
  }
  if (Number(dailyPnl) <= -Math.abs(Number(maxDailyLoss || 0)) * 0.8) {
    score -= 18;
    reasons.push("daily loss protection is close");
  }
  if (Math.abs(price - entry) > range * 0.35) {
    score -= 8;
    reasons.push("current price is stretched from entry");
  }

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const letter = boundedScore >= 85 ? "A" : boundedScore >= 70 ? "B" : boundedScore >= 55 ? "C" : "D";
  const reason = reasons.length
    ? `${letter} grade: ${reasons[0]}.`
    : `${letter} grade: clean location, controlled risk, and plan is defined.`;

  return { letter, reason, score: boundedScore, reasons };
}

function formatOptionalPrice(value) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "Pending";
}

function getMissedEntryMessage({ currentPrice, plan }) {
  if (!plan?.entry || !plan?.direction) return "";
  const threshold = 20;
  const missedLong = plan.direction === "long" && currentPrice > plan.entry + threshold;
  const missedShort = plan.direction === "short" && currentPrice < plan.entry - threshold;
  if (!missedLong && !missedShort) return "";
  return "Missed Entry — wait for retest. Do not chase. Wait for pullback, wait for retest, or reset levels.";
}

function getRewardRisk({ plan, pointValue }) {
  if (!plan?.entry || !plan?.stop) {
    return { invalid: true, ratio: 0, reason: "Missing entry or stop.", risk: 0, trim1Reward: 0, trim2Reward: 0, runnerReward: 0 };
  }

  const contracts = plan.contracts || 1;
  const direction = plan.direction === "short" ? "short" : "long";
  const validation = validateTradePlan(plan);
  const riskPoints = direction === "long" ? plan.entry - plan.stop : plan.stop - plan.entry;
  const risk = riskPoints * pointValue * contracts;
  const rewardFor = (target) => {
    const rewardPoints = direction === "long" ? Number(target) - plan.entry : plan.entry - Number(target);
    return rewardPoints * pointValue * contracts;
  };
  const runnerReward = rewardFor(plan.runner ?? plan.target ?? plan.entry);

  return {
    invalid: !validation.valid,
    ratio: risk > 0 && runnerReward > 0 ? runnerReward / risk : 0,
    reason: validation.reason,
    risk: Math.max(0, risk),
    trim1Reward: rewardFor(plan.trim1 ?? plan.entry),
    trim2Reward: rewardFor(plan.trim2 ?? plan.entry),
    runnerReward,
  };
}

function calculateRewardRisk(args) {
  return getRewardRisk(args);
}

function normalizeTradePlan(plan = {}, fallback = {}) {
  const direction = plan.direction === "short" ? "short" : "long";
  const entry = safeNumber(plan.entry, fallback.entry, 0);
  const rawStop = safeNumber(plan.stop, fallback.stop, direction === "long" ? entry - 10 : entry + 10);
  const stop = direction === "long" && rawStop < entry
    ? rawStop
    : direction === "short" && rawStop > entry
      ? rawStop
      : direction === "long"
        ? entry - Math.max(1, Math.abs(rawStop - entry) || 10)
        : entry + Math.max(1, Math.abs(rawStop - entry) || 10);
  const riskPoints = Math.max(1, Math.abs(entry - stop));
  const safeTarget = (value, multiplier) => {
    const number = Number(value);
    const fallbackTarget = direction === "long" ? entry + riskPoints * multiplier : entry - riskPoints * multiplier;
    if (!Number.isFinite(number)) return fallbackTarget;
    return direction === "long" && number > entry ? number : direction === "short" && number < entry ? number : fallbackTarget;
  };
  const trim1 = safeTarget(plan.trim1 ?? fallback.trim1, 1.25);
  const trim2Candidate = safeTarget(plan.trim2 ?? fallback.trim2, 2);
  const trim2 = direction === "long"
    ? Math.max(trim2Candidate, trim1 + riskPoints * 0.25)
    : Math.min(trim2Candidate, trim1 - riskPoints * 0.25);
  const runnerCandidate = safeTarget(plan.runner ?? plan.target ?? fallback.runner ?? fallback.target, 3);
  const runner = direction === "long"
    ? Math.max(runnerCandidate, trim2 + riskPoints * 0.25)
    : Math.min(runnerCandidate, trim2 - riskPoints * 0.25);
  return {
    ...fallback,
    ...plan,
    contracts: safeNumber(plan.contracts, fallback.contracts, 1),
    direction,
    entry,
    runner,
    stop,
    target: runner,
    trim1,
    trim2,
  };
}

function validateTradePlan(plan = {}) {
  const direction = plan.direction === "short" ? "short" : "long";
  const entry = Number(plan.entry);
  const stop = Number(plan.stop);
  const trim1 = Number(plan.trim1);
  const trim2 = Number(plan.trim2);
  const runner = Number(plan.runner ?? plan.target);
  if (![entry, stop, trim1, trim2, runner].every(Number.isFinite)) {
    return { valid: false, reason: "Invalid plan: entry, stop, and targets must be defined." };
  }
  const valid = direction === "long"
    ? stop < entry && trim1 > entry && trim2 > trim1 && runner > trim2
    : stop > entry && trim1 < entry && trim2 < trim1 && runner < trim2;
  return {
    valid,
    reason: valid ? "" : "Invalid plan: targets are on the wrong side of entry.",
  };
}

function safeNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function getAutoTradePlan({ accountSize, contracts, dailyPnl, marketSpec, maxContracts, maxDailyLoss, maxRisk, price, resistance, support, zoneDetection = {} }) {
  let supportLevel = Number(zoneDetection.supportLevel ?? support);
  let resistanceLevel = Number(zoneDetection.resistanceLevel ?? resistance);
  if (!Number.isFinite(supportLevel) || !Number.isFinite(resistanceLevel) || supportLevel >= resistanceLevel) {
    const priceValue = Number(price) || 0;
    const pad = Math.max(8, Math.abs(priceValue) * 0.0015);
    supportLevel = Number.isFinite(supportLevel) && supportLevel < priceValue ? supportLevel : priceValue - pad;
    resistanceLevel = Number.isFinite(resistanceLevel) && resistanceLevel > priceValue ? resistanceLevel : priceValue + pad;
  }
  const supportZoneHigh = Number(zoneDetection.supportZoneHigh ?? supportLevel);
  const resistanceZoneLow = Number(zoneDetection.resistanceZoneLow ?? resistanceLevel);
  const range = Math.max(1, resistanceLevel - supportLevel);
  const middleLow = Number(zoneDetection.middleZoneLow ?? supportLevel + range * 0.35);
  const middleHigh = Number(zoneDetection.middleZoneHigh ?? resistanceLevel - range * 0.35);
  const tick = Number(marketSpec.tickSize || 0.25);
  const priceValue = Number(price);
  const riskBudget = Math.max(1, Number(maxRisk || accountSize * 0.005 || 1));
  const riskLocked = Number(dailyPnl) <= -Math.abs(Number(maxDailyLoss || 0)) * 0.8;
  if (priceValue > middleLow && priceValue < middleHigh) {
    return {
      noTrade: true,
      coachMessage: "No trade. Price is mid-range.",
      message: "No trade. Price is mid-range. Wait for support, resistance, breakout, or retest.",
      reason: "Middle-zone entries usually offer poor location and unclear invalidation.",
      score: 35,
    };
  }

  if (riskLocked) {
    return {
      noTrade: true,
      coachMessage: "Risk too high. Lower contracts.",
      message: "Daily loss protection is close. Stop trading or reduce size before taking another setup.",
      reason: "Daily loss protection is close.",
      score: 25,
    };
  }

  const nearSupport = priceValue <= supportZoneHigh || Math.abs(priceValue - supportLevel) <= range * 0.18;
  const nearResistance = priceValue >= resistanceZoneLow || Math.abs(priceValue - resistanceLevel) <= range * 0.18;
  const isLong = nearSupport || (!nearResistance && priceValue > resistanceLevel);
  const direction = isLong ? "long" : "short";
  const entry = roundToTick(priceValue, tick);
  const preferredStopPoints = marketSpec.pointValue >= 20 ? 12 : 16;
  const maxBudgetStopPoints = riskBudget / Math.max(1, marketSpec.pointValue * Number(contracts || 1));
  const stopPoints = roundToTick(Math.max(tick * 8, Math.min(preferredStopPoints, maxBudgetStopPoints || preferredStopPoints, range * 0.22)), tick);
  const structureStop = isLong ? Math.min(supportLevel - tick * 4, entry - tick) : Math.max(resistanceLevel + tick * 4, entry + tick);
  const budgetStop = isLong ? entry - stopPoints : entry + stopPoints;
  const stop = roundToTick(isLong ? Math.min(entry - tick, Math.max(structureStop, budgetStop)) : Math.max(entry + tick, Math.min(structureStop, budgetStop)), tick);
  const riskPoints = Math.abs(entry - stop);
  const trim1 = roundToTick(isLong ? entry + riskPoints * 1.25 : entry - riskPoints * 1.25, tick);
  const trim2 = roundToTick(isLong ? entry + riskPoints * 2 : entry - riskPoints * 2, tick);
  const runner = roundToTick(isLong ? entry + riskPoints * 3 : entry - riskPoints * 3, tick);
  const riskDollars = riskPoints * marketSpec.pointValue * contracts;
  const rewardDollars = Math.abs(runner - entry) * marketSpec.pointValue * contracts;
  const rewardRisk = rewardDollars / Math.max(1, riskDollars);
  const tooManyContracts = Number(contracts) > Number(maxContracts || contracts);
  const accountRiskPercent = accountSize > 0 ? (riskDollars / accountSize) * 100 : 0;
  let score = 88;
  const reasons = [];
  if (!nearSupport && !nearResistance) {
    score -= 18;
    reasons.push("wait for retest");
  }
  if (riskDollars > riskBudget) {
    score -= 18;
    reasons.push("risk too high");
  }
  if (rewardRisk < 1.8) {
    score -= 14;
    reasons.push("reward/risk is thin");
  }
  if (tooManyContracts) {
    score -= 18;
    reasons.push("lower contracts");
  }
  if (accountRiskPercent > 1) {
    score -= 8;
    reasons.push("account risk is elevated");
  }
  score = Math.max(30, Math.min(96, Math.round(score)));
  const setupLocation = isLong ? "near support" : "near resistance";
  const coachMessage = reasons.includes("risk too high")
    ? "Risk too high. Lower contracts."
    : reasons.includes("wait for retest")
      ? "Wait for retest."
      : isLong
        ? "Potential long setup near support."
        : "Potential short setup near resistance.";

  return {
    contracts,
    coachMessage,
    direction,
    entry,
    noTrade: false,
    reason: reasons.length ? reasons.join("; ") : `Clean ${setupLocation} with defined risk.`,
    rewardRisk,
    riskDollars,
    runner,
    score,
    setupType: "Auto zone plan",
    stop,
    trim1,
    trim2,
  };
}

function roundToTick(value, tick = 0.25) {
  const size = Number(tick) || 0.25;
  return Number((Math.round(Number(value) / size) * size).toFixed(2));
}

function TradeLadder({ currentPrice, plan }) {
  const levels = [
    { color: "#f8fafc", label: "Current", price: currentPrice },
    { color: "#60a5fa", label: "Entry", price: plan.entry },
    { color: "#ef4444", label: "Stop", price: plan.stop },
    { color: "#22c55e", label: "Trim 1", price: plan.trim1 },
    { color: "#16a34a", label: "Trim 2", price: plan.trim2 },
    { color: "#84cc16", label: "Runner", price: plan.runner ?? plan.target },
  ].filter((level) => Number.isFinite(level.price));

  const min = Math.min(...levels.map((level) => level.price));
  const max = Math.max(...levels.map((level) => level.price));
  const span = Math.max(1, max - min);

  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Visual Trade Graph</p>
      <h2 style={styles.sectionTitle}>Price Ladder</h2>
      <div style={styles.ladder}>
        {levels.map((level) => {
          const bottom = ((level.price - min) / span) * 82 + 8;
          return (
            <div key={level.label} style={{ ...styles.ladderLevel, bottom: `${bottom}%`, borderColor: level.color }}>
              <span style={{ color: level.color }}>{level.label}</span>
              <strong>{level.price.toFixed(2)}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RiskRewardPanel({ contracts, market, plan, pointValue, rewardRisk }) {
  const maxReward = Math.max(1, rewardRisk.runnerReward);

  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Risk / Reward Graph</p>
      <h2 style={styles.sectionTitle}>{market} · {contracts} contracts</h2>
      <Metric label="Risk" value={`$${rewardRisk.risk.toFixed(2)}`} tone="bad" />
      <Metric label="Reward to Trim 1" value={`$${rewardRisk.trim1Reward.toFixed(2)}`} tone="good" />
      <Metric label="Reward to Trim 2" value={`$${rewardRisk.trim2Reward.toFixed(2)}`} tone="good" />
      <Metric label="Reward to Runner" value={`$${rewardRisk.runnerReward.toFixed(2)}`} tone="good" />
      <div style={styles.rrTrack}>
        <div style={{ ...styles.rrRisk, width: `${Math.min(100, (rewardRisk.risk / maxReward) * 100)}%` }} />
        <div style={{ ...styles.rrReward, width: "100%" }} />
      </div>
      <p style={styles.rrText}>R:R = {rewardRisk.ratio.toFixed(1)}R · ${pointValue}/point</p>
      <p style={styles.muted}>Entry {plan.entry?.toFixed?.(2)} · Stop {plan.stop?.toFixed?.(2)}</p>
    </section>
  );
}

function ShareSetupPanel({ contracts, engine, market, plan, rewardRisk, setupName = "Manual" }) {
  const [copied, setCopied] = useState(false);
  const direction = plan.direction === "short" ? "Short" : "Long";
  const setupText = [
    "Trade Pilot Setup",
    `Market: ${market}`,
    `Bias: ${direction}`,
    `Setup: ${setupName}`,
    `Entry: ${plan.entry?.toFixed?.(2) ?? "N/A"}`,
    `Stop: ${plan.stop?.toFixed?.(2) ?? "N/A"}`,
    `Trim 1: ${plan.trim1?.toFixed?.(2) ?? "N/A"}`,
    `Trim 2: ${plan.trim2?.toFixed?.(2) ?? "N/A"}`,
    `Runner: ${(plan.runner ?? plan.target)?.toFixed?.(2) ?? "N/A"}`,
    `Contracts: ${contracts}`,
    `Risk: $${rewardRisk.risk.toFixed(2)}`,
    `Reward/Risk: ${rewardRisk.ratio.toFixed(1)}R`,
    `Trade Score: ${engine.score}/100`,
  ].join("\n");

  const copySetup = async () => {
    await navigator.clipboard.writeText(setupText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Share Setup</p>
      <h2 style={styles.sectionTitle}>Clean Trade Plan</h2>
      <pre style={styles.sharePreview}>{setupText}</pre>
      <button onClick={copySetup} style={styles.settingsButton}>{copied ? "Copied" : "Copy Trade Plan"}</button>
      <p style={{ ...styles.muted, marginTop: "12px" }}>Later this can become a shareable URL.</p>
    </section>
  );
}

function buildChartData({ price, entry, stop, support, resistance, trim1, trim2, runner }) {
  const levels = [price, entry, stop, support, resistance, trim1, trim2, runner].filter((value) => Number.isFinite(Number(value)));
  const center = Number(price) || 0;
  const spread = Math.max(8, (Math.max(...levels) - Math.min(...levels)) || center * 0.002);

  return Array.from({ length: 34 }, (_, index) => {
    const wave = Math.sin(index / 2.4) * spread * 0.22;
    const slope = (index - 17) * spread * 0.012;
    const close = index === 33 ? price : center + wave + slope + Math.cos(index / 1.7) * spread * 0.08;
    return {
      close: Number(close.toFixed(2)),
      label: `${index + 1}`,
    };
  });
}

function getLiveCoachMessage({ activePosition, autoTradePlan, discipline, engine, price, profile, tradeGrade, visualPlan }) {
  if (discipline.dailyPnl <= -Math.abs(profile.maxDailyLoss)) return "Daily loss limit reached. Stop trading.";
  if (autoTradePlan?.noTrade) return autoTradePlan.coachMessage || autoTradePlan.message;
  if (!visualPlan?.entry || !visualPlan?.stop) return "No active trade plan. Define entry, stop, and targets first.";
  if (tradeGrade?.letter === "Invalid") return "Invalid plan: targets are on the wrong side of entry.";
  if ((activePosition?.contracts || visualPlan.contracts || 0) > profile.maxContracts) return "High risk size detected. Reduce contracts.";
  if (tradeGrade?.score < 55) return "Risk too high. Lower contracts or wait for a cleaner level.";

  const isLong = (activePosition?.direction || visualPlan.direction) !== "short";
  const stopHit = isLong ? price <= visualPlan.stop : price >= visualPlan.stop;
  const trim1Hit = isLong ? price >= visualPlan.trim1 : price <= visualPlan.trim1;

  if (stopHit) return "Stop area reached. Respect your plan.";
  if (trim1Hit) return "Trim 1 reached. Consider taking partial profit.";
  if (autoTradePlan?.coachMessage) return autoTradePlan.coachMessage;
  if (engine.bias.includes("WAIT")) return "Price is mid-range. Wait for support, resistance, or breakout.";
  return engine.autoCoaching[0] || "Hold plan. Let price reach a decision level.";
}

function TradeChartPanel({ chartData, currentPrice, entry, runner, stop, support, resistance, trim1, trim2, zoneDetection = {} }) {
  const safeChartData = chartData?.length ? chartData : buildChartData({ price: currentPrice, entry, stop, support, resistance, trim1, trim2, runner });
  const supportLow = Number(zoneDetection.supportZoneLow ?? support);
  const supportHigh = Number(zoneDetection.supportZoneHigh ?? support);
  const resistanceLow = Number(zoneDetection.resistanceZoneLow ?? resistance);
  const resistanceHigh = Number(zoneDetection.resistanceZoneHigh ?? resistance);
  const middleLow = Number(zoneDetection.middleZoneLow);
  const middleHigh = Number(zoneDetection.middleZoneHigh);
  return (
    <section className="chart-panel" style={styles.chartPanel}>
      <div style={styles.sectionHeader}>
        <div>
          <p style={styles.cardLabel}>Chart View</p>
          <h2 style={styles.sectionTitle}>Live Trade Map</h2>
        </div>
        <strong style={styles.chartPrice}>{Number(currentPrice).toFixed(2)}</strong>
      </div>
      <div className="tradepilot-chart-wrap" style={styles.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={safeChartData} margin={{ top: 12, right: 22, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
            <XAxis dataKey="label" hide />
            <YAxis domain={["dataMin - 12", "dataMax + 12"]} tick={{ fill: "#a1a1aa", fontSize: 12 }} width={64} />
            <Tooltip contentStyle={{ background: "#020617", border: "1px solid #334155", borderRadius: "10px", color: "#f8fafc" }} />
            {Number.isFinite(supportLow) && Number.isFinite(supportHigh) ? (
              <ReferenceArea y1={supportLow} y2={supportHigh} fill="#14b8a6" fillOpacity={0.16} strokeOpacity={0} />
            ) : null}
            {Number.isFinite(resistanceLow) && Number.isFinite(resistanceHigh) ? (
              <ReferenceArea y1={resistanceLow} y2={resistanceHigh} fill="#f97316" fillOpacity={0.14} strokeOpacity={0} />
            ) : null}
            {Number.isFinite(middleLow) && Number.isFinite(middleHigh) ? (
              <ReferenceArea y1={middleLow} y2={middleHigh} fill="#64748b" fillOpacity={0.08} strokeOpacity={0} />
            ) : null}
            <Line type="monotone" dataKey="close" stroke="#f8fafc" strokeWidth={3} dot={false} isAnimationActive={false} />
            <ReferenceLine y={currentPrice} label="Price" stroke="#facc15" strokeWidth={2} />
            <ReferenceLine y={entry} label="Entry" stroke="#3b82f6" strokeWidth={2} />
            <ReferenceLine y={stop} label="Stop" stroke="#ef4444" strokeWidth={2} />
            <ReferenceLine y={trim1} label="Trim 1" stroke="#22c55e" />
            <ReferenceLine y={trim2} label="Trim 2" stroke="#16a34a" />
            <ReferenceLine y={runner} label="Runner" stroke="#86efac" />
            <ReferenceLine y={support} label="Support" stroke="#14b8a6" strokeDasharray="5 5" />
            <ReferenceLine y={resistance} label="Resistance" stroke="#f97316" strokeDasharray="5 5" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p style={styles.chartNote}>Demo chart shown until TradingView or broker data is connected.</p>
    </section>
  );
}

function LivestreamDashboard({ activePosition, brokerConnection, coachMessage, discipline, engine, price, profile, riskStatus, tradeGrade, visualPlan }) {
  const contracts = activePosition?.contracts ?? visualPlan.contracts ?? profile.defaultContracts;
  const positionLabel = activePosition ? activePosition.direction.toUpperCase() : "Flat";
  const fundedMetrics = getFundedAccountMetrics({ brokerConnection, discipline, profile });

  return (
    <section style={styles.livestreamPanel}>
      <div style={styles.liveHero}>
        <p style={styles.cardLabel}>Livestream Dashboard</p>
        <p style={styles.liveMarket}>{profile.mainMarket}</p>
        <h2 style={styles.livePrice}>{Number(price).toFixed(2)}</h2>
        <p style={styles.liveSubline}>{coachMessage}</p>
      </div>
      <div style={styles.liveMetricGrid}>
        <Metric label="Position" value={positionLabel} />
        <Metric label="Contracts" value={String(contracts)} />
        <Metric label="Entry" value={Number(visualPlan.entry || 0).toFixed(2)} />
        <Metric label="Trade Score" value={`${tradeGrade.letter} ${tradeGrade.score}/100`} tone={tradeGrade.score >= 75 ? "good" : "warn"} />
        <Metric label="Open P/L" value={`$${engine.openPnl.toFixed(2)}`} tone={engine.openPnl >= 0 ? "good" : "bad"} />
        <Metric label="Daily P/L" value={`$${fundedMetrics.dailyPnl.toFixed(2)}`} />
        <Metric label="Risk Status" value={riskStatus} tone={riskStatus === "Good" ? "good" : "warn"} />
      </div>
    </section>
  );
}

function ProductUpgradePanel({ brokerConnection, discipline, journalEntries, profile }) {
  const analytics = getJournalAnalytics(journalEntries, discipline);
  const equityPoints = getEquityCurvePoints(journalEntries, discipline);

  return (
    <section style={styles.productUpgradeGrid}>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Prop Firm Rule Engine</p>
        <h2 style={styles.sectionTitle}>{profile.fundedProvider}</h2>
        <div style={styles.metricGrid}>
          <Metric label="Account Size" value={`$${Number(profile.accountSize || profile.startingBalance).toLocaleString()}`} />
          <Metric label="Trailing Drawdown" value={`$${Number(profile.trailingDrawdown || 0).toLocaleString()}`} />
          <Metric label="Daily Loss Limit" value={`$${Number(profile.maxDailyLoss || 0).toLocaleString()}`} />
          <Metric label="Profit Target" value={`$${Number(profile.profitGoal || 0).toLocaleString()}`} />
          <Metric label="Max Contracts" value={String(profile.maxContracts)} />
          <Metric label="Consistency Rule" value={`${profile.consistencyRuleTarget}%`} />
          <Metric label="Phase" value={profile.accountPhase} />
        </div>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Equity Curve</p>
        <h2 style={styles.sectionTitle}>Performance Snapshot</h2>
        <div style={styles.equityCurve}>
          {equityPoints.map((point, index) => (
            <span key={`${point}-${index}`} style={{ ...styles.equityBar, height: `${Math.max(8, Math.min(100, Math.abs(point)))}%`, background: point >= 0 ? "#22c55e" : "#ef4444" }} />
          ))}
        </div>
        <div style={styles.metricGrid}>
          <Metric label="Win Rate" value={`${analytics.winRate}%`} />
          <Metric label="Total Trades" value={String(analytics.totalTrades)} />
          <Metric label="Avg Win" value={`$${analytics.averageWin.toFixed(2)}`} />
          <Metric label="Avg Loss" value={`$${analytics.averageLoss.toFixed(2)}`} />
          <Metric label="Profit Factor" value={analytics.profitFactor.toFixed(2)} />
          <Metric label="Max Drawdown" value={`$${analytics.maxDrawdown.toFixed(2)}`} />
          <Metric label="Best Day" value={`$${analytics.bestDay.toFixed(2)}`} />
          <Metric label="Worst Day" value={`$${analytics.worstDay.toFixed(2)}`} />
        </div>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Journal Analytics</p>
        <h2 style={styles.sectionTitle}>Execution Review</h2>
        <PlanItem title="Trade Entry" text="Track entry, exit, direction, setup type, result, notes, and execution grade." />
        <PlanItem title="Screenshots" text="Screenshot upload is planned for a later release." />
        <PlanItem title="Current Grade" text={analytics.totalTrades ? `${analytics.winRate}% win rate from saved notes.` : "Start saving trades to build your stats."} />
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Tradovate API Connection</p>
        <h2 style={styles.sectionTitle}>Broker Planning</h2>
        <div style={styles.metricGrid}>
          <Metric label="Connection" value={brokerConnection.connectionStatus || "Not Connected"} />
          <Metric label="Current Price" value={brokerConnection.quote?.price ? brokerConnection.quote.price.toFixed(2) : "Ready"} />
          <Metric label="Position" value={brokerConnection.position ? brokerConnection.position.direction : "Read-only"} />
          <Metric label="Open P/L" value={`$${Number(brokerConnection.openPnl || 0).toFixed(2)}`} />
          <Metric label="Realized P/L" value={`$${Number(brokerConnection.realizedPnl || 0).toFixed(2)}`} />
          <Metric label="Account Balance" value={`$${Number(brokerConnection.accountBalance || profile.accountSize || 0).toFixed(2)}`} />
        </div>
        <p style={{ ...styles.muted, marginTop: "12px" }}>Read-only only. Trade Pilot does not place, cancel, or modify trades.</p>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Supabase Security</p>
        <h2 style={styles.sectionTitle}>Admin Checklist</h2>
        <PlanItem title="Leaked Password Protection" text="Enable in Supabase Auth security settings." />
        <PlanItem title="Email Confirmations" text="Keep confirmations on for alpha accounts." />
        <PlanItem title="Site URL" text="https://tradepilottool.com" />
        <PlanItem title="Redirect URL" text="https://tradepilottool.com" />
      </section>
    </section>
  );
}

function getJournalAnalytics(journalEntries = [], discipline = {}) {
  const safeEntries = safeArray(journalEntries);
  const results = safeEntries
    .map((entry) => Number(entry.result ?? entry.pnl ?? entry.dailyPnl ?? 0))
    .filter((value) => Number.isFinite(value));
  const wins = results.filter((value) => value > 0);
  const losses = results.filter((value) => value < 0);
  const grossWin = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const running = results.reduce((state, value) => {
    const equity = state.equity + value;
    const peak = Math.max(state.peak, equity);
    return { equity, maxDrawdown: Math.max(state.maxDrawdown, peak - equity), peak };
  }, { equity: 0, maxDrawdown: 0, peak: 0 });

  return {
    averageLoss: losses.length ? grossLoss / losses.length : Math.abs(Number(discipline.dailyPnl || 0)) || 0,
    averageWin: wins.length ? grossWin / wins.length : Math.max(0, Number(discipline.dailyPnl || 0)),
    bestDay: results.length ? Math.max(...results) : Math.max(0, Number(discipline.dailyPnl || 0)),
    maxDrawdown: running.maxDrawdown,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? grossWin : 0,
    totalTrades: safeEntries.length || Number(discipline.tradesTaken || 0),
    winRate: results.length ? Math.round((wins.length / results.length) * 100) : 0,
    worstDay: results.length ? Math.min(...results) : Math.min(0, Number(discipline.dailyPnl || 0)),
  };
}

function getEquityCurvePoints(journalEntries = [], discipline = {}) {
  const points = safeArray(journalEntries).slice(0, 12).reverse().map((entry) => Number(entry.result ?? entry.pnl ?? entry.dailyPnl ?? 0));
  if (points.length) return points;
  const daily = Number(discipline.dailyPnl || 0);
  return [-12, 18, 10, -8, 22, 30, daily || 16];
}

function getSmartStop({ direction, entry, resistance, riskPoints, support }) {
  const isLong = direction === "long";
  const risk = Math.max(1, Math.abs(Number(riskPoints) || 1));
  const structureStop = isLong ? Math.min(Number(support) - 1, entry - 0.25) : Math.max(Number(resistance) + 1, entry + 0.25);
  const fallbackStop = isLong ? entry - risk : entry + risk;
  const structureOnCorrectSide = isLong ? structureStop < entry : structureStop > entry;
  const useStructureStop = structureOnCorrectSide && Math.abs(entry - structureStop) <= risk * 1.5;

  return {
    smartStop: useStructureStop ? structureStop : fallbackStop,
    stopReason: useStructureStop
      ? isLong
        ? "Stop placed below support to protect against a failed breakout."
        : "Stop placed above resistance to protect against a failed breakdown."
      : "Structure is too far away, so stop uses your planned risk points.",
  };
}

function getConnectionStatusLabel(connection) {
  if (connection?.connectionStatus) return connection.connectionStatus;
  if (!connection?.connected) return "Not Connected";
  if (connection.platform === "Demo Broker") return "Demo Connected";
  if (connection.platform === "Tradovate Prop/Funded Read-Only") return "Prop/Funded Read-Only Connected";
  if (connection.platform === "Tradovate Live Read-Only") return "Live Read-Only Connected";
  if (connection.platform === "Tradovate Demo Read-Only") return "Demo Connected";
  if (connection.platform === "TradingView Webhook") return "TradingView Alerts Connected";
  return `${connection.platform} Connected`;
}

function getConnectionStateMessage({ brokerConnection, dataSource, profile }) {
  const platform = brokerConnection?.platform || profile.fundedPlatform;
  if (platform === "Demo Broker" || dataSource === "Demo Broker") return "Demo Broker Connected - simulated data.";
  if (platform === "Manual Mode" || dataSource === "Manual Mode") return "Manual Mode Active - enter price and levels yourself.";
  if (platform === "TradingView Webhook" || dataSource === "TradingView Webhook") {
    return brokerConnection?.connectionStatus === "TradingView signal received"
      ? "TradingView signal received"
      : "Waiting for TradingView alert data.";
  }
  if (platform?.includes("Tradovate") || profile.fundedPlatform === "Tradovate") return "Tradovate API credentials are not configured yet. Add Vercel env vars first.";
  if (profile.accountType === "Funded/prop account") return "Funded account rules active. Broker data may still be manual unless API is connected.";
  return "Not connected. Choose a data source.";
}

function buildBrokerSafetyWarnings({ activePosition, brokerConnection, discipline, engine, profile }) {
  const warnings = [...engine.disciplineWarnings];
  const position = brokerConnection?.position || activePosition;
  const contracts = Number(position?.contracts || 0);
  const dailyLossHit = discipline.dailyPnl <= -Math.abs(profile.maxDailyLoss);

  if (contracts > profile.maxContracts) warnings.push("Position size too large for your profile.");
  if (dailyLossHit) warnings.push("Daily loss limit hit. Stop trading and review.");
  if (discipline.tradesTaken >= profile.maxTradesPerDay) warnings.push("Too many trades today. Further trades increase mistake risk.");
  if (discipline.tradesTaken >= Math.max(3, profile.maxTradesPerDay - 1) && discipline.dailyPnl < 0) warnings.push("Revenge trading risk detected after repeated losses.");
  if (position && !Number.isFinite(Number(position.stop))) warnings.push("Stop missing. Add a defined exit before continuing.");
  if (!position && !activePosition) warnings.push("No trade plan active.");

  return [...new Set(warnings)];
}

function getFundedAccountMetrics({ brokerConnection, discipline, profile }) {
  const accountBalance = Number(brokerConnection.accountBalance || profile.accountSize || profile.startingBalance);
  const startingBalance = Number(profile.startingBalance || profile.accountSize || 0);
  const trailingDrawdown = Number(profile.trailingDrawdown || 0);
  const drawdownFloor = Math.max(startingBalance - trailingDrawdown, accountBalance - trailingDrawdown);
  const drawdownRemaining = Math.max(0, accountBalance - drawdownFloor);
  const dailyPnl = Number(brokerConnection.dailyPnl ?? discipline.dailyPnl ?? 0);
  const dailyLossLimit = Number(profile.maxDailyLoss || 0);
  const dailyRiskRemaining = Math.max(0, dailyLossLimit + dailyPnl);
  const profitGoal = Number(profile.profitGoal || 0);
  const consistencyCap = profitGoal > 0 ? profitGoal * (Number(profile.consistencyRuleTarget || 30) / 100) : 0;

  return {
    accountBalance,
    consistencyCap,
    dailyLossLimit,
    dailyPnl,
    dailyRiskRemaining,
    drawdownFloor,
    drawdownRemaining,
    profitGoal,
  };
}

function buildFundedRuleWarnings({ brokerConnection, discipline, profile }) {
  const warnings = [];
  const position = brokerConnection.position;
  const contracts = Number(position?.contracts || 0);
  const metrics = getFundedAccountMetrics({ brokerConnection, discipline, profile });

  if (metrics.dailyLossLimit > 0 && Math.abs(metrics.dailyPnl) >= metrics.dailyLossLimit * 0.8) warnings.push("Daily loss limit approaching");
  if (metrics.drawdownRemaining <= Math.max(100, Number(profile.trailingDrawdown || 0) * 0.2)) warnings.push("Trailing drawdown risk");
  if (contracts > Number(profile.maxContracts || profile.defaultContracts)) warnings.push("Position size too large");
  if (discipline.tradesTaken >= Number(profile.maxTradesPerDay || 0)) warnings.push("Max trades reached");
  if (metrics.consistencyCap > 0 && Math.max(metrics.dailyPnl, 0) > metrics.consistencyCap) warnings.push("Consistency rule risk");
  if (warnings.length >= 2 || metrics.drawdownRemaining <= 0) warnings.push("Stop trading to protect payout");

  return [...new Set(warnings)];
}

function ConnectionsPage({
  activateManualMode,
  activateTradingViewMode,
  activePosition,
  applyAlert,
  brokerConnection,
  dataSource,
  discipline,
  engine,
  lastUpdated,
  notify,
  onAuthOpen,
  onUserTradovateAccount,
  onUserTradovateConnected,
  onUserTradovateDisconnected,
  price,
  profile,
  quote,
  saveConnectionSettings,
  session,
  setActivePage,
  startDemoBroker,
  updateProfile,
  webhookDebug,
}) {
  const [tradovateStatus, setTradovateStatus] = useState(null);
  const [tradovateAccountType, setTradovateAccountType] = useState("prop");
  const [tradovateDemoAuthStatus, setTradovateDemoAuthStatus] = useState(null);
  const [brokerModalOpen, setBrokerModalOpen] = useState(false);
  const [brokerStep, setBrokerStep] = useState(1);
  const [brokerPlatform, setBrokerPlatform] = useState("Tradovate");
  const [brokerProvider, setBrokerProvider] = useState("Lucid Trading");
  const [hasTradovateApiAccess, setHasTradovateApiAccess] = useState(false);
  const [tradingViewWizardOpen, setTradingViewWizardOpen] = useState(false);
  const [tradovateCredentials, setTradovateCredentials] = useState({
    appId: "trade-pilot",
    appVersion: "1.0",
    cid: "",
    deviceId: "tradepilot-web",
    environment: "demo",
    password: "",
    sec: "",
    username: "",
  });
  const [saveStatus, setSaveStatus] = useState("");
  const statusLabel = getConnectionStatusLabel(brokerConnection);
  const connectionMessage = getConnectionStateMessage({ brokerConnection, dataSource, profile });
  const isFunded = isFundedAccountType(profile.accountType);
  const position = brokerConnection.position || activePosition;
  const safetyWarnings = buildBrokerSafetyWarnings({ activePosition, brokerConnection, discipline, engine, profile });
  const fundedWarnings = buildFundedRuleWarnings({ brokerConnection, discipline, profile });
  const fundedMetrics = getFundedAccountMetrics({ brokerConnection, discipline, profile });

  const checkTradovateReadOnly = async () => {
    const isLucid = brokerProvider === "Lucid Trading" || profile.fundedProvider === "Lucid Trading";
    const status = {
      connected: false,
      provider: "Tradovate API",
      reads: [
        "API Access required",
        "CID required",
        "SEC required",
        "API password required",
        "Normal broker login is not enough",
      ],
      security: isLucid
        ? "Lucid does not provide Tradovate API credentials in the dashboard. Use Manual Funded Mode or TradingView Alerts."
        : "Tradovate direct connection requires API credentials from Tradovate or your provider. Use Manual Mode or TradingView Alerts until enabled.",
      tradingActionsEnabled: false,
    };
    setTradovateStatus(status);
    setTradovateDemoAuthStatus({
      connected: false,
      error: isLucid ? "Lucid does not provide Tradovate API credentials in the dashboard. Use Manual Funded Mode or TradingView Alerts." : "API Access required. CID, SEC, and API password are required; normal login is not enough.",
      message: "API plan required",
    });
    notify?.("Tradovate API plan checked");
  };

  const updateTradovateCredential = (key, value) => {
    setTradovateCredentials((current) => ({ ...current, [key]: value }));
  };

  const connectUserTradovate = async () => {
    const missingCredentialsMessage = brokerProvider === "Lucid Trading"
      ? "Lucid does not provide Tradovate API credentials in the dashboard. Use Manual Funded Mode or TradingView Alerts."
      : "Missing API credentials. Use Manual Mode or TradingView Alerts until your provider enables API access.";
    if (!hasTradovateApiAccess) {
      setTradovateDemoAuthStatus({ connected: false, error: missingCredentialsMessage, message: "API access required" });
      notify?.(missingCredentialsMessage, "failure");
      return;
    }

    if (!session?.access_token) {
      setTradovateDemoAuthStatus({
        connected: false,
        error: "Log in before connecting your Tradovate account.",
        message: "Failed",
      });
      notify?.("Log in before connecting Tradovate");
      onAuthOpen?.("login");
      return;
    }

    const missing = ["username", "password", "cid", "sec"].filter((key) => !String(tradovateCredentials[key] || "").trim());
    if (missing.length) {
      setTradovateDemoAuthStatus({ connected: false, error: missingCredentialsMessage, message: "Failed" });
      notify?.(missingCredentialsMessage, "failure");
      return;
    }

    setTradovateDemoAuthStatus({ connected: false, message: "Connecting user-owned Tradovate..." });
    try {
      const response = await fetch("/api/broker/tradovate/connect", {
        body: JSON.stringify({
          ...tradovateCredentials,
          accountType: tradovateAccountType === "prop" ? "funded" : tradovateAccountType,
          provider: brokerProvider,
          symbol: profile.mainMarket,
        }),
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok || !result.connected) throw new Error(result.error || "Tradovate connection failed.");
      setTradovateDemoAuthStatus({
        ...result,
        message: "Tradovate Connected — Read-only mode active.",
      });
      onUserTradovateConnected?.(result);
      setBrokerModalOpen(false);
      setBrokerStep(1);
      notify?.("Tradovate Connected — Read-only mode active.", "success");
      if (result.hasFunded) updateProfile("accountType", "Funded / Prop Firm Account");
    } catch (error) {
      const message = error.message || "Tradovate API access is required for direct connection. Use Manual Mode or TradingView Alerts until enabled.";
      setTradovateDemoAuthStatus({
        connected: false,
        error: message,
        message: "Failed",
      });
      notify?.("Tradovate connection failed", "failure");
    }
  };

  const activateLucidManualMode = () => {
    setBrokerModalOpen(false);
    activateManualMode();
    setBrokerProvider("Lucid Trading");
    setBrokerPlatform("Manual Mode");
    updateProfile("accountType", "Funded / Prop Firm Account");
    updateProfile("fundedProvider", "Lucid Trading");
    updateProfile("fundedPlatform", "Manual Mode");
    setTradovateDemoAuthStatus({
      connected: false,
      error: "",
      manualFallback: true,
      message: "Lucid Manual Mode active. Funded rules are enabled without broker API.",
    });
    notify?.("Lucid Manual Mode active", "success");
  };

  const activateLucidTradingViewMode = () => {
    setBrokerModalOpen(false);
    activateTradingViewMode();
    setBrokerProvider("Lucid Trading");
    setBrokerPlatform("TradingView Webhook");
    updateProfile("accountType", "Funded / Prop Firm Account");
    updateProfile("fundedProvider", "Lucid Trading");
    updateProfile("fundedPlatform", "TradingView Webhook");
    setTradovateDemoAuthStatus({
      connected: false,
      error: "",
      manualFallback: true,
      message: "TradingView Alerts setup active for Lucid. Live price, levels, bias, chart, and coach updates can come from alerts.",
    });
    notify?.("TradingView Alerts setup active");
  };

  const openTradingViewWizard = () => {
    setBrokerModalOpen(false);
    activateTradingViewMode();
    setBrokerPlatform("TradingView Webhook");
    setTradingViewWizardOpen(true);
  };

  const sendTestTradingViewSignal = async (market = "NQ", timeframe = "5m") => {
    const payload = {
      symbol: "NQ1!",
      price: 27444.25,
      timeframe: "5",
      timestamp: new Date().toISOString(),
    };
    const isLocalhost = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
    const apiBase = isLocalhost ? "https://tradepilottool.com" : "";
    const fetchJsonWithTimeout = async (url, options = {}) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`${apiBase}${url}`, {
          ...options,
          signal: controller.signal,
        });
        const text = await response.text();
        let result;
        try {
          result = text ? JSON.parse(text) : {};
        } catch {
          throw new Error("Webhook returned an unreadable response.");
        }
        return { response, result };
      } finally {
        window.clearTimeout(timeout);
      }
    };

    try {
      const { response, result } = await fetchJsonWithTimeout("/api/webhook/tradingview", {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      console.log("test signal POST result", result);
      if (!response.ok || result.ok === false) throw new Error(result.error || "TradingView webhook error");
      const { response: latestResponse, result: latest } = await fetchJsonWithTimeout("/api/webhook/tradingview/latest", {
        headers: { Accept: "application/json" },
      });
      console.log("latest signal", latest);
      if (!latestResponse.ok || latest.ok === false) throw new Error(latest.error || "Latest TradingView signal unavailable");
      if (!latest.signal) throw new Error("Latest TradingView signal was empty");
      const appliedSignal = {
        ...latest.signal,
        price: payload.price,
        symbol: payload.symbol,
        timeframe: payload.timeframe,
        timestamp: payload.timestamp,
      };
      setWebhookDebug({
        error: "",
        price: String(appliedSignal.price),
        received: "Yes",
        symbol: appliedSignal.symbol,
        updated: new Date().toLocaleTimeString(),
      });
      applyAlert?.(appliedSignal);
      setPriceStatus("TradingView signal received");
      setTradingViewWizardOpen(false);
      setActivePage("dashboard");
      notify?.("TradingView test signal received.", "success");
      return true;
    } catch (error) {
      const message = error.name === "AbortError" ? "Test signal timed out. Check your connection and try again." : error.message || "TradingView webhook error";
      console.log("test signal failed", message);
      setWebhookDebug({
        error: message,
        price: "",
        received: "No",
        symbol: payload.symbol,
        updated: new Date().toLocaleTimeString(),
      });
      setPriceStatus("Test signal failed.");
      notify?.("Test signal failed.", "failure");
      return false;
    }
  };

  const disconnectUserTradovate = async () => {
    if (!session?.access_token) {
      onUserTradovateDisconnected?.();
      return;
    }
    try {
      await fetch("/api/broker/tradovate/disconnect", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        method: "POST",
      });
    } finally {
      onUserTradovateDisconnected?.();
    }
  };

  const refreshUserTradovate = async () => {
    if (!session?.access_token) {
      notify?.("Log in before refreshing Tradovate");
      onAuthOpen?.("login");
      return;
    }
    try {
      const authHeader = { Authorization: `Bearer ${session.access_token}` };
      const [statusResponse, accountsResponse, positionsResponse, quoteResponse] = await Promise.all([
        fetch("/api/broker/tradovate/status", { headers: authHeader }),
        fetch("/api/broker/tradovate/accounts", { headers: authHeader }),
        fetch(`/api/broker/tradovate/positions?accountId=${encodeURIComponent(brokerConnection.selectedAccountId || "")}`, { headers: authHeader }),
        fetch(`/api/broker/tradovate/quote?symbol=${encodeURIComponent(profile.mainMarket)}`, { headers: authHeader }),
      ]);
      const [status, accounts, positions, quote] = await Promise.all([
        statusResponse.json(),
        accountsResponse.json(),
        positionsResponse.json(),
        quoteResponse.json(),
      ]);
      if (!statusResponse.ok) throw new Error(status.error || "Tradovate status unavailable.");
      onUserTradovateConnected?.({
        ...status,
        accounts: Array.isArray(accounts.accounts) ? accounts.accounts.map((account) => ({
          id: account.id,
          name: account.name || account.nickname || "Tradovate Account",
          type: account.accountType || account.type || status.accountType,
        })) : brokerConnection.accounts || [],
        positions: positions.positions || [],
        quote: quote.quote || null,
        selectedAccountId: brokerConnection.selectedAccountId || status.selectedAccountId,
      });
      notify?.("Tradovate refreshed");
    } catch (error) {
      setTradovateDemoAuthStatus({
        connected: false,
        error: error.message || "Tradovate refresh failed.",
        message: "Failed",
      });
      notify?.("Tradovate refresh failed", "failure");
    }
  };

  const continueBrokerFlow = () => {
    if (brokerStep < 4) {
      setBrokerStep((step) => step + 1);
      return;
    }
    if (brokerPlatform === "Manual Mode") {
      setBrokerModalOpen(false);
      activateManualMode();
      return;
    }
    if (brokerPlatform === "TradingView Webhook") {
      setBrokerModalOpen(false);
      activateTradingViewMode();
      return;
    }
    if (brokerPlatform !== "Tradovate") {
      setTradovateDemoAuthStatus({
        connected: false,
        error: `${brokerPlatform} connection is coming soon unless partner API access is available.`,
        message: "Coming soon",
      });
      notify?.(`${brokerPlatform} coming soon`);
      return;
    }
    connectUserTradovate();
  };

  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Connections" subtitle="Connect data sources or use manual mode." />
      </div>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Setup</p>
        <h2 style={styles.sectionTitle}>Choose a Connection Path</h2>
        <div style={{ ...styles.sourceGrid, marginBottom: "16px" }}>
          <button onClick={startDemoBroker} style={styles.sourceButton}>
            <strong>Demo Mode</strong>
            <span>Try simulated price, P/L, position, and chart data.</span>
          </button>
          <button onClick={activateManualMode} style={styles.sourceButton}>
            <strong>Manual Mode</strong>
            <span>Enter levels and P/L yourself.</span>
          </button>
          <button onClick={openTradingViewWizard} style={styles.sourceButton}>
            <strong>Connect TradingView Alerts</strong>
            <span>Set up alerts and send a test signal.</span>
          </button>
          <button onClick={() => setBrokerModalOpen(true)} style={styles.sourceButton}>
            <strong>Connect Broker</strong>
            <span>Advanced read-only broker connections.</span>
          </button>
        </div>
        <div style={styles.formGrid}>
          <SelectField label="Account Type" value={profile.accountType} options={accountTypeOptions} onChange={(value) => updateProfile("accountType", value)} />
          <SelectField label="Platform" value={profile.fundedPlatform} options={fundedPlatforms} onChange={(value) => updateProfile("fundedPlatform", value)} />
          {isFunded ? <SelectField label="Prop Firm" value={profile.fundedProvider} options={fundedProviders} onChange={(value) => updateProfile("fundedProvider", value)} /> : null}
          {isFunded ? <SelectField label="Account Phase" value={profile.accountPhase} options={["evaluation", "funded", "live"]} onChange={(value) => updateProfile("accountPhase", value)} /> : null}
        </div>
        <div style={{ ...styles.installBannerActions, marginTop: "16px" }}>
          <button onClick={() => {
            if (brokerProvider === "Lucid Trading" || profile.fundedProvider === "Lucid Trading") setHasTradovateApiAccess(false);
            setBrokerModalOpen(true);
          }} style={styles.settingsButton}>Connect Broker</button>
          <button onClick={activateLucidManualMode} style={styles.secondaryButton}>Use Lucid Manual Mode</button>
          <button onClick={openTradingViewWizard} style={styles.secondaryButton}>Connect TradingView Alerts</button>
          <button onClick={activateManualMode} style={styles.dismissButton}>Use Manual Mode</button>
          <button onClick={startDemoBroker} style={styles.settingsButton}>Connect Demo Broker</button>
          <button onClick={openTradingViewWizard} style={styles.dismissButton}>Connect TradingView Alerts</button>
          <button onClick={() => {
            setBrokerPlatform("Tradovate");
            setBrokerStep(4);
            if (brokerProvider === "Lucid Trading" || profile.fundedProvider === "Lucid Trading") setHasTradovateApiAccess(false);
            setBrokerModalOpen(true);
          }} style={styles.secondaryButton}>Connect Tradovate</button>
        </div>
        {tradovateDemoAuthStatus ? (
          <div style={{ ...(tradovateDemoAuthStatus.connected || tradovateDemoAuthStatus.manualFallback ? styles.coachPrompt : styles.priceWarning), marginTop: "14px" }}>
            <strong>Tradovate: {tradovateDemoAuthStatus.message}</strong>
            {tradovateDemoAuthStatus.error ? <p style={{ margin: "6px 0 0" }}>{tradovateDemoAuthStatus.error}</p> : null}
            {tradovateDemoAuthStatus.connected ? (
              <div style={{ ...styles.metricGrid, marginTop: "12px" }}>
                <Metric label="User ID" value={String(tradovateDemoAuthStatus.userId || "Connected")} />
                <Metric label="Name" value={tradovateDemoAuthStatus.name || "Demo user"} />
                <Metric label="Live" value={tradovateDemoAuthStatus.hasLive ? "Yes" : "No"} />
                <Metric label="Funded" value={tradovateDemoAuthStatus.hasFunded ? "Yes" : "No"} />
                <Metric label="Market Data" value={tradovateDemoAuthStatus.hasMarketData ? "Yes" : "No"} />
                <Metric label="Expires" value={tradovateDemoAuthStatus.expirationTime ? new Date(tradovateDemoAuthStatus.expirationTime).toLocaleTimeString() : "Unknown"} />
              </div>
            ) : null}
          </div>
        ) : null}
        <div style={{ ...styles.coachPrompt, marginTop: "16px" }}>{connectionMessage}</div>
        {dataSource === "TradingView Webhook" ? (
          <div style={{ ...styles.subPanel, marginTop: "14px" }}>
            <p style={styles.cardLabel}>Alert Message</p>
            <p style={styles.muted}>POST /api/webhook/tradingview. Required: symbol and price. Optional: support, resistance, bias, timeframe, timestamp.</p>
            <pre style={styles.sharePreview}>{JSON.stringify({
              symbol: "MNQ",
              price: 27500.25,
            }, null, 2)}</pre>
          </div>
        ) : null}
        <div style={{ ...styles.subPanel, marginTop: "14px" }}>
          <p style={styles.cardLabel}>TradingView Debug</p>
          <div style={styles.metricGrid}>
            <Metric label="Last webhook received" value={webhookDebug?.received || "No"} tone={webhookDebug?.received === "Yes" ? "good" : "warn"} />
            <Metric label="Last symbol" value={webhookDebug?.symbol || "None"} />
            <Metric label="Last price" value={webhookDebug?.price || "None"} />
            <Metric label="Last error" value={webhookDebug?.error || "None"} tone={webhookDebug?.error ? "bad" : "neutral"} />
            <Metric label="Last updated" value={webhookDebug?.updated || "Waiting"} />
          </div>
        </div>
        <button
          onClick={async () => {
            try {
              await saveConnectionSettings?.();
              notify?.("Connection saved.", "success");
              setSaveStatus("Connection settings saved.");
            } catch (error) {
              notify?.("Save failed.", "failure");
              setSaveStatus(error.message || "Save failed.");
            }
          }}
          style={{ ...styles.settingsButton, marginTop: "16px" }}
        >
          Save Connection Settings
        </button>
        {saveStatus ? <p style={{ ...styles.muted, marginTop: "10px" }}>{saveStatus}</p> : null}
      </section>

      {isFunded ? <section style={styles.card}>
        <p style={styles.cardLabel}>Funded Account</p>
        <h2 style={styles.sectionTitle}>Platform-First Setup</h2>
        <div style={styles.connectionGrid}>
          <Metric label="Provider" value={profile.fundedProvider} />
          <Metric label="Platform" value={profile.fundedPlatform} />
          <Metric label="Phase" value={profile.accountPhase} />
          <Metric label="Daily P/L" value={`$${fundedMetrics.dailyPnl.toFixed(2)}`} tone={fundedMetrics.dailyPnl >= 0 ? "good" : "bad"} />
          <Metric label="Drawdown Remaining" value={`$${fundedMetrics.drawdownRemaining.toFixed(2)}`} tone={fundedMetrics.drawdownRemaining > 500 ? "good" : "warn"} />
          <Metric label="Profit Goal" value={`$${fundedMetrics.profitGoal.toFixed(2)}`} />
        </div>
        <p style={{ ...styles.muted, marginTop: "14px" }}>Funded account rules can be tracked manually. Broker connection is optional.</p>
      </section> : null}

      <section style={styles.card}>
        <p style={styles.cardLabel}>Connection Modes</p>
        <h2 style={styles.sectionTitle}>Read-Only Platform Paths</h2>
        <div style={styles.sourceGrid}>
          <SourceOption title="Manual Funded Account" text="Track Lucid or other prop rules manually without broker API." active={isFunded && profile.fundedPlatform === "Manual Mode"} />
          <SourceOption title="Connect TradingView Alerts" text="Receives TradingView alerts with symbol, price, timeframe, support, resistance, and bias." active={dataSource === "TradingView Webhook"} />
          <SourceOption title="Tradovate API" text="Requires Tradovate API Access, API password, CID, and SEC." active={profile.fundedPlatform === "Tradovate"} />
          <SourceOption title="Demo Broker" text="Starts simulated MNQ price, position, account balance, and P/L immediately." active={brokerConnection.platform === "Demo Broker"} />
        </div>
      </section>

      {isFunded ? <section style={styles.card}>
        <p style={styles.cardLabel}>Prop Firm Settings</p>
        <h2 style={styles.sectionTitle}>Funded Risk Rules</h2>
        <div style={styles.formGrid}>
          <SelectField label="Prop Firm" value={profile.fundedProvider} options={fundedProviders} onChange={(value) => updateProfile("fundedProvider", value)} />
          <Field label="Account Size" type="number" value={profile.accountSize} onChange={(value) => updateProfile("accountSize", value)} />
          <Field label="Starting Balance" type="number" value={profile.startingBalance} onChange={(value) => updateProfile("startingBalance", value)} />
          <Field label="Trailing Drawdown" type="number" value={profile.trailingDrawdown} onChange={(value) => updateProfile("trailingDrawdown", value)} />
          <Field label="Daily Loss Limit" type="number" value={profile.maxDailyLoss} onChange={(value) => updateProfile("maxDailyLoss", value)} />
          <Field label="Profit Target" type="number" value={profile.profitGoal} onChange={(value) => updateProfile("profitGoal", value)} />
          <Field label="Max Contracts" type="number" value={profile.maxContracts} onChange={(value) => updateProfile("maxContracts", value)} />
          <Field label="Consistency Rule %" type="number" value={profile.consistencyRuleTarget} onChange={(value) => updateProfile("consistencyRuleTarget", value)} />
          <SelectField label="Platform Used" value={profile.fundedPlatform} options={fundedPlatforms} onChange={(value) => updateProfile("fundedPlatform", value)} />
          <SelectField label="Payout Protection Mode" value={profile.accountPhase} options={["evaluation", "funded", "live"]} onChange={(value) => updateProfile("accountPhase", value)} />
        </div>
        <p style={{ ...styles.muted, marginTop: "12px" }}>Funded account rules can be tracked manually. Broker connection is optional.</p>
      </section> : null}

      {isFunded ? <section style={styles.safetyCard}>
        <p style={styles.cardLabel}>Prop Firm Rule Monitor</p>
        <h2 style={styles.sectionTitle}>Protect the Payout</h2>
        <div style={styles.warningStack}>
          {(fundedWarnings.length ? fundedWarnings : ["Inside funded-account guardrails."]).map((warning) => (
            <div key={warning} style={warning.includes("Inside") ? styles.coachPrompt : styles.warningBox}>{warning}</div>
          ))}
        </div>
      </section> : null}

      <section style={styles.card}>
        <p style={styles.cardLabel}>Connection Status</p>
        <h2 style={styles.sectionTitle}>{statusLabel}</h2>
        <div style={{ ...styles.coachPrompt, marginBottom: "14px" }}>{connectionMessage}</div>
        {brokerConnection.error ? <div style={styles.priceWarning}>{brokerConnection.error}</div> : null}
        <div style={styles.connectionGrid}>
          <Metric label="Market" value={profile.mainMarket} />
          <Metric label="Account Type" value={brokerConnection.accountType || profile.accountType || "Not connected"} />
          <Metric label="Account Name" value={brokerConnection.accountName || "Hidden until connected"} />
          <Metric label="Current Price" value={Number(price).toFixed(2)} />
          <Metric label="Bid" value={Number(quote.bid || 0).toFixed(2)} />
          <Metric label="Ask" value={Number(quote.ask || 0).toFixed(2)} />
          <Metric label="Position" value={position ? position.direction.toUpperCase() : "Flat"} />
          <Metric label="Entry" value={position ? Number(position.entry || position.averagePrice || 0).toFixed(2) : "None"} />
          <Metric label="Contracts" value={String(position?.contracts ?? position?.quantity ?? 0)} />
          <Metric label="Open P/L" value={`$${Number(brokerConnection.openPnl ?? engine.openPnl ?? 0).toFixed(2)}`} tone={Number(brokerConnection.openPnl ?? 0) >= 0 ? "good" : "bad"} />
          <Metric label="Realized P/L" value={`$${Number(brokerConnection.realizedPnl || 0).toFixed(2)}`} />
          <Metric label="Daily P/L" value={`$${Number(brokerConnection.dailyPnl ?? discipline.dailyPnl ?? 0).toFixed(2)}`} />
          <Metric label="Account Balance" value={`$${Number(brokerConnection.accountBalance || profile.accountSize).toFixed(2)}`} />
          <Metric label="Data Source" value={brokerConnection.source || dataSource} />
          <Metric label="Last Updated" value={lastUpdated} />
        </div>
        {brokerConnection.platform === "Tradovate" ? (
          <div style={{ ...styles.subPanel, marginTop: "16px" }}>
            <p style={styles.cardLabel}>Connected Account</p>
            <h3 style={styles.sectionTitle}>{brokerConnection.accountName || "Tradovate Account"}</h3>
            <div style={styles.metricGrid}>
              <Metric label="Platform" value="Tradovate" />
              <Metric label="Provider" value={brokerConnection.provider || profile.fundedProvider || "Other"} />
              <Metric label="Active Account" value={brokerConnection.selectedAccountId || "Choose account"} />
              <Metric label="Mode" value="Read-only mode active" tone="good" />
              <Metric label="Market Data" value={brokerConnection.hasMarketData ? "Enabled" : "Not detected"} />
              <Metric label="Funded" value={brokerConnection.hasFunded ? "Detected" : "No"} />
            </div>
            {brokerConnection.accounts?.length ? (
              <div style={{ ...styles.sourceGrid, marginTop: "14px" }}>
                {brokerConnection.accounts.map((account) => (
                  <button
                    key={account.id || account.name}
                    onClick={() => onUserTradovateAccount?.(account)}
                    style={{ ...styles.sourceButton, borderColor: String(brokerConnection.selectedAccountId) === String(account.id) ? "#38bdf8" : "#334155" }}
                  >
                    <strong>{account.name || "Tradovate Account"}</strong>
                    <span>{String(brokerConnection.selectedAccountId) === String(account.id) ? "Active" : "Set Active"}</span>
                  </button>
                ))}
              </div>
            ) : null}
            <div style={{ ...styles.installBannerActions, marginTop: "14px" }}>
              <button onClick={() => onUserTradovateAccount?.(brokerConnection.accounts?.[0] || { id: brokerConnection.selectedAccountId, name: brokerConnection.accountName })} style={styles.settingsButton}>Set Active</button>
              <button onClick={refreshUserTradovate} style={styles.secondaryButton}>Refresh</button>
              <button onClick={disconnectUserTradovate} style={styles.secondaryButton}>Disconnect</button>
            </div>
          </div>
        ) : null}
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Phase 1</p>
        <h2 style={styles.sectionTitle}>Demo / Simulated Broker</h2>
        <p style={styles.muted}>Simulates live price, open position, entry, contracts, open P/L, realized P/L, and account balance.</p>
        <button onClick={startDemoBroker} style={{ ...styles.settingsButton, marginTop: "16px" }}>Connect Demo Broker</button>
        <div style={{ ...styles.metricGrid, marginTop: "16px" }}>
          <Metric label="Bid" value={Number(quote.bid || 0).toFixed(2)} />
          <Metric label="Ask" value={Number(quote.ask || 0).toFixed(2)} />
          <Metric label="Working Orders" value={String(brokerConnection.workingOrders?.length || 0)} />
          <Metric label="Filled Orders" value={String(brokerConnection.fills?.length || 0)} />
        </div>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Connection Options</p>
        <h2 style={styles.sectionTitle}>Read-Only Sources</h2>
        <div style={styles.sourceGrid}>
          <SourceOption title="Manual Mode" text="Use dashboard inputs, sliders, and Fast Mode without external broker data." active={dataSource === "Manual Mode"} />
          <SourceOption title="Demo / Simulated Broker" text="Connects to the local demo stream for safe testing." active={brokerConnection.platform === "Demo Broker"} />
          <SourceOption title="Tradovate Demo API" text="Connect your own demo API credentials. Secrets are encrypted server-side." active={dataSource === "Tradovate Read-Only" && brokerConnection.accountType === "demo"} />
          <SourceOption title="Tradovate Prop/Funded API" text="Connect your own funded/eval API credentials. No trading actions are implemented." active={dataSource === "Tradovate Read-Only" && brokerConnection.accountType === "funded"} />
          <SourceOption title="Tradovate Live API" text="Connect your own live API credentials with order placement disabled." active={dataSource === "Tradovate Read-Only" && brokerConnection.accountType === "live"} />
          <SourceOption title="Connect TradingView Alerts" text="Accepts symbol and price, with optional timeframe, support, resistance, bias, entry, stop, and targets." />
          <SourceOption title="CSV Import" text="Reserved for trade-history review and coaching analytics." />
        </div>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Phase 2</p>
        <h2 style={styles.sectionTitle}>Tradovate API Connection</h2>
        <p style={styles.muted}>This requires Tradovate API Access. Your normal broker login may not work. If your prop firm does not provide CID/SEC/API password, use TradingView Alerts or Manual Mode.</p>
        {brokerProvider === "Lucid Trading" || profile.fundedProvider === "Lucid Trading" ? (
          <div style={{ ...styles.priceWarning, marginTop: "12px" }}>
            Lucid does not provide Tradovate API credentials in the dashboard. Use Manual Funded Mode or TradingView Alerts.
          </div>
        ) : null}
        <div style={{ ...styles.segmentGroup, marginTop: "14px" }}>
          {[
            ["demo", "Demo"],
            ["prop", "Funded / Prop"],
            ["live", "Personal Live"],
          ].map(([mode, label]) => (
            <button key={mode} onClick={() => setTradovateAccountType(mode)} style={{ ...styles.segmentButton, background: tradovateAccountType === mode ? "#2563eb" : "#111827" }}>{label}</button>
          ))}
        </div>
        <div style={{ ...styles.installBannerActions, marginTop: "16px" }}>
          <button onClick={() => {
            setBrokerPlatform("Tradovate");
            setBrokerStep(4);
            if (brokerProvider === "Lucid Trading" || profile.fundedProvider === "Lucid Trading") setHasTradovateApiAccess(false);
            setBrokerModalOpen(true);
          }} style={styles.settingsButton}>Connect Tradovate</button>
          <button onClick={activateLucidManualMode} style={styles.secondaryButton}>Use Lucid Manual Mode</button>
          <button onClick={openTradingViewWizard} style={styles.secondaryButton}>Connect TradingView Alerts</button>
          <button onClick={checkTradovateReadOnly} style={styles.secondaryButton}>Check API Plan</button>
          <button onClick={disconnectUserTradovate} style={styles.secondaryButton}>Disconnect Tradovate</button>
        </div>
        <p style={{ ...styles.muted, marginTop: "12px" }}>
          User-owned connection stores encrypted credentials server-side per signed-in user. Read-only mode active. No order placement, cancellation, or modification endpoints are used.
        </p>
        <div style={{ ...styles.warningStack, marginTop: "14px" }}>
          <PlanItem title="Manual Funded Mode" text="Tracks daily loss, drawdown, max contracts, profit target, consistency rule, trade grade, and manual P/L without broker API access." />
          <PlanItem title="Connect TradingView Alerts" text="Feeds current price, support, resistance, bias, chart updates, and trade coach updates from alerts." />
        </div>
        <p style={{ ...styles.muted, marginTop: "12px" }}>If Tradovate API access is unavailable, use TradingView Alerts + Manual Mode. Trade Pilot will not block the dashboard.</p>
        {tradovateStatus ? (
          <div style={{ ...styles.warningStack, marginTop: "16px" }}>
            <PlanItem title="Reads" text={(tradovateStatus.reads || tradovateStatus.capabilities || []).join(", ")} />
            <PlanItem title="Security" text={tradovateStatus.security} />
            <PlanItem title="Trading Actions" text={tradovateStatus.tradingActionsEnabled === false ? "Disabled. No order placement endpoints are available." : "Disabled until explicitly approved later."} />
          </div>
        ) : null}
      </section>

      <section style={styles.safetyCard}>
        <p style={styles.cardLabel}>Phase 4</p>
        <h2 style={styles.sectionTitle}>Broker Safety Layer</h2>
        <div style={styles.warningStack}>
          {safetyWarnings.map((warning) => (
            <div key={warning} style={styles.warningBox}>{warning}</div>
          ))}
        </div>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Phase 5</p>
        <h2 style={styles.sectionTitle}>Future Approval Mode</h2>
        <PlanItem title="Manual Confirmation" text="Any future order action must require explicit user confirmation." />
        <PlanItem title="No Fully Automatic Trading" text="Autonomous order placement remains out of scope." />
        <PlanItem title="Audit Log" text="Future approvals should create a permanent action log with timestamp, user intent, and broker response." />
        <PlanItem title="Legal Disclaimers" text="Any trading action workflow must include clear risk and responsibility language." />
      </section>

      {brokerModalOpen ? (
        <BrokerConnectModal
          accountType={tradovateAccountType}
          brokerPlatform={brokerPlatform}
          brokerProvider={brokerProvider}
          brokerStep={brokerStep}
          credentials={tradovateCredentials}
          hasApiAccess={hasTradovateApiAccess}
          onAccountType={setTradovateAccountType}
          onActivateLucidManual={activateLucidManualMode}
          onActivateTradingView={openTradingViewWizard}
          onClose={() => setBrokerModalOpen(false)}
          onContinue={continueBrokerFlow}
          onCredential={updateTradovateCredential}
          onHasApiAccess={setHasTradovateApiAccess}
          onPlatform={setBrokerPlatform}
          onProvider={setBrokerProvider}
          onStep={setBrokerStep}
          status={tradovateDemoAuthStatus}
        />
      ) : null}
      {tradingViewWizardOpen ? (
        <TradingViewAlertWizard
          onClose={() => setTradingViewWizardOpen(false)}
          onSendTest={sendTestTradingViewSignal}
        />
      ) : null}
    </main>
  );
}

function TradingViewAlertWizard({ onClose, onSendTest }) {
  const [step, setStep] = useState(1);
  const [market, setMarket] = useState("NQ");
  const [timeframe, setTimeframe] = useState("5m");
  const [sendingTest, setSendingTest] = useState(false);
  const [testStatus, setTestStatus] = useState("");
  const webhookUrl = "https://tradepilottool.com/api/webhook/tradingview";
  const alertMessage = `{
 "symbol": "{{ticker}}",
 "price": {{close}},
 "timeframe": "{{interval}}",
 "timestamp": "{{timenow}}"
}`;

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Copy may be blocked in some browsers; visible text stays selectable.
    }
  };

  const handleSendTest = async () => {
    if (sendingTest) return;
    setSendingTest(true);
    setTestStatus("Sending test signal...");
    try {
      const ok = await onSendTest(market, timeframe);
      setTestStatus(ok ? "TradingView test signal received." : "Test signal failed. Check the debug panel below Connections.");
    } finally {
      setSendingTest(false);
    }
  };

  return (
    <div style={{ ...styles.modalBackdrop, zIndex: 60 }}>
      <section style={styles.modal}>
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.cardLabel}>Connect TradingView Alerts</p>
            <h2 style={styles.sectionTitle}>TradingView Setup</h2>
          </div>
          <button onClick={onClose} style={styles.dismissButton}>Close</button>
        </div>
        <div style={styles.segmentGroup}>
          {[1, 2, 3, 4, 5].map((item) => (
            <button key={item} onClick={() => setStep(item)} style={{ ...styles.segmentButton, background: step === item ? "#2563eb" : "#111827" }}>
              Step {item}
            </button>
          ))}
        </div>

        {step === 1 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 1</p>
            <h3 style={styles.sectionTitle}>Choose Market</h3>
            <div style={styles.sourceGrid}>
              {["NQ", "MNQ", "ES", "MES"].map((option) => (
                <button key={option} onClick={() => setMarket(option)} style={{ ...styles.sourceButton, borderColor: market === option ? "#38bdf8" : "#334155" }}>
                  <strong>{option}</strong>
                  <span>{marketSpecs[option]?.displayName}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 2</p>
            <h3 style={styles.sectionTitle}>Choose Timeframe</h3>
            <div style={styles.sourceGrid}>
              {["1m", "5m", "15m"].map((option) => (
                <button key={option} onClick={() => setTimeframe(option)} style={{ ...styles.sourceButton, borderColor: timeframe === option ? "#38bdf8" : "#334155" }}>
                  <strong>{option}</strong>
                  <span>TradingView alert timeframe</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 3</p>
            <h3 style={styles.sectionTitle}>Webhook URL</h3>
            <pre style={styles.sharePreview}>{webhookUrl}</pre>
            <button onClick={() => copyText(webhookUrl)} style={styles.settingsButton}>Copy URL</button>
          </section>
        ) : null}

        {step === 4 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 4</p>
            <h3 style={styles.sectionTitle}>Alert Message</h3>
            <pre style={styles.sharePreview}>{alertMessage}</pre>
            <button onClick={() => copyText(alertMessage)} style={styles.settingsButton}>Copy Alert Message</button>
          </section>
        ) : null}

        {step === 5 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 5</p>
            <h3 style={styles.sectionTitle}>Test and Open TradingView</h3>
            <div style={styles.installBannerActions}>
              <button disabled={sendingTest} onClick={handleSendTest} style={{ ...styles.settingsButton, opacity: sendingTest ? 0.7 : 1 }}>
                {sendingTest ? "Sending..." : "Send Test Signal"}
              </button>
              <button onClick={() => window.open("https://www.tradingview.com/chart/", "_blank", "noopener,noreferrer")} style={styles.secondaryButton}>Open TradingView</button>
            </div>
            {testStatus ? (
              <div style={{ ...styles.coachPrompt, marginTop: "12px" }}>{testStatus}</div>
            ) : null}
            <p style={{ ...styles.muted, marginTop: "12px" }}>The test signal updates the dashboard instantly with symbol and price only.</p>
          </section>
        ) : null}

        <div style={{ ...styles.installBannerActions, marginTop: "18px" }}>
          {step > 1 ? <button onClick={() => setStep((current) => current - 1)} style={styles.secondaryButton}>Back</button> : null}
          {step < 5 ? <button onClick={() => setStep((current) => current + 1)} style={styles.settingsButton}>Continue</button> : null}
        </div>
      </section>
    </div>
  );
}

function BrokerConnectModal({
  accountType,
  brokerPlatform,
  brokerProvider,
  brokerStep,
  credentials,
  hasApiAccess,
  onAccountType,
  onActivateLucidManual,
  onActivateTradingView,
  onClose,
  onContinue,
  onCredential,
  onHasApiAccess,
  onPlatform,
  onProvider,
  onStep,
  status,
}) {
  const platformOptions = ["Tradovate", "NinjaTrader", "Rithmic", "TopstepX", "Manual Mode", "TradingView Webhook"];
  const accountOptions = [
    ["demo", "Demo"],
    ["live", "Personal Live"],
    ["prop", "Funded / Eval"],
    ["funded-live", "Funded Live"],
  ];
  const providerOptions = ["Lucid Trading", "Apex", "Topstep", "Take Profit Trader", "MyFundedFutures", "Other"];
  const nextLabel = brokerStep < 4 ? "Continue" : brokerPlatform === "Tradovate" ? "Connect Tradovate" : "Activate";

  return (
    <div style={{ ...styles.modalBackdrop, zIndex: 55 }}>
      <section style={styles.modal}>
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.cardLabel}>Broker Connect</p>
            <h2 style={styles.sectionTitle}>Connect Broker</h2>
          </div>
          <button onClick={onClose} style={styles.dismissButton}>Close</button>
        </div>
        <div style={styles.segmentGroup}>
          {[1, 2, 3, 4].map((step) => (
            <button
              key={step}
              onClick={() => onStep(step)}
              style={{ ...styles.segmentButton, background: brokerStep === step ? "#2563eb" : "#111827" }}
            >
              Step {step}
            </button>
          ))}
        </div>

        {brokerStep === 1 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 1</p>
            <h3 style={styles.sectionTitle}>Choose Platform</h3>
            <div style={styles.sourceGrid}>
              {platformOptions.map((platform) => (
                <button
                  key={platform}
                  onClick={() => onPlatform(platform)}
                  style={{ ...styles.sourceButton, borderColor: brokerPlatform === platform ? "#38bdf8" : "#334155" }}
                >
                  <strong>{platform === "TradingView Webhook" ? "Connect TradingView Alerts" : platform}</strong>
                  <span>{platform === "Tradovate" ? "Read-only API connection" : platform === "Manual Mode" || platform === "TradingView Webhook" ? "Works now" : "Coming soon"}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {brokerStep === 2 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 2</p>
            <h3 style={styles.sectionTitle}>Choose Account Type</h3>
            <div style={styles.sourceGrid}>
              {accountOptions.map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => onAccountType(value)}
                  style={{ ...styles.sourceButton, borderColor: accountType === value ? "#38bdf8" : "#334155" }}
                >
                  <strong>{label}</strong>
                  <span>Read-only dashboard mode</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {brokerStep === 3 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 3</p>
            <h3 style={styles.sectionTitle}>Choose Provider</h3>
            <div style={styles.sourceGrid}>
              {providerOptions.map((provider) => (
                <button
                  key={provider}
                  onClick={() => {
                    onProvider(provider);
                    if (provider === "Lucid Trading") onHasApiAccess(false);
                  }}
                  style={{ ...styles.sourceButton, borderColor: brokerProvider === provider ? "#38bdf8" : "#334155" }}
                >
                  <strong>{provider}</strong>
                  <span>{provider === "Other" ? "Manual provider" : "Funded/prop rule profile"}</span>
                </button>
              ))}
            </div>
            {brokerProvider === "Lucid Trading" ? (
              <div style={{ ...styles.priceWarning, marginTop: "14px" }}>
                Lucid does not provide Tradovate API credentials in the dashboard. Use Manual Funded Mode or TradingView Alerts.
              </div>
            ) : null}
          </section>
        ) : null}

        {brokerStep === 4 ? (
          <section style={styles.subPanel}>
            <p style={styles.cardLabel}>Step 4</p>
            <h3 style={styles.sectionTitle}>Connect</h3>
            {brokerPlatform === "Tradovate" ? (
              <>
                <h4 style={{ ...styles.sectionTitle, fontSize: "20px" }}>Tradovate API Connection</h4>
                <p style={styles.muted}>This requires Tradovate API Access. Your normal broker login may not work. If your prop firm does not provide CID/SEC/API password, use TradingView Alerts or Manual Mode.</p>
                {brokerProvider === "Lucid Trading" ? (
                  <div style={{ ...styles.priceWarning, marginTop: "14px" }}>
                    Lucid does not provide Tradovate API credentials in the dashboard. Use Manual Funded Mode or TradingView Alerts.
                  </div>
                ) : null}
                <div style={{ ...styles.installBannerActions, marginTop: "16px" }}>
                  <button onClick={onActivateLucidManual} style={styles.secondaryButton}>Use Lucid Manual Mode</button>
                  <button onClick={onActivateTradingView} style={styles.secondaryButton}>Connect TradingView Alerts</button>
                  <button onClick={() => onHasApiAccess(true)} style={hasApiAccess ? styles.settingsButton : styles.secondaryButton}>I Have Advanced API Credentials</button>
                </div>
                <div style={{ ...styles.coachPrompt, marginTop: "14px" }}>
                  API Access required. CID required. SEC required. API password required. Normal login is not enough.
                </div>
                {hasApiAccess ? (
                  <div style={{ ...styles.formGrid, marginTop: "16px" }}>
                    <Field label="Username" value={credentials.username} onChange={(value) => onCredential("username", value)} />
                    <Field label="API Password" type="password" value={credentials.password} onChange={(value) => onCredential("password", value)} />
                    <Field label="CID" value={credentials.cid} onChange={(value) => onCredential("cid", value)} />
                    <Field label="SEC" type="password" value={credentials.sec} onChange={(value) => onCredential("sec", value)} />
                    <Field label="App ID" value={credentials.appId} onChange={(value) => onCredential("appId", value)} />
                    <Field label="App Version" value={credentials.appVersion} onChange={(value) => onCredential("appVersion", value)} />
                    <Field label="Device ID" value={credentials.deviceId} onChange={(value) => onCredential("deviceId", value)} />
                    <SelectField label="Environment" value={credentials.environment} options={["demo", "live"]} onChange={(value) => onCredential("environment", value)} />
                  </div>
                ) : null}
              </>
            ) : (
              <p style={styles.muted}>
                {brokerPlatform === "Manual Mode" || brokerPlatform === "TradingView Webhook"
                  ? `${brokerPlatform} can be activated without broker credentials.`
                  : `${brokerPlatform} is coming soon unless API partner access is available.`}
              </p>
            )}
          </section>
        ) : null}

        {status?.error ? <div style={{ ...styles.priceWarning, marginTop: "14px" }}>{status.error}</div> : null}
        {status?.connected ? <div style={{ ...styles.coachPrompt, marginTop: "14px" }}>Tradovate Connected — Read-only mode active.</div> : null}

        <div style={{ ...styles.installBannerActions, marginTop: "18px" }}>
          {brokerStep > 1 ? <button onClick={() => onStep(brokerStep - 1)} style={styles.secondaryButton}>Back</button> : null}
          <button onClick={onContinue} style={styles.settingsButton}>{nextLabel}</button>
        </div>
      </section>
    </div>
  );
}

function DataSourcePage({ applyAlert }) {
  const [webhookText, setWebhookText] = useState('{"symbol":"MNQ","price":27500.25,"timeframe":"5m","support":27460,"resistance":27550,"bias":"bullish","timestamp":"2026-04-28T14:30:00.000Z"}');
  const [brokerText, setBrokerText] = useState(JSON.stringify(brokerSamplePayload, null, 2));
  const [brokerStatus, setBrokerStatus] = useState(null);
  const [message, setMessage] = useState("Broker trading is disabled. Trade Pilot only reads data and coaches execution.");

  const applyWebhookPreview = () => {
    try {
      const parsed = JSON.parse(webhookText);
      applyAlert({
        symbol: parsed.symbol,
        price: Number(parsed.price),
        direction: parsed.direction,
        bias: parsed.bias,
        support: Number(parsed.support),
        resistance: Number(parsed.resistance),
        timestamp: parsed.timestamp,
        signalType: parsed.signalType || parsed.bias,
      });
    } catch {
      setMessage("Webhook preview must be valid JSON.");
    }
  };

  const syncBrokerPreview = async () => {
    try {
      const parsed = JSON.parse(brokerText);
      const response = await fetch(`${marketServerUrl}/api/broker/sync`, {
        body: JSON.stringify(parsed),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Broker sync failed.");
      setBrokerStatus(result.snapshot);
      setMessage("Broker snapshot synced. Choose Broker Connection on the dashboard to stream it live.");
    } catch (error) {
      setMessage(error.message || "Broker payload must be valid JSON.");
    }
  };

  return (
    <main style={styles.mainGrid}>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Connect Data Source</p>
        <h2 style={styles.sectionTitle}>Read-Only Modes</h2>
        <div style={styles.sourceGrid}>
          <SourceOption title="Manual Mode" text="Use sliders and Fast Mode buttons during live execution." active />
          <SourceOption title="Connect TradingView Alerts" text="Alerts can send symbol, price, timeframe, support, resistance, bias, and timestamp." />
          <SourceOption title="Market Data API" text="Uses the local read-only market server at 127.0.0.1:8787 for streaming prices." />
          <SourceOption title="Tradovate Prop/Funded Read-Only" text="Reads live prop account data when API access is enabled. No order placement." />
          <SourceOption title="CSV Upload" text="Planned manual trade-history import for review and coaching analytics." />
        </div>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Broker Connection</p>
        <h2 style={styles.sectionTitle}>Local Read-Only Bridge</h2>
        <p style={styles.muted}>A brokerage or platform adapter can post snapshots here. Trade Pilot reads positions and fills for coaching; it never sends orders.</p>
        <textarea value={brokerText} onChange={(event) => setBrokerText(event.target.value)} style={styles.textArea} />
        <button onClick={syncBrokerPreview} style={styles.settingsButton}>Sync Broker Snapshot</button>
        {brokerStatus ? (
          <div style={{ ...styles.metricGrid, marginTop: "14px" }}>
            <Metric label="Platform" value={brokerStatus.platform} />
            <Metric label="Account" value={brokerStatus.accountId || "Read-only"} />
            <Metric label="Position" value={brokerStatus.position ? `${brokerStatus.position.direction.toUpperCase()} ${brokerStatus.position.contracts} ${brokerStatus.position.symbol}` : "Flat"} />
            <Metric label="Updated" value={brokerStatus.updatedAt ? new Date(brokerStatus.updatedAt).toLocaleTimeString() : "Pending"} />
          </div>
        ) : null}
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Connect TradingView Alerts</p>
        <h2 style={styles.sectionTitle}>Local Preview</h2>
        <p style={styles.muted}>Paste a sample alert message to populate the dashboard.</p>
        <textarea value={webhookText} onChange={(event) => setWebhookText(event.target.value)} style={styles.textArea} />
        <button onClick={applyWebhookPreview} style={styles.settingsButton}>Apply Alert Preview</button>
        <p style={{ ...styles.muted, marginTop: "12px" }}>{message}</p>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Broker/Platform Plan</p>
        <h2 style={styles.sectionTitle}>Safety-First Integrations</h2>
        <PlanItem title="Tradovate API" text="Use an adapter to post read-only account, position, and fill data into the local bridge." />
        <PlanItem title="NinjaTrader Add-on/Export" text="A local add-on can post snapshots while the platform keeps order control." />
        <PlanItem title="Rithmic / Prop Firm Data" text="Use approved read data only, based on the platform and firm rules." />
        <PlanItem title="CSV / Manual Import" text="Start with uploadable trade history for review and analytics." />
      </section>

      <section style={styles.safetyCard}>
        <p style={styles.cardLabel}>Safety Lock</p>
        <h2 style={styles.sectionTitle}>Auto-Trading Disabled</h2>
        <p style={styles.coachMessage}>Trade Pilot will not place trades automatically.</p>
        <p style={styles.muted}>This app is an execution assistant first: read trade and price data, detect active positions, and coach decisions.</p>
      </section>
    </main>
  );
}

function KeyLevelCoach({
  breakoutLevel,
  coach,
  currentPrice,
  marketBias,
  pullbackSupport,
  recentHigh,
  rangeMax,
  rangeMin,
  setBreakoutLevel,
  setMarketBias,
  setPullbackSupport,
  setRecentHigh,
}) {
  detectKeyLevelsFromCandles([]);

  return (
    <section style={styles.levelCoachGrid}>
      <div style={styles.card}>
        <p style={styles.cardLabel}>Key Level Detection</p>
        <h2 style={styles.sectionTitle}>Manual Levels</h2>
        <div style={styles.formGrid}>
          <Control label="Recent High / Resistance" tooltip={tooltipText.resistance} value={recentHigh} setValue={setRecentHigh} min={rangeMin} max={rangeMax} />
          <Control label="Pullback Support" tooltip={tooltipText.support} value={pullbackSupport} setValue={setPullbackSupport} min={rangeMin} max={rangeMax} />
          <Control label="Breakout Level" tooltip={tooltipText.breakout} value={breakoutLevel} setValue={setBreakoutLevel} min={rangeMin} max={rangeMax} />
          <SelectField label="Market Bias" value={marketBias} options={["bullish", "bearish", "neutral"]} onChange={setMarketBias} />
        </div>
      </div>

      <div style={styles.levelActionCard}>
        <p style={styles.cardLabel}>Pullback Coach</p>
        <h2 style={styles.actionText}>{coach.action}</h2>
        <p style={styles.coachMessage}>{coach.marketState}</p>
        <p style={styles.muted}>{coach.message}</p>
      </div>

      <div style={styles.card}>
        <p style={styles.cardLabel}>Support / Resistance Guidance</p>
        <PlanItem title="Resistance" text="Recent high where price rejected." />
        <PlanItem title="Support" text="Prior breakout area or recent low where buyers defended." />
        <PlanItem title="Middle zone" text="Bad entry area. Wait for a level, pullback, breakout, or retest." />
      </div>

      <div style={styles.card}>
        <p style={styles.cardLabel}>Trade Plan Generator</p>
        <h2 style={styles.sectionTitle}>Simple Plan</h2>
        <div style={styles.metricGrid}>
          <Metric label="Current Price" tooltip={tooltipText.currentPrice} value={currentPrice.toFixed(2)} />
          <Metric label="Entry Zone" tooltip={tooltipText.retest} value={coach.plan.entry} />
          <Metric label="Stop Loss" tooltip={tooltipText.stopLoss} value={coach.plan.stop} />
          <Metric label="Target 1" tooltip={tooltipText.target} value={coach.plan.target1} />
          <Metric label="Target 2 / Runner" tooltip={tooltipText.runner} value={coach.plan.target2} />
        </div>
      </div>
    </section>
  );
}

function JournalPage({ activePosition, addJournalEntry, engine, discipline, journalEntries }) {
  const [note, setNote] = useState("");
  const safeJournalEntries = safeArray(journalEntries);
  const submit = (event) => {
    event.preventDefault();
    if (!note.trim()) return;
    addJournalEntry(note.trim());
    setNote("");
  };

  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Journal" subtitle="Track trades and notes." />
      </div>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Journal</p>
        <h2 style={styles.sectionTitle}>Today&apos;s Execution Snapshot</h2>
        <div style={styles.metricGrid}>
          <Metric label="Trades Taken" value={String(discipline.tradesTaken)} />
          <Metric label="Daily P/L" value={`$${discipline.dailyPnl.toFixed(2)}`} tone={discipline.dailyPnl >= 0 ? "good" : "bad"} />
          <Metric label="Trade Score" value={`${engine.score}/100`} />
          <Metric label="Suggested Action" value={engine.suggestedAction} tone={engine.actionTone} />
        </div>
      </section>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Active Notes</p>
        <h2 style={styles.sectionTitle}>{activePosition ? "Position Context" : "No Active Position"}</h2>
        <p style={styles.muted}>
          {activePosition
            ? `${activePosition.direction.toUpperCase()} from ${activePosition.entry}. Last action: ${activePosition.lastAction}.`
            : "Use Fast Mode or dashboard inputs to create an execution context for review."}
        </p>
      </section>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Personal Journal</p>
        <h2 style={styles.sectionTitle}>Save Trade Notes</h2>
        <form onSubmit={submit}>
          <textarea style={styles.textArea} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What did you see? What did you do well? What needs work?" />
          <button style={styles.settingsButton}>Save Journal Entry</button>
        </form>
        <div style={{ ...styles.warningStack, marginTop: "16px" }}>
          {safeJournalEntries.slice(0, 8).map((entry) => (
            <PlanItem key={entry.id || entry.stamp} title={new Date(entry.stamp).toLocaleString()} text={`${entry.market || ""} ${entry.note || ""}`} />
          ))}
        </div>
      </section>
    </main>
  );
}

function ProfilePage({ profile, updateProfile }) {
  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Profile" subtitle="Trading preferences and account setup." />
      </div>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Profile</p>
        <h2 style={styles.sectionTitle}>Trader Settings</h2>
        <p style={{ ...styles.muted, marginBottom: "18px" }}>Saved locally on this device, and synced to your personal dashboard when signed in.</p>
        <ProfileFields profile={profile} updateProfile={updateProfile} />
      </section>
    </main>
  );
}

function ProfileFields({ profile, updateProfile }) {
  const accountType = normalizeAccountType(profile.accountType);
  const isFunded = isFundedAccountType(accountType);

  return (
    <>
      <div style={styles.formGrid}>
        <Field label="Name" value={profile.traderName} onChange={(value) => updateProfile("traderName", value)} />
        <SelectField label="Experience Level" value={profile.traderExperienceLevel || "intermediate"} options={["beginner", "intermediate", "advanced"]} onChange={(value) => updateProfile("traderExperienceLevel", value)} />
        <SelectField label="Trader Style" value={profile.traderStyle} options={["scalper", "runner", "both"]} onChange={(value) => updateProfile("traderStyle", value)} />
        <SelectField label="Main Market" value={profile.mainMarket} options={["MNQ", "NQ", "ES"]} onChange={(value) => updateProfile("mainMarket", value)} />
        <SelectField label="Account Type" value={accountType} options={accountTypeOptions} onChange={(value) => updateProfile("accountType", value)} />
        <SelectField label="Platform" value={profile.fundedPlatform} options={fundedPlatforms} onChange={(value) => updateProfile("fundedPlatform", value)} />
        <Field label="Account Size" type="number" value={profile.accountSize} onChange={(value) => updateProfile("accountSize", value)} />
        <Field label="Starting Balance" type="number" value={profile.startingBalance} onChange={(value) => updateProfile("startingBalance", value)} />
        <Field label="Max Risk Per Trade" type="number" value={profile.maxRiskPerTrade} onChange={(value) => updateProfile("maxRiskPerTrade", value)} />
        <Field label="Max Trades Per Day" type="number" value={profile.maxTradesPerDay} onChange={(value) => updateProfile("maxTradesPerDay", value)} />
        <Field label="Max Contracts" type="number" value={profile.maxContracts} onChange={(value) => updateProfile("maxContracts", value)} />
        <Field label="Default Contracts" type="number" value={profile.defaultContracts} onChange={(value) => updateProfile("defaultContracts", value)} />
        <Field label="Default Risk Points" type="number" value={profile.defaultRiskPoints} onChange={(value) => updateProfile("defaultRiskPoints", value)} />
        <Field label="Trim 1 Points" type="number" value={profile.trim1Points} onChange={(value) => updateProfile("trim1Points", value)} />
        <Field label="Trim 2 Points" type="number" value={profile.trim2Points} onChange={(value) => updateProfile("trim2Points", value)} />
        <Field label="Runner Points" type="number" value={profile.runnerPoints} onChange={(value) => updateProfile("runnerPoints", value)} />
      </div>
      {isFunded ? (
        <section style={styles.subPanel}>
          <p style={styles.cardLabel}>Prop Firm Rules</p>
          <h2 style={styles.sectionTitle}>Funded Account</h2>
          <div style={styles.formGrid}>
            <SelectField label="Funded Provider" value={profile.fundedProvider} options={fundedProviders} onChange={(value) => updateProfile("fundedProvider", value)} />
            <SelectField label="Account Phase" value={profile.accountPhase} options={["evaluation", "funded", "live"]} onChange={(value) => updateProfile("accountPhase", value)} />
            <Field label="Trailing Drawdown" type="number" value={profile.trailingDrawdown} onChange={(value) => updateProfile("trailingDrawdown", value)} />
            <Field label="Profit Goal" type="number" value={profile.profitGoal} onChange={(value) => updateProfile("profitGoal", value)} />
            <Field label="Consistency Rule Target %" type="number" value={profile.consistencyRuleTarget} onChange={(value) => updateProfile("consistencyRuleTarget", value)} />
            <Field label="Max Daily Loss" type="number" value={profile.maxDailyLoss} onChange={(value) => updateProfile("maxDailyLoss", value)} />
            <Field label="Max Contracts" type="number" value={profile.maxContracts} onChange={(value) => updateProfile("maxContracts", value)} />
          </div>
        </section>
      ) : null}
      <label style={styles.switchRow}>
        <input type="checkbox" checked={profile.voiceAlerts} onChange={(event) => updateProfile("voiceAlerts", event.target.checked)} />
        Voice alerts on/off
      </label>
      <label style={styles.switchRow}>
        <input type="checkbox" checked={profile.soundAlerts !== false} onChange={(event) => updateProfile("soundAlerts", event.target.checked)} />
        Sound alerts on/off
      </label>
    </>
  );
}

function HelpPage() {
  const topics = [
    ["Support and Resistance", "Support is an area where buyers have shown interest before. Resistance is an area where sellers have pushed back before. These zones help you decide where a trade idea is strong or weak."],
    ["Risk Management", "Risk management means knowing how much you can lose before you enter. Trade Pilot compares your stop, contracts, and account limits so one trade does not become an account problem."],
    ["Stop Loss Placement", "A stop should usually sit beyond a structure level, not at a random number. For a long trade, that often means below support. For a short trade, that often means above resistance."],
    ["Trimming Profits", "Trimming means taking partial profit while keeping part of the trade open. It can reduce pressure and help you follow the plan after the first target hits."],
    ["Runner Contracts", "A runner is the final piece of a position that stays open for a larger move. It works best after risk has been reduced and the trade has room to continue."],
    ["How Trade Pilot Helps Manage Trades", "Trade Pilot organizes price, levels, risk, targets, discipline limits, and coaching prompts in one place so you can make calmer execution decisions."],
  ];

  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Help" subtitle="Learn the trading concepts behind Trade Pilot." />
      </div>
      {topics.map(([title, text]) => (
        <section key={title} style={styles.card}>
          <p style={styles.cardLabel}>Education</p>
          <h2 style={styles.sectionTitle}>{title}</h2>
          <p style={styles.muted}>{text}</p>
        </section>
      ))}
    </main>
  );
}

function SupportPage({ messages, onSubmit }) {
  const [form, setForm] = useState({ name: "", email: "", message: "" });

  const submit = (event) => {
    event.preventDefault();
    if (!form.message.trim()) return;
    onSubmit(form);
    setForm({ name: "", email: "", message: "" });
  };

  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Support" subtitle="Contact support or send feedback." />
      </div>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Support</p>
        <h2 style={styles.sectionTitle}>Contact Trade Pilot</h2>
        <p style={styles.muted}>Email: <a style={styles.link} href="mailto:support@tradepilot.app">support@tradepilot.app</a></p>
        <form onSubmit={submit} style={{ ...styles.warningStack, marginTop: "18px" }}>
          <Field label="Name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <Field label="Email" value={form.email} onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
          <label style={styles.field}>
            <span>Message</span>
            <textarea style={styles.textArea} value={form.message} onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} />
          </label>
          <button style={styles.settingsButton}>Submit Support Request</button>
        </form>
      </section>
      <section style={styles.card}>
        <p style={styles.cardLabel}>FAQ</p>
        <PlanItem title="How do I use Trade Pilot?" text="Set your market, price, levels, direction, risk, and contracts. Use the score, coach, and guardrails to decide whether to wait, manage, or exit." />
        <PlanItem title="How does the trade score work?" text="The score blends location, chop, direction, risk, reward-to-risk, distance from entry, and contract size." />
        <PlanItem title="Does Trade Pilot place trades automatically?" text="No. Trade Pilot only assists execution. It does not send broker orders." />
        <PlanItem title="Recent local support requests" text={messages.length ? `${messages.length} saved on this device.` : "No local support messages yet."} />
      </section>
    </main>
  );
}

function SettingsPage({ applyAlert, profile, updateProfile }) {
  const [settingsTab, setSettingsTab] = useState("General");
  const accountType = normalizeAccountType(profile.accountType);
  const isFunded = isFundedAccountType(accountType);
  const tabs = ["General", "Risk Guardrails", "Funded Account", "Trade Defaults", "Alerts"];

  return (
    <main style={styles.mainGrid}>
      <div style={styles.fullWidthSection}>
        <PageTitle title="Settings" subtitle="Customize Trade Pilot." />
      </div>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Settings</p>
        <h2 style={styles.sectionTitle}>Customize Trade Pilot</h2>
        <div style={styles.segmentGroup}>
          {tabs.map((tab) => (
            <button key={tab} onClick={() => setSettingsTab(tab)} style={{ ...styles.segmentButton, background: settingsTab === tab ? "#2563eb" : "#111827" }}>{tab}</button>
          ))}
        </div>
        {settingsTab === "General" ? (
          <div style={styles.formGrid}>
            <Field label="Name" value={profile.traderName} onChange={(value) => updateProfile("traderName", value)} />
            <SelectField label="Experience Level" value={profile.traderExperienceLevel || "intermediate"} options={["beginner", "intermediate", "advanced"]} onChange={(value) => updateProfile("traderExperienceLevel", value)} />
            <SelectField label="Trader Style" value={profile.traderStyle} options={["scalper", "runner", "both"]} onChange={(value) => updateProfile("traderStyle", value)} />
            <SelectField label="Main Market" value={profile.mainMarket} options={["MNQ", "NQ", "ES"]} onChange={(value) => updateProfile("mainMarket", value)} />
            <SelectField label="Account Type" value={accountType} options={accountTypeOptions} onChange={(value) => updateProfile("accountType", value)} />
            <SelectField label="Platform" value={profile.fundedPlatform} options={fundedPlatforms} onChange={(value) => updateProfile("fundedPlatform", value)} />
            <Field label="Account Size" type="number" value={profile.accountSize} onChange={(value) => updateProfile("accountSize", value)} />
            <Field label="Starting Balance" type="number" value={profile.startingBalance} onChange={(value) => updateProfile("startingBalance", value)} />
          </div>
        ) : null}
        {settingsTab === "Risk Guardrails" ? (
          <div style={styles.formGrid}>
            <Field label="Max Risk Per Trade" type="number" value={profile.maxRiskPerTrade} onChange={(value) => updateProfile("maxRiskPerTrade", value)} />
            <Field label="Max Trades Per Day" type="number" value={profile.maxTradesPerDay} onChange={(value) => updateProfile("maxTradesPerDay", value)} />
            <Field label="Max Contracts" type="number" value={profile.maxContracts} onChange={(value) => updateProfile("maxContracts", value)} />
            {isFunded ? <Field label="Max Daily Loss" type="number" value={profile.maxDailyLoss} onChange={(value) => updateProfile("maxDailyLoss", value)} /> : null}
          </div>
        ) : null}
        {settingsTab === "Funded Account" ? (
          isFunded ? (
            <>
              <p style={styles.cardLabel}>Prop Firm Rules</p>
              <div style={styles.formGrid}>
                <SelectField label="Funded Provider" value={profile.fundedProvider} options={fundedProviders} onChange={(value) => updateProfile("fundedProvider", value)} />
                <SelectField label="Account Phase" value={profile.accountPhase} options={["evaluation", "funded", "live"]} onChange={(value) => updateProfile("accountPhase", value)} />
                <Field label="Account Size" type="number" value={profile.accountSize} onChange={(value) => updateProfile("accountSize", value)} />
                <Field label="Starting Balance" type="number" value={profile.startingBalance} onChange={(value) => updateProfile("startingBalance", value)} />
                <Field label="Trailing Drawdown" type="number" value={profile.trailingDrawdown} onChange={(value) => updateProfile("trailingDrawdown", value)} />
                <Field label="Profit Goal" type="number" value={profile.profitGoal} onChange={(value) => updateProfile("profitGoal", value)} />
                <Field label="Consistency Rule Target %" type="number" value={profile.consistencyRuleTarget} onChange={(value) => updateProfile("consistencyRuleTarget", value)} />
                <Field label="Max Daily Loss" type="number" value={profile.maxDailyLoss} onChange={(value) => updateProfile("maxDailyLoss", value)} />
                <Field label="Max Contracts" type="number" value={profile.maxContracts} onChange={(value) => updateProfile("maxContracts", value)} />
              </div>
            </>
          ) : (
            <p style={styles.muted}>Switch Account Type to Funded / Prop Firm Account to track prop firm rules.</p>
          )
        ) : null}
        {settingsTab === "Trade Defaults" ? (
          <div style={styles.formGrid}>
            <Field label="Default Contracts" type="number" value={profile.defaultContracts} onChange={(value) => updateProfile("defaultContracts", value)} />
            <Field label="Default Risk Points" type="number" value={profile.defaultRiskPoints} onChange={(value) => updateProfile("defaultRiskPoints", value)} />
            <Field label="Trim 1 Points" type="number" value={profile.trim1Points} onChange={(value) => updateProfile("trim1Points", value)} />
            <Field label="Trim 2 Points" type="number" value={profile.trim2Points} onChange={(value) => updateProfile("trim2Points", value)} />
            <Field label="Runner Points" type="number" value={profile.runnerPoints} onChange={(value) => updateProfile("runnerPoints", value)} />
          </div>
        ) : null}
        {settingsTab === "Alerts" ? (
          <div style={styles.warningStack}>
            <label style={styles.switchRow}>
              <input type="checkbox" checked={profile.voiceAlerts} onChange={(event) => updateProfile("voiceAlerts", event.target.checked)} />
              Voice alerts on/off
            </label>
            <label style={styles.switchRow}>
              <input type="checkbox" checked={profile.soundAlerts !== false} onChange={(event) => updateProfile("soundAlerts", event.target.checked)} />
              Sound alerts on/off
            </label>
          </div>
        ) : null}
      </section>
      <DataSourcePage applyAlert={applyAlert} />
      <section style={styles.card}>
        <p style={styles.cardLabel}>Future Compatibility</p>
        <h2 style={styles.sectionTitle}>Planned Infrastructure</h2>
        <PlanItem title="User Login" text="Reserved for future account identity and syncing." />
        <PlanItem title="Supabase Authentication" text="Can be added later without changing the local dashboard model." />
        <PlanItem title="Paid Subscriptions" text="Subscription gates can wrap premium pages and advanced analytics." />
        <PlanItem title="TradingView Alerts" text="The current alert message is structured for server-side alert handling." />
        <PlanItem title="Broker Data Connections" text="Connections should remain read-only until safety, compliance, and user controls are complete." />
      </section>
    </main>
  );
}

function FeedbackModal({ onClose, onSubmit }) {
  const [feedback, setFeedback] = useState({ type: "Idea", message: "" });

  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.cardLabel}>Feedback</p>
            <h2 style={styles.sectionTitle}>Help Improve Trade Pilot</h2>
          </div>
          <button onClick={onClose} style={styles.closeButton}>Close</button>
        </div>
        <div style={styles.formGrid}>
          <SelectField label="Type" value={feedback.type} options={["Idea", "Bug", "Confusing", "Feature Request"]} onChange={(value) => setFeedback((current) => ({ ...current, type: value }))} />
        </div>
        <label style={{ ...styles.field, marginTop: "14px" }}>
          <span>Feedback</span>
          <textarea style={styles.textArea} value={feedback.message} onChange={(event) => setFeedback((current) => ({ ...current, message: event.target.value }))} />
        </label>
        <button onClick={() => feedback.message.trim() && onSubmit(feedback)} style={styles.settingsButton}>Send Feedback</button>
      </div>
    </div>
  );
}

function SourceOption({ title, text, active }) {
  return (
    <div style={{ ...styles.sourceOption, borderColor: active ? "#38bdf8" : "#27272a" }}>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function AlphaSignup() {
  const [form, setForm] = useState({ email: "", market: "MNQ", traderType: "intermediate" });
  const [status, setStatus] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    const email = form.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus("Enter a valid email.");
      return;
    }

    const payload = { ...form, email, timestamp: new Date().toISOString() };

    try {
      const response = await fetch(`${marketServerUrl}/api/subscribe`, {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Subscriber endpoint unavailable.");
    } catch {
      const saved = loadList(subscriberStorageKey);
      localStorage.setItem(subscriberStorageKey, JSON.stringify([payload, ...saved]));
    }

    setForm((current) => ({ ...current, email: "" }));
    setStatus("You're on the Trade Pilot alpha list.");
  };

  return (
    <section style={styles.signupSection}>
      <div>
        <p style={styles.cardLabel}>Early Access</p>
        <h2 style={styles.sectionTitle}>Join the Trade Pilot alpha list.</h2>
      </div>
      <form onSubmit={submit} style={styles.signupForm}>
        <input
          aria-label="Email"
          placeholder="email@example.com"
          value={form.email}
          onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
          style={styles.fieldInput}
        />
        <select value={form.traderType} onChange={(event) => setForm((current) => ({ ...current, traderType: event.target.value }))} style={styles.fieldInput}>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>
        <select value={form.market} onChange={(event) => setForm((current) => ({ ...current, market: event.target.value }))} style={styles.fieldInput}>
          {["MNQ", "NQ", "ES", "options", "crypto", "other"].map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
        <button style={styles.settingsButton}>Join Alpha</button>
      </form>
      {status ? <p style={styles.signupStatus}>{status}</p> : null}
    </section>
  );
}

function AppFooter() {
  return (
    <footer style={styles.footer}>
      <span>Not financial advice.</span>
      <span>Trading involves risk.</span>
      <a href="mailto:support@tradepilottool.com" style={styles.footerLink}>support@tradepilottool.com</a>
      <span>Privacy Policy placeholder</span>
      <span>Terms placeholder</span>
    </footer>
  );
}

function PlanItem({ title, text }) {
  return (
    <div style={styles.planItem}>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function SettingsModal({ profile, updateProfile, onClose }) {
  return (
    <div style={styles.modalBackdrop}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <div>
            <p style={styles.cardLabel}>Profile Settings</p>
            <h2 style={styles.sectionTitle}>Trading Profile</h2>
          </div>
          <button onClick={onClose} style={styles.closeButton}>Close</button>
        </div>

        <div style={styles.formGrid}>
          <Field label="Trader Name" value={profile.traderName} onChange={(value) => updateProfile("traderName", value)} />
          <Field label="Account Size" type="number" value={profile.accountSize} onChange={(value) => updateProfile("accountSize", value)} />
          <SelectField label="Account Type" value={profile.accountType} options={accountTypeOptions} onChange={(value) => updateProfile("accountType", value)} />
          <SelectField label="Main Market" value={profile.mainMarket} options={markets} onChange={(value) => updateProfile("mainMarket", value)} />
          <SelectField label="Trader Style" value={profile.traderStyle} options={["scalper", "runner", "both"]} onChange={(value) => updateProfile("traderStyle", value)} />
          <Field label="Max Daily Loss" type="number" value={profile.maxDailyLoss} onChange={(value) => updateProfile("maxDailyLoss", value)} />
          <Field label="Max Trades Per Day" type="number" value={profile.maxTradesPerDay} onChange={(value) => updateProfile("maxTradesPerDay", value)} />
          <Field label="Default Contracts" type="number" value={profile.defaultContracts} onChange={(value) => updateProfile("defaultContracts", value)} />
          <Field label="Default Risk Points" type="number" value={profile.defaultRiskPoints} onChange={(value) => updateProfile("defaultRiskPoints", value)} />
        </div>
      </div>
    </div>
  );
}

function Control({ label, tooltip, value, setValue, min, max, step = 0.25, disabled = false }) {
  return (
    <div style={styles.control}>
      <div style={styles.controlTop}>
        <span style={styles.labelWithHelp}>
          {label}
          {tooltip ? <HelpTip text={tooltip} /> : null}
        </span>
        <input type="number" value={value} step={step} disabled={disabled} onChange={(event) => setValue(Number(event.target.value))} style={{ ...styles.numberInput, opacity: disabled ? 0.55 : 1 }} />
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => setValue(Number(event.target.value))} style={{ ...styles.range, opacity: disabled ? 0.55 : 1 }} />
    </div>
  );
}

function HelpTip({ text }) {
  const [open, setOpen] = useState(false);

  return (
    <span style={styles.helpWrap}>
      <button
        type="button"
        aria-label="Show help"
        onClick={() => setOpen((current) => !current)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        style={styles.helpButton}
      >
        ?
      </button>
      {open ? <span style={styles.tooltip}>{text}</span> : null}
    </span>
  );
}

function Metric({ label, value, tone = "neutral", tooltip }) {
  const color = tone === "good" ? "#86efac" : tone === "bad" ? "#fca5a5" : tone === "warn" ? "#fde68a" : "#f8fafc";

  return (
    <div style={styles.metric}>
      <p style={styles.metricLabel}>
        <span style={styles.labelWithHelp}>
          {label}
          {tooltip ? <HelpTip text={tooltip} /> : null}
        </span>
      </p>
      <p style={{ ...styles.metricValue, color }}>{value}</p>
    </div>
  );
}

function ScoreRow({ label, value }) {
  return (
    <div style={styles.scoreRow}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label style={styles.field}>
      <span>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(type === "number" ? Number(event.target.value) : event.target.value)} style={styles.fieldInput} />
    </label>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label style={styles.field}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={styles.fieldInput}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(circle at top left, #172554 0, #050505 34%, #09090b 100%)",
    color: "#f8fafc",
    fontFamily: "Inter, Arial, sans-serif",
    padding: 0,
    width: "100%",
  },
  shell: {
    boxSizing: "border-box",
    margin: 0,
    maxWidth: "none",
    padding: 0,
    width: "100%",
  },
  standaloneMain: {
    width: "100%",
  },
  desktopDashboard: {
    alignItems: "start",
    display: "grid",
    gap: "20px",
    gridTemplateColumns: "240px minmax(0, 1fr) 320px",
    width: "100%",
  },
  dashboardMain: {
    display: "grid",
    gap: "18px",
    minWidth: 0,
    width: "100%",
  },
  leftSidebar: {
    background: "rgba(2, 6, 23, .82)",
    border: "1px solid #1e293b",
    borderRadius: "16px",
    display: "grid",
    gap: "16px",
    padding: "16px",
    position: "sticky",
    top: "20px",
  },
  sidebarBrand: {
    color: "#f8fafc",
    fontSize: "22px",
    fontWeight: 950,
    lineHeight: 1,
    padding: "8px 8px 4px",
  },
  sidebarNav: {
    display: "grid",
    gap: "6px",
  },
  sidebarButton: {
    border: "1px solid transparent",
    borderRadius: "10px",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 900,
    padding: "12px",
    textAlign: "left",
  },
  sidebarStreamerButton: {
    background: "#0e7490",
    border: "1px solid #38bdf8",
    borderRadius: "12px",
    color: "#ecfeff",
    cursor: "pointer",
    fontWeight: 950,
    padding: "12px",
  },
  rightPanel: {
    display: "grid",
    gap: "14px",
    minWidth: 0,
    position: "sticky",
    top: "20px",
  },
  insightCard: {
    background: "rgba(15, 23, 42, .78)",
    border: "1px solid rgba(148, 163, 184, .22)",
    borderRadius: "14px",
    display: "grid",
    gap: "10px",
    padding: "16px",
  },
  dashboardToolbar: {
    alignItems: "center",
    display: "flex",
    gap: "12px",
    justifyContent: "space-between",
    marginBottom: "16px",
    flexWrap: "wrap",
  },
  subPanel: {
    background: "rgba(2, 6, 23, .42)",
    border: "1px solid rgba(148, 163, 184, .18)",
    borderRadius: "14px",
    marginTop: "16px",
    padding: "16px",
  },
  toggleList: {
    display: "grid",
    gap: "8px",
  },
  compactSwitchRow: {
    alignItems: "center",
    color: "#e5e7eb",
    display: "flex",
    fontSize: "13px",
    fontWeight: 800,
    gap: "8px",
  },
  header: {
    alignItems: "center",
    background: "rgba(2, 6, 23, .92)",
    borderBottom: "1px solid #1e293b",
    display: "flex",
    gap: "18px",
    justifyContent: "space-between",
    marginBottom: 0,
    minHeight: "74px",
    padding: "12px 18px",
    position: "relative",
    flexWrap: "wrap",
  },
  headerBrand: {
    maxWidth: "760px",
    textAlign: "left",
  },
  headerMeta: {
    color: "#cbd5e1",
    display: "flex",
    flexWrap: "wrap",
    fontSize: "12px",
    fontWeight: 900,
    gap: "8px",
    justifyContent: "center",
    marginTop: "10px",
  },
  topActions: {
    alignItems: "center",
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 20,
  },
  menuButton: {
    alignItems: "center",
    background: "rgba(15, 23, 42, .96)",
    border: "1px solid rgba(148, 163, 184, .36)",
    borderRadius: "12px",
    boxShadow: "0 12px 30px rgba(0,0,0,.28)",
    cursor: "pointer",
    display: "inline-flex",
    flexDirection: "column",
    gap: "4px",
    height: "42px",
    justifyContent: "center",
    padding: 0,
    width: "42px",
  },
  menuBar: {
    background: "#e2e8f0",
    borderRadius: "999px",
    display: "block",
    height: "2px",
    width: "18px",
  },
  authActions: {
    alignItems: "center",
    display: "flex",
    gap: "8px",
    flexWrap: "wrap",
  },
  accountPill: {
    background: "#020617",
    border: "1px solid #334155",
    borderRadius: "999px",
    color: "#dbeafe",
    fontSize: "12px",
    fontWeight: 900,
    maxWidth: "240px",
    overflow: "hidden",
    padding: "9px 12px",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  authButton: {
    background: "#0f172a",
    border: "1px solid #38bdf8",
    borderRadius: "10px",
    color: "#e0f2fe",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 900,
    padding: "10px 12px",
  },
  streamerToggle: {
    alignItems: "center",
    background: "#020617",
    border: "1px solid #334155",
    borderRadius: "12px",
    color: "#e5e7eb",
    cursor: "pointer",
    display: "flex",
    fontSize: "13px",
    fontWeight: 900,
    gap: "8px",
    padding: "10px 12px",
  },
  moreWrap: {
    position: "relative",
    zIndex: 30,
  },
  moreMenu: {
    background: "rgba(2, 6, 23, .98)",
    border: "1px solid #334155",
    borderRadius: "14px",
    boxShadow: "0 22px 60px rgba(0,0,0,.36)",
    display: "grid",
    gap: "6px",
    minWidth: "210px",
    padding: "10px",
    position: "absolute",
    right: 0,
    top: "calc(100% + 8px)",
    zIndex: 40,
  },
  mobileOverlay: {
    background: "rgba(0,0,0,.6)",
    border: "none",
    cursor: "pointer",
    inset: 0,
    padding: 0,
    position: "fixed",
    zIndex: 9998,
  },
  moreMenuItem: {
    background: "transparent",
    border: "none",
    borderRadius: "10px",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 900,
    padding: "10px 12px",
    textAlign: "left",
  },
  moreToggle: {
    alignItems: "center",
    borderTop: "1px solid #1e293b",
    color: "#e5e7eb",
    cursor: "pointer",
    display: "flex",
    fontWeight: 900,
    gap: "8px",
    marginTop: "4px",
    padding: "12px",
  },
  riskBanner: {
    background: "rgba(120, 53, 15, .35)",
    border: "1px solid rgba(161, 98, 7, .45)",
    borderRadius: "10px",
    color: "#fde68a",
    fontSize: "12px",
    fontWeight: 800,
    marginBottom: "10px",
    padding: "7px 10px",
  },
  alphaBanner: {
    background: "rgba(14, 165, 233, .12)",
    border: "1px solid rgba(56, 189, 248, .28)",
    borderRadius: "10px",
    color: "#bae6fd",
    fontSize: "13px",
    fontWeight: 800,
    marginBottom: "8px",
    padding: "8px 10px",
  },
  guestPrompt: {
    alignItems: "center",
    background: "rgba(8, 47, 73, .72)",
    border: "1px solid rgba(14, 116, 144, .85)",
    borderRadius: "12px",
    color: "#cffafe",
    display: "flex",
    flexWrap: "wrap",
    fontSize: "13px",
    fontWeight: 900,
    gap: "12px",
    justifyContent: "space-between",
    marginBottom: "12px",
    padding: "10px 12px",
  },
  onboardingCard: {
    alignItems: "center",
    background: "rgba(15, 23, 42, .94)",
    border: "1px solid #334155",
    borderRadius: "16px",
    display: "grid",
    gap: "14px",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    marginBottom: "16px",
    maxWidth: "100%",
    padding: "18px",
    width: "100%",
  },
  onboardingSteps: {
    color: "#e5e7eb",
    display: "grid",
    gap: "8px",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  },
  installBanner: {
    alignItems: "center",
    background: "rgba(15, 23, 42, .94)",
    border: "1px solid #38bdf8",
    borderRadius: "14px",
    display: "flex",
    gap: "14px",
    justifyContent: "space-between",
    marginBottom: "16px",
    maxWidth: "100%",
    padding: "14px",
    flexWrap: "wrap",
    width: "100%",
  },
  installBannerText: {
    color: "#a1a1aa",
    fontSize: "13px",
    margin: "4px 0 0",
  },
  installBannerActions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  },
  installButton: {
    background: "#2563eb",
    border: "1px solid #3b82f6",
    borderRadius: "12px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 900,
    padding: "11px 14px",
  },
  dismissButton: {
    background: "#111827",
    border: "1px solid #334155",
    borderRadius: "12px",
    color: "#e5e7eb",
    cursor: "pointer",
    fontWeight: 800,
    padding: "11px 14px",
  },
  installPage: {
    display: "grid",
    gap: "16px",
  },
  pageTitle: {
    background: "rgba(15, 23, 42, .78)",
    border: "1px solid rgba(51, 65, 85, .9)",
    borderRadius: "16px",
    marginBottom: "16px",
    padding: "20px",
    textAlign: "left",
  },
  breadcrumb: {
    color: "#7dd3fc",
    fontSize: "12px",
    fontWeight: 900,
    letterSpacing: "0.08em",
    margin: "0 0 8px",
    textTransform: "uppercase",
  },
  pageTitleText: {
    color: "#f8fafc",
    fontSize: "30px",
    lineHeight: 1.1,
    margin: 0,
  },
  pageSubtitle: {
    color: "#a1a1aa",
    fontSize: "15px",
    margin: "8px 0 0",
  },
  fullWidthSection: {
    gridColumn: "1 / -1",
  },
  homePage: {
    display: "grid",
    gap: "24px",
  },
  homeHero: {
    alignItems: "start",
    background: "linear-gradient(135deg, rgba(15, 23, 42, .96), rgba(8, 47, 73, .78))",
    border: "1px solid rgba(56, 189, 248, .35)",
    borderRadius: "22px",
    display: "grid",
    minHeight: "320px",
    padding: "48px",
    textAlign: "left",
  },
  homeTitle: {
    fontSize: "clamp(42px, 7vw, 82px)",
    lineHeight: 1,
    margin: "0 0 18px",
    maxWidth: "none",
  },
  homeSubtitle: {
    color: "#cbd5e1",
    fontSize: "clamp(18px, 2vw, 24px)",
    lineHeight: 1.45,
    margin: "0 0 28px",
  },
  heroActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "12px",
  },
  primaryHeroButton: {
    background: "#f8fafc",
    border: "none",
    borderRadius: "14px",
    color: "#020617",
    cursor: "pointer",
    fontSize: "18px",
    fontWeight: 950,
    minHeight: "58px",
    padding: "16px 24px",
  },
  secondaryHeroButton: {
    background: "rgba(14, 165, 233, .14)",
    border: "1px solid #38bdf8",
    borderRadius: "14px",
    color: "#e0f2fe",
    cursor: "pointer",
    fontSize: "18px",
    fontWeight: 950,
    minHeight: "58px",
    padding: "16px 24px",
  },
  productCardGrid: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  },
  softFeatureCard: {
    background: "rgba(15, 23, 42, .76)",
    border: "1px solid rgba(148, 163, 184, .25)",
    borderRadius: "18px",
    padding: "22px",
  },
  featureTitle: {
    fontSize: "20px",
    margin: "0 0 10px",
  },
  installHero: {
    alignItems: "center",
    background: "linear-gradient(135deg, rgba(15, 23, 42, .98), rgba(2, 6, 23, .96))",
    border: "1px solid #334155",
    borderRadius: "18px",
    display: "grid",
    gap: "22px",
    gridTemplateColumns: "120px 1fr",
    padding: "24px",
  },
  installIconWrap: {
    background: "#050505",
    border: "1px solid #334155",
    borderRadius: "26px",
    padding: "12px",
  },
  installIcon: {
    display: "block",
    height: "96px",
    width: "96px",
  },
  eyebrow: {
    color: "#38bdf8",
    fontSize: "12px",
    fontWeight: 800,
    letterSpacing: "0.12em",
    margin: "0 0 8px",
    textTransform: "uppercase",
  },
  title: {
    fontSize: "46px",
    fontWeight: 950,
    lineHeight: 1,
    margin: 0,
  },
  subtitle: {
    color: "#a1a1aa",
    fontSize: "16px",
    margin: "8px 0 0",
  },
  positioningText: {
    color: "#7dd3fc",
    fontSize: "13px",
    fontWeight: 800,
    margin: "6px 0 0",
  },
  settingsButton: {
    background: "#2563eb",
    border: "1px solid #3b82f6",
    borderRadius: "12px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    padding: "12px 18px",
  },
  inlineActions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "16px",
  },
  textButton: {
    background: "transparent",
    border: "none",
    color: "#7dd3fc",
    cursor: "pointer",
    fontWeight: 900,
    padding: 0,
  },
  feedbackButton: {
    background: "#0ea5e9",
    border: "1px solid #38bdf8",
    borderRadius: "999px",
    bottom: "14px",
    boxShadow: "0 10px 24px rgba(0,0,0,.28)",
    color: "#00111f",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 900,
    padding: "8px 11px",
    position: "fixed",
    right: "14px",
    zIndex: 15,
  },
  toast: {
    background: "#0f172a",
    border: "1px solid #38bdf8",
    borderRadius: "12px",
    bottom: "64px",
    boxShadow: "0 18px 45px rgba(0,0,0,.35)",
    color: "#ffffff",
    fontSize: "14px",
    fontWeight: 900,
    padding: "12px 14px",
    position: "fixed",
    right: "14px",
    zIndex: 50,
  },
  link: {
    color: "#7dd3fc",
    fontWeight: 800,
  },
  secondaryButton: {
    background: "#1f2937",
    border: "1px solid #3f3f46",
    borderRadius: "12px",
    color: "#ffffff",
    cursor: "pointer",
    fontWeight: 800,
    padding: "12px 16px",
  },
  heroGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
    gap: "16px",
    marginBottom: "16px",
  },
  alphaTopGrid: {
    display: "grid",
    gap: "22px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
    marginBottom: "22px",
  },
  alphaMiddleGrid: {
    display: "grid",
    gap: "22px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))",
    marginBottom: "22px",
  },
  dashboardGrid: {
    display: "grid",
    gap: "24px",
    gridTemplateColumns: "minmax(420px, 0.95fr) minmax(520px, 1.35fr)",
    alignItems: "start",
    marginBottom: "24px",
    width: "100%",
  },
  mobileStatusBar: {
    background: "rgba(15, 23, 42, .9)",
    border: "1px solid #243b55",
    borderRadius: "14px",
    display: "none",
    gap: "10px",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    marginBottom: "14px",
    padding: "12px",
    width: "100%",
  },
  dashboardCardBoard: {
    alignItems: "start",
    display: "grid",
    gap: "22px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
    marginBottom: "22px",
    width: "100%",
  },
  dashboardCardSlot: {
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  draggableCardRow: {
    alignItems: "center",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "12px",
    color: "#e5e7eb",
    cursor: "grab",
    display: "flex",
    fontWeight: 800,
    justifyContent: "space-between",
    gap: "12px",
    padding: "10px 12px",
  },
  miniButton: {
    background: "#1f2937",
    border: "1px solid #334155",
    borderRadius: "9px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 800,
    padding: "7px 9px",
  },
  rulesCard: {
    background: "rgba(15, 23, 42, .76)",
    border: "1px solid rgba(148, 163, 184, .24)",
    borderRadius: "18px",
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "minmax(220px, .45fr) 1fr",
    marginBottom: "16px",
    padding: "18px",
  },
  rulesGrid: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
  },
  tradePlanHero: {
    background: "rgba(15, 23, 42, .82)",
    border: "1px solid rgba(148, 163, 184, .24)",
    borderRadius: "18px",
    boxShadow: "0 16px 38px rgba(0,0,0,.24)",
    padding: "26px",
  },
  tradePlanTitle: {
    fontSize: "34px",
    lineHeight: 1,
    margin: "0 0 18px",
  },
  planMetricGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
  },
  emptyPlan: {
    color: "#d4d4d8",
    fontSize: "20px",
    fontWeight: 800,
    lineHeight: 1.35,
    margin: 0,
  },
  coachGrid: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    marginBottom: "14px",
  },
  segmentGroup: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
    marginBottom: "12px",
  },
  segmentButton: {
    border: "1px solid #334155",
    borderRadius: "12px",
    color: "white",
    cursor: "pointer",
    fontWeight: 900,
    minHeight: "46px",
    padding: "10px",
  },
  generateButton: {
    background: "#2563eb",
    border: "1px solid #3b82f6",
    borderRadius: "14px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "17px",
    fontWeight: 950,
    marginBottom: "12px",
    minHeight: "56px",
    padding: "14px",
    width: "100%",
  },
  advancedToggle: {
    background: "#111827",
    border: "1px solid #334155",
    borderRadius: "14px",
    color: "#e5e7eb",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: 900,
    marginBottom: "16px",
    padding: "13px 16px",
    width: "100%",
  },
  card: {
    background: "rgba(24, 24, 27, .76)",
    border: "1px solid rgba(148, 163, 184, .2)",
    borderRadius: "18px",
    boxShadow: "0 14px 34px rgba(0,0,0,.22)",
    padding: "24px",
  },
  chartPanel: {
    background: "rgba(2, 6, 23, .94)",
    border: "1px solid #334155",
    borderRadius: "18px",
    marginBottom: "22px",
    minHeight: "520px",
    padding: "22px",
    width: "100%",
  },
  chartWrap: {
    height: "520px",
    minWidth: 0,
  },
  chartNote: {
    color: "#94a3b8",
    fontSize: "13px",
    fontWeight: 800,
    margin: "12px 0 0",
  },
  chartPrice: {
    color: "#facc15",
    fontSize: "28px",
  },
  livestreamPanel: {
    background: "linear-gradient(135deg, rgba(2,6,23,.98), rgba(8,47,73,.92))",
    border: "1px solid #38bdf8",
    borderRadius: "22px",
    display: "grid",
    gap: "24px",
    marginBottom: "22px",
    minHeight: "360px",
    padding: "clamp(26px, 5vw, 56px)",
    placeItems: "center",
    textAlign: "center",
  },
  liveHero: {
    display: "grid",
    gap: "8px",
    justifyItems: "center",
  },
  liveMarket: {
    color: "#bae6fd",
    fontSize: "28px",
    fontWeight: 950,
    margin: 0,
  },
  livePrice: {
    color: "#f8fafc",
    fontSize: "clamp(76px, 11vw, 160px)",
    lineHeight: 1,
    margin: 0,
  },
  liveSubline: {
    color: "#bae6fd",
    fontSize: "18px",
    fontWeight: 900,
    margin: "10px 0 0",
  },
  liveMetricGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    width: "100%",
  },
  liveCoach: {
    background: "#020617",
    border: "1px solid #0e7490",
    borderRadius: "12px",
    color: "#e0f2fe",
    fontSize: "24px",
    fontWeight: 900,
    lineHeight: 1.2,
    padding: "16px",
  },
  fastCard: {
    alignItems: "center",
    background: "rgba(2, 6, 23, .94)",
    border: "1px solid #1d4ed8",
    borderRadius: "16px",
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "minmax(240px, .8fr) 1.2fr",
    marginBottom: "16px",
    padding: "22px",
  },
  quickEntryCard: {
    alignItems: "center",
    background: "rgba(15, 23, 42, .76)",
    border: "1px solid rgba(148, 163, 184, .24)",
    borderRadius: "18px",
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "minmax(240px, .7fr) 1.3fr",
    marginBottom: "16px",
    padding: "22px",
  },
  marketTopBar: {
    alignItems: "end",
    background: "rgba(2, 6, 23, .82)",
    border: "1px solid #1e293b",
    borderRadius: "16px",
    display: "grid",
    gap: "14px",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    marginBottom: "16px",
    padding: "16px",
  },
  marketTopMetric: {
    background: "#09090b",
    border: "1px solid #27272a",
    borderRadius: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    padding: "11px 12px",
  },
  quickGrid: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  },
  sourceButton: {
    background: "rgba(15, 23, 42, .9)",
    border: "1px solid #334155",
    borderRadius: "12px",
    color: "#e5e7eb",
    cursor: "pointer",
    display: "grid",
    gap: "5px",
    padding: "14px",
    textAlign: "left",
  },
  quickButton: {
    border: "1px solid rgba(255,255,255,.16)",
    borderRadius: "14px",
    color: "white",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: 900,
    minHeight: "64px",
    padding: "12px",
  },
  missedEntry: {
    background: "#451a03",
    border: "1px solid #f59e0b",
    borderRadius: "14px",
    color: "#fde68a",
    fontSize: "18px",
    fontWeight: 900,
    marginBottom: "16px",
    padding: "16px",
  },
  marketSpecLine: {
    color: "#bae6fd",
    fontSize: "13px",
    fontWeight: 800,
    marginTop: "14px",
  },
  levelCoachGrid: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    marginBottom: "16px",
  },
  visualGrid: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    marginBottom: "16px",
  },
  productUpgradeGrid: {
    display: "grid",
    gap: "18px",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
    marginBottom: "22px",
  },
  equityCurve: {
    alignItems: "end",
    background: "#020617",
    border: "1px solid #1e293b",
    borderRadius: "14px",
    display: "flex",
    gap: "8px",
    height: "180px",
    margin: "16px 0",
    padding: "14px",
  },
  equityBar: {
    borderRadius: "999px 999px 0 0",
    flex: 1,
    minWidth: "10px",
  },
  ladder: {
    background: "linear-gradient(180deg, rgba(15,23,42,.9), rgba(2,6,23,.95))",
    border: "1px solid #27272a",
    borderRadius: "14px",
    height: "340px",
    marginTop: "16px",
    overflow: "hidden",
    position: "relative",
  },
  ladderLevel: {
    alignItems: "center",
    borderTop: "2px solid",
    display: "flex",
    justifyContent: "space-between",
    left: "14px",
    paddingTop: "4px",
    position: "absolute",
    right: "14px",
  },
  rrTrack: {
    background: "#111827",
    border: "1px solid #27272a",
    borderRadius: "999px",
    display: "grid",
    gap: "6px",
    margin: "18px 0 10px",
    overflow: "hidden",
    padding: "6px",
  },
  rrRisk: {
    background: "#ef4444",
    borderRadius: "999px",
    height: "12px",
  },
  rrReward: {
    background: "#22c55e",
    borderRadius: "999px",
    height: "12px",
  },
  rrText: {
    color: "#f8fafc",
    fontSize: "22px",
    fontWeight: 900,
    margin: "10px 0",
  },
  sharePreview: {
    background: "#020617",
    border: "1px solid #27272a",
    borderRadius: "12px",
    color: "#dbeafe",
    fontFamily: "Consolas, monospace",
    fontSize: "13px",
    lineHeight: 1.5,
    overflow: "auto",
    padding: "14px",
    whiteSpace: "pre-wrap",
  },
  levelActionCard: {
    background: "linear-gradient(135deg, rgba(30, 64, 175, .9), rgba(8, 47, 73, .88))",
    border: "1px solid #38bdf8",
    borderRadius: "16px",
    boxShadow: "0 18px 45px rgba(0,0,0,.35)",
    padding: "22px",
  },
  actionText: {
    color: "#f8fafc",
    fontSize: "34px",
    fontWeight: 900,
    lineHeight: 1,
    margin: "0 0 14px",
  },
  biasCard: {
    background: "rgba(15, 23, 42, .95)",
    border: "1px solid #334155",
    borderRadius: "16px",
    padding: "24px",
  },
  scoreCard: {
    background: "rgba(24, 24, 27, .95)",
    border: "1px solid #27272a",
    borderRadius: "16px",
    padding: "24px",
  },
  coachCard: {
    background: "rgba(8, 47, 73, .72)",
    border: "1px solid rgba(34, 211, 238, .38)",
    borderRadius: "18px",
    padding: "28px",
  },
  safetyCard: {
    background: "rgba(69, 10, 10, .72)",
    border: "1px solid #991b1b",
    borderRadius: "16px",
    padding: "22px",
  },
  cardLabel: {
    color: "#a1a1aa",
    fontSize: "12px",
    fontWeight: 800,
    margin: "0 0 10px",
    textTransform: "uppercase",
  },
  biasText: {
    fontSize: "48px",
    fontWeight: 900,
    lineHeight: 1,
    marginBottom: "12px",
  },
  muted: {
    color: "#a1a1aa",
    lineHeight: 1.45,
    margin: 0,
  },
  scoreTop: {
    alignItems: "flex-start",
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
  },
  scoreText: {
    fontSize: "42px",
    lineHeight: 1,
    margin: 0,
  },
  confidencePill: {
    borderRadius: "999px",
    color: "white",
    fontSize: "13px",
    fontWeight: 900,
    padding: "8px 12px",
  },
  scoreTrack: {
    background: "#27272a",
    borderRadius: "999px",
    height: "14px",
    marginTop: "24px",
    overflow: "hidden",
  },
  scoreFill: {
    borderRadius: "999px",
    height: "100%",
  },
  coachMessage: {
    color: "#e0f2fe",
    fontSize: "24px",
    fontWeight: 800,
    lineHeight: 1.2,
    margin: "0 0 14px",
  },
  fastGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
    gap: "10px",
  },
  fastButton: {
    background: "#1e3a8a",
    border: "1px solid #3b82f6",
    borderRadius: "14px",
    color: "white",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: 900,
    minHeight: "58px",
    padding: "12px",
  },
  mainGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
    gap: "22px",
  },
  sectionHeader: {
    alignItems: "center",
    display: "flex",
    gap: "14px",
    justifyContent: "space-between",
    marginBottom: "18px",
  },
  sectionTitle: {
    fontSize: "24px",
    margin: 0,
  },
  directionToggle: {
    display: "flex",
    gap: "8px",
  },
  toggleButton: {
    border: "1px solid #3f3f46",
    borderRadius: "10px",
    color: "white",
    cursor: "pointer",
    fontWeight: 800,
    padding: "10px 14px",
  },
  control: {
    marginBottom: "18px",
  },
  controlTop: {
    alignItems: "center",
    color: "#e4e4e7",
    display: "flex",
    fontSize: "14px",
    fontWeight: 700,
    justifyContent: "space-between",
    marginBottom: "8px",
    gap: "12px",
  },
  marketPanel: {
    background: "#09090b",
    border: "1px solid #27272a",
    borderRadius: "14px",
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    marginBottom: "14px",
    padding: "14px",
  },
  switchRow: {
    alignItems: "center",
    color: "#e4e4e7",
    display: "flex",
    fontSize: "14px",
    fontWeight: 800,
    gap: "10px",
    paddingTop: "24px",
  },
  dataStatus: {
    color: "#a1a1aa",
    display: "flex",
    flexWrap: "wrap",
    fontSize: "13px",
    gap: "12px",
    justifyContent: "space-between",
    marginBottom: "10px",
  },
  brokerStatusCard: {
    alignItems: "center",
    background: "#020617",
    border: "1px solid #1e293b",
    borderRadius: "12px",
    color: "#dbeafe",
    display: "flex",
    flexWrap: "wrap",
    fontSize: "13px",
    fontWeight: 800,
    gap: "10px",
    marginBottom: "12px",
    padding: "10px 12px",
  },
  statusPill: {
    borderRadius: "999px",
    color: "white",
    fontSize: "12px",
    fontWeight: 900,
    padding: "5px 9px",
  },
  priceTape: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
    marginBottom: "12px",
  },
  priceWarning: {
    background: "#422006",
    border: "1px solid #a16207",
    borderRadius: "10px",
    color: "#fde68a",
    fontSize: "13px",
    fontWeight: 800,
    marginBottom: "12px",
    padding: "10px",
  },
  labelWithHelp: {
    alignItems: "center",
    display: "inline-flex",
    gap: "6px",
  },
  helpWrap: {
    display: "inline-flex",
    position: "relative",
  },
  helpButton: {
    alignItems: "center",
    background: "#27272a",
    border: "1px solid #3f3f46",
    borderRadius: "999px",
    color: "#e4e4e7",
    cursor: "pointer",
    display: "inline-flex",
    fontSize: "11px",
    fontWeight: 900,
    height: "18px",
    justifyContent: "center",
    lineHeight: 1,
    padding: 0,
    width: "18px",
  },
  tooltip: {
    background: "#020617",
    border: "1px solid #334155",
    borderRadius: "10px",
    boxShadow: "0 16px 35px rgba(0,0,0,.45)",
    color: "#f8fafc",
    fontSize: "13px",
    fontWeight: 600,
    left: "50%",
    lineHeight: 1.4,
    padding: "10px 12px",
    position: "absolute",
    top: "24px",
    transform: "translateX(-50%)",
    width: "230px",
    zIndex: 30,
  },
  numberInput: {
    background: "#09090b",
    border: "1px solid #3f3f46",
    borderRadius: "10px",
    color: "white",
    padding: "8px 10px",
    width: "112px",
  },
  range: {
    width: "100%",
  },
  metricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(135px, 1fr))",
    gap: "12px",
  },
  metric: {
    background: "#09090b",
    border: "1px solid #27272a",
    borderRadius: "12px",
    minWidth: 0,
    overflow: "hidden",
    padding: "14px",
  },
  metricLabel: {
    color: "#a1a1aa",
    fontSize: "12px",
    fontWeight: 800,
    margin: "0 0 8px",
    textTransform: "uppercase",
  },
  metricValue: {
    fontSize: "22px",
    fontWeight: 900,
    margin: 0,
    overflowWrap: "anywhere",
    whiteSpace: "normal",
    wordBreak: "break-word",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
    gap: "14px",
  },
  field: {
    color: "#e4e4e7",
    display: "flex",
    flexDirection: "column",
    fontSize: "14px",
    fontWeight: 800,
    gap: "8px",
  },
  fieldInput: {
    background: "#09090b",
    border: "1px solid #3f3f46",
    borderRadius: "10px",
    color: "white",
    fontSize: "15px",
    padding: "10px 12px",
  },
  warningStack: {
    display: "grid",
    gap: "10px",
    marginTop: "16px",
  },
  warningBox: {
    background: "#422006",
    border: "1px solid #a16207",
    borderRadius: "12px",
    color: "#fde68a",
    fontWeight: 800,
    padding: "12px",
  },
  coachPrompt: {
    background: "#082f49",
    border: "1px solid #0e7490",
    borderRadius: "12px",
    color: "#bae6fd",
    fontWeight: 800,
    padding: "12px",
  },
  scoreRow: {
    alignItems: "center",
    borderBottom: "1px solid #27272a",
    color: "#d4d4d8",
    display: "flex",
    justifyContent: "space-between",
    padding: "12px 0",
  },
  sourceGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  },
  connectionGrid: {
    display: "grid",
    gap: "12px",
    gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
  },
  sourceOption: {
    background: "#09090b",
    border: "1px solid #27272a",
    borderRadius: "14px",
    padding: "14px",
  },
  signupSection: {
    alignItems: "center",
    background: "rgba(15, 23, 42, .94)",
    border: "1px solid #334155",
    borderRadius: "16px",
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    marginTop: "18px",
    padding: "18px",
  },
  signupForm: {
    display: "grid",
    gap: "10px",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  },
  signupStatus: {
    color: "#86efac",
    fontWeight: 900,
    margin: 0,
  },
  footer: {
    alignItems: "center",
    color: "#a1a1aa",
    display: "flex",
    flexWrap: "wrap",
    fontSize: "12px",
    fontWeight: 800,
    gap: "12px",
    justifyContent: "center",
    padding: "22px 0 8px",
    textAlign: "center",
  },
  footerLink: {
    color: "#7dd3fc",
  },
  planItem: {
    borderBottom: "1px solid #27272a",
    padding: "12px 0",
  },
  textArea: {
    background: "#09090b",
    border: "1px solid #3f3f46",
    borderRadius: "12px",
    color: "white",
    fontFamily: "Consolas, monospace",
    minHeight: "140px",
    margin: "16px 0",
    padding: "12px",
    width: "100%",
  },
  modalBackdrop: {
    alignItems: "center",
    background: "rgba(0,0,0,.72)",
    display: "flex",
    inset: 0,
    justifyContent: "center",
    padding: "20px",
    position: "fixed",
    zIndex: 20,
  },
  modal: {
    background: "#18181b",
    border: "1px solid #3f3f46",
    borderRadius: "18px",
    maxHeight: "88vh",
    maxWidth: "860px",
    overflow: "auto",
    padding: "24px",
    width: "100%",
  },
  disclaimerModal: {
    background: "#18181b",
    border: "1px solid #f59e0b",
    borderRadius: "18px",
    boxShadow: "0 24px 70px rgba(0,0,0,.55)",
    maxWidth: "620px",
    padding: "28px",
    width: "100%",
  },
  disclaimerText: {
    color: "#f8fafc",
    fontSize: "18px",
    fontWeight: 800,
    lineHeight: 1.45,
    margin: "18px 0 12px",
  },
  acceptButton: {
    background: "#2563eb",
    border: "1px solid #3b82f6",
    borderRadius: "12px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: 900,
    marginTop: "22px",
    padding: "13px 18px",
    width: "100%",
  },
  modalHeader: {
    alignItems: "center",
    display: "flex",
    justifyContent: "space-between",
    gap: "14px",
    marginBottom: "20px",
  },
  closeButton: {
    background: "#27272a",
    border: "1px solid #3f3f46",
    borderRadius: "10px",
    color: "white",
    cursor: "pointer",
    fontWeight: 800,
    padding: "10px 14px",
  },
};


