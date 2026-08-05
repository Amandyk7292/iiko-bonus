"""Visual smoke test for the built Flutter customer client."""

from __future__ import annotations

import os
import time
from pathlib import Path

from playwright.sync_api import ConsoleMessage, Page, sync_playwright


BASE_URL = os.environ.get("BULKA_UI_URL", "http://127.0.0.1:4173")
SCREENSHOT = Path(
    os.environ.get(
        "BULKA_UI_SCREENSHOT",
        str(Path(os.environ.get("TEMP", ".")) / "bulka-client-mobile.png"),
    )
)


def main() -> None:
    console_errors: list[str] = []
    page_errors: list[str] = []
    failed_responses: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 390, "height": 844},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            locale="ru-RU",
            color_scheme="light",
            reduced_motion="reduce",
        )
        page = context.new_page()

        def delay_flutter_bootstrap(route) -> None:
            # Keep the HTML preloader on screen long enough to test it
            # deterministically even when the release bundle is cached/fast.
            time.sleep(1.0)
            route.continue_()

        page.route("**/flutter_bootstrap.js", delay_flutter_bootstrap)
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if isinstance(message, ConsoleMessage) and message.type == "error"
            else None,
        )
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "response",
            lambda response: failed_responses.append(f"{response.status} {response.url}")
            if response.status >= 400
            else None,
        )

        page.goto(BASE_URL, wait_until="commit", timeout=30_000)
        loading = page.locator("#app-loading")
        loading.wait_for(state="visible", timeout=5_000)
        assert loading.get_attribute("role") == "status"
        page.locator(".app-loading-logo").wait_for(state="visible", timeout=5_000)

        page.wait_for_load_state("domcontentloaded", timeout=30_000)
        loading.wait_for(state="detached", timeout=35_000)
        page.wait_for_timeout(1_200)
        title = page.title()
        assert title == "Bulka — семейная пекарня", f"Unexpected page title: {title!r}"
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")

        SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SCREENSHOT), full_page=True)
        browser.close()

    ignored_console = (
        "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT",
        "The resource at",
    )
    console_errors = [
        error for error in console_errors if not any(value in error for value in ignored_console)
    ]
    failed_responses = [
        value for value in failed_responses if "googleapis.com" not in value
    ]
    if console_errors or page_errors or failed_responses:
        details = "\n".join(
            [
                *(f"console: {value}" for value in console_errors),
                *(f"page: {value}" for value in page_errors),
                *(f"response: {value}" for value in failed_responses),
            ]
        )
        raise AssertionError(details)

    print(f"Client UI smoke passed. Screenshot: {SCREENSHOT}")


if __name__ == "__main__":
    main()
