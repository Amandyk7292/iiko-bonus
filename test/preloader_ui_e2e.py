from pathlib import Path
import sys

from playwright.sync_api import sync_playwright


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
    root = Path(__file__).resolve().parents[1]
    output = root / "scratch" / "web-without-preloader.png"
    output.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.route(
            "**/app_bootstrap.js*",
            lambda route: route.fulfill(content_type="application/javascript", body=""),
        )
        page.goto(url, wait_until="domcontentloaded")
        assert page.locator("#app-loading").count() == 0
        assert page.locator(".app-loading-logo").count() == 0
        assert page.locator("#bulka-app").count() == 1
        assert page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(255, 255, 255)"
        page.screenshot(path=str(output), full_page=True)
        browser.close()

    print(f"Web preloader is absent: {output}")


if __name__ == "__main__":
    main()
