#!/usr/bin/env python3
"""One-time import of legacy Python pre-market reports into Supabase.

The V2 report payload is camelCase and uses decimal ratios where the Python
report used percentages. This script converts the archived JSON files under
reports/premarket/ and inserts them as immutable reports.

Required environment variables:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
    OWNER_EMAIL

Optional:
    LEGACY_REPORTS_DIR  (default: reports/premarket)
"""

from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_REPORTS_DIR = ROOT / "reports" / "premarket"
OSLO = ZoneInfo("Europe/Oslo")

DEFAULT_SCORING = {
    "minPrice": 5.0,
    "minMarketCap": 300_000_000.0,
    "minAverageTurnover": 5_000_000.0,
    "maxWeekReturn": 0.25,
    "maxRsi": 82.0,
    "targetAtrPct": 0.025,
    "breakoutDistance": 0.05,
    "overextendedWeek": 0.15,
    "overextendedRsi": 75.0,
    "smoothDayReturn": 0.02,
    "smoothDayShare": 0.4,
    "spikeDayReturn": 0.04,
    "spikeDayShare": 0.6,
    "strongSpikeDayReturn": 0.07,
    "spikeSma5Distance": 0.05,
    "riskPenalty": 0.45,
    "weights": {
        "momentum": 0.16,
        "trend": 0.14,
        "relativeStrength": 0.09,
        "liquidity": 0.15,
        "volume": 0.09,
        "technicalUpside": 0.08,
        "volatility": 0.05,
        "news": 0.11,
        "breakout": 0.05,
        "consistency": 0.08,
    },
    "riskWeights": {
        "volatility": 0.18,
        "overextension": 0.18,
        "spike": 0.12,
        "liquidity": 0.14,
        "event": 0.14,
        "negativeNews": 0.14,
        "marketCap": 0.05,
        "price": 0.05,
    },
}

DEFAULT_TRADE = {
    "capital": 5000.0,
    "buyFee": 29.0,
    "sellFee": 29.0,
    "targetPct": 0.05,
    "stopLossPct": 0.02,
    "slippagePct": 0.0,
    "minRewardRisk": 1.0,
    "scenarioPcts": [-0.02, -0.01, 0.01, 0.02, 0.03, 0.04, 0.05],
}

DEFAULT_REPORT = {
    "maxAlternatives": 10,
    "minTotalScore": 58.0,
    "minOpportunity": 55.0,
    "maxRisk": 58.0,
    "minTurnover": 10_000_000.0,
    "blockNegativeNews": True,
    "blockEarningsWithinDays": 1,
    "blockExDateWithinDays": 0,
}


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Mangler miljøvariabelen {name}.")
    return value


SUPABASE_URL = require_env("SUPABASE_URL").rstrip("/")
SERVICE_KEY = require_env("SUPABASE_SERVICE_ROLE_KEY")
OWNER_EMAIL = require_env("OWNER_EMAIL").strip().lower()
REPORTS_DIR = pathlib.Path(
    os.environ.get("LEGACY_REPORTS_DIR", DEFAULT_REPORTS_DIR)
)


def request(
    method: str,
    path: str,
    payload: object | None = None,
    prefer: str | None = None,
) -> object:
    data = None
    headers = {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Accept": "application/json",
    }
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Supabase svarte {error.code}: {body}") from error


def find_owner() -> str:
    profiles = request("GET", "profiles?select=id,email")
    if not isinstance(profiles, list):
        raise SystemExit("Uventet svar fra profiles.")
    for profile in profiles:
        if str(profile.get("email", "")).strip().lower() == OWNER_EMAIL:
            return str(profile["id"])
    raise SystemExit(
        f"Fant ingen profil for {OWNER_EMAIL}. Logg inn i den nye appen først."
    )


def ratio(value: object) -> float | None:
    if value is None:
        return None
    return float(value) / 100.0


def category_breakout(value: object) -> str:
    text = str(value or "")
    return text if text in {"mulig", "ikke nær", "overstrukket"} else "ikke nær"


