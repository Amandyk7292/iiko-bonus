from pathlib import Path
from urllib.parse import urlparse
import json
import sys

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3100/"
MOBILE_ONLY = "--mobile-only" in sys.argv[2:]
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

CATEGORIES = [
    {
        "id": "pies",
        "name": "Пироги",
        "imageUrl": "https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=300&auto=format&fit=crop&q=75",
    },
    {
        "id": "cakes",
        "name": "Торты",
        "imageUrl": "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=300&auto=format&fit=crop&q=75",
    },
    {
        "id": "coffee",
        "name": "Кофе",
        "imageUrl": "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=300&auto=format&fit=crop&q=75",
    },
]

PRODUCTS = [
    {
        "id": "p1",
        "categoryId": "pies",
        "name": "Вишнёво-яблочный пирог",
        "description": "Песочное тесто и нежная фруктовая начинка",
        "ingredients": "Пшеничная мука, сливочное масло, яблоко, вишня, сахар",
        "allergens": ["Глютен", "Молоко"],
        "dietaryTags": ["Без яиц", "Вегетарианское"],
        "searchKeywords": ["вишневый", "фруктовый", "пирог"],
        "weightGrams": 850,
        "nutrition": {
            "caloriesKcal": 248,
            "proteinGrams": 4.2,
            "fatGrams": 10.5,
            "carbsGrams": 36.8,
        },
        "price": 2500,
        "imageUrl": "https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=500&auto=format&fit=crop&q=80",
        "onlineOrderable": True,
    },
    {
        "id": "p2",
        "categoryId": "cakes",
        "name": "Торт Радуга",
        "description": "Воздушный праздничный торт",
        "price": 13900,
        "imageUrl": "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=500&auto=format&fit=crop&q=80",
        "onlineOrderable": True,
    },
    {
        "id": "p3",
        "categoryId": "cakes",
        "name": "Медовый торт",
        "description": "Тонкие коржи и сливочный крем",
        "price": 8900,
        "imageUrl": "https://images.unsplash.com/photo-1588195538326-c5b1e9f80a1b?w=500&auto=format&fit=crop&q=80",
        "onlineOrderable": True,
    },
    {
        "id": "p4",
        "categoryId": "coffee",
        "name": "Капучино",
        "description": "Эспрессо и молочная пена",
        "price": 1200,
        "imageUrl": "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=500&auto=format&fit=crop&q=80",
        "onlineOrderable": False,
    },
]

REQUESTED_API_PATHS = []


def fulfill(route, payload):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))


