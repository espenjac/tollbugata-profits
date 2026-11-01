# Tollbugata Profits

Tollbugata Profits er et lite, selvstendig verktøy for å lage en **pre-market
daytrading-rapport for Oslo Børs**. Rapport bygges før børsåpning, viser én
hovedkandidat, inntil 10 anbefalte alternativer, en egen seksjon for blokkerte
kandidater og en konkret manuell handelsplan med kurtasje, gevinstmål og
tapsgrense.

Appen kan brukes som kommandolinje eller lokal webapp. Den henter data fra
TradingView og Oslo Børs NewsWeb, bruker bare Python-standardbiblioteket og
utfører **aldri** handler automatisk. I webappen kan du i tillegg føre en lokal
handelsdagbok og oppdatere hvor mye penger du har tilgjengelig.

> Dette er et beslutningsstøtteverktøy, ikke investeringsråd. Score er en
> relativ poengsum, ikke en sannsynlighet. Data kan være forsinket eller feil,
> og en gevinst på 2 % per dag er ikke garantert eller realistisk hver dag.

## Hva rapporten inneholder

- **Én hovedkandidat** med begrunnelse, score, risiko, likviditet, trend,
  momentum, nyheter, tekniske nivåer og en handelsplan.
- **5–10 anbefalte alternativer** med kategori, score og hva som taler for og
  imot, pluss blokkerte kandidater i en egen seksjon.
- **Kategoriene Momentum, Breakout og Nyhetsdrevet.** En aksje kan ha flere
  kategorier. Breakout skiller mellom `mulig`, `ikke nær` og `overstrukket`.
- **Mulighetsscore, risikoscore og samlet score** som tre separate tall.
- **Kurtasjeberegning** med hele aksjer, kapitalbruk og scenarier for
  +1 %, +2 %, +3 %, +4 %, +5 %, −1 % og −2 %.
- **Advarsler** ved lav likviditet, negativt nyhetssignal, emisjon,
  resultat/ex-dato og andre kjente risikofaktorer.
- **«Ingen anbefalte kandidater i dag – vurder å stå over.»** når ingen
  kandidat er god nok.
- **Historiske rapporter og siste backtest** under handelsdagboken i webappen.
- **Lokal handelsdagbok** der du logger utførte kjøp og salg, redigerer feil,
  hurtigselger hele beholdninger og oppdaterer ledig kapital. Neste rapport og
  handelsplan bruker denne saldoen.
- **Mobilmodus og PWA:** samme webapp, samme logikk og samme dagbok kan åpnes
  og installeres på Android, lokalt eller via en passordbeskyttet skyinstans.
  Layouten tilpasser seg telefonens skjerm.

## Kom i gang

Krever Python 3.10 eller nyere.

