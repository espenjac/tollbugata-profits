# Supabase-oppsett for V2

Appen bruker Supabase til:

- Google-innlogging.
- `accounts`, `trades`, `cash_adjustments`, `reports`, `settings` og `profiles`.
- `market_cache`, som bare Edge Function med service role kan lese.
- `sim_portfolios`, `sim_trades`, `sim_equity` og `sim_ticks` for de to
  papirporteføljene. Inviterte brukere kan lese; bare service role kan skrive.
- Edge Function `market-snapshot`, som henter TradingView, Euronext Growth og
  NewsWeb server-side fordi NewsWeb blokkerer nettleser-CORS.
- Edge Function `simulator-tick`, som kjører papirhandlene på en `pg_cron`-plan.
- Edge Function `nordnet-quote`, som henter siste Nordnet-kurs til
  kjøpsknappene i journalen.

## 1. Opprett prosjekt

Opprett et gratis Supabase-prosjekt. Noter:

- Project URL: `https://<project-ref>.supabase.co`
- Anon public key
- Project ref

`service_role` skal aldri brukes i frontend.

## 2. Kjør migreringen

Enten lim inn SQL-filene i `migrations/` i SQL Editor, eller bruk Supabase CLI:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Migreringen lager tabeller, RLS-policyer, `account_balances`-viewet og en
trigger som oppretter profil, konto og innstillinger for nye brukere.
`0002_report_updates.sql` legger til update-policy på `reports`, slik at dagens
rapport kan erstattes med nyere kurs. `0003_simulator.sql` lager tabellene for
papirhandel og den idempotente `apply_simulator_tick`-funksjonen.
`0004_simulator_cron.sql` aktiverer `pg_cron`/`pg_net` og planlegger
simulatorkjøringen. `0005_market_calendar.sql` legger til kalenderfunksjonen
som begrenser jobben til faktiske handledager på Oslo Børs.
`0006_simulator_open_delay.sql` flytter første kjøring til 09:05, slik at
åpningsauksjonen er ferdig før simulatoren bruker en kurs.
`0007_simulator_benchmark.sql` lagrer OSEBX-indeksen sammen med hver
egenkapitalmåling, slik at grafen kan sammenligne porteføljene med børsen.
`0009_add_trend_simulator.sql` legger til Trend-porteføljen og oppdaterer den
idempotente tick-funksjonen til å godta den nye modusen.

## 3. Google-innlogging

1. Lag en OAuth-klient i Google Cloud Console.
2. Legg inn dette som autorisert redirect-URI:

   ```text
   https://<project-ref>.supabase.co/auth/v1/callback
   ```

3. Aktiver Google i Supabase under **Authentication → Providers** og lim inn
   client ID og client secret.
4. Under **Authentication → URL Configuration**:

   ```text
   Site URL:      https://<github-bruker>.github.io/tollbugata-profits/
   Redirect URLs: http://localhost:5173/**
                  http://localhost:4173/**
                  https://<github-bruker>.github.io/tollbugata-profits/**
   ```

5. Logg inn med eierens Google-konto. Hvis flere skal bruke appen, la dem logge
   inn én gang mens registrering er tillatt.
6. Slå deretter av **Allow new users to sign up** i Supabase. Da kan bare
   eksisterende brukere logge inn. Hver bruker får egne rapporter, handler og
   innstillinger; RLS hindrer brukere fra å lese hverandres rader. For å legge
   til en ny bruker senere, slå midlertidig på registrering, la brukeren logge
   inn, og slå den av igjen.

## 4. Deploy Edge Functions

```bash
supabase secrets set ALLOWED_EMAILS=<eierens-google-epost>,<annen-bruker>
supabase functions deploy market-snapshot
supabase functions deploy nordnet-quote
```

`SUPABASE_URL` og `SUPABASE_SERVICE_ROLE_KEY` settes automatisk av Supabase.
`ALLOWED_EMAILS` er en kommaseparert liste over kontoer som får bruke
markedsfunksjonen og Nordnet-kursen. `OWNER_EMAIL` støttes fortsatt som fallback
for én adresse. Uten noen av dem kan alle autentiserte brukere kalle
funksjonene. Kontoer som ikke står i listen får 403, og appen viser «Denne
kontoen har ikke tilgang. Kontakt eieren for å bli lagt til.»

Funksjonen cacher TradingView i 10 minutter, NewsWeb i 5 minutter og
Euronext Growth i 24 timer. Ved feil brukes gammel cache med advarsel når den
finnes.

`nordnet-quote` tar `{ "ticker": "EQNR", "slug": "equinor-eqnr-xosl" }` og
returnerer siste kurs, bid, ask, sluttkurs og tidsstempel. Nordnet har ingen
åpen, uautentisert kurs-API, så funksjonen leser prissnapshottet som ligger i
den offentlige aksjesiden. Når markedet er stengt og Nordnet rapporterer
`last: 0`, brukes siste sluttkurs. Funksjonen krever innlogget bruker og samme
allowlist som `market-snapshot`.

## 5. Simulator og pg_cron

Simulatoren har tre delte papirporteføljer: `swing`, `etrade` og `trend`. Alle
starter med 5 000 kr. `simulator-tick` henter ferske markedsdata, bygger hvert
modus sitt signal og skriver kjøp, salg og egenkapital til Supabase. Den sender
aldri ordrer til en megler.

