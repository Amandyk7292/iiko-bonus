import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


base_url = sys.argv[1].rstrip("/")
screenshot_path = Path(sys.argv[2])
screenshot_path.parent.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 393, "height": 852})
    page.goto(base_url, wait_until="domcontentloaded")
    page.locator("#app-loading").wait_for(state="visible")

    colors = page.evaluate(
        """
        () => ({
          themeColor: document.querySelector('meta[name="theme-color"]')?.content,
          html: getComputedStyle(document.documentElement).backgroundColor,
          body: getComputedStyle(document.body).backgroundColor,
          loading: getComputedStyle(document.querySelector('#app-loading')).backgroundColor,
        })
        """
    )
    manifest = page.evaluate("() => fetch('manifest.json').then((response) => response.json())")

    assert colors["themeColor"].lower() == "#ffffff", colors
    assert colors["html"] == "rgb(255, 255, 255)", colors
    assert colors["body"] == "rgb(255, 255, 255)", colors
    assert colors["loading"] == "rgb(255, 255, 255)", colors
    assert manifest["background_color"].lower() == "#ffffff", manifest
    assert manifest["theme_color"].lower() == "#ffffff", manifest

    page.screenshot(path=str(screenshot_path), full_page=True)
    browser.close()

print(json.dumps({"colors": colors, "manifest": {
    "background_color": manifest["background_color"],
    "theme_color": manifest["theme_color"],
}}, ensure_ascii=False))
