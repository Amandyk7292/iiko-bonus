"""Browser-level smoke checks for client routing and adaptive navigation."""

from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


BASE_URL = os.environ.get("BULKA_UI_URL", "http://127.0.0.1:4173")
OUTPUT_DIR = Path(os.environ.get("BULKA_UI_ARTIFACTS", "artifacts/client-ui"))


def wait_for_flutter(page: Page) -> None:
    page.wait_for_load_state("domcontentloaded", timeout=30_000)
    page.locator("#app-loading").wait_for(state="detached", timeout=40_000)
    try:
        page.wait_for_load_state("networkidle", timeout=30_000)
    except Exception:
        # Live order and menu channels can keep the network active after the
        # first stable frame. The detached loader remains the readiness gate.
        pass
    page.wait_for_timeout(800)


def enable_semantics(page: Page) -> None:
    placeholder = page.locator("flt-semantics-placeholder")
    if placeholder.count() > 0:
        placeholder.focus()
        page.keyboard.press("Enter")
        page.wait_for_timeout(300)


def assert_no_horizontal_overflow(page: Page) -> None:
    assert page.evaluate(
        "document.documentElement.scrollWidth <= window.innerWidth + 1"
    )


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)

        mobile = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            locale="kk-KZ",
            color_scheme="light",
        )
        page = mobile.new_page()
        page.goto(BASE_URL, wait_until="commit", timeout=30_000)
        wait_for_flutter(page)
        assert page.evaluate("document.documentElement.lang") == "kk"
        assert_no_horizontal_overflow(page)
        enable_semantics(page)
        page.touchscreen.tap(117, 809)
        page.wait_for_url("**/catalog", timeout=10_000)
        page.wait_for_timeout(500)
        assert_no_horizontal_overflow(page)
        page.go_back()
        page.wait_for_url(BASE_URL + "/", timeout=10_000)
        page.screenshot(path=str(OUTPUT_DIR / "mobile-home.png"), full_page=True)
        mobile.close()

        desktop = browser.new_context(
            viewport={"width": 1280, "height": 800},
            device_scale_factor=1,
            locale="ru-RU",
            color_scheme="light",
            reduced_motion="reduce",
        )
        page = desktop.new_page()
        page.goto(f"{BASE_URL}/catalog", wait_until="commit", timeout=30_000)
        wait_for_flutter(page)
        assert page.evaluate("document.documentElement.lang") == "ru"
        assert_no_horizontal_overflow(page)
        enable_semantics(page)
        assert page.locator("flt-glass-pane").count() == 1
        page.screenshot(path=str(OUTPUT_DIR / "desktop-catalog.png"), full_page=True)
        desktop.close()

        browser.close()

    print(f"Client routing UI smoke passed. Artifacts: {OUTPUT_DIR.resolve()}")


if __name__ == "__main__":
    main()
