from pathlib import Path
from urllib.parse import urlparse
import json
import sys

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000/"
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
CART = [
    {
        "id": "p1",
        "name": "Вишнёво-яблочный пирог",
        "price": 2500,
        "imageUrl": "",
        "isStopListed": False,
        "quantity": 1,
    },
    {
        "id": "p2",
        "name": "Круассан миндальный",
        "price": 1200,
        "imageUrl": "",
        "isStopListed": False,
        "quantity": 2,
    },
]


def fulfill(route, payload):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))


def api_route(route):
    path = urlparse(route.request.url).path
    if path.endswith("/api/guest/profile"):
        fulfill(route, {"success": True, "exists": True, "customer": CUSTOMER, "transactions": []})
    elif path.endswith("/api/customer/loyalty"):
        fulfill(route, {"success": True, "loyalty": CUSTOMER["tier"]})
    elif path.endswith("/api/guest/menu"):
        fulfill(
            route,
            {
                "success": True,
                "categories": [{"id": "bakery", "name": "Выпечка"}],
                "products": [
                    {
                        "id": item["id"],
                        "categoryId": "bakery",
                        "name": item["name"],
                        "price": item["price"],
                        "imageUrl": item["imageUrl"],
                        "onlineOrderable": True,
                    }
                    for item in CART
                ],
            },
        )
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
    page.route("**/api/**", api_route)
    page.add_init_script(
        f"""
        (() => {{
          const customer = {json.dumps(CUSTOMER)};
          const cart = {json.dumps(CART)};
          const values = {{
            phone: '77000000000',
            accessToken: 'test-token',
            customer: JSON.stringify(customer),
            transactions: '[]',
            bulka_cart_v1: JSON.stringify(cart),
          }};
          for (const [key, value] of Object.entries(values)) {{
            localStorage.setItem(`flutter.${{key}}`, JSON.stringify(value));
          }}
        }})()
        """,
    )
    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
    page.locator("flt-glass-pane").wait_for(state="attached", timeout=120_000)
    page.wait_for_timeout(1800)

    # The cart is the centered item in the 5-item bottom navigation.
    page.mouse.click(196, 808)
    page.wait_for_timeout(900)
    screenshot = ROOT / "scratch" / "flutter-cart-mobile.png"
    page.screenshot(path=str(screenshot), full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.mouse.click(196, 716)
    page.wait_for_timeout(800)
    checkout_screenshot = ROOT / "scratch" / "flutter-checkout-mobile.png"
    page.screenshot(path=str(checkout_screenshot), full_page=True)
    print(f"Flutter cart E2E passed; screenshots: {screenshot}, {checkout_screenshot}")

    context.close()
    browser.close()
