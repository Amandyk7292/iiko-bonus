import json
import pathlib
import sys
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4174/admin"
ADMIN_ROOT = BASE_URL.rstrip("/")
OUTPUT_DIR = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else ".tmp")


def json_response(route, payload, status=200):
    route.fulfill(
        status=status,
        content_type="application/json; charset=utf-8",
        body=json.dumps(payload, ensure_ascii=False),
    )


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    saved_payloads = []
    browser_errors = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("console", lambda message: browser_errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: browser_errors.append(str(error)))

        def handle_admin_api(route):
            request = route.request
            path = urlparse(request.url).path
            if path == "/admin/api/session":
                return json_response(route, {"user": {"username": "admin", "role": "admin"}})
            if path == "/admin/api/access":
                return json_response(
                    route,
                    {
                        "success": True,
                        "configuredUsers": ["admin"],
                        "profiles": [
                            {
                                "username": "admin",
                                "display_name": "Владелец",
                                "role": "owner",
                                "branch_ids": [],
                                "active": True,
                            }
                        ],
                    },
                )
            if path == "/admin/api/locations":
                return json_response(route, {"success": True, "locations": []})
            if path == "/admin/api/scope":
                return json_response(route, {"success": True, "locations": []})
            if path == "/admin/api/operations/summary":
                return json_response(route, {"success": True})
            if path == "/admin/api/events":
                return route.fulfill(
                    status=200,
                    headers={
                        "content-type": "text/event-stream",
                        "cache-control": "no-cache",
                    },
                    body="event: connected\ndata: {}\n\n",
                )
            if path == "/admin/api/site-access" and request.method == "GET":
                return json_response(
                    route,
                    {
                        "success": True,
                        "config": saved_payloads[-1]
                        if saved_payloads
                        else {"enabled": False, "allowedIps": ["203.0.113.10"]},
                        "currentIp": "198.51.100.25",
                    },
                )
            if path == "/admin/api/site-access" and request.method == "PUT":
                payload = request.post_data_json
                saved_payloads.append(payload)
                return json_response(
                    route,
                    {
                        "success": True,
                        "config": payload,
                        "currentIp": "198.51.100.25",
                    },
                )
            return json_response(route, {"error": f"Unexpected test API route: {path}"}, 404)

        page.route("**/admin/api/**", handle_admin_api)
        page.goto(f"{ADMIN_ROOT}/access")
        page.wait_for_load_state("networkidle")

        page.get_by_role("heading", name="Роли и доступ", level=2).wait_for()
        page.get_by_text("198.51.100.25", exact=True).wait_for()
        page.screenshot(path=str(OUTPUT_DIR / "site-access-desktop.png"), full_page=True)

        page.get_by_role("button", name="Добавить мой IP").click()
        ip_input = page.get_by_label("Новый разрешённый IP")
        ip_input.fill("2001:db8::1")
        page.locator(".site-access-add-form").get_by_role("button", name="Добавить", exact=True).click()
        access_toggle = page.locator('.site-access-header input[type="checkbox"]')
        access_toggle.focus()
        page.keyboard.press("Space")
        assert access_toggle.is_checked()
        page.get_by_role("button", name="Сохранить доступ").click()
        page.get_by_text("Сайт доступен только для 3 IP.", exact=True).wait_for()

        assert saved_payloads == [
            {
                "enabled": True,
                "allowedIps": ["203.0.113.10", "198.51.100.25", "2001:db8::1"],
            }
        ]

        mobile_page = browser.new_page(viewport={"width": 375, "height": 812})
        mobile_page.on(
            "console",
            lambda message: browser_errors.append(message.text) if message.type == "error" else None,
        )
        mobile_page.on("pageerror", lambda error: browser_errors.append(str(error)))
        mobile_page.route("**/admin/api/**", handle_admin_api)
        mobile_page.goto(f"{ADMIN_ROOT}/access")
        mobile_page.wait_for_load_state("networkidle")
        mobile_page.get_by_role("heading", name="Роли и доступ", level=2).wait_for()
        mobile_page.screenshot(path=str(OUTPUT_DIR / "site-access-mobile.png"), full_page=True)
        dimensions = mobile_page.evaluate(
            "({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth })"
        )
        assert dimensions["scrollWidth"] <= dimensions["clientWidth"]
        assert not browser_errors, browser_errors
        mobile_page.close()
        browser.close()

    print(json.dumps({"saved": saved_payloads[0], "viewport": dimensions}, ensure_ascii=False))


if __name__ == "__main__":
    main()
