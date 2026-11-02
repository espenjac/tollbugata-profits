-- Tollbugata Profits v2 schema. Run this in the Supabase SQL editor or with
-- `supabase db push`.
--
-- The app supports a closed set of invited Google users. Every table is
-- protected by row-level security scoped to auth.uid().

create extension if not exists pgcrypto;

do $$
begin
  create type public.trade_side as enum ('buy', 'sell');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  starting_cash numeric(14, 2) not null default 5000 check (starting_cash >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ticker text not null check (ticker ~ '^[A-Z0-9][A-Z0-9._-]{0,19}$'),
  side public.trade_side not null,
  quantity integer not null check (quantity > 0),
  price numeric(14, 4) not null check (price > 0),
  fee numeric(14, 2) not null default 0 check (fee >= 0),
  executed_at timestamptz not null,
  note text not null default '' check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trades_user_executed_idx
  on public.trades (user_id, executed_at, created_at);

create table if not exists public.cash_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  amount numeric(14, 2) not null,
  note text not null default '' check (char_length(note) <= 500),
  changed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists cash_adjustments_user_changed_idx
  on public.cash_adjustments (user_id, changed_at, created_at);

create table if not exists public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  scoring jsonb not null default '{}'::jsonb,
  trade jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  report_date date not null,
  generated_at timestamptz not null,
  main_ticker text,
  main_score numeric(6, 2),
  no_trade boolean not null default false,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, report_date)
);

create index if not exists reports_user_generated_idx
  on public.reports (user_id, generated_at desc);

-- Shared server-side cache for market-snapshot. Only the service role touches
-- this table; no RLS policy is intentionally created for anon/authenticated.
create table if not exists public.market_cache (
  key text primary key,
  payload jsonb not null,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  source text not null default 'live',
  created_at timestamptz not null default now()
);

revoke all on public.market_cache from anon, authenticated;
grant all on public.market_cache to service_role;

-- Derived balance. Available cash is never stored as a mutable field.
create or replace view public.account_balances
with (security_invoker = true) as
select
  a.user_id,
  a.starting_cash,
  a.starting_cash
    + coalesce(
        (
          select sum(
            case
              when t.side = 'buy' then -(t.quantity * t.price) - t.fee
              else (t.quantity * t.price) - t.fee
            end
          )
          from public.trades t
          where t.user_id = a.user_id
        ),
        0
      )
    + coalesce(
        (
          select sum(c.amount)
          from public.cash_adjustments c
          where c.user_id = a.user_id
        ),
        0
      ) as available_cash
from public.accounts a;

-- A new auth user gets a profile, an account and an empty settings row.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    )
  )
  on conflict (id) do nothing;

  insert into public.accounts (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.trades enable row level security;
alter table public.cash_adjustments enable row level security;
alter table public.settings enable row level security;
alter table public.reports enable row level security;
alter table public.market_cache enable row level security;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own account" on public.accounts;
create policy "own account" on public.accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own trades" on public.trades;
create policy "own trades" on public.trades
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own cash adjustments" on public.cash_adjustments;
create policy "own cash adjustments" on public.cash_adjustments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own settings" on public.settings;
create policy "own settings" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own reports" on public.reports;
drop policy if exists "read own reports" on public.reports;
drop policy if exists "insert own reports" on public.reports;
create policy "read own reports" on public.reports
  for select using (auth.uid() = user_id);
create policy "insert own reports" on public.reports
  for insert with check (auth.uid() = user_id);

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update, delete on public.trades to authenticated;
grant select, insert, update, delete on public.cash_adjustments to authenticated;
grant select, insert, update, delete on public.settings to authenticated;
grant select, insert, update, delete on public.reports to authenticated;
grant select on public.account_balances to authenticated;
grant select on public.profiles to service_role;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
