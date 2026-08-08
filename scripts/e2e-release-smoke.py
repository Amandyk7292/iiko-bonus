import json
import os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("BULKA_RELEASE_URL", "http://127.0.0.1:3100").rstrip("/")
ARTIFACTS = Path(__file__).resolve().parent.parent / ".tmp" / "release-smoke"
ARTIFACTS.mkdir(parents=True, exist_ok=True)
LOCAL_TEST_MODE = (
    os.environ.get("NODE_ENV") == "test"
    and urlparse(BASE_URL).hostname in {"127.0.0.1", "localhost"}
)
EXPECTED_GUEST_401_PATHS = {"/api/auth/refresh", "/admin/api/session"}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def fulfill_json(route, payload: dict[str, object], status: int = 200) -> None:
    route.fulfill(
        status=status,
        content_type="application/json",
        body=json.dumps(payload),
    )


def install_local_api_fixtures(context) -> None:
    if not LOCAL_TEST_MODE:
        return

    context.route(
        "**/api/auth/refresh",
        lambda route: fulfill_json(
            route,
            {
                "success": False,
                "error": "Refresh session is required",
                "code": "CUSTOMER_SESSION_REQUIRED",
            },
            status=401,
        ),
    )

    def route_guest_bootstrap(route) -> None:
        path = urlparse(route.request.url).path
        payloads = {
            "/api/guest/menu": {
                "success": True,
                "categories": [],
                "products": [],
            },
            "/api/guest/stories": {"success": True, "stories": []},
            "/api/guest/news": {"success": True, "news": []},
        }
        payload = payloads.get(path)
        if payload is None:
            route.fallback()
            return
        fulfill_json(route, payload)

    context.route("**/api/guest/**", route_guest_bootstrap)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 390, "height": 844})
    install_local_api_fixtures(context)
    page = context.new_page()
    page_errors: list[str] = []
    console_errors: list[dict[str, object]] = []
    failed_responses: list[dict[str, object]] = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))
    page.on(
        "response",
        lambda response: failed_responses.append(
            {"status": response.status, "url": response.url}
        )
        if response.status >= 400
        else None,
    )
    page.on(
        "console",
        lambda message: console_errors.append(
            {"text": message.text, "location": message.location}
        )
        if message.type == "error"
        else None,
    )

    response = page.goto(f"{BASE_URL}/account-deletion", wait_until="networkidle")
    require(response is not None and response.ok, "Account deletion page is unavailable")
    require(page.get_by_role("heading", name="Удаление аккаунта Bulka").is_visible(), "Deletion heading is missing")
    require(page.locator("#phone").is_visible(), "Phone confirmation input is missing")
    require(page.locator("#requestButton").is_visible(), "OTP request action is missing")
    page.screenshot(path=str(ARTIFACTS / "account-deletion.png"), full_page=True)

    response = page.goto(f"{BASE_URL}/privacy", wait_until="networkidle")
    require(response is not None and response.ok, "Privacy page is unavailable")
    require(page.locator('a[href="/account-deletion"]').is_visible(), "Privacy page has no deletion link")

    response = page.goto(f"{BASE_URL}/admin", wait_until="networkidle")
    require(response is not None and response.ok, "Admin shell is unavailable")
    require(page.locator('input[type="password"]').is_visible(), "Protected admin login was not rendered")
    page.screenshot(path=str(ARTIFACTS / "admin-login.png"), full_page=True)

    response = page.goto(f"{BASE_URL}/", wait_until="domcontentloaded")
    require(response is not None and response.ok, "Customer web app is unavailable")
    page.wait_for_timeout(3500)
    require(page.locator("body").is_visible(), "Customer app did not render a body")
    page.screenshot(path=str(ARTIFACTS / "customer-app.png"), full_page=True)

    api = context.request
    health = api.get(f"{BASE_URL}/healthz")
    require(health.ok and health.json().get("status") == "ok", "Health check failed")
    aasa = api.get(f"{BASE_URL}/.well-known/apple-app-site-association")
    require(aasa.ok and "applinks" in aasa.json(), "AASA endpoint failed")
    aasa_paths = [
        path
        for detail in aasa.json().get("applinks", {}).get("details", [])
        for path in detail.get("paths", [])
    ]
    require("/catalog/*" in aasa_paths, "AASA does not allow catalog links")
    asset_links = api.get(f"{BASE_URL}/.well-known/assetlinks.json")
    require(
        asset_links.ok
        and isinstance(asset_links.json(), list)
        and len(asset_links.json()) > 0,
        "Asset Links endpoint is empty",
    )

    browser.close()
    unexpected_responses = [
        response
        for response in failed_responses
        if not (
            response["status"] == 401
            and urlparse(str(response["url"])).path in EXPECTED_GUEST_401_PATHS
        )
    ]
    unexpected_console_errors = [
        error
        for error in console_errors
        if not (
            "status of 401" in str(error["text"])
            and urlparse(str(error["location"].get("url", ""))).path
            in EXPECTED_GUEST_401_PATHS
        )
    ]
    refresh_errors = [
        response
        for response in failed_responses
        if response["status"] == 401
        and urlparse(str(response["url"])).path == "/api/auth/refresh"
    ]
    require(refresh_errors, "Customer web app did not probe the guest cookie session")
    require(
        not page_errors and not unexpected_console_errors and not unexpected_responses,
        "Browser errors: "
        + " | ".join(
            [
                *(f"pageerror: {value}" for value in page_errors),
                *(f"console: {value}" for value in unexpected_console_errors),
                *(f"response: {value}" for value in unexpected_responses),
            ]
        ),
    )
    print("E2E RELEASE SMOKE OK")
