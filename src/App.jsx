import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
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
const watchlistStorageKey = "tradePilotWatchlist";

const defaultProfile = {
  traderName: "",
  accountSize: 50000,
  accountType: "personal",
  accountPhase: "evaluation",
  consistencyRuleTarget: 30,
  fundedPlatform: "Tradovate",
  fundedProvider: "Apex",
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
const dataSources = ["Manual", "Demo Broker", "Tradovate Demo Read-Only", "Tradovate Live Read-Only", "TradingView Alerts", "Market Data API", "Broker Connection"];
const fundedProviders = ["Apex", "Topstep", "Take Profit Trader", "MyFundedFutures", "Bulenox", "Earn2Trade", "Other prop/funded account"];
const fundedPlatforms = ["Tradovate", "Rithmic", "TopstepX", "NinjaTrader/CQG", "CSV Import", "Manual Mode"];
const navigationTabs = ["Dashboard", "Account", "Connections", "Install", "Journal", "Profile", "Help", "Support", "Settings"];
const marketServerUrl = "http://127.0.0.1:8787";
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
  live: "Tradovate Live Read-Only",
};

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
    return saved ? { ...defaultProfile, ...JSON.parse(saved) } : defaultProfile;
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
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

function loadList(key) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

const defaultLayout = {
  chart: true,
  coach: true,
  connections: true,
  fastMode: true,
  journal: true,
  risk: true,
  score: true,
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
  };
}

