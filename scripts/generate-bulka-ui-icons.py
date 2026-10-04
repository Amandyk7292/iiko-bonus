#!/usr/bin/env python3
"""Generate Bulka's own SVG sprite and Material IconData compatible fonts.

The reviewed shared/design/bulka-icons.json is the only geometry source.
Requirements: Python 3.10+, fonttools, shapely. No network access is used.
Run with --check to verify committed assets without changing them.
"""

from __future__ import annotations

import argparse
from hashlib import sha256
import html
import io
import json
import math
from pathlib import Path
import sys
from typing import Any

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.basePen import BasePen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path
from shapely.geometry import LineString, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'shared/design/bulka-icons.json'
FONT_PATHS = [
    ROOT / 'BulkaAndroid/assets/fonts/BulkaIcons.ttf',
    ROOT / 'BulkaPricePrinter/assets/fonts/BulkaIcons.ttf',
]
CUPERTINO_FONT_PATHS = [
    ROOT / 'BulkaAndroid/assets/fonts/BulkaCupertinoIcons.ttf',
    ROOT / 'BulkaPricePrinter/assets/fonts/BulkaCupertinoIcons.ttf',
]
SPRITE_PATHS = [
    ROOT / 'public/assets/brand/bulka-icons.svg',
    ROOT / 'admin-ui/public/assets/brand/bulka-icons.svg',
]
FIXED_FONT_TIMESTAMP = 3786912000  # 2024-01-01, OpenType epoch; reproducible.


class FlattenPen(BasePen):
    """Sample original curves finely before outlining rounded SVG strokes."""

    def __init__(self) -> None:
        super().__init__(None)
        self.contours: list[list[tuple[float, float]]] = []
        self.current: list[tuple[float, float]] = []

    def _moveTo(self, point: tuple[float, float]) -> None:
        if self.current:
            self._endPath()
        self.current = [point]

    def _lineTo(self, point: tuple[float, float]) -> None:
        self.current.append(point)

    def _curveToOne(self, p1: tuple[float, float], p2: tuple[float, float], p3: tuple[float, float]) -> None:
        p0 = self.current[-1]
        length = sum(math.dist(a, b) for a, b in [(p0, p1), (p1, p2), (p2, p3)])
        steps = max(8, math.ceil(length * 3))
        for i in range(1, steps + 1):
            t, u = i / steps, 1 - i / steps
            self.current.append(tuple(
                u**3*p0[j] + 3*u*u*t*p1[j] + 3*u*t*t*p2[j] + t**3*p3[j]
                for j in (0, 1)
            ))

    def _qCurveToOne(self, p1: tuple[float, float], p2: tuple[float, float]) -> None:
        p0 = self.current[-1]
        steps = max(8, math.ceil((math.dist(p0, p1) + math.dist(p1, p2)) * 3))
        for i in range(1, steps + 1):
            t, u = i / steps, 1 - i / steps
            self.current.append(tuple(u*u*p0[j] + 2*u*t*p1[j] + t*t*p2[j] for j in (0, 1)))

    def _closePath(self) -> None:
        if self.current[-1] != self.current[0]:
            self.current.append(self.current[0])
        self._endPath()

    def _endPath(self) -> None:
        if self.current:
            self.contours.append(self.current)
            self.current = []


def validate(data: dict[str, Any]) -> None:
    if data['schemaVersion'] != 1 or data['viewBox'] != [0, 0, 24, 24]:
        raise ValueError('Unsupported Bulka icon schema/grid')
    if not 1.5 <= data['strokeWidth'] <= 1.9:
        raise ValueError('Stroke width outside reviewed optical range')
    for name, icon in data['icons'].items():
        if not icon['paths']:
            raise ValueError(f'{name}: empty geometry')
        for item in icon['paths']:
            pen = FlattenPen()
            parse_path(item['d'], pen)
            pen._endPath()
            if not pen.contours:
                raise ValueError(f'{name}: empty path')
            if item.get('fill') and any(len(c) < 4 or c[0] != c[-1] for c in pen.contours):
                raise ValueError(f'{name}: fill requires closed contours')
            for contour in pen.contours:
                for x, y in contour:
                    if not math.isfinite(x+y) or not -.5 <= x <= 24.5 or not -.5 <= y <= 24.5:
                        raise ValueError(f'{name}: geometry outside 24px grid at {x},{y}')
    for name, alias in data['materialAliases'].items():
        if alias['icon'] not in data['icons'] or not 0 <= alias['codepoint'] <= 0x10FFFF:
            raise ValueError(f'{name}: invalid font alias')
    for name, alias in data.get('cupertinoAliases', {}).items():
        if alias['icon'] not in data['icons'] or not 0 <= alias['codepoint'] <= 0x10FFFF:
            raise ValueError(f'{name}: invalid Cupertino alias')
    for name, target in data['webAliases'].items():
        if target not in data['icons']:
            raise ValueError(f'{name}: missing web geometry')


