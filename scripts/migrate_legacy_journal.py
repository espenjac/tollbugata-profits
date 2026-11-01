#!/usr/bin/env python3
"""One-time import of the legacy Python journal into Supabase.

This script uses the Supabase REST API with the service role key. It never runs
inside the browser and the key must not be committed.

Required environment variables:
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
    OWNER_EMAIL

Optional:
    LEGACY_JOURNAL_PATH  (default: data/journal.json)
    STARTING_CASH        (default: 5000)
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

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_JOURNAL = ROOT / "data" / "journal.json"


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Mangler miljøvariabelen {name}.")
    return value


SUPABASE_URL = require_env("SUPABASE_URL").rstrip("/")
SERVICE_KEY = require_env("SUPABASE_SERVICE_ROLE_KEY")
OWNER_EMAIL = require_env("OWNER_EMAIL").strip().lower()
STARTING_CASH = float(os.environ.get("STARTING_CASH", "5000"))
JOURNAL_PATH = pathlib.Path(os.environ.get("LEGACY_JOURNAL_PATH", DEFAULT_JOURNAL))


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


def ensure_account(user_id: str) -> None:
    query = f"accounts?user_id=eq.{urllib.parse.quote(user_id)}&select=starting_cash"
    rows = request("GET", query)
    if isinstance(rows, list) and rows:
        print(f"Konto finnes allerede (startkapital {rows[0]['starting_cash']}).")
        return
    request(
        "POST",
        "accounts",
        {"user_id": user_id, "starting_cash": STARTING_CASH},
        prefer="return=minimal",
    )
    print(f"Opprettet konto med startkapital {STARTING_CASH:.2f} kr.")


def import_trades(user_id: str, trades: list[dict]) -> None:
    query = (
        "trades?user_id=eq."
        f"{urllib.parse.quote(user_id)}"
        "&select=executed_at,ticker,side,quantity,price,fee,note"
    )
    existing_rows = request("GET", query)
    if not isinstance(existing_rows, list):
        raise SystemExit("Uventet svar fra trades.")

    def utc_stamp(value: object) -> str:
        if not value:
            return ""
        try:
            parsed = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=dt.timezone.utc)
            return parsed.astimezone(dt.timezone.utc).isoformat()[:19]
        except ValueError:
            return str(value)[:19]

    def key(row: dict) -> tuple:
        return (
            utc_stamp(row.get("executed_at")),
            str(row.get("ticker") or "").upper(),
            str(row.get("side") or ""),
            int(row.get("quantity") or 0),
            round(float(row.get("price") or 0), 4),
            round(float(row.get("fee") or 0), 2),
            str(row.get("note") or ""),
        )

    existing = {key(row) for row in existing_rows}
    imported = 0
    for trade in sorted(trades, key=lambda item: item.get("executed_at", "")):
        registered_at = (
            trade.get("registered_at")
            or trade.get("executed_at")
            or dt.datetime.now(dt.timezone.utc).isoformat()
        )
        row = {
            "user_id": user_id,
            "executed_at": trade["executed_at"],
            "ticker": str(trade["ticker"]).upper(),
            "side": trade["side"],
            "quantity": int(trade["quantity"]),
            "price": float(trade["price"]),
            "fee": float(trade.get("fee") or 0),
            "note": str(trade.get("note") or ""),
            "created_at": registered_at,
            "updated_at": trade.get("edited_at") or registered_at,
        }
        if key(row) in existing:
            continue
        request("POST", "trades", row, prefer="return=minimal")
        existing.add(key(row))
        imported += 1
        print(
            f"Importerte {row['side']} {row['quantity']} {row['ticker']} "
            f"@ {row['price']:.2f} ({row['executed_at']})."
        )
    print(f"Importerte {imported} nye handler; {len(existing_rows)} fantes fra før.")


def main() -> int:
    if not JOURNAL_PATH.exists():
        raise SystemExit(f"Fant ikke {JOURNAL_PATH}.")
    data = json.loads(JOURNAL_PATH.read_text(encoding="utf-8"))
    trades = data.get("trades")
    if not isinstance(trades, list):
        raise SystemExit("journal.json mangler en trades-liste.")

    user_id = find_owner()
    print(f"Bruker: {user_id}")
    ensure_account(user_id)
    import_trades(user_id, trades)
    print("Ferdig. Kontroller saldoen i /logg etter importen.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
