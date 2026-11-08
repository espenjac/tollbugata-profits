import { useMemo, useState } from "react";
import { SimulatorChart } from "../components/SimulatorChart";
import {
  ErrorPanel,
  InlineNotice,
  LoadingView,
} from "../components/ui";
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPct,
  formatPrice,
} from "../core/format";
import type { SimMode, SimPosition } from "../core/simulator";
import {
  type SimulatorEquityPoint,
  type SimulatorPortfolio,
  type SimulatorTradeRecord,
} from "../lib/api";
import { useSimulator } from "../lib/useSimulator";

const MODES: SimMode[] = ["swing", "etrade"];
const MODE_LABELS: Record<SimMode, string> = {
  swing: "Swing",
  etrade: "Etrade",
};
const MODE_DESCRIPTIONS: Record<SimMode, string> = {
  swing: "2–5 handledager · stop, mål og trailing",
  etrade: "1–3 handledager · trigger og tre delmål",
};

function latestEquity(
  points: SimulatorEquityPoint[],
  mode: SimMode,
): SimulatorEquityPoint | null {
  let latest: SimulatorEquityPoint | null = null;
  for (const point of points) {
    if (point.mode !== mode) {
      continue;
    }
    if (latest === null || point.recordedAt > latest.recordedAt) {
      latest = point;
    }
  }
  return latest;
}

function portfolioFor(
  portfolios: SimulatorPortfolio[],
  mode: SimMode,
): SimulatorPortfolio | null {
  return portfolios.find((portfolio) => portfolio.mode === mode) ?? null;
}

function tradesFor(
  trades: SimulatorTradeRecord[],
  mode: SimMode,
): SimulatorTradeRecord[] {
  return trades.filter((trade) => trade.mode === mode);
}

function statsFor(trades: SimulatorTradeRecord[]) {
  const sells = trades.filter((trade) => trade.side === "sell");
  const wins = sells.filter(
    (trade) => trade.realizedPnl !== null && trade.realizedPnl > 0,
  );
  const fees = trades.reduce((sum, trade) => sum + trade.fee, 0);
  return {
    sells: sells.length,
    winRate: sells.length > 0 ? wins.length / sells.length : null,
    fees,
  };
}

function PositionSummary({
  mode,
  portfolio,
  equity,
}: {
  mode: SimMode;
  portfolio: SimulatorPortfolio | null;
  equity: SimulatorEquityPoint | null;
}) {
  const position: SimPosition | null = portfolio?.position ?? null;
  if (position) {
    const value = position.shares * position.lastPrice;
    const unrealized = value - position.shares * position.entryPrice;
    return (
      <div className="sim-position">
        <span className="sim-position-label">Åpen posisjon</span>
        <strong>
          {position.ticker} · {formatNumber(position.shares)} aksjer
        </strong>
        <small>
          Inngang {formatPrice(position.entryPrice)} · siste{" "}
          {formatPrice(position.lastPrice)} · stop {formatPrice(position.stopPrice)}
          {position.targets.length > 0
            ? ` · ${position.targets[position.stage]?.label ?? "mål"} ${formatPrice(
                position.targets[position.stage]?.price ?? null,
              )}`
            : position.targetPrice !== null
              ? ` · mål ${formatPrice(position.targetPrice)}`
              : ""}
        </small>
        <small className={unrealized >= 0 ? "tone-positive" : "tone-negative"}>
          Urealisert {formatMoney(unrealized, 2, true)}
        </small>
      </div>
    );
  }
  if (portfolio?.pending) {
    const pending = portfolio.pending;
    return (
      <div className="sim-position sim-position-pending">
        <span className="sim-position-label">Venter på trigger</span>
        <strong>
          {pending.ticker} over {formatPrice(pending.trigger)}
        </strong>
        <small>
          {formatNumber(pending.shares)} aksjer · stop{" "}
          {formatPrice(pending.stopPrice)}
          {pending.invalidation !== null
            ? ` · ugyldig under ${formatPrice(pending.invalidation)}`
            : ""}
        </small>
        <small>
          Siden {formatDateTime(new Date(pending.createdAt))}
          {equity ? ` · egenkapital ${formatMoney(equity.equity)}` : ""}
        </small>
      </div>
    );
  }
  return (
    <div className="sim-position sim-position-empty">
      <span className="sim-position-label">Ingen posisjon</span>
      <strong>{MODE_LABELS[mode]} venter på neste anbefaling</strong>
      <small>Maks én aksje om gangen. Ingen ekte ordrer sendes.</small>
    </div>
  );
}

