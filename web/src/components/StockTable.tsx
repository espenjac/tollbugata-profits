import { useMemo, useState } from "react";
import {
  formatDaysUntil,
  formatMarketCap,
  formatNumber,
  formatPct,
  formatPrice,
} from "../core/format";
import { nordnetUrl } from "../core/nordnet";
import {
  isAtHigh,
  sortStocks,
  type Criteria,
  type SortField,
} from "../core/screen";
import { averageTurnover, distanceToAth, type Stock } from "../core/types";

const COLUMNS: Array<{
  field?: SortField;
  label: string;
  numeric?: boolean;
  title?: string;
}> = [
  { field: "ticker", label: "Ticker" },
  { field: "name", label: "Selskap" },
  { field: "close", label: "Kurs", numeric: true },
  { field: "day", label: "Dag", numeric: true },
  { field: "week", label: "1 uke", numeric: true },
  { field: "month", label: "1 mnd", numeric: true },
  {
    field: "athDistance",
    label: "Mot ATH",
    numeric: true,
    title: "Hvor langt kursen er under all-time high",
  },
  { label: "Resultat", title: "Dager til neste resultatfremleggelse" },
  { field: "rsi", label: "RSI", numeric: true },
  {
    field: "turnover",
    label: "Snitt omsetning",
    numeric: true,
    title: "Gjennomsnittlig daglig omsetning siste 10 dager",
  },
  { field: "marketCap", label: "Markedsverdi", numeric: true },
  { label: "Nordnet" },
];

function changeClass(value: number | null): string {
  if (value === null || value === 0) {
    return "";
  }
  return value > 0 ? "positive" : "negative";
}