```bash
cd tollbugata-profits

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
4. Etter åpning: bekreft kurs og volum manuelt. Rapporten er laget på
   siste avsluttede daglige data og vet ikke hvordan aksjen åpner.
5. Gjør eventuell handel manuelt. Verktøyet har ingen ordre- eller
   meglerintegrasjon.
6. Etter handelen: loggfør kjøp eller salg i handelsdagboken i webappen, og
   oppdater ledig kapital når du overfører penger inn eller ut. Neste rapport
   bruker den oppdaterte saldoen.

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
SMA5 eller SMA20, blir aksjen ikke kandidat. Manglende dagavkastning gir nøytral
jevnhets- og hoppscore uten å blokkere kandidaten.

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
| `momentum` | 0,16 | Uke- og månedsavkastning, med straff for overstrukket kurs |
| `trend` | 0,14 | Avstand over SMA20, SMA5 over SMA20 og kurs over SMA50 |
| `relative_strength` | 0,09 | Kvartalsavkastning og ukeavkastning mot resten av utvalget |
| `liquidity` | 0,15 | Logaritmisk snittomsetning per dag |
| `volume` | 0,09 | Dagens volum mot 10-dagers snitt |
| `technical_upside` | 0,08 | Rom til nærmeste motstand/52-ukershøyeste |
| `volatility` | 0,05 | ATR nær 2,5 %, med straff for svært høy ATR |
| `news` | 0,11 | Klassifisert nyhetssignal |
| `breakout` | 0,05 | Nærhet til motstand, konsolidering og volumstøtte |
| `consistency` | 0,08 | Jevn stigning siste uke fremfor ett isolert dagshopp |

Jevnhet beregnes fra siste handelsdags avkastning og hvor stor del av ukens
oppgang den utgjør. En dag på inntil 2 % som bidrar med maks 40 % av ukens
oppgang gir full jevnhetsscore. Et hopp på minst 4 % som utgjør minst 60 % av
ukens oppgang gir lav jevnhetsscore, og et hopp på minst 7 % gir null.

Jevnheten påvirker også kategoriene: et stort ett-dagshopp regnes ikke som
stabilt momentum, og en kandidat nær motstand kan bli `overstrukket` i stedet
for `mulig breakout`.

### Risikoscore

Høyere risikoscore er dårligere. Risikoen demper den samlede scoren:

```text
samlet_score = mulighetsscore × (1 − 0,45 × risikoscore / 100)
```

| Risikofaktor | Standardvekt | Høy risiko når |
|---|---:|---|
| `volatility` | 0,18 | ATR er høy |
| `overextension` | 0,18 | Sterk uke, høy RSI, langt over SMA20 eller stor månedsavkastning |
| `spike` | 0,12 | Stort siste-dagshopp, særlig når det utgjør mesteparten av ukens oppgang |
| `liquidity` | 0,14 | Lav snittomsetning |
| `event` | 0,14 | Resultat eller ex-dato nær |
| `negative_news` | 0,14 | Negativt eller blandet nyhetssignal |
| `market_cap` | 0,05 | Liten markedsverdi |
| `price` | 0,05 | Lav aksjekurs og dermed større prosentvise bevegelser |

Standard risikovekter summerer til 1,00. `risk_penalty` kan også konfigureres.

Hopprisikoen øker ekstra når RSI er minst 75 eller kursen ligger minst 5 % over
SMA5. Et stort hopp med relevant positiv nyhet og volum over 1,5× snittet får
20 % lavere hopprisiko, men blir fortsatt advart mot og bør ikke kjøpes uten en
pullback eller annen bekreftelse. Et stort hopp uten slik nyhet får ingen
lemping.

### Kategorier

- **Momentum:** positiv uke og måned, kurs over SMA5/SMA20, ikke overstrukket
  og ikke preget av et stort ett-dagshopp.
- **Breakout:** kursen er nær kjent motstand, men ikke allerede strukket.
  Statusen `overstrukket` brukes når ukeavkastning eller RSI er for høy, eller
  når siste dag er et stort hopp.
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

Kandidater som er blokkert vises i en egen seksjon merket som ikke anbefalt,
slik at de ikke fremstår som et anbefalt alternativ selv om de har høy
totalscore.

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
- Handelsdagbok-fanen viser de nyeste lagrede rapportene under «Tidligere
  morgenrapporter».

`reports/` er gitignorert fordi det er lokale data.

## Handelsdagbok og ledig kapital

Webappen har en lokal handelsdagbok under «Handelsdagbok og ledig kapital».
Den er laget for manuell registrering **etter** at en handel er utført, og
sender ingen ordrer.

- **Loggfør handel:** tidspunkt, ticker, kjøp/salg, antall hele aksjer, kurs,
  kurtasje og valgfritt notat. Kjøp trekker fra kjøpesum pluss kurtasje fra
  ledig kapital; salg legger til salgssum minus kurtasje.
- **Rediger handel:** hver registrerte handel har en «Rediger»-knapp. Skjemaet
  åpnes med lagrede verdier, og ledig kapital justeres med differansen mellom
  gammel og ny kontantstrøm. Handelen merkes «redigert» med tidspunkt. En
  redigering avvises hvis den ville gitt negativ ledig kapital.
- **Hurtigsalg:** hver positiv beholdning har en «Selg alt»-knapp. Den fyller
  ut ticker og antall automatisk, slik at du bare oppgir tidspunkt og salgskurs.
  Kurtasjen hentes fra `sell_fee` i konfigurasjonen og vises før du lagrer.
- **Oppdater ledig kapital:** sett saldoen manuelt, for eksempel ved innskudd,
  uttak eller korrigering. Endringen loggføres med tidligere saldo, ny saldo og
  notat, slik at den kan spores.
- **Rapporten bruker saldoen:** hovedkandidatens antall aksjer, kapitalbruk og
  scenarier regnes ut fra ledig kapital i dagboken, ikke fra en fast
  standardkapital. Det gir en mer realistisk plan når kontoen er endret.
- **Beholdning og resultat:** webappen viser netto logget beholdning, beregnet
  realisert resultat, samlet kurtasje og omsetning. Tallene er bare et
  sammendrag av det du har lagt inn, ikke markedsverdi eller fasit fra megleren.
- **Eksport og import:** «Last ned dagbok (JSON)» gir en vanlig fil du kan ta
  backup av eller flytte til en annen maskin. «Importer og erstatt» leser en
  slik fil, validerer hele innholdet og skriver den atomisk. Import erstatter
  dagboken på serveren, så ta en nedlasting først hvis du er usikker.

Dagboken lagres som standard i:

```text
data/journal.json
```

Filen er gitignorert og er lokal runtime-data. Ta sikkerhetskopi av den hvis du
vil flytte oppsettet til en annen maskin. Bruk helst skjemaet i webappen i
stedet for å redigere filen manuelt mens appen kjører.

Filen ligger der Python-backenden kjører. Kjører appen i skyen, ligger dagboken
på serveren; en PWA alene lagrer den ikke på telefonen. For å ha dagboken lokalt
på Android må den samme Python-backenden kjøre på telefonen, for eksempel via
Termux eller en APK med innebygd Python. Eksport/import gjør det enkelt å flytte
filen manuelt mellom telefon og PC når begge kjører appen.

- **Antall aksjer:** bare hele aksjer. Et kjøp avvises hvis det koster mer enn
  ledig kapital.
- **Salg uten registrert kjøp:** tillates fordi dagboken kan starte midt i en
  posisjon. Beholdningen kan da bli negativ til du legger inn den historiske
  inngangen; kostpris og realisert resultat blir upresist.
- **Ingen bankintegrasjon:** saldoen er det du selv har skrevet inn. Overførte
  penger, skatt, utbytte og andre kontobevegelser må oppdateres manuelt.
- **Ingen sletting:** en feillogget handel rettes med «Rediger», eller ved å
  justere saldoen og legge inn en korrigerende handel. Alle handler vises i
  tabellen, ikke bare de siste 20.

Kommandolinjen bruker også saldoen fra dagboken når den finnes, slik at
`python3 screener.py` og webappen viser samme kapital. Unntak:

```bash
# Bruk en annen dagbokfil
python3 screener.py --journal /sti/til/journal.json

