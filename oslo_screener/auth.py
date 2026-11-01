"""Enkel, selvstendig passordbeskyttelse for sky- og fjernkjøring.

Appen er laget for å kjøre lokalt uten innlogging. Når den publiseres på
internett, må den beskyttes. Denne modulen gir én delt passordinnlogging med
signerte, stateless sesjonskaker og en liten sperre mot passordgjetting.

Ingen passord eller sesjoner lagres på disk. Passordet kommer fra miljøvariabelen
``TP_PASSWORD`` eller ``--auth-password``, og hemmeligheten fra ``TP_SECRET``
eller ``--auth-secret``.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import threading
import time
from dataclasses import dataclass, field
from http.cookies import CookieError, SimpleCookie
from typing import Optional

COOKIE_NAME = "tp_session"
DEFAULT_SESSION_TTL = 60 * 60 * 24 * 14  # 14 dager
PUBLIC_PATHS = {
    "/login",
    "/logout",
    "/healthz",
    "/manifest.webmanifest",
    "/sw.js",
    "/offline",
    "/favicon.ico",
}
PUBLIC_PREFIXES = ("/icons/",)


def is_public_path(path: str) -> bool:
    return path in PUBLIC_PATHS or path.startswith(PUBLIC_PREFIXES)


@dataclass(frozen=True)
class AuthConfig:
    """Passord og signeringsnøkkel for innlogging."""

    password: str
    secret: str
    cookie_secure: bool = False
    session_ttl: int = DEFAULT_SESSION_TTL

    def __post_init__(self) -> None:
        if not self.password:
            raise ValueError("passordet kan ikke være tomt")
        if not self.secret:
            raise ValueError("hemmeligheten kan ikke være tom")
        if self.session_ttl < 60:
            raise ValueError("sesjonens levetid må være minst 60 sekunder")

    def verify_password(self, candidate: str) -> bool:
        return hmac.compare_digest(
            self.password.encode("utf-8"),
            str(candidate or "").encode("utf-8"),
        )

    def issue_token(self, now: Optional[float] = None) -> str:
        timestamp = int(time.time() if now is None else now)
        payload = f"{timestamp}".encode("ascii")
        signature = hmac.new(
            self.secret.encode("utf-8"),
            payload,
            hashlib.sha256,
        ).digest()
        return base64.urlsafe_b64encode(payload + b"." + signature).decode(
            "ascii"
        ).rstrip("=")

    def verify_token(self, token: str, now: Optional[float] = None) -> bool:
        if not token:
            return False
        try:
            raw = base64.urlsafe_b64decode(
                token + "=" * (-len(token) % 4)
            )
            payload, signature = raw.split(b".", 1)
            timestamp = int(payload.decode("ascii"))
        except (ValueError, UnicodeDecodeError):
            return False
        expected = hmac.new(
            self.secret.encode("utf-8"),
            payload,
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(signature, expected):
            return False
        current = int(time.time() if now is None else now)
        if timestamp > current + 300:
            return False
        return current <= timestamp + self.session_ttl


def session_cookie(token: str, *, secure: bool, ttl: int) -> str:
    parts = [
        f"{COOKIE_NAME}={token}",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        f"Max-Age={ttl}",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def clear_session_cookie(*, secure: bool) -> str:
    parts = [
        f"{COOKIE_NAME}=",
        "Path=/",
        "HttpOnly",
        "SameSite=Lax",
        "Max-Age=0",
    ]
    if secure:
        parts.append("Secure")
    return "; ".join(parts)


def read_session_cookie(cookie_header: str) -> Optional[str]:
    if not cookie_header:
        return None
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header)
    except CookieError:
        return None
    morsel = cookie.get(COOKIE_NAME)
    return morsel.value if morsel is not None else None


@dataclass
class LoginLimiter:
    """Enkel minnesbasert sperre mot gjentatte passordforsøk per IP."""

    max_attempts: int = 8
    window_seconds: int = 10 * 60
    _failures: dict[str, list[float]] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def _recent(self, key: str, now: float) -> list[float]:
        cutoff = now - self.window_seconds
        recent = [stamp for stamp in self._failures.get(key, []) if stamp >= cutoff]
        if recent:
            self._failures[key] = recent
        else:
            self._failures.pop(key, None)
        return recent

    def blocked(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            return len(self._recent(key, now)) >= self.max_attempts

    def fail(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            recent = self._recent(key, now)
            recent.append(now)
            self._failures[key] = recent

    def reset(self, key: str) -> None:
        with self._lock:
            self._failures.pop(key, None)
