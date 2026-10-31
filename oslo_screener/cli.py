"""Felles kommandolinjeargumenter for CLI og webserver."""

from __future__ import annotations

import argparse
from dataclasses import replace

from .config import Settings, load_settings, validate_settings
from .logic import SORT_FIELDS, Criteria


def add_common_arguments(parser: argparse.ArgumentParser) -> None:
    group = parser.add_argument_group("screen-kriterier")
    group.add_argument(
        "--min-week",
        type=float,
        default=0.0,
        metavar="PCT",
        help="minste ukeavkastning i prosent (standard: 0, dvs. positiv)",
    )
    group.add_argument(
        "--ath-margin",
        type=float,
        default=1.0,
        metavar="PCT",
        help="hvor nær all-time high en aksje kan være og fortsatt regnes som «på ATH» (standard: 1)",
    )
    group.add_argument(
        "--no-sma5",
        action="store_true",
        help="ikke krev at kursen er over 5-dagers glidende gjennomsnitt",
    )
    group.add_argument(
        "--sma20",
        action="store_true",
        help="krev også at kursen er over 20-dagers glidende gjennomsnitt",
    )
    group.add_argument(
        "--min-cap",
        type=float,
        default=0.0,
        metavar="MRD",
        help="minste markedsverdi i milliarder kroner",
    )
    group.add_argument(
        "--min-turnover",
        type=float,
        default=0.0,
        metavar="MILL",
        help="minste omsatte verdi i millioner kroner",
    )
    group.add_argument(
        "--allow-unknown-ath",
        action="store_true",
        help="ta med aksjer der all-time high ikke kan fastslås",
    )
    group.add_argument(
        "--exclude-ath",
        action="store_true",
        help="utelat aksjer som er på/ved all-time high (de merkes ellers med ATH)",
    )
    group.add_argument(
        "--only-stocks",
        action="store_true",
        help="utelat depotsertifikater (DR)",
    )
    group.add_argument(
        "--include-growth",
        action="store_true",
        help=(
            "ta med aksjer på Euronext Growth; de er skjult som standard fordi "
            "de normalt ikke kan holdes på ASK"
        ),
    )
    group.add_argument(
        "--sort",
        choices=SORT_FIELDS,
        default="week",
        help="sortering av treffene (standard: week)",
    )

    data = parser.add_argument_group("data")
    data.add_argument("--refresh", action="store_true", help="hent nye data, ignorer cache")
    data.add_argument(
        "--cache-ttl",
        type=int,
        default=600,
        metavar="SEK",
        help="hvor lenge cache skal brukes, i sekunder (standard: 600)",
    )
    data.add_argument(
        "--timeout",
        type=float,
        default=30.0,
        metavar="SEK",
        help="HTTP-timeout mot TradingView (standard: 30)",
    )
    data.add_argument(
        "--no-news",
        action="store_true",
        help="ikke hent børsmeldinger fra Oslo Børs NewsWeb",
    )

    premarket = parser.add_argument_group("pre-market og risiko")
    premarket.add_argument(
        "--config",
        metavar="FIL",
        help="JSON-fil med vekter, kapital, kurtasje og rapportterskler",
    )
    premarket.add_argument(
        "--capital",
        type=float,
        metavar="NOK",
        help="startkapital i kroner (standard: 5000)",
    )
    premarket.add_argument(
        "--buy-fee",
        type=float,
        metavar="NOK",
        help="kurtasje ved kjøp (standard: 29)",
    )
    premarket.add_argument(
        "--sell-fee",
        type=float,
        metavar="NOK",
        help="kurtasje ved salg (standard: 29)",
    )
    premarket.add_argument(
        "--target",
        type=float,
        metavar="PCT",
        help="første gevinstmål i prosent (standard: 2)",
    )
    premarket.add_argument(
        "--stop-loss",
        type=float,
        metavar="PCT",
        help="tapsgrense i prosent (standard: 2)",
    )
    premarket.add_argument(
        "--slippage",
        type=float,
        metavar="PCT",
        help="antatt slippage/spread i prosent (standard: 0)",
    )
    premarket.add_argument(
        "--min-score",
        type=float,
        metavar="POENG",
        help="minste samlede score for hovedanbefaling (standard: 58)",
    )
    premarket.add_argument(
        "--max-risk",
        type=float,
        metavar="POENG",
        help="høyeste risikoscore for hovedanbefaling (standard: 58)",
    )
    premarket.add_argument(
        "--min-opportunity",
        type=float,
        metavar="POENG",
        help="minste mulighetsscore for hovedanbefaling (standard: 55)",
    )
    premarket.add_argument(
        "--max-alternatives",
        type=int,
        metavar="ANTALL",
        help="maks antall alternativer i rapporten (standard: 10)",
    )
    premarket.add_argument(
        "--no-save-report",
        action="store_true",
        help="ikke lagre morgenrapporten i reports/premarket",
    )


def criteria_from_args(args: argparse.Namespace) -> Criteria:
    types = ("stock",) if args.only_stocks else ("stock", "dr")
    return Criteria(
        min_week_return=args.min_week / 100.0,
        ath_margin=max(0.0, args.ath_margin) / 100.0,
        require_above_sma5=not args.no_sma5,
        require_above_sma20=args.sma20,
        min_market_cap=max(0.0, args.min_cap) * 1e9,
        min_turnover=max(0.0, args.min_turnover) * 1e6,
        include_types=types,
        allow_unknown_ath=args.allow_unknown_ath,
        include_at_high=not args.exclude_ath,
        exclude_growth=not args.include_growth,
    )


def settings_from_args(args: argparse.Namespace) -> Settings:
    """Les konfigurasjon og la enkle CLI-flagg overstyre standardverdiene."""
    base = load_settings(getattr(args, "config", None))
    trade = base.trade
    report = base.report
    overrides = {
        "capital": getattr(args, "capital", None),
        "buy_fee": getattr(args, "buy_fee", None),
        "sell_fee": getattr(args, "sell_fee", None),
        "slippage_pct": (
            getattr(args, "slippage", None) / 100.0
            if getattr(args, "slippage", None) is not None
            else None
        ),
        "target_pct": (
            getattr(args, "target", None) / 100.0
            if getattr(args, "target", None) is not None
            else None
        ),
        "stop_loss_pct": (
            getattr(args, "stop_loss", None) / 100.0
            if getattr(args, "stop_loss", None) is not None
            else None
        ),
    }
    trade = replace(
        trade,
        **{name: value for name, value in overrides.items() if value is not None},
    )
    report_overrides = {
        "min_total_score": getattr(args, "min_score", None),
        "max_risk": getattr(args, "max_risk", None),
        "min_opportunity": getattr(args, "min_opportunity", None),
        "max_alternatives": getattr(args, "max_alternatives", None),
    }
    report = replace(
        report,
        **{
            name: value
            for name, value in report_overrides.items()
            if value is not None
        },
    )
    result = replace(base, trade=trade, report=report)
    validate_settings(result)
    return result
