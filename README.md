# Tollbugata Profits

Et lite, selvstendig verktøy som går gjennom aksjene på Oslo Børs og lister opp
aksjer som:

1. har **positiv trend siste uke**, og
2. viser hvor langt de er fra **all-time high** – aksjer på/ved ATH tas med,
   men merkes tydelig med **ATH**.

Du kan bruke det som kommandolinje eller som en lokal webapp i nettleseren.
Ingen API-nøkkel og ingen tredjeparts Python-pakker er nødvendig.

> Dette er et screen-verktøy, ikke investeringsråd. Dataene kan være forsinket
> eller inneholde feil.

## Kom i gang

Krever Python 3.10 eller nyere.

```bash
cd tollbugata_profits

# Terminal: vis dagens treff
python3 screener.py

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

## Hvordan kriteriene virker

| Kriterium | Standard | Forklaring |
|---|---|---|
| Positiv uke | `Perf.W > 0` | Aksjen har steget siste uke. `--min-week 2` krever minst 2 %. |
| Kort trend | `kurs > SMA5` | Kursen er over 5-dagers glidende gjennomsnitt. Slås av med `--no-sma5`. |
| ATH-merking | `kurs ≥ ATH × 0,99` | Aksjer på/ved ATH tas med og merkes tydelig med **ATH**. Justeres med `--ath-margin`. |
| Skjul ATH | av | `--exclude-ath` utelater aksjer på/ved ATH helt. |
| Ekstra trend | av | `--sma20` krever også at kursen er over 20-dagers snitt. |
| Euronext Growth | skjult | Aksjer på Euronext Growth vises ikke som standard fordi de normalt ikke kan holdes på ASK. `--include-growth` viser dem. |

«All-time high» hentes fra TradingView (`High.All`) og kryssjekkes mot
52-ukershøyeste. Enkelte eldre tall er ikke justert for splitt/omvendt splitt.
Hvis ATH-tallet åpenbart er ødelagt, brukes en konservativ regel: aksjen tas
bare med dersom kursen ligger klart under 52-ukershøyeste. Ellers merkes den
som usikker og utelates.

## ASK og Euronext Growth

Aksjer notert på **Euronext Growth** kan normalt ikke holdes på aksjesparekonto
(ASK), fordi Euronext Growth er en multilateral handelsfasilitet og ikke et
regulert marked. Appen skjuler derfor disse aksjene som standard.

TradingView bruker samme børskode (`OSL`) for Oslo Børs, Euronext Expand og
Euronext Growth. For å skille dem henter appen den offisielle listen over
Euronext Growth-aksjer fra Euronext Live og cacher den i
`.cache/euronext_growth.json` i 24 timer. Listen brukes bare til å merke
tickere; selve kursdataene kommer fortsatt fra TradingView.

- **Standard:** Euronext Growth er skjult, og de telles som «Euronext Growth
  (ikke ASK)» blant aksjene som er filtrert bort.
- **Vis dem likevel:** bruk `--include-growth` i terminalen eller huk av
  **Vis Euronext Growth** i webappen.
- **Hvis listen ikke kan hentes:** appen fortsetter med en advarsel, men da kan
  Euronext Growth-aksjer være med i resultatet. Sjekk advarselen før du handler.

Dette er en praktisk filtrering, ikke en garanti for at alle gjenværende aksjer
er ASK-egnede. Andre instrumenter eller selskapsforhold kan også påvirke om en
aksje kan holdes på ASK. Bekreft alltid med banken eller megleren din.

## Resultat og ex-dato

Listen viser også hvor mange dager det er til neste resultatfremleggelse
(**Resultat**) og til neste ex-dividend-dato (**Ex-dato**). `0` betyr i dag, og
`–` betyr at TradingView ikke har en kommende dato. Hold musen over tallet i
webvisningen for å se selve datoen.

I terminalen vises det som en egen **NESTE**-kolonne (f.eks. `R 14d · E 3d`)
når terminalen er bred nok. `R` = resultat, `E` = ex-dato.

Feltene er også med i JSON/CSV som `earnings_date`, `days_to_earnings`,
`ex_dividend_date` og `days_to_ex_dividend`.

## Nyheter siden forrige handelsdag

Webappen viser en egen seksjon med **børsmeldinger fra Oslo Børs NewsWeb** for
selskapene som er med i screenen. Utgangspunktet er da forrige handelsdag
stengte (16:30 norsk tid):

- Nattens og morgenens meldinger beholdes når børsen åpner kl. 09:00.
- Meldingene blir liggende hele handelsdagen, også etter stengetid, og byttes
  først ut ved midnatt.
- På lørdag, søndag og mandag morgen vises meldinger siden fredag kl. 16:30.
- Meldinger publisert etter dagens åpning merkes med **NY**, slik at du ser hva
  som er ferskt uten at nattens nyheter forsvinner.

Appen kjenner ikke børsferier. På en helligdag kan derfor utgangspunktet bli
feil; datoen og klokkeslettet som vises, gjør det likevel tydelig hva som er
brukt.

Hver aksje i tabellen får en liten **📰**-markør med antall meldinger. Topp 5-
kortene viser siste overskrift, og seksjonen «Nyheter siden forrige handelsdag»
lister opp selskapene med meldinger, antall og alle unike overskrifter. Eldre
overskrifter kan ekspanderes. Klikk på en overskrift for å åpne selve meldingen
hos NewsWeb.

### Positiv, negativ eller nøytral

Hver overskrift får en grov markering: **Positiv**, **Negativ**, **Nøytral**
eller **Blandet** (når selskapet har både positive og negative meldinger).
Markeringen bygger på en enkel stikkordsanalyse av overskriften, på norsk og
engelsk. Den er bare et hjelpemiddel for å skanne listen raskt – ikke en
vurdering av nyheten, og ikke et kjøpssignal. En overskrift kan være misvisende,
og selve meldingen kan inneholde viktig informasjon som ikke står i overskriften.
Les alltid kilden før du handler.

NewsWeb publiserer ofte samme melding på norsk og engelsk. Appen viser én
overskrift per minutt og foretrekker den norske versjonen når den kan avgjøre
det. Antallet teller likevel alle meldingene.

Dette er **børsmeldinger**, ikke all medieomtale. Selskapet kan ha fått
oppmerksomhet i aviser, TV eller sosiale medier uten at det ligger en melding
hos NewsWeb. Se også på resultatdatoer og ex-datoer før du handler.

Nyhetene caches i `.cache/oslo_bors_news.json` i 5 minutter. Ved nettverksfeil
brukes siste cache med en advarsel; selve aksjescreeningen stopper ikke.
Bruk `--no-news` for å slå av nyhetshenting.

I JSON/API finnes sammendraget under `news` (blant annet `since`,
`session_open` og `window`), og hver aksje har `news_count`, `news_new_count`,
`news_sentiment` og `latest_news` med tittel, tidspunkt, kategori, sentiment og
lenke. CSV har feltene `news_count`, `news_new_count`, `news_sentiment`,
`latest_news_time`, `latest_news_title` og `latest_news_url`.

## Rangering: slik beregnes Topp 5

Appen rangerer treffene og viser en **Topp 5 kandidater**-liste. Dette er en
teknisk watchlist for kortsiktig handel – ikke et kjøpssignal og ikke en
forutsigelse av avkastning. Logikken ligger i `oslo_screener/strategy.py` og
består av tre steg:

1. **Kandidatfilter** – aksjen må være egnet nok til å vurderes.
2. **Poengberegning** – seks normale trekk vektes sammen til en score fra 0 til 100.
3. **Straffepoeng og sortering** – kjente risikofaktorer trekker scoren ned, og
   kandidatene sorteres synkende.

Rangeringen gjøres bare på aksjene som allerede har passert screenen. Er
Euronext Growth skjult, blir de aldri med i Topp 5.

### 1. Kandidatfilter

Før poengberegningen må aksjen oppfylle alle disse kravene:

| Krav | Regel |
|---|---|
| Instrument | Må være aksje eller depotsertifikat (DR). |
| Ukeavkastning | Må være positiv og ikke over 25 %. |
| Kurs | Minst 5 kroner. |
| Kort trend | Kursen må ligge over SMA5. |
| Trend | Kursen må ligge over SMA20. |
| Månedstrend | Månedsavkastningen kan ikke være negativ. |
| RSI | RSI kan ikke være over 82. |
| Markedsverdi | Minst 300 mill. kroner. |
| Likviditet | Gjennomsnittlig omsetning må være minst 5 mill. kroner per dag. |

Manglende månedsavkastning, RSI, markedsverdi eller likviditet fører ikke
automatisk til at aksjen forkastes. Slike verdier får i stedet en lav eller
nøytral delscore. Kravene til ukeavkastning, kurs, SMA5 og SMA20 er derimot
strengere: mangler de, blir aksjen ikke kandidat.

### 2. Poengberegning

Hver delscore normaliseres til 0–1 og vektes. Formelen er:

```text
score = 100 × (
    0,30 × momentum
  + 0,15 × månedstrend
  + 0,20 × trend
  + 0,20 × likviditet
  + 0,10 × volatilitet
  + 0,05 × RSI-tilpasning
)
```

| Faktor | Vekt | Hvordan delscoren beregnes | 0 poeng | 1 poeng |
|---|---:|---|---|---|
| Momentum | 30 % | `ukeavkastning / 10 %`, begrenset til 0–1 | 0 % | 10 % eller mer |
| Månedstrend | 15 % | `månedsavkastning / 20 %`, begrenset til 0–1 | 0 % | 20 % eller mer |
| Trend | 20 % | `(kurs / SMA20 − 1) / 10 %`, begrenset til 0–1 | På SMA20 | 10 % over SMA20 |
| Likviditet | 20 % | `log10(snittomsetning / 1 mill.) / 2`, begrenset til 0–1 | 1 mill. per dag | 100 mill. per dag |
| Volatilitet | 10 % | `1 − abs(ATR% − 2,5 %) / 2,5 %`, begrenset til 0–1 | 0 % eller 5 %+ | ATR nær 2,5 % |
| RSI | 5 % | `1 − abs(RSI − 62) / 25`, begrenset til 0–1 | RSI ≤ 37 eller ≥ 87 | RSI nær 62 |

Manglende data får slike nøytrale verdier: likviditet `0,35`, volatilitet
`0,5`, RSI `0,5` og månedstrend `0`. Det gjør at en aksje med manglende
likviditetsdata verken får full uttelling eller automatisk null.

### 3. Straffepoeng

Etter den vektede summen trekkes poeng for kjente risikofaktorer:

| Forhold | Straff |
|---|---:|
| RSI 75 eller høyere | −10 |
| RSI 45 eller lavere | −5 |
| Ukeavkastning over 15 % | −5 |
| Kurs under 10 kroner | −10 |
| Snittomsetning under 10 mill. per dag | −8 |
| Markedsverdi under 1 mrd. | −5 |
| Resultat i dag eller i morgen | −10 |
| Ex-dato i dag eller i morgen | −8 |

Til slutt begrenses scoren til 0–100. Det betyr at straffepoengene kan gjøre en
aksje mindre attraktiv, men aldri gi negativ score.

### 4. Sortering og tie-break

Kandidatene sorteres etter:

1. høyest score,
2. høyest ukeavkastning ved lik score,
3. ticker alfabetisk dersom også ukeavkastningen er lik.

Appen viser maksimalt fem kandidater. Er det færre enn fem som passer
kandidatfiltrene, vises bare de som finnes. Sorteringen skjer på uavrundet score;
tallet som vises i grensesnittet, er avrundet.

### 5. Begrunnelser og advarsler

Hvert kort viser hvorfor aksjen er med: uke- og månedsavkastning, avstand over
SMA20, RSI, snittomsetning per dag og ATR. I tillegg vises advarsler når det
finnes kjente risikofaktorer, for eksempel resultat eller ex-dato i dag/i morgen,
RSI over 75, sterk uke, lav likviditet, liten markedsverdi eller manglende
månedstrend.

Noen advarsler har også straffepoeng, mens andre bare er informasjon. For
eksempel gir manglende månedstrend ingen egen straff, men månedsdelen av scoren
blir da 0.

### 6. Viktige begrensninger

- Modellen bruker **daglige data** fra TradingView. Den vet ikke hvordan aksjen
  åpner, hvordan volumet utvikler seg utover dagen, eller hvor bred spreaden er.
- Vektene er faste og håndjusterte. De er ikke maskinlært eller garantert
  lønnsomme, og de kan endres dersom kriteriene endres.
- Nyheter og sentiment inngår **ikke** i scoren. De vises som tilleggsinformasjon
  og må vurderes separat.
- En høy score betyr bare at aksjen passer bedre med de tekniske kriteriene
  akkurat nå. Det er ikke sannsynlighet for oppgang, og ikke et kjøpssignal.
- Topp 5 er en rangering blant dagens treff, ikke blant alle aksjer på Oslo Børs.
  Endres screenekriteriene, endres også kandidatgrunnlaget.

Slik kan listen brukes om morgenen:

1. Åpne appen før børsen åpner og noter de fem kandidatene.
2. Sjekk om det er nyheter, resultat eller andre hendelser i aksjene.
3. Etter åpning: bekreft at kursen holder seg over SMA5 og gjerne over
   gårsdagens høyeste, at volumet er normalt eller høyere, og at spreaden er
   smal.
4. Vent på en rolig pullback/consolidering i stedet for å jage et stort gap.
5. Bruk stop-loss og posisjonsstørrelse som passer risikoen. Planen din er å
   ikke eie aksjer over natten – hold deg til den.

Listen sier bare at aksjene teknisk sett ser interessante ut akkurat nå. Den
bruker daglige data og vet ikke hvordan aksjen åpner eller hvordan volumet blir
utover dagen. Den kan ikke forutsi morgendagens bevegelse. Kortsiktig handel har
høy risiko, og dette er ikke investeringsråd.

## Kommandolinje

```bash
# Alle treff, ikke bare de 40 første
python3 screener.py --top 0

