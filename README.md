# Tollbugata Profits

Tollbugata Profits er et lite, selvstendig verktøy for å lage en **pre-market
daytrading-rapport for Oslo Børs**. Rapport bygges før børsåpning, viser én
hovedkandidat, 5–10 alternativer og en konkret manuell handelsplan med
kurtasje, gevinstmål og tapsgrense.

Appen kan brukes som kommandolinje eller lokal webapp. Den henter data fra
TradingView og Oslo Børs NewsWeb, bruker bare Python-standardbiblioteket og
utfører **aldri** handler automatisk.

> Dette er et beslutningsstøtteverktøy, ikke investeringsråd. Score er en
> relativ poengsum, ikke en sannsynlighet. Data kan være forsinket eller feil,
> og en gevinst på 2 % per dag er ikke garantert eller realistisk hver dag.

## Hva rapporten inneholder

- **Én hovedkandidat** med begrunnelse, score, risiko, likviditet, trend,
  momentum, nyheter, tekniske nivåer og en handelsplan.
- **5–10 alternativer** med kategori, score og hva som taler for og imot.
- **Kategoriene Momentum, Breakout og Nyhetsdrevet.** En aksje kan ha flere
  kategorier. Breakout skiller mellom `mulig`, `ikke nær` og `overstrukket`.
- **Mulighetsscore, risikoscore og samlet score** som tre separate tall.
- **Kurtasjeberegning** med hele aksjer, kapitalbruk og scenarier for
  +1 %, +2 %, +3 %, +4 %, +5 %, −1 % og −2 %.
- **Advarsler** ved lav likviditet, ukjent eller høy spread, negativt
  nyhetssignal, emisjon, resultat/ex-dato og andre kjente risikofaktorer.
- **«Ingen anbefalte kandidater i dag – vurder å stå over.»** når ingen
  kandidat er god nok.
- **Historiske rapporter og siste backtest** i webappen.

## Kom i gang

Krever Python 3.10 eller nyere.

```bash
cd tollbugata_profits

# Terminal: lag dagens pre-market-rapport
python3 screener.py

# Lag HTML-rapport i tillegg
python3 screener.py --html rapport.html

# Webapp: åpne http://127.0.0.1:8501
python3 app.py

# eller start med hjelpescriptet
./start.sh
```

Det er ingen installasjonstrinn fordi appen bare bruker Python-standardbiblioteket.
Vil du likevel lage et virtuelt miljø:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

## Daglig flyt før børsåpning

1. Kjør `python3 screener.py` eller åpne webappen før kl. 09:00.
2. Les hovedkandidaten: hvorfor den er valgt, hva som taler imot, nyheter,
   teknisk nivå, antall aksjer, kapitalbruk og nettoresultat etter kurtasje.
3. Sjekk alternativene og kategoriene. Hvis rapporten sier at du bør stå over,
   er det et gyldig utfall – ikke en feil.
4. Etter åpning: bekreft kurs, volum og spread manuelt. Rapporten er laget på
   siste avsluttede daglige data og vet ikke hvordan aksjen åpner.
5. Gjør eventuell handel manuelt. Verktøyet har ingen ordre- eller
   meglerintegrasjon.

Programmet trenger ikke kjøre kontinuerlig. Én kjøring før børsåpning er nok;
webappen kan lese den lagrede rapporten senere.

## To-lags screening

### 1. Teknisk grunnscreen

Den opprinnelige screenen beholdes som et grovt filter. Standardkravene er:

| Krav | Standard | Forklaring |
|---|---|---|
| Positiv uke | `Perf.W > 0` | Aksjen har steget siste uke. `--min-week 2` krever minst 2 %. |
| Kort trend | `kurs > SMA5` | Kursen er over 5-dagers glidende gjennomsnitt. Slås av med `--no-sma5`. |
| ATH-merking | `kurs ≥ ATH × 0,99` | Aksjer på/ved ATH tas med og merkes med **ATH**. Justeres med `--ath-margin`. |
| Skjul ATH | av | `--exclude-ath` utelater ATH-aksjer helt. |
| Ekstra trend | av | `--sma20` krever også kurs over 20-dagers snitt. |
| Euronext Growth | skjult | Skjules som standard fordi slike aksjer normalt ikke kan holdes på ASK. `--include-growth` viser dem. |

