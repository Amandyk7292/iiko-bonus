from pathlib import Path
import sys

from playwright.sync_api import sync_playwright


def main() -> None:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765/"
    root = Path(__file__).resolve().parents[1]
    output = root / "scratch" / "preloader-clean-white.png"
    output.parent.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(
            viewport={"width": 390, "height": 844},
            device_scale_factor=1,
        )
        page.route("**/flutter_bootstrap.js", lambda route: route.abort())
        page.goto(url, wait_until="domcontentloaded")

        loading = page.locator("#app-loading")
        loading.wait_for(state="visible")
        page.locator(".app-loading-logo").wait_for(state="visible")
        page.wait_for_timeout(150)
        styles = page.locator(".app-loading-content").evaluate(
            """element => {
              const content = getComputedStyle(element);
              const loading = getComputedStyle(document.querySelector('#app-loading'));
              const body = getComputedStyle(document.body);
              return {
                borderTopWidth: content.borderTopWidth,
                boxShadow: content.boxShadow,
                backgroundColor: content.backgroundColor,
                loadingBackground: loading.backgroundColor,
                bodyBackground: body.backgroundColor,
              };
            }"""
        )

        assert styles["borderTopWidth"] == "0px", styles
        assert styles["boxShadow"] == "none", styles
        assert styles["backgroundColor"] == "rgba(0, 0, 0, 0)", styles
        assert styles["loadingBackground"] == "rgb(255, 255, 255)", styles
        assert styles["bodyBackground"] == "rgb(255, 255, 255)", styles
        assert page.locator(".app-loading-label").count() == 0
        assert page.locator(".app-loading-bar").count() == 0

        logo = page.locator(".app-loading-logo")
        logo_styles = logo.evaluate(
            """element => {
              const style = getComputedStyle(element);
              return {
                width: Number.parseFloat(style.width),
                renderedWidth: element.getBoundingClientRect().width,
                animationDuration: style.animationDuration,
                naturalWidth: element.naturalWidth,
                opacity: style.opacity,
                src: element.currentSrc,
              };
            }"""
        )
        assert 182 <= logo_styles["width"] <= 186, logo_styles
        assert 170 <= logo_styles["renderedWidth"] <= 195, logo_styles
        assert logo_styles["naturalWidth"] > 0, logo_styles
        assert float(logo_styles["opacity"]) > 0.8, logo_styles
        assert logo_styles["animationDuration"] == "4.5s", logo_styles

        page.screenshot(path=str(output), full_page=True)
        browser.close()

    print(f"Clean white preloader passed: {output}")


if __name__ == "__main__":
    main()
