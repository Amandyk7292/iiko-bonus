from pathlib import Path
from urllib.parse import urlparse
import json
import sys

from playwright.sync_api import sync_playwright


BASE_URL = (
    sys.argv[1]
    if len(sys.argv) > 1
    else "https://bulka.com.kz/?release=story-viewer-check"
)
ROOT = Path(__file__).resolve().parents[1]
SCREENSHOT_DIR = ROOT / "scratch" / "story-viewer"
SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)

CUSTOMER = {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "Алия",
    "phone": "77000000000",
    "balance": 1200,
    "total_spent": 24000,
    "created_at": "2026-01-01T00:00:00Z",
    "cashbackPercent": 5,
    "tier": {"name": "Бронза", "percent": 5, "remaining": 10000, "progress": 0.2},
}

STORIES = [
    {
        "id": 2,
        "title": "НОВИНКА",
        "coverUrl": "https://owofrgapcxsmzkdsefai.supabase.co/storage/v1/object/public/stories/admin/story-2-cover-1080x480-1784221810927.png",
        "contentUrl": "https://owofrgapcxsmzkdsefai.supabase.co/storage/v1/object/public/stories/admin/1783693596599-805c8581469fa0ea.png",
        "groupId": "2",
        "groupTitle": "НОВИНКА",
        "groupCoverUrl": "https://owofrgapcxsmzkdsefai.supabase.co/storage/v1/object/public/stories/admin/story-2-cover-1080x480-1784221810927.png",
        "duration": 15,
        "sortOrder": 0,
    }
]


def app_api(route):
    path = urlparse(route.request.url).path
    if path.endswith("/api/guest/profile"):
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "success": True,
                    "exists": True,
                    "customer": CUSTOMER,
                    "transactions": [],
                }
            ),
        )
    elif path.endswith("/api/customer/loyalty"):
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"success": True, "loyalty": CUSTOMER["tier"]}),
        )
    elif path.endswith("/api/guest/stories"):
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps({"success": True, "stories": STORIES}),
        )
    else:
        route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(
                {
                    "success": True,
                    "notifications": [],
                    "news": [],
                    "cities": [],
                    "categories": [],
                    "products": [],
                }
            ),
        )


def desktop_phone_geometry(width: int, height: int):
    if width < 900:
        return None
    frame_width = 446
    frame_height = 884
    scale = min(
        1.1,
        (width - 36) / frame_width,
        (height - 36) / frame_height,
    )
    rendered_width = frame_width * scale
    rendered_height = frame_height * scale
    return {
        "x": (width - rendered_width) / 2,
        "y": (height - rendered_height) / 2,
        "width": rendered_width,
        "height": rendered_height,
        "scale": scale,
    }


def run_viewport(browser, width: int, height: int, name: str) -> Path:
    context = browser.new_context(
        viewport={"width": width, "height": height},
        locale="ru-RU",
        reduced_motion="reduce",
        service_workers="block",
    )
    context.add_init_script(
        f"""
        (() => {{
          const customer = {json.dumps(CUSTOMER)};
          const values = {{
            phone: '77000000000',
            accessToken: 'test-token',
            customer: JSON.stringify(customer),
            transactions: '[]',
          }};
          for (const [key, value] of Object.entries(values)) {{
            localStorage.setItem(`flutter.${{key}}`, JSON.stringify(value));
          }}
        }})()
        """
    )
    page = context.new_page()
    page.route("**/api/**", app_api)
    errors = []
    page.on(
        "console",
        lambda message: errors.append(message.text)
        if message.type == "error"
        else None,
    )
    page.on("pageerror", lambda error: errors.append(str(error)))

    page.goto(BASE_URL, wait_until="domcontentloaded", timeout=120_000)
    page.locator("flt-glass-pane").wait_for(state="attached", timeout=45_000)
    page.wait_for_timeout(3200)
    accessibility = page.locator("flt-semantics-placeholder")
    if accessibility.count():
        accessibility.evaluate("element => element.click()")
        page.wait_for_timeout(500)

    page.wait_for_timeout(1600)
    page.screenshot(
        path=str(SCREENSHOT_DIR / f"home-before-story-{name}.png"),
        full_page=False,
    )
    home_labels = page.locator("[aria-label]").evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('aria-label')).filter(Boolean)"
    )
    story_labels = [label for label in home_labels if "НОВИН" in label.upper()]
    if story_labels:
        page.locator(f'[aria-label="{story_labels[0]}"]').first.click()
    else:
        # CanvasKit can merge the banner semantics into the home canvas even
        # though the card is visible. Click the banner relative to the capped
        # phone frame so the fallback also works on 2K and 4K displays.
        phone = desktop_phone_geometry(width, height)
        if phone:
            page.mouse.click(
                width / 2,
                phone["y"] + (16 + 160) * phone["scale"],
            )
        else:
            page.mouse.click(width / 2, min(198, height * 0.24))
    page.wait_for_timeout(3600)

    screenshot = SCREENSHOT_DIR / f"story-{name}.png"
    page.screenshot(path=str(screenshot), full_page=False)
    viewer_labels = page.locator("[aria-label]").evaluate_all(
        "nodes => nodes.map(node => node.getAttribute('aria-label')).filter(Boolean)"
    )
    close_labels = [label for label in viewer_labels if "ЗАКР" in label.upper()]
    if close_labels:
        close_box = page.locator(f'[aria-label="{close_labels[0]}"]').first.bounding_box()
        assert close_box, close_box
        if width >= 900:
            assert close_box["x"] + close_box["width"] < width - 120, close_box
            phone = desktop_phone_geometry(width, height)
            assert close_box["y"] >= phone["y"] + 20 * phone["scale"], close_box
            assert close_box["y"] < phone["y"] + 150 * phone["scale"], close_box
        else:
            assert close_box["y"] < 150, close_box
    assert any("НОВИН" in label.upper() for label in viewer_labels), viewer_labels
    assert not errors, f"Browser console errors: {errors}"

    context.close()
    return screenshot


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    mobile = run_viewport(browser, 390, 844, "mobile-390x844")
    desktop = run_viewport(browser, 1440, 900, "desktop-1440x900")
    large_desktop = run_viewport(browser, 2560, 1440, "desktop-2560x1440")
    browser.close()
    print(f"Story viewer UI passed: {mobile}; {desktop}; {large_desktop}")
