# V2 frontend (React + Vite + Supabase)

Dette er den aktive Tollbugata Profits-appen. Den er en statisk React-PWA på
GitHub Pages med Supabase til innlogging, database og én Edge Function for
markedsdata.

## Lokal utvikling

```bash
cd web
cp .env.example .env.local
# fyll inn VITE_SUPABASE_URL og VITE_SUPABASE_ANON_KEY
npm ci
npm run dev
```

Appen serveres på `http://localhost:5173/tollbugata-profits/` fordi Vite bruker
samme base-path som GitHub Pages.

## Krav

- Node 22 eller nyere.
- En Supabase-project med Google-innlogging.
- Edge Function `market-snapshot` deployet.
- GitHub Pages satt til **GitHub Actions** som kilde.

## Kommandoer

```bash
npm run dev        # lokal utvikling
npm test           # Vitest-paritetstester mot Python-fixtures
npm run typecheck  # TypeScript
npm run build      # produksjonsbygg i web/dist
npm run preview    # forhåndsvis produksjonsbygget
```

## Arkitektur

- `src/core/` er en TypeScript-port av screening, scoring, nyhetsanalyse,
  rapportbygging og handelsdagbok. Porten er testet mot fixtures generert fra
  Python-implementasjonen.
- `src/lib/api.ts` er Supabase-klienten for rapport, historikk, innstillinger
  og dagbok. All persistens går mot Postgres.
- `src/lib/useDashboard.ts` henter markedsdata via Edge Function og bygger
  rapporten på nytt ved åpning og hver oppdatering. Dagens rad oppdateres med
  `unique(user_id, report_date)`.
- `src/pages/JournalPage.tsx` er `/logg`. Den henter bare Supabase-data og
  kontakter aldri markeds-API-ene.
- Rapporthistorikk inneholder siste lagrede versjon per dato. Rapporten
  erstattes når du oppdaterer samme dag.

Base-pathen `/tollbugata-profits/` er hardkodet i `vite.config.ts`,
`public/404.html` og PWA-manifestet. Hvis repositoryet får et annet navn, må
alle tre oppdateres, sammen med Supabase redirect-URL-er og GitHub Pages-URL.

## Sikkerhet

- RLS på alle brukertabeller, begrenset til `auth.uid()`.
- `market_cache` er bare tilgjengelig for service role.
- `market-snapshot` validerer JWT, og kan i tillegg begrenses med
  `ALLOWED_EMAILS`.
- `service_role` skal aldri inn i frontend, GitHub eller `.env.local`.

Se `../supabase/README.md` for oppsett av database, Google OAuth, Edge Function
og GitHub Pages.
