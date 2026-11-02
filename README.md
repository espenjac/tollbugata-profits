# Tollbugata Profits

Tollbugata Profits lager en **pre-market daytrading-rapport for Oslo Børs** og
en manuell handelsdagbok. Appen screener hele Oslo Børs, scorer kandidatene,
vurderer børsmeldinger og lager en konkret plan med hele aksjer, kurtasje,
gevinstmål, tapsgrense og scenarier.

Appen sender **aldri** ordrer. Den er et beslutningsstøtteverktøy, ikke
investeringsrådgivning.

## V2: React + Supabase

Aktiv app er en statisk React-PWA:

- **React 19 + Vite + TypeScript** i `web/`.
- **Supabase Auth med Google** for eier og inviterte brukere.
- **Supabase Postgres** med RLS for konto, handler, saldojusteringer,
  rapporter og innstillinger.
- **Én Edge Function**, `market-snapshot`, henter TradingView, Euronext Growth
  og NewsWeb server-side og cacher svarene. NewsWeb blokkerer nettleser-CORS,
  derfor må den gå via Supabase.
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
- Dagens rapport lagres første gang appen åpnes. Rapporten er uforanderlig og
  brukes som historikk senere samme dag.
- Filtre påvirker aksjetabellen og nyhetslisten, men endrer ikke en allerede
  lagret rapport.
- Handelsdagbok på `/logg` med kjøp, salg, redigering, hurtigsalg,
  saldojustering og beholdning. Ledig kapital beregnes fra startkapital,
  handler og justeringer.
- Mobilvennlig PWA som kan installeres på hjemskjermen.

## Viktige avgrensninger

- Bare manuell registrering. Ingen automatisk handel, ingen ordre-API.
- Ingen JSON-filer, import/eksport eller innebygd backup i V2. All persistens
  er Supabase, og backup tas utenfor appen.
- Ingen planlagt rapportgenerering eller cron. Rapporten lages når appen åpnes.
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
npm run preview
```

`npm test` kjører Vitest-paritetstester mot fixtures generert fra den gamle
Python-implementasjonen. Testene dekker screening og full rapport, inkludert
hovedkandidat, score, rangering og blokkerte kandidater.

## Datamodell

- `profiles`, `accounts`, `settings`: én rad per bruker.
- `trades`: logg over kjøp og salg; redigering oppdaterer raden og setter
  `updated_at`.
- `cash_adjustments`: differansejusteringer mot bankens saldo.
- `reports`: `payload jsonb` og `unique(user_id, report_date)`. Første rapport
  for en lokal Oslo-dag vinner.
- `account_balances`: derivert view for ledig kapital.
- `market_cache`: service-role-only cache for Edge Function.

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
