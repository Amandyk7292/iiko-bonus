from pathlib import Path
from urllib.parse import urlparse
import json
import sys
import time

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173/app/"
SCENARIO_FILTER = sys.argv[2] if len(sys.argv) > 2 else None
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

CATEGORIES = [{"id": "bakery", "name": "Выпечка", "imageUrl": ""}]
PRODUCTS = [
    {
        "id": "croissant",
        "categoryId": "bakery",
        "name": "Круассан миндальный",
        "description": "Слоёное тесто и миндальный крем",
        "ingredients": "Мука, сливочное масло, миндаль",
        "allergens": ["глютен", "молоко", "орехи"],
        "dietaryTags": ["вегетарианское"],
        "searchKeywords": ["завтрак", "слойка"],
        "weightGrams": 140,
        "nutrition": {
            "caloriesKcal": 420,
            "proteinGrams": 9,
            "fatGrams": 24,
            "carbsGrams": 43,
        },
        "price": 1800,
        "imageUrl": "",
        "onlineOrderable": True,
        "availableQuantity": 8,
        "preparationMinutes": 12,
    },
    {
        "id": "pie",
        "categoryId": "bakery",
        "name": "Вишнёвый пирог",
        "description": "Пирог с ягодной начинкой",
        "ingredients": "Вишня, мука, сахар",
        "allergens": ["глютен"],
        "dietaryTags": ["без орехов"],
        "searchKeywords": ["ягоды"],
        "weightGrams": 600,
        "nutrition": {"caloriesKcal": 1600, "proteinGrams": 24, "fatGrams": 60, "carbsGrams": 230},
        "price": 4500,
        "imageUrl": "",
        "onlineOrderable": True,
        "preparationMinutes": 20,
    },
]

CART = json.dumps(
    [
        {
            "id": "croissant",
            "cartKey": "croissant",
            "name": "Круассан миндальный",
            "price": 1800,
            "basePrice": 1800,
            "imageUrl": "",
            "isStopListed": False,
            "quantity": 2,
            "configuration": None,
            "modifiers": [],
        }
    ],
    ensure_ascii=False,
)


def fulfill(route, payload, status=200):
    route.fulfill(status=status, content_type="application/json", body=json.dumps(payload))


def make_api_route(state, slow=False):
    def api_route(route):
        path = urlparse(route.request.url).path
        if path.endswith("/api/guest/menu"):
            if state["menu_offline"]:
                route.abort("internetdisconnected")
                return
            if slow:
                time.sleep(0.35)
            fulfill(route, {"success": True, "categories": CATEGORIES, "products": PRODUCTS})
        elif path.endswith("/api/guest/profile"):
            fulfill(route, {"success": True, "exists": True, "customer": CUSTOMER, "transactions": []})
        elif path.endswith("/api/customer/loyalty"):
            fulfill(route, {"success": True, "loyalty": CUSTOMER["tier"]})
        elif path.endswith("/api/guest/stories"):
            fulfill(route, {"success": True, "stories": []})
        elif path.endswith("/api/guest/news"):
            fulfill(route, {"success": True, "news": []})
        else:
            fulfill(route, {"success": True, "notifications": [], "cities": [], "locations": []})

    return api_route


