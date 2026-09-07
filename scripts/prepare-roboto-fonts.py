"""Bundle static Roboto weights (Google Fonts, OFL) for the customer app."""
from io import BytesIO
from pathlib import Path
from urllib.request import urlopen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.subset import Options, Subsetter
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'BulkaAndroid/assets/fonts'
SOURCE = 'https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/'
font_bytes = urlopen(SOURCE + 'Roboto%5Bwdth,wght%5D.ttf', timeout=30).read()
(OUT / 'Roboto-OFL.txt').write_bytes(urlopen(SOURCE + 'OFL.txt', timeout=30).read())
for name, weight in [('Regular', 400), ('Medium', 500), ('SemiBold', 600), ('Bold', 700)]:
    font = instantiateVariableFont(TTFont(BytesIO(font_bytes)), {'wght': weight, 'wdth': 100}, inplace=True)
    # Roboto lacks the tenge sign. Reuse the existing OFL Montserrat glyph,
    # scaled to Roboto's metrics, instead of fetching a fallback font at runtime.
    donor = TTFont(OUT / f'Montserrat-{name}-subset.ttf')
    donor_glyphs = donor.getGlyphSet()
    donor_name = donor.getBestCmap()[0x20B8]
    scale = font['head'].unitsPerEm / donor['head'].unitsPerEm
    pen = TTGlyphPen(None)
    donor_glyphs[donor_name].draw(TransformPen(pen, (scale, 0, 0, scale, 0, 0)))
    glyph_name = 'bulka.tenge'
    font.setGlyphOrder(font.getGlyphOrder() + [glyph_name])
    font['glyf'][glyph_name] = pen.glyph()
    width, bearing = donor['hmtx'][donor_name]
    font['hmtx'][glyph_name] = (round(width * scale), round(bearing * scale))
    for table in font['cmap'].tables:
        if table.isUnicode():
            table.cmap[0x20B8] = glyph_name
    options = Options()
    options.layout_features = ['*']
    subset = Subsetter(options=options)
    subset.populate(unicodes=list(range(0x20, 0x530)) + list(range(0x2000, 0x2070))
                    + list(range(0x20A0, 0x20C1)) + [0x2116, 0x2122, 0x2212])
    subset.subset(font)
    path = OUT / f'Roboto-{name}-subset.ttf'
    font.save(path)
    cmap = font.getBestCmap()
    assert all(ord(letter) in cmap for letter in 'ӘәҒғҚқҢңӨөҰұҮүҺһІі₸'), name
    print(path.name, path.stat().st_size)
