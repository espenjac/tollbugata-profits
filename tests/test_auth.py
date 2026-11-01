"""Tester for passordbeskyttelse og fjernkjøring."""

from __future__ import annotations

import tempfile
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path
from urllib.parse import urlencode

from app import ScreenerHTTPServer
from oslo_screener.auth import (
    AuthConfig,
    LoginLimiter,
    clear_session_cookie,
    read_session_cookie,
    session_cookie,
)
from oslo_screener.config import Settings
from oslo_screener.logic import Criteria
from oslo_screener.render import render_login_page


class AuthConfigTests(unittest.TestCase):
    def test_signed_tokens_round_trip_and_expire(self) -> None:
        auth = AuthConfig(password="hemmelig", secret="test-secret", session_ttl=60)
        token = auth.issue_token(now=1_000.0)
        self.assertTrue(auth.verify_token(token, now=1_030.0))
        self.assertFalse(auth.verify_token(token, now=1_061.0))
        self.assertFalse(auth.verify_token(token + "x", now=1_030.0))
        self.assertFalse(AuthConfig("hemmelig", "annen").verify_token(token, now=1_030.0))

    def test_password_and_cookie_helpers(self) -> None:
        auth = AuthConfig(password="riktig", secret="secret")
        self.assertTrue(auth.verify_password("riktig"))
        self.assertFalse(auth.verify_password("feil"))
        cookie = session_cookie("abc", secure=True, ttl=60)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Lax", cookie)
        self.assertIn("Secure", cookie)
        self.assertIn("Max-Age=60", cookie)
        self.assertIn("Max-Age=0", clear_session_cookie(secure=False))
        self.assertEqual(read_session_cookie("foo=bar; tp_session=abc; x=y"), "abc")
        self.assertIsNone(read_session_cookie("foo=bar"))

    def test_login_limiter_blocks_after_limit(self) -> None:
        limiter = LoginLimiter(max_attempts=2, window_seconds=60)
        self.assertFalse(limiter.blocked("1.2.3.4"))
        limiter.fail("1.2.3.4")
        limiter.fail("1.2.3.4")
        self.assertTrue(limiter.blocked("1.2.3.4"))
        limiter.reset("1.2.3.4")
        self.assertFalse(limiter.blocked("1.2.3.4"))

    def test_login_page_escapes_error(self) -> None:
        page = render_login_page(error='<script>alert("x")</script>')
        self.assertNotIn("<script>alert", page)
        self.assertIn("&lt;script&gt;", page)
        self.assertIn('action="/login"', page)


class AuthHTTPTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.journal_path = Path(self.directory.name) / "journal.json"
        self.server = ScreenerHTTPServer(
            ("127.0.0.1", 0),
            defaults=Criteria(),
            cache_ttl=60,
            http_timeout=1.0,
            sort_by="week",
            include_news=False,
            settings=Settings(),
            journal_path=self.journal_path,
            auth=AuthConfig("riktig-passord", "test-secret"),
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.directory.cleanup()

    def _request(
        self,
        method: str,
        path: str,
        data: dict[str, object] | None = None,
        headers: dict[str, str] | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        connection = HTTPConnection(
            "127.0.0.1", self.server.server_address[1], timeout=3
        )
        body = urlencode(data) if data is not None else None
        request_headers = dict(headers or {})
        if body is not None:
            request_headers.setdefault(
                "Content-Type", "application/x-www-form-urlencoded"
            )
        connection.request(method, path, body=body, headers=request_headers)
        response = connection.getresponse()
        response_body = response.read()
        response_headers = {
            key.lower(): value for key, value in response.getheaders()
        }
        connection.close()
        return response.status, response_headers, response_body

    def _login(self, headers: dict[str, str] | None = None) -> str:
        status, response_headers, _body = self._request(
            "POST",
            "/login",
            {"password": "riktig-passord", "next": "/logg"},
            headers=headers,
        )
        self.assertEqual(status, 303)
        cookie = response_headers["set-cookie"]
        return cookie.split(";", 1)[0]

    def test_private_pages_redirect_to_login_but_assets_are_public(self) -> None:
        for path in ("/", "/logg", "/api/data"):
            status, headers, _body = self._request("GET", path)
            self.assertEqual(status, 303)
            self.assertTrue(headers["location"].startswith("/login?next="))
            self.assertNotIn("set-cookie", headers)

        for path in ("/login", "/healthz", "/manifest.webmanifest", "/sw.js", "/offline"):
            status, _headers, _body = self._request("GET", path)
            self.assertEqual(status, 200, path)

        status, _headers, body = self._request("GET", "/login?next=%2Flogg")
        self.assertEqual(status, 200)
        self.assertIn("Logg inn".encode(), body)
        self.assertIn('name="password"'.encode(), body)

    def test_wrong_password_is_rejected_and_correct_password_logs_in(self) -> None:
        status, headers, body = self._request(
            "POST",
            "/login",
            {"password": "feil", "next": "/logg"},
        )
        self.assertEqual(status, 401)
        self.assertIn("Feil passord".encode(), body)
        self.assertNotIn("set-cookie", headers)

        cookie = self._login()
        status, headers, body = self._request(
            "GET",
            "/logg",
            headers={"Cookie": cookie},
        )
        self.assertEqual(status, 200)
        self.assertIn("Logg ut".encode(), body)
        self.assertIn("Handelsdagbok".encode(), body)

    def test_logout_clears_cookie(self) -> None:
        cookie = self._login()
        status, headers, _body = self._request(
            "POST",
            "/logout",
            {},
            headers={"Cookie": cookie},
        )
        self.assertEqual(status, 303)
        self.assertEqual(headers["location"], "/login")
        self.assertIn("Max-Age=0", headers["set-cookie"])

    def test_login_cookie_becomes_secure_behind_https_proxy(self) -> None:
        status, headers, _body = self._request(
            "POST",
            "/login",
            {"password": "riktig-passord", "next": "/"},
            headers={"X-Forwarded-Proto": "https"},
        )
        self.assertEqual(status, 303)
        self.assertIn("Secure", headers["set-cookie"])

    def test_journal_post_requires_login(self) -> None:
        status, headers, _body = self._request(
            "POST",
            "/journal/trade",
            {
                "ticker": "EQNR",
                "side": "buy",
                "quantity": "1",
                "price": "100",
                "fee": "29",
                "next": "/logg#journal",
            },
        )
        self.assertEqual(status, 303)
        self.assertTrue(headers["location"].startswith("/login?next="))
        self.assertFalse(self.journal_path.exists())

    def test_abusive_login_attempts_are_rate_limited(self) -> None:
        self.server.login_limiter.max_attempts = 2
        for _ in range(2):
            status, _headers, _body = self._request(
                "POST",
                "/login",
                {"password": "feil", "next": "/"},
            )
            self.assertEqual(status, 401)
        status, _headers, body = self._request(
            "POST",
            "/login",
            {"password": "riktig-passord", "next": "/"},
        )
        self.assertEqual(status, 429)
        self.assertIn("For mange".encode(), body)


if __name__ == "__main__":
    unittest.main()