SCENARIOS = [
    {"name": "narrow-slow", "viewport": {"width": 320, "height": 700}, "system_dark": False, "slow": True},
    {"name": "android-system-dark", "viewport": {"width": 412, "height": 915}, "system_dark": True, "slow": False},
    {"name": "landscape", "viewport": {"width": 844, "height": 390}, "system_dark": False, "slow": False},
    {"name": "tablet", "viewport": {"width": 768, "height": 1024}, "system_dark": False, "slow": False},
]
if SCENARIO_FILTER:
    SCENARIOS = [scenario for scenario in SCENARIOS if scenario["name"] == SCENARIO_FILTER]
    if not SCENARIOS:
        raise SystemExit(f"Unknown QA scenario: {SCENARIO_FILTER}")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for scenario in SCENARIOS:
        viewport = scenario["viewport"]
        state = {"menu_offline": False}
        context = browser.new_context(
            viewport=viewport,
            locale="ru-RU",
            reduced_motion="reduce",
            color_scheme="dark" if scenario["system_dark"] else "light",
        )
        page = context.new_page()
        page.route("**/api/**", make_api_route(state, slow=scenario["slow"]))
        page.add_init_script(
            f"""
            (() => {{
              const values = {{
                phone: '77000000000',
                accessToken: 'qa-token',
                customer: JSON.stringify({json.dumps(CUSTOMER)}),
                transactions: '[]',
                app_theme_mode: '{'dark' if scenario['system_dark'] else 'light'}',
                bulka_cart_v1: {json.dumps(CART)},
                lastAppScreen: 'main',
              }};
              for (const [key, value] of Object.entries(values)) {{
                localStorage.setItem(`flutter.${{key}}`, JSON.stringify(value));
              }}
            }})()
            """
        )
        errors = []
        bad_responses = []
        failed_requests = []
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on(
            "response",
            lambda response: bad_responses.append(f"{response.status} {response.url}")
            if response.status >= 400
            else None,
        )
        page.on(
            "requestfailed",
            lambda request: failed_requests.append(
                f"{request.url}: {request.failure or 'request failed'}"
            ),
        )
        page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
        try:
            page.locator("flt-glass-pane").wait_for(state="attached", timeout=45_000)
        except Exception:
            debug_screenshot = ROOT / "scratch" / f"client-qa-bootstrap-{scenario['name']}.png"
            debug_screenshot.parent.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(debug_screenshot), full_page=True)
            print(
                f"{scenario['name']} bootstrap diagnostics: errors={errors}, "
                f"responses={bad_responses}, failed={failed_requests}",
                file=sys.stderr,
            )
            raise
        page.wait_for_timeout(1800)
        assert page.locator('meta[name="color-scheme"]').get_attribute("content") == "light only"
        assert page.evaluate(
            "getComputedStyle(document.documentElement).colorScheme === 'light'"
        ), f"{scenario['name']}: browser color scheme was not forced to light"

        # Catalog: verifies delayed API, product facts payload and device layout.
        page.mouse.click(viewport["width"] * 0.30, viewport["height"] - 38)
        page.wait_for_timeout(1700)
        assert page.evaluate(
            "Object.keys(localStorage).some((key) => key.includes('catalog_cache_'))"
        ), f"{scenario['name']}: catalog was not cached"
        assert page.evaluate(
            "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
        ), f"{scenario['name']}: horizontal page overflow"

        # Cart: pre-seeded state must survive startup and navigation.
        page.mouse.click(viewport["width"] * 0.50, viewport["height"] - 38)
        page.wait_for_timeout(700)
        assert page.evaluate("localStorage.getItem('flutter.bulka_cart_v1') !== null")

        screenshot = ROOT / "scratch" / f"client-qa-{scenario['name']}.png"
        screenshot.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(screenshot), full_page=True)

        if scenario["name"] == "narrow-slow":
            # Reload with menu API unavailable. Cached catalog must keep the app usable.
            state["menu_offline"] = True
            page.reload(wait_until="domcontentloaded", timeout=120_000)
            page.locator("flt-glass-pane").wait_for(state="attached", timeout=45_000)
            page.wait_for_timeout(1400)
            page.mouse.click(viewport["width"] * 0.30, viewport["height"] - 38)
            page.wait_for_timeout(900)
            offline_screenshot = ROOT / "scratch" / "client-qa-offline-cache.png"
            page.screenshot(path=str(offline_screenshot), full_page=True)
            assert page.evaluate(
                "Object.keys(localStorage).some((key) => key.includes('catalog_cache_'))"
            )

        expected_offline = state["menu_offline"]
        unexpected_errors = [
            error
            for error in errors
            if not (expected_offline and "ERR_INTERNET_DISCONNECTED" in error)
        ]
        unexpected_failures = [
            failure
            for failure in failed_requests
            if not (
                "/api/customer/events" in failure
                or (expected_offline and "/api/guest/menu" in failure)
                or (
                    "fonts.gstatic.com/" in failure
                    and "ERR_ABORTED" in failure
                )
            )
        ]
        assert not unexpected_errors and not bad_responses and not unexpected_failures, (
            f"{scenario['name']}: browser errors={unexpected_errors}, "
            f"responses={bad_responses}, failed={unexpected_failures}"
        )
        context.close()

    browser.close()
    print("Flutter client QA matrix passed: slow/offline, cart restore, forced light, mobile, landscape, tablet")
