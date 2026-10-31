#!/usr/bin/env python3
"""Historisk test av pre-market-rangeringen på daglige OHLCV-data.

Eksempel:
    python backtest.py --csv historiske_daglige_data.csv \
        --from 2025-01-01 --to 2025-12-31 --output reports/backtest_latest.json

CSV-filen må ha kolonnene date,ticker,open,high,low,close,volume. Valgfrie
kolonner: name,sector,market_cap,spread_pct,market,news_sentiment,
news_relevance,news_event. Testen er konservativ når både gevinstmål og
tapsgrense blir truffet samme dag.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path
from typing import Optional

from oslo_screener.backtest import DEFAULT_TARGETS, load_bars, run_backtest
from oslo_screener.cli import add_common_arguments, settings_from_args
from oslo_screener.formatting import format_money


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            f"Ugyldig dato {value!r}; bruk ÅÅÅÅ-MM-DD."
        ) from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="backtest.py",
        description="Test pre-market-rangeringen på historiske daglige OHLCV-data.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Eksempel:\n"
            "  python backtest.py --csv data/history.csv --from 2025-01-01 "
            "--to 2025-12-31\n"
        ),
    )
    add_common_arguments(parser)
    parser.add_argument("--csv", required=True, metavar="FIL", help="historisk OHLCV-CSV")
    parser.add_argument("--from", dest="start", type=_parse_date, metavar="DATO")
    parser.add_argument("--to", dest="end", type=_parse_date, metavar="DATO")
    parser.add_argument(
        "--targets",
        metavar="PCT",
        help="kommaseparerte gevinstmål i prosent (standard: 1,2,3,5; 2 tas alltid med)",
    )
    parser.add_argument(
        "--output",
        default="reports/backtest_latest.json",
        metavar="FIL",
        help="skriv JSON-resultat til FIL (standard: reports/backtest_latest.json)",
    )
    return parser


def _targets(value: Optional[str]) -> tuple[float, ...]:
    if not value:
        return DEFAULT_TARGETS
    try:
        return tuple(float(item.strip().replace(",", ".")) / 100.0 for item in value.split(","))
    except ValueError as exc:
        raise ValueError("--targets må være kommaseparerte tall i prosent.") from exc


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        settings = settings_from_args(args)
        bars = load_bars(args.csv)
        result = run_backtest(
            bars,
            settings=settings,
            start=args.start,
            end=args.end,
            targets=_targets(args.targets),
        )
    except (OSError, ValueError) as exc:
        print(f"Feil: {exc}", file=sys.stderr)
        return 1

    output = Path(args.output)
    result.write(output)
    print(f"Backtest {result.from_date}–{result.to_date}: {len(result.trades)} enkelttester")
    print("Utvalg                 Handler  +2 % treff  Stop  Gevinst  Snitt netto  Sum netto")
    for label, data in (
        ("Hovedkandidat (topp 1)", result.top1),
        ("Topp 5", result.top5),
        ("Momentum", result.by_category.get("momentum", {})),
        ("Breakout", result.by_category.get("breakout", {})),
        ("Nyhetsdrevet", result.by_category.get("news", {})),
    ):
        print(
            f"{label:<22} {data.get('trades', 0):>7} "
            f"{data.get('hit_rate_pct', 0):>10.1f} % "
            f"{data.get('stop_rate_pct', 0):>5.1f} % "
            f"{data.get('win_rate_pct', 0):>7.1f} % "
            f"{format_money(data.get('avg_net_profit'), signed=True):>12} "
            f"{format_money(data.get('total_net_profit'), signed=True):>12}"
        )
    print(f"Resultat skrevet til {output}")
    print("Treff per gevinstmål")
    for label, data in result.target_summaries.items():
        print(
            f"  Mål {label:<8} {data.get('trades', 0):>6} handler  "
            f"{data.get('hit_rate_pct', 0):>5.1f} % treff  "
            f"{data.get('stop_rate_pct', 0):>5.1f} % stop  "
            f"snitt {format_money(data.get('avg_net_profit'), signed=True)}  "
            f"sum {format_money(data.get('total_net_profit'), signed=True)}"
        )
    print("Forbehold: daglige data kan ikke avgjøre om mål eller stop ble nådd først;")
    print("ved begge treff antas stop først. Nyhetskategorien krever historiske nyhetssignaler.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
