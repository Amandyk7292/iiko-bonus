import os
from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("BULKA_E2E_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
ARTIFACTS_DIR = Path(__file__).resolve().parents[1] / "artifacts"
EXPECTED_LABELS = (
    "Публичная оферта",
    "Условия оплаты и возврата",
    "Условия доставки",
    "Реквизиты компании",
    "Политика конфиденциальности",
    "Условия использования",
)


def semantic_text(page) -> str:
    return "\n".join(
        page.locator("[aria-label], flt-semantics").evaluate_all(
            """(nodes) => nodes.map((node) =>
              [node.getAttribute('aria-label') || '', node.textContent || ''].join(' ')
            )"""
        )
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 390, "height": 844},
        locale="ru-RU",
        reduced_motion="reduce",
    )
    page = context.new_page()
    browser_errors: list[str] = []
    page.on(
        "console",
        lambda message: browser_errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: browser_errors.append(str(error)))

    response = page.goto(
        f"{BASE_URL}/profile", wait_until="domcontentloaded", timeout=120_000
    )
    assert response is not None and response.status == 200
    page.locator("flt-glass-pane").wait_for(state="attached", timeout=45_000)
    page.wait_for_timeout(5_000)

    accessibility_switch = page.locator("flt-semantics-placeholder")
    if accessibility_switch.count():
        accessibility_switch.evaluate("(element) => element.click()")
        page.wait_for_timeout(1_000)

    label_text = semantic_text(page)
    missing = [label for label in EXPECTED_LABELS if label not in label_text]
    if missing:
        page.mouse.move(200, 650)
        page.mouse.wheel(0, 760)
        page.wait_for_timeout(2_000)
        label_text = semantic_text(page)
        missing = [label for label in EXPECTED_LABELS if label not in label_text]

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    screenshot = ARTIFACTS_DIR / "production-guest-legal-profile.png"
    page.screenshot(path=str(screenshot), full_page=True)

    assert not missing, f"Guest profile is missing legal entries: {missing}"
    assert not browser_errors, browser_errors
    context.close()
    browser.close()