### 2. Kandidatfilter for daytrading

Deretter må aksjen passere kandidatfilteret i `oslo_screener/strategy.py`:

| Krav | Standard |
|---|---|
| Instrument | Aksje eller depotsertifikat (DR) |
| Ukeavkastning | Positiv og maks 25 % |
| Kurs | Minst 5 kroner |
| Trend | Over SMA5, SMA20 og positiv månedstrend |
| RSI | Maks 82 |
| Markedsverdi | Minst 300 mill. kroner |
| Likviditet | Minst 5 mill. kroner i snittomsetning per dag |

Manglende enkeltdata gir nøytrale delscorer, men mangler ukeavkastning, kurs,
SMA5 eller SMA20, blir aksjen ikke kandidat.

## Scoremodell

Scoremodellen skiller bevisst mellom **mulighet**, **risiko** og **samlet
rangering**. Vektene ligger i `oslo_screener/config.py` og kan overstyres med
JSON. Standardverdiene er fornuftige startverdier – ikke optimaliserte eller
garantert lønnsomme parametere.

### Mulighetsscore

Hver delscore normaliseres til 0–1 og vektes. Summen av vektene normaliseres, så
du kan endre enkeltvekter uten at skalaen blir feil.

| Faktor | Standardvekt | Måler |
|---|---:|---|
| `momentum` | 0,18 | Uke- og månedsavkastning, med straff for overstrukket kurs |
| `trend` | 0,15 | Avstand over SMA20, SMA5 over SMA20 og kurs over SMA50 |
| `relative_strength` | 0,10 | Kvartalsavkastning og ukeavkastning mot resten av utvalget |
| `liquidity` | 0,15 | Logaritmisk snittomsetning per dag |
| `volume` | 0,10 | Dagens volum mot 10-dagers snitt |
| `technical_upside` | 0,08 | Rom til nærmeste motstand/52-ukershøyeste |
| `volatility` | 0,06 | ATR nær 2,5 %, med straff for svært høy ATR |
| `news` | 0,12 | Klassifisert nyhetssignal |
| `breakout` | 0,06 | Nærhet til motstand, konsolidering og volumstøtte |

### Risikoscore

Høyere risikoscore er dårligere. Risikoen demper den samlede scoren:

```text
samlet_score = mulighetsscore × (1 − 0,45 × risikoscore / 100)
```

| Risikofaktor | Standardvekt | Høy risiko når |
|---|---:|---|
| `volatility` | 0,20 | ATR er høy |
| `overextension` | 0,20 | Sterk uke, høy RSI, langt over SMA20 eller stor månedsavkastning |
| `liquidity` | 0,15 | Lav snittomsetning |
| `event` | 0,15 | Resultat eller ex-dato nær |
| `negative_news` | 0,15 | Negativt eller blandet nyhetssignal |
| `market_cap` | 0,05 | Liten markedsverdi |
| `price` | 0,05 | Lav aksjekurs og dermed større relativ spread |
| `spread` | 0,05 | Høy spread, eller ukjent spread med nøytral risiko |

Standard risikovekter summerer til 1,0. `risk_penalty` kan også konfigureres.

### Kategorier

- **Momentum:** positiv uke og måned, kurs over SMA5/SMA20 og ikke
  overstrukket.
- **Breakout:** kursen er nær kjent motstand, men ikke allerede strukket.
  Statusen `overstrukket` brukes når ukeavkastning eller RSI er for høy.
- **Nyhetsdrevet:** relevant positiv hendelse som kontrakt, resultat eller
  oppkjøp. Emisjon og negative hendelser gir aldri denne kategorien.

En aksje kan stå i flere kategorier samtidig. Kategoriene er beskrivende, ikke
en garanti for at bevegelsen fortsetter.

### Nyhetsklassifisering

Nyhetsanalysen klassifiserer både sentiment, hendelsestype og relevans:

