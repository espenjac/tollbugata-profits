-- Schedule the paper-trading simulator every ten minutes on weekdays.
--
-- The Edge Function itself checks that Oslo Børs is open and that the market
-- snapshot is fresh, so the UTC window can be wider than the actual session
-- and still cover both summer and winter time.
--
-- Before this job can call the function, store the same value as the
-- CRON_SECRET function secret in Supabase Vault:
--
--   select vault.create_secret('<long-random-value>', 'simulator_cron_secret');
--
-- If the name already exists, update it instead:
--
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'simulator_cron_secret'),
--     '<long-random-value>'
--   );

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'simulator-tick') then
    perform cron.unschedule('simulator-tick');
  end if;
end $$;

select cron.schedule(
  'simulator-tick',
  '*/10 6-16 * * 1-5',
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
  ) as request_id;
  $job$
);
