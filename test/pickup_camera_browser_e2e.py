"""Real-browser preview/JPEG parity with a synthetic asymmetric camera stream.

Start test/pickup-camera-browser-server.cjs separately, or with the webapp-testing
with_server.py helper, then run this file. This checks browser media/canvas behavior;
it does not claim to exercise an iPhone camera or its native permission dialog.
"""

import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import Error, sync_playwright


BASE_URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4179"
OUTPUT_DIR = Path(sys.argv[2]) if len(sys.argv) > 2 else None
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
      context.fillRect(canvas.width * 0.3, canvas.height * 0.8, canvas.width * 0.1, canvas.height * 0.1);
      context.fillStyle = '#ffff00';
      context.fillRect(canvas.width * 0.6, canvas.height * 0.8, canvas.width * 0.1, canvas.height * 0.1);
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


def open_camera(browser, configuration=None, nonce=NONCE, viewport=(400, 700)):
    context = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]})
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


def crop_geometry(source_size):
    """Expected centered 3:4 portrait framing, independent of browser constraints."""
    width, height = source_size
    crop_width = min(width, height * 3 / 4)
    crop_height = crop_width * 4 / 3
    return ((width - crop_width) / 2, (height - crop_height) / 2,
            crop_width, crop_height)


def source_point(image, source_size, point, front):
    left, top, width, height = crop_geometry(source_size)
    x = (point[0] * source_size[0] - left) / width
    y = (point[1] * source_size[1] - top) / height
    assert 0 < x < 1 and 0 < y < 1, "Asymmetric calibration marks must remain in frame"
    if front:
        x = 1 - x
    return (min(image.width - 1, int(x * image.width)),
            min(image.height - 1, int(y * image.height)))


