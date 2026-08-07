"""Browser-level regression for cookie sessions across restarts and tabs.

This serves the production Flutter bundle under its real HTTPS origin through
Playwright routing, so Chromium applies the same HttpOnly/Secure/SameSite cookie
rules without contacting production.
"""

from pathlib import Path
from urllib.parse import unquote, urlparse
import json
import mimetypes
import os
import re
import tempfile
import time

from playwright.sync_api import BrowserContext, Route, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
APP = Path(
    os.environ.get(
        "BULKA_FLUTTER_BUNDLE",
        ROOT / "BulkaAndroid" / "build" / "web",
    )
).resolve()
INDEX = APP / "index.html"
BASE_HREF_MATCH = (
    re.search(r'<base\s+href="([^"]+)"', INDEX.read_text(encoding="utf-8"))
    if INDEX.is_file()
    else None
)
APP_BASE_PATH = (
    urlparse(BASE_HREF_MATCH.group(1)).path.rstrip("/") if BASE_HREF_MATCH else ""
)
ORIGIN = "https://bulka.com.kz"
PHONE = "77000000000"
CUSTOMER = {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "Алия",
    "phone": PHONE,
    "balance": 1200,
    "total_spent": 24000,
    "created_at": "2026-01-01T00:00:00Z",
    "cashbackPercent": 5,
    "tier": {"name": "Бронза", "percent": 5, "remaining": 10000, "progress": 0.2},
}
SECOND_PHONE = "77000000002"
SECOND_CUSTOMER = {
    **CUSTOMER,
    "id": "22222222-2222-4222-8222-222222222222",
    "name": "Болат",
    "phone": SECOND_PHONE,
}


class SessionBackend:
    def __init__(self):
        self.refresh_calls = []
        self.children = {}
        self.child_sequence = 0
        self.requests = []
        self.customer = CUSTOMER

    def _json(self, route: Route, payload, status=200, headers=None):
        response_headers = {"Content-Type": "application/json; charset=utf-8"}
        response_headers.update(headers or {})
        route.fulfill(
            status=status,
            headers=response_headers,
            body=json.dumps(payload, ensure_ascii=False),
        )

    @staticmethod
    def _cookie(route: Route, headers):
        cookie = headers.get("cookie", "")
        for item in cookie.split(";"):
            name, _, value = item.strip().partition("=")
            if name == "bulka_customer_refresh":
                return value
        # Playwright WebKit keeps HttpOnly cookies in the browser profile but
        # omits the Cookie header from intercepted Route requests.
        for item in route.request.frame.page.context.cookies(route.request.url):
            if item["name"] == "bulka_customer_refresh":
                return item["value"]
        return ""

    def _refresh(self, route: Route):
        headers = route.request.all_headers()
        parent = self._cookie(route, headers)
        assert parent, "refresh request did not carry the HttpOnly cookie"
        child = self.children.get(parent)
        if child is None:
            self.child_sequence += 1
            child = f"refresh-child-{self.child_sequence}"
            self.children[parent] = child
        self.refresh_calls.append(
            {
                "parent": parent,
                "child": child,
                "transport": headers.get("x-bulka-session-transport"),
            }
        )
        self._json(
            route,
            {
                "success": True,
                "accessToken": f"access-for-{child}",
                "sessionIdentity": {
                    "id": self.customer["id"],
                    "phone": self.customer["phone"],
                },
            },
            headers={
                "Set-Cookie": (
                    f"bulka_customer_refresh={child}; Path=/api/auth; "
                    "HttpOnly; Secure; SameSite=Strict; Max-Age=2592000"
                )
            },
        )

    def _api(self, route: Route, path: str):
        if path == "/api/auth/refresh":
            self._refresh(route)
            return
        if path == "/api/customer/events":
            # Keep the SSE retry loop from holding networkidle forever.
            route.abort("connectionrefused")
            return
        if path == "/api/guest/profile":
            self._json(
                route,
                {
                    "success": True,
                    "exists": True,
                    "customer": self.customer,
                    "transactions": [],
                },
            )
            return
        if path == "/api/customer/loyalty":
            self._json(route, {"success": True, "loyalty": CUSTOMER["tier"]})
            return
        if path == "/api/guest/menu":
            self._json(route, {"success": True, "categories": [], "products": []})
            return
        if path in {"/api/guest/stories", "/api/guest/news"}:
            self._json(route, {"success": True, path.rsplit("/", 1)[-1]: []})
            return
        if path == "/api/customer/orders":
            self._json(route, {"success": True, "orders": []})
            return
        self._json(
            route,
            {
                "success": True,
                "notifications": [],
                "cities": [],
                "locations": [],
                "orders": [],
            },
        )

    def handle(self, route: Route):
        self.requests.append(route.request.url)
        parsed = urlparse(route.request.url)
        if parsed.hostname == "www.gstatic.com" and parsed.path.startswith("/flutter-canvaskit/"):
            parts = parsed.path.split("/", 3)
            relative = parts[3] if len(parts) == 4 else ""
            candidate = (APP / "canvaskit" / relative).resolve()
            try:
                candidate.relative_to(APP / "canvaskit")
            except ValueError:
                route.fulfill(status=404, body="Not found")
                return
            if candidate.is_file():
                route.fulfill(
                    status=200,
                    content_type=mimetypes.guess_type(candidate.name)[0]
                    or "application/octet-stream",
                    path=str(candidate),
                )
            else:
                route.fulfill(status=404, body="Not found")
            return
        if parsed.hostname in {"www.gstatic.com", "fonts.gstatic.com"}:
            route.continue_()
            return
        if parsed.hostname not in {"bulka.com.kz", "www.bulka.com.kz"}:
            route.abort("blockedbyclient")
            return
        path = unquote(parsed.path)
        if path.startswith("/api/"):
            self._api(route, path)
            return
        if path == "/session-test-blank":
            route.fulfill(
                status=200,
                content_type="text/html",
                body="<!doctype html><title>session test</title>",
            )
            return

        relative = path.lstrip("/")
        base_prefix = f"{APP_BASE_PATH.lstrip('/')}/" if APP_BASE_PATH else ""
        if base_prefix and relative.startswith(base_prefix):
            relative = relative[len(base_prefix) :]
        candidate = (APP / relative).resolve()
        if path in {"/", APP_BASE_PATH, f"{APP_BASE_PATH}/"} or not Path(relative).suffix:
            candidate = APP / "index.html"
        try:
            candidate.relative_to(APP)
        except ValueError:
            route.fulfill(status=404, body="Not found")
            return
        if not candidate.is_file():
            route.fulfill(status=404, body="Not found")
            return
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        route.fulfill(status=200, content_type=content_type, path=str(candidate))


