-- Wait five minutes after the Oslo open before the first simulator tick.
--
-- At 09:00 the market data feed can still report the previous close while the
-- opening auction settles. Shifting the schedule to minutes 05, 15, …, 55 and
-- gating on 09:05 Oslo time means the first tick sees an actual opening price.
-- The Edge Function repeats the same 09:05 guard for manual or retried calls.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'simulator-tick') then
    perform cron.unschedule('simulator-tick');
  end if;
end $$;

select cron.schedule(
  'simulator-tick',
  '5,15,25,35,45,55 6-16 * * 1-5',
  $job$
  select net.http_post(
    url := 'https://fljczgsafzbtjgeblahn.supabase.co/functions/v1/simulator-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(
        (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'simulator_cron_secret'
        ),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) as request_id
  where public.oslo_market_open_day((now() at time zone 'Europe/Oslo')::date)
    and (now() at time zone 'Europe/Oslo')::time >= time '09:05'
    and (now() at time zone 'Europe/Oslo')::time < time '16:31';
  $job$
);
