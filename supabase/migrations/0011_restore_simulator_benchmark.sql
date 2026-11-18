-- The Trend migration replaced apply_simulator_tick after benchmark persistence
-- was introduced, unintentionally dropping the benchmark from new equity rows.
-- Restore it for already-deployed databases and keep the three modes supported.

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
    if v_mode not in ('swing', 'etrade', 'trend') then
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