function TradeTable({ trades }: { trades: SimulatorTradeRecord[] }) {
  if (trades.length === 0) {
    return (
      <div className="sim-empty">
        <strong>Ingen handler ennå.</strong>
        <p>
          Simulatoren registrerer kjøp og salg automatisk når markedet er åpent
          og rapporten gir et signal.
        </p>
      </div>
    );
  }
  return (
    <div className="table-wrap">
      <table className="sim-trade-table">
        <thead>
          <tr>
            <th>Tid</th>
            <th>Side</th>
            <th>Aksje</th>
            <th className="num">Antall</th>
            <th className="num">Kurs</th>
            <th className="num">Kurtasje</th>
            <th className="num">Resultat</th>
            <th>Grunn</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id}>
              <td>{formatDateTime(new Date(trade.executedAt))}</td>
              <td>
                <span
                  className={
                    trade.side === "buy" ? "side-buy" : "side-sell"
                  }
                >
                  {trade.side === "buy" ? "Kjøp" : "Salg"}
                </span>
              </td>
              <td className="ticker">{trade.ticker}</td>
              <td className="num">{formatNumber(trade.quantity)}</td>
              <td className="num">{formatPrice(trade.price)}</td>
              <td className="num">{formatMoney(trade.fee, 2)}</td>
              <td
                className={`num ${
                  trade.realizedPnl === null
                    ? ""
                    : trade.realizedPnl >= 0
                      ? "tone-positive"
                      : "tone-negative"
                }`}
              >
                {trade.realizedPnl === null
                  ? "–"
                  : formatMoney(trade.realizedPnl, 2, true)}
              </td>
              <td className="sim-trade-reason" title={trade.reason}>
                {trade.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SimulatorPage() {
  const { data, loading, refreshing, error, loadedAt, refresh } =
    useSimulator();
  const [tab, setTab] = useState<SimMode>("swing");

  const summary = useMemo(() => {
    if (!data) {
      return null;
    }
    return MODES.map((mode) => {
      const portfolio = portfolioFor(data.portfolios, mode);
      const equity = latestEquity(data.equity, mode);
      const startingCash = portfolio?.startingCash ?? 5_000;
      const value = equity?.equity ?? startingCash;
      const trades = tradesFor(data.trades, mode);
      return {
        mode,
        portfolio,
        equity,
        startingCash,
        value,
        returnPct: value / startingCash - 1,
        stats: statsFor(trades),
      };
    });
  }, [data]);

  if (loading && !data) {
    return <LoadingView message="Henter simuleringsresultater …" />;
  }

  if (error && !data) {
    return (
      <ErrorPanel
        title="Kunne ikke laste simulatoren"
        message={error}
        onRetry={() => void refresh()}
      />
    );
  }

  const startingCash = data?.portfolios[0]?.startingCash ?? 5_000;
  const selectedTrades = data
    ? tradesFor(data.trades, tab)
    : [];

  return (
    <div className="page simulator-page">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Papirhandel · ingen ekte ordrer · 5 000 kr per modus</p>
          <h1>Simulator</h1>
          <p>
            To separate papirporteføljer følger de samme reglene som appen.
            Den planlagte jobben sjekker markedet hvert tiende minutt, kjøper
            den beste anbefalingen og selger etter stop, mål eller tidsstopp.
            Resultatene er kun til sammenligning.
          </p>
          <div className="hero-meta">
            <span>
              {loadedAt
                ? `Oppdatert ${formatDateTime(loadedAt)}`
                : "Ikke oppdatert ennå"}
            </span>
            <span>Kurtasje 29 kr hver vei · maks én aksje per modus</span>
          </div>
        </div>
        <div className="hero-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? "Oppdaterer …" : "Oppdater simulatoren"}
          </button>
          <small>Kjøres automatisk av pg_cron mens børsen er åpen.</small>
        </div>
      </section>

      {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {data && data.portfolios.length === 0 ? (
        <InlineNotice kind="warning">
          Fant ingen simuleringsporteføljer. Kjør migreringen{" "}
          <code>0003_simulator.sql</code> i Supabase først.
        </InlineNotice>
      ) : null}

      {summary ? (
        <section className="sim-summary-grid" aria-label="Porteføljer">
          {summary.map((item) => (
            <article
              key={item.mode}
              className={`sim-summary-card sim-summary-${item.mode}`}
            >
              <header>
                <div>
                  <p className="eyebrow">{MODE_DESCRIPTIONS[item.mode]}</p>
                  <h2>{MODE_LABELS[item.mode]}</h2>
                </div>
                <strong
                  className={
                    item.returnPct >= 0 ? "tone-positive" : "tone-negative"
                  }
                >
                  {formatPct(item.returnPct)}
                </strong>
              </header>
              <div className="sim-summary-value">
                <strong>{formatMoney(item.value, 2)}</strong>
                <small>
                  Start {formatMoney(item.startingCash, 0)} · kontant{" "}
                  {formatMoney(item.portfolio?.cash ?? item.startingCash, 2)}
                </small>
              </div>
              <div className="sim-summary-stats">
                <span>
                  <strong>{item.stats.sells}</strong>
                  <small>salg</small>
                </span>
                <span>
                  <strong>
                    {item.stats.winRate === null
                      ? "–"
                      : formatPct(item.stats.winRate, 0, false)}
                  </strong>
                  <small>treffsikkerhet</small>
                </span>
                <span>
                  <strong>{formatMoney(item.stats.fees, 0)}</strong>
                  <small>kurtasje</small>
                </span>
              </div>
              <PositionSummary
                mode={item.mode}
                portfolio={item.portfolio}
                equity={item.equity}
              />
            </article>
          ))}
        </section>
      ) : null}

      <section className="panel sim-chart-panel">
        <div className="panel-heading">
          <div>
            <h2>Utvikling</h2>
            <p>
              Egenkapital per handledag. Begge modusene startet på{" "}
              {formatMoney(startingCash, 0)}. OSEBX er normalisert til samme
              startverdi.
            </p>
          </div>
          <div className="sim-chart-legend-inline">
            <span className="sim-legend-dot sim-legend-dot-swing" /> Swing
            <span className="sim-legend-dot sim-legend-dot-etrade" /> Etrade
            <span className="sim-legend-dot sim-legend-dot-benchmark" /> OSEBX
          </div>
        </div>
        <SimulatorChart
          points={data?.equity ?? []}
          startingCash={startingCash}
        />
      </section>

      <section className="panel sim-history-panel">
        <div className="panel-heading">
          <div>
            <h2>Kjøp og salg</h2>
            <p>Alle papirhandler registrert av den planlagte jobben.</p>
          </div>
        </div>
        <div className="sim-tabs" role="tablist" aria-label="Velg modus">
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={tab === mode}
              className={`sim-tab ${tab === mode ? "sim-tab-active" : ""}`}
              onClick={() => setTab(mode)}
            >
              {MODE_LABELS[mode]}
              <small>{tradesFor(data?.trades ?? [], mode).length}</small>
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={MODE_LABELS[tab]}>
          <TradeTable trades={selectedTrades} />
        </div>
      </section>

      <section className="panel sim-about">
        <h2>Slik fungerer sammenligningen</h2>
        <p>
          Swing følger hovedanbefalingen i den vanlige rapporten, mens Etrade
          venter på at «kjøp over»-triggeren brytes. Begge modusene har 5 000 kr,
          betaler 29 kr i kurtasje hver vei og kan bare eie én aksje om gangen.
          Etrade selger halvparten ved T1, halvparten av resten ved T2 og resten
          ved T3, og flytter stoppen til inngang etter T1.
        </p>
        <p>
          Dette er fremoverrettet papirhandel, ikke backtesting. Simulatoren
          bruker siste handlede kurs fra den samme markedshentingen som appen,
          og fyller ikke ordrer på historiske data. Hvis markedsdataene er
          gamle, hopper jobben over kjøringen i stedet for å gjette. OSEBX-linjen
          i grafen er indeksutviklingen normalisert til samme 5 000 kr, slik at
          porteføljene kan sammenlignes direkte med børsen.
        </p>
      </section>
    </div>
  );
}