| Hendelsestype | Eksempler | Normal vurdering |
|---|---|---|
| `contract` | Kontrakt, ordre, avtale | Positiv når relevant |
| `result` | Resultat, guiding, omsetning | Kan være positiv eller negativ |
| `capital_raise` | Emisjon, rettet emisjon, kapitalinnhenting | **Alltid negativ** på grunn av utvanning |
| `insider` | Primærinnsider kjøper/selger | Kjøp positivt, salg negativt |
| `acquisition` | Oppkjøp, fusjon, salg av virksomhet | Vurderes etter ordlyd |
| `dividend` | Utbytte, ex-dato | Nøytralt eller svakt positivt |
| `other` | Øvrige meldinger | Nøytralt |

Reglene er bevisst enkle stikkordsregler, ikke språkmodell eller full
nyhetsanalyse. En emisjon eller negativ hendelse overstyrer positive ord i
overskriften. Relevans (`high`, `medium`, `low`) og hendelsestype lagres i
rapporten. Les alltid selve meldingen.

## Handelsplan, kurtasje og risiko

Standardforutsetningene er:

- startkapital **5 000 NOK**
- kurtasje **29 NOK** ved kjøp og **29 NOK** ved salg
- første gevinstmål **2 %**
- tapsgrense **2 %**
- hele aksjer, ikke brøkdeler
- én aksje om gangen og hele den tilgjengelige kapitalen
- normalt ikke over natten
- manuell handel

Antall aksjer beregnes som:

```text
antall = floor((kapital − kjøpskurtasje) / estimert kjøpskurs)
```

Kjøpskursen estimeres fra siste sluttkurs, eventuelt med konfigurert slippage.
Faktisk åpningskurs kan avvike.

### Regneeksempel med standardverdier

Ved kurs 100 NOK, 5 000 NOK kapital og 29 + 29 NOK kurtasje:

| Post | Verdi |
|---|---:|
| Antall aksjer | 49 |
| Investert kapital | 4 900 NOK |
| Kapitalbruk inkl. kjøpskurtasje | 4 929 NOK |
| Ledig kontant | 71 NOK |
| Gevinstmål 102 NOK, netto etter kurtasje | +40 NOK |
| Netto avkastning ved +2 % | ca. +0,8 % |
| Tapsgrense 98 NOK, netto etter kurtasje | −156 NOK |
| Netto avkastning ved −2 % | ca. −3,2 % |
| Gevinst/tap-forhold etter kurtasje | ca. 0,26:1 |

Dette viser en viktig svakhet: med 5 000 NOK og 29 NOK kurtasje spiser
kostnadene en stor del av et 2 % mål. Rapporten varsler når gevinst/tap-forholdet
er under 1:1. For å få bedre forhold må målet være høyere, kurtasjen lavere eller
kapitalen større. `min_reward_risk` er derfor 0 som standard; den blokkerer ikke
alle kandidater, men forholdet vises tydelig.

### Scenarioer

Rapporten viser nettoresultat etter både kjøps- og salgskurtasje for:

```text
−2 %, −1 %, +1 %, +2 %, +3 %, +4 %, +5 %
```

Scenarioene er kursbevegelser fra estimert kjøpskurs. De inkluderer ikke
skatt, eventuell valutaeffekt eller andre meglerkostnader.

### «Stå over»

En kandidat blir ikke hovedanbefaling dersom den:

- har for lav samlet score, mulighetsscore eller for høy risikoscore,
- ikke har nok kapital til én hel aksje etter kurtasje,
- har likviditet under rapportens minstekrav,
- mangler kategori,
- har negativt nyhetssignal eller emisjon,
- har resultat eller ex-dato innenfor sperregrensen.

Da viser rapporten:

> **Ingen anbefalte kandidater i dag – vurder å stå over.**

Alternativene kan fortsatt vises, men merkes som ikke anbefalt.

## Permanent rapportlagring

Hver rapport lagres som en egen JSON-fil under `reports/premarket/`:

```text
reports/premarket/20261031T070000_123456Z.json
```

Filen inneholder dato og tidspunkt, ticker, kategori, score, risiko, kurs,
begrunnelse, nyheter, nøkkeltall, handelsplan og gevinst-/tapsnivåer. Nye filer
får nytt tidsstempel og overskriver aldri en eldre rapport.

- **Kommandolinjen** lagrer hver kjøring med mindre `--no-save-report` brukes.
- **Webappen** lagrer høyst én rapport per lokal dag, slik at sideoppdateringer
  ikke fyller mappen med nesten identiske filer.
