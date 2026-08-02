import os
from pathlib import Path
from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("BULKA_RELEASE_URL", "http://127.0.0.1:3100").rstrip("/")
ARTIFACTS = Path(__file__).resolve().parent.parent / ".tmp" / "release-smoke"
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    errors: list[str] = []
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    page.on(
        "console",
        lambda message: errors.append(f"console: {message.text}")
        if message.type == "error" and "status of 401" not in message.text
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
    asset_links = api.get(f"{BASE_URL}/.well-known/assetlinks.json")
    require(asset_links.ok and isinstance(asset_links.json(), list), "Asset Links endpoint failed")

    browser.close()
    require(not errors, "Browser errors: " + " | ".join(errors))
    print("E2E RELEASE SMOKE OK")
