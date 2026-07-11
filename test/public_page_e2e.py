from pathlib import Path
import json
import sys

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4174"
ROOT = Path(__file__).resolve().parents[1]


def json_response(route, payload, status=200):
    route.fulfill(
        status=status,
        content_type="application/json",
        body=json.dumps(payload),
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 375, "height": 812},
        locale="ru-RU",
        reduced_motion="reduce",
    )
    page = context.new_page()
    console_errors = []
    page.on("console", lambda message: console_errors.append(message.text) if message.type == "error" else None)

    page.route(
        "**/api/auth/request-otp",
        lambda route: json_response(
            route,
            {
                "success": True,
                "whatsappUrl": "https://wa.me/77000000000?text=Code%20test-token",
            },
        ),
    )
    page.route(
        "**/api/auth/verify-otp",
        lambda route: json_response(
            route,
            {"success": True, "exists": False, "registrationToken": "test-registration-token"},
        ),
    )
    page.route(
        "**/api/register-iiko",
        lambda route: json_response(route, {"success": True, "customerId": "test-customer"}),
    )

    page.goto(BASE_URL + "/public/app.html")
    page.wait_for_load_state("networkidle")

    assert page.locator("h1").inner_text() == "Карта лояльности"
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth")

    page.get_by_role("button", name="Получить код в WhatsApp").click()
    assert page.locator("#nameError").inner_text() == "Введите имя."
    assert page.locator("#phoneError").inner_text() == "Введите полный номер телефона."

    page.get_by_role("button", name="KZ").click()
    assert page.locator("h1").inner_text() == "Адалдық картасы"
    page.reload()
    page.wait_for_load_state("networkidle")
    assert page.locator("h1").inner_text() == "Адалдық картасы"

    page.get_by_role("button", name="EN").click()
    page.locator("#name").fill("Alex")
    page.locator("#phone").fill("7012345678")
    page.get_by_role("button", name="Get a code in WhatsApp").click()

    page.locator("#otp").wait_for(state="visible")
    assert page.locator("#waLink").is_visible()
    assert "Request created" in page.locator("#successMessage").inner_text()

    page.locator("#otp").fill("1234")
    page.get_by_role("button", name="Verify and register").click()
    page.locator("#successMessage").wait_for(state="visible")
    assert "Registration complete" in page.locator("#successMessage").inner_text()
    assert not console_errors, f"Browser console errors: {console_errors}"

    screenshot_path = ROOT / "scratch" / "public-registration-e2e.png"
    page.screenshot(path=str(screenshot_path), full_page=True)
    print(f"Public registration E2E passed; screenshot: {screenshot_path}")

    context.close()
    browser.close()