def outline(icon: dict[str, Any], width: float):
    pieces = []
    for item in icon['paths']:
        pen = FlattenPen()
        parse_path(item['d'], pen)
        pen._endPath()
        for contour in pen.contours:
            if item.get('fill'):
                pieces.append(Polygon(contour).buffer(0))
            elif len(contour) > 1:
                pieces.append(LineString(contour).buffer(width / 2, quad_segs=8, cap_style=1, join_style=1))
    result = unary_union(pieces).simplify(.012, preserve_topology=True)
    if result.is_empty or not result.is_valid:
        raise ValueError('Invalid or empty outlined glyph')
    return result


def to_glyph(geometry):
    pen = TTGlyphPen(None)
    polygons = list(geometry.geoms) if geometry.geom_type == 'MultiPolygon' else [geometry]
    for polygon in polygons:
        # y inversion makes the exterior clockwise in font coordinates.
        polygon = orient(polygon, sign=1)
        for ring in [polygon.exterior, *polygon.interiors]:
            points = []
            for x, y in ring.coords:
                point = (round(x * 512 / 24), round((24-y) * 512 / 24))
                if not points or points[-1] != point:
                    points.append(point)
            if points[-1] == points[0]:
                points.pop()
            if len(points) < 3:
                continue
            pen.moveTo(points[0])
            for point in points[1:]:
                pen.lineTo(point)
            pen.closePath()
    return pen.glyph()


def font_bytes(data: dict[str, Any], alias_key: str = 'materialAliases') -> bytes:
    is_cupertino = alias_key == 'cupertinoAliases'
    aliases = data[alias_key]
    names = sorted({item['icon'] for item in aliases.values()}) if is_cupertino else sorted(data['icons'])
    family = 'Bulka Atelier Cupertino' if is_cupertino else 'Bulka Atelier Icons'
    postscript = 'BulkaAtelierCupertino' if is_cupertino else 'BulkaAtelierIcons'
    fb = FontBuilder(512, isTTF=True)
    fb.setupGlyphOrder(['.notdef', *names])
    cmap: dict[int, str] = {}
    for alias in aliases.values():
        if alias['codepoint'] in cmap and cmap[alias['codepoint']] != alias['icon']:
            raise ValueError('Two different meanings share a font codepoint')
        cmap[alias['codepoint']] = alias['icon']
    fb.setupCharacterMap(cmap)
    glyphs = {'.notdef': TTGlyphPen(None).glyph()}
    for name in names:
        glyphs[name] = to_glyph(outline(data['icons'][name], data['strokeWidth']))
    fb.setupGlyf(glyphs)
    # Preserve the 24px optical margins. A zero side bearing would shift every
    # inset glyph to the left when a rasterizer normalizes its phantom points.
    fb.setupHorizontalMetrics({name: (512, getattr(glyph, 'xMin', 0)) for name, glyph in glyphs.items()})
    fb.setupHorizontalHeader(ascent=512, descent=0, lineGap=0)
    fb.setupNameTable({
        'familyName': family,
        'styleName': 'Regular',
        'uniqueFontIdentifier': postscript+'-1.0',
        'fullName': family+' Regular',
        'psName': postscript+'-Regular',
        'version': 'Version 1.000',
        'copyright': 'Original Bulka Atelier UI geometry. Dedicated to the public domain under CC0 1.0.',
        'licenseDescription': 'CC0 1.0 Universal',
        'licenseInfoURL': 'https://creativecommons.org/publicdomain/zero/1.0/',
    })
    fb.setupOS2(sTypoAscender=512, sTypoDescender=0, sTypoLineGap=0, usWinAscent=512, usWinDescent=0)
    fb.setupPost()
    fb.setupMaxp()
    fb.font['head'].created = FIXED_FONT_TIMESTAMP
    fb.font['head'].modified = FIXED_FONT_TIMESTAMP
    fb.font.recalcTimestamp = False
    out = io.BytesIO()
    fb.font.save(out)
    return out.getvalue()


