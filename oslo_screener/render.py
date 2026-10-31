"""Terminal- og HTML-visning av screenresultatet."""

from __future__ import annotations

import html
import json
import shutil
import statistics
from datetime import date, datetime
from typing import Optional

from .data import Universe
from .formatting import (
    DASH,
    days_until,
    format_date,
    format_datetime,
    format_days_until,
    format_market_cap,
    format_money,
    format_pct,
    format_price,
)
from .logic import (
    EXCLUSION_LABELS,
    Criteria,
    ScreenResult,
    describe_criteria,
    is_at_high,
    sort_stocks,
)
from .models import Stock
from .news import NewsFeed, NewsItem, aggregate_sentiment, unique_news
from .nordnet import nordnet_url
from .premarket import (
    PlannedCandidate,
    PremarketReport,
    build_premarket_report,
)
from .signals import EVENT_LABELS, RELEVANCE_LABELS
from .strategy import Candidate, rank_candidates

# ---------------------------------------------------------------------------
# Terminal
# ---------------------------------------------------------------------------

_RESET = "\033[0m"
_BOLD = "\033[1m"
_DIM = "\033[2m"
_GREEN = "\033[32m"
_RED = "\033[31m"
_YELLOW = "\033[33m"
_CYAN = "\033[36m"


def _paint(text: str, code: str, enabled: bool) -> str:
    return f"{code}{text}{_RESET}" if enabled else text


def _fit(text: str, width: int, align: str = "left") -> str:
    if len(text) > width:
        text = text[: max(0, width - 1)] + "…"
    return text.rjust(width) if align == "right" else text.ljust(width)


_SENTIMENT_LABELS = {
    "positive": "Positiv",
    "negative": "Negativ",
    "neutral": "Nøytral",
    "mixed": "Blandet",
}
_SENTIMENT_SYMBOLS = {
    "positive": "▲",
    "negative": "▼",
    "neutral": "•",
    "mixed": "◆",
}


def _sentiment_label(value: str) -> str:
    return _SENTIMENT_LABELS.get(value, _SENTIMENT_LABELS["neutral"])


def _sentiment_symbol(value: str) -> str:
    return _SENTIMENT_SYMBOLS.get(value, _SENTIMENT_SYMBOLS["neutral"])


def _sentiment_html(value: str, extra_class: str = "") -> str:
    label = _sentiment_label(value)
    classes = f"sentiment sentiment-{value}"
    if extra_class:
        classes += f" {extra_class}"
    return f'<span class="{classes}">{_e(label)}</span>'


def _new_label(count: int) -> str:
    return "1 ny" if count == 1 else f"{count} nye"


def _terminal_width() -> int:
    return shutil.get_terminal_size((110, 24)).columns


def _next_event_text(stock: Stock) -> tuple[str, bool]:
    """Kompakt «R 14d · E 3d» og om noe skjer innen en uke."""
    parts: list[str] = []
    soon = False
    earnings = days_until(stock.earnings_date)
    if earnings is not None and earnings >= 0:
        parts.append(f"R {earnings}d")
        soon = soon or earnings <= 7
    ex_date = days_until(stock.ex_dividend_date)
    if ex_date is not None and ex_date >= 0:
        parts.append(f"E {ex_date}d")
        soon = soon or ex_date <= 7
    return " · ".join(parts), soon


def _terminal_premarket(report: PremarketReport, color: bool) -> list[str]:
    lines: list[str] = []
    lines.append(
        _paint(
            f"Dagens pre-market-rapport · {format_datetime(report.generated_at)}",
            _BOLD,
            color,
        )
    )
    lines.append(_paint(report.data_basis, _DIM, color))
    if report.main is None:
        lines.append(
            _paint(
                "Ingen anbefalte kandidater i dag – vurder å stå over.",
                _YELLOW,
                color,
            )
        )
        if report.no_trade_reason:
            lines.append(_paint(f"  {report.no_trade_reason}", _DIM, color))
    else:
        main = report.main
        candidate = main.candidate
        trade = main.trade
        lines.append(
            _paint(
                f"HOVEDKANDIDAT: {candidate.stock.ticker} · {candidate.stock.name}",
                _GREEN,
                color,
            )
        )
        lines.append(
            f"  Total {candidate.score:.0f}/100 · mulighet {candidate.opportunity_score:.0f}"
            f" · risiko {candidate.risk_score:.0f} ({candidate.risk_level})"
            f" · {', '.join(main.category_labels) or 'ingen kategori'}"
        )
        lines.append(
            f"  Kjøpsestimat {format_price(trade.entry_price)} kr · {trade.shares} aksjer"
            f" · kapital {format_money(trade.total_cost)}"
            f" · mål {format_price(trade.target_price)} kr"
            f" · stopp {format_price(trade.stop_price)} kr"
        )
        lines.append(
            f"  Netto ved +{report.settings.trade.target_pct * 100:.0f} %:"
            f" {format_money(trade.target_net, signed=True)} ({format_pct(trade.target_return_pct / 100)})"
            f" · ved −{report.settings.trade.stop_loss_pct * 100:.0f} %:"
            f" {format_money(trade.stop_net, signed=True)} ({format_pct(trade.stop_return_pct / 100)})"
        )
        up = " · ".join(
            f"{format_pct(item.change_pct, signed=True)}: "
            f"{format_money(item.net_profit, signed=True)}"
            for item in trade.scenarios
            if item.change_pct > 0
        )
        down = " · ".join(
            f"{format_pct(item.change_pct, signed=True)}: "
            f"{format_money(item.net_profit, signed=True)}"
            for item in trade.scenarios
            if item.change_pct < 0
        )
        if up:
            lines.append(f"  Netto scenarier opp: {up}")
        if down:
            lines.append(f"  Netto scenarier ned: {down}")
        lines.append(
            f"  Nyheter: {main.news_reason}"
        )
        if candidate.warnings:
            lines.append(_paint(f"  Risiko: {' · '.join(candidate.warnings)}", _YELLOW, color))
        lines.append(
            _paint(
                "  Følg med: bekreft kurs over siste sluttkurs, volum og spread etter åpning. "
                "Ingen automatisk handel.",
                _DIM,
                color,
            )
        )
    if report.alternatives:
        lines.append("")
        lines.append(
            _paint(
                "Alternativer (5–10, ikke nødvendigvis anbefalt):",
                _BOLD,
                color,
            )
        )
        for index, item in enumerate(report.alternatives, 1):
            candidate = item.candidate
            categories = ", ".join(item.category_labels) or "ingen kategori"
            lines.append(
                f"  {index}. {_fit(candidate.stock.ticker, 9)} "
                f"{candidate.score:3.0f} total · risiko {candidate.risk_score:3.0f} · "
                f"{_fit(candidate.stock.name, 22)} · {categories}"
            )
            if item.block_reasons:
                lines.append(
                    _paint(
                        f"     Ikke anbefalt: {'; '.join(item.block_reasons)}",
                        _YELLOW,
                        color,
                    )
                )
            else:
                lines.append(
                    _paint("     Kan vurderes som alternativ.", _DIM, color)
                )
    if report.warnings:
        for warning in report.warnings:
            lines.append(_paint(f"Advarsel: {warning}", _YELLOW, color))
    lines.append("")
    return lines


