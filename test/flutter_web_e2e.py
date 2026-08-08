import ipaddress
import json
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000/app/"
ROOT = Path(__file__).resolve().parents[1]
REFRESH_PATH = "/api/auth/refresh"


def canonical_origin(url):
    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    hostname = parsed.hostname
    if scheme not in {"http", "https"} or hostname is None:
        raise ValueError(f"Expected an HTTP(S) URL, got {url!r}")

    hostname = hostname.lower()
    try:
        hostname = ipaddress.ip_address(hostname).compressed
    except ValueError:
        pass

    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError(f"Invalid port in URL {url!r}") from error
    if port is None:
        port = 443 if scheme == "https" else 80
    return scheme, hostname, port


def origin_url(origin):
    scheme, hostname, port = origin
    rendered_hostname = f"[{hostname}]" if ":" in hostname else hostname
    default_port = 443 if scheme == "https" else 80
    rendered_port = "" if port == default_port else f":{port}"
    return f"{scheme}://{rendered_hostname}{rendered_port}"


def is_loopback_hostname(hostname):
    if hostname == "localhost":
        return True
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return False
    if address.is_loopback:
        return True
    mapped_address = getattr(address, "ipv4_mapped", None)
    return mapped_address is not None and mapped_address.is_loopback


BASE_ORIGIN = canonical_origin(BASE_URL)
BASE_ORIGIN_URL = origin_url(BASE_ORIGIN)
FIXTURES_ENABLED = (
    os.environ.get("NODE_ENV") == "test"
    and is_loopback_hostname(BASE_ORIGIN[1])
)


def is_exact_refresh_url(url):
    try:
        parsed = urlparse(url)
        return (
            canonical_origin(url) == BASE_ORIGIN
            and parsed.path == REFRESH_PATH
            and not parsed.params
            and not parsed.query
            and not parsed.fragment
        )
    except (TypeError, ValueError):
        return False


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 393, "height": 852},
        device_scale_factor=3,
        locale="ru-RU",
        reduced_motion="reduce",
    )
    page = context.new_page()
    console_errors = []
    http_errors = []
    requested_urls = []
    page.on("request", lambda request: requested_urls.append(request.url))
    page.on(
        "response",
        lambda response: http_errors.append(
            {"status": response.status, "url": response.url}
        )
        if response.status >= 400
        else None,
    )
    page.on(
        "console",
        lambda message: console_errors.append(
            {"text": message.text, "location": message.location}
        )
        if message.type == "error"
        else None,
    )

    def route_public_bootstrap(route):
        path = urlparse(route.request.url).path
        payload = {"success": True}
        if path == "/api/guest/stories":
            payload["stories"] = []
        elif path == "/api/guest/news":
            payload["news"] = []
        else:
            return route.fallback()
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(payload),
        )

    def route_missing_session(route):
        route.fulfill(
            status=401,
            content_type="application/json",
            body=json.dumps(
                {
                    "success": False,
                    "error": "Refresh session is required",
                    "code": "CUSTOMER_SESSION_REQUIRED",
                }
            ),
        )

    if FIXTURES_ENABLED:
        page.route(
            f"{BASE_ORIGIN_URL}{REFRESH_PATH}",
            route_missing_session,
        )
        page.route(
            f"{BASE_ORIGIN_URL}/api/guest/**",
            route_public_bootstrap,
        )

    response = page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
    assert response is not None and response.ok
    page.locator("flt-glass-pane").wait_for(state="attached", timeout=120_000)
    page.wait_for_timeout(1500)

    assert "bulka" in page.title().lower()
    assert page.evaluate(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
    )
    assert page.evaluate("crossOriginIsolated") is True
    refresh_errors = [
        error
        for error in http_errors
        if error["status"] == 401
        and is_exact_refresh_url(error["url"])
    ]
    refresh_probe_urls = [
        url
        for url in requested_urls
        if urlparse(url).path == REFRESH_PATH
    ]
    assert refresh_probe_urls, "The web client did not probe the cookie session"
    assert all(is_exact_refresh_url(url) for url in refresh_probe_urls), {
        "cross_origin_or_noncanonical_refresh_probes": refresh_probe_urls,
        "expected_origin": BASE_ORIGIN_URL,
    }
    assert refresh_errors, "The web client did not probe the cookie session"
    expected_refresh_response_urls = {error["url"] for error in refresh_errors}

    def is_expected_refresh_console_error(error):
        location = error.get("location") or {}
        location_url = location.get("url", "")
        return (
            is_exact_refresh_url(location_url)
            and location_url in expected_refresh_response_urls
            and "status of 401" in error["text"].lower()
        )

    unexpected_console_errors = [
        error
        for error in console_errors
        if "favicon" not in error["text"].lower()
        and not is_expected_refresh_console_error(error)
    ]
    unexpected_http_errors = [
        error
        for error in http_errors
        if not (
            error["status"] == 401
            and is_exact_refresh_url(error["url"])
        )
    ]
    assert not unexpected_console_errors and not unexpected_http_errors, {
        "console_errors": unexpected_console_errors,
        "http_errors": unexpected_http_errors,
    }

    release_response = context.request.get(f"{BASE_URL}release-version.json")
    assert release_response.ok
    release_version = release_response.json()["version"]
    mutable_requests = [
        urlparse(url)
        for url in requested_urls
        if urlparse(url).path.endswith(
            (
                "app_bootstrap.js",
                "flutter_bootstrap.js",
                "main.dart.js",
                "main.dart.mjs",
                "main.dart.wasm",
            )
        )
    ]
    for asset_name in ("app_bootstrap.js", "flutter_bootstrap.js"):
        matching = [url for url in mutable_requests if url.path.endswith(asset_name)]
        assert matching, f"{asset_name} was not requested"
        assert parse_qs(matching[-1].query).get("v") == [release_version], matching[-1].geturl()
    main_requests = [
        url
        for url in mutable_requests
        if url.path.endswith(("main.dart.js", "main.dart.mjs", "main.dart.wasm"))
    ]
    assert main_requests, "Flutter main bundle was not requested"
    for main_request in main_requests:
        assert parse_qs(main_request.query).get("v") == [release_version], main_request.geturl()

    screenshot = ROOT / "scratch" / "flutter-web-mobile.png"
    screenshot.parent.mkdir(exist_ok=True)
    page.screenshot(path=str(screenshot), full_page=True)
    print(f"Flutter Web E2E passed; screenshot: {screenshot}")

    context.close()
    browser.close()
