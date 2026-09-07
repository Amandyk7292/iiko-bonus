"""Product photo layout with fixture data; never changes live orders or menu."""
import json
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4186').rstrip('/')
ROOT = Path(__file__).resolve().parents[1]
PHOTO = 'https://owofrgapcxsmzkdsefai.supabase.co/storage/v1/object/public/menu_images/menu_1784011936602_lz4c4o.webp'
ID = '92f43875-b926-4063-8311-8b0e89c6a242'

with sync_playwright() as p:
    browser = p.chromium.launch()
    for width, photo in [(390, PHOTO), (320, PHOTO), (390, '')]:
        page = browser.new_page(viewport={'width': width, 'height': 844}, locale='ru-RU')
        errors, loaded_images, loaded_fonts = [], [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('response', lambda r: loaded_images.append(r.url) if r.ok and 'menu_1784011936602' in r.url else None)
        page.on('response', lambda r: loaded_fonts.append(r.url) if r.ok and '.ttf' in r.url else None)

        def api(route):
            body = {'success': True, 'categories': [], 'products': [], 'locations': [], 'cities': []}
            if urlparse(route.request.url).path.endswith('/api/guest/menu'):
                body = {'success': True, 'categories': [{'id': 'buns', 'name': 'Булочки'}],
                        'products': [{'id': ID, 'categoryId': 'buns', 'name': 'Плюшка Московская',
                                      'price': 350, 'imageUrl': photo, 'onlineOrderable': True,
                                      'description': 'Мягкая сдобная булочка с сахарной корочкой.'}]}
            route.fulfill(json=body)

        page.route('**/api/**', api)
        page.add_init_script("localStorage.setItem('flutter.selected_order_type', JSON.stringify('pickup'))")
        page.goto(BASE + '/p/kvQ4dbkmQGODEYsOicaiQg', wait_until='domcontentloaded')
        expect(page).to_have_title('Плюшка Московская · Bulka', timeout=45000)
        page.wait_for_timeout(1800)
        if photo:
            assert loaded_images, 'Product photo did not load'
        assert any('Roboto-Bold-subset.ttf' in url for url in loaded_fonts), loaded_fonts
        assert not any('GolosText' in url for url in loaded_fonts), loaded_fonts
        assert not errors, errors
        output = ROOT / 'scratch' / ('product-photo-' + str(width) + ('-empty' if not photo else '') + '.png')
        output.parent.mkdir(exist_ok=True)
        page.screenshot(path=str(output))
        print('Photo layout:', width, bool(photo), output)
        page.close()
    browser.close()
