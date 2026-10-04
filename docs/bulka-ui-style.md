# Bulka controls and icons

Use original artwork from `shared/design/bulka-icons.json`. The reviewed 24-unit grid,
rounded caps and 1.7-unit stroke are shared by the Flutter font and web SVG sprite.
Brand and payment-provider logos retain their own identity artwork.

## Controls

- Primary action: warm gold gradient with brown text.
- Secondary action: ivory gradient, fine warm border and restrained depth.
- Selected choice: chocolate gradient and white text; keep the selected semantics.
- Destructive action: retain its red meaning. Loading and disabled controls cannot submit.
- Keep ordinary navigation, legal links and status labels visually lighter than actions.
- Touch targets are at least 44–48 px. Large text must wrap at word boundaries.
- Focus remains visible. Press feedback works above the finish; reduced motion is respected.

Flutter actions use the shared theme and `BulkaButtonSurface`; custom touch controls
use the same surface with `ink: true` inside their `Material`. Use opaque foregrounds
with sufficient contrast across the entire gradient. A local transparent background
keeps an existing composite control's own finish.

## Icons

Flutter keeps the familiar `Icons` API, but the `MaterialIcons` family in each pubspec
loads **our generated BulkaIcons.ttf**. `uses-material-design: false` prevents the stock
font being bundled. This also styles Flutter framework controls and adaptive iOS arrows.
The `packages/cupertino_icons/CupertinoIcons` family similarly loads our original
`BulkaCupertinoIcons.ttf` for iOS framework controls; the stock package is not bundled.
Never add a raw stock font or an uncovered `IconData` codepoint.

Admin code imports `components/BulkaIcons`, which preserves SVG props, refs and icon
names while rendering the original sprite. Standalone pages use `/assets/brand/bulka-icons.svg`.
Missing brand assets must return 404, and shared assets revalidate when the release changes.
Do not add emoji as interface icons or another stock icon library.

To add an icon, draw it in the canonical JSON and add the necessary semantic/API aliases.
Preserve distinctions such as checked/unchecked, filled/outline and microphone on/off.
Install the pinned generator requirements in an isolated Python environment, then run:

```text
python scripts/generate-bulka-ui-icons.py
python scripts/generate-bulka-ui-icons.py --check
npm run check:icons
```

The generator writes identical fonts for both compatibility families to both Flutter apps and identical SVG sprites
to the public site and admin assets. `check:icons` checks their actual glyph mappings
and source coverage and is part of `npm run verify`. Review small-size artwork and
representative screens before deliberately updating visual fixtures.

Native application sources inherit this family on their next build. Deploying the
website updates the browser and web-based staff wrapper; it does not replace installed
native Android/iOS or PricePrinter binaries.
