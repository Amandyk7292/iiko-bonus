import copy
import json
from pathlib import Path
import sys
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4327/admin/integrations"
OUTPUT_DIR = Path(sys.argv[2] if len(sys.argv) > 2 else "scratch/payment-diagnostics-e2e")
ROOT = Path(__file__).resolve().parents[1]

BASE_PROVIDER = {
    "enabled": True,
    "configured": True,
    "available": True,
    "checkedAt": "2026-07-27T12:00:00.000Z",
    "message": "Сервис отвечает",
}


def initial_diagnostics():
    return {
        "canManage": True,
        "checkedAt": "2026-07-27T12:00:00.000Z",
        "mode": {
            "widgetEnabled": False,
            "effectiveIntegration": "hosted_page",
            "fallbackActive": False,
            "fallbackReason": "widget_disabled",
            "updatedAt": None,
        },
        "providers": {
            "kaspi": copy.deepcopy(BASE_PROVIDER),
            "forteHosted": copy.deepcopy(BASE_PROVIDER),
            "forteWidget": {
                **copy.deepcopy(BASE_PROVIDER),
                "enabled": False,
                "available": None,
                "checkedAt": None,
                "message": "Проверка ещё не запускалась",
                "errorCode": None,
                "availableMethods": [],
            },
        },
        "webhooks": {
            "kaspi": {
                "configured": True,
                "lastSuccessAt": "2026-07-27T11:55:00.000Z",
                "lastFailureAt": None,
                "lastErrorCode": None,
            },
            "forteWidget": {
                "configured": True,
                "lastSuccessAt": None,
                "lastFailureAt": None,
                "lastErrorCode": None,
            },
        },
        "cleanup": {
            "checkedAt": "2026-07-27T11:59:00.000Z",
            "inspected": 3,
            "expired": 1,
            "cancelled": 1,
            "released": 1,
            "errors": 0,
        },
        "latestErrors": [],
    }


