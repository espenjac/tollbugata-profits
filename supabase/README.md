# Supabase-oppsett for V2

Appen bruker Supabase til:

- Google-innlogging.
- `accounts`, `trades`, `cash_adjustments`, `reports`, `settings` og `profiles`.
- `market_cache`, som bare Edge Function med service role kan lese.
- Edge Function `market-snapshot`, som henter TradingView, Euronext Growth og
  NewsWeb server-side fordi NewsWeb blokkerer nettleser-CORS.

## 1. Opprett prosjekt

Opprett et gratis Supabase-prosjekt. Noter:

- Project URL: `https://<project-ref>.supabase.co`
- Anon public key
- Project ref

`service_role` skal aldri brukes i frontend.

## 2. Kjør migreringen

Enten lim inn `migrations/0001_init.sql` i SQL Editor, eller bruk Supabase CLI:

```bash
supabase link --project-ref <project-ref>
supabase db push
```

Migreringen lager tabeller, RLS-policyer, `account_balances`-viewet og en
trigger som oppretter profil, konto og innstillinger for nye brukere.

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

## 4. Deploy Edge Function

```bash
supabase secrets set ALLOWED_EMAILS=<eierens-google-epost>,<annen-bruker>
supabase functions deploy market-snapshot
```

`SUPABASE_URL` og `SUPABASE_SERVICE_ROLE_KEY` settes automatisk av Supabase.
`ALLOWED_EMAILS` er en kommaseparert liste over kontoer som får bruke
markedsfunksjonen. `OWNER_EMAIL` støttes fortsatt som fallback for én adresse.
Uten noen av dem kan alle autentiserte brukere kalle funksjonen. Kontoer som
ikke står i listen får 403, og appen viser «Denne kontoen har ikke tilgang.
Kontakt eieren for å bli lagt til.»

Funksjonen cacher TradingView i 10 minutter, NewsWeb i 5 minutter og
Euronext Growth i 24 timer. Ved feil brukes gammel cache med advarsel når den
finnes.

## 5. GitHub Pages

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

## 6. Engangsmigrering av gammel dagbok

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
opprettet, eller før; `unique(user_id, report_date)` gjør at den første
rapporten for en dato vinner.

## Gratisnivå

Supabase free tier holder for noen få brukere: 500 MB database, 5 GB egress og
500 000 Edge Function-kall per måned. Prosjektet kan pauses etter sju dagers
inaktivitet og har ikke automatisk backup. Eksporter data utenfor appen ved
behov.
