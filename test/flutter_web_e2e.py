from pathlib import Path
from urllib.parse import urlparse
import json
import sys

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000/app/"
ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 393, "height": 852},
        device_scale_factor=3,
        locale="ru-RU",
        reduced_motion="reduce",
    )
    page = context.new_page()
    console_errors = []
    page.on(
        "console",
        lambda message: console_errors.append(message.text)
        if message.type == "error"
        else None,
    )

    def route_public_bootstrap(route):
        path = urlparse(route.request.url).path
        payload = {"success": True}
        if path.endswith("/api/guest/stories"):
            payload["stories"] = []
        elif path.endswith("/api/guest/news"):
            payload["news"] = []
        else:
            return route.fallback()
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(payload),
        )

    page.route("**/api/guest/**", route_public_bootstrap)

    response = page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
    assert response is not None and response.ok
    page.locator("flt-glass-pane").wait_for(state="attached", timeout=120_000)
    page.wait_for_timeout(1500)

    assert "bulka" in page.title().lower()
    assert page.evaluate(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
    )
    assert page.evaluate("crossOriginIsolated") is True
    assert not [error for error in console_errors if "favicon" not in error.lower()], console_errors

    screenshot = ROOT / "scratch" / "flutter-web-mobile.png"
    screenshot.parent.mkdir(exist_ok=True)
    page.screenshot(path=str(screenshot), full_page=True)
    print(f"Flutter Web E2E passed; screenshot: {screenshot}")

    context.close()
    browser.close()
