-- Paper-trading simulators for the swing and Etrade modes.
--
-- Each mode is a single shared portfolio seeded with 5 000 kr. The simulator
-- runs from an Edge Function every ten minutes while Oslo Børs is open; only
-- the service role can write, while invited users can read the portfolios,
-- trades and equity snapshots in the PWA.

create table if not exists public.sim_portfolios (
  mode text primary key check (mode in ('swing', 'etrade')),
  starting_cash numeric(14, 2) not null default 5000 check (starting_cash >= 0),
  cash numeric(14, 2) not null default 5000 check (cash >= 0),
  position jsonb,
  pending jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.sim_ticks (
  id uuid primary key,
  ran_at timestamptz not null,
  snapshot_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.sim_trades (
  id bigint generated always as identity primary key,
  tick_id uuid references public.sim_ticks (id) on delete cascade,
  mode text not null references public.sim_portfolios (mode) on delete cascade,
  ticker text not null,
  side text not null check (side in ('buy', 'sell')),
  quantity integer not null check (quantity > 0),
  price numeric(14, 4) not null check (price > 0),
  fee numeric(14, 2) not null default 0 check (fee >= 0),
  realized_pnl numeric(14, 2),
  reason text not null,
  executed_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sim_trades_mode_executed_idx
  on public.sim_trades (mode, executed_at desc);

create table if not exists public.sim_equity (
  id bigint generated always as identity primary key,
  tick_id uuid references public.sim_ticks (id) on delete cascade,
  mode text not null references public.sim_portfolios (mode) on delete cascade,
  cash numeric(14, 2) not null,
  position_value numeric(14, 2) not null,
  equity numeric(14, 2) not null,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (mode, recorded_at)
);

create index if not exists sim_equity_mode_recorded_idx
  on public.sim_equity (mode, recorded_at desc);

insert into public.sim_portfolios (mode)
values ('swing'), ('etrade')
on conflict (mode) do nothing;

-- One point per mode per Oslo calendar day, using the last tick of the day.
create or replace view public.sim_equity_daily
with (security_invoker = true) as
select distinct on (mode, day)
  mode,
  day,
  cash,
  position_value,
  equity,
  recorded_at
from (
  select
    mode,
    (recorded_at at time zone 'Europe/Oslo')::date as day,
    cash,
    position_value,
    equity,
    recorded_at
  from public.sim_equity
) snapshots
order by mode, day, recorded_at desc;

alter table public.sim_portfolios enable row level security;
alter table public.sim_ticks enable row level security;
alter table public.sim_trades enable row level security;
alter table public.sim_equity enable row level security;

drop policy if exists "read sim portfolios" on public.sim_portfolios;
create policy "read sim portfolios" on public.sim_portfolios
  for select to authenticated using (true);

drop policy if exists "read sim trades" on public.sim_trades;
create policy "read sim trades" on public.sim_trades
  for select to authenticated using (true);

drop policy if exists "read sim equity" on public.sim_equity;
create policy "read sim equity" on public.sim_equity
  for select to authenticated using (true);

drop policy if exists "read sim ticks" on public.sim_ticks;
create policy "read sim ticks" on public.sim_ticks
  for select to authenticated using (true);

revoke all on public.sim_portfolios from anon, authenticated;
revoke all on public.sim_ticks from anon, authenticated;
revoke all on public.sim_trades from anon, authenticated;
revoke all on public.sim_equity from anon, authenticated;

grant select on public.sim_portfolios to authenticated;
grant select on public.sim_ticks to authenticated;
grant select on public.sim_trades to authenticated;
grant select on public.sim_equity to authenticated;
grant select on public.sim_equity_daily to authenticated;

grant all on public.sim_portfolios to service_role;
grant all on public.sim_ticks to service_role;
grant all on public.sim_trades to service_role;
grant all on public.sim_equity to service_role;
grant select on public.sim_equity_daily to service_role;
grant usage, select on all sequences in schema public to service_role;

-- The Edge Function sends the complete tick result in one transaction. The
-- tick id makes retries idempotent: a repeated call is ignored instead of
-- applying the same buys and sells twice.
create or replace function public.apply_simulator_tick(p_tick jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tick_id uuid := (p_tick ->> 'tickId')::uuid;
  v_ran_at timestamptz := coalesce((p_tick ->> 'ranAt')::timestamptz, now());
  v_snapshot_at timestamptz := (p_tick ->> 'snapshotAt')::timestamptz;
  v_portfolio jsonb;
  v_trade jsonb;
  v_mode text;
begin
  if v_tick_id is null then
    raise exception 'tickId is required';
  end if;

  insert into public.sim_ticks (id, ran_at, snapshot_at, summary)
  values (
    v_tick_id,
    v_ran_at,
    v_snapshot_at,
    coalesce(p_tick -> 'summary', '{}'::jsonb)
  )
  on conflict (id) do nothing;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'duplicate');
  end if;

  for v_portfolio in
    select value from jsonb_array_elements(coalesce(p_tick -> 'portfolios', '[]'::jsonb))
  loop
    v_mode := v_portfolio ->> 'mode';
    if v_mode not in ('swing', 'etrade') then
      raise exception 'unknown simulator mode: %', v_mode;
    end if;

    update public.sim_portfolios
    set
      cash = coalesce((v_portfolio #>> '{state,cash}')::numeric, cash),
      position = v_portfolio #> '{state,position}',
      pending = v_portfolio #> '{state,pending}',
      updated_at = v_ran_at
    where mode = v_mode;

    for v_trade in
      select value from jsonb_array_elements(coalesce(v_portfolio -> 'trades', '[]'::jsonb))
    loop
      insert into public.sim_trades (
        tick_id,
        mode,
        ticker,
        side,
        quantity,
        price,
        fee,
        realized_pnl,
        reason,
        executed_at
      )
      values (
        v_tick_id,
        v_mode,
        v_trade ->> 'ticker',
        v_trade ->> 'side',
        (v_trade ->> 'quantity')::integer,
        (v_trade ->> 'price')::numeric,
        coalesce((v_trade ->> 'fee')::numeric, 0),
        (v_trade ->> 'realizedPnl')::numeric,
        v_trade ->> 'reason',
        coalesce((v_trade ->> 'executedAt')::timestamptz, v_ran_at)
      );
    end loop;

    insert into public.sim_equity (
      tick_id,
      mode,
      cash,
      position_value,
      equity,
      recorded_at
    )
    values (
      v_tick_id,
      v_mode,
      (v_portfolio #>> '{equity,cash}')::numeric,
      (v_portfolio #>> '{equity,positionValue}')::numeric,
      (v_portfolio #>> '{equity,equity}')::numeric,
      v_ran_at
    )
    on conflict (mode, recorded_at) do nothing;
  end loop;

  return jsonb_build_object('applied', true);
end;
$$;

revoke all on function public.apply_simulator_tick(jsonb) from public, anon, authenticated;
grant execute on function public.apply_simulator_tick(jsonb) to service_role;
