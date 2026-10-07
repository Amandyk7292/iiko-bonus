"""Real-browser preview/JPEG parity with a synthetic asymmetric camera stream.

Start test/pickup-camera-browser-server.cjs separately, or with the webapp-testing
with_server.py helper, then run this file. This checks browser media/canvas behavior;
it does not claim to exercise an iPhone camera or its native permission dialog.
"""

import base64
import io
import json
import sys

from PIL import Image
from playwright.sync_api import Error, sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4179"
NONCE = "a1" * 16
MOCK = r"""
(() => {
  const configuration = CONFIGURATION;
  const harness = window.__cameraHarness = {
    events: [], requests: [], tracks: [], violations: [], pending: null,
  };
  window.BulkaPickupCamera = {
    postMessage(message) { harness.events.push(JSON.parse(message)); },
  };
  document.addEventListener('securitypolicyviolation', event => {
    harness.violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
  });
  const createMedia = requested => {
    const canvas = document.createElement('canvas');
    canvas.width = configuration.width || 640;
    canvas.height = configuration.height || 480;
    const context = canvas.getContext('2d');
    const draw = () => {
      context.fillStyle = '#ff0000';
      context.fillRect(0, 0, canvas.width / 2, canvas.height);
      context.fillStyle = '#0000ff';
      context.fillRect(canvas.width / 2, 0, canvas.width / 2, canvas.height);
      context.fillStyle = '#00ff00';
      context.fillRect(0, canvas.height * 0.75, canvas.width * 0.2, canvas.height * 0.25);
      context.fillStyle = '#ffff00';
      context.fillRect(canvas.width * 0.8, canvas.height * 0.75, canvas.width * 0.2, canvas.height * 0.25);
    };
    draw();
    const media = canvas.captureStream(30);
    const timer = setInterval(draw, 25);
    const track = media.getVideoTracks()[0];
    const nativeSettings = track.getSettings.bind(track);
    track.getSettings = () => ({
      ...nativeSettings(),
      facingMode: configuration.lens === 'unknown' ? undefined :
        configuration.lens === 'wrong' ? (requested === 'user' ? 'environment' : 'user') : requested,
    });
    const record = { stops: 0, track, requested };
    harness.tracks.push(record);
    const nativeStop = track.stop.bind(track);
    track.stop = () => {
      record.stops++;
      clearInterval(timer);
      nativeStop();
    };
    return media;
  };
  // Some Windows WebKit builds omit the native mediaDevices surface entirely.
  // Keep that unsupported path real instead of inventing a media implementation.
  if (!navigator.mediaDevices) return;
  Object.defineProperty(navigator.mediaDevices, 'getSupportedConstraints', {
    configurable: true,
    value: () => ({ facingMode: configuration.mode !== 'unsupported' }),
  });
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    configurable: true,
    value: constraints => {
      harness.requests.push(constraints);
      const desired = constraints.video.facingMode.exact;
      if (configuration.mode === 'denied') {
        return Promise.reject(new DOMException('Synthetic denied camera', 'NotAllowedError'));
      }
      if (configuration.mode === 'late') {
        return new Promise(resolve => { harness.pending = () => resolve(createMedia(desired)); });
      }
      return Promise.resolve(createMedia(desired));
    },
  });
})();
"""


def event_count(page, event):
    return page.evaluate(
        "type => window.__cameraHarness.events.filter(event => event.type === type).length",
        event,
    )


def wait_event(page, event, count=1):
    page.wait_for_function(
        "([type, count]) => window.__cameraHarness.events.filter(event => event.type === type).length >= count",
        arg=[event, count],
        timeout=12_000,
    )


def open_camera(browser, configuration=None, nonce=NONCE):
    context = browser.new_context(viewport={"width": 400, "height": 700})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(MOCK.replace("CONFIGURATION", json.dumps(configuration or {})))
    response = page.goto(
        f"{BASE_URL}/pickup/camera-v1#nonce={nonce}", wait_until="networkidle"
    )
    assert response is not None and response.ok
    assert response.headers["permissions-policy"] == "camera=(self), microphone=(), geolocation=()"
    policy = response.headers["content-security-policy"]
    for directive in ("media-src blob:", "connect-src 'none'", "script-src 'self'", "style-src 'self'"):
        assert directive in policy, policy
    assert "unsafe-inline" not in policy and "unsafe-eval" not in policy
    assert response.headers["cache-control"] == "private, no-store"
    assert page.locator("video#camera").count() == 1
    assert page.locator("button").count() == 0, "Native controls must not get a second confirmation form"
    return context, page, errors


def assert_clean(page, errors):
    assert not errors, errors
    assert page.evaluate("window.__cameraHarness.violations") == []
    assert page.evaluate(
        "window.__cameraHarness.events.every(event => event.v === 1 && event.nonce === '" + NONCE + "')"
    )


