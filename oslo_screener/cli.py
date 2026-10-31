"""Felles kommandolinjeargumenter for CLI og webserver."""

from __future__ import annotations

import argparse

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
