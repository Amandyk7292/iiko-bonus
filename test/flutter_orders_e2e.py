from pathlib import Path
from urllib.parse import urlparse
import json
import sys

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000/app/"
ROOT = Path(__file__).resolve().parents[1]
CUSTOMER = {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "Алия",
    "phone": "77000000000",
    "balance": 1200,
    "total_spent": 24000,
    "created_at": "2026-01-01T00:00:00Z",
    "cashbackPercent": 5,
    "tier": {"name": "Бронза", "percent": 5, "remaining": 10000, "progress": 0.2},
}
ORDERS = [
    {
        "id": "22222222-2222-4222-8222-222222222222",
        "number": 530383,
        "paymentStatus": "paid",
        "orderStatus": "new",
        "amount": 2500,
        "subtotal": 2500,
        "discount": 0,
        "branch": "Тауке Хана",
        "pickupTime": "2026-07-13T13:00:00Z",
        "items": [{"name": "Вишнёво-яблочный пирог", "quantity": 1, "price": 2500}],
        "earnedBonus": 125,
        "createdAt": "2026-07-13T08:44:00Z",
        "updatedAt": "2026-07-13T08:44:00Z",
    }
]
orders_requested = {"value": False}


def fulfill(route, payload):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))


def api_route(route):
    path = urlparse(route.request.url).path
    if path.endswith("/api/guest/profile"):
        fulfill(route, {"success": True, "exists": True, "customer": CUSTOMER, "transactions": []})
    elif path.endswith("/api/customer/loyalty"):
        fulfill(route, {"success": True, "loyalty": CUSTOMER["tier"]})
    elif path.endswith("/api/customer/orders"):
        orders_requested["value"] = True
        fulfill(route, {"success": True, "orders": ORDERS, "total": 1, "page": 1, "pageSize": 50})
    elif path.endswith("/api/guest/stories"):
        fulfill(route, {"success": True, "stories": []})
    elif path.endswith("/api/guest/news"):
        fulfill(route, {"success": True, "news": []})
    else:
        fulfill(route, {"success": True, "notifications": [], "cities": []})


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 393, "height": 852}, locale="ru-RU", reduced_motion="reduce")
    page = context.new_page()
    page.route("https://iiko-bonus.onrender.com/**", api_route)
    page.add_init_script(
        f"""
        (() => {{
          const values = {{
            phone: '77000000000',
            accessToken: 'test-token',
            customer: JSON.stringify({json.dumps(CUSTOMER)}),
            transactions: '[]',
          }};
          for (const [key, value] of Object.entries(values)) {{
            localStorage.setItem(`flutter.${{key}}`, JSON.stringify(value));
          }}
        }})()
        """
    )
    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
    page.locator("flt-glass-pane").wait_for(state="attached", timeout=120_000)
    page.wait_for_timeout(1800)

    page.mouse.click(354, 808)
    page.wait_for_timeout(700)
    page.mouse.click(190, 391)
    page.wait_for_timeout(1500)
    assert orders_requested["value"]
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    screenshot = ROOT / "scratch" / "flutter-orders-mobile.png"
    page.screenshot(path=str(screenshot), full_page=True)
    print(f"Flutter orders E2E passed; screenshot: {screenshot}")

    context.close()
    browser.close()
