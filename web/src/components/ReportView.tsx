import { osloDateString } from "../core/dates";
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
import { nordnetUrl } from "../core/nordnet";
import { forStock, uniqueNews, type NewsFeed } from "../core/news";
import { buildEntryZone } from "../core/opening";
import { isAtHigh } from "../core/screen";
import {
  atrPct,
  riskLevel,
  type PlannedCandidate,
  type PremarketReport,
  type TradePlan,
} from "../core/types";
import { CategoryChips, InlineNotice, SentimentBadge } from "./ui";

export function ReportView({
  report,
  news = null,
  historical = false,
  onBack,
}: {
  report: PremarketReport;
  news?: NewsFeed | null;
  historical?: boolean;
  onBack?: () => void;
}) {
  const categories = { momentum: 0, breakout: 0, news: 0 };
  for (const planned of report.ranked) {
    for (const category of planned.candidate.categories) {
      if (category in categories) {
        categories[category as keyof typeof categories] += 1;
      }
    }
  }

  return (
    <section className="panel report" aria-label="Dagens pre-market-rapport">
      {historical ? (
        <div className="history-banner">
          <div>
            <strong>Historisk rapport</strong>
            <span>{formatDate(osloDateString(report.generatedAt))}</span>
          </div>
          {onBack ? (
            <button className="btn btn-small" type="button" onClick={onBack}>
              Tilbake til dagens rapport
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="report-head">
        <div>
          <p className="eyebrow">Pre-market · Oslo Børs</p>
          <h2>Dagens hovedkandidat</h2>
          <p>
            {report.dataBasis} Kandidatene er et teknisk utgangspunkt. Ikke et
            kjøpssignal – bekreft etter åpning.
          </p>
        </div>
        <div className="report-stamp">
          <span>Rapport generert</span>
          <strong>{formatDateTime(report.generatedAt)}</strong>
          <small>
            {report.isPremarket
              ? "før børsåpning"
              : "etter børsåpning – estimat"}
          </small>
        </div>
      </div>

      {report.warnings.length > 0 ? (
        <div className="report-warnings">
          {report.warnings.map((warning) => (
            <InlineNotice kind="warning" key={warning}>
              {warning}
            </InlineNotice>
          ))}
        </div>
      ) : null}

      {report.main === null ? (
        <>
          <div className="no-trade">
            <h3>Ingen anbefalte kandidater i dag – vurder å stå over.</h3>
            <p>
              {report.noTradeReason ??
                "Kandidatene oppfyller ikke kravene til score, risiko og likviditet."}
            </p>
          </div>
          <div className="chips category-counts">
            <span className="chip">
              Momentum <strong>{categories.momentum}</strong>
            </span>
            <span className="chip">
              Breakout <strong>{categories.breakout}</strong>
            </span>
            <span className="chip">
              Nyhetsdrevet <strong>{categories.news}</strong>
            </span>
          </div>
          {report.blocked.length > 0 ? (
            <>
              <h3>Mulige alternativer – ikke anbefalt som hovedhandel</h3>
              <p className="muted">
                Åpne en kandidat for plan, nyheter, risiko og scenarier.
              </p>
              <div className="candidate-list">
                {report.blocked.map((planned, index) => (
                  <CandidateCard
                    key={planned.candidate.stock.ticker}
                    planned={planned}
                    rank={index + 1}
                    report={report}
                    news={news}
                    variant="blocked"
                  />
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <>
          <CandidateCard
            planned={report.main}
            rank={1}
            report={report}
            news={news}
            variant="main"
          />
          <div className="chips category-counts">
            <span className="chip">
              Momentum <strong>{categories.momentum}</strong>
            </span>
            <span className="chip">
              Breakout <strong>{categories.breakout}</strong>
            </span>
            <span className="chip">
              Nyhetsdrevet <strong>{categories.news}</strong>
            </span>
          </div>
          <h3>Anbefalte alternativer ({report.alternatives.length})</h3>
          <p className="muted">
            Åpne en kandidat for samme detaljer som hovedkandidaten.
          </p>
          <div className="candidate-list">
            {report.alternatives.length === 0 ? (
              <p className="muted">Ingen anbefalte alternativer.</p>
            ) : (
              report.alternatives.map((planned, index) => (
                <CandidateCard
                  key={planned.candidate.stock.ticker}
                  planned={planned}
                  rank={index + 2}
                  report={report}
                  news={news}
                  variant="alternative"
                />
              ))
            )}
          </div>
          {report.blocked.length > 0 ? (
            <>
              <h3>Ikke anbefalte kandidater ({report.blocked.length})</h3>
              <p className="muted">
                Disse kan ha høy totalscore, men er blokkert av score-, risiko-
                eller likviditetskrav. De vises bare som informasjon og er ikke
                en anbefaling.
              </p>
              <div className="candidate-list blocked-list">
                {report.blocked.map((planned, index) => (
                  <CandidateCard
                    key={planned.candidate.stock.ticker}
                    planned={planned}
                    rank={index + 1}
                    report={report}
                    news={news}
                    variant="blocked"
                  />
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

function scoreClass(value: number, invert = false): string {
  const score = invert ? 100 - value : value;
  if (score >= 65) {
    return "score-good";
  }
  if (score >= 50) {
    return "score-mid";
  }
  return "score-low";
}

function ScoreBox({
  label,
  value,
  hint,
  invert = false,
}: {
  label: string;
  value: number;
  hint: string;
  invert?: boolean;
}) {
  return (
    <div className={`score-box ${scoreClass(value, invert)}`}>
      <span>{label}</span>
      <strong>{formatNumber(value, 0)}</strong>
      <small>{hint}</small>
    </div>
  );
}

function CandidateCard({
  planned,
  rank,
  report,
  news,
  variant,
}: {
  planned: PlannedCandidate;
  rank: number;
  report: PremarketReport;
  news: NewsFeed | null;
  variant: "main" | "alternative" | "blocked";
}) {
  const candidate = planned.candidate;
  const stock = candidate.stock;
  const atHigh = isAtHigh(stock, report.criteria);
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
      {atHigh ? (
        <span className="badge" title="På/ved all-time high">
          ATH
        </span>
      ) : null}
      <CategoryChips categories={candidate.categories} />
    </div>
  );

  if (variant === "main") {
    return (
      <article className="candidate-card candidate-main">
        <div className="candidate-head">
          <div>
            {title}
            <p className="main-reasons">{candidate.reasons.join(" · ")}</p>
            <p className="muted">
              {stock.sector} · {formatMarketCap(stock.marketCap)} · RSI{" "}
              {formatNumber(stock.rsi, 0)}
            </p>
          </div>
          <div className="score-row">
            <ScoreBox
              label="Total"
              value={candidate.score}
              hint="relativ poengsum"
            />
            <ScoreBox
              label="Mulighet"
              value={candidate.opportunityScore}
              hint="teknisk + nyheter"
            />
            <ScoreBox
              label="Risiko"
              value={candidate.riskScore}
              hint={riskLevel(candidate)}
              invert
            />
          </div>
        </div>
        <CandidateDetails planned={planned} report={report} news={news} />
      </article>
    );
  }

  return (
    <details
      className={`candidate-card candidate-${variant}`}
      open={variant === "blocked" ? false : undefined}
    >
      <summary>
        <div className="candidate-summary">
          <div>
            {title}
            <p className="main-reasons">{candidate.reasons.join(" · ")}</p>
            {planned.blockReasons.length > 0 ? (
              <p className="blocked-reason">
                {planned.blockReasons.join(" · ")}
              </p>
            ) : null}
          </div>
          <div className="summary-scores">
            <span>Total {formatNumber(candidate.score, 0)}</span>
            <span>Risiko {formatNumber(candidate.riskScore, 0)}</span>
          </div>
        </div>
      </summary>
      <CandidateDetails planned={planned} report={report} news={news} />
    </details>
  );
}

function CandidateDetails({
  planned,
  report,
  news,
}: {
  planned: PlannedCandidate;
  report: PremarketReport;
  news: NewsFeed | null;
}) {
  const candidate = planned.candidate;
  const stock = candidate.stock;
  const trade = planned.trade;
  const settings = report.settings;
  const entryZone = buildEntryZone(planned);
  const newsItems = news ? uniqueNews(forStock(news, stock), 3) : [];
  const today = osloDateString(report.generatedAt);
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
      {planned.blockReasons.length > 0 && planned.recommendable === false ? (
        <div className="candidate-blocked">
          <strong>Ikke anbefalt som hovedhandel</strong>
          <ul className="report-list warnings">
            {planned.blockReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="report-grid trade-grid">
        <div>
          <span>Rapportens entry</span>
          <strong>{formatPrice(stock.close)} kr</strong>
          <small>gårsdagens sluttkurs – se åpningsplanen</small>
        </div>
        <div className={entryZone.valid ? "entry-zone" : "entry-zone invalid"}>
          <span>Anbefalt kjøpssone</span>
          <strong>
            {entryZone.valid
              ? `${formatPrice(entryZone.low)}–${formatPrice(entryZone.high)} kr`
              : "Stå over"}
          </strong>
          <small>
            {entryZone.valid
              ? "0,5 × ATR · utenfor sonen = stå over"
              : "ingen gyldig sone i dag"}
          </small>
        </div>
        <div>
          <span>Antall aksjer</span>
          <strong>{trade.shares}</strong>
          <small>hele aksjer, ikke brøkdeler</small>
        </div>
        <div>
          <span>Kapitalbruk</span>
          <strong>{formatMoney(trade.totalCost)}</strong>
          <small>
            inkl. kurtasje {formatMoney(trade.buyFee)} kjøp /{" "}
            {formatMoney(trade.sellFee)} salg
          </small>
        </div>
        <div>
          <span>Gevinstmål</span>
          <strong>{formatPrice(trade.targetPrice)} kr</strong>
          <small>
            {formatPct(settings.trade.targetPct)} · netto{" "}
            {formatMoney(trade.targetNet, 0, true)}
          </small>
        </div>
        <div>
          <span>Tapsgrense</span>
          <strong>{formatPrice(trade.stopPrice)} kr</strong>
          <small>
            {formatPct(-settings.trade.stopLossPct)} · netto{" "}
            {formatMoney(trade.stopNet, 0, true)}
          </small>
        </div>
        <div>
          <span>Gevinst/tap</span>
          <strong>
            {trade.rewardRisk === null
              ? "–"
              : `${formatNumber(trade.rewardRisk, 1)}:1`}
          </strong>
          <small>etter kurtasje</small>
        </div>
      </div>

      <div className="report-cols">
        <div>
          <h3>Hvorfor denne aksjen</h3>
          <ul className="report-list">
            {candidate.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <h3>Tekniske nivåer</h3>
          <ul className="report-list">
            <li>Motstand: {resistanceText}</li>
            <li>Støtte: {supportText}</li>
            <li>Breakout-status: {candidate.breakoutStatus}</li>
            <li>
              Volumforhold:{" "}
              {candidate.volumeRatio === null
                ? "–"
                : `${formatNumber(candidate.volumeRatio, 1)}×`}
            </li>
            <li>ATR: {formatPct(atrPct(stock))}</li>
            <li>Neste resultat: {earningsText}</li>
          </ul>
        </div>
        <div>
          <h3>Nyheter og hendelsestype</h3>
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
            {candidate.warnings.length === 0 ? (
              <li>Ingen særskilte risikoadvarsler.</li>
            ) : (
              candidate.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))
            )}
          </ul>
          <p className="muted">
            Sjekk volum og nyheter etter åpning. Rapporten utfører ingen
            handler.
          </p>
        </div>
      </div>

      <h3>Gevinst- og tapsscenarioer</h3>
      <ScenarioTable trade={trade} />
      <p className="report-note">
        Kjøpssone og kjøpspris er estimert fra siste sluttkurs. Faktisk
        åpningskurs og kurtasje kan avvike. Scenariene er netto etter kurtasje
        og eventuell konfigurert slippage, men før skatt.
      </p>
      <h3>Følg med etter åpning</h3>
      <p className="report-note">
        {entryZone.valid
          ? `Bekreft at kursen åpner innenfor kjøpssonen ${formatPrice(entryZone.low)}–${formatPrice(entryZone.high)} kr. Utenfor sonen: stå over. `
          : "Det finnes ingen gyldig kjøpssone i dag – vurder å stå over. "}
        Inne i sonen: bekreft at kursen holder seg over VWAP/SMA5 (
        {formatPrice(stock.sma5)} kr), og at volumet er unormalt høyt. Ved
        negativ nyhet eller brudd på støtten: vurder å stå over eller bruk
        tapsgrensen.
      </p>
    </div>
  );
}

function ScenarioTable({ trade }: { trade: TradePlan }) {
  return (
    <div className="table-wrap stack-wrap">
      <table className="mini-table stack-table">
        <thead>
          <tr>
            <th>Endring</th>
            <th>Salgskurs</th>
            <th>Brutto</th>
            <th>Netto</th>
            <th>Netto avkastning</th>
          </tr>
        </thead>
        <tbody>
          {trade.scenarios.map((scenario) => (
            <tr key={scenario.changePct}>
              <td data-label="Endring">
                {formatPct(scenario.changePct)}
              </td>
              <td data-label="Salgskurs">
                {formatPrice(scenario.exitPrice)} kr
              </td>
              <td data-label="Brutto">
                {formatMoney(scenario.grossProfit, 0, true)}
              </td>
              <td
                data-label="Netto"
                className={
                  scenario.netProfit > 0
                    ? "positive"
                    : scenario.netProfit < 0
                      ? "negative"
                      : ""
                }
              >
                {formatMoney(scenario.netProfit, 0, true)}
              </td>
              <td data-label="Netto avkastning">
                {formatPct(scenario.netReturnPct / 100)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
