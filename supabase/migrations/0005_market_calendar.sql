-- Restrict the simulator cron job to actual Oslo Børs trading days.
--
-- The cron expression already limits the job to Monday–Friday, but it cannot
-- express Norwegian public holidays. This migration adds a small calendar
-- function and makes the job call the Edge Function only when the Oslo date is
-- an open trading day and the Oslo clock is inside the 09:00–16:30 session.
--
-- Oslo Børs is closed on New Year's Day, Maundy Thursday, Good Friday, Easter
-- Monday, Labour Day, Ascension Day, Constitution Day, Whit Monday, Christmas
-- Eve, Christmas Day, Boxing Day and New Year's Eve. Norway does not move a
-- holiday to the next weekday when it falls on a weekend, so no observed days
-- are added here.

-- Easter Sunday for a Gregorian year (Meeus/Jones/Butcher algorithm).
create or replace function public.easter_sunday(p_year integer)
returns date
language plpgsql
immutable
as $$
declare
  a integer := p_year % 19;
  b integer := p_year / 100;
  c integer := p_year % 100;
  d integer := b / 4;
  e integer := b % 4;
  f integer := (b + 8) / 25;
  g integer := (b - f + 1) / 3;
  h integer := (19 * a + b - d - g + 15) % 30;
  i integer := c / 4;
  k integer := c % 4;
  l integer := (32 + 2 * e + 2 * i - h - k) % 7;
  m integer := (a + 11 * h + 22 * l) / 451;
  v_month integer := (h + l - 7 * m + 114) / 31;
  v_day integer := ((h + l - 7 * m + 114) % 31) + 1;
begin
  return make_date(p_year, v_month, v_day);
end;
$$;

create or replace function public.oslo_market_open_day(p_day date)
returns boolean
language sql
immutable
as $$
  select
    extract(isodow from p_day) between 1 and 5
    and to_char(p_day, 'MM-DD') not in (
      '01-01', -- New Year's Day
      '05-01', -- Labour Day
      '05-17', -- Constitution Day
      '12-24', -- Christmas Eve
      '12-25', -- Christmas Day
      '12-26', -- Boxing Day
      '12-31'  -- New Year's Eve
    )
    and (p_day - public.easter_sunday(extract(year from p_day)::integer))
      not in (-3, -2, 1, 39, 50); -- Maundy Thu, Good Fri, Easter Mon, Ascension, Whit Mon
$$;

-- Recreate the job so the schedule condition applies immediately.
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
  ) as request_id
  where public.oslo_market_open_day((now() at time zone 'Europe/Oslo')::date)
    and (now() at time zone 'Europe/Oslo')::time >= time '09:00'
    and (now() at time zone 'Europe/Oslo')::time < time '16:31';
  $job$
);
