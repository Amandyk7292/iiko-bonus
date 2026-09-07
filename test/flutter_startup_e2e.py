"""Public shell remains usable while authentication is slow; no live mutations."""
import asyncio
import json
import re
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for slow in [False, True]:
            page = await browser.new_page(viewport={'width': 390, 'height': 844}, locale='ru-RU')
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            refresh_done = False

            async def api(route):
                nonlocal refresh_done
                if urlparse(route.request.url).path == '/api/auth/refresh':
                    if slow:
                        await asyncio.sleep(8)
                    refresh_done = True
                    await route.fulfill(status=401, json={'success': False})
                else:
                    await route.fulfill(json={'success': True, 'stories': [], 'news': [],
                        'products': [], 'categories': [], 'locations': [], 'cities': []})

            await page.route('**/api/**', api)
            # Cached identity must stay private until the server validates it.
            await page.add_init_script("localStorage.setItem('flutter.customer', JSON.stringify(JSON.stringify({id:'old',phone:'77000000000',name:'Чужой профиль',balance:987654})))")
            await page.add_init_script("window.addEventListener('flutter-first-frame',()=>window.firstFrameMs=performance.now(),{once:true})")
            began = time.monotonic()
            await page.goto('http://127.0.0.1:4187/', wait_until='domcontentloaded')
            await page.locator('#app-loading').wait_for(state='detached', timeout=15000)
            await page.locator('flt-semantics-placeholder').dispatch_event('click', timeout=10000)
            await expect(page.get_by_role('button', name=re.compile('^Каталог'))).to_be_visible(timeout=5000)
            elapsed = time.monotonic() - began
            assert await page.get_by_text('Чужой профиль', exact=True).count() == 0
            if slow:
                assert not refresh_done, 'Public interface still waited for authentication'
            assert elapsed < 3, f'Local startup exceeded budget: {elapsed:.2f}s'
            assert not errors, errors
            await page.screenshot(path=str(ROOT / 'scratch' / f'startup-{slow}.png'))
            print(json.dumps({'slow_auth': slow, 'usable_seconds': round(elapsed, 2),
                              'first_frame_ms': await page.evaluate('window.firstFrameMs')}, ensure_ascii=False))
            await page.close()
        await browser.close()

asyncio.run(main())
