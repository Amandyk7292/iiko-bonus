from pathlib import Path
from urllib.parse import urlparse
import json
import sys

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4181/admin/marketing"
MARKETING_URL = (
    BASE_URL.rstrip("/")
    if BASE_URL.rstrip("/").endswith("/marketing")
    else f"{BASE_URL.rstrip('/')}/marketing"
)
ROOT = Path(__file__).resolve().parents[1]


def payload_for(path: str):
    if path == "/admin/api/session":
        return {"user": {"username": "owner", "role": "owner", "branchIds": []}}
    if path == "/admin/api/promotions":
        return {
            "success": True,
            "promotions": [
                {
                    "id": "promo-1",
                    "code": "BULKA10",
                    "title": "Скидка постоянным гостям",
                    "discount_type": "percent",
                    "discount_value": 10,
                    "customer_ids": [],
                    "customer_tags": [],
                    "used_count": 12,
                    "usage_limit": 100,
                    "active": True,
                }
            ],
        }
    if path == "/admin/api/gift-cards":
        return {
            "success": True,
            "giftCards": [
                {
                    "id": "gift-1",
                    "code_last4": "4521",
                    "recipient_name": "Алия",
                    "initial_balance": 10000,
                    "balance": 7500,
                    "active": True,
                    "created_at": "2026-07-22T08:00:00Z",
                }
            ],
        }
    if path == "/admin/api/automations":
        return {"success": True, "automations": []}
    return {"success": True}


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960}, device_scale_factor=1)
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)

    def route_api(route):
        path = urlparse(route.request.url).path
        if path.startswith("/admin/api/"):
            if path == "/admin/api/events":
                route.fulfill(
                    status=200,
                    headers={
                        "content-type": "text/event-stream",
                        "cache-control": "no-cache",
                    },
                    body="event: connected\ndata: {}\n\n",
                )
                return
            route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps(payload_for(path), ensure_ascii=False),
            )
        else:
            route.continue_()

    page.route("**/*", route_api)
    page.goto(MARKETING_URL)
    page.wait_for_load_state("networkidle")

    page.get_by_role("heading", name="CRM и автоматизация", exact=True).wait_for(state="visible")
    page.get_by_role("tab", name="Промокоды", exact=True).wait_for(state="visible")
    page.get_by_text("BULKA10", exact=True).wait_for(state="visible")
    page.get_by_role("tab", name="Сертификаты", exact=True).click()
    page.get_by_role("heading", name="Подарочные сертификаты", exact=True).wait_for(state="visible")
    page.get_by_text("•••• 4521", exact=True).wait_for(state="visible")

    overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
    assert not overflow, "Restored admin panel has horizontal overflow"
    assert not console_errors, f"Browser console errors: {console_errors}"
    page.screenshot(path=str(ROOT / "scratch" / "admin-restored-marketing.png"), full_page=True)
    browser.close()

print("Admin marketing restore E2E passed")