- Webappen viser de nyeste lagrede rapportene under «Tidligere
  morgenrapporter».

`reports/` er gitignorert fordi det er lokale data.

## Backtesting

Backtesten tester rangeringen på historiske daglige OHLCV-data. Den er laget for
å avdekke om strategien har noe for seg – ikke for å bevise at den virker.

### CSV-format

Påkrevde kolonner:

```text
date,ticker,open,high,low,close,volume
```

Valgfrie kolonner:

```text
name,sector,market_cap,spread_pct,market,news_sentiment,news_relevance,news_event
```

Eksempel:

```csv
date,ticker,open,high,low,close,volume,name,sector,market_cap,spread_pct
2026-01-02,EQNR,100.0,102.0,99.5,101.5,1200000,Equinor ASA,Energy,900000000000,0.001
```

### Kjøring

```bash
python3 backtest.py --csv historiske_daglige_data.csv \
  --from 2025-01-01 --to 2025-12-31 \
  --output reports/backtest_latest.json
```

Valgfrie mål:

```bash
python3 backtest.py --csv data.csv --targets 1,2,3,5
```

+2 % tas alltid med fordi hovedkandidat og topp 5 måles mot primærmålet.

`--capital`, `--buy-fee`, `--sell-fee`, `--stop-loss`, `--slippage` og
`--config` virker også for backtesten. Webappen leser
`reports/backtest_latest.json`.

### Metode

For hver handledag:

1. Indikatorer beregnes bare fra data fram til og med forrige avsluttede dag.
2. Kandidatene rangeres med samme scoremodell som rapporten.
3. Handelen simuleres på neste dags åpningskurs.
4. Mål og stop sjekkes mot neste dags high/low.
5. Resultatet beregnes netto etter kurtasje med hele aksjer.

Dette unngår look-ahead: morgendagens kurs brukes ikke til å velge dagens
kandidat. `stock_as_of` er eksponert og testes for dette.

### Resultater

Backtesten rapporterer blant annet:

- treff på +1 %, +2 %, +3 % og +5 %,
- andel stop,
- andel avsluttet ved stengetid,
- gevinstfrekvens,
- gjennomsnittlig gevinst og tap,
- gjennomsnittlig og samlet nettoresultat etter kurtasje.

Den beregnes separat for:

- hovedkandidat (topp 1),
- topp 5,
- Momentum,
- Breakout,
- Nyhetsdrevet.

Topp 5 er fem separate tenkte enkelthandler, ikke én portefølje med fem
samtidige posisjoner. Kategoriene kan overlappe, så samme handel kan telles i
flere kategorier.

### Viktige forbehold

- Daglige data kan ikke avgjøre om gevinstmål eller stop ble truffet først. Når
  begge treffes samme dag, antar testen **konservativt at stop ble truffet
  først**. Det kan undervurdere resultatet.
- Hvis både mål og stop ligger innenfor dagens range, blir resultatet usikkert.
  Testen velger den negative tolkningen.
- CSV-filen må inneholde historiske nyhetssignaler for å teste
  nyhetskategorien. NewsWeb kan ikke rekonstrueres pålitelig i ettertid.
- Hvis CSV-filen bare inneholder selskaper som fortsatt er notert, er testen
  utsatt for **survivorship bias**.
- Testen bruker daglige data, ikke intradagdata, ordrebok eller faktisk spread.
  Slippage er 0 som standard og må settes eksplisitt.
- Små datasett og mange parametere gir lett overtilpasning. Ikke juster vektene
  bare for å få best mulig historisk resultat.

## Konfigurasjon

Alle vekter og terskler ligger i `oslo_screener/config.py`. Du kan overstyre dem
med en JSON-fil:

```bash
python3 screener.py --config min-config.json
python3 app.py --config min-config.json
python3 backtest.py --csv data.csv --config min-config.json
```

Eksempel på `min-config.json`:

```json
{
  "scoring": {
    "min_price": 5.0,
    "min_market_cap": 300000000.0,
    "min_average_turnover": 5000000.0,
    "max_rsi": 82.0,
    "breakout_distance": 0.05,
    "overextended_rsi": 75.0,
    "risk_penalty": 0.45,
    "weights": {
      "momentum": 0.18,
      "trend": 0.15,
      "relative_strength": 0.10,
      "liquidity": 0.15,
      "volume": 0.10,
      "technical_upside": 0.08,
      "volatility": 0.06,
      "news": 0.12,
      "breakout": 0.06
    }
  },
  "trade": {
    "capital": 5000.0,
    "buy_fee": 29.0,
    "sell_fee": 29.0,
    "target_pct": 0.02,
    "stop_loss_pct": 0.02,
    "slippage_pct": 0.0,
    "min_reward_risk": 0.0,
    "scenario_pcts": [-0.02, -0.01, 0.01, 0.02, 0.03, 0.04, 0.05]
  },
  "report": {
    "max_alternatives": 10,
    "min_total_score": 58.0,
    "min_opportunity": 55.0,
    "max_risk": 58.0,
    "min_turnover": 10000000.0,
    "block_negative_news": true,
    "block_earnings_within_days": 1,
    "block_ex_date_within_days": 0
  }
}
```

Verdier som `target_pct`, `stop_loss_pct`, `slippage_pct` og `scenario_pcts`
skrives som desimaltall (0,02 = 2 %). Ukjente nøkler gir feilmelding i stedet
for å bli ignorert.

Enkle CLI-flagg overstyrer JSON:

| Flagg | Betydning |
|---|---|
| `--capital NOK` | Startkapital |
| `--buy-fee NOK` / `--sell-fee NOK` | Kurtasje |
| `--target PCT` | Første gevinstmål i prosent |
| `--stop-loss PCT` | Tapsgrense i prosent |
| `--slippage PCT` | Antatt slippage/spread i prosent |
| `--min-score POENG` | Minste samlede score for hovedanbefaling |
| `--max-risk POENG` | Høyeste risikoscore |
| `--min-opportunity POENG` | Minste mulighetsscore |
| `--max-alternatives ANTALL` | Maks antall alternativer |
| `--no-save-report` | Ikke lagre rapporten |

## Kommandolinje

```bash
# Rapporten i terminalen
python3 screener.py

# Alle treff i tabellen, ikke bare de 40 første
python3 screener.py --top 0

# Strengere teknisk screen
python3 screener.py --min-week 2 --ath-margin 2

# Med konfigurasjon og egne handelsforutsetninger
python3 screener.py --config min-config.json --capital 10000 --target 3 --stop-loss 2

# Lag en selvstendig HTML-rapport
python3 screener.py --html rapport.html

# JSON eller CSV (til fil eller stdout)
python3 screener.py --json treff.json --quiet
python3 screener.py --csv treff.csv --quiet
python3 screener.py --json - --quiet | jq '.premarket.main'

# Ikke lagre permanent morgenrapport
python3 screener.py --no-save-report

# Oppdater automatisk hvert 5. minutt (lagrer bare første rapport)
python3 screener.py --loop 300
```

Viktige valg:

| Valg | Betydning |
|---|---|
| `--min-week PCT` | Minste ukeavkastning i prosent |
| `--ath-margin PCT` | Hvor nær ATH som regnes som «på ATH» |
| `--exclude-ath` | Utelat ATH-aksjer |
| `--no-sma5` | Dropp kravet om kurs over SMA5 |
| `--sma20` | Krev også kurs over SMA20 |
| `--min-cap MRD` | Minste markedsverdi i milliarder NOK |
| `--min-turnover MILL` | Minste omsatte verdi i millioner NOK |
| `--only-stocks` | Utelat depotsertifikater |
| `--include-growth` | Vis også Euronext Growth |
| `--sort FELT` | `week`, `month`, `market_cap`, `ath_distance`, `name` eller `ticker` |
| `--top N` | Antall rader i terminalen, `0` = alle |
| `--refresh` | Hent nye data og ignorer cache |
| `--cache-ttl SEK` | Hvor lenge cache brukes (standard 600) |
| `--no-news` | Ikke hent børsmeldinger |
| `--loop SEK` | Kjør screenen på nytt med jevne mellomrom |

## Webapp og API

```bash
python3 app.py
```

Åpne <http://127.0.0.1:8501>. Webappen viser:

- hovedkandidat, alternativer og kategorier,
- mulighets-, risiko- og totalscore,
- handelsplan og kurtasjeberegning,
- nyheter med sentiment og hendelsestype,
- tidligere morgenrapporter,
- siste backtest,
- den vanlige tabellen med filtre og ATH-merking.

API-et er tilgjengelig på `/api/data` og tar de samme parameterne som skjemaet:

```bash
curl 'http://127.0.0.1:8501/api/data?min_week=2&ath_margin=2' | jq

# Vis også Euronext Growth
curl 'http://127.0.0.1:8501/api/data?growth=1' | jq
```

Svaret inneholder alle treff under `stocks`, rangeringen under
`top_candidates`, nyhetssammendraget under `news` og hele pre-market-rapporten
under `premarket` (blant annet `main`, `alternatives`, `warnings` og
`has_recommendation`).

Vil du nå appen fra andre maskiner:

```bash
python3 app.py --host 0.0.0.0 --port 8501
```

## ASK og Euronext Growth

Aksjer notert på **Euronext Growth** kan normalt ikke holdes på
aksjesparekonto (ASK), fordi Euronext Growth er en multilateral
handelsfasilitet og ikke et regulert marked. Appen skjuler derfor disse
aksjene som standard.

TradingView bruker samme børskode (`OSL`) for Oslo Børs, Euronext Expand og
Euronext Growth. For å skille dem henter appen den offisielle listen over
Euronext Growth-aksjer fra Euronext Live og cacher den i
`.cache/euronext_growth.json` i 24 timer.

- **Standard:** Euronext Growth er skjult og telles blant aksjene som er
  filtrert bort.
- **Vis dem likevel:** bruk `--include-growth` eller huk av i webappen.
- **Hvis listen ikke kan hentes:** appen fortsetter med en advarsel, men da kan
  Euronext Growth-aksjer være med i resultatet.

Dette er en praktisk filtrering, ikke en garanti for at alle gjenværende aksjer
er ASK-egnede. Bekreft alltid med banken eller megleren din.

## Resultat og ex-dato

Listen viser hvor mange dager det er til neste resultatfremleggelse
(**Resultat**) og neste ex-dividend-dato (**Ex-dato**). `0` betyr i dag, og `–`
betyr at TradingView ikke har en kommende dato. Hold musen over tallet i
webvisningen for å se selve datoen.

I terminalen vises det som en egen **NESTE**-kolonne (f.eks. `R 14d · E 3d`)
når terminalen er bred nok. `R` = resultat, `E` = ex-dato. Feltene er også med i
JSON/CSV som `earnings_date`, `days_to_earnings`, `ex_dividend_date` og
`days_to_ex_dividend`.

Nær resultat eller ex-dato gir høyere risikoscore, advarsel og kan blokkere
hovedanbefalingen.

## Nyheter

Webappen viser børsmeldinger fra Oslo Børs NewsWeb for selskapene i screenen.
Utgangspunktet er da forrige handelsdag stengte (16:30 norsk tid):

- Nattens og morgenens meldinger beholdes når børsen åpner kl. 09:00.
- Meldingene blir liggende hele handelsdagen og byttes først ut ved midnatt.
- På lørdag, søndag og mandag morgen vises meldinger siden fredag kl. 16:30.
- Meldinger publisert etter dagens åpning merkes med **NY**.
- Appen kjenner ikke børsferier; dato og klokkeslett vises derfor i grensesnittet.

NewsWeb publiserer ofte samme melding på norsk og engelsk. Appen viser én
overskrift per minutt og foretrekker den norske versjonen når den kan avgjøre
det. Antallet teller likevel alle meldingene.

Dette er **børsmeldinger**, ikke all medieomtale. Selskapet kan ha fått
oppmerksomhet i aviser, TV eller sosiale medier uten at det ligger en melding
hos NewsWeb.

Nyhetene caches i `.cache/oslo_bors_news.json` i 5 minutter. Ved nettverksfeil
brukes siste cache med en advarsel; selve aksjescreeningen stopper ikke. Bruk
`--no-news` for å slå av nyhetshenting.

## Datakilder og begrensninger

Appen bruker TradingViews åpne scanner-endepunkt for Oslo Børs
(`scanner.tradingview.com/norway/scan`). Det krever ingen nøkkel, men er
uoffisielt og kan endre seg uten varsel. Derfor:

