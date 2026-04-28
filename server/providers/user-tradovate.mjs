import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getTradovateContractName, readMarketDataQuote } from "./tradovate-readonly.mjs";

const endpoints = {
  demo: {
    apiBase: "https://demo.tradovateapi.com/v1",
    mdSocket: "wss://md-demo.tradovateapi.com/v1/websocket",
  },
  live: {
    apiBase: "https://live.tradovateapi.com/v1",
    mdSocket: "wss://md.tradovateapi.com/v1/websocket",
  },
};

const renewWindowMs = 15 * 60 * 1000;

function getSupabaseConfig() {
  return {
    key:
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  };
}

function getSupabaseClient(userToken) {
  const config = getSupabaseConfig();
  if (!config.url || !config.key) {
    const error = new Error("Supabase server environment variables are not configured.");
    error.status = 500;
    throw error;
  }

  return createClient(config.url, config.key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: userToken ? { headers: { Authorization: `Bearer ${userToken}` } } : undefined,
  });
}

function getBearerToken(request) {
  const header = request.headers.authorization || request.headers.Authorization || "";
  return String(header).replace(/^Bearer\s+/i, "").trim();
}

async function requireUser(request) {
  const token = getBearerToken(request);
  if (!token) {
    const error = new Error("Log in before connecting Tradovate.");
    error.status = 401;
    throw error;
  }

  const supabase = getSupabaseClient(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    const authError = new Error("Session expired. Log in again before connecting Tradovate.");
    authError.status = 401;
    throw authError;
  }

  return { supabase, token, user: data.user };
}

function getEncryptionKey() {
  const raw = process.env.TRADE_PILOT_BROKER_ENCRYPTION_KEY || process.env.BROKER_ENCRYPTION_KEY;
  if (!raw || raw.length < 24) {
    const error = new Error("Broker encryption key is not configured. Add TRADE_PILOT_BROKER_ENCRYPTION_KEY in Vercel.");
    error.status = 500;
    throw error;
  }
  return crypto.createHash("sha256").update(raw).digest();
}

