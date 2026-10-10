"""Actual router/SQL/cookie/multipart flow, with only camera and storage synthetic."""
import json
import sys
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4180"
assert urlparse(BASE).hostname in ("127.0.0.1", "localhost"), "Use only the isolated local fixture"
CAMERA = """
window.__violations = [];
window.__submissions = [];
const nativeFetch = window.fetch.bind(window);
window.fetch = (url, options) => {
  if (String(url).endsWith('/submit')) __submissions.push({
    id: options.body.get('uploadId'), count: options.body.getAll('photos').length,
  });
  return nativeFetch(url, options);
};
document.addEventListener('securitypolicyviolation', event => __violations.push(event.effectiveDirective));
if (navigator.mediaDevices && HTMLCanvasElement.prototype.captureStream) {
  navigator.mediaDevices.getUserMedia = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const context = canvas.getContext('2d');
    const draw = () => {
      context.fillStyle = '#ffd66d'; context.fillRect(0,0,640,480);
      context.fillStyle = '#732f15'; context.fillRect(60,60,300,220);
    };
    draw();
    const stream = canvas.captureStream(30);
    const timer = setInterval(draw,30);
    const track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
    track.stop = () => { clearInterval(timer); stop(); };
    return stream;
  };
}
"""


def run():
    results = []
    with sync_playwright() as p:
        for engine in ("chromium", "webkit"):
            browser = getattr(p, engine).launch(headless=True)
            context = browser.new_context(viewport={"width": 820, "height": 1180}, locale="ru-RU")
            errors = []
            try:
                response = context.request.get(BASE + "/api/branch-reports/__fixture__/qr")
                assert response.ok
                link = urlparse(response.json()["url"])
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.add_init_script(CAMERA)
                page.goto(BASE + link.path + "#" + link.fragment, wait_until="networkidle")
                expect(page.locator("#enroll-device")).to_be_enabled()
                page.locator("#enroll-device").click()
                expect(page.locator("#pairing")).to_be_visible()
                assert context.request.post(BASE + "/api/branch-reports/__fixture__/approve", data={}).ok
                with page.expect_response(lambda response: urlparse(response.url).path == "/api/branch-reports/device" and response.request.method == "GET") as status_response:
                    page.locator("#check-device").click()
                expect(page.locator("#intro")).to_be_visible()
                # Verify actual transport attributes without logging the cookie credential.
                cookie_header = status_response.value.header_value("set-cookie").lower()
                assert "httponly" in cookie_header and "samesite=strict" in cookie_header
                assert "path=/api/branch-reports" in cookie_header
                assert page.evaluate("sessionStorage.length") == 0
                assert page.evaluate("localStorage.length") == 0
                assert page.evaluate("document.cookie.includes('bulka_report_device')") is False
                cookies = context.cookies()
                cookie = next(cookie for cookie in cookies if cookie["name"] == "bulka_report_device")
                assert cookie["httpOnly"] and cookie["path"] == "/api/branch-reports"
                # Windows Playwright WebKit exports SameSite=None even for a Strict
                # Set-Cookie response. Transport is checked above; do not claim its
                # native SameSite enforcement is established by this API export.
                if engine == "chromium":
                    assert cookie["sameSite"] == "Strict"
                assert cookie["expires"] > 0
                page.close()
                # A new tab has no QR fragment or sessionStorage. Only the cookie survives.
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.add_init_script(CAMERA)
                page.goto(BASE + "/branch-reports", wait_until="networkidle")
                expect(page.locator("#intro")).to_be_visible()
                assert page.evaluate("sessionStorage.length") == 0
                assert page.locator("#branch").inner_text() == "Планшет · тестовая точка"
                if engine == "chromium":
                    submissions = []
                    page.on("request", lambda request: submissions.append(request) if urlparse(request.url).path == "/api/branch-reports/submit" else None)
                    page.locator('[data-kind="hall"]').click()
                    expect(page.locator("#take-photo")).to_be_visible()
                    page.wait_for_function("document.getElementById('camera').readyState >= 2")
                    for count in range(1, 4):
                        page.locator("#take-photo").click()
                        expect(page.locator(".preview")).to_have_count(count)
                    assert context.request.post(BASE + "/api/branch-reports/__fixture__/expire", data={}).ok
                    page.locator("#send").click()
                    expect(page.locator("#success")).to_be_visible(timeout=20_000)
                    assert "3 фото" in page.locator("#success-detail").inner_text()
                    assert len(submissions) == 2
                    batches = page.evaluate("window.__submissions")
                    assert len(batches) == 2 and all(batch["count"] == 3 for batch in batches)
                    assert batches[0]["id"] == batches[1]["id"], "Same captured batch must retain its idempotency key"
                    assert submissions[0].headers["x-bulka-report-session"] != submissions[1].headers["x-bulka-report-session"]
                    state = context.request.get(BASE + "/api/branch-reports/__fixture__/state").json()
                    assert state["reports"] == [{"photo_count": 3}] and state["objects"] == 3
                    assert state["permanentSessions"] >= 1
                    page.locator("#next-report").click()
                    expect(page.locator("#intro")).to_be_visible()
                page.once("dialog", lambda dialog: dialog.accept())
                page.locator("#disconnect-device").click()
                expect(page.locator("#device-status")).to_have_text("Планшет отключён")
                assert not any(cookie["name"] == "bulka_report_device" for cookie in context.cookies())
                assert page.evaluate("window.__violations") == []
                assert not errors, errors
                results.append({"browser": engine, "cookieOnlyReopen": True, "manualDisconnect": True,
                                "sameSiteStrictTransport": True, "browserCookieSameSiteExport": cookie["sameSite"],
                                "threePhotoExpiredSessionRetry": "passed" if engine == "chromium" else "skipped: Windows WebKit lacks camera media APIs",
                                "cspViolations": 0})
            except Exception:
                context.request.post(BASE + "/api/branch-reports/__fixture__/shutdown", data={})
                raise
            finally:
                context.close()
                browser.close()
        # The helper's Windows shell teardown can leave a Node child; exit the fixture itself.
        cleanup = p.request.new_context()
        cleanup.post(BASE + "/api/branch-reports/__fixture__/shutdown", data={})
        cleanup.dispose()
    print(json.dumps({"passed": results, "physical_tablet_tested": False}, ensure_ascii=False))


if __name__ == "__main__":
    run()