- svaret caches i `.cache/oslo_bors_scan.json` i 10 minutter,
- ved nettverksfeil brukes siste cache med en tydelig advarsel,
- alle kall har retry med backoff.

Segmentlisten for Euronext Growth hentes fra Euronext Live
(`live.euronext.com/en/product_directory/data/stocks-oslo-euronext-growth-`).
Også denne er uoffisiell og kan endre seg. Den caches i 24 timer. Hvis den ikke
kan hentes, fortsetter appen med en advarsel; da er filtreringen ikke komplett.

Børsmeldingene hentes fra Oslo Børs NewsWebs åpne API
(`api3.oslo.oslobors.no/v1/newsreader/list`). Også dette er uoffisielt og kan
endre seg. NewsWeb er kilden til selskapenes egne børsmeldinger, ikke en
fullstendig nyhetsdekning.

Tallene er typisk siste kurs eller siste sluttkurs, avhengig av børstidspunkt.
`High.All` er ikke alltid justert for splitt; appen prøver å oppdage og håndtere
dette, men kan ikke garantere at alle historiske topper er korrekte.

### Svakheter du må kjenne til

- **Ingen intradagdata.** Scoren bruker ikke dagens VWAP, åpningsrange,
  intradagvolum eller live spread. Den vet ikke hvordan aksjen faktisk åpner.
- **Score er ikke sannsynlighet.** Modellen er ikke historisk kalibrert. En
  score på 70 betyr ikke 70 % sjanse for oppgang.
- **2 % daglig er ikke garantert.** Med 5 000 NOK og 29 + 29 NOK kurtasje er
  kostnaden stor relativt til et 2 % mål. Mange dager bør man stå over.
- **Daglige data kan skjule intradagbevegelser.** En aksje kan ha truffet stop
  før den nådde målet, eller omvendt, uten at daglige OHLC-data viser rekkefølgen.
- **Backtesten er konservativ, men ikke fasit.** Den bruker stop først ved
  usikkerhet, ignorerer ordrebok og kan være utsatt for survivorship bias.
- **Nyhetsanalysen er stikkordbasert.** Den kan ta feil av ironi, tvetydige
  overskrifter og hendelser som ikke står i overskriften.
- **Datakildene er uoffisielle.** Både TradingView, Euronext Live og NewsWeb kan
  endre format eller svare feil. Cache og advarsler reduserer, men fjerner ikke,
  denne risikoen.
- **Ingen automatisk handel.** Du må selv bekrefte kurs, volum, spread og
  nyheter, og du bærer all risiko.

## Prosjektstruktur

```text
tollbugata_profits/
├── screener.py              # kommandolinje for pre-market-rapport
├── app.py                   # lokal webserver
├── backtest.py              # historisk test på CSV
├── oslo_screener/
│   ├── data.py              # henting, cache og parsing
│   ├── markets.py           # Euronext Growth-liste og ASK-filter
│   ├── news.py              # NewsWeb og nyhetsklassifisering
│   ├── signals.py           # NewsSignal og hendelsesetiketter
│   ├── models.py            # Stock og datamodeller
│   ├── logic.py             # teknisk screen og sortering
│   ├── strategy.py          # mulighets-, risiko- og totalscore
│   ├── config.py            # vekter, kapital, kurtasje og terskler
│   ├── trade.py             # aksjeantall, kurtasje og scenarioer
│   ├── premarket.py         # rapport, blokkårsaker og lagring
│   ├── backtest.py          # CSV-backtest uten look-ahead
│   ├── render.py            # terminal, HTML og webvisning
│   ├── serialize.py         # JSON/API-format
│   ├── nordnet.py           # Nordnet-lenker
│   ├── nordnet_slugs.json   # ticker → Nordnet-slug
│   └── cli.py               # felles argumenter
├── tests/
│   ├── test_screener.py
│   └── test_premarket.py
└── README.md
```

## Tester

```bash
python3 -m unittest discover -s tests -v
```

Testene bruker fixtures og går ikke mot nettverket. De dekker blant annet
scoremodellen, kurtasje og hele aksjer, at fremtidige data ikke brukes,
negativt nyhetssentiment, «stå over», uforanderlig rapportlagring og
konservativ backtest.
