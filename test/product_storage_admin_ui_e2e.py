from pathlib import Path
from urllib.parse import urlparse
import json
import sys

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4179/admin/"
ADMIN_ROOT = BASE_URL.rstrip("/")
ROOT = Path(__file__).resolve().parents[1]

MENU = {
    "success": True,
    "rawMenu": {
        "groups": [{"id": "buns", "name": "Булочки", "order": 1}],
        "products": [
            {
                "id": "bun-1",
                "name": "Плюшка Московская",
                "description": "Свежая выпечка",
                "parentGroup": "buns",
                "price": 500,
                "imageLinks": [],
            }
        ],
    },
    "overrides": {
        "products": [
            {
                "iiko_product_id": "bun-1",
                "storage_conditions": [
                    {
                        "temperature": "-18 °C",
                        "duration_value": 90,
                        "duration_unit": "days",
                    },
                    {
                        "temperature": "4±2 °C",
                        "duration_value": 72,
                        "duration_unit": "hours",
                    },
                ],
            }
        ],
        "categories": [],
        "customProducts": [],
    },
}


def fulfill_json(route, payload, status=200):
    route.fulfill(status=status, content_type="application/json", body=json.dumps(payload))


def run_viewport(browser, width, height, verify_save=False):
    logged_in = {"value": False}
    saves = []
    context = browser.new_context(viewport={"width": width, "height": height}, locale="ru-RU")
    page = context.new_page()
    page_errors = []
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    def route_api(route):
        request = route.request
        path = urlparse(request.url).path
        if path.endswith("/admin/api/login") and request.method == "POST":
            logged_in["value"] = True
            fulfill_json(route, {"user": {"username": "admin", "role": "admin"}})
        elif path.endswith("/admin/api/session"):
            if logged_in["value"]:
                fulfill_json(route, {"user": {"username": "admin", "role": "admin"}})
            else:
                fulfill_json(route, {"error": "Unauthorized"}, status=401)
        elif path.endswith("/admin/api/menu") and request.method == "GET":
            fulfill_json(route, MENU)
        elif path.endswith("/admin/api/menu/product/override") and request.method == "POST":
            saves.append(request.post_data_json)
            fulfill_json(route, {"success": True})
        elif path.endswith("/admin/api/stats"):
            fulfill_json(route, {"totalCustomers": 0})
        elif path.endswith("/admin/api/events"):
            route.fulfill(
                status=200,
                headers={"content-type": "text/event-stream", "cache-control": "no-cache"},
                body="event: connected\ndata: {}\n\n",
            )
        else:
            fulfill_json(route, {"success": True, "data": []})

    page.route("**/admin/api/**", route_api)
    page.route(
        "**/assets/assets/fonts/**",
        lambda route: route.fulfill(
            status=200,
            content_type="font/ttf",
            body=(
                ROOT
                / "BulkaAndroid"
                / "assets"
                / "fonts"
                / Path(urlparse(route.request.url).path).name
            ).read_bytes(),
        ),
    )

    page.goto(f"{ADMIN_ROOT}/")
    page.wait_for_load_state("networkidle")
    page.get_by_role("textbox", name="Имя пользователя").fill("admin")
    page.get_by_role("textbox", name="Пароль").fill("test-password")
    page.get_by_role("button", name="Войти в систему").click()
    page.get_by_role("heading", name="Операционный центр").wait_for()

    page.goto(f"{ADMIN_ROOT}/menu")
    page.wait_for_load_state("networkidle")
    page.get_by_role("heading", name="Управление меню", exact=True).wait_for()
    page.get_by_role("button", name="Изменить", exact=True).click()
    dialog = page.get_by_role("dialog")
    storage_heading = dialog.get_by_text("Срок и условия хранения", exact=True)
    storage_heading.wait_for()

    assert dialog.locator("#edit-product-storage-temperature-0").input_value() == "-18 °C"
    assert dialog.locator("#edit-product-storage-duration-0").input_value() == "90"
    assert dialog.locator("#edit-product-storage-temperature-1").input_value() == "4±2 °C"
    assert dialog.locator("#edit-product-storage-duration-1").input_value() == "72"
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")

    storage_heading.scroll_into_view_if_needed()
    screenshot = ROOT / "scratch" / f"admin-product-storage-{width}.png"
    screenshot.parent.mkdir(exist_ok=True)
    page.screenshot(path=str(screenshot), full_page=True)

    if verify_save:
        dialog.locator("#edit-product-storage-duration-1").fill("96")
        dialog.get_by_role("button", name="Сохранить", exact=True).click()
        page.get_by_text("Изменения сохранены", exact=True).wait_for()
        assert len(saves) == 1
        conditions = saves[0]["overrides"]["storage_conditions"]
        assert conditions[0] == {
            "temperature": "-18 °C",
            "duration_value": 90,
            "duration_unit": "days",
        }
        assert conditions[1] == {
            "temperature": "4±2 °C",
            "duration_value": 96,
            "duration_unit": "hours",
        }

    assert not page_errors, page_errors
    context.close()


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    run_viewport(browser, 1440, 960, verify_save=True)
    run_viewport(browser, 390, 844)
    browser.close()

print("Admin product storage fields passed at 1440px and 390px")
