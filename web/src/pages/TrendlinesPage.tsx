import { ErrorPanel, InlineNotice, LoadingView } from "../components/ui";
import { formatDateTime } from "../core/format";
import { findTrendlineSetups } from "../core/trendline";
import { atrPct } from "../core/types";
import { nordnetUrl } from "../core/nordnet";
import { useTrendlines } from "../lib/useTrendlines";

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
  const historyCount = stocks.filter((stock) =>
    stock.recentLows?.some((low) => low !== null),
  ).length;

  return (
    <div className="page trendline-page">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Oslo Børs · positiv støtte · cirka én måned</p>
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
          Historiske dagsbunner mangler. Oppdater/deploy `market-snapshot`-funksjonen
          med trendlinjekolonnene før skanneren kan analysere oppsett.
        </InlineNotice>
      ) : null}

      <section className="panel trendline-panel" aria-label="Trendlinjekandidater">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Observasjonsliste · ikke kjøpssignaler</p>
            <h2>Nær stigende trendlinje ({setups.length})</h2>
            <p className="muted">
              Krever minst to stigende svingbunner, kurs nær støtten,
              dags-ATR på minst 1,5 % og snittomsetning på minst 3 mill. kr.
            </p>
          </div>
        </div>
        {setups.length > 0 ? (
          <div className="table-wrap">
            <table className="trendline-table">
              <thead>
                <tr>
                  <th>Aksje</th>
                  <th className="num">Kurs</th>
                  <th className="num">Trendlinje</th>
                  <th className="num">Avstand</th>
                  <th className="num">ATR/dag</th>
                  <th className="num">1 mnd.</th>
                  <th className="num">Treff</th>
                  <th className="num">Score*</th>
                </tr>
              </thead>
              <tbody>
                {setups.map((setup) => (
                  <tr key={setup.stock.ticker}>
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
                    <td className="num">{setup.stock.close.toFixed(2).replace(".", ",")} kr</td>
                    <td className="num">{setup.supportPrice.toFixed(2).replace(".", ",")} kr</td>
                    <td className="num">{(setup.distancePct * 100).toFixed(1).replace(".", ",")} %</td>
                    <td className="num">{formatPercent(atrPct(setup.stock))}</td>
                    <td className="num">{formatPercent(setup.stock.monthReturn)}</td>
                    <td className="num">{setup.touches}</td>
                    <td className="num">{setup.score.toFixed(0)}/100</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="no-trade">
            <h3>{historyCount === 0 ? "Mangler historikk" : "Ingen oppsett akkurat nå"}</h3>
            <p>
              {historyCount === 0
                ? "Når historiske dagsbunner er tilgjengelige, vises kandidater som møter filtrene her."
                : "Ingen aksjer møter trendlinje-, nærhets-, volatilitet- og likviditetsfiltrene akkurat nå."}
            </p>
          </div>
        )}
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

function formatPercent(value: number | null): string {
  return value === null ? "–" : `${(value * 100).toFixed(1).replace(".", ",")} %`;
}