# Ignorer dagboken og bruk --capital eller config i stedet
python3 screener.py --ignore-journal --capital 5000
```

Hvis `--capital` er oppgitt, vinner den over dagboken. I webappen er en
eksisterende dagbok alltid kilde til saldo; `--capital` brukes bare når
journalfilen ikke finnes ennå. En korrupt dagbok gir en advarsel i
kommandolinjen og rapporten bruker konfigurert kapital; webappen viser feilen i
dagbokpanelet til filen er rettet.

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
name,sector,market_cap,market,news_sentiment,news_relevance,news_event
```

Eksempel:

```csv
date,ticker,open,high,low,close,volume,name,sector,market_cap
2026-01-02,EQNR,100.0,102.0,99.5,101.5,1200000,Equinor ASA,Energy,900000000000
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
`--config` virker også for backtesten. Loggfanen i webappen leser
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
- Testen bruker daglige data, ikke intradagdata eller ordrebok. Slippage er 0
  som standard og må settes eksplisitt.
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
    "smooth_day_return": 0.02,
    "smooth_day_share": 0.40,
    "spike_day_return": 0.04,
    "spike_day_share": 0.60,
    "strong_spike_day_return": 0.07,
    "spike_sma5_distance": 0.05,
    "risk_penalty": 0.45,
    "weights": {
      "momentum": 0.16,
      "trend": 0.14,
      "relative_strength": 0.09,
      "liquidity": 0.15,
      "volume": 0.09,
      "technical_upside": 0.08,
      "volatility": 0.05,
      "news": 0.11,
      "breakout": 0.05,
      "consistency": 0.08
    },
    "risk_weights": {
      "volatility": 0.18,
      "overextension": 0.18,
      "spike": 0.12,
      "liquidity": 0.14,
      "event": 0.14,
      "negative_news": 0.14,
      "market_cap": 0.05,
      "price": 0.05
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
| `--slippage PCT` | Antatt slippage ved kjøp og salg i prosent |
| `--min-score POENG` | Minste samlede score for hovedanbefaling |
| `--max-risk POENG` | Høyeste risikoscore |
| `--min-opportunity POENG` | Minste mulighetsscore |
| `--max-alternatives ANTALL` | Maks antall anbefalte alternativer og blokkerte kandidater |
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
| `--journal FIL` | Lokal handelsdagbok (standard: `data/journal.json`) |
| `--ignore-journal` | Bruk `--capital`/config selv om dagboken finnes |

## Webapp og API

```bash
python3 app.py
```

Åpne <http://127.0.0.1:8501>. Webappen er delt i to faner:

- **Kursinformasjon** (`/`): hovedkandidat og utvidbare alternativer med
  begrunnelse, score, risiko, handelsplan, nyheter, scenarier og tekniske
  nivåer, i tillegg til kategorier og tabellen med filtre og ATH-merking.
- **Handelsdagbok** (`/logg`): skjema for utførte handler, redigering,
  hurtigsalg, beholdning, saldo og historikk, samt historisk test og tidligere
  morgenrapporter. Denne fanen henter ikke markedsdata, så den virker også når
  datakilden er utilgjengelig.

Webapp-valg:

| Valg | Betydning |
|---|---|
| `--host ADRESSE` | `127.0.0.1` lokalt, `0.0.0.0` i container/sky |
| `--port PORT` | Port, standard `8501` eller `PORT` |
| `--auth-password PASS` | Slå på passordinnlogging |
| `--auth-secret SECRET` | Stabil signeringsnøkkel for sesjoner |
| `--secure-cookies` | Merk innloggingskaken `Secure` bak HTTPS |

API-et er tilgjengelig på `/api/data` og tar de samme parameterne som skjemaet:

```bash
curl 'http://127.0.0.1:8501/api/data?min_week=2&ath_margin=2' | jq

