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
OPERATIONS_SUMMARY = {
    "success": True,
    "updatedAt": "2026-07-25T12:00:00Z",
    "capabilities": {
        "orders": True,
        "kitchen": True,
        "dispatch": True,
        "support": True,
        "whatsapp": True,
        "inventory": True,
    },
    "counts": {
        "newOrders": 1,
        "activeOrders": 1,
        "kitchenOverdue": 0,
        "deliveryAttention": 0,
        "paymentIssues": 0,
        "supportNew": 0,
        "supportOverdue": 0,
        "supportMine": 0,
        "whatsappUnread": 0,
        "whatsappDialogs": 0,
        "stoppedProducts": 0,
    },
    "orders": [],
    "support": [],
    "whatsapp": [],
}
STORY_COVER = (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1080' "
    "height='480'%3E%3Crect width='100%25' height='100%25' fill='%23f6ead7'/%3E%3C/svg%3E"
)
STORY_VERTICAL = (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1080' "
    "height='1920'%3E%3Crect width='100%25' height='100%25' fill='%23f6ead7'/%3E%3C/svg%3E"
)
LEGACY_STORY = {
    "id": "story-legacy",
    "title": "Счастливые часы после 20:00",
    "description": "На все выпечки 20% скидка",
    "coverUrl": STORY_COVER,
    "contentUrl": STORY_VERTICAL,
    "groupId": "happy-hours",
    "groupTitle": "Счастливые часы после 20:00",
    "groupCoverUrl": STORY_COVER,
    "duration": 15,
    "sortOrder": 1,
    "i18n": {
        "ru": {
            "title": "Счастливые часы после 20:00",
            "description": "На все выпечки 20% скидка",
            "coverUrl": STORY_COVER,
            "contentUrl": STORY_VERTICAL,
        },
        "kz": {"title": "", "description": "", "coverUrl": "", "contentUrl": ""},
        "en": {"title": "", "description": "", "coverUrl": "", "contentUrl": ""},
    },
}


def fulfill_json(route, payload, status=200):
    route.fulfill(status=status, content_type="application/json", body=json.dumps(payload))


