"""Verify the Forte cancellation return UX in the built Flutter web client."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Page, sync_playwright


BASE_URL = (
    os.environ.get("BULKA_UI_URL")
    or (sys.argv[1] if len(sys.argv) > 1 else None)
    or "http://127.0.0.1:4174"
).rstrip("/")
SCREENSHOT = Path(
    os.environ.get(
        "BULKA_UI_SCREENSHOT",
        str(Path("scratch") / "flutter-payment-cancelled.png"),
    )
)
CUSTOMER = {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "Алия",
    "phone": "77000000000",
    "balance": 1200,
    "total_spent": 24000,
    "created_at": "2026-01-01T00:00:00Z",
    "cashbackPercent": 5,
    "tier": {
        "name": "Бронза",
        "percent": 5,
        "remaining": 10000,
        "progress": 0.2,
    },
}
PREVIOUS_ORDERS = [
    {
        "id": "22222222-2222-4222-8222-222222222222",
        "number": 100029,
        "paymentStatus": "paid",
        "orderStatus": "new",
        "amount": 10,
        "subtotal": 10,
        "discount": 0,
        "branch": "ЖК Дукат, 17-й микрорайон, 1",
        "fulfillmentType": "pickup",
        "deliveryStatus": "unassigned",
        "items": [
            {
                "id": "moscow-bun",
                "name": "Плюшка Московская",
                "quantity": 1,
                "price": 10,
            }
        ],
        "earnedBonus": 1,
        "createdAt": "2026-07-20T08:44:00Z",
    }
]


def fulfill(route, payload) -> None:
    route.fulfill(
        status=200,
        content_type="application/json",
        body=json.dumps(payload),
    )


def api_route(route) -> None:
    path = urlparse(route.request.url).path
    if path.endswith("/api/customer/events"):
        route.fulfill(
            status=503,
            content_type="application/json",
            body=json.dumps({"success": False}),
        )
    elif path.endswith("/api/guest/profile"):
        fulfill(
            route,
            {
                "success": True,
                "exists": True,
                "customer": CUSTOMER,
                "transactions": [],
            },
        )
    elif path.endswith("/api/customer/loyalty"):
        fulfill(route, {"success": True, "loyalty": CUSTOMER["tier"]})
    elif path.endswith("/api/customer/orders"):
        fulfill(
            route,
            {
                "success": True,
                "orders": PREVIOUS_ORDERS,
                "total": 1,
                "page": 1,
                "pageSize": 50,
            },
        )
    else:
        fulfill(route, {"success": True, "notifications": [], "cities": []})


def wait_for_flutter(page: Page) -> None:
    page.wait_for_load_state("domcontentloaded", timeout=30_000)
    page.locator("#app-loading").wait_for(state="detached", timeout=40_000)
    page.locator("flt-glass-pane").wait_for(state="attached", timeout=40_000)
    page.wait_for_timeout(1_500)
    placeholder = page.locator("flt-semantics-placeholder")
    if placeholder.count() > 0:
        placeholder.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)


def main() -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            locale="ru-RU",
            color_scheme="light",
            reduced_motion="reduce",
        )
        page = context.new_page()
        page.route("**/api/**", api_route)
        page.add_init_script(
            f"""
            (() => {{
              const values = {{
                phone: '77000000000',
                accessToken: 'test-token',
                customer: JSON.stringify({json.dumps(CUSTOMER)}),
                transactions: '[]',
                lastAppScreen: 'customer-orders',
                lastMainTab: 2,
              }};
              for (const [key, value] of Object.entries(values)) {{
                localStorage.setItem(`flutter.${{key}}`, JSON.stringify(value));
              }}
            }})()
            """
        )

        return_url = (
            f"{BASE_URL}/orders"
            "?payment=forte"
            "&order=31f0d793-0102-4d2f-a5a1-744d12cffe7c"
            "&ID=1000001917869"
            "&STATUS=Cancelled"
        )
        page.goto(return_url, wait_until="commit", timeout=30_000)
        wait_for_flutter(page)

        try:
            page.locator('[aria-label*="Оплата отменена"]').wait_for(
                state="visible",
                timeout=15_000,
            )
        except Exception:
            SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(SCREENSHOT), full_page=True)
            print(f"Current URL: {page.url}")
            print(page.locator("flt-semantics").all_inner_texts())
            print(
                page.locator("[aria-label]").evaluate_all(
                    "(nodes) => nodes.map((node) => node.getAttribute('aria-label'))"
                )
            )
            raise
        assert page.locator('[aria-label*="Деньги не списаны"]').count() == 1
        assert (
            page.locator(
                '[aria-label*="Оплата: Оплачено"][aria-label*="Заказ: Новый"]'
            ).count()
            == 1
        )
        assert "STATUS" not in page.url
        assert "ID=" not in page.url
        assert page.evaluate(
            "document.documentElement.scrollWidth <= window.innerWidth + 1"
        )

        SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SCREENSHOT), full_page=True)
        context.close()
        browser.close()

    print(f"Forte cancelled-return UX passed. Screenshot: {SCREENSHOT.resolve()}")


if __name__ == "__main__":
    main()