def assert_colour(image, point, colour):
    pixel = image.convert("RGB").getpixel(point)
    expected = {
        "red": (255, 0, 0), "blue": (0, 0, 255), "green": (0, 255, 0),
        "yellow": (255, 255, 0), "black": (0, 0, 0),
    }[colour]
    assert all(abs(channel - reference) < 45 for channel, reference in zip(pixel, expected)), (
        point, colour, pixel
    )


def assert_preview(page, front):
    assert page.locator("#camera").evaluate("video => getComputedStyle(video).objectFit") == "contain"
    screenshot = Image.open(io.BytesIO(page.locator("#camera").screenshot()))
    assert screenshot.size == (400, 700)
    assert_colour(screenshot, (100, 350), "blue" if front else "red")
    assert_colour(screenshot, (300, 350), "red" if front else "blue")
    assert_colour(screenshot, (40, 480), "yellow" if front else "green")
    assert_colour(screenshot, (360, 480), "green" if front else "yellow")
    assert_colour(screenshot, (200, 100), "black")
    assert_colour(screenshot, (200, 600), "black")


def captured_photo(page):
    wait_event(page, "photo")
    event = page.evaluate("window.__cameraHarness.events.find(event => event.type === 'photo')")
    payload = base64.b64decode(event["base64"], validate=True)
    assert payload.startswith(b"\xff\xd8\xff")
    assert len(payload) <= 5 * 1024 * 1024
    assert event["mimeType"] == "image/jpeg"
    image = Image.open(io.BytesIO(payload))
    assert image.format == "JPEG"
    assert image.size == (event["width"], event["height"])
    assert 0 < image.width <= 1200 and 0 < image.height <= 1600
    assert image.getexif().get(274, 1) == 1, "No mirror/rotation EXIF for upload/print to reinterpret"
    return event, image


def parity_case(browser, facing):
    context, page, errors = open_camera(browser)
    try:
        wait_event(page, "ready")
        assert_preview(page, True)
        # Exercise both direction changes, then capture the requested final lens.
        for count, front in ((2, False), (3, True)):
            page.evaluate("window.BulkaPickupCameraControls.switchCamera()")
            wait_event(page, "ready", count)
            assert_preview(page, front)
        if facing == "environment":
            page.evaluate("window.BulkaPickupCameraControls.switchCamera()")
            wait_event(page, "ready", 4)
            assert_preview(page, False)
        page.evaluate("window.BulkaPickupCameraControls.capture()")
        event, image = captured_photo(page)
        assert event["facingMode"] == facing
        assert image.size == (640, 480)
        front = facing == "user"
        assert_colour(image, (160, 240), "blue" if front else "red")
        assert_colour(image, (480, 240), "red" if front else "blue")
        assert_colour(image, (64, 448), "yellow" if front else "green")
        assert_colour(image, (576, 448), "green" if front else "yellow")
        page.evaluate("window.BulkaPickupCameraControls.capture(); window.BulkaPickupCameraControls.start(); window.BulkaPickupCameraControls.switchCamera()")
        assert event_count(page, "photo") == 1, "A shutter press must deliver only one photo"
        state = page.evaluate("({ requests: __cameraHarness.requests, tracks: __cameraHarness.tracks.map(record => ({stops: record.stops, state: record.track.readyState})) })")
        assert len(state["requests"]) == (3 if front else 4)
        assert all(request["audio"] is False and "exact" in request["video"]["facingMode"] for request in state["requests"])
        assert all(track == {"stops": 1, "state": "ended"} for track in state["tracks"]), state
        assert_clean(page, errors)
    finally:
        context.close()


def failure_cases(browser, require_stream=True, native_media=True):
    cases = [
        ({"mode": "unsupported"}, "unsupported", 0),
        ({"mode": "denied"}, "permission", 1),
        ({"lens": "unknown"}, "lens", 1),
        ({"lens": "wrong"}, "lens", 1),
    ]
    cases = cases if require_stream else cases[:2 if native_media else 1]
    for configuration, expected, requests in cases:
        context, page, errors = open_camera(browser, configuration)
        try:
            wait_event(page, "error")
            page.evaluate("window.BulkaPickupCameraControls.capture()")
            assert event_count(page, "photo") == 0
            assert event_count(page, "ready") == 0
            assert page.evaluate("window.__cameraHarness.events.find(event => event.type === 'error').code") == expected
            assert page.evaluate("window.__cameraHarness.requests.length") == requests, "Camera must not silently fall back to a different lens"
            assert page.evaluate("window.__cameraHarness.tracks.every(record => record.stops === 1 && record.track.readyState === 'ended')")
            assert_clean(page, errors)
        finally:
            context.close()


def late_permission_case(browser):
    context, page, errors = open_camera(browser, {"mode": "late"})
    try:
        page.wait_for_function("typeof window.__cameraHarness.pending === 'function'")
        page.evaluate("window.BulkaPickupCameraControls.stop(); window.__cameraHarness.pending()")
        page.wait_for_function("window.__cameraHarness.tracks.length === 1 && window.__cameraHarness.tracks[0].track.readyState === 'ended'")
        assert event_count(page, "cancel") == 1
        assert event_count(page, "ready") == 0 and event_count(page, "photo") == 0
        assert page.evaluate("window.__cameraHarness.tracks[0].stops") == 1
        assert_clean(page, errors)
    finally:
        context.close()


