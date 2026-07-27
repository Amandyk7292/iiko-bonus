#!/usr/bin/env python3
"""Generate Bulka launcher, iOS and PWA icons from the official wordmark."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "BulkaAndroid"
BRAND = APP / "assets" / "brand"
MASTER_SIZE = 1024


def _blend(start: tuple[int, int, int], end: tuple[int, int, int], amount: float):
    return tuple(round(a + (b - a) * amount) for a, b in zip(start, end))


def _background() -> Image.Image:
    top = (255, 220, 112)
    middle = (255, 184, 20)
    bottom = (222, 126, 10)
    stops = []
    for y in range(MASTER_SIZE):
        position = y / (MASTER_SIZE - 1)
        if position < 0.56:
            color = _blend(top, middle, position / 0.56)
        else:
            color = _blend(middle, bottom, (position - 0.56) / 0.44)
        stops.append(color)
    base = Image.new("RGB", (1, MASTER_SIZE))
    base.putdata(stops)
    base = base.resize((MASTER_SIZE, MASTER_SIZE))

    glow_mask = Image.new("L", base.size)
    glow_mask.paste(170, (-190, -230, 670, 620))
    glow_mask = glow_mask.filter(ImageFilter.GaussianBlur(150))
    glow = Image.new("RGB", base.size, (255, 246, 190))
    base = Image.composite(glow, base, glow_mask)

    vignette = Image.radial_gradient("L").resize(base.size, Image.Resampling.LANCZOS)
    vignette = vignette.point(lambda value: round(value * 0.22))
    cocoa = Image.new("RGB", base.size, (91, 42, 17))
    return Image.composite(cocoa, base, vignette)


def _fit_width(mask: Image.Image, width: int) -> Image.Image:
    height = round(mask.height * width / mask.width)
    return mask.resize((width, height), Image.Resampling.LANCZOS)


def _foreground() -> Image.Image:
    logo = Image.open(BRAND / "bulka_logo.png").convert("RGBA")
    bounds = logo.getchannel("A").getbbox()
    if bounds is None:
        raise RuntimeError("Official Bulka logo is empty")
    logo = logo.crop(bounds)
    logo = _fit_width(logo, 760)

    foreground = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE))
    position = (
        (MASTER_SIZE - logo.width) // 2,
        (MASTER_SIZE - logo.height) // 2,
    )
    foreground.paste(logo, position, logo)
    return foreground


def _save_resized(source: Image.Image, target: Path, size: int) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    image = source.resize((size, size), Image.Resampling.LANCZOS)
    image.save(target, "PNG", optimize=True)


def _generate_ios(master: Image.Image) -> None:
    icon_dir = APP / "ios" / "Runner" / "Assets.xcassets" / "AppIcon.appiconset"
    contents = json.loads((icon_dir / "Contents.json").read_text(encoding="utf-8"))
    for entry in contents["images"]:
        filename = entry.get("filename")
        if not filename:
            continue
        points = float(entry["size"].split("x", 1)[0])
        scale = int(entry["scale"].removesuffix("x"))
        _save_resized(master, icon_dir / filename, round(points * scale))


def main() -> None:
    background = _background().convert("RGBA")
    foreground = _foreground()
    master = Image.alpha_composite(background, foreground).convert("RGB")

    BRAND.mkdir(parents=True, exist_ok=True)
    master.save(BRAND / "app_icon_master.png", "PNG", optimize=True)
    foreground.save(BRAND / "app_icon_foreground.png", "PNG", optimize=True)

    web_icons = APP / "web" / "icons"
    for filename, size in {
        "Icon-192.png": 192,
        "Icon-512.png": 512,
        "Icon-maskable-192.png": 192,
        "Icon-maskable-512.png": 512,
        "apple-touch-icon.png": 180,
    }.items():
        _save_resized(master, web_icons / filename, size)
    _save_resized(master, APP / "web" / "favicon.png", 48)

    android_res = APP / "android" / "app" / "src" / "main" / "res"
    densities = {
        "mdpi": (48, 108),
        "hdpi": (72, 162),
        "xhdpi": (96, 216),
        "xxhdpi": (144, 324),
        "xxxhdpi": (192, 432),
    }
    for density, (legacy_size, foreground_size) in densities.items():
        directory = android_res / f"mipmap-{density}"
        _save_resized(master, directory / "ic_launcher.png", legacy_size)
        _save_resized(master, directory / "ic_launcher_round.png", legacy_size)
        _save_resized(foreground, directory / "ic_launcher_foreground.png", foreground_size)

    _generate_ios(master)
    print("Generated Bulka icons for Android, iOS and web")


if __name__ == "__main__":
    main()