logged_in = {"value": False}
story_updates = []


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
    elif path.endswith("/admin/api/security/status"):
        fulfill_json(
            route,
            {
                "success": True,
                "multiAdmin": True,
                "mfaRequired": True,
                "legacySingleAdmin": False,
                "user": {"username": "admin", "role": "owner"},
                "configuredUsers": [{"username": "admin", "role": "owner", "mfa": True}],
            },
        )
    elif path.endswith("/admin/api/audit-logs"):
        fulfill_json(route, {"success": True, "logs": [], "total": 0})
    elif path.endswith("/admin/api/orders"):
        fulfill_json(route, ORDERS)
    elif path.endswith("/admin/api/operations/summary"):
        fulfill_json(route, OPERATIONS_SUMMARY)
    elif path.endswith("/admin/api/scope"):
        fulfill_json(route, {"success": True, "locations": []})
    elif path.endswith("/admin/api/transactions"):
        fulfill_json(
            route,
            [
                {
                    "id": "transaction-1",
                    "type": "order",
                    "order_id": "16523488492",
                    "order_total": 2500,
                    "amount": 0,
                    "timestamp": "2026-07-15T18:10:00Z",
                    "customers": {"name": "Алия", "phone": "77000000000"},
                    "items": [],
                }
            ],
        )
    elif path.endswith("/admin/api/stories") and request.method == "GET":
        fulfill_json(route, {"success": True, "stories": [LEGACY_STORY]})
    elif "/admin/api/stories/" in path and request.method == "PUT":
        story_updates.append(request.post_data_json)
        fulfill_json(route, {"success": True, "story": request.post_data_json})
    elif path.endswith("/admin/api/promotions"):
        fulfill_json(
            route,
            {
                "success": True,
                "promotions": [
                    {
                        "id": "promo-1",
                        "code": "WELCOME10",
                        "title": "Welcome offer",
                        "discount_type": "percent",
                        "discount_value": 10,
                        "customer_ids": [],
                        "customer_tags": [],
                        "used_count": 3,
                        "usage_limit": 100,
                        "ends_at": None,
                    }
                ],
            },
        )
    elif path.endswith("/admin/api/gift-cards"):
        fulfill_json(route, {"success": True, "giftCards": []})
    elif path.endswith("/admin/api/automations"):
        fulfill_json(
            route,
            {
                "success": True,
                "automations": [
                    {
                        "id": "automation-1",
                        "trigger_type": "birthday",
                        "title_translations": {
                            "ru": "Поздравление с днём рождения",
                            "en": "Birthday greeting",
                        },
                        "body_translations": {
                            "ru": "Дарим подарок к вашему празднику",
                            "en": "A gift for your special day",
                        },
                        "config": {},
                        "active": True,
                    }
                ],
            },
        )
    elif path.endswith("/admin/api/events"):
        route.fulfill(
            status=200,
            headers={
                "content-type": "text/event-stream",
                "cache-control": "no-cache",
            },
            body="event: connected\ndata: {}\n\n",
        )
    else:
        fulfill_json(route, {"success": True, "data": []})


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 1440, "height": 960},
        locale="ru-RU",
        reduced_motion="reduce",
        color_scheme="dark",
    )
    page = context.new_page()
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)
    page.on("pageerror", lambda error: console_errors.append(str(error)))
    page.route("**/admin/api/**", route_api)
    page.route(
        "**/assets/assets/fonts/**",
        lambda route: route.fulfill(
            status=200,
            content_type="font/ttf",
            body=(ROOT / "BulkaAndroid" / "assets" / "fonts" / Path(urlparse(route.request.url).path).name).read_bytes(),
        ),
    )
    page.route(
        "**/maps/yandex**",
        lambda route: route.fulfill(status=200, content_type="text/html", body="<main>Map</main>"),
    )

    page.goto(BASE_URL)
    page.wait_for_load_state("networkidle")
    assert page.evaluate(
        "getComputedStyle(document.documentElement).colorScheme === 'light'"
    ), "admin UI did not stay light with a dark system preference"
    page.get_by_role("textbox", name="Имя пользователя").fill("admin")
    page.get_by_role("textbox", name="Пароль").fill("test-password")
    page.get_by_role("button", name="Войти в систему").click()
    page.get_by_role("heading", name="Операционный центр").wait_for()
    page.get_by_text("Что требует внимания сейчас", exact=True).wait_for()
    assert page.get_by_label("Язык интерфейса").count() == 0
    assert page.get_by_text("OWNER", exact=True).count() == 0
    assert page.evaluate("document.documentElement.lang") == "ru"

    page.get_by_role("button", name="Скрыть боковое меню").click()
    page.wait_for_timeout(220)
    assert "sidebar-is-collapsed" in (page.locator(".sagi-shell").get_attribute("class") or "")
    assert page.locator(".sagi-sidebar").get_attribute("aria-hidden") == "true"
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    page.get_by_role("button", name="Открыть меню").click()
    page.wait_for_timeout(220)
    assert "sidebar-is-collapsed" not in (page.locator(".sagi-shell").get_attribute("class") or "")

    page.get_by_role("button", name="Операции").click()
    page.locator('.sagi-sidebar a[href="/admin/orders"]').click()
    page.get_by_role("heading", name="Заказы").wait_for()
    page.get_by_text("№530383", exact=True).wait_for()
    assert page.get_by_text("Тауке Хана", exact=True).is_visible()
    payment_filter = page.get_by_role("combobox", name="Оплата")
    payment_filter.focus()
    payment_filter.press("ArrowDown")
    assert payment_filter.get_attribute("aria-expanded") == "true"
    page.screenshot(path=str(ROOT / "scratch" / "admin-select-open.png"), full_page=True)
    payment_filter.press("Escape")
    assert payment_filter.get_attribute("aria-expanded") == "false"

    page.get_by_role("combobox", name="Изменить статус").click()
    page.get_by_role("option", name="Отменён", exact=True).click()
    cancellation_dialog = page.get_by_role("dialog")
    cancellation_dialog.get_by_label("Причина отмены (необязательно)").fill("Тест формы")
    page.screenshot(path=str(ROOT / "scratch" / "admin-cancellation-modal.png"), full_page=True)
    cancellation_dialog.get_by_role("button", name="Отмена", exact=True).click()

    page.get_by_role("button", name="Обзор", exact=True).click()
    page.get_by_role("link", name="Транзакции", exact=True).click()
    page.get_by_role("heading", name="Транзакции", exact=True).wait_for()
    page.get_by_text("Заказ", exact=True).wait_for()
    assert page.get_by_text("transaction.order", exact=True).count() == 0

    page.get_by_role("button", name="Лояльность").click()
    page.get_by_role("link", name="Уровни кэшбэка").click()
    page.get_by_role("heading", name="Уровни кэшбэка").wait_for()
    page.get_by_role("heading", name="Бронза", exact=True).wait_for()
    assert page.get_by_role("heading", name="Золото", exact=True).is_visible()

    page.get_by_role("button", name="Создать уровень").click()
    cashback_input = page.locator("#tier-cashback")
    assert cashback_input.input_value() == "0"
    cashback_input.fill("")
    assert cashback_input.input_value() == ""
    cashback_input.fill("5")
    assert cashback_input.input_value() == "5"

    spend_input = page.locator("#tier-spend")
    spend_input.fill("")
    spend_input.type("55", delay=75)
    spend_value = spend_input.input_value()
    assert spend_value == "55", f"tier-spend value after typing: {spend_value!r}"
    assert page.evaluate("document.activeElement?.id") == "tier-spend"
    page.get_by_role("button", name="Закрыть").click()

    page.get_by_role("button", name="Операции").click()
    page.get_by_role("link", name="Диспетчерская", exact=True).click()
    page.get_by_role("heading", name="Диспетчерская", exact=True).wait_for()
    page.get_by_role("link", name="Экран кухни", exact=True).click()
    page.get_by_role("heading", name="Экран кухни", exact=True).first.wait_for()

    page.get_by_role("button", name="Клиенты", exact=True).click()
    page.get_by_role("link", name="Отзывы и жалобы", exact=True).click()
    page.get_by_role("heading", name="Отзывы и жалобы", exact=True).first.wait_for()

    page.get_by_role("button", name="Лояльность", exact=True).click()
    page.get_by_role("link", name="CRM и сертификаты", exact=True).click()
    page.get_by_role("heading", name="CRM и автоматизация", exact=True).wait_for()
    page.get_by_text("WELCOME10", exact=True).wait_for()
    page.get_by_role("tab", name="Автоматические рассылки", exact=True).click()
    page.get_by_role("button", name="Текст", exact=True).click()
    automation_dialog = page.get_by_role("dialog")
    automation_dialog.get_by_label("Заголовок push").fill("Обновлённый заголовок")
    automation_dialog.get_by_label("Текст push").fill("Обновлённый текст")
    page.screenshot(path=str(ROOT / "scratch" / "admin-automation-form.png"), full_page=True)
    automation_dialog.get_by_role("button", name="Отмена", exact=True).click()

    page.get_by_role("button", name="Система", exact=True).click()
    page.get_by_role("link", name="Роли и доступ", exact=True).click()
    page.get_by_role("heading", name="Роли и доступ", exact=True).first.wait_for()

    page.get_by_role("button", name="Контент", exact=True).click()
    page.get_by_role("link", name="Меню и блюда", exact=True).click()
    page.get_by_role("heading", name="Управление меню", exact=True).wait_for()
    assert page.get_by_role("heading", name="Управление меню", exact=True).count() == 1
    page.get_by_role("heading", name="Блюд пока нет", exact=True).wait_for()

    page.get_by_role("link", name="Акции и баннеры", exact=True).click()
    page.get_by_role("heading", name="Слайдер акций и истории", exact=True).wait_for()
    page.get_by_text("Счастливые часы после 20:00", exact=True).wait_for()
    page.get_by_role("button", name="Редактировать", exact=True).click()
    story_dialog = page.get_by_role("dialog")
    assert story_dialog.locator("#story-title-ru").input_value() == "Счастливые часы после 20:00"
    story_dialog.get_by_role("tab", name="Казахский", exact=True).click()
    assert story_dialog.locator("#story-title-kz").get_attribute("required") is None
    story_dialog.get_by_role("tab", name="Русский", exact=True).click()
    story_dialog.get_by_role("button", name="Сохранить", exact=True).click()
    page.get_by_text("Акция сохранена", exact=True).wait_for()
    assert len(story_updates) == 1
    assert story_updates[0]["i18n"]["kz"]["title"] == ""
    assert story_updates[0]["i18n"]["en"]["title"] == ""

    page.get_by_role("button", name="Лояльность", exact=True).click()
    page.get_by_role("link", name="CRM и сертификаты", exact=True).click()
    page.get_by_text("WELCOME10", exact=True).wait_for()

    page.set_viewport_size({"width": 375, "height": 812})
    page.wait_for_timeout(400)
    sidebar_box = page.locator(".sagi-sidebar").bounding_box()
    assert sidebar_box is not None and sidebar_box["x"] + sidebar_box["width"] <= 0, (
        f"mobile sidebar remained visible: box={sidebar_box}, "
        f"class={page.locator('.sagi-sidebar').get_attribute('class')}"
    )
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")
    assert page.get_by_label("Язык интерфейса").count() == 0
    promo_code_cell = page.locator("td[data-label='Код']").first
    assert promo_code_cell.is_visible()
    assert "Код" in promo_code_cell.evaluate(
        "element => getComputedStyle(element, '::before').content"
    )
    logout_box = page.locator(".topbar-logout").bounding_box()
    assert logout_box is not None and logout_box["width"] >= 44 and logout_box["height"] >= 44, (
        f"mobile logout target is too small: {logout_box}"
    )
    page.screenshot(path=str(ROOT / "scratch" / "admin-ui-e2e.png"), full_page=True)

    audited_routes = [
        "analytics", "transactions", "iiko", "broadcast", "contacts",
        "customers", "orders", "menu", "settings", "stories", "news",
        "bonus", "tiers", "locations", "inventory", "couriers", "dispatch",
        "kitchen", "marketing", "reviews", "access", "security",
    ]
    for width in (1440, 1024, 768, 375):
        page.set_viewport_size({"width": width, "height": 900})
        for route_name in audited_routes:
            page.goto(f"{BASE_URL.rstrip('/')}/{route_name}")
            page.locator("h1.sagi-page-title").wait_for()
            page.wait_for_timeout(80)
            layout = page.evaluate(
                """() => {
                  const viewport = document.documentElement.clientWidth;
                  const visible = element => {
                    const style = getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                  };
                  const offenders = [...document.querySelectorAll('h1, h2, h3, p, label, button, .card, .status-pill')]
                    .filter(element => visible(element))
                    .filter(element => !element.closest('[aria-hidden="true"], .responsive-table-wrap, .select-control-menu'))
                    .map(element => {
                      const rect = element.getBoundingClientRect();
                      return { tag: element.tagName, text: (element.textContent || '').trim().slice(0, 70), left: rect.left, right: rect.right };
                    })
                    .filter(item => item.left < -1 || item.right > viewport + 1);
                  return {
                    viewport,
                    documentWidth: document.documentElement.scrollWidth,
                    bodyWidth: document.body.scrollWidth,
                    offenders,
                  };
                }"""
            )
            assert layout["documentWidth"] <= layout["viewport"], (
                f"horizontal document overflow at {width}px on /{route_name}: {layout}"
            )
            assert layout["bodyWidth"] <= layout["viewport"], (
                f"horizontal body overflow at {width}px on /{route_name}: {layout}"
            )
            assert not layout["offenders"], (
                f"visible controls/text left viewport at {width}px on /{route_name}: {layout['offenders']}"
            )

    page.set_viewport_size({"width": 1440, "height": 960})
    page.goto(f"{BASE_URL.rstrip('/')}/analytics")
    page.get_by_role("heading", name="Аналитика").wait_for()
    page.screenshot(path=str(ROOT / "scratch" / "admin-layout-audit.png"), full_page=True)

    unexpected_errors = [error for error in console_errors if "401" not in error]
    assert not unexpected_errors, f"Browser console errors: {unexpected_errors}"
    print("Admin UI E2E passed")
    context.close()
    browser.close()