def symbol(name: str, icon: dict[str, Any], width: float) -> str:
    paths = []
    for item in icon['paths']:
        if item.get('fill'):
            attrs = 'fill="currentColor" stroke="none"'
        else:
            attrs = f'fill="none" stroke="currentColor" stroke-width="{width:g}" stroke-linecap="round" stroke-linejoin="round"'
        paths.append(f'<path {attrs} d="{html.escape(item["d"], quote=True)}"/>')
    return f'<symbol id="{html.escape(name, quote=True)}" viewBox="0 0 24 24">'+''.join(paths)+'</symbol>'


def sprite_bytes(data: dict[str, Any]) -> bytes:
    mappings = {name: name for name in data['icons']}
    mappings.update({name: value['icon'] for name, value in data['materialAliases'].items()})
    mappings.update(data['webAliases'])
    body = '\n'.join(symbol(name, data['icons'][target], data['strokeWidth']) for name, target in sorted(mappings.items()))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!-- Bulka Atelier Icons: original shared geometry, CC0-1.0. Generated; edit shared/design/bulka-icons.json. -->\n'
            '<svg xmlns="http://www.w3.org/2000/svg">\n'+body+'\n</svg>\n').encode()


def contact_sheet(data: dict[str, Any], destination: Path) -> None:
    names = sorted(data['icons'])
    width, columns, tile = 1100, 11, 100
    rows = math.ceil(len(names) / columns)
    elements = []
    for i, name in enumerate(names):
        x, y = (i % columns)*tile, (i // columns)*96+58
        elements.append(f'<rect x="{x+5}" y="{y+5}" width="90" height="83" rx="16" fill="#fff"/>')
        elements.append(f'<g transform="translate({x+34} {y+16}) scale(1.33)" color="#63311d">')
        for item in data['icons'][name]['paths']:
            attrs = 'fill="currentColor"' if item.get('fill') else f'fill="none" stroke="currentColor" stroke-width="{data["strokeWidth"]}" stroke-linecap="round" stroke-linejoin="round"'
            elements.append(f'<path {attrs} d="{item["d"]}"/>')
        elements.append('</g>')
        elements.append(f'<text x="{x+50}" y="{y+72}" fill="#755d4f" text-anchor="middle" font-family="Arial,sans-serif" font-size="9">{html.escape(name)}</text>')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{rows*96+72}" viewBox="0 0 {width} {rows*96+72}"><rect width="100%" height="100%" fill="#f8f2e8"/><text x="18" y="33" font-family="Arial,sans-serif" font-weight="bold" font-size="22" fill="#63311d">Bulka Atelier · 24px · 1.7px rounded stroke</text>'+''.join(elements)+'</svg>\n', encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Compare assets with source, without modifying them')
    parser.add_argument('--contact-sheet', type=Path, help='Write an optional local review SVG')
    args = parser.parse_args()
    data = json.loads(DATA.read_text(encoding='utf-8'))
    validate(data)
    font, cupertino, sprite = font_bytes(data), font_bytes(data, 'cupertinoAliases'), sprite_bytes(data)
    failed = []
    for paths, body in [(FONT_PATHS, font), (CUPERTINO_FONT_PATHS, cupertino), (SPRITE_PATHS, sprite)]:
        for path in paths:
            if args.check:
                if not path.is_file() or path.read_bytes() != body:
                    failed.append(str(path.relative_to(ROOT)))
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(body)
    if args.contact_sheet:
        contact_sheet(data, args.contact_sheet)
    print(json.dumps({'icons': len(data['icons']), 'materialAliases': len(data['materialAliases']), 'cupertinoAliases': len(data['cupertinoAliases']), 'webAliases': len(data['webAliases']), 'fontBytes': len(font), 'fontSha256': sha256(font).hexdigest(), 'cupertinoFontBytes': len(cupertino), 'cupertinoFontSha256': sha256(cupertino).hexdigest(), 'spriteBytes': len(sprite), 'spriteSha256': sha256(sprite).hexdigest(), 'outOfDate': failed}))
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