export default function App() {
  const [profile, setProfile] = useState(() => loadProfile());
  const [discipline, setDiscipline] = useState(() => loadDiscipline());
  const [activePosition, setActivePosition] = useState(() => loadActivePosition());
  const [plannedTrade, setPlannedTrade] = useState(() => loadActivePosition());
  const [activePage, setActivePage] = useState("dashboard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [disclaimerAccepted, setDisclaimerAccepted] = useState(() => localStorage.getItem(disclaimerStorageKey) === "true");
  const [onboardingComplete, setOnboardingComplete] = useState(() => localStorage.getItem(onboardingStorageKey) === "true");
  const [fastMessage, setFastMessage] = useState("Ready for manual execution.");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [installBannerDismissed, setInstallBannerDismissed] = useState(false);
  const [feedbackItems, setFeedbackItems] = useState(() => loadList(feedbackStorageKey));
  const [supportMessages, setSupportMessages] = useState(() => loadList(supportStorageKey));
  const [streamerMode, setStreamerMode] = useState(() => localStorage.getItem(streamerModeStorageKey) === "true");
  const [journalEntries, setJournalEntries] = useState(() => loadList(journalStorageKey));
  const [layoutPrefs, setLayoutPrefs] = useState(() => {
    try {
      const saved = localStorage.getItem(layoutStorageKey);
      return saved ? { ...defaultLayout, ...JSON.parse(saved) } : defaultLayout;
    } catch {
      return defaultLayout;
    }
  });
  const [watchlist, setWatchlist] = useState(() => loadList(watchlistStorageKey));
  const [session, setSession] = useState(null);
  const [authModal, setAuthModal] = useState(null);
  const [authMessage, setAuthMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState("Local workspace");
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
    localStorage.setItem(journalStorageKey, JSON.stringify(journalEntries));
  }, [journalEntries]);

  useEffect(() => {
    localStorage.setItem(layoutStorageKey, JSON.stringify(layoutPrefs));
  }, [layoutPrefs]);

  useEffect(() => {
    localStorage.setItem(watchlistStorageKey, JSON.stringify(watchlist));
  }, [watchlist]);

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
        setProfile((current) => ({ ...current, ...(settingsRow.risk_settings || {}), mainMarket: settingsRow.selected_market || current.mainMarket }));
        if (Number.isFinite(Number(settingsRow.support))) setSupport(Number(settingsRow.support));
        if (Number.isFinite(Number(settingsRow.resistance))) setResistance(Number(settingsRow.resistance));
        setLayoutPrefs({ ...defaultLayout, ...(settingsRow.preferred_layout || {}) });
      }

      if (activePlan?.plan) {
        setPlannedTrade(activePlan.plan);
        setActivePosition(activePlan.plan.status === "active" ? activePlan.plan : null);
      }

      if (journalRows?.length) setJournalEntries(journalRows.map((row) => ({ id: row.id, ...(row.entry || {}), stamp: row.created_at })));
      if (watchRows?.length) setWatchlist(watchRows.map((row) => ({ id: row.id, notes: row.notes, symbol: row.symbol })));
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
  };

  useEffect(() => {
    const base = marketDefaults[profile.mainMarket] ?? 27400;
    setPrice(base);
    setSupport(base - Math.max(10, base * 0.0013));
    setResistance(base + Math.max(10, base * 0.0018));
    setEntry(base);
    setRecentHigh(base + Math.max(10, base * 0.0018));
    setPullbackSupport(base - Math.max(10, base * 0.0013));
    setBreakoutLevel(base + Math.max(10, base * 0.0018));
    setLastUpdated(`Market changed to ${profile.mainMarket}`);
  }, [profile.mainMarket]);

  useEffect(() => {
    if (!autoPrice) {
      setDataSource("Manual");
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

        setDirection(brokerPosition.direction);
        setEntry(brokerPosition.entry);
        setContracts(brokerPosition.contracts);
        setActivePosition({
          ...brokerPosition,
          stop: brokerPosition.stop ?? fallbackStop,
          target: brokerPosition.target ?? runner,
          trim1,
          trim2,
          runner,
        });
        setPlannedTrade({
          ...brokerPosition,
          setupType: "Broker Connection",
          status: "active",
          stop: brokerPosition.stop ?? fallbackStop,
          target: brokerPosition.target ?? runner,
          trim1,
          trim2,
          runner,
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

    if (dataSource === "Market Data API" && canUseLocalMarketServer) {
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

  const savePersonalWorkspace = async () => {
    if (!session?.user || !supabase) return;

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

    await Promise.all([
      supabase.from("profiles").upsert(profileToDatabase(profile, session.user, streamerMode)),
      supabase.from("trade_settings").upsert({
        coach_preferences: { voiceAlerts: profile.voiceAlerts },
        preferred_layout: layoutPrefs,
        risk_settings: riskSettings,
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
    const trim1 = nextDirection === "long" ? nextEntry + profile.trim1Points : nextEntry - profile.trim1Points;
    const trim2 = nextDirection === "long" ? nextEntry + profile.trim2Points : nextEntry - profile.trim2Points;
    const runner = nextDirection === "long" ? nextEntry + profile.runnerPoints : nextEntry - profile.runnerPoints;

    setDirection(nextDirection);
    setEntry(nextEntry);
    setActivePosition({
      direction: nextDirection,
      entry: nextEntry,
      contracts,
      stop,
      target: runner,
      trim1,
      trim2,
      runner,
      status: "active",
      lastAction: `${nextDirection === "long" ? "Long" : "Short"} loaded from Fast Mode`,
    });
    setPlannedTrade({
      direction: nextDirection,
      entry: nextEntry,
      contracts,
      stop,
      target: runner,
      trim1,
      trim2,
      runner,
      setupType: "Fast Mode",
      status: "planned",
      lastAction: `${nextDirection === "long" ? "Long" : "Short"} loaded from Fast Mode`,
    });
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
    setPlannedTrade({
      ...plan,
      contracts,
      target: plan.runner,
      setupType,
      status: "planned",
      lastAction: `${setupType} plan generated`,
    });
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
    if (alert.symbol) updateProfile("mainMarket", alert.symbol);
    if (Number.isFinite(alert.price)) setPrice(alert.price);
    if (alert.direction === "long" || alert.direction === "short") setDirection(alert.direction);
    if (Number.isFinite(alert.support)) setSupport(alert.support);
    if (Number.isFinite(alert.resistance)) setResistance(alert.resistance);
    if (alert.timestamp) setLastUpdated(new Date(alert.timestamp).toLocaleTimeString());
    else setLastUpdated(new Date().toLocaleTimeString());
    setQuote({
      bid: Number((alert.price - 0.25).toFixed(2)),
      ask: Number((alert.price + 0.25).toFixed(2)),
    });
    setDataSource("TradingView Alerts");
    setAutoPrice(true);
    setFastMessage(`Webhook preview applied: ${alert.signalType || "signal"} populated the dashboard.`);
    setActivePage("dashboard");
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

      setBrokerConnection(result.snapshot);
      setDataSource("Broker Connection");
      setAutoPrice(true);
      setFastMessage("Demo Broker connected. Live simulated price and position data are streaming.");
      setActivePage("dashboard");
    } catch (error) {
      setPriceStatus(error.message || "Start the local market server to use Demo Broker mode.");
      setActivePage("connections");
    }
  };

  const connectTradovateReadOnly = async (mode) => {
    const platform = mode === "live" ? "Tradovate Live Read-Only" : "Tradovate Demo Read-Only";
    setBrokerConnection((current) => ({
      ...current,
      connected: false,
      connectionStatus: "Connecting",
      error: "",
      platform,
    }));
    setPriceStatus("");

    try {
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

      setBrokerConnection({
        ...(snapshot.snapshot || snapshot),
        connectionStatus: mode === "live" ? "Live Read-Only Connected" : "Demo Connected",
        error: "",
      });
      setDataSource(mode === "live" ? tradovateModes.live : tradovateModes.demo);
      setAutoPrice(true);
      setFastMessage(`${mode === "live" ? "Live" : "Demo"} Tradovate read-only connected. Trading actions remain disabled.`);
      setActivePage("dashboard");
    } catch (error) {
      const message = error.message || "Tradovate read-only connection is not configured.";
      setBrokerConnection((current) => ({
        ...current,
        connected: false,
        connectionStatus: "Error",
        error: message,
        platform,
      }));
      setPriceStatus(message);
      setActivePage("connections");
    }
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
    <div style={styles.page}>
      <div style={styles.shell}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>AI Trading Execution Assistant</p>
            <h1 style={styles.title}>Trade Pilot</h1>
            <p style={styles.subtitle}>
              Plan trades. Manage risk. Avoid emotional entries.
            </p>
            <p style={styles.positioningText}>
              Trading execution assistant, not a signal service.
            </p>
          </div>

          <div style={styles.topActions}>
            <div style={styles.authActions}>
              {session?.user ? (
                <>
                  <span style={styles.accountPill}>{session.user.user_metadata?.name || session.user.email}</span>
                  <button onClick={() => setActivePage("profile")} style={styles.authButton}>Profile</button>
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
            <label style={styles.streamerToggle}>
              <input
                type="checkbox"
                checked={streamerMode}
                onChange={(event) => setStreamerMode(event.target.checked)}
              />
              Streamer Mode
            </label>
            {navigationTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActivePage(tab.toLowerCase())}
                style={{ ...styles.secondaryButton, background: activePage === tab.toLowerCase() ? "#2563eb" : "#27272a" }}
              >
                {tab}
              </button>
            ))}
          </div>
        </header>
        <div style={styles.alphaBanner}>Trade Pilot Alpha — educational execution assistant. Not financial advice.</div>
        <div style={styles.riskBanner}>Read-only mode: Trade Pilot reads Tradovate/account data and does not place, cancel, or modify trades.</div>
        <div style={styles.riskBanner}>Trading involves risk. Trade responsibly.</div>
        {!session?.user ? (
          <div style={styles.guestPrompt}>
            <span>Create a free account to save your trading workspace.</span>
            <button onClick={() => setAuthModal("signup")} style={styles.authButton}>Sign Up</button>
          </div>
        ) : null}
        {!installBannerDismissed ? (
          <InstallBanner
            canInstall={Boolean(installPrompt)}
            onDismiss={() => setInstallBannerDismissed(true)}
            onInstall={installApp}
            onInstructions={() => setActivePage("install")}
          />
        ) : null}
        {!onboardingComplete ? (
          <OnboardingCard
            onDone={() => {
              localStorage.setItem(onboardingStorageKey, "true");
              setOnboardingComplete(true);
            }}
          />
        ) : null}

        {activePage === "dashboard" ? (
          <Dashboard
            activePosition={activePosition}
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
            layoutPrefs={layoutPrefs}
            lastUpdated={lastUpdated}
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
            setPullbackSupport={setPullbackSupport}
            setRecentHigh={setRecentHigh}
            setResistance={setResistance}
            setRiskPoints={setRiskPoints}
            setSupport={setSupport}
            streamerMode={streamerMode}
            support={support}
            updateDiscipline={updateDiscipline}
            updateProfile={updateProfile}
          />
        ) : null}
        {activePage === "connections" ? (
          <ConnectionsPage
            activePosition={activePosition}
            brokerConnection={brokerConnection}
            dataSource={dataSource}
            discipline={discipline}
            engine={engine}
            lastUpdated={lastUpdated}
            price={price}
            profile={profile}
            quote={quote}
            connectTradovateReadOnly={connectTradovateReadOnly}
            startDemoBroker={startDemoBroker}
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
        <AlphaSignup />
        <AppFooter />
      </div>

      {settingsOpen ? (
        <SettingsModal profile={profile} updateProfile={updateProfile} onClose={() => setSettingsOpen(false)} />
      ) : null}

      <a href="mailto:support@tradepilot.app?subject=Trade%20Pilot%20Alpha%20Feedback" style={styles.feedbackButton}>Send Feedback</a>

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

function OnboardingCard({ onDone }) {
  return (
    <section style={styles.onboardingCard}>
      <div>
        <p style={styles.cardLabel}>Start Here</p>
        <h2 style={styles.sectionTitle}>Build a trade plan in 3 steps</h2>
      </div>
      <div style={styles.onboardingSteps}>
        <span>1. Choose your market</span>
        <span>2. Mark support and resistance</span>
        <span>3. Generate your trade plan</span>
      </div>
      <button onClick={onDone} style={styles.settingsButton}>Got it</button>
    </section>
  );
}

function InstallBanner({ canInstall, onDismiss, onInstall, onInstructions }) {
  return (
    <section style={styles.installBanner}>
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
        <PlanItem title="Pro Later" text="Live broker data, advanced chart, AI trade coach, analytics, TradingView webhook, and custom layouts." />
        <PlanItem title="Payments" text="Not enabled yet." />
      </section>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Layout Customization</p>
        <h2 style={styles.sectionTitle}>Show / Hide Dashboard Cards</h2>
        <p style={{ ...styles.muted, marginBottom: "14px" }}>Reordering is reserved for later; these visibility preferences save to your database when signed in.</p>
        <div style={styles.formGrid}>
          {Object.keys(defaultLayout).map((key) => (
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
    accountType: "personal",
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
        const { error } = await supabase.auth.resetPasswordForEmail(form.email);
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
        {mode === "signup" ? <SelectField label="Account Type" value={form.accountType} options={["personal", "funded", "both"]} onChange={(value) => setForm((current) => ({ ...current, accountType: value }))} /> : null}
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

function Dashboard({
  activePosition,
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
  layoutPrefs,
  lastUpdated,
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
  setPullbackSupport,
  setRecentHigh,
  setResistance,
  setRiskPoints,
  setSupport,
  streamerMode,
  support,
  updateDiscipline,
  updateProfile,
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [setupDirection, setSetupDirection] = useState("Long");
  const [setupType, setSetupType] = useState("Pullback");
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
  const marketSpec = marketSpecs[profile.mainMarket] ?? marketSpecs.MNQ;
  const visualPlan = plannedTrade ?? activePosition ?? {
    contracts,
    direction,
    entry,
    runner: engine.runner,
    stop: engine.smartStop,
    target: engine.runner,
    trim1: engine.trim1,
    trim2: engine.trim2,
  };
  const missedEntry = getMissedEntryMessage({ currentPrice: price, plan: visualPlan });
  const rewardRisk = getRewardRisk({ plan: visualPlan, pointValue: marketSpec.pointValue });
  const simpleBias = engine.bias.includes("LONG") ? "LONG" : engine.bias.includes("SHORT") ? "SHORT" : "WAIT";
  const simpleAction = simpleBias === "LONG" ? "Look Long" : simpleBias === "SHORT" ? "Look Short" : "No trade";
  const setupName = `${setupType} ${setupDirection}`;
  const hasPlan = Boolean(plannedTrade || activePosition);
  const chartData = useMemo(
    () => buildChartData({ price, entry, stop: engine.smartStop, support, resistance, trim1: engine.trim1, trim2: engine.trim2, runner: engine.runner }),
    [engine.runner, engine.smartStop, engine.trim1, engine.trim2, entry, price, resistance, support],
  );
  const liveCoach = getLiveCoachMessage({ activePosition, discipline, engine, price, profile, visualPlan });
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

  return (
    <>
      {streamerMode ? (
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
        />
      ) : null}

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

      {layoutPrefs.chart ? <TradeChartPanel
        chartData={chartData}
        currentPrice={price}
        entry={entry}
        runner={engine.runner}
        stop={engine.smartStop}
        support={support}
        resistance={resistance}
        trim1={engine.trim1}
        trim2={engine.trim2}
      /> : null}

      <section style={styles.alphaTopGrid}>
        {layoutPrefs.score ? <div style={styles.scoreCard}>
          <p style={styles.cardLabel}>
            <span style={styles.labelWithHelp}>
              Trade Score
              <HelpTip text={tooltipText.tradeScore} />
            </span>
          </p>
          <h2 style={styles.scoreText}>{engine.score}/100</h2>
          <div style={{ ...styles.confidencePill, background: engine.confidenceColor }}>{engine.confidence}</div>
          <div style={styles.scoreTrack}>
            <div style={{ ...styles.scoreFill, width: `${engine.score}%`, background: engine.confidenceColor }} />
          </div>
        </div> : null}

        {layoutPrefs.coach ? <div style={styles.coachCard}>
          <p style={styles.cardLabel}>Trade Coach</p>
          <div style={styles.coachGrid}>
            <Metric label="Bias" tooltip={tooltipText.marketBias} value={simpleBias} tone={simpleBias === "WAIT" ? "warn" : "good"} />
            <Metric label="Market State" value={levelCoach.marketState} />
            <Metric label="Action" value={levelCoach.action === "WAIT" ? simpleAction : levelCoach.action} tone={simpleBias === "WAIT" ? "warn" : "good"} />
          </div>
          <p style={styles.coachMessage}>{levelCoach.message}</p>
        </div> : null}
      </section>

      {layoutPrefs.risk ? <section style={styles.rulesCard}>
        <div>
          <p style={styles.cardLabel}>Today&apos;s Trading Rules</p>
          <h2 style={styles.sectionTitle}>Stay inside your limits</h2>
        </div>
        <div style={styles.rulesGrid}>
          <Metric label="Max Trades" value={String(profile.maxTradesPerDay)} />
          <Metric label="Max Daily Loss" value={`$${profile.maxDailyLoss.toFixed(2)}`} />
          <Metric label="Current P/L" value={`$${discipline.dailyPnl.toFixed(2)}`} tone={discipline.dailyPnl >= 0 ? "good" : "bad"} />
          <Metric label="Risk Status" value={riskStatus} tone={riskStatus === "Good" ? "good" : riskStatus === "Warning" ? "warn" : "bad"} />
        </div>
      </section> : null}

      <section style={styles.alphaMiddleGrid}>
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
                <Metric label="Trade Score" tooltip={tooltipText.tradeScore} value={`${engine.score}/100`} />
              </div>
              {missedEntry ? <div style={styles.missedEntry}>{missedEntry}</div> : null}
            </>
          ) : (
            <p style={styles.emptyPlan}>No valid trade yet. Wait for price to reach support, resistance, breakout, or retest.</p>
          )}
        </section>

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

      <button onClick={() => setAdvancedOpen((value) => !value)} style={styles.advancedToggle}>
        Advanced Tools {advancedOpen ? "▲" : "▼"}
      </button>

      <div style={{ display: advancedOpen ? "block" : "none" }}>

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
                  if (checked && dataSource === "Manual") setDataSource("Market Data API");
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
            <span>Source: {autoPrice ? dataSource : "Manual"}</span>
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
              {!streamerMode ? <span>Balance: ${Number(brokerConnection.accountBalance || 0).toFixed(2)}</span> : null}
              <span>Open P/L: ${Number(brokerConnection.openPnl || 0).toFixed(2)}</span>
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

function calculateTrade({ activePosition, contracts, direction, discipline, entry, price, profile, resistance, riskPoints, support }) {
  const pointValue = pointValues[profile.mainMarket] || 2;
  const isLong = direction === "long";
  const inChop = price >= support && price <= resistance;
  const longTrigger = price > resistance;
  const shortTrigger = price < support;
  const directionAligned = (isLong && longTrigger) || (!isLong && shortTrigger);
  const distanceFromEntry = Math.abs(price - entry);
  const trim1 = isLong ? entry + profile.trim1Points : entry - profile.trim1Points;
  const trim2 = isLong ? entry + profile.trim2Points : entry - profile.trim2Points;
  const runner = isLong ? entry + profile.runnerPoints : entry - profile.runnerPoints;
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

function detectKeyLevelsFromCandles(candles = []) {
  // Future candle shape: { open, high, low, close, timestamp }
  // Later this can detect swing highs/lows, consolidation ranges, breakout zones, and pullback zones.
  return {
    breakoutLevel: null,
    pullbackSupport: null,
    recentHigh: null,
    source: candles.length ? "candle-data-placeholder" : "manual",
  };
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
    return { ratio: 0, risk: 0, trim1Reward: 0, trim2Reward: 0, runnerReward: 0 };
  }

  const contracts = plan.contracts || 1;
  const riskPoints = Math.abs(plan.entry - plan.stop);
  const risk = riskPoints * pointValue * contracts;
  const rewardFor = (target) => Math.abs(target - plan.entry) * pointValue * contracts;
  const runnerReward = rewardFor(plan.runner ?? plan.target ?? plan.entry);

  return {
    ratio: risk > 0 ? runnerReward / risk : 0,
    risk,
    trim1Reward: rewardFor(plan.trim1 ?? plan.entry),
    trim2Reward: rewardFor(plan.trim2 ?? plan.entry),
    runnerReward,
  };
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

function getLiveCoachMessage({ activePosition, discipline, engine, price, profile, visualPlan }) {
  if (discipline.dailyPnl <= -Math.abs(profile.maxDailyLoss)) return "Daily loss limit reached. Stop trading.";
  if (!visualPlan?.entry || !visualPlan?.stop) return "No active trade plan. Define entry, stop, and targets first.";
  if ((activePosition?.contracts || visualPlan.contracts || 0) > profile.maxContracts) return "High risk size detected. Reduce contracts.";

  const isLong = (activePosition?.direction || visualPlan.direction) !== "short";
  const stopHit = isLong ? price <= visualPlan.stop : price >= visualPlan.stop;
  const trim1Hit = isLong ? price >= visualPlan.trim1 : price <= visualPlan.trim1;

  if (stopHit) return "Stop area reached. Respect your plan.";
  if (trim1Hit) return "Trim 1 reached. Consider taking partial profit.";
  if (engine.bias.includes("WAIT")) return "Price is mid-range. Wait for support, resistance, or breakout.";
  return engine.autoCoaching[0] || "Hold plan. Let price reach a decision level.";
}

function TradeChartPanel({ chartData, currentPrice, entry, runner, stop, support, resistance, trim1, trim2 }) {
  return (
    <section style={styles.chartPanel}>
      <div style={styles.sectionHeader}>
        <div>
          <p style={styles.cardLabel}>Chart View</p>
          <h2 style={styles.sectionTitle}>Live Trade Map</h2>
        </div>
        <strong style={styles.chartPrice}>{Number(currentPrice).toFixed(2)}</strong>
      </div>
      <div style={styles.chartWrap}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 12, right: 22, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#1f2937" strokeDasharray="4 4" />
            <XAxis dataKey="label" hide />
            <YAxis domain={["dataMin - 12", "dataMax + 12"]} tick={{ fill: "#a1a1aa", fontSize: 12 }} width={64} />
            <Tooltip contentStyle={{ background: "#020617", border: "1px solid #334155", borderRadius: "10px", color: "#f8fafc" }} />
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
    </section>
  );
}

function LivestreamDashboard({ activePosition, brokerConnection, coachMessage, discipline, engine, price, profile, riskStatus, visualPlan }) {
  const positionLabel = activePosition ? `${activePosition.direction.toUpperCase()} ${activePosition.contracts}` : "No Position";
  const fundedMetrics = getFundedAccountMetrics({ brokerConnection, discipline, profile });

  return (
    <section style={styles.livestreamPanel}>
      <div>
        <p style={styles.cardLabel}>Livestream Dashboard</p>
        <h2 style={styles.livePrice}>{profile.mainMarket} {Number(price).toFixed(2)}</h2>
        <p style={styles.liveSubline}>{positionLabel} | Entry {Number(visualPlan.entry || 0).toFixed(2)}</p>
      </div>
      <div style={styles.liveMetricGrid}>
        <Metric label="Trade Score" value={`${engine.score}/100`} />
        <Metric label="Open P/L" value={`$${engine.openPnl.toFixed(2)}`} tone={engine.openPnl >= 0 ? "good" : "bad"} />
        <Metric label="Daily P/L" value={`$${fundedMetrics.dailyPnl.toFixed(2)}`} />
        <Metric label="Drawdown Left" value={`$${fundedMetrics.drawdownRemaining.toFixed(2)}`} />
        <Metric label="Risk Status" value={riskStatus} tone={riskStatus === "Good" ? "good" : "warn"} />
        <Metric label="Stop" value={Number(visualPlan.stop || engine.smartStop).toFixed(2)} />
        <Metric label="Trim 1" value={Number(visualPlan.trim1 || engine.trim1).toFixed(2)} />
        <Metric label="Runner" value={Number(visualPlan.runner || engine.runner).toFixed(2)} />
      </div>
      <div style={styles.liveCoach}>{coachMessage}</div>
    </section>
  );
}

function getSmartStop({ direction, entry, resistance, riskPoints, support }) {
  const isLong = direction === "long";
  const structureStop = isLong ? support - 1 : resistance + 1;
  const fallbackStop = isLong ? entry - riskPoints : entry + riskPoints;
  const useStructureStop = Math.abs(entry - structureStop) <= riskPoints * 1.5;

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
  if (connection.platform === "Tradovate Live Read-Only") return "Live Read-Only Connected";
  if (connection.platform === "Tradovate Demo Read-Only") return "Demo Connected";
  if (connection.platform === "TradingView Webhook") return "TradingView Connected";
  return `${connection.platform} Connected`;
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
  const dailyPnl = Number(discipline.dailyPnl || 0);
  const dailyLossLimit = Number(profile.maxDailyLoss || 0);
  const profitGoal = Number(profile.profitGoal || 0);
  const consistencyCap = profitGoal > 0 ? profitGoal * (Number(profile.consistencyRuleTarget || 30) / 100) : 0;

  return {
    accountBalance,
    consistencyCap,
    dailyLossLimit,
    dailyPnl,
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
  activePosition,
  brokerConnection,
  connectTradovateReadOnly,
  dataSource,
  discipline,
  engine,
  lastUpdated,
  price,
  profile,
  quote,
  startDemoBroker,
}) {
  const [tradovateStatus, setTradovateStatus] = useState(null);
  const statusLabel = getConnectionStatusLabel(brokerConnection);
  const position = brokerConnection.position || activePosition;
  const safetyWarnings = buildBrokerSafetyWarnings({ activePosition, brokerConnection, discipline, engine, profile });
  const fundedWarnings = buildFundedRuleWarnings({ brokerConnection, discipline, profile });
  const fundedMetrics = getFundedAccountMetrics({ brokerConnection, discipline, profile });

  const checkTradovateReadOnly = async () => {
    try {
      const response = await fetch(`${marketServerUrl}/api/tradovate/read-only/status`);
      setTradovateStatus(await response.json());
    } catch {
      setTradovateStatus({
        connected: false,
        provider: "Tradovate",
        security: "Start the local market server to inspect read-only readiness.",
      });
    }
  };

  return (
    <main style={styles.mainGrid}>
      <section style={styles.card}>
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
        <p style={{ ...styles.muted, marginTop: "14px" }}>Trade Pilot is a funded-account execution and risk assistant. It is not a broker or signal service.</p>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Connection Modes</p>
        <h2 style={styles.sectionTitle}>Read-Only Platform Paths</h2>
        <div style={styles.sourceGrid}>
          <SourceOption title="Manual Mode" text="Manually enter P/L, drawdown, and account stats." active={profile.fundedPlatform === "Manual Mode"} />
          <SourceOption title="CSV Import" text="Upload trade reports from supported platforms as a fallback." active={profile.fundedPlatform === "CSV Import"} />
          <SourceOption title="Tradovate Read-Only" text="Use Tradovate API access when enabled by the account/platform." active={profile.fundedPlatform === "Tradovate"} />
          <SourceOption title="Rithmic Read-Only" text="Prepared for a Rithmic API or third-party bridge integration." active={profile.fundedPlatform === "Rithmic"} />
          <SourceOption title="TopstepX Read-Only" text="Prepared for TopstepX API read-only account data." active={profile.fundedPlatform === "TopstepX"} />
          <SourceOption title="NinjaTrader/CQG Later" text="Reserved for future read-only platform support." active={profile.fundedPlatform === "NinjaTrader/CQG"} />
        </div>
      </section>

      <section style={styles.safetyCard}>
        <p style={styles.cardLabel}>Prop Firm Rule Monitor</p>
        <h2 style={styles.sectionTitle}>Protect the Payout</h2>
        <div style={styles.warningStack}>
          {(fundedWarnings.length ? fundedWarnings : ["Inside funded-account guardrails."]).map((warning) => (
            <div key={warning} style={warning.includes("Inside") ? styles.coachPrompt : styles.warningBox}>{warning}</div>
          ))}
        </div>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Connection Status</p>
        <h2 style={styles.sectionTitle}>{statusLabel}</h2>
        {brokerConnection.error ? <div style={styles.priceWarning}>{brokerConnection.error}</div> : null}
        <div style={styles.connectionGrid}>
          <Metric label="Market" value={profile.mainMarket} />
          <Metric label="Current Price" value={Number(price).toFixed(2)} />
          <Metric label="Bid" value={Number(quote.bid || 0).toFixed(2)} />
          <Metric label="Ask" value={Number(quote.ask || 0).toFixed(2)} />
          <Metric label="Position" value={position ? position.direction.toUpperCase() : "Flat"} />
          <Metric label="Entry" value={position ? Number(position.entry).toFixed(2) : "None"} />
          <Metric label="Contracts" value={String(position?.contracts ?? 0)} />
          <Metric label="Open P/L" value={`$${Number(brokerConnection.openPnl ?? engine.openPnl ?? 0).toFixed(2)}`} tone={Number(brokerConnection.openPnl ?? 0) >= 0 ? "good" : "bad"} />
          <Metric label="Realized P/L" value={`$${Number(brokerConnection.realizedPnl || 0).toFixed(2)}`} />
          <Metric label="Account Balance" value={`$${Number(brokerConnection.accountBalance || profile.accountSize).toFixed(2)}`} />
          <Metric label="Data Source" value={dataSource} />
          <Metric label="Last Updated" value={lastUpdated} />
        </div>
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
          <SourceOption title="Manual Mode" text="Use dashboard inputs, sliders, and Fast Mode without external broker data." active={dataSource === "Manual"} />
          <SourceOption title="Demo / Simulated Broker" text="Connects to the local demo stream for safe testing." active={brokerConnection.platform === "Demo Broker"} />
          <SourceOption title="Tradovate Demo Read-Only" text="Uses demo.tradovateapi.com/v1 and server-side credentials only." active={dataSource === tradovateModes.demo} />
          <SourceOption title="Tradovate Live Read-Only" text="Uses live.tradovateapi.com/v1 with order placement disabled." active={dataSource === tradovateModes.live} />
          <SourceOption title="TradingView Webhook Later" text="Accepts symbol, price, signal type, support, resistance, and timestamp." />
          <SourceOption title="CSV Import" text="Reserved for trade-history review and coaching analytics." />
        </div>
      </section>

      <section style={styles.card}>
        <p style={styles.cardLabel}>Phase 2</p>
        <h2 style={styles.sectionTitle}>Tradovate Read-Only Prep</h2>
        <p style={styles.muted}>Use your dedicated Tradovate API password. Broker credentials, API keys, and token status stay on the backend only.</p>
        <div style={{ ...styles.installBannerActions, marginTop: "16px" }}>
          <button onClick={() => connectTradovateReadOnly("demo")} style={styles.settingsButton}>Connect Demo Read-Only</button>
          <button onClick={() => connectTradovateReadOnly("live")} style={styles.dismissButton}>Connect Live Read-Only</button>
          <button onClick={checkTradovateReadOnly} style={styles.secondaryButton}>Check API Plan</button>
        </div>
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
    </main>
  );
}

function DataSourcePage({ applyAlert }) {
  const [webhookText, setWebhookText] = useState('{"symbol":"MNQ","price":27462,"direction":"long","support":27420,"resistance":27450,"signalType":"breakout"}');
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
        support: Number(parsed.support),
        resistance: Number(parsed.resistance),
        timestamp: parsed.timestamp,
        signalType: parsed.signalType,
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
          <SourceOption title="TradingView Alerts" text="Webhook alerts can send symbol, price, direction, support, resistance, and signal type." />
          <SourceOption title="Market Data API" text="Uses the local read-only market server at 127.0.0.1:8787 for streaming prices." />
          <SourceOption title="Broker Connection" text="Reads position, fill, account, and quote snapshots from a local platform bridge." />
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
        <p style={styles.cardLabel}>TradingView Webhook Mode</p>
        <h2 style={styles.sectionTitle}>Local Preview</h2>
        <p style={styles.muted}>Paste a sample alert payload to populate the dashboard.</p>
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
  const submit = (event) => {
    event.preventDefault();
    if (!note.trim()) return;
    addJournalEntry(note.trim());
    setNote("");
  };

  return (
    <main style={styles.mainGrid}>
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
          {journalEntries.slice(0, 8).map((entry) => (
            <PlanItem key={entry.id || entry.stamp} title={new Date(entry.stamp).toLocaleString()} text={`${entry.market || ""} ${entry.note || ""}`} />
          ))}
        </div>
      </section>
    </main>
  );
}

function ProfilePage({ profile, updateProfile }) {
  return (
    <section style={styles.card}>
      <p style={styles.cardLabel}>Profile</p>
      <h2 style={styles.sectionTitle}>Trader Settings</h2>
      <p style={{ ...styles.muted, marginBottom: "18px" }}>Saved locally on this device, and synced to your personal dashboard when signed in.</p>
      <ProfileFields profile={profile} updateProfile={updateProfile} />
    </section>
  );
}

function ProfileFields({ profile, updateProfile }) {
  return (
    <>
      <div style={styles.formGrid}>
        <Field label="Name" value={profile.traderName} onChange={(value) => updateProfile("traderName", value)} />
        <SelectField label="Experience Level" value={profile.traderExperienceLevel || "intermediate"} options={["beginner", "intermediate", "advanced"]} onChange={(value) => updateProfile("traderExperienceLevel", value)} />
        <SelectField label="Trader Style" value={profile.traderStyle} options={["scalper", "runner", "both"]} onChange={(value) => updateProfile("traderStyle", value)} />
        <SelectField label="Main Market" value={profile.mainMarket} options={["MNQ", "NQ", "ES"]} onChange={(value) => updateProfile("mainMarket", value)} />
        <SelectField label="Account Type" value={profile.accountType} options={["personal", "funded", "both", "prop"]} onChange={(value) => updateProfile("accountType", value)} />
        <SelectField label="Funded Provider" value={profile.fundedProvider} options={fundedProviders} onChange={(value) => updateProfile("fundedProvider", value)} />
        <SelectField label="Platform" value={profile.fundedPlatform} options={fundedPlatforms} onChange={(value) => updateProfile("fundedPlatform", value)} />
        <SelectField label="Account Phase" value={profile.accountPhase} options={["evaluation", "funded", "live"]} onChange={(value) => updateProfile("accountPhase", value)} />
        <Field label="Account Size" type="number" value={profile.accountSize} onChange={(value) => updateProfile("accountSize", value)} />
        <Field label="Starting Balance" type="number" value={profile.startingBalance} onChange={(value) => updateProfile("startingBalance", value)} />
        <Field label="Trailing Drawdown" type="number" value={profile.trailingDrawdown} onChange={(value) => updateProfile("trailingDrawdown", value)} />
        <Field label="Profit Goal" type="number" value={profile.profitGoal} onChange={(value) => updateProfile("profitGoal", value)} />
        <Field label="Consistency Rule Target %" type="number" value={profile.consistencyRuleTarget} onChange={(value) => updateProfile("consistencyRuleTarget", value)} />
        <Field label="Max Daily Loss" type="number" value={profile.maxDailyLoss} onChange={(value) => updateProfile("maxDailyLoss", value)} />
        <Field label="Max Risk Per Trade" type="number" value={profile.maxRiskPerTrade} onChange={(value) => updateProfile("maxRiskPerTrade", value)} />
        <Field label="Max Trades Per Day" type="number" value={profile.maxTradesPerDay} onChange={(value) => updateProfile("maxTradesPerDay", value)} />
        <Field label="Max Contracts" type="number" value={profile.maxContracts} onChange={(value) => updateProfile("maxContracts", value)} />
        <Field label="Default Contracts" type="number" value={profile.defaultContracts} onChange={(value) => updateProfile("defaultContracts", value)} />
        <Field label="Default Risk Points" type="number" value={profile.defaultRiskPoints} onChange={(value) => updateProfile("defaultRiskPoints", value)} />
        <Field label="Trim 1 Points" type="number" value={profile.trim1Points} onChange={(value) => updateProfile("trim1Points", value)} />
        <Field label="Trim 2 Points" type="number" value={profile.trim2Points} onChange={(value) => updateProfile("trim2Points", value)} />
        <Field label="Runner Points" type="number" value={profile.runnerPoints} onChange={(value) => updateProfile("runnerPoints", value)} />
      </div>
      <label style={styles.switchRow}>
        <input type="checkbox" checked={profile.voiceAlerts} onChange={(event) => updateProfile("voiceAlerts", event.target.checked)} />
        Voice alerts on/off
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
  return (
    <main style={styles.mainGrid}>
      <section style={styles.card}>
        <p style={styles.cardLabel}>Settings</p>
        <h2 style={styles.sectionTitle}>Safety Guardrails</h2>
        <ProfileFields profile={profile} updateProfile={updateProfile} />
      </section>
      <DataSourcePage applyAlert={applyAlert} />
      <section style={styles.card}>
        <p style={styles.cardLabel}>Future Compatibility</p>
        <h2 style={styles.sectionTitle}>Planned Infrastructure</h2>
        <PlanItem title="User Login" text="Reserved for future account identity and syncing." />
        <PlanItem title="Supabase Authentication" text="Can be added later without changing the local dashboard model." />
        <PlanItem title="Paid Subscriptions" text="Subscription gates can wrap premium pages and advanced analytics." />
        <PlanItem title="TradingView Webhooks" text="The current preview payload is structured for later server-side webhook handling." />
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
      Trading futures involves substantial risk. Trade Pilot is for education and trade planning only.
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
          <SelectField label="Account Type" value={profile.accountType} options={["personal", "funded", "both", "prop"]} onChange={(value) => updateProfile("accountType", value)} />
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
    padding: "max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))",
  },
  shell: {
    margin: "0 auto",
    maxWidth: "1240px",
  },
  header: {
    alignItems: "center",
    display: "flex",
    gap: "18px",
    justifyContent: "space-between",
    marginBottom: "22px",
    flexWrap: "wrap",
  },
  topActions: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    maxWidth: "720px",
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
    padding: "18px",
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
    padding: "14px",
    flexWrap: "wrap",
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
    background: "#f8fafc",
    border: "none",
    borderRadius: "12px",
    color: "#020617",
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
    lineHeight: 1,
    margin: 0,
  },
  subtitle: {
    color: "#a1a1aa",
    margin: "8px 0 0",
  },
  positioningText: {
    color: "#7dd3fc",
    fontSize: "13px",
    fontWeight: 800,
    margin: "6px 0 0",
  },
  settingsButton: {
    background: "#f8fafc",
    border: "none",
    borderRadius: "12px",
    color: "#020617",
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
    bottom: "22px",
    boxShadow: "0 18px 40px rgba(0,0,0,.35)",
    color: "#00111f",
    cursor: "pointer",
    fontWeight: 900,
    padding: "12px 16px",
    position: "fixed",
    right: "22px",
    zIndex: 15,
  },
  link: {
    color: "#7dd3fc",
    fontWeight: 800,
  },
  secondaryButton: {
    border: "1px solid #3f3f46",
    borderRadius: "12px",
    color: "white",
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
    gap: "16px",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    marginBottom: "16px",
  },
  alphaMiddleGrid: {
    display: "grid",
    gap: "16px",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    marginBottom: "16px",
  },
  rulesCard: {
    background: "rgba(15, 23, 42, .88)",
    border: "1px solid #334155",
    borderRadius: "16px",
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
    background: "linear-gradient(135deg, rgba(15, 23, 42, .98), rgba(2, 6, 23, .96))",
    border: "1px solid #334155",
    borderRadius: "18px",
    boxShadow: "0 22px 60px rgba(0,0,0,.42)",
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
    background: "#f8fafc",
    border: "none",
    borderRadius: "14px",
    color: "#020617",
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
    background: "rgba(24, 24, 27, .92)",
    border: "1px solid #27272a",
    borderRadius: "16px",
    boxShadow: "0 18px 45px rgba(0,0,0,.35)",
    padding: "22px",
  },
  chartPanel: {
    background: "rgba(2, 6, 23, .94)",
    border: "1px solid #334155",
    borderRadius: "16px",
    marginBottom: "16px",
    padding: "18px",
  },
  chartWrap: {
    height: "320px",
    minWidth: 0,
  },
  chartPrice: {
    color: "#facc15",
    fontSize: "28px",
  },
  livestreamPanel: {
    background: "linear-gradient(135deg, rgba(2,6,23,.98), rgba(12,74,110,.9))",
    border: "1px solid #38bdf8",
    borderRadius: "16px",
    display: "grid",
    gap: "18px",
    marginBottom: "16px",
    padding: "24px",
  },
  livePrice: {
    color: "#f8fafc",
    fontSize: "54px",
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
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
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
    background: "rgba(15, 23, 42, .94)",
    border: "1px solid #334155",
    borderRadius: "16px",
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
    background: "rgba(8, 47, 73, .78)",
    border: "1px solid #0e7490",
    borderRadius: "16px",
    padding: "24px",
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
    gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
    gap: "16px",
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
    color: "#a1a1aa",
    fontSize: "12px",
    fontWeight: 800,
    padding: "22px 0 8px",
    textAlign: "center",
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
    background: "#f8fafc",
    border: "none",
    borderRadius: "12px",
    color: "#020617",
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