def stock_from_legacy(item: dict) -> dict:
    market = str(item.get("market") or "")
    if market not in {"oslo", "euronext_growth"}:
        market = "euronext_growth" if item.get("is_growth") else "oslo"
    return {
        "ticker": str(item.get("ticker") or ""),
        "name": str(item.get("name") or ""),
        "close": float(item.get("price") or 0),
        "currency": str(item.get("currency") or "NOK"),
        "weekReturn": ratio(item.get("week_return_pct")),
        "monthReturn": ratio(item.get("month_return_pct")),
        "quarterReturn": ratio(item.get("quarter_return_pct")),
        "sma5": item.get("sma5"),
        "sma20": item.get("sma20"),
        "sma50": None,
        "rsi": item.get("rsi"),
        "ath": item.get("ath"),
        "high52w": item.get("high_52w"),
        "marketCap": item.get("market_cap"),
        "volume": item.get("volume"),
        "sector": str(item.get("sector") or "ukjent"),
        "instrumentType": "stock",
        "market": market,
        "earningsDate": item.get("earnings_date"),
        "exDividendDate": item.get("ex_dividend_date"),
        "averageVolume10d": item.get("average_volume_10d"),
        "atr": item.get("atr"),
        "dayReturn": ratio(item.get("day_return_pct")),
    }


def candidate_from_legacy(item: dict) -> dict:
    signal = item.get("news_signal") or {}
    return {
        "stock": stock_from_legacy(item),
        "score": float(item.get("score") or 0),
        "reasons": list(item.get("reasons") or []),
        "warnings": list(item.get("warnings") or []),
        "opportunityScore": float(item.get("opportunity_score") or 0),
        "riskScore": float(item.get("risk_score") or 0),
        "categories": list(item.get("categories") or []),
        "newsSignal": {
            "sentiment": str(signal.get("sentiment") or "neutral"),
            "relevance": str(signal.get("relevance") or "low"),
            "eventType": str(signal.get("event_type") or "other"),
            "count": int(signal.get("count") or 0),
            "latestTitle": str(signal.get("latest_title") or ""),
        },
        "breakoutStatus": category_breakout(item.get("breakout_status")),
        "technicalUpside": ratio(item.get("technical_upside_pct")),
        "resistance": item.get("resistance"),
        "support": item.get("support"),
        "volumeRatio": item.get("volume_ratio"),
    }


def trade_from_legacy(item: dict) -> dict:
    return {
        "capital": float(item.get("capital") or 0),
        "buyFee": float(item.get("buy_fee") or 0),
        "sellFee": float(item.get("sell_fee") or 0),
        "entryPrice": float(item.get("entry_price") or 0),
        "shares": int(item.get("shares") or 0),
        "invested": float(item.get("invested") or 0),
        "cashLeft": float(item.get("cash_left") or 0),
        "totalCost": float(item.get("total_cost") or 0),
        "targetPrice": float(item.get("target_price") or 0),
        "targetNet": float(item.get("target_net") or 0),
        "targetReturnPct": float(item.get("target_return_pct") or 0),
        "stopPrice": float(item.get("stop_price") or 0),
        "stopNet": float(item.get("stop_net") or 0),
        "stopReturnPct": float(item.get("stop_return_pct") or 0),
        "rewardRisk": item.get("reward_risk"),
        "feasible": bool(item.get("feasible")),
        "scenarios": [
            {
                "changePct": float(scenario.get("change_pct") or 0) / 100.0,
                "exitPrice": float(scenario.get("exit_price") or 0),
                "grossProfit": float(scenario.get("gross_profit") or 0),
                "netProfit": float(scenario.get("net_profit") or 0),
                "netReturnPct": float(scenario.get("net_return_pct") or 0),
            }
            for scenario in item.get("scenarios") or []
        ],
    }


def planned_from_legacy(item: dict) -> dict:
    return {
        "candidate": candidate_from_legacy(item),
        "trade": trade_from_legacy(item.get("trade") or {}),
        "recommendable": bool(item.get("recommendable")),
        "blockReasons": list(item.get("block_reasons") or []),
    }