def api_route(route):
    path = urlparse(route.request.url).path
    REQUESTED_API_PATHS.append(path)
    if path.endswith("/api/guest/profile"):
        fulfill(route, {"success": True, "exists": True, "customer": CUSTOMER, "transactions": []})
    elif path.endswith("/api/customer/loyalty"):
        fulfill(route, {"success": True, "loyalty": CUSTOMER["tier"]})
    elif path.endswith("/api/guest/menu"):
        fulfill(route, {"success": True, "categories": CATEGORIES, "products": PRODUCTS})
    elif path.endswith("/api/guest/stories"):
        fulfill(route, {"success": True, "stories": []})
    elif path.endswith("/api/guest/news"):
        fulfill(route, {"success": True, "news": []})
    elif path.endswith("/api/customer/usual-order"):
        fulfill(
            route,
            {
                "success": True,
                "usualOrder": {
                    "timesOrdered": 10,
                    "total": 2500,
                    "items": [
                        {
                            "id": "p1",
                            "name": "Вишнёво-яблочный пирог",
                            "price": 2500,
                            "quantity": 1,
                        }
                    ],
                },
            },
        )
    else:
        fulfill(route, {"success": True, "notifications": [], "cities": []})


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 375, "height": 812},
        locale="ru-RU",
        reduced_motion="reduce",
    )
    page = context.new_page()
    page.route("**/api/**", api_route)
    page.add_init_script(
        f"""
        (() => {{
          const customer = {json.dumps(CUSTOMER)};
          const values = {{
            phone: '77000000000',
            accessToken: 'test-token',
            customer: JSON.stringify(customer),
            transactions: '[]',
            selected_bakery_location: 'ТЦ Ardager, 9-й микрорайон, 30/3',
          }};
          for (const [key, value] of Object.entries(values)) {{
            localStorage.setItem(`flutter.${{key}}`, JSON.stringify(value));
          }}
        }})()
        """,
    )

    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
    try:
        page.locator("flt-glass-pane").wait_for(state="attached", timeout=45_000)
    except Exception:
        print(f"Flutter bootstrap errors: {errors}", file=sys.stderr)
        raise
    print("Mobile Flutter surface attached", flush=True)
    page.wait_for_timeout(2200)

    # Catalog is the second item in the five-item bottom navigation.
    page.mouse.click(112, 768)
    page.wait_for_timeout(3000)

    assert not any(
        path.endswith("/api/customer/usual-order") for path in REQUESTED_API_PATHS
    ), "Catalog still requests the removed usual-order feature"

    screenshot = ROOT / "scratch" / "flutter-catalog-mobile.png"
    page.screenshot(path=str(screenshot), full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")

    # Open the complete category grid and verify it remains aligned on iPhone width.
    page.mouse.click(335, 156)
    page.wait_for_timeout(900)
    categories_screenshot = ROOT / "scratch" / "flutter-categories-mobile.png"
    page.screenshot(path=str(categories_screenshot), full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")

    # Return to the catalog and open a product to verify the rounded hero image.
    page.mouse.click(42, 28)
    page.wait_for_timeout(900)
    page.mouse.click(100, 450)
    page.wait_for_timeout(1200)
    details_screenshot = ROOT / "scratch" / "flutter-product-details-mobile.png"
    page.screenshot(path=str(details_screenshot), full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")

    # Scroll through structured facts so allergens and nutrition are covered too.
    page.mouse.wheel(0, 620)
    # SkWasm can briefly expose an incomplete GPU frame after wheel scrolling.
    page.wait_for_timeout(1800)
    facts_screenshot = ROOT / "scratch" / "flutter-product-details-facts-mobile.png"
    page.screenshot(path=str(facts_screenshot), full_page=True)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")

    page.mouse.click(42, 28)
    page.wait_for_timeout(900)

    page.mouse.click(98, 656)
    # SkWasm can expose a partially presented GPU frame to headless screenshots
    # immediately after an animation. Wait for the next stable presentation.
    page.wait_for_timeout(1800)
    quantity_screenshot = ROOT / "scratch" / "flutter-catalog-quantity-mobile.png"
    page.screenshot(path=str(quantity_screenshot), full_page=True)
    assert not errors, f"Browser console errors: {errors}"
    print(
        "Flutter catalog E2E passed; screenshots: "
        f"{screenshot}, {categories_screenshot}, {details_screenshot}, {facts_screenshot}, "
        f"{quantity_screenshot}"
    )

    context.close()

    if MOBILE_ONLY:
        browser.close()
        raise SystemExit(0)

    landscape = browser.new_context(
        viewport={"width": 844, "height": 390},
        locale="ru-RU",
        reduced_motion="reduce",
    )
    landscape_page = landscape.new_page()
    landscape_page.route("**/api/**", api_route)
    landscape_page.add_init_script(
        f"""
        (() => {{
          const customer = {json.dumps(CUSTOMER)};
          localStorage.setItem('flutter.phone', JSON.stringify('77000000000'));
          localStorage.setItem('flutter.accessToken', JSON.stringify('test-token'));
          localStorage.setItem('flutter.customer', JSON.stringify(JSON.stringify(customer)));
          localStorage.setItem('flutter.transactions', JSON.stringify('[]'));
          localStorage.setItem(
            'flutter.selected_bakery_location',
            JSON.stringify('ТЦ Ardager, 9-й микрорайон, 30/3')
          );
        }})()
        """
    )
    landscape_page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
    landscape_page.locator("flt-glass-pane").wait_for(state="attached", timeout=45_000)
    print("Landscape Flutter surface attached", flush=True)
    landscape_page.wait_for_timeout(2200)
    landscape_page.mouse.click(253, 348)
    landscape_page.wait_for_timeout(2600)
    landscape_screenshot = ROOT / "scratch" / "flutter-catalog-landscape.png"
    landscape_page.screenshot(path=str(landscape_screenshot), full_page=True)
    assert landscape_page.evaluate(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
    )
    landscape.close()
    browser.close()