def json_response(route, payload, status=200):
    route.fulfill(
        status=status,
        content_type="application/json; charset=utf-8",
        body=json.dumps(payload, ensure_ascii=False),
    )


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    payments = initial_diagnostics()
    mutations = []
    browser_errors = []
    http_errors = []

    def capture_console_error(message):
        if message.type == "error" and "Failed to load resource" not in message.text:
            browser_errors.append(message.text)

    def capture_http_error(response):
        if response.status >= 400:
            http_errors.append(f"{response.status} {response.url}")

    def route_admin_api(route):
        nonlocal payments
        request = route.request
        path = urlparse(request.url).path
        if path == "/admin/api/session":
            return json_response(
                route,
                {
                    "user": {
                        "username": "owner",
                        "role": "owner",
                        "branchIds": [],
                        "actions": ["*"],
                    }
                },
            )
        if path == "/admin/api/scope":
            return json_response(
                route,
                {"success": True, "locations": [], "selectedBranchId": None},
            )
        if path == "/admin/api/integrations/status":
            return json_response(
                route,
                {
                    "success": True,
                    "checkedAt": "2026-07-27T12:00:00.000Z",
                    "services": [],
                    "payments": payments,
                },
            )
        if path == "/admin/api/operations/summary":
            return json_response(
                route,
                {
                    "success": True,
                    "updatedAt": "2026-07-27T12:00:00.000Z",
                    "capabilities": {},
                    "counts": {},
                    "orders": [],
                    "support": [],
                    "whatsapp": [],
                },
            )
        if path == "/admin/api/integrations/payments/widget" and request.method == "PUT":
            mutations.append({"path": path, "body": request.post_data_json})
            payments["mode"].update(
                {
                    "widgetEnabled": True,
                    "fallbackActive": True,
                    "fallbackReason": "widget_unhealthy",
                }
            )
            payments["providers"]["forteWidget"].update(
                {
                    "enabled": True,
                    "available": False,
                    "checkedAt": "2026-07-27T12:01:00.000Z",
                    "message": "Банк не вернул доступные карты",
                    "errorCode": "FORTE_WIDGET_NO_PAYMENT_METHODS",
                }
            )
            return json_response(route, {"success": True, "payments": payments})
        if path == "/admin/api/integrations/payments/probe" and request.method == "POST":
            mutations.append({"path": path, "body": None})
            payments["mode"].update(
                {
                    "effectiveIntegration": "widget",
                    "fallbackActive": False,
                    "fallbackReason": None,
                }
            )
            payments["providers"]["forteWidget"].update(
                {
                    "available": True,
                    "checkedAt": "2026-07-27T12:02:00.000Z",
                    "message": "Карты доступны, списания не было",
                    "errorCode": None,
                    "availableMethods": ["credit_card"],
                }
            )
            return json_response(route, {"success": True, "payments": payments})
        if path == "/admin/api/events":
            return route.fulfill(
                status=200,
                headers={"content-type": "text/event-stream", "cache-control": "no-cache"},
                body="event: connected\ndata: {}\n\n",
            )
        return json_response(route, {"error": f"Unexpected test route: {path}"}, 404)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 960}, locale="ru-RU")
        page.on("console", capture_console_error)
        page.on("pageerror", lambda error: browser_errors.append(str(error)))
        page.on("response", capture_http_error)
        page.route("**/admin/api/**", route_admin_api)
        page.route(
            "**/admin/assets/fonts/**",
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
        page.goto(BASE_URL)
        page.wait_for_load_state("networkidle")

        body_text = page.locator("body").inner_text()
        assert "Диагностика оплат" in body_text
        assert "Страница банка /flex" in body_text
        page.screenshot(path=str(OUTPUT_DIR / "payments-before.png"), full_page=True)

        mode_switch = page.get_by_role(
            "switch", name="Использовать Forte Widget для новых оплат"
        )
        assert mode_switch.get_attribute("aria-checked") == "false"
        mode_switch.click()
        page.get_by_text(
            "Widget включён, но новые оплаты безопасно открываются через /flex.",
            exact=True,
        ).wait_for()
        assert mode_switch.get_attribute("aria-checked") == "true"

        page.get_by_role("button", name="Запустить проверку").click()
        page.get_by_text(
            "Проверка завершена: Widget принимает карты, списания не было.",
            exact=True,
        ).wait_for()
        page.get_by_text("Карты доступны, списания не было", exact=True).wait_for()
        page.screenshot(path=str(OUTPUT_DIR / "payments-after.png"), full_page=True)
        dimensions = page.evaluate(
            "({scrollWidth: document.documentElement.scrollWidth,"
            " clientWidth: document.documentElement.clientWidth})"
        )
        assert dimensions["scrollWidth"] <= dimensions["clientWidth"]

        mobile = browser.new_page(viewport={"width": 375, "height": 812}, locale="ru-RU")
        mobile.on("console", capture_console_error)
        mobile.on("pageerror", lambda error: browser_errors.append(str(error)))
        mobile.on("response", capture_http_error)
        mobile.route("**/admin/api/**", route_admin_api)
        mobile.route(
            "**/admin/assets/fonts/**",
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
        mobile.goto(BASE_URL)
        mobile.wait_for_load_state("networkidle")
        mobile.get_by_role("heading", name="Диагностика оплат").wait_for()
        mobile_dimensions = mobile.evaluate(
            "({scrollWidth: document.documentElement.scrollWidth,"
            " clientWidth: document.documentElement.clientWidth})"
        )
        assert mobile_dimensions["scrollWidth"] <= mobile_dimensions["clientWidth"]
        mobile.screenshot(path=str(OUTPUT_DIR / "payments-mobile.png"), full_page=True)
        assert not browser_errors, browser_errors
        assert not http_errors, http_errors
        browser.close()

    assert mutations == [
        {
            "path": "/admin/api/integrations/payments/widget",
            "body": {"enabled": True},
        },
        {"path": "/admin/api/integrations/payments/probe", "body": None},
    ]
    print(
        json.dumps(
            {
                "mutations": mutations,
                "desktop": dimensions,
                "mobile": mobile_dimensions,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
