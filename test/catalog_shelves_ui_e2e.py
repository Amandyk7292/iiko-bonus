from pathlib import Path
from urllib.parse import quote, urlparse
import json
import sys

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT_DIR = ROOT / "scratch" / "catalog-shelves"
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

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
    {"id": "buns", "name": "Булочки", "imageUrl": ""},
    {"id": "pies", "name": "Пироги", "imageUrl": ""},
    {"id": "coffee", "name": "Кофе", "imageUrl": ""},
]

PRODUCTS = [
    {
        "id": "bun-1",
        "categoryId": "buns",
        "name": "Плюшка Московская",
        "description": "Воздушная сдобная плюшка с сахаром",
        "price": 500,
        "imageUrl": "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&auto=format&fit=crop&q=80",
        "onlineOrderable": True,
    },
    {
        "id": "bun-2",
        "categoryId": "buns",
        "name": "Синнабон",
        "description": "Булочка с корицей и сливочным кремом",
        "price": 850,
        "imageUrl": "https://images.unsplash.com/photo-1623334044303-241021148842?w=600&auto=format&fit=crop&q=80",
        "onlineOrderable": True,
    },
    {
        "id": "bun-3",
        "categoryId": "buns",
        "name": "Рогалик со сгущёнкой",
        "description": "Нежное тесто и варёная сгущёнка",
        "price": 650,
        "imageUrl": "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&auto=format&fit=crop&q=80",
        "onlineOrderable": True,
    },
    {
        "id": "pie-1",
        "categoryId": "pies",
        "name": "Пирог Вишнёво-яблочный",
        "description": "Песочное тесто и нежная фруктовая начинка",
        "price": 2500,
        "imageUrl": "https://images.unsplash.com/photo-1519915028121-7d3463d20b13?w=600&auto=format&fit=crop&q=80",
        "onlineOrderable": True,
    },
    {
        "id": "pie-2",
        "categoryId": "pies",
        "name": "Пирог лимонный",
        "description": "Яркая цитрусовая начинка",
        "price": 2200,
        "imageUrl": "https://images.unsplash.com/photo-1568571780765-9276ac8b75a2?w=600&auto=format&fit=crop&q=80",
        "onlineOrderable": True,
    },
    {
        "id": "coffee-1",
        "categoryId": "coffee",
        "name": "Капучино",
        "description": "Эспрессо и молочная пена",
        "price": 1200,
        "imageUrl": "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=600&auto=format&fit=crop&q=80",
        "onlineOrderable": True,
    },
]


def fulfill(route, payload):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))


def api_route(route):
    path = urlparse(route.request.url).path
    if path.endswith("/api/customer/events"):
        route.fulfill(
            status=503,
            content_type="application/json",
            body=json.dumps({"success": False}),
        )
    elif path.endswith("/api/guest/profile"):
        fulfill(route, {"success": True, "exists": True, "customer": CUSTOMER, "transactions": []})
    elif path.endswith("/api/customer/loyalty"):
        fulfill(route, {"success": True, "loyalty": CUSTOMER["tier"]})
    elif path.endswith("/api/guest/menu"):
        fulfill(route, {"success": True, "categories": CATEGORIES, "products": PRODUCTS})
    elif path.endswith("/api/guest/stories"):
        fulfill(route, {"success": True, "stories": []})
    elif path.endswith("/api/guest/news"):
        fulfill(route, {"success": True, "news": []})
    else:
        fulfill(route, {"success": True, "notifications": [], "cities": []})


def app_storage_script(selected_order_type=None):
    values = {
        "phone": "77000000000",
        "customer": json.dumps(CUSTOMER),
        "transactions": "[]",
    }
    if selected_order_type:
        values["selected_order_type"] = selected_order_type
    return f"""
    (() => {{
      const values = {json.dumps(values)};
      for (const [key, value] of Object.entries(values)) {{
        localStorage.setItem(`flutter.${{key}}`, JSON.stringify(value));
      }}
      if (!Object.hasOwn(values, 'selected_order_type')) {{
        localStorage.removeItem('flutter.selected_order_type');
      }}
    }})()
    """


def new_app_context(browser, errors, selected_order_type=None):
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        locale="ru-RU",
        reduced_motion="reduce",
        service_workers="block",
    )
    context.route("**/api/**", api_route)
    # A context-level init script runs before Flutter and shared_preferences
    # initialize. A fresh context also prevents the plugin's in-memory cache
    # from retaining the order type used by the previous scenario.
    context.add_init_script(app_storage_script(selected_order_type))
    page = context.new_page()
    page.on(
        "console",
        lambda message: errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: errors.append(str(error)))
    return context, page