def settings_from_legacy(settings: dict) -> dict:
    scoring = settings.get("scoring") or {}
    trade = settings.get("trade") or {}
    report = settings.get("report") or {}
    old_weights = scoring.get("weights") or {}
    scoring_weights = {
        **DEFAULT_SCORING["weights"],
        "momentum": old_weights.get("momentum", DEFAULT_SCORING["weights"]["momentum"]),
        "trend": old_weights.get("trend", DEFAULT_SCORING["weights"]["trend"]),
        "relativeStrength": old_weights.get(
            "relative_strength", DEFAULT_SCORING["weights"]["relativeStrength"]
        ),
        "liquidity": old_weights.get("liquidity", DEFAULT_SCORING["weights"]["liquidity"]),
        "volume": old_weights.get("volume", DEFAULT_SCORING["weights"]["volume"]),
        "technicalUpside": old_weights.get(
            "technical_upside", DEFAULT_SCORING["weights"]["technicalUpside"]
        ),
        "volatility": old_weights.get("volatility", DEFAULT_SCORING["weights"]["volatility"]),
        "news": old_weights.get("news", DEFAULT_SCORING["weights"]["news"]),
        "breakout": old_weights.get("breakout", DEFAULT_SCORING["weights"]["breakout"]),
        "consistency": old_weights.get("consistency", 0),
    }
    old_risk = scoring.get("risk_weights") or {}
    risk_weights = {
        "volatility": old_risk.get(
            "volatility", DEFAULT_SCORING["riskWeights"]["volatility"]
        ),
        "overextension": old_risk.get(
            "overextension", DEFAULT_SCORING["riskWeights"]["overextension"]
        ),
        "spike": old_risk.get("spike", DEFAULT_SCORING["riskWeights"]["spike"]),
        "liquidity": old_risk.get(
            "liquidity", DEFAULT_SCORING["riskWeights"]["liquidity"]
        ),
        "event": old_risk.get("event", DEFAULT_SCORING["riskWeights"]["event"]),
        "negativeNews": old_risk.get(
            "negative_news", DEFAULT_SCORING["riskWeights"]["negativeNews"]
        ),
        "marketCap": old_risk.get(
            "market_cap", DEFAULT_SCORING["riskWeights"]["marketCap"]
        ),
        "price": old_risk.get("price", DEFAULT_SCORING["riskWeights"]["price"]),
    }
    scoring_out = {
        **DEFAULT_SCORING,
        "minPrice": scoring.get("min_price", DEFAULT_SCORING["minPrice"]),
        "minMarketCap": scoring.get(
            "min_market_cap", DEFAULT_SCORING["minMarketCap"]
        ),
        "minAverageTurnover": scoring.get(
            "min_average_turnover", DEFAULT_SCORING["minAverageTurnover"]
        ),
        "maxWeekReturn": scoring.get(
            "max_week_return", DEFAULT_SCORING["maxWeekReturn"]
        ),
        "maxRsi": scoring.get("max_rsi", DEFAULT_SCORING["maxRsi"]),
        "targetAtrPct": scoring.get(
            "target_atr_pct", DEFAULT_SCORING["targetAtrPct"]
        ),
        "breakoutDistance": scoring.get(
            "breakout_distance", DEFAULT_SCORING["breakoutDistance"]
        ),
        "overextendedWeek": scoring.get(
            "overextended_week", DEFAULT_SCORING["overextendedWeek"]
        ),
        "overextendedRsi": scoring.get(
            "overextended_rsi", DEFAULT_SCORING["overextendedRsi"]
        ),
        "riskPenalty": scoring.get(
            "risk_penalty", DEFAULT_SCORING["riskPenalty"]
        ),
        "weights": scoring_weights,
        "riskWeights": risk_weights,
    }
    trade_out = {
        **DEFAULT_TRADE,
        "capital": trade.get("capital", DEFAULT_TRADE["capital"]),
        "buyFee": trade.get("buy_fee", DEFAULT_TRADE["buyFee"]),
        "sellFee": trade.get("sell_fee", DEFAULT_TRADE["sellFee"]),
        "targetPct": trade.get("target_pct", DEFAULT_TRADE["targetPct"]),
        "stopLossPct": trade.get(
            "stop_loss_pct", DEFAULT_TRADE["stopLossPct"]
        ),
        "slippagePct": trade.get("slippage_pct", DEFAULT_TRADE["slippagePct"]),
        "minRewardRisk": trade.get(
            "min_reward_risk", DEFAULT_TRADE["minRewardRisk"]
        ),
        "scenarioPcts": trade.get(
            "scenario_pcts", DEFAULT_TRADE["scenarioPcts"]
        ),
    }
    report_out = {
        **DEFAULT_REPORT,
        "maxAlternatives": report.get(
            "max_alternatives", DEFAULT_REPORT["maxAlternatives"]
        ),
        "minTotalScore": report.get(
            "min_total_score", DEFAULT_REPORT["minTotalScore"]
        ),
        "minOpportunity": report.get(
            "min_opportunity", DEFAULT_REPORT["minOpportunity"]
        ),
        "maxRisk": report.get("max_risk", DEFAULT_REPORT["maxRisk"]),
        "minTurnover": report.get(
            "min_turnover", DEFAULT_REPORT["minTurnover"]
        ),
        "blockNegativeNews": report.get(
            "block_negative_news", DEFAULT_REPORT["blockNegativeNews"]
        ),
        "blockEarningsWithinDays": report.get(
            "block_earnings_within_days",
            DEFAULT_REPORT["blockEarningsWithinDays"],
        ),
        "blockExDateWithinDays": report.get(
            "block_ex_date_within_days", DEFAULT_REPORT["blockExDateWithinDays"]
        ),
    }
    return {"scoring": scoring_out, "trade": trade_out, "report": report_out}