# Vis også Euronext Growth
curl 'http://127.0.0.1:8501/api/data?growth=1' | jq
```

Svaret inneholder alle treff under `stocks`, rangeringen under
`top_candidates`, nyhetssammendraget under `news`, hele pre-market-rapporten
under `premarket` (blant annet `main`, `alternatives`, `blocked`, `warnings`
og `has_recommendation`) og handelsdagboken under `journal` (saldo, beholdning,
realisert resultat og registrerte handler).

Vil du bruke en annen dagbokfil:

```bash
python3 app.py --journal /sti/til/journal.json
```

Vil du nå appen fra andre maskiner:

```bash
python3 app.py --host 0.0.0.0 --port 8501
```

### Lokal mobilmodus på samme nett

Mobilmodusen er ikke en egen kodebase eller en kopi av logikken. Telefonen
åpner den samme webappen, den samme serveren og den samme handelsdagboken som
desktop. Layouten tilpasser seg skjermbredden automatisk, og appen kan legges
til på startskjermen som en PWA.

1. Start på datamaskinen:

   ```bash
   python3 app.py --host 0.0.0.0 --no-browser
   ```

2. Finn datamaskinens lokale IP-adresse, for eksempel med `hostname -I` på
   Linux, og åpne `http://<IP-adresse>:8501` i Chrome på Android-telefonen.
   Telefonen og datamaskinen må være på samme nett. For bruk utenfor
   hjemmenettet, se **Bruke appen utenfor hjemmenettet** nedenfor.
