from urllib.parse import parse_qs, urlencode, urljoin, urlparse, urlunparse
import json
import sys
import time

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173/app/"


def with_query(url, **values):
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    query.update({key: [value] for key, value in values.items()})
    return urlunparse(parsed._replace(query=urlencode(query, doseq=True)))


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)

    cleanup_context = browser.new_context()
    cleanup_page = cleanup_context.new_page()
    cleanup_url = with_query(
        urljoin(BASE_URL, "cache-cleanup-harness.html"),
        cleanup_test="1",
    )
    cleanup_page.route(
        "**/cache-cleanup-harness.html*",
        lambda route: route.fulfill(
            status=200,
            content_type="text/html",
            headers={"Cache-Control": "no-store"},
            body="<!doctype html><title>Flutter cache cleanup harness</title>",
        ),
    )
    cleanup_page.goto(cleanup_url, wait_until="domcontentloaded")
    cleanup_page.evaluate(
        """async () => {
          for (const name of [
            'flutter-app-cache',
            'flutter-app-manifest',
            'flutter-temp-cache',
            'flutter-obsolete-release',
            'bulka-unrelated-cache',
          ]) {
            const cache = await caches.open(name);
            await cache.put('/cache-upgrade-probe', new Response(name));
          }
        }"""
    )
    try:
        cleanup_page.evaluate(
            """() => {
              window.__cleanupWorkerRegistrationError = '';
              void navigator.serviceWorker
                .register(
                  'flutter_service_worker.js?v=cleanup-e2e',
                  { scope: './', updateViaCache: 'none' },
                )
                .catch((error) => {
                  window.__cleanupWorkerRegistrationError =
                    `${error.name}: ${error.message}`;
                });
            }"""
        )
    except PlaywrightError as error:
        if "Execution context was destroyed" not in str(error):
            raise

    cleanup_state = {}
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            cleanup_state = cleanup_page.evaluate(
                """async () => ({
                  names: await caches.keys(),
                  registrationError: window.__cleanupWorkerRegistrationError || '',
                  workerUrls: (await navigator.serviceWorker.getRegistrations()).map(
                    (registration) =>
                      registration.active?.scriptURL
                      || registration.waiting?.scriptURL
                      || registration.installing?.scriptURL
                      || '',
                  ),
                })"""
            )
        except PlaywrightError as error:
            if "Execution context was destroyed" not in str(error):
                raise
            cleanup_page.wait_for_timeout(100)
            continue
        if cleanup_state["registrationError"]:
            raise AssertionError(cleanup_state["registrationError"])
        has_flutter_worker = any(
            urlparse(url).path.endswith("/flutter_service_worker.js")
            for url in cleanup_state["workerUrls"]
        )
        if (
            "bulka-unrelated-cache" in cleanup_state["names"]
            and not [
                name
                for name in cleanup_state["names"]
                if name.startswith("flutter-")
            ]
            and not has_flutter_worker
        ):
            break
        cleanup_page.wait_for_timeout(100)
    else:
        raise AssertionError(f"Cleanup worker did not finish: {cleanup_state}")

    remaining_caches = cleanup_page.evaluate("caches.keys()")
    assert "bulka-unrelated-cache" in remaining_caches
    assert not [
        name for name in remaining_caches if name.startswith("flutter-")
    ], remaining_caches
    cleanup_page.evaluate("caches.delete('bulka-unrelated-cache')")
    cleanup_context.close()

    reload_context = browser.new_context()
    reload_page = reload_context.new_page()
    navigation_urls = []
    reload_page.on(
        "framenavigated",
        lambda frame: navigation_urls.append(frame.url)
        if frame == reload_page.main_frame
        else None,
    )
    future_version = "future-release-e2e"

    def route_release_manifest(route):
        route.fulfill(
            status=200,
            content_type="application/json",
            headers={"Cache-Control": "no-store"},
            body=json.dumps(
                {
                    "schemaVersion": 1,
                    "version": future_version,
                    "mainSha256": "0" * 64,
                }
            ),
        )

    reload_page.route("**/release-version.json*", route_release_manifest)
    reload_page.route(
        "**/flutter_bootstrap.js*",
        lambda route: route.fulfill(
            status=200,
            content_type="application/javascript",
            body="window.__flutterReloadGuardTestLoaded = true;",
        ),
    )
    reload_page.goto(BASE_URL, wait_until="domcontentloaded")
    reload_page.wait_for_function(
        "() => window.__flutterReloadGuardTestLoaded === true",
        timeout=30_000,
    )
    reload_page.wait_for_timeout(1_000)

    guarded_navigations = [
        url
        for url in navigation_urls
        if parse_qs(urlparse(url).query).get("__bulka_release") == [future_version]
    ]
    assert len(guarded_navigations) == 1, navigation_urls
    assert parse_qs(urlparse(reload_page.url).query).get("__bulka_release") == [
        future_version
    ]

    reload_context.close()
    browser.close()

print("Flutter cache cleanup and one-time release reload E2E passed")
