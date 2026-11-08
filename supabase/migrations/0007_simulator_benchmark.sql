-- Persist the Oslo Børs benchmark (OSEBX) with each simulator equity snapshot
-- so the chart can compare the paper portfolios with the index.
--
-- The benchmark is an index level, not a krone amount. The PWA normalizes it to
-- the same 5 000 kr starting value as the two portfolios before drawing it.

alter table public.sim_equity
  add column if not exists benchmark numeric(14, 4);

-- One point per mode per Oslo calendar day, using the last tick of the day.
-- A tick where the index lookup failed stores a null benchmark, so fall back to
-- the last non-null value from the same day.
create or replace view public.sim_equity_daily
with (security_invoker = true) as
with snapshots as (
  select
    mode,
    (recorded_at at time zone 'Europe/Oslo')::date as day,
    cash,
    position_value,
    equity,
    benchmark,
    recorded_at
  from public.sim_equity
),
latest as (
  select distinct on (mode, day)
    mode,
    day,
    cash,
    position_value,
    equity,
    benchmark,
    recorded_at
  from snapshots
  order by mode, day, recorded_at desc
),
latest_benchmark as (
  select distinct on (mode, day)
    mode,
    day,
    benchmark
  from snapshots
  where benchmark is not null
  order by mode, day, recorded_at desc
)
select
  latest.mode,
  latest.day,
  latest.cash,
  latest.position_value,
  latest.equity,
  latest.recorded_at,
  coalesce(latest.benchmark, latest_benchmark.benchmark) as benchmark
from latest
left join latest_benchmark using (mode, day);

grant select on public.sim_equity_daily to authenticated;
grant select on public.sim_equity_daily to service_role;

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
  v_benchmark numeric := nullif(p_tick ->> 'benchmark', '')::numeric;
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
      benchmark,
      recorded_at
    )
    values (
      v_tick_id,
      v_mode,
      (v_portfolio #>> '{equity,cash}')::numeric,
      (v_portfolio #>> '{equity,positionValue}')::numeric,
      (v_portfolio #>> '{equity,equity}')::numeric,
      v_benchmark,
      v_ran_at
    )
    on conflict (mode, recorded_at) do nothing;
  end loop;

  return jsonb_build_object('applied', true);
end;
$$;

revoke all on function public.apply_simulator_tick(jsonb) from public, anon, authenticated;
grant execute on function public.apply_simulator_tick(jsonb) to service_role;