def render_terminal(
    result: ScreenResult,
    universe: Universe,
    criteria: Criteria,
    sort_by: str = "week",
    limit: int = 40,
    color: Optional[bool] = None,
    news: Optional[NewsFeed] = None,
    report: Optional[PremarketReport] = None,
) -> str:
    if color is None:
        import sys

        color = sys.stdout.isatty()

    stocks = sort_stocks(result.matches, sort_by)
    total = len(stocks)
    shown = stocks if limit <= 0 else stocks[:limit]
    if report is None:
        report = build_premarket_report(stocks, criteria, universe, news=news)

    width = _terminal_width()
    show_next = width >= 108
    # «Neste» prioriteres foran sektor når plassen er knapp, slik at dager til
    # resultat/ex-dato også vises i en vanlig terminal.
    show_sector = width >= 96 and (not show_next or width >= 132)
    fixed = 9 + 6 + 10 + 10 + 10 + 10 + 5 + 2 * 7  # ticker, flagg, kurs, uke, mnd, ath, rsi + mellomrom
    if show_sector:
        fixed += 2
    if show_next:
        fixed += 14 + 2
    remaining = max(18, width - fixed)
    if show_sector:
        sector_w = max(12, min(24, remaining // 3))
        name_w = max(18, remaining - sector_w)
    else:
        sector_w = 0
        name_w = max(18, remaining)

    lines: list[str] = []
    title = "Tollbugata Profits"
    subtitle = "Oslo Børs · pre-market daytrading"
    lines.append(_paint(title, _BOLD, color) + _paint(f"  {subtitle}", _DIM, color))
    source_label = {"live": "live", "cache": "cache", "stale-cache": "gammel cache"}.get(
        universe.source, universe.source
    )
    lines.append(
        _paint(
            f"Data hentet {format_datetime(universe.fetched_at)} ({source_label}) · "
            f"{result.universe_size} aksjer · {result.match_count} treff"
            + (
                f" · {result.at_high_count} på/ved ATH"
                if result.at_high_count
                else ""
            ),
            _DIM,
            color,
        )
    )
    lines.append(_paint(f"Kriterier: {describe_criteria(criteria)}", _DIM, color))
    if universe.warning:
        lines.append(_paint(f"Advarsel: {universe.warning}", _YELLOW, color))
    lines.extend(_terminal_premarket(report, color))
    if news is not None:
        news_rows: list[tuple[datetime, Stock, tuple[NewsItem, ...]]] = []
        for stock in stocks:
            items = news.for_stock(stock)
            if items:
                latest = unique_news(items, limit=1)[0]
                news_rows.append((latest.published_at, stock, items))
        news_rows.sort(key=lambda row: row[0], reverse=True)
        since_text = news.since.strftime("%d.%m kl. %H:%M")
        lines.append(
            _paint(
                f"Børsmeldinger siden forrige handelsdag stengte "
                f"{since_text} (Oslo Børs NewsWeb):",
                _BOLD,
                color,
            )
        )
        lines.append(
            _paint(
                "  ▲ positiv · ▼ negativ · ◆ blandet · • nøytral · NY = etter siste åpning",
                _DIM,
                color,
            )
        )
        if news.warning:
            lines.append(_paint(f"Advarsel: {news.warning}", _YELLOW, color))
        if not news_rows:
            lines.append(
                _paint("  Ingen meldinger for aksjene i listen.", _DIM, color)
            )
        else:
            for _, stock, items in news_rows[:10]:
                latest = unique_news(items, limit=1)[0]
                sentiment = aggregate_sentiment(items)
                symbol = _sentiment_symbol(sentiment)
                prefix = f"  {_fit(stock.ticker, 9)} {len(items):>2}{symbol} "
                detail = latest.title
                new_count = news.new_count(items)
                if new_count:
                    detail += f"  (NY: {new_count})"
                lines.append(
                    prefix + _fit(detail, max(20, width - len(prefix)))
                )
            if len(news_rows) > 10:
                lines.append(
                    _paint(
                        f"  … og {len(news_rows) - 10} flere selskaper med meldinger.",
                        _DIM,
                        color,
                    )
                )
    lines.append("")

    headers = [
        ("TICKER", 9, "left"),
        ("FLAGG", 6, "left"),
        ("SELSKAP", name_w, "left"),
        ("KURS", 10, "right"),
        ("1 UKE", 10, "right"),
        ("1 MND", 10, "right"),
        ("MOT ATH", 10, "right"),
        ("RSI", 5, "right"),
    ]
    if show_next:
        headers.append(("NESTE", 14, "left"))
    if show_sector:
        headers.append(("SEKTOR", sector_w, "left"))

    header_line = "  ".join(_fit(text, w, align) for text, w, align in headers)
    lines.append(_paint(header_line, _BOLD, color))
    lines.append("─" * min(width, len(header_line)))

    for stock in shown:
        at_high = is_at_high(stock, criteria)
        week = format_pct(stock.week_return)
        month = format_pct(stock.month_return)
        distance = stock.distance_to_ath
        if distance is None:
            ath_text = f"{DASH} *"
        else:
            ath_text = format_pct(distance)
        rsi = DASH if stock.rsi is None else f"{stock.rsi:.0f}"
        next_text, next_soon = _next_event_text(stock)

        flag_cell = _fit("ATH" if at_high else "", 6)
        week_cell = _fit(week, 10, "right")
        month_cell = _fit(month, 10, "right")
        ath_cell = _fit(ath_text, 10, "right")
        rsi_cell = _fit(rsi, 5, "right")

        week_colored = _paint(week_cell, _GREEN if (stock.week_return or 0) > 0 else _RED, color)
        if stock.month_return is None:
            month_colored = month_cell
        else:
            month_colored = _paint(month_cell, _GREEN if stock.month_return > 0 else _RED, color)
        ath_colored = _paint(
            ath_cell,
            _YELLOW if at_high else (_DIM if distance is None else _YELLOW),
            color,
        )
        next_colored = _paint(
            _fit(next_text, 14),
            _YELLOW if next_soon else _CYAN,
            color,
        )
        news_items = news.for_stock(stock) if news is not None else ()
        if news_items:
            ticker_text = (
                f"{stock.ticker}📰"
                f"{_sentiment_symbol(aggregate_sentiment(news_items))}"
            )
        else:
            ticker_text = stock.ticker

        cells = [
            _fit(ticker_text, 9),
            _paint(flag_cell, _YELLOW, color) if at_high else flag_cell,
            _fit(stock.name, name_w),
            _fit(format_price(stock.close), 10, "right"),
            week_colored,
            month_colored,
            ath_colored,
            rsi_cell,
        ]
        if show_next:
            cells.append(next_colored)
        if show_sector:
            cells.append(_fit(stock.sector, sector_w))
        lines.append("  ".join(cells))

    if not shown:
        lines.append(_paint("Ingen aksjer passer kriteriene akkurat nå.", _YELLOW, color))

    lines.append("")
    if limit > 0 and total > limit:
        lines.append(_paint(f"Viser {len(shown)} av {total} treff. Bruk --top 0 for alle.", _DIM, color))
    lines.append(
        _paint(
            "Kilde: TradingView-scanneren (uoffisiell). ATH = på/ved all-time high. "
            "R = dager til resultat, E = dager til ex-dato. "
            "📰 = børsmelding siden forrige handelsdag; "
            "▲/▼/◆/• = positiv/negativ/blandet/nøytral. "
            "Hovedkandidat og alternativer er en relativ rangering, ikke kjøpssignal. "
            "Euronext Growth er skjult som standard (normalt ikke ASK-egnet). "
            "* ATH usikker (mulig splitt). Ikke investeringsråd.",
            _DIM,
            color,
        )
    )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------

_CSS = """
:root {
  color-scheme: dark;
  --bg: #080d19;
  --bg-2: #0d1527;
  --panel: #111b31;
  --panel-2: #16233d;
  --border: #223354;
  --border-soft: #1a2946;
  --text: #e8eeff;
  --muted: #8fa0c4;
  --muted-2: #6c7ea6;
  --accent: #5eead4;
  --accent-2: #38bdf8;
  --green: #34d399;
  --red: #fb7185;
  --amber: #fbbf24;
  --shadow: 0 24px 60px rgba(0, 0, 0, .35);
  --radius: 16px;
  --mono: "SFMono-Regular", "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  --sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(1100px 700px at 20% -10%, rgba(56, 189, 248, .16), transparent 60%),
    radial-gradient(900px 600px at 90% 0%, rgba(94, 234, 212, .10), transparent 55%),
    var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.5;
}
a { color: var(--accent); }
.shell { width: min(1240px, calc(100% - 40px)); margin: 0 auto; padding: 38px 0 56px; }
.hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; margin-bottom: 30px; }
.eyebrow {
  margin: 0 0 8px;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .16em;
  text-transform: uppercase;
}
h1 {
  margin: 0;
  font-size: clamp(34px, 5vw, 58px);
  line-height: .98;
  letter-spacing: -.04em;
  background: linear-gradient(105deg, #fff 10%, #9fe9ff 55%, #5eead4 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.lede { max-width: 640px; margin: 14px 0 0; color: var(--muted); font-size: 16px; }
.stamp {
  flex: 0 0 auto;
  padding: 14px 18px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: rgba(17, 27, 49, .72);
  box-shadow: var(--shadow);
  text-align: right;
  font-size: 12px;
  color: var(--muted);
}
.stamp strong { display: block; margin: 3px 0 5px; color: var(--text); font-size: 14px; font-variant-numeric: tabular-nums; }
.stamp .source { color: var(--muted-2); }
.warning {
  margin: 0 0 20px;
  padding: 13px 16px;
  border: 1px solid rgba(251, 191, 36, .35);
  border-radius: 12px;
  background: rgba(251, 191, 36, .08);
  color: #ffe4a3;
  font-size: 13px;
}
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 18px; }
.stat {
  position: relative;
  overflow: hidden;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: linear-gradient(160deg, rgba(22, 35, 61, .96), rgba(13, 21, 39, .96));
  box-shadow: var(--shadow);
}
.stat::after {
  content: "";
  position: absolute;
  inset: auto -30px -60px auto;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(94, 234, 212, .10), transparent 70%);
}
.stat span { display: block; color: var(--muted); font-size: 12px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
.stat strong { display: block; margin: 6px 0 2px; font-size: 30px; line-height: 1.1; letter-spacing: -.03em; font-variant-numeric: tabular-nums; }
.stat small { color: var(--muted-2); font-size: 12px; }
.pos { color: var(--green); }
.neg { color: var(--red); }
.flat { color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 20px; }
.chip {
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(17, 27, 49, .7);
  color: var(--muted);
  font-size: 12px;
}
.chip strong { color: var(--text); font-weight: 600; }
.chip.ath-chip { border-color: rgba(251, 191, 36, .55); background: rgba(251, 191, 36, .10); color: #ffd77a; font-weight: 700; }
.picks {
  margin: 0 0 18px;
  padding: 20px 22px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: linear-gradient(155deg, rgba(22, 35, 61, .96), rgba(13, 21, 39, .96));
  box-shadow: var(--shadow);
}
.picks-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.picks-head h2 { margin: 0; font-size: 18px; letter-spacing: -.01em; }
.picks-head p { max-width: 780px; margin: 4px 0 0; color: var(--muted); font-size: 12.5px; }
.picks-note {
  flex: 0 0 auto;
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted-2);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.pick-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.pick {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
  padding: 12px 14px;
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  background: rgba(17, 27, 49, .55);
}
.pick:hover { border-color: var(--border); background: rgba(22, 35, 61, .72); }
.pick-rank {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(94, 234, 212, .12);
  color: var(--accent);
  font-size: 13px;
  font-weight: 800;
}
.pick-title { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.pick-ticker {
  color: #bfe9ff;
  font-family: var(--mono);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: .02em;
  text-decoration: none;
}
.pick-ticker:hover { color: var(--accent); text-decoration: underline; }
.pick-name { color: var(--text); font-size: 14px; font-weight: 600; }
.pick-reasons {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.pick-warnings { margin: 3px 0 0; color: #ffd77a; font-size: 11.5px; }
.pick-news { margin: 4px 0 0; color: #bfe9ff; font-size: 12px; overflow-wrap: anywhere; }
.pick-news a { color: #bfe9ff; text-decoration: none; }
.pick-news a:hover { color: var(--accent); text-decoration: underline; }
.news-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 6px;
  padding: 1px 5px;
  border: 1px solid rgba(251, 191, 36, .45);
  border-radius: 999px;
  background: rgba(251, 191, 36, .10);
  color: #ffd77a;
  font-family: var(--sans);
  font-size: 10px;
  font-weight: 700;
  line-height: 1.4;
  text-decoration: none;
  vertical-align: middle;
}
.news-badge:hover { border-color: var(--amber); color: #fff3c4; }
.news-badge-positive { border-color: rgba(94, 234, 212, .45); background: rgba(94, 234, 212, .10); color: #9ff5e7; }
.news-badge-negative { border-color: rgba(248, 113, 113, .45); background: rgba(248, 113, 113, .10); color: #fca5a5; }
.news-badge-neutral { border-color: rgba(148, 163, 184, .35); background: rgba(148, 163, 184, .08); color: #cbd5e1; }
.news-badge-mixed { border-color: rgba(251, 191, 36, .45); background: rgba(251, 191, 36, .10); color: #ffd77a; }
.sentiment {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-family: var(--sans);
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
}
.sentiment-positive { border-color: rgba(94, 234, 212, .40); background: rgba(94, 234, 212, .10); color: #9ff5e7; }
.sentiment-negative { border-color: rgba(248, 113, 113, .40); background: rgba(248, 113, 113, .10); color: #fca5a5; }
.sentiment-neutral { border-color: rgba(148, 163, 184, .30); background: rgba(148, 163, 184, .08); color: #cbd5e1; }
.sentiment-mixed { border-color: rgba(251, 191, 36, .40); background: rgba(251, 191, 36, .10); color: #ffd77a; }
.sentiment-small { padding: 0 4px; font-size: 8.5px; }
.news-new {
  padding: 0 4px;
  border: 1px solid rgba(191, 233, 255, .40);
  border-radius: 999px;
  background: rgba(191, 233, 255, .10);
  color: #bfe9ff;
  font-size: 8.5px;
  font-weight: 700;
  line-height: 1.6;
  letter-spacing: .04em;
}
.news {
  margin: 0 0 18px;
  padding: 20px 22px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: linear-gradient(155deg, rgba(17, 27, 49, .96), rgba(13, 21, 39, .96));
  box-shadow: var(--shadow);
}
.news-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.news-head h2 { margin: 0; font-size: 18px; letter-spacing: -.01em; }
.news-head p { max-width: 780px; margin: 4px 0 0; color: var(--muted); font-size: 12.5px; }
.news-source {
  flex: 0 0 auto;
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--muted-2);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.news-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
.news-company {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  background: rgba(17, 27, 49, .55);
}
.news-company:hover { border-color: var(--border); background: rgba(22, 35, 61, .72); }
.news-company-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.news-ticker {
  color: #bfe9ff;
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .02em;
  text-decoration: none;
}
.news-ticker:hover { color: var(--accent); text-decoration: underline; }
.news-company-name {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.news-count {
  margin-left: auto;
  color: #ffd77a;
  font-size: 10.5px;
  font-weight: 700;
  white-space: nowrap;
}
.news-headlines { display: grid; gap: 4px; margin: 6px 0 0; padding: 0; list-style: none; }
.news-headlines li { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.news-headline-meta { display: inline-flex; flex: 0 0 auto; gap: 4px; }
.news-headlines a { min-width: 0; flex: 1; color: var(--text); font-size: 12.5px; line-height: 1.35; overflow-wrap: anywhere; text-decoration: none; }
.news-headlines a:hover { color: var(--accent); text-decoration: underline; }
.news-time { flex: 0 0 auto; color: var(--muted-2); font-size: 11px; font-variant-numeric: tabular-nums; }
.news-note { margin: 12px 0 0; color: var(--muted-2); font-size: 11px; }
.news-headline-more { margin-top: 5px; }
.news-headline-more summary { cursor: pointer; color: var(--accent); font-size: 11.5px; font-weight: 600; }
.news-headline-more .news-headlines { margin-top: 4px; }
.news-more { margin-top: 10px; }
.news-more summary { cursor: pointer; color: var(--accent); font-size: 12px; font-weight: 600; }
.news-more .news-list { margin-top: 8px; }
.pick-score {
  min-width: 54px;
  color: var(--accent);
  font-size: 24px;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  letter-spacing: -.04em;
  text-align: right;
}
.pick-score small {
  display: block;
  color: var(--muted-2);
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.report {
  margin: 0 0 18px;
  padding: 20px 22px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: linear-gradient(155deg, rgba(22, 35, 61, .96), rgba(13, 21, 39, .96));
  box-shadow: var(--shadow);
}
.report-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 16px;
}
.report-head h2 { margin: 2px 0 4px; font-size: 22px; letter-spacing: -.02em; }
.report-head p { max-width: 780px; margin: 0; color: var(--muted); font-size: 12.5px; }
.report-stamp {
  flex: 0 0 auto;
  padding: 10px 13px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(17, 27, 49, .72);
  text-align: right;
  color: var(--muted);
  font-size: 10.5px;
}
.report-stamp span { display: block; text-transform: uppercase; letter-spacing: .06em; }
.report-stamp strong { display: block; margin: 2px 0; color: var(--text); font-size: 12px; }
.report-stamp small { color: var(--muted-2); }
.main-pick {
  padding: 18px;
  border: 1px solid rgba(94, 234, 212, .28);
  border-radius: 14px;
  background: radial-gradient(700px 260px at 10% 0%, rgba(94, 234, 212, .08), transparent 65%),
              rgba(17, 27, 49, .62);
}
.main-pick-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.main-reasons { margin: 8px 0 3px; color: #d7e6ff; font-size: 13px; font-variant-numeric: tabular-nums; }
.score-row { display: grid; grid-template-columns: repeat(3, minmax(74px, 1fr)); gap: 8px; }
.score-box {
  min-width: 76px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(8, 13, 25, .55);
  text-align: right;
}
.score-box span { display: block; color: var(--muted); font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.score-box strong { display: block; color: var(--accent); font-size: 25px; line-height: 1.05; letter-spacing: -.04em; font-variant-numeric: tabular-nums; }
.score-box small { display: block; color: var(--muted-2); font-size: 9px; }
.report-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 16px 0; }
.report-grid > div { padding: 10px 12px; border: 1px solid var(--border-soft); border-radius: 10px; background: rgba(8, 13, 25, .3); }
.report-grid span { display: block; color: var(--muted); font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
.report-grid strong { display: block; margin: 3px 0 1px; color: var(--text); font-size: 17px; font-variant-numeric: tabular-nums; }
.report-grid small { color: var(--muted-2); font-size: 10.5px; }
.report-cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 20px; margin: 8px 0 16px; }
.report h3 { margin: 16px 0 7px; color: var(--text); font-size: 14px; letter-spacing: -.01em; }
.report-cols h3:first-child { margin-top: 0; }
.report-list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; color: var(--muted); font-size: 12.5px; }
.report-list li::before { content: "· "; color: var(--accent); }
.report-list.warnings li::before { content: "⚠ "; color: var(--amber); }
.report-news { margin: 0 0 4px; color: var(--text); font-size: 12.5px; }
.report-news-title { margin: 0; color: #bfe9ff; font-size: 12.5px; overflow-wrap: anywhere; }
.report-news-title a { color: #bfe9ff; text-decoration: none; }
.report-news-title a:hover { color: var(--accent); text-decoration: underline; }
.report-note { margin: 8px 0 0; color: var(--muted-2); font-size: 11px; }
.no-trade { padding: 22px; border: 1px solid rgba(251, 191, 36, .40); border-radius: 12px; background: rgba(251, 191, 36, .08); }
.no-trade h3 { margin: 0 0 6px; color: #ffe4a3; font-size: 18px; }
.no-trade p { margin: 0; color: #ffe4a3; font-size: 13px; }
.cat-badge { display: inline-block; margin-left: 4px; padding: 1px 6px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-family: var(--sans); font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.cat-momentum { border-color: rgba(94, 234, 212, .40); color: #9ff5e7; }
.cat-breakout { border-color: rgba(56, 189, 248, .45); color: #7dd3fc; }
.cat-nyhetsdrevet { border-color: rgba(251, 191, 36, .45); color: #ffd77a; }
.pick-trade { margin: 3px 0 0; color: #bfe9ff; font-size: 11.5px; font-variant-numeric: tabular-nums; }
.score-sub { display: block; margin-top: 2px; color: var(--muted-2); font-family: var(--sans); font-size: 8.5px; font-weight: 600; letter-spacing: 0; white-space: nowrap; }
.mini-table { font-size: 12.5px; }
.mini-table th { padding: 9px 11px; }
.mini-table td { padding: 8px 11px; }
.risk-low { color: var(--green); }
.risk-medium { color: var(--amber); }
.risk-high { color: var(--red); }
.panel {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: rgba(13, 21, 39, .86);
  box-shadow: var(--shadow);
  overflow: hidden;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border-soft);
  background: rgba(17, 27, 49, .65);
}
.field { display: flex; flex-direction: column; gap: 5px; min-width: 118px; }
.field span { color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
.field input[type="number"], .field input[type="search"] {
  width: 100%;
  height: 38px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--bg-2);
  color: var(--text);
  font: inherit;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.field input:focus, .check input:focus { outline: 2px solid rgba(94, 234, 212, .5); outline-offset: 1px; }
.field.search { flex: 1 1 220px; }
.check { display: flex; align-items: center; gap: 8px; height: 38px; color: var(--muted); font-size: 13px; user-select: none; }
.check input { width: 16px; height: 16px; accent-color: var(--accent); }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 38px;
  padding: 0 16px;
  border: 1px solid transparent;
  border-radius: 9px;
  background: linear-gradient(135deg, #5eead4, #38bdf8);
  color: #04121c;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  white-space: nowrap;
}
.btn:hover { filter: brightness(1.06); }
.btn.ghost { border-color: var(--border); background: transparent; color: var(--muted); }
.btn.ghost:hover { color: var(--text); border-color: var(--muted-2); }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  background: #101a2e;
  color: var(--muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .07em;
  text-align: left;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
}
thead th:hover { color: var(--text); }
thead th.num { text-align: right; }
thead th.sorted { color: var(--accent); }
thead th.sorted[data-dir="desc"]::after { content: " ↓"; }
thead th.sorted[data-dir="asc"]::after { content: " ↑"; }
tbody td { padding: 12px 14px; border-bottom: 1px solid var(--border-soft); vertical-align: middle; }
tbody tr:last-child td { border-bottom: 0; }
tbody tr:hover td { background: rgba(255, 255, 255, .025); }
tbody tr.is-ath td { background: rgba(251, 191, 36, .07); }
tbody tr.is-ath:hover td { background: rgba(251, 191, 36, .12); }
tbody tr.is-ath td:first-child { box-shadow: inset 3px 0 0 var(--amber); }
.badge {
  display: inline-block;
  margin-left: 7px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--amber);
  color: #241803;
  font-family: var(--sans);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .06em;
  vertical-align: middle;
}
td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ticker { font-family: var(--mono); font-weight: 700; color: #bfe9ff; letter-spacing: .02em; white-space: nowrap; }
.company .name { display: block; color: var(--text); font-weight: 600; }
.company .meta { display: block; margin-top: 2px; color: var(--muted-2); font-size: 11.5px; }
.sector { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
.price { color: #dbe6ff; }
.rsi { font-family: var(--mono); font-size: 12.5px; }
.rsi.hot { color: var(--amber); }
.rsi.cold { color: var(--accent-2); }
.ath { color: var(--muted); }
.ath.high { color: var(--amber); font-weight: 700; }
.event { color: #c7d5f5; font-size: 12.5px; }
.event.soon { color: var(--amber); font-weight: 700; }
.event.today { color: var(--red); font-weight: 800; }
.chart-link {
  color: var(--accent);
  font-size: 12.5px;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
}
.chart-link:hover { color: #b9fff2; text-decoration: underline; }
.muted { color: var(--muted-2); }
.empty-state { padding: 44px 20px; text-align: center; color: var(--muted); }
.empty-state h2 { margin: 0 0 6px; color: var(--text); font-size: 20px; }
.reasons {
  margin-top: 14px;
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  background: rgba(17, 27, 49, .55);
  color: var(--muted);
  font-size: 13px;
}
.reasons summary { padding: 11px 16px; cursor: pointer; user-select: none; }
.reasons summary:hover { color: var(--text); }
.reasons ul {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin: 0;
  padding: 2px 16px 14px;
  list-style: none;
}
.reasons li { display: flex; gap: 7px; align-items: baseline; }
.reasons li span { color: var(--muted); }
.reasons li strong { color: var(--text); font-variant-numeric: tabular-nums; }
#no-visible td { padding: 34px 18px; text-align: center; color: var(--muted); }
.foot {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
  margin-top: 18px;
  color: var(--muted-2);
  font-size: 12px;
}
.foot p { margin: 0; max-width: 780px; }
@media (max-width: 760px) {
  .shell { width: calc(100% - 24px); padding-top: 24px; }
  .hero { align-items: flex-start; flex-direction: column; }
  .stamp { text-align: left; }
  .stats { grid-template-columns: 1fr; }
  .filters { align-items: stretch; }
  .field, .field.search { flex: 1 1 100%; }
  .btn { width: 100%; }
  thead th, tbody td { padding: 10px 11px; }
  .sector { display: none; }
  .picks { padding: 16px; }
  .picks-head { flex-direction: column; }
  .pick { grid-template-columns: 26px minmax(0, 1fr); }
  .pick-score { grid-column: 2; font-size: 20px; text-align: left; }
  .report { padding: 16px; }
  .report-head, .main-pick-head { flex-direction: column; }
  .report-stamp { text-align: left; }
  .report-cols { grid-template-columns: 1fr; gap: 4px; }
  .score-row { width: 100%; }
  .news { padding: 16px; }
  .news-head { flex-direction: column; }
  .news-list { grid-template-columns: 1fr; }
}
"""

_JS = """
(function () {
  "use strict";
  var cfg = window.SCREENER || {};
  var staticMode = cfg.mode === "static";
  var table = document.getElementById("stocks-table");
  if (!table) return;
  var tbody = table.tBodies[0];
  var allRows = Array.prototype.slice.call(tbody.rows).filter(function (row) {
    return row.dataset && row.dataset.ticker;
  });
  var search = document.getElementById("search");
  var minWeek = document.getElementById("min_week");
  var athMargin = document.getElementById("ath_margin");
  var sma5 = document.getElementById("sma5");
  var sma20 = document.getElementById("sma20");
  var showAth = document.getElementById("show_ath");
  var showGrowth = document.getElementById("growth");
  var countEl = document.getElementById("visible-count");
  var noVisible = document.getElementById("no-visible");
  var total = allRows.length;

  function numberOf(el, fallback) {
    if (!el) return fallback;
    var n = parseFloat(String(el.value).replace(",", "."));
    return Number.isFinite(n) ? n : fallback;
  }

  function applyFilters() {
    var q = search ? String(search.value || "").trim().toLowerCase() : "";
    var mw = numberOf(minWeek, -1000);
    var margin = numberOf(athMargin, 0);
    var need5 = sma5 ? sma5.checked : false;
    var need20 = sma20 ? sma20.checked : false;
    var visible = 0;

    allRows.forEach(function (row) {
      var ok = true;
      if (q && String(row.dataset.search || "").indexOf(q) === -1) ok = false;
      if (ok && showAth && !showAth.checked && row.dataset.athFlag === "1") ok = false;
      if (ok && staticMode && (!showAth || !showAth.checked)) {
        var week = parseFloat(row.dataset.week);
        if (Number.isFinite(week) && week * 100 <= mw) ok = false;
        var ath = parseFloat(row.dataset.ath);
        if (ok && Number.isFinite(ath) && ath * 100 > -margin) ok = false;
        if (ok && need5 && row.dataset.sma5 !== "1") ok = false;
        if (ok && need20 && row.dataset.sma20 !== "1") ok = false;
        if (ok && showGrowth && !showGrowth.checked && row.dataset.growth === "1") ok = false;
      }
      row.hidden = !ok;
      if (ok) visible += 1;
    });

    if (countEl) countEl.textContent = String(visible);
    if (noVisible) noVisible.hidden = visible !== 0;
  }

  var headers = table.querySelectorAll("th[data-sort]");
  var sortKey = cfg.sort || "week";
  var sortDir = -1;

  function valueOf(row, key) {
    var raw = row.dataset[key];
    if (["week", "month", "ath", "close", "rsi", "mcap", "earnings", "exdate"].indexOf(key) !== -1) {
      var n = parseFloat(raw);
      return Number.isFinite(n) ? n : null;
    }
    var text = String(raw || "").toLowerCase();
    return text || null;
  }

  function sortRows(key, dir) {
    var sorted = allRows.slice().sort(function (a, b) {
      var va = valueOf(a, key);
      var vb = valueOf(b, key);
      // Tomme verdier skal alltid ligge nederst, uansett sorteringsretning.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        if (va === vb) return 0;
        return (va - vb) * dir;
      }
      return String(va).localeCompare(String(vb), "nb") * dir;
    });
    sorted.forEach(function (row) { tbody.appendChild(row); });
    headers.forEach(function (th) {
      var active = th.dataset.sort === key;
      th.classList.toggle("sorted", active);
      if (active) th.dataset.dir = dir > 0 ? "asc" : "desc";
      else th.removeAttribute("data-dir");
      th.setAttribute("aria-sort", active ? (dir > 0 ? "ascending" : "descending") : "none");
    });
  }

  headers.forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.dataset.sort;
      if (sortKey === key) {
        sortDir *= -1;
      } else {
        sortKey = key;
        sortDir = (key === "ticker" || key === "name" || key === "sector") ? 1 : -1;
      }
      sortRows(sortKey, sortDir);
    });
  });

  [search, minWeek, athMargin, sma5, sma20, showAth, showGrowth].forEach(function (el) {
    if (el) el.addEventListener("input", applyFilters);
  });

  var form = document.getElementById("filters");
  if (form && staticMode) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      applyFilters();
    });
  }

  applyFilters();
  if (headers.length) {
    var initial = Array.prototype.slice.call(headers).filter(function (th) {
      return th.dataset.sort === sortKey;
    })[0];
    if (initial) initial.classList.add("sorted");
  }
})();
"""


def _e(value: object) -> str:
    return html.escape(str(value), quote=True)


def _pct_class(value: Optional[float]) -> str:
    if value is None:
        return "flat"
    if value > 0:
        return "pos"
    if value < 0:
        return "neg"
    return "flat"


def _median(values: list[float]) -> Optional[float]:
    return statistics.median(values) if values else None


def _event_cell(value: Optional[date], days: Optional[int]) -> str:
    if value is None:
        return '<span class="muted">–</span>'
    title = _e(format_date(value))
    if days is None or days < 0:
        return f'<span class="muted" title="{title}">–</span>'
    if days == 0:
        return f'<span class="event today" title="{title}">i dag</span>'
    css = "event soon" if days <= 7 else "event"
    label = "1 dag" if days == 1 else f"{days} d"
    return f'<span class="{css}" title="{title}">{label}</span>'


def _stock_row(
    stock: Stock,
    at_high: bool = False,
    news_items: tuple[NewsItem, ...] = (),
    news_feed: Optional[NewsFeed] = None,
) -> str:
    distance = stock.distance_to_ath
    if distance is None:
        ath_value = ""
        ath_cell = f'<span class="muted" title="All-time high er usikker, trolig på grunn av splitt">–</span>'
    else:
        ath_value = f"{distance:.6f}"
        ath_class = "ath high" if at_high else "ath"
        ath_cell = f'<span class="{ath_class}">{format_pct(distance)}</span>'

    week_value = "" if stock.week_return is None else f"{stock.week_return:.6f}"
    month_value = "" if stock.month_return is None else f"{stock.month_return:.6f}"
    rsi_value = "" if stock.rsi is None else f"{stock.rsi:.4f}"
    mcap_value = "" if stock.market_cap is None else f"{stock.market_cap:.0f}"
    earnings_days = days_until(stock.earnings_date)
    ex_days = days_until(stock.ex_dividend_date)
    earnings_value = "" if earnings_days is None or earnings_days < 0 else str(earnings_days)
    ex_value = "" if ex_days is None or ex_days < 0 else str(ex_days)
    earnings_cell = _event_cell(stock.earnings_date, earnings_days)
    ex_cell = _event_cell(stock.ex_dividend_date, ex_days)
    sma5_ok = "1" if stock.sma5 is not None and stock.close > stock.sma5 else "0"
    sma20_ok = "1" if stock.sma20 is not None and stock.close > stock.sma20 else "0"
    market_label = " · Euronext Growth" if stock.is_growth else ""
    search_blob = (
        f"{stock.ticker} {stock.name} {stock.sector} "
        f"{'Euronext Growth' if stock.is_growth else 'Oslo Børs'}"
    ).lower()

    rsi_class = "rsi"
    if stock.rsi is not None and stock.rsi >= 70:
        rsi_class += " hot"
    elif stock.rsi is not None and stock.rsi <= 30:
        rsi_class += " cold"

    sector_cell = f'<td class="sector" data-label="Sektor">{_e(stock.sector)}</td>'
    row_class = "is-ath" if at_high else ""
    badge = (
        '<span class="badge" title="På/ved all-time high">ATH</span>'
        if at_high
        else ""
    )
    news_badge = ""
    news_sentiment = "neutral"
    news_new = 0
    if news_items:
        latest = unique_news(news_items, limit=1)[0]
        count = len(news_items)
        count_label = "1 børsmelding" if count == 1 else f"{count} børsmeldinger"
        news_sentiment = aggregate_sentiment(news_items)
        news_new = news_feed.new_count(news_items) if news_feed is not None else 0
        new_label = (
            f"; {_new_label(news_new)} siden siste åpning" if news_new else ""
        )
        sentiment_label = _sentiment_label(news_sentiment).lower()
        symbol = _sentiment_symbol(news_sentiment)
        title = (
            f"{count_label} siden forrige handelsdag{new_label}. "
            f"Nyhetene virker {sentiment_label}. Siste: {latest.title}"
        )
        news_badge = (
            f' <a class="news-badge news-badge-{news_sentiment}" '
            f'href="{_e(latest.url)}" target="_blank" '
            f'rel="noopener noreferrer" title="{_e(title)}">'
            f"📰{count}{symbol}</a>"
        )
    url = nordnet_url(stock)
    link_cell = (
        f'<td class="num"><a class="chart-link" href="{_e(url)}" target="_blank" '
        f'rel="noopener noreferrer" title="Åpne {_e(stock.ticker)} i Nordnet">'
        f'Nordnet ↗</a></td>'
    )

    return (
        f'<tr class="{row_class}" data-ticker="{_e(stock.ticker)}" data-name="{_e(stock.name)}" '
        f'data-sector="{_e(stock.sector)}" data-market="{_e(stock.market)}" '
        f'data-growth="{"1" if stock.is_growth else "0"}" data-search="{_e(search_blob)}" '
        f'data-week="{week_value}" data-month="{month_value}" data-ath="{ath_value}" '
        f'data-ath-flag="{"1" if at_high else "0"}" '
        f'data-close="{stock.close:.6f}" data-rsi="{rsi_value}" data-mcap="{mcap_value}" '
        f'data-earnings="{earnings_value}" data-exdate="{ex_value}" '
        f'data-sma5="{sma5_ok}" data-sma20="{sma20_ok}" data-news="{len(news_items)}" '
        f'data-news-sentiment="{news_sentiment}" data-news-new="{news_new}">'
        f'<td class="ticker">{_e(stock.ticker)}{badge}{news_badge}</td>'
        f'<td class="company"><span class="name">{_e(stock.name)}</span>'
        f'<span class="meta">{_e(format_market_cap(stock.market_cap))} · {_e(stock.currency)}{_e(market_label)}</span></td>'
        f'<td class="num price">{_e(format_price(stock.close))}</td>'
        f'<td class="num {_pct_class(stock.week_return)}">{_e(format_pct(stock.week_return))}</td>'
        f'<td class="num {_pct_class(stock.month_return)}">{_e(format_pct(stock.month_return))}</td>'
        f'<td class="num">{ath_cell}</td>'
        f'<td class="num">{earnings_cell}</td>'
        f'<td class="num">{ex_cell}</td>'
        f'<td class="num"><span class="{rsi_class}">{_e(DASH if stock.rsi is None else f"{stock.rsi:.0f}")}</span></td>'
        f"{sector_cell}"
        f"{link_cell}"
        f"</tr>"
    )


def _category_badges(labels: tuple[str, ...]) -> str:
    return "".join(
        f'<span class="cat-badge cat-{_e(label.lower())}">{_e(label)}</span>'
        for label in labels
    )


def _candidate_card(
    rank: int,
    candidate: Candidate,
    at_high: bool,
    news_items: tuple[NewsItem, ...] = (),
    news_feed: Optional[NewsFeed] = None,
    planned: Optional[PlannedCandidate] = None,
) -> str:
    stock = candidate.stock
    badge = (
        '<span class="badge" title="På/ved all-time high">ATH</span>'
        if at_high
        else ""
    )
    warnings = ""
    if candidate.warnings:
        warnings = (
            f'<p class="pick-warnings">⚠ {_e(" · ".join(candidate.warnings))}</p>'
        )
    news_html = ""
    if news_items:
        latest = unique_news(news_items, limit=1)[0]
        count = len(news_items)
        count_label = "1 melding" if count == 1 else f"{count} meldinger"
        sentiment = aggregate_sentiment(news_items)
        new_count = news_feed.new_count(news_items) if news_feed is not None else 0
        new_label = (
            f", {_new_label(new_count)} siden åpning" if new_count else ""
        )
        news_html = (
            f'<p class="pick-news">📰 {_sentiment_html(sentiment)} '
            f'<a href="{_e(latest.url)}" target="_blank" '
            f'rel="noopener noreferrer">{_e(latest.title)}</a> '
            f'<span class="muted">({_e(count_label)}{_e(new_label)} '
            f"siden forrige handelsdag)</span></p>"
        )
    categories = (
        _category_badges(planned.category_labels)
        if planned is not None
        else _category_badges(
            tuple(
                {"momentum": "Momentum", "breakout": "Breakout", "news": "Nyhetsdrevet"}.get(
                    value, value
                )
                for value in candidate.categories
            )
        )
    )
    planned_html = ""
    if planned is not None:
        trade = planned.trade
        blocked = ""
        if planned.block_reasons:
            blocked = (
                f'<p class="pick-warnings">Ikke anbefalt: '
                f'{_e("; ".join(planned.block_reasons))}</p>'
            )
        planned_html = (
            f'<p class="pick-trade">{trade.shares} aksjer · '
            f'kapital {_e(format_money(trade.total_cost))} · '
            f'mål {_e(format_price(trade.target_price))} kr · '
            f'stopp {_e(format_price(trade.stop_price))} kr</p>'
            f"{blocked}"
        )
    return (
        f'<li class="pick">'
        f'<span class="pick-rank">{rank}</span>'
        f'<div class="pick-body">'
        f'<div class="pick-title">'
        f'<a class="pick-ticker" href="{_e(nordnet_url(stock))}" target="_blank" '
        f'rel="noopener noreferrer" title="Åpne {_e(stock.ticker)} i Nordnet">'
        f"{_e(stock.ticker)}</a>"
        f"{badge}"
        f'<span class="pick-name">{_e(stock.name)}</span>'
        f"{categories}"
        f"</div>"
        f'<p class="pick-reasons">{_e(" · ".join(candidate.reasons))}</p>'
        f"{planned_html}"
        f"{news_html}"
        f"{warnings}"
        f"</div>"
        f'<span class="pick-score" title="Samlet relativ poengsum 0–100">'
        f'{candidate.score:.0f}<small>total</small>'
        f'<span class="score-sub">M {candidate.opportunity_score:.0f} · '
        f'R {candidate.risk_score:.0f}</span></span>'
        f"</li>"
    )


def _render_candidates(
    candidates: list[Candidate],
    criteria: Criteria,
    news: Optional[NewsFeed] = None,
) -> str:
    head = (
        '<div class="picks-head">'
        "<div>"
        "<h2>Topp 5 kandidater</h2>"
        "<p>Teknisk rangering av dagens treff basert på momentum, trend, "
        "likviditet, volatilitet og RSI. Ikke et kjøpssignal – bekreft volum, "
        "spread og retning etter børsåpning.</p>"
        "</div>"
        '<span class="picks-note">Score 0–100</span>'
        "</div>"
    )
    if not candidates:
        return (
            '<section class="picks" aria-label="Topp 5 kandidater">'
            f"{head}"
            '<p class="muted">Ingen kandidater passer kortsiktighetsfiltrene '
            "akkurat nå. Senk kravene i tabellen eller prøv igjen senere.</p>"
            "</section>"
        )
    cards = "\n".join(
        _candidate_card(
            index,
            candidate,
            is_at_high(candidate.stock, criteria),
            news_items=news.for_stock(candidate.stock) if news is not None else (),
            news_feed=news,
        )
        for index, candidate in enumerate(candidates, 1)
    )
    return (
        '<section class="picks" aria-label="Topp 5 kandidater">'
        f"{head}"
        f'<ol class="pick-list">{cards}</ol>'
        "</section>"
    )


def _score_box(label: str, value: float, extra: str = "") -> str:
    return (
        f'<div class="score-box">'
        f'<span>{_e(label)}</span>'
        f'<strong>{value:.0f}</strong>'
        f'<small>{_e(extra)}</small>'
        f"</div>"
    )


def _planned_news_html(
    planned: PlannedCandidate,
    news: Optional[NewsFeed],
) -> str:
    candidate = planned.candidate
    signal = candidate.news_signal
    if signal.count == 0:
        return '<p class="muted">Ingen relevante børsmeldinger i nyhetsvinduet.</p>'
    event = EVENT_LABELS.get(signal.event_type, signal.event_type)
    relevance = RELEVANCE_LABELS.get(signal.relevance, signal.relevance)
    items = news.for_stock(candidate.stock) if news is not None else ()
    latest_link = ""
    if items:
        latest = unique_news(items, limit=1)[0]
        latest_link = (
            f'<a href="{_e(latest.url)}" target="_blank" rel="noopener noreferrer">'
            f"{_e(latest.title)}</a>"
        )
    else:
        latest_link = _e(signal.latest_title)
    new_count = news.new_count(items) if news is not None and items else 0
    new_text = (
        f" · {_new_label(new_count)} siden åpning" if new_count else ""
    )
    return (
        f'<p class="report-news">{_sentiment_html(signal.sentiment)} '
        f'<span class="muted">· {_e(event)} · relevans {_e(relevance)} · '
        f"{signal.count} melding{'er' if signal.count != 1 else ''}{new_text}</span></p>"
        f'<p class="report-news-title">{latest_link}</p>'
    )


def _scenario_table(planned: PlannedCandidate) -> str:
    rows = "".join(
        f"<tr><td>{format_pct(item.change_pct, signed=True)}</td>"
        f"<td>{_e(format_price(item.exit_price))} kr</td>"
        f"<td class=\"{'pos' if item.net_profit > 0 else 'neg'}\">"
        f"{_e(format_money(item.net_profit, signed=True))}</td>"
        f"<td class=\"{'pos' if item.net_profit > 0 else 'neg'}\">"
        f"{_e(format_pct(item.net_return_pct / 100))}</td></tr>"
        for item in planned.trade.scenarios
    )
    return (
        '<div class="table-wrap">'
        '<table class="mini-table"><thead><tr>'
        "<th>Bevegelse</th><th>Salgskurs</th><th>Netto etter kurtasje</th>"
        "<th>Netto avkastning</th></tr></thead>"
        f"<tbody>{rows}</tbody></table></div>"
    )


def _premarket_section(
    report: PremarketReport,
    criteria: Criteria,
    news: Optional[NewsFeed] = None,
) -> str:
    categories = {"momentum": 0, "breakout": 0, "news": 0}
    for planned in report.ranked:
        for category in planned.candidate.categories:
            categories[category] = categories.get(category, 0) + 1
    category_chips = "".join(
        f'<span class="chip">{_e(label)} <strong>{categories[key]}</strong></span>'
        for key, label in (
            ("momentum", "Momentum"),
            ("breakout", "Breakout"),
            ("news", "Nyhetsdrevet"),
        )
    )
    stamp = (
        '<div class="report-stamp">'
        f"<span>Rapport generert</span><strong>{_e(format_datetime(report.generated_at))}</strong>"
        f"<small>{'før børsåpning' if report.is_premarket else 'etter børsåpning – estimat'}</small>"
        "</div>"
    )
    head = (
        '<div class="report-head"><div>'
        '<p class="eyebrow">Pre-market · Oslo Børs</p>'
        "<h2>Dagens hovedkandidat</h2>"
        f"<p>{_e(report.data_basis)} Kandidatene er et teknisk utgangspunkt. "
        "Ikke et kjøpssignal – bekreft etter åpning.</p>"
        "</div>"
        f"{stamp}</div>"
    )

    if report.main is None:
        alternatives = "".join(
            _candidate_card(
                index,
                item.candidate,
                is_at_high(item.candidate.stock, criteria),
                news.for_stock(item.candidate.stock) if news is not None else (),
                news,
                planned=item,
            )
            for index, item in enumerate(report.alternatives, 1)
        )
        body = (
            '<div class="no-trade">'
            "<h3>Ingen anbefalte kandidater i dag – vurder å stå over.</h3>"
            f"<p>{_e(report.no_trade_reason or 'Kandidatene oppfyller ikke kravene til score, risiko og likviditet.')}</p>"
            f'<ul class="report-list warnings">{"".join(f"<li>{_e(item)}</li>" for item in report.warnings)}</ul>'
            "</div>"
            f'<div class="chips">{category_chips}</div>'
        )
        if alternatives:
            body += (
                "<h3>Mulige alternativer – ikke anbefalt som hovedhandel</h3>"
                f'<ol class="pick-list">{alternatives}</ol>'
            )
        return (
            '<section class="report no-trade-report" aria-label="Dagens pre-market-rapport">'
            f"{head}{body}</section>"
        )

    main = report.main
    candidate = main.candidate
    stock = candidate.stock
    trade = main.trade
    warnings = "".join(f"<li>{_e(item)}</li>" for item in candidate.warnings)
    report_warnings = "".join(f"<li>{_e(item)}</li>" for item in report.warnings)
    reasons = "".join(f"<li>{_e(item)}</li>" for item in candidate.reasons)
    categories_html = _category_badges(main.category_labels) or '<span class="muted">Ingen kategori</span>'
    resistance_text = (
        f"{_e(format_price(candidate.resistance))} kr "
        f"({_e(format_pct(candidate.technical_upside))})"
        if candidate.resistance is not None
        else "Åpent rom over kjent topp"
    )
    support_text = (
        f"{_e(format_price(candidate.support))} kr"
        if candidate.support is not None
        else "Ingen tydelig støtte i datagrunnlaget"
    )
    risk_class = {
        "Lav": "risk-low",
        "Middels": "risk-medium",
        "Høy": "risk-high",
    }.get(candidate.risk_level, "risk-medium")
    alt_cards = "".join(
        _candidate_card(
            index,
            item.candidate,
            is_at_high(item.candidate.stock, criteria),
            news.for_stock(item.candidate.stock) if news is not None else (),
            news,
            planned=item,
        )
        for index, item in enumerate(report.alternatives, 1)
    )
    body = f"""
      <div class="main-pick">
        <div class="main-pick-head">
          <div>
            <div class="pick-title">
              <a class="pick-ticker" href="{_e(nordnet_url(stock))}" target="_blank" rel="noopener noreferrer">{_e(stock.ticker)}</a>
              <span class="pick-name">{_e(stock.name)}</span>
              {categories_html}
            </div>
            <p class="main-reasons">{_e(" · ".join(candidate.reasons))}</p>
            <p class="muted">{_e(stock.sector)} · {_e(format_market_cap(stock.market_cap))} · RSI {_e(DASH if stock.rsi is None else f"{stock.rsi:.0f}")}</p>
          </div>
          <div class="score-row">
            {_score_box("Total", candidate.score, "relativ poengsum")}
            {_score_box("Mulighet", candidate.opportunity_score, "teknisk + nyheter")}
            {_score_box("Risiko", candidate.risk_score, candidate.risk_level)}
          </div>
        </div>
        <div class="report-grid">
          <div><span>Siste sluttkurs</span><strong>{_e(format_price(stock.close))} kr</strong><small>estimat for neste åpning</small></div>
          <div><span>Antall aksjer</span><strong>{trade.shares}</strong><small>hele aksjer, ikke brøkdeler</small></div>
          <div><span>Kapitalbruk</span><strong>{_e(format_money(trade.total_cost))}</strong><small>inkl. kurtasje {_e(format_money(trade.buy_fee))} kjøp / {_e(format_money(trade.sell_fee))} salg</small></div>
          <div><span>Gevinstmål</span><strong>{_e(format_price(trade.target_price))} kr</strong><small>{_e(format_pct(report.settings.trade.target_pct))} · netto {_e(format_money(trade.target_net, signed=True))}</small></div>
          <div><span>Tapsgrense</span><strong>{_e(format_price(trade.stop_price))} kr</strong><small>{_e(format_pct(-report.settings.trade.stop_loss_pct))} · netto {_e(format_money(trade.stop_net, signed=True))}</small></div>
          <div><span>Gevinst/tap</span><strong>{_e(DASH if trade.reward_risk is None else f"{trade.reward_risk:.1f}:1")}</strong><small>etter kurtasje</small></div>
        </div>
        <div class="report-cols">
          <div>
            <h3>Hvorfor denne aksjen</h3>
            <ul class="report-list">{reasons}</ul>
            <h3>Tekniske nivåer</h3>
            <ul class="report-list">
              <li>Motstand: {resistance_text}</li>
              <li>Støtte: {support_text}</li>
              <li>Breakout-status: {_e(candidate.breakout_status)}</li>
              <li>Volumforhold: {_e(DASH if candidate.volume_ratio is None else f"{candidate.volume_ratio:.1f}×")}</li>
              <li>ATR: {_e(format_pct(stock.atr_pct))}</li>
            </ul>
          </div>
          <div>
            <h3>Nyheter og hendelsestype</h3>
            {_planned_news_html(main, news)}
            <h3>Risiko og forbehold</h3>
            <ul class="report-list warnings">{warnings}{report_warnings}</ul>
            <p class="muted">Sjekk spread, volum og nyheter etter åpning. Rapporten utfører ingen handler.</p>
          </div>
        </div>
        <h3>Gevinst- og tapsscenarioer</h3>
        {_scenario_table(main)}
        <p class="report-note">Kjøpsprisen er estimert fra siste sluttkurs. Faktisk åpningskurs, spread og kurtasje kan avvike. Scenariene er netto etter kurtasje og eventuell konfigurert slippage, men før skatt.</p>
        <h3>Følg med etter åpning</h3>
        <p class="report-note">Bekreft at kursen holder seg over siste sluttkurs og SMA5 ({_e(format_price(stock.sma5))} kr), at volumet er unormalt høyt, og at spreaden er akseptabel. Ved negativ nyhet eller brudd på støtten: vurder å stå over eller bruk tapsgrensen.</p>
      </div>
      <div class="chips">{category_chips}</div>
      <h3>Alternativer ({len(report.alternatives)})</h3>
      <p class="muted">Kandidatene er rangert etter samlet score. Kortene viser også hva som taler imot.</p>
      <ol class="pick-list">{alt_cards or '<li class="muted">Ingen alternativer.</li>'}</ol>
    """
    return (
        '<section class="report" aria-label="Dagens pre-market-rapport">'
        f"{head}{body}</section>"
    )


def _backtest_section(backtest: Optional[dict]) -> str:
    if not backtest:
        return (
            '<section class="report backtest" aria-label="Historisk test">'
            "<h2>Historisk test</h2>"
            "<p>Ingen lagret backtest funnet. Kjør for eksempel "
            "<code>python backtest.py --csv historiske_daglige_data.csv</code> "
            "og start appen på nytt for å vise resultatene.</p>"
            "</section>"
        )

    def _row(label: str, data: dict) -> str:
        return (
            f"<tr><td>{_e(label)}</td><td>{data.get('trades', 0)}</td>"
            f"<td>{data.get('hit_rate_pct', 0):.1f} %</td>"
            f"<td>{data.get('stop_rate_pct', 0):.1f} %</td>"
            f"<td>{data.get('win_rate_pct', 0):.1f} %</td>"
            f"<td class=\"{'pos' if data.get('avg_net_profit', 0) > 0 else 'neg'}\">"
            f"{_e(format_money(data.get('avg_net_profit'), signed=True))}</td>"
            f"<td>{_e(format_money(data.get('total_net_profit'), signed=True))}</td></tr>"
        )

    rows = [
        _row("Hovedkandidat (topp 1)", backtest.get("top1", {})),
        _row("Topp 5", backtest.get("top5", {})),
    ]
    for key, label in (
        ("momentum", "Momentum"),
        ("breakout", "Breakout"),
        ("news", "Nyhetsdrevet"),
    ):
        rows.append(_row(label, backtest.get("by_category", {}).get(key, {})))
    warnings = "".join(
        f"<li>{_e(item)}</li>" for item in backtest.get("warnings", [])
    )
    target_summaries = backtest.get("target_summaries", {})
    target_rows = "".join(
        _row(f"Mål {label}", target_summaries[label])
        for label in sorted(
            target_summaries,
            key=lambda value: float(str(value).rstrip("%") or 0),
        )
    )
    stop_pct = (
        backtest.get("settings", {})
        .get("trade", {})
        .get("stop_loss_pct", 0.02)
    )
    return (
        '<section class="report backtest" id="historikk" aria-label="Historisk test">'
        "<h2>Historisk test</h2>"
        f"<p>Periode {_e(str(backtest.get('from_date') or DASH))}–"
        f"{_e(str(backtest.get('to_date') or DASH))}. Primært mål +2 % og "
        f"tapsgrense −{_e(format_pct(stop_pct, signed=False))}, netto etter kurtasje.</p>"
        '<div class="table-wrap"><table class="mini-table"><thead><tr>'
        "<th>Utvalg</th><th>Handler</th><th>+2 % treff</th><th>Stop</th>"
        "<th>Gevinst</th><th>Snitt netto</th><th>Sum netto</th>"
        f"</tr></thead><tbody>{''.join(rows)}</tbody></table></div>"
        '<h3>Treff per gevinstmål</h3>'
        '<div class="table-wrap"><table class="mini-table"><thead><tr>'
        "<th>Mål</th><th>Handler</th><th>Treff</th><th>Stop</th>"
        "<th>Gevinst</th><th>Snitt netto</th><th>Sum netto</th>"
        f"</tr></thead><tbody>{target_rows}</tbody></table></div>"
        f'<details class="reasons"><summary>Forbehold ved backtesten</summary><ul>{warnings}</ul></details>'
        "</section>"
    )


def _history_section(history: Optional[list[dict]]) -> str:
    if not history:
        return ""

    def _when(value: object) -> str:
        if not isinstance(value, str):
            return DASH
        try:
            return format_datetime(datetime.fromisoformat(value))
        except ValueError:
            return value

    def _number(value: object) -> str:
        return DASH if value is None else f"{float(value):.0f}"

    rows = "".join(
        "<tr>"
        f"<td>{_e(_when(item.get('generated_at')))}</td>"
        f"<td class=\"ticker\">{_e(item.get('ticker') or 'Stå over')}</td>"
        f"<td>{_e(item.get('name') or item.get('reason') or DASH)}</td>"
        f"<td class=\"num\">{_e(_number(item.get('score')))}</td>"
        f"<td class=\"num\">{_e(_number(item.get('risk_score')))}</td>"
        f"<td>{_e(', '.join(item.get('categories') or ()) or DASH)}</td>"
        "</tr>"
        for item in history
    )
    return (
        '<section class="report history" aria-label="Tidligere morgenrapporter">'
        "<h2>Tidligere morgenrapporter</h2>"
        "<p>De nyeste permanent lagrede rapportene. Hver fil er tidsstemplet og "
        "overskrives ikke.</p>"
        '<div class="table-wrap"><table class="mini-table"><thead><tr>'
        "<th>Rapport</th><th>Hovedkandidat</th><th>Selskap</th>"
        "<th>Total</th><th>Risiko</th><th>Kategori</th>"
        f"</tr></thead><tbody>{rows}</tbody></table></div>"
        "</section>"
    )


def _news_section(news: Optional[NewsFeed], stocks: list[Stock]) -> str:
    if news is None:
        return ""

    since_text = format_datetime(news.since)
    warning = f'<div class="warning">{_e(news.warning)}</div>' if news.warning else ""
    source_label = {
        "live": "live",
        "cache": "cache",
        "stale-cache": "gammel cache",
        "error": "feil",
    }.get(news.source, news.source)

    companies: list[tuple[datetime, Stock, tuple[NewsItem, ...]]] = []
    for stock in stocks:
        items = news.for_stock(stock)
        if not items:
            continue
        latest = unique_news(items, limit=1)[0]
        companies.append((latest.published_at, stock, items))
    companies.sort(key=lambda row: row[0], reverse=True)

    def _company_card(row: tuple[datetime, Stock, tuple[NewsItem, ...]]) -> str:
        _, stock, items = row
        headlines = unique_news(items)
        count = len(items)
        count_label = "1 melding" if count == 1 else f"{count} meldinger"
        new_count = news.new_count(items)
        new_label = f" · {_new_label(new_count)}" if new_count else ""
        sentiment = aggregate_sentiment(items)

        def _headline_li(item: NewsItem) -> str:
            new_badge = (
                '<span class="news-new">NY</span>'
                if news.is_new_since_open(item)
                else ""
            )
            return (
                f'<li><span class="news-headline-meta">'
                f'{_sentiment_html(item.sentiment, "sentiment-small")}'
                f"{new_badge}"
                f"</span>"
                f'<a href="{_e(item.url)}" target="_blank" rel="noopener noreferrer">'
                f"{_e(item.title)}</a>"
                f'<span class="news-time">'
                f'{_e(item.published_at.strftime("%d.%m %H:%M"))}</span></li>'
            )

        headline_html = "".join(_headline_li(item) for item in headlines[:2])
        older_html = ""
        older = headlines[2:]
        if older:
            older_label = (
                "1 eldre melding"
                if len(older) == 1
                else f"{len(older)} eldre meldinger"
            )
            older_html = (
                f'<details class="news-headline-more"><summary>'
                f"Vis {older_label}</summary>"
                f'<ul class="news-headlines">'
                f'{"".join(_headline_li(item) for item in older)}</ul></details>'
            )
        return (
            '<li class="news-company">'
            '<div class="news-company-head">'
            f'<a class="news-ticker" href="{_e(headlines[0].url)}" target="_blank" '
            f'rel="noopener noreferrer">{_e(stock.ticker)}</a>'
            f'<span class="news-company-name">{_e(stock.name)}</span>'
            f"{_sentiment_html(sentiment)}"
            f'<span class="news-count">{_e(count_label)}{_e(new_label)}</span>'
            "</div>"
            f'<ul class="news-headlines">{headline_html}</ul>'
            f"{older_html}"
            "</li>"
        )

    if not companies:
        body = (
            f'<p class="muted">Ingen børsmeldinger for aksjene i listen siden '
            f"forrige handelsdag stengte ({_e(since_text)}).</p>"
        )
    else:
        first = "".join(_company_card(row) for row in companies[:8])
        body = f'<ul class="news-list">{first}</ul>'
        rest = companies[8:]
        if rest:
            body += (
                f'<details class="news-more"><summary>Vis alle {len(companies)} '
                "selskaper med meldinger</summary>"
                f'<ul class="news-list">{"".join(_company_card(row) for row in rest)}</ul>'
                "</details>"
            )

    return (
        '<section class="news" id="nyheter" aria-label="Nyheter siden forrige handelsdag">'
        '<div class="news-head"><div>'
        "<h2>Nyheter siden forrige handelsdag</h2>"
        f"<p>Børsmeldinger fra Oslo Børs NewsWeb for aksjene i listen, "
        f"siden forrige handelsdag stengte ({_e(since_text)}). "
        "Klikk på en overskrift for å åpne meldingen.</p>"
        "</div>"
        f'<span class="news-source">{_e(source_label)}</span>'
        "</div>"
        f"{warning}{body}"
        '<p class="news-note">Positiv/negativ/nøytral er en enkel '
        "stikkordsanalyse, ikke en vurdering av nyheten. Sjekk alltid kilden.</p>"
        "</section>"
    )


def render_dashboard(
    result: ScreenResult,
    universe: Universe,
    criteria: Criteria,
    sort_by: str = "week",
    web_mode: bool = True,
    refresh_url: str = "/refresh",
    news: Optional[NewsFeed] = None,
    report: Optional[PremarketReport] = None,
    backtest: Optional[dict] = None,
    history: Optional[list[dict]] = None,
) -> str:
    stocks = sort_stocks(result.matches, sort_by)
    if report is None:
        report = build_premarket_report(stocks, criteria, universe, news=news)

    def _news_for(stock: Stock) -> tuple[NewsItem, ...]:
        return news.for_stock(stock) if news is not None else ()

    rows = "\n".join(
        _stock_row(
            stock,
            is_at_high(stock, criteria),
            _news_for(stock),
            news_feed=news,
        )
        for stock in stocks
    )
    report_html = _premarket_section(report, criteria, news)
    backtest_html = _backtest_section(backtest)
    history_html = _history_section(history)
    news_html = _news_section(news, stocks)
    at_high_count = result.at_high_count
    growth_hidden = result.excluded.get("euronext growth", 0)

    weeks = [s.week_return for s in stocks if s.week_return is not None]
    distances = [s.distance_to_ath for s in stocks if s.distance_to_ath is not None]
    median_week = _median(weeks)
    median_distance = _median(distances)
    closest = max(distances) if distances else None

    source_label = {"live": "live", "cache": "cache", "stale-cache": "gammel cache"}.get(
        universe.source, universe.source
    )
    warning_html = ""
    if universe.warning:
        warning_html = f'<div class="warning">{_e(universe.warning)}</div>'

    chips = [
        f'<span class="chip">Uke &gt; <strong>{_e(format_pct(criteria.min_week_return, signed=False))}</strong></span>'
    ]
    if criteria.require_above_sma5:
        chips.append('<span class="chip">Kurs over <strong>SMA5</strong></span>')
    if criteria.require_above_sma20:
        chips.append('<span class="chip">Kurs over <strong>SMA20</strong></span>')
    chips.append(
        f'<span class="chip">Minst <strong>{_e(format_pct(criteria.ath_margin, signed=False))}</strong> under ATH</span>'
        if not criteria.include_at_high
        else f'<span class="chip">ATH-margin <strong>{_e(format_pct(criteria.ath_margin, signed=False))}</strong></span>'
    )
    if criteria.include_at_high:
        chips.append(
            '<span class="chip ath-chip">ATH = på/ved all-time high – tydelig merket</span>'
        )
    if criteria.exclude_growth:
        chips.append(
            f'<span class="chip">Euronext Growth skjult'
            f'{f" <strong>{growth_hidden}</strong>" if growth_hidden else ""}</span>'
        )
    else:
        chips.append(
            '<span class="chip">Euronext Growth <strong>vises</strong></span>'
        )

    action = ' action="/"' if web_mode else ""
    button_label = "Bruk" if web_mode else "Filtrer"
    refresh_link = (
        f'<a class="btn ghost" href="{_e(refresh_url)}">Hent på nytt</a>' if web_mode else ""
    )

    if stocks:
        table_html = f"""
        <div class="table-wrap">
          <table id="stocks-table">
            <thead>
              <tr>
                <th scope="col" data-sort="ticker">Ticker</th>
                <th scope="col" data-sort="name">Selskap</th>
                <th scope="col" class="num" data-sort="close">Kurs</th>
                <th scope="col" class="num" data-sort="week">1 uke</th>
                <th scope="col" class="num" data-sort="month">1 mnd</th>
                <th scope="col" class="num" data-sort="ath" title="Hvor langt kursen er under all-time high">Mot ATH</th>
                <th scope="col" class="num" data-sort="earnings" title="Dager til neste resultatfremleggelse">Resultat</th>
                <th scope="col" class="num" data-sort="exdate" title="Dager til ex-dividend-dato">Ex-dato</th>
                <th scope="col" class="num" data-sort="rsi">RSI</th>
                <th scope="col" data-sort="sector">Sektor</th>
                <th scope="col" class="num">Graf</th>
              </tr>
            </thead>
            <tbody>
              {rows}
              <tr id="no-visible" hidden><td colspan="11">Ingen aksjer passer filteret.</td></tr>
            </tbody>
          </table>
        </div>
        """
    else:
        table_html = """
        <div class="empty-state">
          <h2>Ingen treff akkurat nå</h2>
          <p>Prøv å senke min. ukeavkastning, slå av SMA-filteret eller øke ATH-marginen.</p>
        </div>
        """

    config = {"mode": "web" if web_mode else "static", "sort": sort_by}
    config_json = json.dumps(config)

    reasons = sorted(result.excluded.items(), key=lambda item: (-item[1], item[0]))
    if reasons:
        reason_items = "".join(
            f"<li><span>{_e(EXCLUSION_LABELS.get(reason, reason))}</span>"
            f"<strong>{count}</strong></li>"
            for reason, count in reasons
        )
        reasons_html = (
            '<details class="reasons">'
            f"<summary>Hvorfor falt {result.universe_size - result.match_count} aksjer bort?</summary>"
            f"<ul>{reason_items}</ul>"
            "</details>"
        )
    else:
        reasons_html = ""

    return f"""<!doctype html>
<html lang="nb">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Tollbugata Profits · Oslo Børs pre-market</title>
  <style>{_CSS}</style>
</head>
<body>
  <div class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">Oslo Børs · pre-market daytrading</p>
        <h1>Tollbugata Profits</h1>
        <p class="lede">Én hovedkandidat, 5–10 alternativer og en manuell plan med kurtasje, gevinstmål og tapsgrense. Rapporten lages før børsåpning. Ingen automatisk handel.</p>
      </div>
      <div class="stamp">
        <span>Data hentet</span>
        <strong>{_e(format_datetime(universe.fetched_at))}</strong>
        <span class="source">Rapport: {_e(format_datetime(report.generated_at))}</span>
        <span class="source">Kilde: TradingView ({_e(source_label)})</span>
      </div>
    </header>

    {warning_html}

    <section class="stats" aria-label="Nøkkeltall">
      <div class="stat">
        <span>Treff</span>
        <strong>{result.match_count}</strong>
        <small>av {result.universe_size} aksjer i datagrunnlaget{f'; {growth_hidden} Euronext Growth skjult' if criteria.exclude_growth and growth_hidden else ''}</small>
      </div>
      <div class="stat">
        <span>På/ved ATH</span>
        <strong>{at_high_count}</strong>
        <small>merket med ATH i listen</small>
      </div>
      <div class="stat">
        <span>Median ukeavkastning</span>
        <strong class="{_pct_class(median_week)}">{_e(format_pct(median_week))}</strong>
        <small>blant aksjene i listen</small>
      </div>
      <div class="stat">
        <span>Median avstand til ATH</span>
        <strong>{_e(format_pct(median_distance))}</strong>
        <small>nærmest ATH: {_e(format_pct(closest))}</small>
      </div>
    </section>

    <div class="chips" aria-label="Aktive kriterier">
      {''.join(chips)}
    </div>

    {report_html}

    {news_html}

    {backtest_html}

    {history_html}

    <section class="panel">
      <form id="filters" class="filters" method="get"{action}>
        <label class="field" for="min_week">
          <span>Min. ukeavkastning (%)</span>
          <input type="number" id="min_week" name="min_week" step="0.1" value="{criteria.min_week_return * 100:.1f}">
        </label>
        <label class="field" for="ath_margin">
          <span>ATH-margin (%)</span>
          <input type="number" id="ath_margin" name="ath_margin" step="0.1" min="0" max="50" value="{criteria.ath_margin * 100:.1f}">
        </label>
        <label class="check" for="sma5">
          <input type="hidden" name="sma5" value="0">
          <input type="checkbox" id="sma5" name="sma5" value="1" {'checked' if criteria.require_above_sma5 else ''}>
          Over SMA5
        </label>
        <label class="check" for="sma20">
          <input type="hidden" name="sma20" value="0">
          <input type="checkbox" id="sma20" name="sma20" value="1" {'checked' if criteria.require_above_sma20 else ''}>
          Over SMA20
        </label>
        <label class="check" for="show_ath" title="Vis aksjer som er på/ved all-time high. De merkes med ATH.">
          <input type="hidden" name="ath" value="0">
          <input type="checkbox" id="show_ath" name="ath" value="1" {'checked' if criteria.include_at_high else ''}>
          Vis ATH-aksjer
        </label>
        <label class="check" for="growth" title="Euronext Growth-aksjer kan normalt ikke holdes på ASK. De er derfor skjult som standard.">
          <input type="hidden" name="growth" value="0">
          <input type="checkbox" id="growth" name="growth" value="1" {'checked' if not criteria.exclude_growth else ''}>
          Vis Euronext Growth
        </label>
        <label class="field search" for="search">
          <span>Søk</span>
          <input type="search" id="search" placeholder="Ticker, selskap eller sektor …" autocomplete="off">
        </label>
        <button class="btn" type="submit">{button_label}</button>
        {refresh_link}
      </form>
      {table_html}
    </section>

    {reasons_html}

    <div class="foot">
      <p>
        Viser <strong id="visible-count">{len(stocks)}</strong> av {len(stocks)} treff.
        {f'<strong>{at_high_count}</strong> er på/ved all-time high og merket <strong>ATH</strong>. ' if at_high_count else ''}
        {f'<strong>{growth_hidden}</strong> Euronext Growth-aksjer er skjult fordi de normalt ikke kan holdes på ASK. ' if criteria.exclude_growth and growth_hidden else ''}
        Data fra TradingView-scanneren (uoffisiell, uten API-nøkkel). Tallene kan være forsinket
        og inneholde feil. Børsmeldinger fra Oslo Børs NewsWeb kan også være forsinket.
        Score er en relativ poengsum, ikke en sannsynlighet. Rapporten er ikke et kjøpssignal,
        utfører ingen handler og er ikke investeringsråd.
      </p>
      <p>Kriterier: {_e(describe_criteria(criteria))}</p>
    </div>
  </div>
  <script>window.SCREENER = {config_json};</script>
  <script>{_JS}</script>
</body>
</html>
"""