3. Bruk Chrome-menyen **Legg til på startskjermen**. Når appen er installerbar,
   vises også knappen **Installer app** i webappen.

PWA-filene serveres av samme Python-app:

- `/manifest.webmanifest` – navn, ikoner, startside og standalone-visning
- `/sw.js` – tjenestearbeider med offline-side
- `/icons/icon-192.png` og `/icons/icon-512.png` – appikoner

Full PWA-installasjon og tjenestearbeider krever et sikkert opphav: HTTPS eller
`localhost`. På en vanlig HTTP-adresse i lokalnettet kan Android fortsatt lage
en snarvei, men uten offline-cache. Vil du ha full PWA over lokalnettet, kan du
bruke en revers-proxy med gyldig HTTPS-sertifikat, for eksempel Tailscale Serve
eller Caddy. Et alternativ med USB er `adb reverse tcp:8501 tcp:8501` og deretter
`http://localhost:8501` på telefonen.

Telefonen lagrer ikke markedsdata eller dagbok lokalt. Den viser data fra
serveren, slik at desktop og mobil alltid bruker samme rapport, samme
scoremodell og samme JSON-dagbok. Hvis serveren er av eller utilgjengelig, viser
den installerte appen en egen offline-side.

### Bruke appen utenfor hjemmenettet

Det finnes to trygge varianter:

1. **PC-en hjemme + privat nett.** Installer Tailscale på PC-en og telefonen,
   og bruk Tailscale Serve for HTTPS. Da trenger ikke telefonen å være på samme
   fysiske nett, men PC-en må stå på.
2. **Sky eller VPS.** Kjør den samme Python-appen i Docker på en server med
   HTTPS. Da kan PC-en være av, og telefonen fungerer overalt.

#### Passordbeskyttelse

Appen har innebygd passordbeskyttelse for fjernkjøring. Den slås på når
`TP_PASSWORD` eller `--auth-password` er satt:

```bash
TP_PASSWORD='et-langt-passord' \
TP_SECRET='en-lang-tilfeldig-hemmelighet' \
python3 app.py --host 0.0.0.0 --no-browser
```

- Én delt passordinnlogging, ikke flere brukere.
- Signert sesjonskake som varer i 14 dager, med `HttpOnly` og `SameSite=Lax`.
- Kaken merkes `Secure` automatisk bak en HTTPS-proxy, eller med
  `--secure-cookies`/`TP_SECURE_COOKIES=1`.
- Maks 8 feilede forsøk per IP i 10 minutter.
- `/`, `/logg`, `/api/data` og journalendepunktene krever innlogging.
- `/login`, `/healthz`, manifest, ikoner, service worker og offline-siden er
  offentlige slik at appen kan installeres.
- Uten `TP_SECRET` lages en tilfeldig hemmelighet ved oppstart. Da må du logge
  inn på nytt etter hver restart.

#### Docker

```bash
cp .env.example .env
# Rediger .env og sett et sterkt TP_PASSWORD og en lang TP_SECRET
docker compose up -d --build
```

Appen lytter på port `8501`. Sett en revers-proxy med HTTPS foran, for eksempel
Caddy:

```caddyfile
tollbugata.example.no {
    reverse_proxy 127.0.0.1:8501
}
```

Åpne deretter `https://tollbugata.example.no` på Android og velg
**Legg til på startskjermen**. Data og rapporter ligger i Docker-volumet
`tollbugata-storage`; sikkerhetskopier det.

Relevante miljøvariabler:

| Variabel | Standard | Betydning |
|---|---|---|
| `TP_PASSWORD` | tom | Slår på passordinnlogging. Tom = åpen app |
| `TP_SECRET` | tilfeldig | Signerer sesjonskaker. Bør være lang og stabil |
| `TP_SECURE_COOKIES` | `0` | `1` merker kaken `Secure`; bruk bak HTTPS |
| `TP_JOURNAL` | `data/journal.json` | Sti til handelsdagboken |
| `TP_REPORTS_ROOT` | `reports/` | Rotmappe for rapporter og backtest |
| `PORT` | `8501` | Port når appen starter i container |

