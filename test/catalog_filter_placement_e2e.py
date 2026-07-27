from pathlib import Path
from urllib.parse import urlparse
import json
import sys

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4177/"
ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT_DIR = ROOT / "scratch" / "catalog-filter-placement"
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

CATEGORIES = [
    {"id": "buns", "name": "Булочки", "imageUrl": ""},
    {"id": "pancakes", "name": "Блины + бауырсак", "imageUrl": ""},
    {"id": "cakes", "name": "Торты", "imageUrl": ""},
]

PRODUCTS = [
    {
        "id": "pancake-1",
        "categoryId": "pancakes",
        "name": "Бауырсак вес",
        "price": 1900,
        "imageUrl": "",
        "onlineOrderable": True,
    },
    {
        "id": "pancake-2",
        "categoryId": "pancakes",
        "name": "Блины - 17",
        "price": 1900,
        "imageUrl": "",
        "onlineOrderable": True,
    },
    {
        "id": "pancake-3",
        "categoryId": "pancakes",
        "name": "Смесь для блинов",
        "price": 1490,
        "imageUrl": "",
        "onlineOrderable": False,
    },
    {
        "id": "bun-1",
        "categoryId": "buns",
        "name": "Плюшка Московская",
        "price": 500,
        "imageUrl": "",
        "onlineOrderable": True,
    },
]


def fulfill(route, payload):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))


def api_route(route):
    path = urlparse(route.request.url).path
    if path.endswith("/api/guest/menu"):
        fulfill(route, {"success": True, "categories": CATEGORIES, "products": PRODUCTS})
    elif path.endswith("/api/customer/favorites"):
        fulfill(route, {"success": True, "productIds": []})
    elif path.endswith("/api/guest/profile"):
        fulfill(route, {"success": True, "exists": False})
    else:
        fulfill(route, {"success": True, "stories": [], "news": [], "locations": []})


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 1440, "height": 900},
        locale="ru-RU",
        reduced_motion="reduce",
        service_workers="block",
    )
    page = context.new_page()
    page.route("**/api/**", api_route)
    page.add_init_script(
        """
        (() => {
          localStorage.setItem('flutter.selected_order_type', JSON.stringify('pickup'));
          localStorage.setItem(
            'flutter.selected_bakery_location_pickup',
            JSON.stringify('ЖК Дукат, 17-й микрорайон, 1')
          );
        })()
        """
    )
    errors = []
    page.on(
        "console",
        lambda message: errors.append(message.text) if message.type == "error" else None,
    )
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
    try:
        page.wait_for_load_state("networkidle", timeout=15_000)
    except PlaywrightTimeoutError:
        pass
    page.locator("flt-glass-pane").wait_for(state="attached", timeout=45_000)
    page.wait_for_timeout(2500)

    accessibility = page.locator("flt-semantics-placeholder")
    if accessibility.count():
        accessibility.evaluate("element => element.click()")
        page.wait_for_timeout(500)

    initial_labels = page.locator("[aria-label]").evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('aria-label')).filter(Boolean)"
    )
    page.screenshot(path=str(SCREENSHOT_DIR / "initial-desktop.png"), full_page=False)
    print(f"Initial labels: {json.dumps(initial_labels, ensure_ascii=True)}", flush=True)
    page.mouse.click(488, 848)
    page.wait_for_timeout(2500)

    main_labels = page.locator("[aria-label]").evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('aria-label')).filter(Boolean)"
    )
    assert "Фильтры" not in main_labels, main_labels
    page.screenshot(path=str(SCREENSHOT_DIR / "catalog-main-desktop.png"), full_page=False)

    page.mouse.click(280, 470)
    page.wait_for_timeout(900)
    page.screenshot(path=str(SCREENSHOT_DIR / "category-debug-desktop.png"), full_page=False)
    category_labels = page.locator("[aria-label]").evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('aria-label')).filter(Boolean)"
    )
    print(f"Category labels: {json.dumps(category_labels, ensure_ascii=True)}", flush=True)
    page.screenshot(path=str(SCREENSHOT_DIR / "category-filter-desktop.png"), full_page=False)
    assert page.evaluate(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
    )

    page.mouse.click(172, 32)
    page.wait_for_timeout(900)
    page.mouse.click(520, 92)
    page.keyboard.type("блин")
    page.wait_for_timeout(700)
    page.screenshot(path=str(SCREENSHOT_DIR / "search-results-filter-desktop.png"), full_page=False)
    assert page.evaluate(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
    )

    assert not errors, f"Browser console errors: {errors}"
    print(
        "Catalog filter placement passed: "
        + ", ".join(str(path) for path in sorted(SCREENSHOT_DIR.glob("*.png")))
    )
    context.close()
    browser.close()
