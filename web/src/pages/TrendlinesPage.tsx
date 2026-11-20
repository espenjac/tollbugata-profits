import { useState } from "react";
import { ErrorPanel, InlineNotice, LoadingView } from "../components/ui";
import { formatDate, formatDateTime } from "../core/format";
import {
  findTrendlineSetups,
  type TrendlinePhase,
  type TrendlineSetup,
} from "../core/trendline";
import { atrPct } from "../core/types";
import { nordnetUrl } from "../core/nordnet";
import { useTrendlines } from "../lib/useTrendlines";

const TRENDLINE_GROUPS: Array<{
  phase: TrendlinePhase;
  title: string;
  explanation: string;
}> = [
  {
    phase: "approaching",
    title: "Nærmer seg trendlinjen",
    explanation: "Uken peker ned, kursen er over støtten og innenfor ca. 2,5 ATR.",
  },
  {
    phase: "bounced",
    title: "Nylig sprett på trendlinjen",
    explanation: "En av de siste fem dagsbunnene testet støtten, og kursen har hentet seg opp.",
  },
  {
    phase: "on_line",
    title: "På trendlinjen",
    explanation: "Kursen ligger på eller like over støtten, innenfor ca. 0,25 ATR.",
  },
];

export function TrendlinesPage() {
  const { snapshot, loading, refreshing, error, refresh } = useTrendlines();
  if (loading && !snapshot) {
    return <LoadingView message="Henter historiske kurser og leter etter trendlinjer …" />;
  }
  if (error && !snapshot) {
    return (
      <ErrorPanel
        title="Kunne ikke laste trendlinjeskanneren"
        message={error}
        onRetry={() => void refresh()}
      />
    );
  }

  const stocks = snapshot?.universe.stocks ?? [];
  const setups = findTrendlineSetups(stocks);
  const setupsByPhase = new Map<TrendlinePhase, TrendlineSetup[]>(
    TRENDLINE_GROUPS.map(({ phase }) => [
      phase,
      setups.filter((setup) => setup.phase === phase),
    ]),
  );
  const historyCount = stocks.filter((stock) =>
    stock.recentLows?.some((low) => low !== null),
  ).length;

  return (
    <div className="page trendline-page">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Oslo Børs · positiv støtte · 1, 3 og 6 måneder</p>
          <h1>Trendlinjer</h1>
          <p>
            En ekstra long-only skanner for aksjer som nærmer seg en stigende
            støttelinje. Listen prioriterer aksjer med større normale
            dagsbevegelser, men høy volatilitet betyr også høyere risiko.
          </p>
          <div className="hero-meta">
            {snapshot ? (
              <span>
                Kurser hentet {formatDateTime(snapshot.universe.fetchedAt)} ({snapshot.universe.source})
              </span>
            ) : <span>Markedsdata er ikke tilgjengelig.</span>}
            <span>{historyCount} aksjer med historiske dagsbunner</span>
          </div>
        </div>
        <div className="hero-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? "Oppdaterer …" : "Oppdater skanner"}
          </button>
          <small>Ideer bygges fra siste tilgjengelige markedssnapshot.</small>
        </div>
      </section>

      {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {snapshot?.universe.warning ? (
        <InlineNotice kind="warning">{snapshot.universe.warning}</InlineNotice>
      ) : null}
      {historyCount === 0 ? (
        <InlineNotice kind="warning">
          {snapshot?.trendlineHistoryWarning ??
            "Historiske dagsbunner mangler fra datakilden. Prøv å oppdatere skanneren senere."}
        </InlineNotice>
      ) : snapshot?.trendlineHistoryWarning ? (
        <InlineNotice kind="warning">{snapshot.trendlineHistoryWarning}</InlineNotice>
      ) : null}

      <section className="panel trendline-panel" aria-label="Trendlinjekandidater">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Observasjonsliste · ikke kjøpssignaler</p>
            <h2>Trendlinjeoppsett ({setups.length})</h2>
            <p className="muted">
              Aksjer grupperes etter om de nærmer seg, tester eller har sprettet
              fra en stigende støttelinje. Krever minst to stigende svingbunner,
              Nå vises også svakere mønstre; disse merkes i listen. Aksjer må
              fortsatt ha dags-ATR på minst 1,5 % og snittomsetning på minst
              3 mill. kr. Kanal-målet er et estimat fra medianavstanden mellom
              støttelinjen og tidligere svingtopper; det vises bare når toppene
              stiger.
            </p>
          </div>
        </div>
        {setups.length === 0 ? (
          <div className="no-trade">
            <h3>{historyCount === 0 ? "Mangler historikk" : "Ingen oppsett akkurat nå"}</h3>
            <p>
              {historyCount === 0
                ? "Når historiske dagsbunner er tilgjengelige, vises kandidater som møter filtrene her."
              : "Ingen aksjer møter trendlinje-, nærhets-, volatilitet- og likviditetsfiltrene akkurat nå."}
            </p>
          </div>
        ) : null}
        {TRENDLINE_GROUPS.map((group) => (
          <TrendlineGroup
            key={group.phase}
            phase={group.phase}
            title={group.title}
            explanation={group.explanation}
            setups={setupsByPhase.get(group.phase) ?? []}
          />
        ))}
        <p className="muted trendline-footnote">
          * Score rangerer nærhet, antall berøringer, stigning og ATR; den er ikke
          en sannsynlighet. Trendlinjen estimeres fra dagsbunner og kan endres når
          nye data kommer. Sjekk graf, volum, nyheter og risiko før en eventuell
          beslutning. Ingen ordrer sendes.
        </p>
      </section>
    </div>
  );
}

function TrendlineGroup({
  phase,
  title,
  explanation,
  setups,
}: {
  phase: TrendlinePhase;
  title: string;
  explanation: string;
  setups: TrendlineSetup[];
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleSetups = expanded ? setups : setups.slice(0, 5);

  return (
    <section className={`trendline-group trendline-group-${phase}`} aria-label={title}>
      <div className="trendline-group-heading">
        <div>
          <h3>{title} ({setups.length})</h3>
          <p className="muted">{explanation}</p>
        </div>
      </div>
      {setups.length === 0 ? (
        <p className="muted trendline-empty">Ingen aksjer i denne gruppen nå.</p>
      ) : (
        <div className="table-wrap">
          <table className="trendline-table">
            <thead>
              <tr>
                <th>Aksje</th>
                <th>Periode</th>
                <th>Ankerpunkter</th>
                <th>Oppsett</th>
                <th className="num">Kurs</th>
                <th className="num">Trendlinje</th>
                <th className="num">Topper stiger</th>
                <th className="num">Målområde</th>
                <th className="num">Avstand</th>
                <th className="num">ATR/dag</th>
                <th className="num">1 mnd.</th>
                <th className="num">Treff</th>
                <th className="num">Score*</th>
              </tr>
            </thead>
            <tbody>
              {visibleSetups.map((setup) => (
                <tr key={`${setup.stock.ticker}-${setup.lookbackMonths}`}>
                  <td>
                    <a
                      className="trendline-ticker"
                      href={nordnetUrl(setup.stock)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {setup.stock.ticker}
                    </a>
                    <span className="trendline-name">{setup.stock.name}</span>
                  </td>
                  <td>{setup.lookbackMonths} mnd.</td>
                  <td>{formatAnchorRange(setup.anchorStartDate, setup.anchorEndDate)}</td>
                  <td>{setup.quality === "stronger" ? "Sterkere" : "Svakere"}</td>
                  <td className="num">{formatPrice(setup.stock.close)} kr</td>
                  <td className="num">{formatPrice(setup.supportPrice)} kr</td>
                  <td className="num">
                    {setup.higherHighs === null
                      ? "For få data"
                      : setup.higherHighs ? "Ja" : "Nei"}
                  </td>
                  <td className="num">
                    {setup.channelTarget === null
                      ? "–"
                      : `${formatPrice(setup.channelTarget)} kr`}
                  </td>
                  <td className="num">{formatPercent(setup.distancePct)}</td>
                  <td className="num">{formatPercent(atrPct(setup.stock))}</td>
                  <td className="num">{formatPercent(setup.stock.monthReturn)}</td>
                  <td className="num">{setup.touches}</td>
                  <td className="num">{setup.score.toFixed(0)}/100</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {setups.length > 5 ? (
        <button
          className="btn btn-ghost trendline-expand"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Vis færre" : `Vis alle ${setups.length} oppsett`}
        </button>
      ) : null}
    </section>
  );
}

function formatPercent(value: number | null): string {
  if (value === null) {
    return "–";
  }
  const text = (value * 100).toFixed(1).replace(".", ",");
  return `${value > 0 ? "+" : ""}${text} %`;
}

function formatPrice(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function formatAnchorRange(start: string | null, end: string | null): string {
  const from = start ? formatDate(start) : "–";
  const to = end ? formatDate(end) : start ? "Siste økt" : "–";
  return `${from} → ${to}`;
}