def install_routes(context: BrowserContext, backend: SessionBackend):
    context.route("**/*", backend.handle)


def wait_for_flutter(page, backend):
    errors = []
    page.on("console", lambda message: errors.append(f"console {message.type}: {message.text}"))
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    page.on(
        "requestfailed",
        lambda request: errors.append(f"requestfailed: {request.url} {request.failure}"),
    )
    try:
        page.wait_for_load_state("networkidle", timeout=60_000)
        page.locator("flt-glass-pane").wait_for(state="attached", timeout=60_000)
    except Exception:
        screenshot = ROOT / "scratch" / "flutter-session-persistence-failure.png"
        screenshot.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(screenshot), full_page=True)
        print("Flutter bootstrap errors:", errors[-30:])
        print("Flutter bootstrap requests:", backend.requests[-50:])
        print("Flutter bootstrap URL:", page.url)
        raise


def seed_identity(context: BrowserContext):
    encoded_customer = json.dumps(CUSTOMER, ensure_ascii=False)
    context.add_init_script(
        f"""
        (() => {{
          const values = {{
            phone: '{PHONE}',
            customer: JSON.stringify({encoded_customer}),
            transactions: '[]',
            lastAppScreen: 'main',
          }};
          for (const [key, value] of Object.entries(values)) {{
            const storageKey = `flutter.${{key}}`;
            if (localStorage.getItem(storageKey) === null) {{
              localStorage.setItem(storageKey, JSON.stringify(value));
            }}
          }}
        }})();
        """
    )


def assert_authenticated(page, expected_access, expected_phone=PHONE):
    assert page.evaluate("localStorage.getItem('flutter.phone')") == json.dumps(
        expected_phone
    )
    assert page.evaluate("sessionStorage.getItem('bulka_access_token')") == expected_access


def open_context(playwright, profile: str):
    browser_name = os.environ.get("BULKA_PLAYWRIGHT_BROWSER", "chromium")
    browser_type = getattr(playwright, browser_name)
    return browser_type.launch_persistent_context(
        profile,
        headless=True,
        locale="ru-RU",
        viewport={"width": 412, "height": 915},
        reduced_motion="reduce",
        service_workers="block",
    )


