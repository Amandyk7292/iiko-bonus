from pathlib import Path
from urllib.parse import urlparse
import json
import sys

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4178/admin/"
ROOT = Path(__file__).resolve().parents[1]

STATS = {
    "totalCustomers": 1250,
    "newCustomersLast30Days": 42,
    "totalSales": 728000,
    "bonusPaymentPercent": 7.5,
    "totalEarned": 31200,
    "totalBurned": 18400,
    "currentLiabilities": 98500,
}
TIERS = {
    "success": True,
    "tiers": [
        {
            "id": "d3d5fce9-fbcd-4d19-ae2a-0bd37a80eea1",
            "code": "bronze",
            "names": {"ru": "Бронза", "kk": "Қола", "en": "Bronze"},
            "descriptions": {
                "ru": "Стартовый уровень",
                "kk": "Бастапқы деңгей",
                "en": "Starting tier",
            },
            "minSpend": 0,
            "cashbackPercent": 3,
            "sortOrder": 0,
            "isActive": True,
        },
        {
            "id": "6eaec4f7-98df-48ed-a2ce-c08d19d1832d",
            "code": "gold",
            "names": {"ru": "Золото", "kk": "Алтын", "en": "Gold"},
            "descriptions": {
                "ru": "Повышенный кэшбэк",
                "kk": "Жоғары кэшбэк",
                "en": "Higher cashback",
            },
            "minSpend": 150000,
            "cashbackPercent": 7,
            "sortOrder": 1,
            "isActive": True,
        },
    ],
}
ORDERS = {
    "success": True,
    "total": 1,
    "page": 1,
    "pageSize": 50,
    "orders": [
        {
            "id": "11111111-1111-4111-8111-111111111111",
            "number": 530383,
            "paymentStatus": "paid",
            "orderStatus": "new",
            "amount": 2500,
            "subtotal": 2500,
            "discount": 0,
            "branch": "Тауке Хана",
            "items": [{"name": "Вишнёво-яблочный пирог", "quantity": 1}],
            "earnedBonus": 125,
            "createdAt": "2026-07-13T08:44:00Z",
            "updatedAt": "2026-07-13T08:44:00Z",
            "customer": {"name": "Алия", "phone": "77000000000"},
        }
    ],
}


def fulfill_json(route, payload, status=200):
    route.fulfill(status=status, content_type="application/json", body=json.dumps(payload))


logged_in = {"value": False}


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
    elif path.endswith("/admin/api/stats"):
        fulfill_json(route, STATS)
    elif path.endswith("/admin/api/loyalty-tiers"):
        fulfill_json(route, TIERS)
    elif path.endswith("/admin/api/orders"):
        fulfill_json(route, ORDERS)
    else:
        fulfill_json(route, {"success": True, "data": []})


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 1440, "height": 960},
        locale="ru-RU",
        reduced_motion="reduce",
    )
    page = context.new_page()
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.route("**/admin/api/**", route_api)

    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    page.get_by_role("textbox", name="Имя пользователя").fill("admin")
    page.get_by_role("textbox", name="Пароль").fill("test-password")
    page.get_by_role("button", name="Войти в систему").click()
    page.get_by_role("heading", name="Аналитика").wait_for()
    page.get_by_text("Всего клиентов", exact=True).wait_for()
    assert page.get_by_label("Язык интерфейса").count() == 1

    page.get_by_role("link", name="Заказы").click()
    page.get_by_role("heading", name="Заказы").wait_for()
    page.get_by_text("№530383", exact=True).wait_for()
    assert page.get_by_text("Тауке Хана", exact=True).is_visible()

    page.get_by_role("link", name="Уровни кэшбэка").click()
    page.get_by_role("heading", name="Уровни кэшбэка").wait_for()
    assert page.get_by_role("heading", name="Бронза", exact=True).is_visible()
    assert page.get_by_role("heading", name="Золото", exact=True).is_visible()

    page.get_by_role("button", name="Создать уровень").click()
    cashback_input = page.locator("#tier-cashback")
    assert cashback_input.input_value() == "0"
    cashback_input.fill("")
    assert cashback_input.input_value() == ""
    cashback_input.fill("5")
    assert cashback_input.input_value() == "5"
    page.get_by_role("button", name="Закрыть").click()

    page.set_viewport_size({"width": 375, "height": 812})
    page.wait_for_timeout(400)
    sidebar_box = page.locator(".sagi-sidebar").bounding_box()
    assert sidebar_box is not None and sidebar_box["x"] + sidebar_box["width"] <= 0, (
        f"mobile sidebar remained visible: box={sidebar_box}, "
        f"class={page.locator('.sagi-sidebar').get_attribute('class')}"
    )
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.screenshot(path=str(ROOT / "scratch" / "admin-ui-e2e.png"), full_page=True)

    unexpected_errors = [error for error in console_errors if "401" not in error]
    assert not unexpected_errors, f"Browser console errors: {unexpected_errors}"
    print("Admin UI E2E passed")
    context.close()
    browser.close()
