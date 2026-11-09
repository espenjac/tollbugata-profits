# Tollbugata Profits

Tollbugata Profits lager en **oppdatert handelsrapport for Oslo Børs** og en
manuell handelsdagbok. Appen screener hele Oslo Børs, scorer kandidatene,
vurderer børsmeldinger og lager en konkret plan med hele aksjer, kurtasje,
gevinstmål, tapsgrense og scenarier. Rapporten kan bygges på nytt når som
helst, også midt i handledagen.

Appen sender **aldri** ordrer. Den er et beslutningsstøtteverktøy, ikke
investeringsrådgivning.

## V2: React + Supabase

Aktiv app er en statisk React-PWA:

- **React 19 + Vite + TypeScript** i `web/`.
- **Supabase Auth med Google** for eier og inviterte brukere.
- **Supabase Postgres** med RLS for konto, handler, saldojusteringer,
  rapporter, innstillinger og papirhandel.
- **Tre Edge Functions**: `market-snapshot` henter TradingView, Euronext Growth
  og NewsWeb server-side og cacher svarene, `simulator-tick` kjører
  papirhandlerne på en `pg_cron`-plan, og `nordnet-quote` henter siste Nordnet-kurs
  til kjøpsknappene i journalen. NewsWeb blokkerer nettleser-CORS, derfor
  må markedsdata gå via Supabase.
- **GitHub Pages** publiserer `web/dist` uten eget domene.
- **PWA** med manifest, service worker og SPA-fallback via `404.html`.

Oppsett:

- [web/README.md](web/README.md) – lokal utvikling, bygg og frontendarkitektur.
- [supabase/README.md](supabase/README.md) – database, Google OAuth, Edge
  Function, GitHub Pages og engangsmigrering.

## Funksjoner

- To-lags screening: teknisk grunnscreen og kandidatfilter.
- Momentum-, breakout- og nyhetsdrevne kategorier.
- Mulighetsscore, risikoscore og samlet score.
- Én hovedkandidat, anbefalte alternativer og egne blokkerte kandidater.
- «Ingen anbefalte kandidater i dag – vurder å stå over» når ingen er gode nok.
- Nyhetsliste fra NewsWeb med enkel positiv/negativ/nøytral-analyse.
- Handelsplan med hele aksjer, kurtasje, mål, stop, reward/risk og scenarier.
- Standard er swingplan med 2–5 handledager. Stopen settes til 1,2 × ATR,
  begrenset til 4–6 %, og målet til 1,8 × stop, begrenset til 8–10 %.
  Planen sier også at stopen skal flyttes opp, trail under høyeste kurs, og at
  posisjonen skal ut etter 5 handledager hvis målet ikke er nådd. Helger er
  tillatt; fredager får et helgeflagg som minner om gaprisiko. Valgene kan
  endres i `web/src/core/config.ts` og `web/src/core/swing.ts`.
- Rapporten bygges alltid på nytt fra ferske markedsdata når appen åpnes eller
  når du laster siden på nytt. Lagrede rapporter brukes bare til historikk,
  aldri som gjeldende rapport.
- **Etrade-modus** på `/etrade` er en egen fane med kortsiktige long-ideer i
  samme stil: «kjøp over»-trigger, stop, tre delmål, ugyldig-nivå og
  posisjonsstørrelse. Ideene bruker ATR-basert stop på 3–5 %, mål på 2R/3,5R/5R
  og horisont 1–3 handledager. Kandidater som er overopphetet, har negativt
  nyhetsbilde, resultat innen to dager eller mål som ikke dekker kurtasjen,
  havner på «På radaren» i stedet for i de klare ideene. Etrade-ideene lagres
  ikke som historikk og bygges på nytt fra ferskeste kurs hver gang. Modusen er
  long only; short-ideer er bevisst ikke en del av appen.
- **Simulator** på `/simulator` viser to papirporteføljer, Swing og Etrade, som
  begge starter med 5 000 kr. En planlagt Edge Function sjekker markedet hvert
  tiende minutt, kjøper den beste anbefalingen i hver modus og selger etter
  stop, mål, trailing stop, delmål eller tidsstopp. Hver modus eier maks én
  aksje om gangen, betaler 29 kr i kurtasje hver vei og registrerer alle kjøp og
  salg. Fanen viser utviklingsgraf, nøkkeltall og separate handler per modus.
  Dette er fremoverrettet papirhandel, ikke backtesting, og ingen ekte ordrer
  sendes.
- Når børsen er åpen, cacher Edge Function skannerdata i 30 sekunder. Utenfor
  børstid brukes 10 minutter.
