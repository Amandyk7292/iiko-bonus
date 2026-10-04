#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const artwork = JSON.parse(read('shared/design/bulka-icons.json'));
const sprite = read('public/assets/brand/bulka-icons.svg');
const symbolIds = new Set([...sprite.matchAll(/<symbol\s+id="([^"]+)"/g)].map((m) => m[1]));
const allFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(file) : [file];
  });

// Inspect the actual generated cmap: an alias in JSON must have a drawable glyph in the shipped font.
function fontGlyphs(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x00010000, 'Expected generated TrueType font');
  let cmap;
  for (let i = 0; i < buffer.readUInt16BE(4); i++) {
    const table = 12 + i * 16;
    if (buffer.toString('ascii', table, table + 4) === 'cmap')
      cmap = buffer.readUInt32BE(table + 8);
  }
  assert.notEqual(cmap, undefined, 'Icon font has no cmap');
  const mapped = new Set();
  for (let i = 0; i < buffer.readUInt16BE(cmap + 2); i++) {
    const sub = cmap + buffer.readUInt32BE(cmap + 4 + i * 8 + 4);
    const format = buffer.readUInt16BE(sub);
    if (format === 4) {
      const count = buffer.readUInt16BE(sub + 6) / 2;
      const ends = sub + 14;
      const starts = ends + count * 2 + 2;
      const deltas = starts + count * 2;
      const offsets = deltas + count * 2;
      for (let segment = 0; segment < count; segment++) {
        const start = buffer.readUInt16BE(starts + segment * 2);
        const end = buffer.readUInt16BE(ends + segment * 2);
        const delta = buffer.readInt16BE(deltas + segment * 2);
        const offset = buffer.readUInt16BE(offsets + segment * 2);
        for (let code = start; code <= end && code < 0xffff; code++) {
          let glyph = offset
            ? buffer.readUInt16BE(offsets + segment * 2 + offset + (code - start) * 2)
            : code;
          if (!offset || glyph) glyph = (glyph + delta) & 0xffff;
          if (glyph) mapped.add(code);
        }
      }
    } else if (format === 12) {
      for (let group = 0; group < buffer.readUInt32BE(sub + 12); group++) {
        const at = sub + 16 + group * 12;
        const start = buffer.readUInt32BE(at),
          end = buffer.readUInt32BE(at + 4);
        const glyph = buffer.readUInt32BE(at + 8);
        for (let code = start; code <= end; code++) if (glyph + code - start) mapped.add(code);
      }
    }
  }
  return mapped;
}

assert.equal(artwork.schemaVersion, 1);
for (const [name, icon] of Object.entries(artwork.icons)) {
  assert.ok(icon.paths.length > 0, `Empty drawing: ${name}`);
  assert.ok(
    icon.paths.every((p) => typeof p.d === 'string' && p.d.length > 0),
    name,
  );
  assert.ok(symbolIds.has(name), `Missing SVG drawing: ${name}`);
}
for (const [alias, name] of Object.entries(artwork.webAliases)) {
  assert.ok(artwork.icons[name], `Unknown web drawing: ${alias}`);
  assert.ok(symbolIds.has(alias), `Missing web SVG alias: ${alias}`);
}
const fontBuffers = ['BulkaAndroid', 'BulkaPricePrinter'].map((app) => {
  const spec = read(`${app}/pubspec.yaml`);
  assert.match(spec, /uses-material-design:\s*false/, `${app} must not bundle stock icons`);
  assert.match(
    spec,
    /family:\s*MaterialIcons\s+fonts:\s+- asset:\s*assets\/fonts\/BulkaIcons\.ttf/,
    app,
  );
  const font = fs.readFileSync(path.join(root, app, 'assets/fonts/BulkaIcons.ttf'));
  const codes = fontGlyphs(font);
  for (const [alias, mapping] of Object.entries(artwork.materialAliases)) {
    assert.ok(artwork.icons[mapping.icon], `Unknown font drawing: ${alias}`);
    assert.ok(codes.has(mapping.codepoint), `Undrawable font alias: ${alias}`);
  }
  assert.doesNotMatch(spec, /^\s+cupertino_icons:/m, `${app} must not bundle stock iOS icons`);
  assert.match(
    spec,
    /family:\s*packages\/cupertino_icons\/CupertinoIcons\s+fonts:\s+- asset:\s*assets\/fonts\/BulkaCupertinoIcons\.ttf/,
  );
  const nativeFont = fs.readFileSync(path.join(root, app, 'assets/fonts/BulkaCupertinoIcons.ttf'));
  const nativeCodes = fontGlyphs(nativeFont);
  for (const [alias, mapping] of Object.entries(artwork.cupertinoAliases)) {
    assert.ok(artwork.icons[mapping.icon], `Unknown iOS drawing: ${alias}`);
    assert.ok(nativeCodes.has(mapping.codepoint), `Undrawable iOS alias: ${alias}`);
  }
  for (const file of allFiles(path.join(root, app, 'lib')).filter((f) => f.endsWith('.dart'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bIcons\s*\.\s*([a-zA-Z0-9_]+)/g)) {
      assert.ok(
        artwork.materialAliases[match[1]],
        `Unmapped icon ${match[1]} in ${path.relative(root, file)}`,
      );
    }
    for (const match of source.matchAll(/\bCupertinoIcons\s*\.\s*([a-zA-Z0-9_]+)/g)) {
      assert.ok(artwork.cupertinoAliases[match[1]], `Unmapped iOS icon ${match[1]} in ${file}`);
    }
  }
  return { font, nativeFont };
});
assert.ok(
  fontBuffers[0].font.equals(fontBuffers[1].font),
  'Apps must use identical original icon artwork',
);
assert.ok(
  fontBuffers[0].nativeFont.equals(fontBuffers[1].nativeFont),
  'Apps must use identical original iOS artwork',
);
for (const file of allFiles(path.join(root, 'admin-ui/src')).filter((f) => /\.[jt]sx?$/.test(f))) {
  const source = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(source, /from\s+['"]lucide-react['"]/, `Stock icon import: ${file}`);
}
for (const match of read('admin-ui/src/components/BulkaIcons.tsx').matchAll(
  /createBulkaIcon\('([^']+)'\)/g,
)) {
  assert.ok(symbolIds.has(match[1]), `Undrawable admin icon: ${match[1]}`);
}
console.log(
  `Bulka icon coverage passed: ${Object.keys(artwork.icons).length} drawings, ${Object.keys(artwork.materialAliases).length} font aliases, ${Object.keys(artwork.cupertinoAliases).length} iOS aliases, ${Object.keys(artwork.webAliases).length} web aliases.`,
);
