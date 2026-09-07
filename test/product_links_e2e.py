"""Read-only browser checks: short/legacy links, sharing, reload and history."""
import json
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4185').rstrip('/')
ROOT = Path(__file__).resolve().parents[1]
ID = '92f43875-b926-4063-8311-8b0e89c6a242'
SHORT = '/p/kvQ4dbkmQGODEYsOicaiQg'

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={'width': 390, 'height': 844}, locale='ru-RU',
                                  permissions=['clipboard-read', 'clipboard-write'])
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def api(route):
        path = urlparse(route.request.url).path
        body = {'success': True, 'categories': [], 'products': [], 'locations': [], 'cities': []}
        if path.endswith('/api/guest/menu'):
            body = {'success': True, 'categories': [{'id': 'buns', 'name': 'Булочки', 'imageUrl': ''}],
                    'products': [{'id': ID, 'categoryId': 'buns', 'name': 'Плюшка', 'price': 500,
                                  'imageUrl': '', 'onlineOrderable': True}]}
        route.fulfill(json=body)

    page.route('**/api/**', api)
    page.add_init_script("localStorage.setItem('flutter.selected_order_type', JSON.stringify('pickup'))")

    def loaded():
        page.locator('flt-glass-pane').wait_for(state='attached', timeout=45000)
        page.wait_for_function("document.title === 'Плюшка · Bulka'", timeout=30000)
        page.wait_for_timeout(600)
        assert urlparse(page.url).path == SHORT, page.url
        assert not urlparse(page.url).query and not urlparse(page.url).fragment, page.url

    for path in [SHORT, '/catalog/product/' + ID + '?category=Булочки#/catalog/product/' + ID]:
        page.goto(BASE + path, wait_until='domcontentloaded')
        loaded()
        page.reload(wait_until='domcontentloaded')
        loaded()
        print('Opened and reloaded:', path, '=>', page.url, page.title())

    page.mouse.click(34, 36)
    page.wait_for_timeout(500)
    copied = page.evaluate('navigator.clipboard.readText()')
    assert copied == 'https://bulka.com.kz' + SHORT, copied
    page.mouse.click(351, 36)
    page.wait_for_timeout(1000)
    assert urlparse(page.url).path.startswith('/catalog/category/'), page.url
    assert page.title() == 'Bulka', page.title()
    page.go_back(wait_until='domcontentloaded')
    page.wait_for_timeout(1000)
    assert not urlparse(page.url).fragment, page.url
    assert not errors, errors
    page.goto(BASE + SHORT, wait_until='domcontentloaded')
    loaded()
    output = ROOT / 'scratch/product-short-link.png'
    output.parent.mkdir(exist_ok=True)
    page.screenshot(path=str(output))
    print('Share, close, browser back, title and URL checks passed:', output)
    browser.close()