1. Bygg den delte TypeScript-kjernen til Edge Function:

   ```bash
   cd web
   npm run build:edge
   ```

   Dette oppdaterer `supabase/functions/simulator-tick/strategy.mjs`. Kjør
   kommandoen på nytt etter endringer i simulator-, rapport- eller
   screeningslogikken.

2. Sett to tilfeldige hemmeligheter:

   ```bash
   supabase secrets set \
     SIMULATOR_SECRET=<lang-tilfeldig-verdi> \
     CRON_SECRET=<annen-lang-tilfeldig-verdi>
   ```

   `SIMULATOR_SECRET` brukes når `simulator-tick` kaller `market-snapshot`
   server-til-server. `CRON_SECRET` brukes av `pg_cron` mot `simulator-tick`.

3. Deploy begge funksjonene:

   ```bash
   supabase functions deploy market-snapshot
   supabase functions deploy simulator-tick --no-verify-jwt
   ```

4. Legg samme verdi som `CRON_SECRET` i Supabase Vault, slik at cron-jobben
   kan lese den uten at hemmeligheten ligger i en migrering:

   ```sql
   select vault.create_secret('<samme-som-CRON_SECRET>', 'simulator_cron_secret');
   ```

   Hvis navnet finnes fra før:

   ```sql
   select vault.update_secret(
     (select id from vault.secrets where name = 'simulator_cron_secret'),
     '<samme-som-CRON_SECRET>'
   );
   ```

5. `0004_simulator_cron.sql` oppretter jobben, `0005_market_calendar.sql`
   begrenser den til faktiske handledager, og
   `0006_simulator_open_delay.sql` flytter første kjøring til 09:05, mens
   `0008_simulator_five_minute_schedule.sql` øker frekvensen til hvert femte
   minutt. `0009_add_trend_simulator.sql` legger til Trend-porteføljen.
   Kontroller den:

   ```sql
   select jobid, jobname, schedule, active
   from cron.job
   where jobname = 'simulator-tick';

   select status, return_message, start_time
   from cron.job_run_details
   order by start_time desc
   limit 10;
   ```

Jobben kjører `5,10,15,20,25,30,35,40,45,50,55 6-16 * * 1-5` UTC, men kaller bare Edge
Function når `public.oslo_market_open_day(...)` sier at datoen er en handledag
og Oslo-klokken er mellom 09:05 og 16:30. Det gir åpningsauksjonen fem minutter
før første kjøring og holder jobben borte på lørdag, søndag og norske
helligdager som 1. mai, 17. mai, Kristi himmelfartsdag, pinse og julen. Den
brede UTC-planen dekker både sommer- og vintertid, mens tidssjekken og Edge
Functionens egen kalender og ferskhetssjekk hindrer kjøringer utenfor børsens
åpningstid. Hver kjøring er idempotent via `sim_ticks.id`: en gjentatt
forespørsel med samme tick-id blir ignorert.

Manuell test fra en maskin med `CRON_SECRET` tilgjengelig:

```bash
curl -X POST \
  https://<project-ref>.supabase.co/functions/v1/simulator-tick \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{}'
```

Du kan også se og oppdatere resultatene i appens `/simulator`-fane. Grafen
bruker `sim_equity_daily`, som viser siste simulerte verdi per handledag, og
tegner OSEBX-indeksen normalisert til samme 5 000 kr-startverdi.

## 6. GitHub Pages

Repository → **Settings → Pages** → **Build and deployment** → **Source:
GitHub Actions**.

GitHub Pages uten eget domene krever et offentlig repository på gratisplanen.
Gjør repositoryet offentlig, eller bruk en betalt plan, før deployment.

Legg inn disse repository secrets:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Workflowen `.github/workflows/deploy.yml` tester, bygger `web/` og publiserer
`web/dist` til:

```text
https://<github-bruker>.github.io/tollbugata-profits/
```

`web/public/404.html` gjør at dype lenker som `/logg` fungerer på GitHub Pages
uten server-side rewrites.

## 7. Engangsmigrering av gammel dagbok

Den gamle Python-dagboken har fire handler i `data/journal.json`, og
`reports/premarket/` har eldre rapporter. Når eieren har logget inn og fått en
rad i `auth.users`, kan begge deler legges inn med service role:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
OWNER_EMAIL=<eierens-google-epost> \
python3 scripts/migrate_legacy_journal.py

SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
OWNER_EMAIL=<eierens-google-epost> \
python3 scripts/migrate_legacy_reports.py
```

Skriptene er idempotente: de hopper over rader som finnes fra før.
Journal-skriptet bruker `STARTING_CASH=5000` som standard og importerer ikke
null-justeringen i den gamle filen. Rapport-skriptet konverterer Python-formatet
(snake_case og prosenttall) til V2-formatet (camelCase og desimaltall) og
beholder rapportdatoen i Oslo-tid. Kjør det etter at første V2-rapport er
opprettet, eller før; rapporten for en dato oppdateres hvis du senere laster
siden på nytt i appen.

## Gratisnivå

Supabase free tier holder for noen få brukere: 500 MB database, 5 GB egress og
500 000 Edge Function-kall per måned. Simulatoren bruker omtrent 1 500 kall i
måneden, godt innenfor grensen. Prosjektet kan pauses etter sju dagers
inaktivitet og har ikke automatisk backup. `pg_cron` kjører ikke mens prosjektet
er pauset, så åpne appen jevnlig eller vekk prosjektet eksternt hvis
simuleringen skal gå uavbrutt.
