import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("BULKA_E2E_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
ARTIFACTS_DIR = Path(__file__).resolve().parents[1] / "artifacts"


def assert_contains(page, text: str) -> None:
    assert page.get_by_text(text, exact=False).count() > 0, f"Missing text: {text}"


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(
        viewport={"width": 390, "height": 844},
        device_scale_factor=1,
        locale="ru-RU",
    )
    console_errors: list[str] = []
    page_errors: list[str] = []
    page.on(
        "console",
        lambda message: console_errors.append(f"{page.url}: {message.text}")
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: page_errors.append(str(error)))

    response = page.goto(f"{BASE_URL}/payment-and-refund", wait_until="networkidle")
    assert response is not None and response.status == 200
    assert_contains(page, "Условия оплаты и возврата")
    assert_contains(page, "ForteBank")
    assert_contains(page, "Visa")
    assert_contains(page, "Mastercard")
    assert_contains(page, "3‑D Secure")
    assert_contains(page, "Торговый чек")
    assert (
        page.locator('a[href="https://forte.kz/"]').get_attribute("target") == "_blank"
    )
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    page.screenshot(
        path=str(ARTIFACTS_DIR / "forte-compliance-mobile.png"), full_page=True
    )

    localized_routes = (
        ("/public-offer", "Публичная оферта интернет-магазина Bulka"),
        ("/delivery-terms", "Яндекс"),
        ("/company-details", "ИП РУБЛЕВА"),
        ("/privacy", "ForteBank"),
        ("/terms", "Условия использования"),
        ("/kk/public-offer", "Bulka интернет-дүкенінің жария офертасы"),
        ("/kk/payment-and-refund", "Төлем және қайтару шарттары"),
        ("/kk/delivery-terms", "Жеткізу шарттары"),
        ("/kk/company-details", "Компания деректемелері"),
        ("/kk/privacy", "Bulka құпиялылық саясаты"),
        ("/kk/terms", "Bulka пайдалану шарттары"),
        ("/en/public-offer", "Bulka online shop public offer"),
        ("/en/payment-and-refund", "Payment and refund terms"),
        ("/en/delivery-terms", "Delivery terms"),
        ("/en/company-details", "Company details"),
        ("/en/privacy", "Bulka privacy policy"),
        ("/en/terms", "Bulka terms of use"),
    )
    for route, expected_text in localized_routes:
        response = page.goto(f"{BASE_URL}{route}", wait_until="networkidle")
        assert response is not None and response.status == 200
        assert_contains(page, expected_text)

    response = page.goto(
        f"{BASE_URL}/kk/payment-and-refund", wait_until="networkidle"
    )
    assert response is not None and response.status == 200
    assert page.locator("html").get_attribute("lang") == "kk"
    assert (
        page.locator('.language-switcher a[aria-current="page"]').inner_text()
        == "Қазақша"
    )
    assert (
        page.locator('link[rel="canonical"]').get_attribute("href")
        == "https://bulka.com.kz/kk/payment-and-refund"
    )
    page.screenshot(
        path=str(ARTIFACTS_DIR / "forte-compliance-kazakh-mobile.png"),
        full_page=True,
    )

    page.set_viewport_size({"width": 1440, "height": 900})
    response = page.goto(
        f"{BASE_URL}/en/payment-and-refund", wait_until="networkidle"
    )
    assert response is not None and response.status == 200
    assert page.locator("html").get_attribute("lang") == "en"
    assert (
        page.locator('.language-switcher a[aria-current="page"]').inner_text()
        == "English"
    )
    page.screenshot(
        path=str(ARTIFACTS_DIR / "forte-compliance-english-desktop.png"),
        full_page=True,
    )

    robots = page.request.get(f"{BASE_URL}/robots.txt")
    assert robots.status == 200
    assert "Sitemap: https://bulka.com.kz/sitemap.xml" in robots.text()

    sitemap = page.request.get(f"{BASE_URL}/sitemap.xml")
    assert sitemap.status == 200
    assert "https://bulka.com.kz/payment-and-refund" in sitemap.text()
    assert "https://bulka.com.kz/public-offer" in sitemap.text()
    assert "https://bulka.com.kz/kk/public-offer" in sitemap.text()
    assert "https://bulka.com.kz/en/public-offer" in sitemap.text()
    assert "https://bulka.com.kz/kk/payment-and-refund" in sitemap.text()
    assert "https://bulka.com.kz/en/payment-and-refund" in sitemap.text()
    assert "https://bulka.com.kz/delivery-terms" in sitemap.text()
    assert "https://bulka.com.kz/company-details" in sitemap.text()

    invalid_receipt = page.request.get(
        f"{BASE_URL}/payment-receipts/117615f9-b35f-4eb4-9f6d-777f2236bb25"
        "?token=invalid"
    )
    assert invalid_receipt.status == 403
    assert invalid_receipt.headers.get("x-robots-tag", "").startswith(
        "noindex, nofollow"
    )
    receipt_csp = invalid_receipt.headers.get("content-security-policy", "")
    assert "'unsafe-inline'" not in receipt_csp
    assert "'unsafe-eval'" not in receipt_csp

    assert not page_errors, page_errors
    assert not console_errors, console_errors
    browser.close()