def pagehide_case(browser):
    context, page, errors = open_camera(browser)
    try:
        wait_event(page, "ready")
        page.evaluate("window.dispatchEvent(new Event('pagehide')); window.BulkaPickupCameraControls.capture()")
        assert event_count(page, "cancel") == 1 and event_count(page, "photo") == 0
        assert page.evaluate("window.__cameraHarness.tracks.every(record => record.stops === 1 && record.track.readyState === 'ended')")
        assert_clean(page, errors)
    finally:
        context.close()


def hidden_case(browser):
    context, page, errors = open_camera(browser)
    try:
        wait_event(page, "ready")
        page.evaluate("Object.defineProperty(document, 'hidden', {configurable: true, value: true}); document.dispatchEvent(new Event('visibilitychange')); window.BulkaPickupCameraControls.capture()")
        assert event_count(page, "cancel") == 1 and event_count(page, "photo") == 0
        assert page.evaluate("window.__cameraHarness.tracks.every(record => record.stops === 1 && record.track.readyState === 'ended')")
        assert_clean(page, errors)
    finally:
        context.close()


def changed_lens_case(browser):
    context, page, errors = open_camera(browser)
    try:
        wait_event(page, "ready")
        page.evaluate("window.__cameraHarness.tracks[0].track.getSettings = () => ({facingMode: 'environment'}); window.BulkaPickupCameraControls.capture()")
        wait_event(page, "error")
        assert event_count(page, "photo") == 0
        assert page.evaluate("window.__cameraHarness.events.find(event => event.type === 'error').code") == "lens"
        assert page.evaluate("window.__cameraHarness.tracks[0].stops") == 1
        assert_clean(page, errors)
    finally:
        context.close()


def size_case(browser):
    context, page, errors = open_camera(browser, {"width": 1600, "height": 2400})
    try:
        wait_event(page, "ready")
        page.evaluate("window.BulkaPickupCameraControls.capture()")
        event, image = captured_photo(page)
        assert image.size == (1067, 1600), event
        assert_colour(image, (image.width // 4, image.height // 2), "blue")
        assert_colour(image, (image.width * 3 // 4, image.height // 2), "red")
        assert_clean(page, errors)
    finally:
        context.close()


def invalid_nonce_case(browser):
    context, page, errors = open_camera(browser, nonce="invalid")
    try:
        assert page.evaluate("window.__cameraHarness.requests.length") == 0
        assert page.evaluate("window.__cameraHarness.events.length") == 0
        assert page.evaluate("typeof window.BulkaPickupCameraControls") == "undefined"
        assert not errors and page.evaluate("window.__cameraHarness.violations") == []
    finally:
        context.close()


def run():
    passed = []
    skipped = []
    with sync_playwright() as playwright:
        for name in ("chromium", "webkit"):
            try:
                browser = getattr(playwright, name).launch(headless=True)
            except Error as error:
                skipped.append({"browser": name, "reason": "Browser executable unavailable", "detail": str(error).splitlines()[0]})
                continue
            try:
                probe = browser.new_page()
                probe.goto(f"{BASE_URL}/pickup/camera-v1", wait_until="networkidle")
                supported = probe.evaluate("typeof HTMLCanvasElement.prototype.captureStream === 'function'")
                native_media = probe.evaluate("!!navigator.mediaDevices?.getUserMedia")
                probe.close()
                if not supported:
                    failure_cases(browser, require_stream=False, native_media=native_media)
                    invalid_nonce_case(browser)
                    passed.append({"browser": name, "checks": 3 if native_media else 2, "result": "Initialization, unsupported camera, nonce, strict CSP passed"})
                    skipped.append({"browser": name, "reason": "Canvas captureStream unsupported; real-stream preview/JPEG pixel and stream lifecycle cases not exercised", "native_media_devices_available": native_media})
                    continue
                parity_case(browser, "user")
                parity_case(browser, "environment")
                failure_cases(browser)
                late_permission_case(browser)
                pagehide_case(browser)
                hidden_case(browser)
                changed_lens_case(browser)
                size_case(browser)
                invalid_nonce_case(browser)
                passed.append({"browser": name, "checks": 12, "result": "Preview/JPEG pixel parity, front/rear switches, size bounds, one-shot capture, camera cleanup, late permission, lens rejection, nonce, CSP passed"})
            finally:
                browser.close()
    assert any(result["browser"] == "chromium" for result in passed), "Chromium real-stream parity is required"
    print(json.dumps({"passed": passed, "skipped": skipped, "physical_iPhone_tested": False}, ensure_ascii=False))


if __name__ == "__main__":
    run()
