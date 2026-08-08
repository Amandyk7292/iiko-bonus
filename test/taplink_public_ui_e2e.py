import json
from pathlib import Path
import sys

from playwright.sync_api import sync_playwright


BASE_URL = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4320").rstrip("/")
ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / ".tmp" / "taplink-public-e2e"
ARTIFACTS.mkdir(parents=True, exist_ok=True)

CUSTOM_LINK_LABEL = "Фирменная кнопка"
PUBLIC_PAYLOAD = {
    "success": True,
    "page": {
        "slug": "main",
        "revision": 7,
        "publishedAt": "2026-08-08T12:00:00.000Z",
        "source": "database",
        "config": {
            "schemaVersion": 1,
            "defaultLocale": "ru",
            "enabledLocales": ["kk", "ru"],
            "profile": {
                "logoUrl": "/taplink/assets/brand/bulka_logo.png?v=20260806-1",
                "title": {"kk": "Bulka жаныңызда", "ru": "Bulka рядом"},
                "description": {
                    "kk": "Күн сайын балғын пісірме және сүйікті дәмдер.",
                    "ru": "Свежая выпечка и любимые вкусы каждый день.",
                },
                "footer": {"kk": "Bulka наубайханасы", "ru": "Семейная пекарня Bulka"},
            },
            "seo": {
                "title": {"kk": "Bulka — сілтемелер", "ru": "Bulka — ссылки"},
                "description": {
                    "kk": "Bulka ресми сілтемелері.",
                    "ru": "Официальные ссылки Bulka.",
                },
                "ogImageUrl": "/taplink/assets/brand/bulka_logo.png?v=20260806-1",
            },
            "theme": {
                "preset": "bulka",
                "backgroundMode": "brand",
                "backgroundColor": "#FFB814",
                "gradientFrom": "#FFD56A",
                "gradientTo": "#F4A916",
                "gradientDirection": "bottom-right",
                "backgroundOverlayColor": "#532814",
                "backgroundOverlayOpacity": 0,
                "textColor": "#532814",
                "mutedTextColor": "#78665D",
                "surfaceColor": "#FFFFFF",
                "buttonBackgroundColor": "#FFFFFF",
                "buttonTextColor": "#532814",
                "primaryButtonBackgroundColor": "#FFB814",
                "primaryButtonTextColor": "#3F1D0E",
                "animation": "stagger",
                "buttonEffect": "shine",
                "buttonStyle": "soft",
                "radius": 22,
                "backgroundImageUrl": "/taplink/assets/mobile-background.png?v=20260806-1",
            },
            "blocks": [
                {
                    "id": "20000000-0000-4000-8000-000000000001",
                    "type": "link",
                    "enabled": True,
                    "style": "standard",
                    "labels": {"kk": "Фирмалық батырма", "ru": CUSTOM_LINK_LABEL},
                    "subtitles": {"kk": "Жеке дизайн", "ru": "Индивидуальный дизайн"},
                    "ariaLabels": {"kk": "Фирмалық батырманы ашу", "ru": CUSTOM_LINK_LABEL},
                    "icon": "none",
                    "target": {"type": "url", "value": "https://bulka.com.kz/catalog"},
                    "href": "https://bulka.com.kz/catalog",
                    "appearance": {
                        "buttonStyle": "outlined",
                        "backgroundColor": "#14342B",
                        "textColor": "#FFFFFF",
                        "radius": 16,
                        "buttonEffect": "shine",
                    },
                }
            ],
        },
    },
}


def install_public_payload(context) -> None:
    context.route(
        "https://bulka.com.kz/taplink/assets/mobile-background.png*",
        lambda route: route.fulfill(
            status=200,
            content_type="image/png",
            path=str(ROOT / "public" / "taplink" / "assets" / "mobile-background.png"),
        ),
    )
    context.route(
        "**/api/public/taplink",
        lambda route: route.fulfill(
            status=200,
            content_type="application/json",
            body=json.dumps(PUBLIC_PAYLOAD, ensure_ascii=False),
        ),
    )


def open_taplink(context, errors):
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
    page.on(
        "requestfailed",
        lambda request: errors.append(f"requestfailed: {request.url} ({request.failure})"),
    )
    page.on(
        "console",
        lambda message: errors.append(f"console: {message.text}")
        if message.type == "error"
        else None,
    )
    response = page.goto(f"{BASE_URL}/taplink?lang=ru", wait_until="networkidle")
    assert response is not None and response.ok, "Taplink page is unavailable"
    page.locator('.profile-card[data-config-source="published"]').wait_for()
    return page


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    errors = []

    regular_context = browser.new_context(viewport={"width": 390, "height": 844}, locale="ru-RU")
    install_public_payload(regular_context)
    page = open_taplink(regular_context, errors)
    custom_link = page.get_by_role("link", name=CUSTOM_LINK_LABEL)
    assert custom_link.get_attribute("data-taplink-button-style") == "outlined"
    assert custom_link.get_attribute("data-taplink-effect") == "shine"
    appearance = custom_link.evaluate(
        """element => {
          const style = getComputedStyle(element);
          return {
            backgroundColor: style.backgroundColor,
            color: style.color,
            borderRadius: style.borderRadius,
          };
        }"""
    )
    assert appearance == {
        "backgroundColor": "rgb(20, 52, 43)",
        "color": "rgb(255, 255, 255)",
        "borderRadius": "16px",
    }
    custom_link.focus()
    page.wait_for_timeout(250)
    focus_style = custom_link.evaluate(
        """element => {
          const style = getComputedStyle(element);
          return { outlineColor: style.outlineColor, boxShadow: style.boxShadow };
        }"""
    )
    assert focus_style["outlineColor"] == "rgb(255, 255, 255)"
    assert "rgb(33, 18, 12)" in focus_style["boxShadow"], focus_style
    assert page.evaluate(
        "document.documentElement.scrollWidth <= document.documentElement.clientWidth"
    )
    page.screenshot(path=str(ARTIFACTS / "published-appearance.png"), full_page=True)
    regular_context.close()

    reduced_context = browser.new_context(
        viewport={"width": 390, "height": 844}, locale="ru-RU", reduced_motion="reduce"
    )
    install_public_payload(reduced_context)
    reduced_page = open_taplink(reduced_context, errors)
    reduced_link = reduced_page.get_by_role("link", name=CUSTOM_LINK_LABEL)
    reduced_style = reduced_link.evaluate(
        """element => {
          const style = getComputedStyle(element);
          const glow = getComputedStyle(element.querySelector('.specular-glow'));
          const sheen = getComputedStyle(element, '::before');
          return {
            animationName: style.animationName,
            transform: style.transform,
            glowDisplay: glow.display,
            sheenDisplay: sheen.display,
          };
        }"""
    )
    assert reduced_style == {
        "animationName": "none",
        "transform": "none",
        "glowDisplay": "none",
        "sheenDisplay": "none",
    }
    reduced_context.close()

    browser.close()
    assert not errors, "Browser errors: " + " | ".join(errors)
    print(f"Taplink published appearance E2E passed; artifacts: {ARTIFACTS}")