# Strengere: minst 2 % opp siste uke og 2 % ATH-margin
python3 screener.py --min-week 2 --ath-margin 2

# Skjul aksjer som er på/ved all-time high
python3 screener.py --exclude-ath

# Fjern SMA5-kravet
python3 screener.py --no-sma5

# Vis også aksjer på Euronext Growth (skjult som standard)
python3 screener.py --include-growth

# Bare selskaper med markedsverdi over 1 mrd og omsetning over 5 mill
python3 screener.py --min-cap 1 --min-turnover 5

# Lag en selvstendig HTML-rapport
python3 screener.py --html rapport.html

# JSON eller CSV (til fil eller stdout)
python3 screener.py --json treff.json --quiet
python3 screener.py --csv treff.csv --quiet
python3 screener.py --json - --quiet | jq '.stocks[:5]'

# Oppdater automatisk hvert 5. minutt
python3 screener.py --loop 300
```

### Viktige valg

| Valg | Betydning |
|---|---|
| `--min-week PCT` | Minste ukeavkastning i prosent. |
| `--ath-margin PCT` | Hvor nær ATH (i prosent) som regnes som «på ATH» og merkes. |
| `--exclude-ath` | Utelat aksjer på/ved ATH i stedet for å merke dem. |
| `--no-sma5` | Dropp kravet om kurs over SMA5. |
| `--sma20` | Krev også kurs over SMA20. |
| `--min-cap MRD` | Minste markedsverdi i milliarder NOK. |
| `--min-turnover MILL` | Minste omsatte verdi i millioner NOK. |
| `--only-stocks` | Utelat depotsertifikater (DR). |
| `--include-growth` | Vis også aksjer på Euronext Growth. |
| `--allow-unknown-ath` | Ta med aksjer der ATH ikke kan fastslås. |
| `--sort FELT` | `week`, `month`, `market_cap`, `ath_distance`, `name` eller `ticker`. |
| `--top N` | Antall rader i terminalen. `0` = alle. |
| `--refresh` | Hent nye data og ignorer cache. |
| `--cache-ttl SEK` | Hvor lenge cache brukes (standard 600). |
| `--no-news` | Ikke hent børsmeldinger fra Oslo Børs NewsWeb. |
| `--loop SEK` | Kjør screenen på nytt med jevne mellomrom. |

## Webapp

```bash
python3 app.py
```

Åpne <http://127.0.0.1:8501>. Der kan du:

- justere minste ukeavkastning og ATH-margin,
- slå SMA5/SMA20-filteret av og på,
- vise eller skjule aksjer på/ved all-time high – de er alltid tydelig merket med **ATH**,
- vise Euronext Growth-aksjer midlertidig, selv om de er skjult som standard,
- se antall dager til neste resultatfremleggelse og ex-dato (hold musen over for datoen),
- se børsmeldinger siden forrige handelsdag stengte, både i en egen seksjon og som 📰-markør per aksje, med enkel positiv/negativ/nøytral-markering,
- åpne aksjen direkte i **Nordnet** med graf via lenken i «Graf»-kolonnen,
- søke på ticker, selskap eller sektor,
- sortere ved å klikke på kolonnene,
- hente ferske data med **Hent på nytt**.

API-et er tilgjengelig på `/api/data`, og tar de samme parameterne som skjemaet:

```bash
curl 'http://127.0.0.1:8501/api/data?min_week=2&ath_margin=2' | jq

