-- Run paper-trading ticks every five minutes during the Oslo Børs session.
-- Keep the 09:05 first tick, Oslo holiday/weekend checks and DST-safe local-time
-- gate from the existing schedule.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'simulator-tick') then
    perform cron.unschedule('simulator-tick');
  end if;
end $$;

select cron.schedule(
  'simulator-tick',
  '5,10,15,20,25,30,35,40,45,50,55 6-16 * * 1-5',
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