function encrypt(value) {
  if (value === undefined || value === null || value === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decrypt(value) {
  if (!value) return "";
  const [version, ivText, tagText, encryptedText] = String(value).split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) return "";
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function normalizeAccountType(accountType = "demo") {
  const value = String(accountType || "demo").toLowerCase();
  if (["live", "personal", "personal live"].includes(value)) return "live";
  if (["funded", "prop", "eval", "evaluation", "funded/eval", "funded-live"].includes(value)) return "funded";
  return "demo";
}

function endpointFor(accountType) {
  return normalizeAccountType(accountType) === "demo" ? endpoints.demo : endpoints.live;
}

function requireCredentialFields(input) {
  const required = ["username", "password", "cid", "sec"];
  const missing = required.filter((key) => !input[key]);
  if (missing.length) {
    const error = new Error(`Missing Tradovate API fields: ${missing.join(", ")}.`);
    error.status = 400;
    throw error;
  }
}

async function tradovateFetch(connection, path, options = {}) {
  const endpoint = endpointFor(connection.account_type || connectionField(connection, "account_type"));
  const accessToken = decrypt(connectionField(connection, "access_token_encrypted"));
  if (!accessToken) {
    const error = new Error("Tradovate connection is missing a server-side access token.");
    error.status = 401;
    throw error;
  }

  const response = await fetch(`${endpoint.apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.errorText || "Tradovate read-only request failed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

function safeConnection(row, extra = {}) {
  if (!row) return { connected: false, connectionStatus: "Not Connected" };
  const meta = row.metadata?.tradovate || {};
  const connectionStatus = row.connection_status || meta.connection_status || row.status || "not_connected";
  return {
    accountName: row.account_name || meta.account_name || extra.accountName || "",
    accountType: row.account_type || meta.account_type,
    connected: connectionStatus === "connected",
    connectionStatus: connectionStatus === "connected" ? "Tradovate Connected" : connectionStatus,
    expirationTime: row.expiration_time || meta.expiration_time,
    hasFunded: Boolean(row.has_funded ?? meta.has_funded),
    hasLive: Boolean(row.has_live ?? meta.has_live),
    hasMarketData: Boolean(row.has_market_data ?? meta.has_market_data),
    mode: "read-only",
    providerName: row.metadata?.provider || meta.metadata?.provider || meta.provider || "",
    provider: "tradovate",
    readOnly: true,
    selectedAccountId: row.selected_account_id || meta.selected_account_id || "",
    username: row.username || meta.username || "",
    ...extra,
  };
}

function connectionField(connection, key) {
  return connection[key] ?? connection.metadata?.tradovate?.[key];
}

async function getStoredConnection(request) {
  const { supabase, user } = await requireUser(request);
  const { data, error } = await supabase
    .from("broker_connections")
    .select("*")
    .eq("user_id", user.id)
    .eq("provider", "tradovate")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    const missing = new Error("No Tradovate connection found for this user.");
    missing.status = 404;
    throw missing;
  }

  return { connection: await renewIfNeeded(supabase, data), supabase, user };
}

async function renewIfNeeded(supabase, connection) {
  const expiresAt = connection.expiration_time ? Date.parse(connection.expiration_time) : 0;
  if (!expiresAt || expiresAt > Date.now() + renewWindowMs) return connection;

  const accessToken = decrypt(connectionField(connection, "access_token_encrypted"));
  if (!accessToken) return connection;
  const endpoint = endpointFor(connection.account_type || connectionField(connection, "account_type"));
  const response = await fetch(`${endpoint.apiBase}/auth/renewaccesstoken`, {
    body: JSON.stringify({ accessToken }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.accessToken) return connection;

  const updates = {
    access_token_encrypted: encrypt(data.accessToken),
    expiration_time: data.expirationTime || connection.expiration_time,
    has_funded: Boolean(data.hasFunded ?? data.hasFundedAccount ?? data.hasEvaluationAccount ?? connection.has_funded),
    has_live: Boolean(data.hasLive ?? connection.has_live),
    has_market_data: Boolean(data.hasMarketData ?? connection.has_market_data),
    md_access_token_encrypted: encrypt(data.mdAccessToken || data.accessToken),
    updated_at: new Date().toISOString(),
  };
  const { data: updated, error } = await supabase
    .from("broker_connections")
    .update(updates)
    .eq("id", connection.id)
    .select("*")
    .single();

  return error ? connection : updated;
}

export async function connectUserTradovate(request, body) {
  const { supabase, user } = await requireUser(request);
  const input = {
    accountType: normalizeAccountType(body.accountType || body.environment),
    appId: body.appId || "trade-pilot",
    appVersion: body.appVersion || "1.0",
    cid: body.cid,
    deviceId: body.deviceId || "tradepilot-web",
    environment: body.environment || (normalizeAccountType(body.accountType) === "demo" ? "demo" : "live"),
    password: body.password,
    sec: body.sec,
    username: body.username,
  };
  requireCredentialFields(input);

  const endpoint = input.environment === "live" ? endpoints.live : endpointFor(input.accountType);
  const authBody = {
    appId: input.appId,
    appVersion: input.appVersion,
    cid: input.cid,
    deviceId: input.deviceId,
    name: input.username,
    password: input.password,
    sec: input.sec,
  };

  const response = await fetch(`${endpoint.apiBase}/auth/accesstokenrequest`, {
    body: JSON.stringify(authBody),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const auth = await response.json().catch(() => ({}));
  if (!response.ok || !auth.accessToken) {
    const error = new Error(auth.message || auth.errorText || "Tradovate API access is required for direct connection. Use Manual Mode or TradingView Webhook until enabled.");
    error.status = response.status || 401;
    throw error;
  }

  const accountResponse = await fetch(`${endpoint.apiBase}/account/list`, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
    },
  });
  const accounts = await accountResponse.json().catch(() => []);
  const accountList = Array.isArray(accounts) ? accounts : [];
  const selected = accountList[0] || {};
  const hasFunded = Boolean(auth.hasFunded ?? auth.hasFundedAccount ?? auth.hasEvaluationAccount ?? input.accountType === "funded");
  const tradovateHeaders = {
    Authorization: `Bearer ${auth.accessToken}`,
    "Content-Type": "application/json",
  };
  const selectedAccountId = selected.id ? String(selected.id) : "";
  const positions = selectedAccountId
    ? await fetch(`${endpoint.apiBase}/position/deps?masterid=${encodeURIComponent(selectedAccountId)}`, { headers: tradovateHeaders }).then((res) => res.json()).catch(() => [])
    : [];
  const fills = await fetch(`${endpoint.apiBase}/fill/list`, { headers: tradovateHeaders }).then((res) => res.json()).catch(() => []);
  const contractName = getTradovateContractName(body.symbol || "MNQ");
  const quote = auth.mdAccessToken
    ? await readMarketDataQuote({ socketUrl: endpoint.mdSocket, symbol: contractName, token: auth.mdAccessToken }).catch(() => null)
    : null;

  const row = {
    access_token_encrypted: encrypt(auth.accessToken),
    account_name: selected.name || selected.nickname || auth.name || input.username,
    account_type: input.accountType,
    app_id: input.appId,
    app_version: input.appVersion,
    connection_status: "connected",
    device_id: input.deviceId,
    encrypted_api_password: encrypt(input.password),
    encrypted_cid: encrypt(input.cid),
    encrypted_sec: encrypt(input.sec),
    expiration_time: auth.expirationTime || null,
    has_funded: hasFunded,
    has_live: Boolean(auth.hasLive),
    has_market_data: Boolean(auth.hasMarketData),
    md_access_token_encrypted: encrypt(auth.mdAccessToken || auth.accessToken),
    metadata: {
      accountCount: accountList.length,
      provider: body.provider || "",
      readOnly: true,
      selectedAccount: selected,
      userStatus: auth.userStatus,
    },
    mode: "read-only",
    platform: "Tradovate",
    provider: "tradovate",
    selected_account_id: selectedAccountId,
    status: "connected",
    updated_at: new Date().toISOString(),
    user_id: user.id,
    username: input.username,
  };

  let { data, error } = await supabase
    .from("broker_connections")
    .upsert(row, { onConflict: "user_id,provider" })
    .select("*")
    .single();
  if (error && /column|constraint|schema|provider/i.test(error.message || "")) {
    const fallback = await supabase
      .from("broker_connections")
      .upsert({
        account_type: input.accountType,
        metadata: {
          tradovate: row,
        },
        mode: "read-only",
        platform: "Tradovate",
        provider: "tradovate",
        status: "connected",
        updated_at: new Date().toISOString(),
        user_id: user.id,
      }, { onConflict: "user_id,platform" })
      .select("*")
      .single();
    data = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;

  return safeConnection(data, {
    accountName: row.account_name,
    accounts: accountList.map((account) => ({
      id: account.id,
      name: account.name || account.nickname || "Tradovate Account",
      type: account.accountType || account.type || input.accountType,
    })),
    fills: Array.isArray(fills) ? fills : [],
    message: hasFunded ? "Tradovate Connected. Funded / Eval detected. Read-only mode active." : "Tradovate Connected. Read-only mode active.",
    positions: Array.isArray(positions) ? positions : [],
    provider: body.provider || "",
    quote,
    symbol: contractName,
  });
}

export async function getUserTradovateStatus(request) {
  try {
    const { connection } = await getStoredConnection(request);
    return safeConnection(connection);
  } catch (error) {
    if (error.status === 404) return { connected: false, connectionStatus: "Not Connected", provider: "tradovate" };
    throw error;
  }
}

export async function getUserTradovateAccounts(request) {
  const { connection } = await getStoredConnection(request);
  const accounts = await tradovateFetch(connection, "/account/list");
  return {
    ...safeConnection(connection),
    accounts,
  };
}

export async function getUserTradovatePositions(request, accountIdInput = "") {
  const { connection } = await getStoredConnection(request);
  const accountId = accountIdInput || connectionField(connection, "selected_account_id");
  const path = accountId ? `/position/deps?masterid=${encodeURIComponent(accountId)}` : "/position/list";
  return {
    ...safeConnection(connection),
    positions: await tradovateFetch(connection, path),
  };
}

export async function getUserTradovateOrders(request) {
  const { connection } = await getStoredConnection(request);
  const orders = await tradovateFetch(connection, "/order/list");
  return {
    ...safeConnection(connection),
    orders: Array.isArray(orders) ? orders.filter((order) => !["Filled", "Canceled", "Rejected"].includes(order.ordStatus || order.status)) : orders,
  };
}

export async function getUserTradovateFills(request) {
  const { connection } = await getStoredConnection(request);
  return {
    ...safeConnection(connection),
    fills: await tradovateFetch(connection, "/fill/list"),
  };
}

export async function getUserTradovateQuote(request, symbol = "MNQ") {
  const { connection } = await getStoredConnection(request);
  const endpoint = endpointFor(connection.account_type || connectionField(connection, "account_type"));
  const mdAccessToken = decrypt(connectionField(connection, "md_access_token_encrypted"));
  const contractName = getTradovateContractName(symbol);
  const quote = mdAccessToken
    ? await readMarketDataQuote({ socketUrl: endpoint.mdSocket, symbol: contractName, token: mdAccessToken })
    : null;

  return {
    ...safeConnection(connection),
    quote,
    symbol: contractName,
  };
}

export async function disconnectUserTradovate(request) {
  const { supabase, user } = await requireUser(request);
  const { error } = await supabase
    .from("broker_connections")
    .delete()
    .eq("user_id", user.id)
    .eq("provider", "tradovate");
  if (error) throw error;
  return { connected: false, connectionStatus: "Disconnected", provider: "tradovate" };
}
