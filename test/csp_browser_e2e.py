import sys

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"


def attach_csp_capture(page):
    page.add_init_script(
        """
        window.__bulkaCspViolations = [];
        document.addEventListener('securitypolicyviolation', (event) => {
          window.__bulkaCspViolations.push({
            directive: event.effectiveDirective,
            blocked: event.blockedURI,
            sample: event.sample,
            source: event.sourceFile,
            line: event.lineNumber,
          });
        });
        """
    )


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(locale="ru-RU")

    admin = context.new_page()
    attach_csp_capture(admin)
    admin_response = admin.goto(
        f"{BASE_URL}/admin", wait_until="networkidle", timeout=120_000
    )
    assert admin_response is not None and admin_response.ok
    admin_script_policy = (
        admin_response.headers.get("content-security-policy", "")
        .split("script-src ", 1)[1]
        .split(";", 1)[0]
    )
    assert admin_script_policy == "'self'"
    admin_violations = admin.evaluate("window.__bulkaCspViolations")
    assert admin_violations == [], admin_violations

    client = context.new_page()
    attach_csp_capture(client)
    client_response = client.goto(
        f"{BASE_URL}/", wait_until="domcontentloaded", timeout=120_000
    )
    assert client_response is not None and client_response.ok
    client.locator("flt-glass-pane").wait_for(state="attached", timeout=120_000)
    client.wait_for_timeout(1500)
    assert client.evaluate("crossOriginIsolated") is True
    client_violations = client.evaluate("window.__bulkaCspViolations")
    assert client_violations == [], client_violations

    delivery_map = context.new_page()
    attach_csp_capture(delivery_map)
    map_response = delivery_map.goto(
        f"{BASE_URL}/maps/yandex", wait_until="domcontentloaded", timeout=120_000
    )
    assert map_response is not None
    if map_response.ok:
        delivery_map.wait_for_function(
            "window.ymaps && document.querySelector('#map ymaps')",
            timeout=120_000,
        )
        map_violations = delivery_map.evaluate("window.__bulkaCspViolations")
        assert map_violations == [], map_violations

    context.close()
    browser.close()
    print("CSP browser test passed for admin and Flutter.")