# Vis også Euronext Growth
curl 'http://127.0.0.1:8501/api/data?growth=1' | jq
```

Svaret inneholder alle treff under `stocks`, den rangerte listen under
`top_candidates` og et nyhetssammendrag under `news`. Hver aksje har `market`
(`oslo` eller `euronext_growth`), `is_growth`, `news_count`, `news_new_count`,
`news_sentiment` og `latest_news`. `counts.euronext_growth_excluded` viser hvor
mange Euronext Growth-aksjer som ble filtrert bort, og `markets.euronext_growth`
inneholder kildestatus for segmentlisten.

Vil du nå appen fra andre maskiner:

```bash
python3 app.py --host 0.0.0.0 --port 8501
```

## Datakilde og begrensninger

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

## Prosjektstruktur

```
tollbugata_profits/
├── screener.py              # kommandolinje
├── app.py                   # lokal webserver
├── oslo_screener/
│   ├── data.py              # henting, cache og parsing
│   ├── markets.py           # Euronext Growth-liste og ASK-filter
│   ├── news.py              # børsmeldinger fra Oslo Børs NewsWeb
│   ├── models.py            # Stock, marked og ATH-logikk
│   ├── logic.py             # kriterier, filtrering og sortering
│   ├── render.py            # terminaltabell og HTML-dashboard
│   ├── serialize.py         # JSON/API-format
│   ├── strategy.py          # Topp 5-rangering for kortsiktig handel
│   ├── nordnet.py           # Nordnet-lenker
│   ├── nordnet_slugs.json   # ticker → Nordnet-slug
│   └── cli.py               # felles argumenter
├── tests/
│   └── test_screener.py
└── README.md
```

## Tester

```bash
python3 -m unittest discover -s tests -v
```

Testene bruker fixtures og går ikke mot nettverket.