#### Render

Repoet inneholder `render.yaml` med Docker, helsesjekk på `/healthz`, 1 GB
vedvarende disk og plass til `TP_PASSWORD`/`TP_SECRET`. Bruk **New Blueprint** i
Render, velg repoet og sett passordet når Render spør. Render gir HTTPS og
setter `X-Forwarded-Proto`, slik at innloggingskaken blir `Secure`.

Ved skykjøring ligger dagboken på serveren, ikke på telefonen eller PC-en.
Ta backup av lagringsmappen, og bruk et sterkt passord.

Vil du bare bruke appen lokalt, kan du fortsatt kjøre uten innlogging på
`127.0.0.1`. `--host 0.0.0.0` uten `TP_PASSWORD` gjør appen tilgjengelig for
alle som når porten; bruk det bare på et klarert nett.

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
  intradagvolum eller ordrebok. Den vet ikke hvordan aksjen faktisk åpner.
- **Score er ikke sannsynlighet.** Modellen er ikke historisk kalibrert. En
  score på 70 betyr ikke 70 % sjanse for oppgang.
- **2 % daglig er ikke garantert.** Med 5 000 NOK og 29 + 29 NOK kurtasje er
  kostnaden stor relativt til et 2 % mål. Mange dager bør man stå over.
- **Daglige data kan skjule intradagbevegelser.** En aksje kan ha truffet stop
  før den nådde målet, eller omvendt, uten at daglige OHLC-data viser rekkefølgen.
- **Jevnhet ser bare siste dag.** Modellen skiller et hopp på siste handelsdag
  fra en jevn uke, men rekonstruerer ikke hele ukens dagsforløp. Et hopp
  tidligere i uken fanges bare indirekte gjennom RSI, avstand til SMA5/SMA20 og
  volatilitet.
- **Backtesten er konservativ, men ikke fasit.** Den bruker stop først ved
  usikkerhet, ignorerer ordrebok og kan være utsatt for survivorship bias.
- **Nyhetsanalysen er stikkordbasert.** Den kan ta feil av ironi, tvetydige
  overskrifter og hendelser som ikke står i overskriften.
- **Datakildene er uoffisielle.** Både TradingView, Euronext Live og NewsWeb kan
  endre format eller svare feil. Cache og advarsler reduserer, men fjerner ikke,
  denne risikoen.
- **Ingen automatisk handel.** Du må selv bekrefte kurs, volum og nyheter, og
  du bærer all risiko.

## Prosjektstruktur

```text
tollbugata-profits/
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
│   ├── journal.py           # lokal handelsdagbok og ledig kapital
│   ├── backtest.py          # CSV-backtest uten look-ahead
│   ├── render.py            # terminal, HTML og webvisning
│   ├── serialize.py         # JSON/API-format
│   ├── nordnet.py           # Nordnet-lenker
│   ├── nordnet_slugs.json   # ticker → Nordnet-slug
│   └── cli.py               # felles argumenter
├── tests/
│   ├── test_screener.py
│   ├── test_premarket.py
│   └── test_journal.py
├── data/                    # lokal runtime-data (gitignorert)
│   └── journal.json         # opprettes når du lagrer en handel/saldo
└── README.md
```

## Tester

```bash
python3 -m unittest discover -s tests -v
```

Testene bruker fixtures og går ikke mot nettverket. De dekker blant annet
scoremodellen, kurtasje og hele aksjer, at fremtidige data ikke brukes,
negativt nyhetssentiment, «stå over», uforanderlig rapportlagring,
konservativ backtest, handelsdagbok, redigering, hurtigsalg, saldoendringer,
faner, at loggfanen ikke henter markedsdata, at backtest og rapporthistorikk
vises der, HTTP-skjema og riktig kontantstrøm ved kjøp og salg.
