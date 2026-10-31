#!/usr/bin/env python3
"""Tollbugata Profits – kommandolinje for Oslo Børs-ukescreen.

Eksempler:
    python screener.py
    python screener.py --min-week 2 --top 0
    python screener.py --html rapport.html
    python screener.py --json treff.json --quiet
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import time
from pathlib import Path
from typing import Optional

from oslo_screener.cli import add_common_arguments, criteria_from_args
from oslo_screener.data import DataSourceError, fetch_universe
from oslo_screener.logic import is_at_high, screen, sort_stocks
from oslo_screener.news import fetch_news
from oslo_screener.render import render_dashboard, render_terminal
from oslo_screener.serialize import result_to_dict, stock_to_dict

CSV_FIELDS = [
    "ticker",
    "name",
    "price",
    "currency",
    "market",
    "is_growth",
    "at_high",
    "nordnet_url",
    "week_return_pct",
    "month_return_pct",
    "quarter_return_pct",
    "distance_to_ath_pct",
    "ath",
    "ath_reliable",
    "high_52w",
    "sma5",
    "sma20",
    "rsi",
    "market_cap",
    "sector",
    "volume",
    "average_volume_10d",
    "average_turnover",
    "atr",
    "atr_pct",
    "earnings_date",
    "days_to_earnings",
    "ex_dividend_date",
    "days_to_ex_dividend",
    "news_count",
    "news_new_count",
    "news_sentiment",
    "latest_news_time",
    "latest_news_title",
    "latest_news_url",
]


def _write_text(path: str, text: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def _csv_text(stocks, criteria, news=None) -> str:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_FIELDS, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for stock in stocks:
        items = news.for_stock(stock) if news is not None else ()
        data = stock_to_dict(
            stock,
            at_high=is_at_high(stock, criteria),
            news_items=items,
            news_feed=news,
        )
        latest = data.pop("latest_news", None)
        data["latest_news_time"] = latest.get("published_at") if latest else None
        data["latest_news_title"] = latest.get("title") if latest else None
        data["latest_news_url"] = latest.get("url") if latest else None
        writer.writerow(data)
    return buffer.getvalue()


def run_once(args: argparse.Namespace, force: bool = False) -> int:
    criteria = criteria_from_args(args)
    universe = fetch_universe(
        cache_ttl=args.cache_ttl,
        force=force,
        timeout=args.timeout,
    )
    result = screen(universe.stocks, criteria)
    stocks = sort_stocks(result.matches, args.sort)
    news = None
    if not args.no_news:
        news = fetch_news(timeout=args.timeout, force=force)

    json_to_stdout = args.json == "-"
    csv_to_stdout = args.csv == "-"

    if args.json is not None:
        payload = json.dumps(
            result_to_dict(
                result,
                universe,
                criteria,
                sort_by=args.sort,
                news=news,
            ),
            ensure_ascii=False,
            indent=2,
        )
        if json_to_stdout:
            print(payload)
        else:
            _write_text(args.json, payload + "\n")

    if args.csv is not None:
        payload = _csv_text(stocks, criteria, news)
        if csv_to_stdout:
            sys.stdout.write(payload)
        else:
            _write_text(args.csv, payload)

    if args.html is not None:
        page = render_dashboard(
            result,
            universe,
            criteria,
            sort_by=args.sort,
            web_mode=False,
            news=news,
        )
        _write_text(args.html, page)

    if not args.quiet and not json_to_stdout and not csv_to_stdout:
        print(
            render_terminal(
                result,
                universe,
                criteria,
                sort_by=args.sort,
                limit=args.top,
                color=False if args.no_color else None,
                news=news,
            )
        )

    if args.html is not None:
        print(f"HTML-rapport skrevet til {args.html}", file=sys.stderr)
    if args.json is not None and not json_to_stdout:
        print(f"JSON skrevet til {args.json}", file=sys.stderr)
    if args.csv is not None and not csv_to_stdout:
        print(f"CSV skrevet til {args.csv}", file=sys.stderr)

    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="screener.py",
        description=(
            "Går gjennom aksjene på Oslo Børs og lister opp de som har positiv "
            "trend siste uke, men som ikke er på all-time high."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Eksempler:\n"
            "  python screener.py\n"
            "  python screener.py --min-week 2 --top 0\n"
            "  python screener.py --no-sma5 --ath-margin 2\n"
            "  python screener.py --html rapport.html\n"
        ),
    )
    add_common_arguments(parser)
    output = parser.add_argument_group("utdata")
    output.add_argument(
        "--top",
        type=int,
        default=40,
        metavar="N",
        help="maks antall rader i terminalen, 0 = alle (standard: 40)",
    )
    output.add_argument(
        "--json",
        nargs="?",
        const="-",
        metavar="FIL",
        help="skriv JSON til FIL, eller til stdout uten FIL",
    )
    output.add_argument(
        "--csv",
        nargs="?",
        const="-",
        metavar="FIL",
        help="skriv CSV til FIL, eller til stdout uten FIL",
    )
    output.add_argument(
        "--html",
        nargs="?",
        const="oslo_screen.html",
        metavar="FIL",
        help="skriv en selvstendig HTML-dashboard til FIL (standard: oslo_screen.html)",
    )
    output.add_argument("--no-color", action="store_true", help="slå av farger i terminalen")
    output.add_argument("--quiet", action="store_true", help="ikke skriv tabell til terminalen")
    output.add_argument(
        "--loop",
        type=float,
        default=0.0,
        metavar="SEK",
        help="kjør på nytt hvert N-te sekund (0 = én gang)",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.json == "-" and args.csv == "-":
        parser.error("--json og --csv kan ikke begge skrive til stdout")

    first = True
    try:
        while True:
            if not first and not args.quiet and sys.stdout.isatty():
                print("\033[2J\033[H", end="")
            code = run_once(args, force=args.refresh or not first)
            first = False
            if args.loop <= 0:
                return code
            time.sleep(args.loop)
    except DataSourceError as exc:
        print(f"Feil: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("\nAvbrutt.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
