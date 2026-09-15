"""Local admin UI regression; all API and image requests are intercepted."""
import base64
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:5178/admin'
ENGINE = sys.argv[2] if len(sys.argv) > 2 else 'chromium'
OUT = Path.home() / 'Downloads' / 'Bulka-photo-upload-2026-09-15'
OUT.mkdir(exist_ok=True)
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCz0AAAAASUVORK5CYII=')
with sync_playwright() as p:
    browser = getattr(p, ENGINE).launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, locale='ru-RU')
    page.add_init_script("localStorage.setItem('adminSelectedBranchId','branch-a');")
    errors, pending, uploads = [], [], []
    saved = {'default': {}, 'astana': {}}
    page.on('pageerror', lambda error: errors.append(str(error)))

    def json_response(route, body, status=200):
        route.fulfill(status=status, content_type='application/json', body=json.dumps(body))

    def api(route):
        req = route.request
        path = urlparse(req.url).path
        profile = 'astana' if req.headers.get('x-bulka-branch-id') == 'branch-b' else 'default'
        if path.endswith('/session'):
            json_response(route, {'user': {'username': 'admin', 'role': 'owner'}})
        elif path.endswith('/scope'):
            json_response(route, {'success': True, 'locations': [
                {'id': 'branch-a', 'city': 'Актау', 'name': 'Точка А', 'address': 'А', 'active': True},
                {'id': 'branch-b', 'city': 'Астана', 'name': 'Точка Б', 'address': 'Б', 'active': True},
            ]})
        elif path.endswith('/menu'):
            json_response(route, {'success': True, 'profileKey': profile,
                'profiles': {key: {'key': key, 'city': city, 'configured': True} for key, city in [('default', 'Актау'), ('astana', 'Астана')]},
                'rawMenu': {'groups': [{'id': 'cakes', 'name': 'Десерты'}], 'products': [
                    {'id': 'cake', 'name': 'Рулет', 'parentGroup': 'cakes', 'price': 2800, 'imageLinks': []}]},
                'overrides': {'products': [{'iiko_product_id': 'cake', **saved[profile]}], 'categories': [], 'customProducts': []}})
        elif path.endswith('/menu/upload-photo'):
            fields = dict(re.findall(r'name="(targetType|targetId|profileKey)"\r\n\r\n([^\r]+)', req.post_data_buffer.decode('latin1')))
            uploads.append({'fields': fields, 'branch': req.headers.get('x-bulka-branch-id')})
            pending.append(route)
        elif path.endswith('/events'):
            route.fulfill(status=200, content_type='text/event-stream', body='event: connected\ndata: {"type":"connected","data":{"ready":true}}\n\n')
        elif path.endswith('/operations/summary'):
            json_response(route, {'success': True, 'updatedAt': '2026-09-15T00:00:00Z',
                'capabilities': {}, 'counts': {}, 'orders': [], 'support': [], 'whatsapp': []})
        else:
            json_response(route, {'success': True, 'data': []})

    page.route('**/admin/api/**', api)
    page.route('https://photos.test/**', lambda route: route.fulfill(content_type='image/png', body=PNG))
    def navigate(href):
        link = page.locator(f'a[href="{href}"]')
        toggle = page.locator('.sidebar-section').filter(has=link).locator('button.sidebar-section-toggle')
        if toggle.get_attribute('aria-expanded') == 'false':
            toggle.click()
        link.click()
    page.goto(BASE + '/menu', wait_until='networkidle')
    upload = page.locator('label[aria-label="Загрузить фото для Рулет"] input')
    expect(upload).to_be_enabled()
    upload.set_input_files({'name': 'cake.png', 'mimeType': 'image/png', 'buffer': PNG})
    expect(page.get_by_text('Загрузка и сохранение…')).to_be_visible()
    page.get_by_role('tab', name=re.compile('Категории')).click()
    expect(page.get_by_text('Загрузка и сохранение…')).to_be_visible()
    page.get_by_role('button', name=re.compile('Редактировать меню города Астана')).click()
    page.get_by_role('tab', name=re.compile('Блюда iiko')).click()
    expect(page.get_by_role('button', name=re.compile('Редактировать меню города Астана'))).to_have_attribute('aria-pressed', 'true')
    navigate('/admin/operations')
    expect(page.get_by_text('Загрузка и сохранение…')).to_be_visible()
    assert len(pending) == 1, len(pending)
    assert uploads[0] == {'fields': {'targetType': 'product', 'targetId': 'cake', 'profileKey': 'default'}, 'branch': 'branch-a'}, uploads
    saved['default']['custom_image_url'] = 'https://photos.test/new.png'
    json_response(pending.pop(), {'success': True, 'imageUrl': saved['default']['custom_image_url']})
    expect(page.get_by_text('Фото сохранено')).to_be_visible()
    page.screenshot(path=str(OUT / f'{ENGINE}-completed-other-page.png'))
    navigate('/admin/menu')
    expect(page.get_by_role('tab', name=re.compile('Блюда iiko'))).to_be_visible()
    assert page.locator('img[src="https://photos.test/new.png"]').count() == 0, 'must not apply photo to Astana'
    page.get_by_role('button', name=re.compile('Редактировать меню города Актау')).click()
    expect(page.locator('img[src="https://photos.test/new.png"]')).to_be_visible()
    page.screenshot(path=str(OUT / f'{ENGINE}-saved-photo.png'))
    assert not errors, errors
    print(json.dumps({'engine': ENGINE, 'continuedAcrossTabsAndRoutes': True, 'originalCityPreserved': True, 'photoVisibleAfterReturning': True, 'errors': errors}))
    browser.close()
