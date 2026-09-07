"""Read-only Flutter web QA with fixture accounts and real tier artwork."""
import json
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:4183/'
TIERS = [
    {'code': 'bronze', 'name': 'Бронза', 'percent': 3},
    {'code': 'silver', 'name': 'Серебро', 'percent': 4},
    {'code': 'platinum', 'name': 'Платина', 'percent': 5},
]

with sync_playwright() as p:
    browser = p.chromium.launch()
    for index, tier in enumerate(TIERS):
        loyalty = {**tier, 'level': index + 1, 'allTiers': TIERS, 'progress': 50 if index < 2 else 100,
                   'nextTier': TIERS[index + 1]['name'] if index < 2 else None, 'remaining': 5000}
        customer = {'id': '11111111-1111-4111-8111-111111111111', 'name': 'Алия', 'phone': '77000000000',
                    'balance': 1200, 'total_spent': 24000, 'cashbackPercent': tier['percent'], 'tier': loyalty,
                    'avatar_key': 'kz_male_01'}
        context = browser.new_context(viewport={'width': 390, 'height': 844}, locale='ru-RU')
        page = context.new_page()
        errors, artwork_requests = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))

        def api(route):
            pathname = urlparse(route.request.url).path
            payload = {'success': True, 'notifications': [], 'cities': [], 'locations': [], 'categories': [], 'products': []}
            if pathname.endswith('/api/guest/profile'):
                payload = {'success': True, 'exists': True, 'customer': customer, 'transactions': []}
            elif pathname.endswith('/api/customer/loyalty'):
                payload = {'success': True, 'loyalty': loyalty}
            elif pathname.endswith('/api/guest/stories'):
                payload = {'success': True, 'stories': [{'id': 7, 'title': 'Предложение', 'groupId': 'offer',
                    'groupTitle': 'Предложение', 'promoType': 'promotion', 'imageUrl': '', 'duration': 5}]}
            route.fulfill(json=payload)

        def image(route):
            name = Path(urlparse(route.request.url).path).name
            artwork_requests.append(name)
            route.fulfill(path=str(ROOT / 'public/assets/loyalty' / name), content_type='image/webp')

        page.route('**/api/**', api)
        page.route('**/assets/loyalty/*.webp', image)
        page.add_init_script('''(customer => {
            const values = {phone:'77000000000',accessToken:'qa-token',customer:JSON.stringify(customer),
                            transactions:'[]',app_theme_mode:'light',lastAppScreen:'main'};
            for (const [key,value] of Object.entries(values)) localStorage.setItem('flutter.'+key,JSON.stringify(value));
        })(''' + json.dumps(customer) + ')')
        page.goto(BASE, wait_until='domcontentloaded', timeout=120000)
        page.locator('flt-glass-pane').wait_for(state='attached', timeout=45000)
        page.wait_for_timeout(2000)
        page.mouse.click(350, 806)
        page.wait_for_timeout(1800)
        assert tier['code'] + '-v1.webp' in artwork_requests, (tier, artwork_requests)
        assert not errors, errors
        output = ROOT / 'scratch' / ('loyalty-profile-' + tier['code'] + '.png')
        output.parent.mkdir(exist_ok=True)
        page.screenshot(path=str(output))
        print(tier['code'], 'profile rendered; artwork loaded;', output)
        if tier['code'] == 'platinum':
            page.mouse.click(273, 806)
            page.wait_for_timeout(800)
            page.mouse.click(315, 104)
            page.wait_for_timeout(350)
            page.screenshot(path=str(ROOT / 'scratch/promos-outlined-tabs.png'))
            page.mouse.click(40, 806)
            page.wait_for_timeout(600)
            page.screenshot(path=str(ROOT / 'scratch/home-clean-loyalty.png'))
        context.close()
    browser.close()