def report_payload(raw: dict) -> dict:
    main = planned_from_legacy(raw["main"]) if raw.get("main") else None
    alternatives = [
        planned_from_legacy(item) for item in raw.get("alternatives") or []
    ]
    blocked = [planned_from_legacy(item) for item in raw.get("blocked") or []]
    planned_by_ticker = {
        item["candidate"]["stock"]["ticker"]: item
        for item in ([main] if main else []) + alternatives + blocked
    }
    ranked = [
        planned_by_ticker[item["ticker"]]
        for item in raw.get("top_candidates") or []
        if item.get("ticker") in planned_by_ticker
    ]
    criteria = raw.get("criteria") or {}
    return {
        "generatedAt": raw["generated_at"],
        "universeFetchedAt": raw.get("universe_fetched_at")
        or raw["generated_at"],
        "universeSource": str(raw.get("source") or "ukjent"),
        "criteria": {
            "minWeekReturn": criteria.get("min_week_return", 0),
            "athMargin": criteria.get("ath_margin", 0.01),
            "requireAboveSma5": bool(criteria.get("require_above_sma5")),
            "requireAboveSma20": bool(criteria.get("require_above_sma20")),
            "minMarketCap": criteria.get("min_market_cap", 0),
            "minTurnover": criteria.get("min_turnover", 0),
            "includeTypes": list(criteria.get("include_types") or []),
            "allowUnknownAth": bool(criteria.get("allow_unknown_ath")),
            "includeAtHigh": bool(criteria.get("include_at_high")),
            "excludeGrowth": bool(criteria.get("exclude_growth")),
        },
        "settings": settings_from_legacy(raw.get("settings") or {}),
        "ranked": ranked,
        "main": main,
        "alternatives": alternatives,
        "blocked": blocked,
        "noTradeReason": raw.get("no_trade_reason"),
        "newsSince": raw.get("news_since"),
        "newsSource": raw.get("news_source"),
        "dataBasis": str(raw.get("data_basis") or ""),
        "isPremarket": bool(raw.get("is_premarket")),
        "warnings": list(raw.get("warnings") or []),
    }


def import_report(user_id: str, path: pathlib.Path) -> None:
    raw = json.loads(path.read_text(encoding="utf-8"))
    generated_at = dt.datetime.fromisoformat(
        str(raw["generated_at"]).replace("Z", "+00:00")
    )
    report_date = generated_at.astimezone(OSLO).date().isoformat()
    query = (
        "reports?user_id=eq."
        f"{urllib.parse.quote(user_id)}&report_date=eq.{report_date}&select=id"
    )
    existing = request("GET", query)
    if isinstance(existing, list) and existing:
        print(f"Rapport {report_date} finnes allerede; hopper over {path.name}.")
        return
    payload = report_payload(raw)
    main = payload.get("main")
    request(
        "POST",
        "reports",
        {
            "user_id": user_id,
            "report_date": report_date,
            "generated_at": generated_at.isoformat(),
            "main_ticker": (
                main["candidate"]["stock"]["ticker"] if main else None
            ),
            "main_score": main["candidate"]["score"] if main else None,
            "no_trade": main is None,
            "payload": payload,
        },
        prefer="return=minimal",
    )
    print(f"Importerte rapport {report_date} fra {path.name}.")


def main() -> int:
    if not REPORTS_DIR.exists():
        raise SystemExit(f"Fant ikke {REPORTS_DIR}.")
    files = sorted(REPORTS_DIR.glob("*.json"))
    if not files:
        raise SystemExit(f"Fant ingen JSON-rapporter i {REPORTS_DIR}.")
    user_id = find_owner()
    print(f"Bruker: {user_id}")
    for path in files:
        import_report(user_id, path)
    print("Ferdig. Rapporthistorikken vises i den nye appen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