- Screening, filtre, nyhetsliste og aksjetabell er samlet i en sammenleggbar
  seksjon under rapporten for å redusere informasjonsmengden.
- Handelsdagbok på `/logg` med kjøp, salg, redigering, hurtigsalg,
  saldojustering og beholdning. Åpne posisjoner viser «Selg ved» med
  gevinstmål og stop regnet fra faktisk snittkost, hvor mange handledager
  posisjonen er holdt, og et tidsstopp-varsel etter 5 handledager.
- Kjøpsknapper på alle handlingsklare kandidater i både den vanlige rapporten
  og Etrade-fanen. Knappen henter siste Nordnet-kurs og åpner journalen med
  ticker, kurs og tidspunkt forhåndsutfylt. Du kontrollerer alltid antall og
  lagrer selv; ingen ordre sendes.
- Mobilvennlig PWA som kan installeres på hjemskjermen.

## Viktige avgrensninger

- Bare manuell registrering. Ingen automatisk handel, ingen ordre-API.
- Ingen JSON-filer, import/eksport eller innebygd backup i V2. All persistens
  er Supabase, og backup tas utenfor appen.
- Ingen pre-market-generering eller planlagt rapportgenerering. Hver
  forespørsel bygger rapporten på nytt fra ferskeste tilgjengelige data.
  `pg_cron` brukes bare til papirhandlerne i simulatoren.
- Backtest er ikke en del av V2-frontenden. Python-verktøyet beholdes som
  forskningsreferanse.
- `market_cache` er bare tilgjengelig for service role.
- Supabase free tier kan pauses etter sju dagers inaktivitet og har ikke
  automatisk backup.

## Utvikling

```bash
cd web
cp .env.example .env.local
# fyll inn VITE_SUPABASE_URL og VITE_SUPABASE_ANON_KEY
npm ci
npm run dev
```

Node 22 eller nyere kreves. Appen serveres på
`http://localhost:5173/tollbugata-profits/`.

```bash
cd web
npm test
npm run typecheck
npm run build
npm run build:edge
npm run preview
```

`npm run build:edge` bygger den delte TypeScript-kjernen til
`supabase/functions/simulator-tick/strategy.mjs`. Den genererte filen er
committet slik at `supabase functions deploy` ikke trenger et Node-bygg.
Kjør kommandoen på nytt etter endringer i simulator-, rapport- eller
screeningslogikken.

`npm test` kjører Vitest-paritetstester mot fixtures generert fra den gamle
Python-implementasjonen. Testene dekker screening og full rapport, inkludert
hovedkandidat, score, rangering og blokkerte kandidater, i tillegg til
simulatorens kjøp, salg, delmål og tidsstopp.

## Datamodell

- `profiles`, `accounts`, `settings`: én rad per bruker.
- `trades`: logg over kjøp og salg; redigering oppdaterer raden og setter
  `updated_at`.
- `cash_adjustments`: differansejusteringer mot bankens saldo.
- `reports`: `payload jsonb` og `unique(user_id, report_date)`. Dagens rapport
  oppdateres med ny payload og `generated_at` ved hver oppdatering.
- `account_balances`: derivert view for ledig kapital.
- `market_cache`: service-role-only cache for Edge Function.
- `sim_portfolios`: én delt papirportefølje per modus (`swing`, `etrade`) med
  kontanter, åpen posisjon og eventuell ventende trigger.
- `sim_trades`: append-only kjøp og salg med kurtasje og realisert resultat.
- `sim_equity`: egenkapital per tick med OSEBX-nivå; `sim_equity_daily` viser
  siste verdi per handledag for grafen, inkludert siste indeksnivå.
- `sim_ticks`: idempotent logg over hver planlagte kjøring.

## Legacy Python

Den gamle Python-implementasjonen ligger fortsatt i repoet som referanse for
paritet og backtest. Dokumentasjonen er flyttet til
[docs/legacy-python.md](docs/legacy-python.md).

Ved cutover kan `app.py`, HTTP-serveren, Docker/Render-oppsettet, JSON-dagboken
og filbaserte rapporter fjernes. `screener.py`, `backtest.py` og
`oslo_screener/` kan beholdes som lokale forskningsverktøy.

## Sikkerhet

- RLS på alle brukertabeller, begrenset til `auth.uid()`.
- `service_role` skal aldri inn i frontend, GitHub secrets eller committed
  miljøfiler.
- `market-snapshot` validerer JWT og kan begrenses med `ALLOWED_EMAILS`.
- Nye registreringer bør slås av når de inviterte brukerne har logget inn.
- Repositoryet kan gjøres offentlig, men sjekk git-historikk for hemmeligheter
  og brukerdata først.
