import re
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


def csp_violations(page):
    page.wait_for_timeout(150)
    return page.evaluate("window.__bulkaCspViolations")


def stable_csp(response):
    policy = response.headers.get("content-security-policy", "")
    return re.sub(r"'nonce-[^']+'", "'nonce-<request>'", policy)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(locale="ru-RU")
    context.route(
        "https://js.fortebank.com/**",
        lambda route: route.fulfill(
            status=200,
            content_type="application/javascript",
            body="window.BeGateway = function () {};",
        ),
    )
    context.route(
        "https://api-maps.yandex.ru/**",
        lambda route: route.fulfill(
            status=200,
            content_type="application/javascript",
            body=(
                "window.ymaps={ready:function(){"
                "window.__bulkaMapReadyCallbackRegistered=true;}};"
            ),
        ),
    )

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
    admin_violations = csp_violations(admin)
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
    client_violations = csp_violations(client)
    assert client_violations == [], client_violations

    registration_policies = []
    for route in ["/guest", "/guest/", "/wallet", "/wallet/"]:
        registration = context.new_page()
        attach_csp_capture(registration)
        response = registration.goto(
            f"{BASE_URL}{route}?source=csp-browser-test",
            wait_until="networkidle",
            timeout=120_000,
        )
        assert response is not None and response.ok, route
        registration_policies.append(stable_csp(response))
        script_policy = (
            response.headers.get("content-security-policy", "")
            .split("script-src ", 1)[1]
            .split(";", 1)[0]
        )
        assert "sha256-" in script_policy, (route, script_policy)
        assert "unsafe-inline" not in script_policy, (route, script_policy)
        assert "unsafe-eval" not in script_policy, (route, script_policy)
        registration.locator("#phone").fill("77001234567")
        assert registration.locator("#phone").input_value() == "+7 (700) 123-45-67"
        assert csp_violations(registration) == [], (
            route,
            csp_violations(registration),
        )
        registration.close()
    assert len(set(registration_policies)) == 1, registration_policies

    courier_policies = []
    for route in ["/courier", "/courier/"]:
        courier = context.new_page()
        attach_csp_capture(courier)
        response = courier.goto(
            f"{BASE_URL}{route}", wait_until="networkidle", timeout=120_000
        )
        assert response is not None and response.ok, route
        courier_policies.append(stable_csp(response))
        courier.locator("#phoneForm").wait_for(state="visible", timeout=120_000)
        assert csp_violations(courier) == [], (route, csp_violations(courier))
        courier.close()
    assert len(set(courier_policies)) == 1, courier_policies

    forte_policies = []
    for route in ["/payments/forte-widget", "/payments/forte-widget/"]:
        widget = context.new_page()
        attach_csp_capture(widget)
        response = widget.goto(
            f"{BASE_URL}{route}?embedded=app",
            wait_until="networkidle",
            timeout=120_000,
        )
        assert response is not None and response.ok, route
        forte_policies.append(stable_csp(response))
        assert widget.locator("html").evaluate(
            "element => element.classList.contains('embedded-app')"
        ), route
        assert csp_violations(widget) == [], (route, csp_violations(widget))
        widget.close()
    assert len(set(forte_policies)) == 1, forte_policies

    map_policies = []
    for route in ["/maps/yandex", "/maps/yandex/"]:
        delivery_map = context.new_page()
        attach_csp_capture(delivery_map)
        response = delivery_map.goto(
            f"{BASE_URL}{route}?mode=admin",
            wait_until="networkidle",
            timeout=120_000,
        )
        assert response is not None, route
        map_policies.append(stable_csp(response))
        script_policy = (
            response.headers.get("content-security-policy", "")
            .split("script-src ", 1)[1]
            .split(";", 1)[0]
        )
        assert "https://api-maps.yandex.ru" in script_policy, (route, script_policy)
        if response.ok:
            assert delivery_map.evaluate(
                "window.__bulkaMapReadyCallbackRegistered === true"
            ), route
        assert csp_violations(delivery_map) == [], (
            route,
            csp_violations(delivery_map),
        )
        delivery_map.close()
    assert len(set(map_policies)) == 1, map_policies

    context.close()
    browser.close()
    print("CSP browser test passed for app, registration and isolated documents.")
