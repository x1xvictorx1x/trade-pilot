create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  trader_experience_level text default 'intermediate',
  preferred_market text default 'MNQ',
  account_type text default 'personal',
  account_size numeric default 50000,
  trader_style text default 'scalper',
  max_daily_loss numeric default 500,
  max_trades_per_day integer default 5,
  default_contracts integer default 1,
  default_risk_points numeric default 10,
  trim1_points numeric default 10,
  trim2_points numeric default 20,
  runner_points numeric default 35,
  voice_alerts boolean default true,
  streamer_mode boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.trade_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  selected_market text default 'MNQ',
  support numeric,
  resistance numeric,
  risk_settings jsonb default '{}'::jsonb,
  coach_preferences jsonb default '{}'::jsonb,
  preferred_layout jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  unique(user_id)
);

create table if not exists public.trade_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan jsonb not null default '{}'::jsonb,
  status text default 'active',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.trade_journal (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create table if not exists public.broker_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text,
  platform text not null,
  account_type text default 'personal',
  username text,
  encrypted_api_password text,
  encrypted_cid text,
  encrypted_sec text,
  app_id text,
  app_version text,
  device_id text,
  access_token_encrypted text,
  md_access_token_encrypted text,
  expiration_time timestamptz,
  has_live boolean default false,
  has_funded boolean default false,
  has_market_data boolean default false,
  connection_status text default 'not_connected',
  account_name text,
  selected_account_id text,
  mode text default 'read-only',
  status text default 'not_connected',
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, platform),
  unique(user_id, provider)
);

alter table public.broker_connections add column if not exists username text;
alter table public.broker_connections add column if not exists encrypted_api_password text;
alter table public.broker_connections add column if not exists encrypted_cid text;
alter table public.broker_connections add column if not exists encrypted_sec text;
alter table public.broker_connections add column if not exists app_id text;
alter table public.broker_connections add column if not exists app_version text;
alter table public.broker_connections add column if not exists device_id text;
alter table public.broker_connections add column if not exists access_token_encrypted text;
alter table public.broker_connections add column if not exists md_access_token_encrypted text;
alter table public.broker_connections add column if not exists expiration_time timestamptz;
alter table public.broker_connections add column if not exists has_live boolean default false;
alter table public.broker_connections add column if not exists has_funded boolean default false;
alter table public.broker_connections add column if not exists has_market_data boolean default false;
alter table public.broker_connections add column if not exists connection_status text default 'not_connected';
alter table public.broker_connections add column if not exists account_name text;
alter table public.broker_connections add column if not exists selected_account_id text;
create unique index if not exists broker_connections_user_provider_key on public.broker_connections(user_id, provider);

create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  notes text,
  created_at timestamptz default now(),
  unique(user_id, symbol)
);

create table if not exists public.subscriber_list (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  trader_type text default 'intermediate',
  market_traded text default 'MNQ',
  timestamp timestamptz default now()
);

create table if not exists public.tradingview_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  symbol text not null,
  price numeric not null,
  timeframe text,
  support numeric,
  resistance numeric,
  bias text,
  entry numeric,
  stop numeric,
  targets jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

alter table public.profiles alter column account_type set default 'personal';

alter table public.profiles enable row level security;
alter table public.trade_settings enable row level security;
alter table public.trade_plans enable row level security;
alter table public.trade_journal enable row level security;
alter table public.broker_connections enable row level security;
alter table public.watchlist enable row level security;
alter table public.subscriber_list enable row level security;
alter table public.tradingview_signals enable row level security;

drop policy if exists "profiles are private" on public.profiles;
drop policy if exists "settings are private" on public.trade_settings;
drop policy if exists "plans are private" on public.trade_plans;
drop policy if exists "journal is private" on public.trade_journal;
drop policy if exists "broker connections are private" on public.broker_connections;
drop policy if exists "watchlist is private" on public.watchlist;
drop policy if exists "subscribers can add themselves" on public.subscriber_list;
drop policy if exists "subscribers can read own row" on public.subscriber_list;
drop policy if exists "service role manages tradingview signals" on public.tradingview_signals;

create policy "profiles are private" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "settings are private" on public.trade_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "plans are private" on public.trade_plans for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "journal is private" on public.trade_journal for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "broker connections are private" on public.broker_connections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "watchlist is private" on public.watchlist for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "subscribers can add themselves" on public.subscriber_list for insert with check (auth.uid() = user_id or user_id is null);
create policy "subscribers can read own row" on public.subscriber_list for select using (auth.uid() = user_id);
create policy "service role manages tradingview signals" on public.tradingview_signals for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