with tempfile.TemporaryDirectory(prefix="bulka-session-e2e-") as profile:
    if not INDEX.is_file():
        raise RuntimeError(
            f"Flutter production bundle not found at {APP}. "
            "Build it first or set BULKA_FLUTTER_BUNDLE."
        )
    backend = SessionBackend()
    with sync_playwright() as playwright:
        first = open_context(playwright, profile)
        install_routes(first, backend)
        seed_identity(first)
        first.add_cookies(
            [
                {
                    "name": "bulka_customer_refresh",
                    "value": "refresh-root",
                    "domain": "bulka.com.kz",
                    "path": "/api/auth",
                    "httpOnly": True,
                    "secure": True,
                    "sameSite": "Strict",
                    "expires": time.time() + 30 * 24 * 60 * 60,
                }
            ]
        )
        page = first.pages[0] if first.pages else first.new_page()
        page.goto(f"{ORIGIN}/", wait_until="domcontentloaded", timeout=60_000)
        wait_for_flutter(page, backend)
        assert len(backend.refresh_calls) == 1
        assert backend.refresh_calls[0]["transport"] == "cookie"
        assert_authenticated(page, "access-for-refresh-child-1")
        first.close()

        # A new Chromium process has no tab-scoped access token. The durable
        # browser profile must retain identity + HttpOnly refresh cookie.
        restarted = open_context(playwright, profile)
        install_routes(restarted, backend)
        page = restarted.pages[0] if restarted.pages else restarted.new_page()
        page.goto(f"{ORIGIN}/", wait_until="domcontentloaded", timeout=60_000)
        wait_for_flutter(page, backend)
        assert len(backend.refresh_calls) == 2
        assert backend.refresh_calls[-1]["parent"] == "refresh-child-1"
        assert_authenticated(page, "access-for-refresh-child-2")
        restarted.close()

        # The HttpOnly cookie is the durable source of truth. Even if Safari
        # loses local identity during an update, the server-verified session
        # must rebuild it without showing the login screen.
        identity_cleanup = open_context(playwright, profile)
        install_routes(identity_cleanup, backend)
        cleanup_page = (
            identity_cleanup.pages[0]
            if identity_cleanup.pages
            else identity_cleanup.new_page()
        )
        cleanup_page.goto(
            f"{ORIGIN}/session-test-blank",
            wait_until="domcontentloaded",
        )
        cleanup_page.evaluate(
            """() => {
              for (const key of [
                'flutter.phone',
                'flutter.customer',
                'flutter.transactions',
                'bulka_access_token',
              ]) {
                localStorage.removeItem(key);
                sessionStorage.removeItem(key);
              }
            }"""
        )
        identity_cleanup.close()

        identity_recovery = open_context(playwright, profile)
        install_routes(identity_recovery, backend)
        recovery_page = (
            identity_recovery.pages[0]
            if identity_recovery.pages
            else identity_recovery.new_page()
        )
        recovery_page.goto(
            f"{ORIGIN}/",
            wait_until="domcontentloaded",
            timeout=60_000,
        )
        wait_for_flutter(recovery_page, backend)
        assert_authenticated(
            recovery_page,
            f"access-for-{backend.refresh_calls[-1]['child']}",
        )
        identity_recovery.close()

        # Start two clean tabs from the same persistent cookie. Both must
        # restore independently and neither may erase the shared session.
        tabs = open_context(playwright, profile)
        install_routes(tabs, backend)
        first_tab = tabs.pages[0] if tabs.pages else tabs.new_page()
        second_tab = tabs.new_page()
        first_tab.goto(f"{ORIGIN}/session-test-blank", wait_until="domcontentloaded")
        second_tab.goto(f"{ORIGIN}/session-test-blank", wait_until="domcontentloaded")
        first_tab.evaluate("window.location.replace('/')")
        second_tab.evaluate("window.location.replace('/')")
        wait_for_flutter(first_tab, backend)
        wait_for_flutter(second_tab, backend)
        assert len(backend.refresh_calls) >= 4
        assert first_tab.evaluate("sessionStorage.getItem('bulka_access_token')")
        assert second_tab.evaluate("sessionStorage.getItem('bulka_access_token')")
        assert first_tab.evaluate("localStorage.getItem('flutter.phone')") == json.dumps(PHONE)
        assert second_tab.evaluate("localStorage.getItem('flutter.phone')") == json.dumps(PHONE)
        tabs.close()

        # A login in another tab replaces the shared HttpOnly cookie. On the
        # next launch this tab must discard account A before rendering B.
        backend.customer = SECOND_CUSTOMER
        switched = open_context(playwright, profile)
        install_routes(switched, backend)
        switched.add_cookies(
            [
                {
                    "name": "bulka_customer_refresh",
                    "value": "refresh-account-b",
                    "domain": "bulka.com.kz",
                    "path": "/api/auth",
                    "httpOnly": True,
                    "secure": True,
                    "sameSite": "Strict",
                    "expires": time.time() + 30 * 24 * 60 * 60,
                }
            ]
        )
        switched_page = (
            switched.pages[0] if switched.pages else switched.new_page()
        )
        switched_page.goto(
            f"{ORIGIN}/",
            wait_until="domcontentloaded",
            timeout=60_000,
        )
        wait_for_flutter(switched_page, backend)
        assert backend.refresh_calls[-1]["parent"] == "refresh-account-b"
        assert_authenticated(
            switched_page,
            f"access-for-{backend.refresh_calls[-1]['child']}",
            SECOND_PHONE,
        )
        stored_customer = json.loads(
            json.loads(
                switched_page.evaluate(
                    "localStorage.getItem('flutter.customer')"
                )
            )
        )
        assert stored_customer["phone"] == SECOND_PHONE
        assert stored_customer["name"] == SECOND_CUSTOMER["name"]
        switched.close()

    print(
        "Flutter session persistence passed "
        f"({os.environ.get('BULKA_PLAYWRIGHT_BROWSER', 'chromium')}): "
        "cold restart, two-tab refresh, and account switch "
        f"({len(backend.refresh_calls)} refresh calls)"
    )