def assert_frame_pixels(image, source_size, front):
    assert_colour(image, (image.width // 4, image.height // 2), "blue" if front else "red")
    assert_colour(image, (image.width * 3 // 4, image.height // 2), "red" if front else "blue")
    # Marks are inside the crop, rather than source corners discarded by a portrait crop.
    # Their projected positions catch an uncropped, stretched or rotated landscape source.
    assert_colour(image, source_point(image, source_size, (0.35, 0.85), front), "green")
    assert_colour(image, source_point(image, source_size, (0.65, 0.85), front), "yellow")


def assert_preview(page, front, source_size, viewport):
    assert page.locator("#camera").evaluate("video => getComputedStyle(video).objectFit") == "cover"
    box = page.locator("#frame").bounding_box()
    expected_width = min(viewport[0], viewport[1] * 3 / 4)
    expected_height = expected_width * 4 / 3
    assert abs(box["width"] - expected_width) <= 1 and abs(box["height"] - expected_height) <= 1, box
    assert abs(box["x"] - (viewport[0] - expected_width) / 2) <= 1, box
    assert abs(box["y"] - (viewport[1] - expected_height) / 2) <= 1, box
    screenshot = Image.open(io.BytesIO(page.locator("#frame").screenshot())).convert("RGB")
    assert screenshot.height > screenshot.width
    assert abs(screenshot.width * 4 - screenshot.height * 3) <= 4, screenshot.size
    assert_frame_pixels(screenshot, source_size, front)
    full_page = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
    # The portrait frame is centered on black in either screen orientation.
    if box["y"] > 2:
        assert_colour(full_page, (viewport[0] // 2, 1), "black")
        assert_colour(full_page, (viewport[0] // 2, viewport[1] - 2), "black")
    if box["x"] > 2:
        assert_colour(full_page, (1, viewport[1] // 2), "black")
        assert_colour(full_page, (viewport[0] - 2, viewport[1] // 2), "black")
    return screenshot


def assert_pixel_parity(preview, photo):
    resized = photo.convert("RGB").resize(preview.size, Image.Resampling.LANCZOS)
    difference = ImageStat.Stat(ImageChops.difference(preview, resized))
    # JPEG compression, canvas resampling and fractional CSS edges may differ slightly.
    assert max(difference.mean) < 6, (preview.size, photo.size, difference.mean)


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
    assert image.height > image.width and image.width * 4 == image.height * 3, image.size
    assert image.getexif().get(274, 1) == 1, "No mirror/rotation EXIF for upload/print to reinterpret"
    return event, image


def parity_case(browser, facing, source_size, viewport):
    context, page, errors = open_camera(
        browser, {"width": source_size[0], "height": source_size[1]}, viewport=viewport
    )
    try:
        wait_event(page, "ready")
        preview = assert_preview(page, True, source_size, viewport)
        # Exercise both direction changes, then capture the requested final lens.
        for count, front in ((2, False), (3, True)):
            page.evaluate("window.BulkaPickupCameraControls.switchCamera()")
            wait_event(page, "ready", count)
            preview = assert_preview(page, front, source_size, viewport)
        if facing == "environment":
            page.evaluate("window.BulkaPickupCameraControls.switchCamera()")
            wait_event(page, "ready", 4)
            preview = assert_preview(page, False, source_size, viewport)
        save_artifacts = OUTPUT_DIR is not None and source_size == (640, 480) and viewport == (400, 700) and facing == "user"
        if save_artifacts:
            OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(OUTPUT_DIR / "portrait-camera-preview.png"))
        page.evaluate("window.BulkaPickupCameraControls.capture()")
        event, image = captured_photo(page)
        assert event["facingMode"] == facing
        _, _, crop_width, crop_height = crop_geometry(source_size)
        scale = min(1, 1200 / crop_width, 1600 / crop_height)
        assert image.size == (round(crop_width * scale), round(crop_height * scale)), event
        front = facing == "user"
        assert_frame_pixels(image, source_size, front)
        assert_pixel_parity(preview, image)
        if save_artifacts:
            image.save(OUTPUT_DIR / "portrait-camera-photo.jpg")
        page.evaluate("window.BulkaPickupCameraControls.capture(); window.BulkaPickupCameraControls.start(); window.BulkaPickupCameraControls.switchCamera()")
        assert event_count(page, "photo") == 1, "A shutter press must deliver only one photo"
        state = page.evaluate("({ requests: __cameraHarness.requests, tracks: __cameraHarness.tracks.map(record => ({stops: record.stops, state: record.track.readyState})) })")
        assert len(state["requests"]) == (3 if front else 4)
        assert all(request["audio"] is False and "exact" in request["video"]["facingMode"] for request in state["requests"])
        assert all(request["video"]["aspectRatio"]["ideal"] == 0.75 for request in state["requests"])
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
                parity_checks = 0
                for source_size in ((640, 480), (1280, 720), (1600, 2400), (600, 800)):
                    for viewport in ((400, 700), (700, 400)):
                        for facing in ("user", "environment"):
                            parity_case(browser, facing, source_size, viewport)
                            parity_checks += 1
                failure_cases(browser)
                late_permission_case(browser)
                pagehide_case(browser)
                hidden_case(browser)
                changed_lens_case(browser)
                invalid_nonce_case(browser)
                passed.append({"browser": name, "checks": parity_checks + 9, "portrait_parity_cases": parity_checks, "result": "Centered 3:4 portrait preview/JPEG pixel parity from 4:3, 16:9, tall and portrait sources in portrait/landscape viewports; front/rear switches, size bounds, one-shot capture, camera cleanup, late permission, lens rejection, nonce, CSP passed"})
            finally:
                browser.close()
    assert any(result["browser"] == "chromium" and result.get("portrait_parity_cases", 0) == 16
               for result in passed), "Chromium real-stream portrait parity is required"
    result = {"passed": passed, "skipped": skipped, "physical_iPhone_tested": False}
    if OUTPUT_DIR is not None:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        (OUTPUT_DIR / "browser-result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    run()