function StockCard({
  stock,
  criteria,
  today,
}: {
  stock: Stock;
  criteria: Criteria;
  today: string;
}) {
  const high = isAtHigh(stock, criteria);
  return (
    <article className={`stock-card${high ? " at-high" : ""}`} role="listitem">
      <div className="stock-card-head">
        <div className="stock-card-identity">
          <div className="stock-card-title">
            <a
              className="stock-card-ticker"
              href={nordnetUrl(stock)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {stock.ticker}
            </a>
            {high ? (
              <span className="badge" title="På/ved all-time high">
                ATH
              </span>
            ) : null}
            {stock.market === "euronext_growth" ? (
              <span className="badge growth">GROWTH</span>
            ) : null}
          </div>
          <span className="stock-card-name">{stock.name}</span>
          <span className="sector">{stock.sector}</span>
        </div>
        <a
          href={nordnetUrl(stock)}
          target="_blank"
          rel="noopener noreferrer"
          className="external-link"
          aria-label={`Åpne ${stock.ticker} hos Nordnet`}
        >
          ↗
        </a>
      </div>

      <div className="stock-card-price">
        <strong>{formatPrice(stock.close)} kr</strong>
        <span className={`stock-card-change ${changeClass(stock.dayReturn)}`}>
          {formatPct(stock.dayReturn)} i dag
        </span>
      </div>

      <dl className="stock-card-stats">
        <div>
          <dt>1 uke</dt>
          <dd className={changeClass(stock.weekReturn)}>
            {formatPct(stock.weekReturn)}
          </dd>
        </div>
        <div>
          <dt>1 mnd</dt>
          <dd className={changeClass(stock.monthReturn)}>
            {formatPct(stock.monthReturn)}
          </dd>
        </div>
        <div>
          <dt>Mot ATH</dt>
          <dd>{formatPct(distanceToAth(stock))}</dd>
        </div>
        <div>
          <dt>RSI</dt>
          <dd>{formatNumber(stock.rsi, 0)}</dd>
        </div>
        <div>
          <dt>Snitt oms.</dt>
          <dd>{formatMarketCap(averageTurnover(stock))}</dd>
        </div>
        <div>
          <dt>Markedsverdi</dt>
          <dd>{formatMarketCap(stock.marketCap)}</dd>
        </div>
        <div>
          <dt>Resultat</dt>
          <dd>
            {stock.earningsDate
              ? formatDaysUntil(stock.earningsDate, today)
              : "–"}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function StockTable({
  stocks,
  criteria,
  today,
}: {
  stocks: Stock[];
  criteria: Criteria;
  today: string;
}) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("week");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [cardLimit, setCardLimit] = useState(20);

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("nb-NO");
    const filtered = needle
      ? stocks.filter((stock) =>
          [stock.ticker, stock.name, stock.sector]
            .join(" ")
            .toLocaleLowerCase("nb-NO")
            .includes(needle),
        )
      : stocks;
    return sortStocks(filtered, sortField, sortDirection);
  }, [stocks, search, sortField, sortDirection]);

  const toggleSort = (field: SortField) => {
    setCardLimit(20);
    if (field === sortField) {
      setSortDirection((current) => (current === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const visibleCards = visible.slice(0, cardLimit);

  return (
    <section className="panel stock-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Screen</p>
          <h2>Treff ({visible.length})</h2>
        </div>
        <label className="search-field">
          <span className="sr-only">Søk</span>
          <input
            type="search"
            placeholder="Ticker, selskap eller sektor …"
            autoComplete="off"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setCardLimit(20);
            }}
          />
        </label>
      </div>
      <div className="stock-mobile-tools">
        <label className="field">
          <span>Sorter etter</span>
          <select
            value={sortField}
            onChange={(event) => {
              setSortField(event.target.value as SortField);
              setSortDirection("desc");
              setCardLimit(20);
            }}
          >
            {COLUMNS.filter((column) => column.field).map((column) => (
              <option key={column.field} value={column.field}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-small"
          type="button"
          onClick={() =>
            setSortDirection((current) =>
              current === "desc" ? "asc" : "desc",
            )
          }
        >
          {sortDirection === "desc" ? "Synkende ↓" : "Stigende ↑"}
        </button>
      </div>
      {visible.length === 0 ? (
        <p className="muted">Ingen aksjer passer filtrene akkurat nå.</p>
      ) : (
        <>
          <div className="table-wrap stock-table-wrap">
            <table className="stock-table">
              <thead>
                <tr>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.label}
                      className={column.numeric ? "num" : undefined}
                      title={column.title}
                    >
                      {column.field ? (
                        <button
                          type="button"
                          className={
                            sortField === column.field
                              ? "sort-active"
                              : undefined
                          }
                          onClick={() => toggleSort(column.field as SortField)}
                        >
                          {column.label}
                          {sortField === column.field
                            ? sortDirection === "desc"
                              ? " ↓"
                              : " ↑"
                            : ""}
                        </button>
                      ) : (
                        column.label
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((stock) => {
                  const high = isAtHigh(stock, criteria);
                  return (
                    <tr
                      key={stock.ticker}
                      className={high ? "at-high" : undefined}
                    >
                      <td>
                        <a
                          className="ticker"
                          href={nordnetUrl(stock)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {stock.ticker}
                        </a>
                        {high ? (
                          <span className="badge" title="På/ved all-time high">
                            ATH
                          </span>
                        ) : null}
                        {stock.market === "euronext_growth" ? (
                          <span className="badge growth">GROWTH</span>
                        ) : null}
                      </td>
                      <td>
                        <span className="company-name">{stock.name}</span>
                        <small className="sector">{stock.sector}</small>
                      </td>
                      <td className="num">{formatPrice(stock.close)}</td>
                      <td className={`num ${changeClass(stock.dayReturn)}`}>
                        {formatPct(stock.dayReturn)}
                      </td>
                      <td className={`num ${changeClass(stock.weekReturn)}`}>
                        {formatPct(stock.weekReturn)}
                      </td>
                      <td className={`num ${changeClass(stock.monthReturn)}`}>
                        {formatPct(stock.monthReturn)}
                      </td>
                      <td className="num">
                        {formatPct(distanceToAth(stock))}
                      </td>
                      <td className="num small">
                        {stock.earningsDate
                          ? formatDaysUntil(stock.earningsDate, today)
                          : "–"}
                      </td>
                      <td className="num">{formatNumber(stock.rsi, 0)}</td>
                      <td className="num">
                        {formatMarketCap(averageTurnover(stock))}
                      </td>
                      <td className="num">{formatMarketCap(stock.marketCap)}</td>
                      <td>
                        <a
                          href={nordnetUrl(stock)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="external-link"
                          aria-label={`Åpne ${stock.ticker} hos Nordnet`}
                        >
                          ↗
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="stock-cards" role="list" aria-label="Aksjer">
            {visibleCards.map((stock) => (
              <StockCard
                key={stock.ticker}
                stock={stock}
                criteria={criteria}
                today={today}
              />
            ))}
            {visible.length > visibleCards.length ? (
              <button
                className="btn btn-small stock-show-more"
                type="button"
                onClick={() => setCardLimit((current) => current + 20)}
              >
                Vis flere aksjer ({visible.length - visibleCards.length} igjen)
              </button>
            ) : null}
          </div>
        </>
      )}
      <p className="table-footnote">
        Viser <strong>{visible.length}</strong> aksjer.{" "}
        {criteria.excludeGrowth
          ? "Euronext Growth er skjult fordi aksjene normalt ikke kan holdes på ASK. "
          : ""}
        Klikk på ticker for å åpne aksjen hos Nordnet.
      </p>
    </section>
  );
}
