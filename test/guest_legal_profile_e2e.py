import os
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


BASE_URL = os.environ.get("BULKA_E2E_BASE_URL", "http://127.0.0.1:3000").rstrip("/")
ARTIFACTS_DIR = Path(__file__).resolve().parents[1] / "artifacts"
DOCUMENTS_ENTRY = "Документы и условия"
EXPECTED_LABELS = (
    "Публичная оферта",
    "Условия оплаты и возврата",
    "Условия доставки",
    "Реквизиты компании",
    "Политика конфиденциальности",
    "Условия использования",
)


def canonical_origin(url: str) -> tuple[str, str, int | None]:
    parsed = urlparse(url)
    port = parsed.port
    if port is None and parsed.scheme == "https":
        port = 443
    elif port is None and parsed.scheme == "http":
        port = 80
    return (parsed.scheme.lower(), (parsed.hostname or "").lower(), port)


BASE_ORIGIN = canonical_origin(BASE_URL)


def is_base_url_path(url: object, expected_path: str) -> bool:
    parsed = urlparse(str(url))
    return (
        canonical_origin(str(url)) == BASE_ORIGIN
        and parsed.path == expected_path
        and not parsed.params
        and not parsed.query
        and not parsed.fragment
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
    console_errors: list[dict[str, object]] = []
    http_errors: list[dict[str, object]] = []
    page_errors: list[str] = []
    page.on(
        "console",
        lambda message: console_errors.append(
            {"text": message.text, "location": message.location}
        )
        if message.type == "error"
        else None,
    )
    page.on(
        "response",
        lambda response: http_errors.append(
            {"status": response.status, "url": response.url}
        )
        if response.status >= 400
        else None,
    )
    page.on("pageerror", lambda error: page_errors.append(str(error)))

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

    profile_text = semantic_text(page)
    if DOCUMENTS_ENTRY not in profile_text:
        page.mouse.move(200, 650)
        page.mouse.wheel(0, 760)
        page.wait_for_timeout(2_000)
        profile_text = semantic_text(page)

    assert DOCUMENTS_ENTRY in profile_text, "Guest profile is missing documents entry"
    assert not any(
        label in profile_text for label in EXPECTED_LABELS
    ), "Legal documents must be grouped under one profile entry"

    documents_entry = page.locator(
        f'[aria-label*="{DOCUMENTS_ENTRY}"], flt-semantics:has-text("{DOCUMENTS_ENTRY}")'
    )
    assert documents_entry.count(), "Documents entry is not clickable"
    documents_entry.last.click(force=True)
    page.wait_for_timeout(1_000)

    label_text = semantic_text(page)
    missing = [label for label in EXPECTED_LABELS if label not in label_text]

    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    screenshot = ARTIFACTS_DIR / "production-guest-legal-profile.png"
    page.screenshot(path=str(screenshot), full_page=True)

    assert not missing, f"Documents page is missing legal entries: {missing}"
    unexpected_console_errors = [
        error
        for error in console_errors
        if not (
            "status of 401" in str(error["text"])
            and is_base_url_path(
                error["location"].get("url", ""), "/api/auth/refresh"
            )
        )
    ]
    unexpected_http_errors = [
        error
        for error in http_errors
        if not (
            error["status"] == 401
            and is_base_url_path(error["url"], "/api/auth/refresh")
        )
    ]
    refresh_errors = [
        error
        for error in http_errors
        if error["status"] == 401
        and is_base_url_path(error["url"], "/api/auth/refresh")
    ]
    assert refresh_errors, "The guest profile did not probe the cookie session"
    assert (
        not unexpected_console_errors
        and not unexpected_http_errors
        and not page_errors
    ), {
        "console_errors": unexpected_console_errors,
        "http_errors": unexpected_http_errors,
        "page_errors": page_errors,
    }
    context.close()
    browser.close()