def open_url(page, url):
    page.goto(url, wait_until="domcontentloaded", timeout=120_000)
    page.locator("flt-glass-pane").wait_for(state="attached", timeout=45_000)
    page.wait_for_timeout(2600)
    accessibility = page.locator("flt-semantics-placeholder")
    if accessibility.count():
        accessibility.evaluate("element => element.click()")
        page.wait_for_timeout(500)


def open_app(page):
    open_url(page, BASE_URL)


def open_catalog(page):
    base = urlparse(BASE_URL)
    open_url(page, f"{base.scheme}://{base.netloc}/catalog")
    page.locator('[aria-label="Поиск по меню"]').first.wait_for(
        state="attached", timeout=15_000
    )


def open_catalog_category(page, category):
    base = urlparse(BASE_URL)
    path = f"/catalog/category/{quote(category, safe='')}"
    open_url(page, f"{base.scheme}://{base.netloc}{path}")
    page.locator('[aria-label^="Плюшка Московская "]').first.wait_for(
        state="attached", timeout=15_000
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors = []
    context, page = new_app_context(browser, errors)
    open_app(page)

    open_catalog(page)
    page.screenshot(path=str(SCREENSHOT_DIR / "catalog-main.png"), full_page=True)

    assert urlparse(page.url).path == "/catalog"
    assert page.evaluate(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
    )

    open_catalog_category(page, "Булочки")
    page.screenshot(path=str(SCREENSHOT_DIR / "category-all.png"), full_page=True)
    assert page.locator('[aria-label^="Плюшка Московская "]').count() >= 1
    assert page.locator('[aria-label^="Капучино "]').count() == 0

    page.locator('[aria-label="В корзину"]').first.click()
    page.wait_for_timeout(600)
    page.screenshot(path=str(SCREENSHOT_DIR / "order-type-required.png"), full_page=True)

    page.mouse.click(page.viewport_size["width"] / 2, 463)
    page.wait_for_timeout(900)
    page.screenshot(path=str(SCREENSHOT_DIR / "home-after-ok.png"), full_page=True)
    assert page.locator('[aria-label^="Плюшка Московская "]').count() == 0
    assert page.evaluate(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
    )

    # Start the shopping flow in a new browser context. The order type is
    # present before Flutter boots, instead of being injected into a running
    # shared_preferences instance and followed by a fragile page reload.
    context.close()
    context, page = new_app_context(browser, errors, selected_order_type="pickup")
    open_app(page)
    assert page.evaluate(
        "localStorage.getItem('flutter.selected_order_type')"
    ) == json.dumps("pickup")

    open_catalog_category(page, "Булочки")

    assert page.evaluate(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
    )
    page.screenshot(
        path=str(SCREENSHOT_DIR / "catalog-category-grid.png"), full_page=False
    )

    page.screenshot(
        path=str(SCREENSHOT_DIR / "catalog-before-add.png"), full_page=False
    )
    product_card = page.locator('[aria-label^="Плюшка Московская "]').first
    product_card.locator('[aria-label="В корзину"]').click()
    quantity_control = product_card.locator('[aria-label^="Количество: 1"]')
    quantity_control.wait_for(
        state="attached", timeout=10_000
    )
    page.screenshot(
        path=str(SCREENSHOT_DIR / "catalog-quantity-one.png"), full_page=False
    )
    quantity_control.get_by_role(
        "button", name="Увеличить количество", exact=True
    ).click()
    product_card.locator('[aria-label^="Количество: 2"]').wait_for(
        state="attached", timeout=10_000
    )
    page.screenshot(
        path=str(SCREENSHOT_DIR / "catalog-quantity-two.png"), full_page=True
    )

    # The catalog keeps only the quantity control; cart navigation stays in
    # the dedicated center tab of the Bulka bottom navigation.
    page.mouse.click(195, 790)
    page.wait_for_timeout(700)
    page.screenshot(path=str(SCREENSHOT_DIR / "cart-from-navbar.png"), full_page=True)
    cart_labels = page.locator("[aria-label]").evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('aria-label')).filter(Boolean)"
    )
    assert any(
        "Плюшка Московская" in label and "2" in label for label in cart_labels
    ), cart_labels
    assert not errors, f"Browser console errors: {errors}"

    print(
        "Catalog shelves UI passed: "
        + ", ".join(str(path) for path in sorted(SCREENSHOT_DIR.glob("*.png")))
    )

    context.close()
    browser.close()
