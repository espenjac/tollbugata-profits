import { useMemo } from "react";
import { formatDateTime } from "../core/format";
import {
  aggregateSentiment,
  forStock,
  isNewSinceOpen,
  newCount,
  uniqueNews,
  type NewsFeed,
} from "../core/news";
import type { NewsItem } from "../core/types";
import type { Stock } from "../core/types";
import { SentimentBadge } from "./ui";

const NEWS_TIME_FORMATTER = new Intl.DateTimeFormat("nb-NO", {
  timeZone: "Europe/Oslo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function newsTime(item: NewsItem): string {
  return NEWS_TIME_FORMATTER.format(item.publishedAt);
}

function sourceLabel(source: NewsFeed["source"]): string {
  const labels: Record<NewsFeed["source"], string> = {
    live: "live",
    cache: "cache",
    "stale-cache": "gammel cache",
    error: "feil",
  };
  return labels[source];
}

export function NewsSection({
  news,
  stocks,
}: {
  news: NewsFeed | null;
  stocks: Stock[];
}) {
  const companies = useMemo(() => {
    if (!news) {
      return [];
    }
    return stocks
      .map((stock) => {
        const items = forStock(news, stock);
        if (items.length === 0) {
          return null;
        }
        const latest = uniqueNews(items, 1)[0];
        return { stock, items, latest };
      })
      .filter(
        (
          row,
        ): row is { stock: Stock; items: NewsItem[]; latest: NewsItem } =>
          row !== null,
      )
      .sort(
        (a, b) => b.latest.publishedAt.getTime() - a.latest.publishedAt.getTime(),
      );
  }, [news, stocks]);

  if (!news) {
    return null;
  }

  const first = companies.slice(0, 8);
  const rest = companies.slice(8);

  return (
    <section className="panel news-panel" id="nyheter" aria-label="Nyheter">
      <div className="news-head">
        <div>
          <p className="eyebrow">NewsWeb</p>
          <h2>Nyheter siden forrige handelsdag</h2>
          <p>
            Børsmeldinger fra Oslo Børs NewsWeb for aksjene i listen, siden
            forrige handelsdag stengte ({formatDateTime(news.since)}). Klikk på
            en overskrift for å åpne meldingen.
          </p>
        </div>
        <span className="news-source">{sourceLabel(news.source)}</span>
      </div>
      {news.warning ? (
        <div className="notice notice-warning">{news.warning}</div>
      ) : null}
      {companies.length === 0 ? (
        <p className="muted">
          Ingen børsmeldinger for aksjene i listen siden forrige handelsdag
          stengte.
        </p>
      ) : (
        <>
          <ul className="news-list">
            {first.map((row) => (
              <NewsCompany key={row.stock.ticker} row={row} feed={news} />
            ))}
          </ul>
          {rest.length > 0 ? (
            <details className="news-more">
              <summary>
                Vis alle {companies.length} selskaper med meldinger
              </summary>
              <ul className="news-list">
                {rest.map((row) => (
                  <NewsCompany key={row.stock.ticker} row={row} feed={news} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      <p className="news-note">
        Positiv/negativ/nøytral er en enkel stikkordsanalyse, ikke en vurdering
        av nyheten. Sjekk alltid kilden.
      </p>
    </section>
  );
}

function NewsCompany({
  row,
  feed,
}: {
  row: { stock: Stock; items: NewsItem[]; latest: NewsItem };
  feed: NewsFeed;
}) {
  const headlines = uniqueNews(row.items);
  const older = headlines.slice(2);
  const fresh = newCount(feed, row.items);
  const sentiment = aggregateSentiment(row.items);
  const countLabel =
    row.items.length === 1 ? "1 melding" : `${row.items.length} meldinger`;

  return (
    <li className="news-company">
      <div className="news-company-head">
        <a
          className="news-ticker"
          href={headlines[0].url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {row.stock.ticker}
        </a>
        <span className="news-company-name">{row.stock.name}</span>
        <SentimentBadge sentiment={sentiment} />
        <span className="news-count">
          {countLabel}
          {fresh > 0 ? ` · ${fresh} nye siden åpning` : ""}
        </span>
      </div>
      <ul className="news-headlines">
        {headlines.slice(0, 2).map((item) => (
          <NewsHeadline key={item.messageId} item={item} feed={feed} />
        ))}
      </ul>
      {older.length > 0 ? (
        <details className="news-headline-more">
          <summary>
            Vis {older.length === 1 ? "1 eldre melding" : `${older.length} eldre meldinger`}
          </summary>
          <ul className="news-headlines">
            {older.map((item) => (
              <NewsHeadline key={item.messageId} item={item} feed={feed} />
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

function NewsHeadline({ item, feed }: { item: NewsItem; feed: NewsFeed }) {
  return (
    <li>
      <span className="news-headline-meta">
        <SentimentBadge sentiment={item.sentiment} />
        {isNewSinceOpen(feed, item) ? (
          <span className="news-new">NY</span>
        ) : null}
      </span>
      <a href={item.url} target="_blank" rel="noopener noreferrer">
        {item.title}
      </a>
      <span className="news-time">{newsTime(item)}</span>
    </li>
  );
}
