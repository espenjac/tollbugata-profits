import {
  formatDate,
  formatDateTime,
  formatDaysUntil,
  formatMarketCap,
  formatMoney,
  formatNumber,
  formatPct,
  formatPrice,
} from "../core/format";
import { osloDateString } from "../core/dates";
import {
  ETRADE_RUNNER_MAX_HOLDING_DAYS,
  type EtradeIdea,
  type EtradeReport,
} from "../core/etrade";
import { forStock, uniqueNews, type NewsFeed } from "../core/news";
import { nordnetSlug, nordnetUrl } from "../core/nordnet";
import { marketSession, marketSessionLabel } from "../core/session";
import { atrPct } from "../core/types";
import { useAuth } from "../lib/auth-context";
import { useEtrade } from "../lib/useEtrade";
import {
  ErrorPanel,
  InlineNotice,
  LoadingView,
  SentimentBadge,
} from "../components/ui";
import { BuyButton } from "../components/BuyButton";

export function EtradePage() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const {
    snapshot,
    report,
    loading,
    refreshing,
    error,
    warning,
    notice,
    refresh,
  } = useEtrade(userId);
  const session = marketSession();

  if (loading && !report) {
    return <LoadingView message="Henter markedsdata og bygger Etrade-ideer …" />;
  }

  if (error && !report) {
    return (
      <ErrorPanel
        title="Kunne ikke laste Etrade-modus"
        message={error}
        onRetry={() => void refresh()}
      />
    );
  }

  return (
    <div className="page etrade-page">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            Oslo Børs · {marketSessionLabel(session)} · Etrade 1–3 dager + runner
          </p>
          <h1>Etrade-modus</h1>
          <p>
            Kortsiktige long-ideer med tydelig trigger, stopp, tre delmål og en
            løperandel som kan følge en sterk trend videre.
            Ideene bygges på nytt fra ferskeste kurs hver gang du åpner eller
            oppdaterer. Kjøp først når triggeren brytes med volum.
          </p>
          <div className="hero-meta">
            {snapshot ? (
              <>
                <span>
                  Kurs hentet {formatDateTime(snapshot.universe.fetchedAt)} (
                  {snapshot.universe.source})
                </span>
                <span>
                  Nyheter {formatDateTime(snapshot.news.fetchedAt)} (
                  {snapshot.news.source})
                </span>
              </>
            ) : (
              <span>Markedsdata er ikke tilgjengelig i denne økten.</span>
            )}
          </div>
        </div>
        <div className="hero-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? "Oppdaterer …" : "Oppdater Etrade-ideer"}
          </button>
          <small>
            {report
              ? `Bygget ${formatDateTime(report.generatedAt)}. Ingen ideer lagres.`
              : "Ingen ideer lagres; alt bygges på nytt."}
          </small>
        </div>
      </section>

      {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {warning ? <InlineNotice kind="warning">{warning}</InlineNotice> : null}
      {notice ? <InlineNotice kind="success">{notice}</InlineNotice> : null}

      {report ? (
        <>
          <EtradeSummary report={report} />

          <section className="panel report etrade-report" aria-label="Etrade-ideer">
            <div className="report-head">
              <div>
                <p className="eyebrow">Plan → observer → utfør · long only</p>
                <h2>Dagens Etrade-ideer</h2>
                <p>{report.dataBasis}</p>
              </div>
              <div className="report-stamp">
                <span>Etrade · 1–3 dager</span>
                <strong>{formatDateTime(report.generatedAt)}</strong>
                <small>
                  {report.marketOpen ? "siste handlede kurs" : "siste sluttkurs"}
                </small>
              </div>
            </div>

            {report.warnings.length > 0 ? (
              <div className="report-warnings">
                {report.warnings.map((value) => (
                  <InlineNotice kind="warning" key={value}>
                    {value}
                  </InlineNotice>
                ))}
              </div>
            ) : null}

            {report.ideas.length === 0 ? (
              <div className="no-trade">
                <h3>Ingen Etrade-ideer akkurat nå</h3>
                <p>
                  {report.noIdeaReason ??
                    "Ingen aksjer passer reglene for trigger, risiko og kurtasje."}
                </p>
              </div>
            ) : (
              <>
                <EtradeIdeaCard
                  idea={report.ideas[0]}
                  rank={1}
                  variant="main"
                  news={snapshot?.news ?? null}
                  today={osloDateString(report.generatedAt)}
                />
                {report.ideas.length > 1 ? (
                  <>
                    <h3>Flere ideer ({report.ideas.length - 1})</h3>
                    <p className="muted">
                      Samme regler som hovedideen. Åpne for full plan og
                      risikosjekk.
                    </p>
                    <div className="candidate-list">
                      {report.ideas.slice(1).map((idea, index) => (
                        <EtradeIdeaCard
                          key={idea.candidate.stock.ticker}
                          idea={idea}
                          rank={index + 2}
                          variant="alternative"
                          news={snapshot?.news ?? null}
                          today={osloDateString(report.generatedAt)}
                        />
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            )}
          </section>

          {report.watchlist.length > 0 ? (
            <section className="panel etrade-watchlist">
              <h2>På radaren ({report.watchlist.length})</h2>
              <p className="muted">
                Disse har et oppsett, men bryter minst én regel. De er ikke en
                anbefaling – bruk dem bare som observasjon.
              </p>
              <div className="candidate-list blocked-list">
                {report.watchlist.map((idea, index) => (
                  <EtradeIdeaCard
                    key={idea.candidate.stock.ticker}
                    idea={idea}
                    rank={index + 1}
                    variant="watchlist"
                    news={snapshot?.news ?? null}
                    today={osloDateString(report.generatedAt)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <EtradeGuide />
        </>
      ) : (
        <section className="panel">
          <h2>Ingen Etrade-ideer</h2>
          <p className="muted">
            Ideene kunne ikke bygges fordi markedsdata mangler.
          </p>
        </section>
      )}
    </div>
  );
}

function EtradeSummary({ report }: { report: EtradeReport }) {
  const trade = report.settings.trade;
  return (
    <section className="panel etrade-summary" aria-label="Etrade-sammendrag">
      <div className="etrade-summary-item">
        <span>Klare ideer</span>
        <strong>{report.ideas.length}</strong>
        <small>passer alle regler</small>
      </div>
      <div className="etrade-summary-item">
        <span>På radaren</span>
        <strong>{report.watchlist.length}</strong>
        <small>venter på bekreftelse</small>
      </div>
      <div className="etrade-summary-item">
        <span>Kapital</span>
        <strong>{formatMoney(trade.capital)}</strong>
        <small>fra handelsdagboken</small>
      </div>
      <div className="etrade-summary-item">
        <span>Kurtasje</span>
        <strong>{formatMoney(trade.buyFee + trade.sellFee)}</strong>
        <small>kjøp + salg</small>
      </div>
      <div className="etrade-summary-item">
        <span>Horisont</span>
        <strong>1–3 d</strong>
        <small>selg senest etter 3 handledager</small>
      </div>
    </section>
  );
}

export function EtradeIdeaCard({
  idea,
  rank,
  variant,
  news,
  today,
}: {
  idea: EtradeIdea;
  rank: number;
  variant: "main" | "alternative" | "watchlist";
  news: NewsFeed | null;
  today: string;
}) {
  const stock = idea.candidate.stock;
  const title = (
    <div className="pick-title">
      <span className="rank">#{rank}</span>
      <a
        className="pick-ticker"
        href={nordnetUrl(stock)}
        target="_blank"
        rel="noopener noreferrer"
      >
        {stock.ticker}
      </a>
      <span className="pick-name">{stock.name}</span>
      <span className="badge">{idea.setupLabel}</span>
      <span className="badge growth">
        {idea.horizonDays} dager + runner ≤{ETRADE_RUNNER_MAX_HOLDING_DAYS}
      </span>
    </div>
  );

  const summary = (
    <>
      {title}
      <p className="main-reasons">
        {idea.trigger <= stock.close
          ? idea.setup === "pullback" ? "Retestnivå" : "Bruddnivå"
          : "Kjøp over"}{" "}
        {formatPrice(idea.trigger)} kr · stopp{" "}
        {formatPrice(idea.stopPrice)} kr · T1 {formatPrice(idea.targets[0]?.price)}
      </p>
      {variant === "watchlist" && idea.blockReasons.length > 0 ? (
        <p className="blocked-reason">{idea.blockReasons.join(" · ")}</p>
      ) : null}
    </>
  );

  if (variant === "alternative" || variant === "watchlist") {
    return (
      <details className={`candidate-card candidate-${variant} etrade-idea`}>
        <summary>
          <div className="candidate-summary">
            <div>{summary}</div>
            <div className="summary-scores">
              <span>Etrade {formatNumber(idea.score, 0)}</span>
              <span>R/R {formatRewardRisk(idea.rewardRisk)}</span>
            </div>
          </div>
        </summary>
        <EtradeIdeaDetails
          idea={idea}
          news={news}
          today={today}
          buyable={variant !== "watchlist"}
        />
      </details>
    );
  }

  return (
    <article className="candidate-card candidate-main etrade-idea">
      <div className="candidate-head">
        <div>
          {summary}
          <p className="muted">
            {stock.sector} · {formatMarketCap(stock.marketCap)} · RSI{" "}
            {formatNumber(stock.rsi, 0)} · ATR {formatPct(atrPct(stock))}
          </p>
        </div>
        <div className="etrade-score">
          <span>Etrade</span>
          <strong>{formatNumber(idea.score, 0)}</strong>
          <small>R/R {formatRewardRisk(idea.rewardRisk)}</small>
        </div>
      </div>
      <EtradeIdeaDetails
        idea={idea}
        news={news}
        today={today}
        buyable
      />
    </article>
  );
}

function EtradeIdeaDetails({
  idea,
  news,
  today,
  buyable,
}: {
  idea: EtradeIdea;
  news: NewsFeed | null;
  today: string;
  buyable: boolean;
}) {
  const stock = idea.candidate.stock;
  const candidate = idea.candidate;
  const newsItems = news ? uniqueNews(forStock(news, stock), 3) : [];
  const earningsText = stock.earningsDate
    ? `${formatDate(stock.earningsDate)} (${formatDaysUntil(stock.earningsDate, today)})`
    : "ikke oppgitt";
  const resistanceText =
    candidate.resistance !== null
      ? `${formatPrice(candidate.resistance)} kr (${formatPct(candidate.technicalUpside)})`
      : "Åpent rom over kjent topp";
  const supportText =
    candidate.support !== null
      ? `${formatPrice(candidate.support)} kr`
      : "Ingen tydelig støtte i datagrunnlaget";

  return (
    <div className="candidate-details">
      {variantBlocked(idea) ? (
        <div className="candidate-blocked">
          <strong>Ikke klar for handel</strong>
          <ul className="report-list warnings">
            {idea.blockReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="etrade-levels">
        <div className="etrade-level etrade-level-entry">
          <span>
            {idea.trigger <= stock.close ? "Historisk bruddnivå" : "Kjøp over"}
          </span>
          <strong>{formatPrice(idea.trigger)} kr</strong>
          <small>
            {idea.trigger <= stock.close
              ? `${idea.setup === "pullback" ? "Retest" : "Brudd"} allerede bekreftet · ${formatPct(
                  Math.abs(triggerDistance(stock.close, idea.trigger)),
                  1,
                  false,
                )} over nivået`
              : `${formatPct(triggerDistance(stock.close, idea.trigger), 1, false)} over siste kurs`}
            {idea.invalidation !== null
              ? ` · ingen handel under ${formatPrice(idea.invalidation)}`
              : ""}
          </small>
        </div>
        <div className="etrade-level etrade-level-stop">
          <span>Stopp</span>
          <strong>{formatPrice(idea.stopPrice)} kr</strong>
          <small>
            {formatPct(-idea.stopPct)} · netto{" "}
            {formatMoney(idea.stopNet, 0, true)}
          </small>
        </div>
        {idea.targets.map((target) => (
          <div className="etrade-level etrade-level-target" key={target.label}>
            <span>{target.label}</span>
            <strong>{formatPrice(target.price)} kr</strong>
            <small>
              {formatPct(target.pct)} · netto realisert til nivået{" "}
              <span className={target.net >= 0 ? "positive" : "negative"}>
                {formatMoney(target.net, 0, true)}
              </span>
            </small>
          </div>
        ))}
      </div>

      <p className="etrade-position">
        {idea.shares} aksjer · {formatMoney(idea.totalCost)} inkl. kurtasje ·{" "}
        {formatMoney(idea.cashLeft)} igjen av kapitalen
      </p>

      {buyable ? (
        <BuyButton ticker={stock.ticker} slug={nordnetSlug(stock)} />
      ) : null}

      <div className="etrade-plan-note">
        <strong>Plan – observer – utfør:</strong>{" "}
        {idea.invalidation !== null
          ? `Ingen handel under ${formatPrice(idea.invalidation)} kr. `
          : ""}
        {idea.trigger <= stock.close
          ? `${idea.setup === "pullback" ? "Retesten over SMA20/VWAP" : "Bruddet over historisk nivå"} er allerede bekreftet. Vurder inngang ved gjeldende kurs bare hvis volum og risiko fortsatt stemmer. `
          : `Kjøp først når kursen bryter over ${formatPrice(idea.trigger)} kr med volum. `}
        Ta delgevinst ved T1 og T2. Ved T3 selges deler av resten; en mindre
        runner følger ATR-trailing stop i opptil {ETRADE_RUNNER_MAX_HOLDING_DAYS} handledager.
      </div>

      <div className="etrade-checks">
        {idea.checks.map((check) => (
          <span
            className={`chip ${check.ok ? "check-ok" : "check-fail"}`}
            key={check.label}
          >
            <span aria-hidden="true">{check.ok ? "✓" : "✕"}</span>
            {check.label}
          </span>
        ))}
      </div>

      <div className="report-cols">
        <div>
          <h3>Hvorfor denne ideen</h3>
          <ul className="report-list">
            {candidate.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <h3>Nivåer</h3>
          <ul className="report-list">
            <li>Trigger: {formatPrice(idea.trigger)} kr</li>
            <li>
              Forrige dags topp: {stock.previousDayHigh !== null
                ? `${formatPrice(stock.previousDayHigh)} kr`
                : "ikke tilgjengelig"}
            </li>
            <li>
              Ingen handel under:{" "}
              {idea.invalidation === null
                ? "–"
                : `${formatPrice(idea.invalidation)} kr`}
            </li>
            <li>Motstand: {resistanceText}</li>
            <li>Støtte: {supportText}</li>
            <li>
              Volumforhold:{" "}
              {candidate.volumeRatio === null
                ? "–"
                : `${formatNumber(candidate.volumeRatio, 1)}×`}
              {idea.volumePace !== null
                ? ` (${formatNumber(idea.volumePace, 1)}× av forventet så langt)`
                : ""}
            </li>
            <li>ATR: {formatPct(atrPct(stock))}</li>
            <li>Neste resultat: {earningsText}</li>
          </ul>
        </div>
        <div>
          <h3>Nyheter</h3>
          {newsItems.length > 0 ? (
            <ul className="news-mini">
              {newsItems.map((item) => (
                <li key={`${item.messageId}-${item.publishedAt.toISOString()}`}>
                  <SentimentBadge sentiment={item.sentiment} />
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.title}
                  </a>
                  <small>{formatDateTime(item.publishedAt)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {candidate.newsSignal.count === 0
                ? "Ingen relevante børsmeldinger i nyhetsvinduet."
                : `${candidate.newsSignal.latestTitle} (${candidate.newsSignal.count} meldinger)`}
            </p>
          )}
          <h3>Risiko og forbehold</h3>
          <ul className="report-list warnings">
            {idea.warnings.length === 0 ? (
              <li>Ingen særskilte risikoadvarsler.</li>
            ) : (
              idea.warnings.map((value) => <li key={value}>{value}</li>)
            )}
          </ul>
          <p className="muted">
            Etrade-modus er long only, utfører ingen handler og er ikke
            investeringsrådgivning. Kontroller kurs og volum rett før inngang.
          </p>
        </div>
      </div>
    </div>
  );
}

function EtradeGuide() {
  return (
    <section className="panel etrade-guide">
      <h2>Slik brukes Etrade-modus</h2>
      <ol className="etrade-rules">
        <li>Kjøp bare når triggeren brytes med volum – ikke på forhånd.</li>
        <li>Stoppen gjelder fra inngang. Flytt den aldri ned.</li>
        <li>
          Ta delgevinst ved T1, flytt stopen til inngang og la resten løpe mot
          T2/T3.
        </li>
        <li>Selg senest etter 3 handledager hvis målet ikke er nådd.</li>
        <li>
          Long only. Appen shorter ikke, sender ingen ordrer og lagrer ikke
          Etrade-ideene som historikk.
        </li>
      </ol>
      <p className="muted">
        Modusen er inspirert av kortsiktig momentum-handel, men er ikke en kopi
        av enkeltpersoner eller en garanti for avkastning. Med liten konto og
        fast kurtasje må hvert mål dekke kostnadene før det er verdt å ta.
      </p>
    </section>
  );
}

function variantBlocked(idea: EtradeIdea): boolean {
  return idea.blockReasons.length > 0;
}

function triggerDistance(close: number, trigger: number): number {
  if (close <= 0) {
    return 0;
  }
  return trigger / close - 1;
}

function formatRewardRisk(value: number | null): string {
  return value === null ? "–" : `${formatNumber(value, 1)}:1`;
}
