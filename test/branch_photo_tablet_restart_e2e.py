"""Restart real persistent browser profiles against the isolated router/SQL fixture."""
import json
import sys
import tempfile
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4180"
assert urlparse(BASE).hostname in ("127.0.0.1", "localhost"), "Use only the isolated local fixture"


def run():
    results = []
    with sync_playwright() as p:
        for engine in ("chromium", "webkit"):
            with tempfile.TemporaryDirectory(prefix="bulka-test-tablet-") as profile:
                browser_type = getattr(p, engine)
                options = dict(headless=True, viewport={"width": 820, "height": 1180}, locale="ru-RU")
                context = browser_type.launch_persistent_context(profile, **options)
                try:
                    response = context.request.get(BASE + "/api/branch-reports/__fixture__/qr")
                    assert response.ok
                    link = urlparse(response.json()["url"])
                    page = context.pages[0]
                    page.goto(BASE + link.path + "#" + link.fragment, wait_until="networkidle")
                    expect(page.locator("#enroll-device")).to_be_enabled()
                    page.locator("#enroll-device").click()
                    expect(page.locator("#pairing")).to_be_visible()
                    assert context.request.post(BASE + "/api/branch-reports/__fixture__/approve", data={}).ok
                    page.locator("#check-device").click()
                    expect(page.locator("#intro")).to_be_visible()
                    original = next(c for c in context.cookies() if c["name"] == "bulka_report_device")
                    assert original["httpOnly"] and original["expires"] > 0
                    context.close()
                    context = browser_type.launch_persistent_context(profile, **options)
                    restored = next(c for c in context.cookies() if c["name"] == "bulka_report_device")
                    assert restored["value"] == original["value"], "Restart must retain the same credential"
                    page = context.pages[0]
                    requests = []
                    page.on("request", lambda request: requests.append((urlparse(request.url).path, request.method)))
                    failures = [1]

                    def transient_failure(route):
                        if failures[0]:
                            failures[0] -= 1
                            route.fulfill(status=503, content_type="application/json", body='{"error":"Временный сбой связи"}')
                        else:
                            route.continue_()

                    page.route("**/api/branch-reports/device", transient_failure)
                    page.goto(BASE + "/branch-reports", wait_until="networkidle")
                    expect(page.locator("#retry")).to_be_visible()
                    expect(page.locator("#intro")).to_be_visible(timeout=15000)
                    expect(page.locator("#error")).to_be_hidden()
                    assert ("/api/branch-reports/device", "POST") not in requests
                    after = next(c for c in context.cookies() if c["name"] == "bulka_report_device")
                    assert after["value"] == original["value"]
                    assert page.evaluate("sessionStorage.length") == 0
                    page.once("dialog", lambda dialog: dialog.dismiss())
                    page.locator("#disconnect-device").click()
                    expect(page.locator("#intro")).to_be_visible()
                    assert ("/api/branch-reports/device/logout", "POST") not in requests
                    assert next(c for c in context.cookies() if c["name"] == "bulka_report_device")["value"] == original["value"]
                    results.append({"browser":engine,"realProfileRestart":True,"sameCredential":True,"transient503AutomaticRecovery":True,"cancelDisconnectPreservesPairing":True,"enrollmentPostsAfterRestart":0})
                finally:
                    context.close()
        cleanup = p.request.new_context()
        cleanup.post(BASE + "/api/branch-reports/__fixture__/shutdown", data={})
        cleanup.dispose()
    print(json.dumps({"passed":results,"physical_tablet_tested":False}, ensure_ascii=False))


if __name__ == "__main__":
    run()
