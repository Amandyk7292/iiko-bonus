"""Browser regression checks for the standalone sales screen; no live sales mutations."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[2]

def snapshot(value=100.125, month='2026-09-01'):
    return {'ready': True, 'unit': 'kg', 'generatedAt': '2026-09-14T16:12:17Z', 'periods': {
        key: {'quantity': value, 'from': start} for key, start in
        [('all', '2000-01-01'), ('year', '2026-01-01'), ('month', month)]}}

with sync_playwright() as p:
    browser = p.chromium.launch()
    for motion in ['no-preference', 'reduce']:
        page = browser.new_page(viewport={'width': 1366, 'height': 768}, reduced_motion=motion)
        page.clock.install()
        state = {'data': snapshot(), 'fail': False, 'calls': 0}
        def route(request):
            url = request.request.url
            if '/api/public/' in url:
                state['calls'] += 1
                if state['fail']: request.fulfill(status=503, body='offline')
                else: request.fulfill(json=state['data'])
            elif '/taplink/assets/fonts/' in url:
                request.fulfill(path=str(ROOT / 'BulkaAndroid/assets/fonts' / url.rsplit('/', 1)[-1]))
            else:
                name = url.split('?', 1)[0].rsplit('/', 1)[-1]
                request.fulfill(path=str(ROOT / 'public/screencakes' / ('index.html' if name == 'screencakes' else name)))
        page.route('http://screencakes.test/**', route)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto('http://screencakes.test/screencakes')
        page.wait_for_function("document.getElementById('all-count').getAttribute('aria-label') === '100,125 кг'")
        page.clock.run_for(1800)
        assert page.locator('#all-count').inner_text() == '100,125'
        assert state['calls'] == 1, 'duplicate initial refresh'
        state['data'] = snapshot(101.375)
        page.clock.fast_forward(60000)
        page.wait_for_function("document.getElementById('all-count').getAttribute('aria-label') === '101,375 кг'")
        page.clock.run_for(1400)
        assert page.locator('#all-count').inner_text() == '101,375'
        assert page.locator('.delta.visible').count() == 3
        assert page.locator('.delta').first.inner_text() == '+1,25 кг'
        page.clock.fast_forward(60000)
        page.clock.run_for(100)
        assert page.locator('.delta.visible').count() == 0, 'unchanged totals replay animation'
        state['fail'] = True
        page.clock.fast_forward(60000)
        page.clock.run_for(100)
        assert page.locator('#all-count').inner_text() == '101,375'
        assert 'Связь' in page.locator('#status').inner_text()
        state['fail'] = False
        state['data'] = snapshot(100.375)
        page.clock.fast_forward(10000)
        page.wait_for_function("document.getElementById('all-count').getAttribute('aria-label') === '100,375 кг'")
        page.clock.run_for(1400)
        assert page.locator('#all-count').inner_text() == '100,375'
        assert page.locator('.delta').first.inner_text() == '−1 кг'
        page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.testHidden});window.testHidden=true;document.dispatchEvent(new Event('visibilitychange'))")
        before = state['calls']
        page.clock.fast_forward(180000)
        assert state['calls'] == before, 'hidden page polls'
        page.evaluate("window.testHidden=false;document.dispatchEvent(new Event('visibilitychange'))")
        page.clock.run_for(100)
        assert state['calls'] == before + 1
        state['data'] = snapshot(2, '2026-10-01')
        page.evaluate("window.dispatchEvent(new Event('online'))")
        page.wait_for_function("document.getElementById('month-count').getAttribute('aria-label') === '2 кг'")
        page.clock.run_for(1400)
        assert page.locator('#month-count').inner_text() == '2'
        assert page.locator('.metric').nth(2).locator('.delta.visible').count() == 0, 'month reset presented as sales'
        page.evaluate("window.dispatchEvent(new Event('pagehide'))")
        before = state['calls']
        page.clock.fast_forward(180000)
        assert state['calls'] == before
        page.evaluate("window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))")
        page.clock.run_for(100)
        assert state['calls'] == before + 1
        assert not errors, errors
        print(json.dumps({'motion': motion, 'checks': 'count-up, delta, unchanged, retry, hidden, resume, month, bfcache passed'}))
        state['data'] = snapshot(266862.148)
        page.evaluate("window.dispatchEvent(new Event('online'))")
        page.wait_for_function("document.getElementById('all-count').getAttribute('aria-label').includes('266')")
        page.clock.run_for(1800)
        for width, height in [(1920,1080), (1366,768), (390,844), (320,700)]:
            page.set_viewport_size({'width':width,'height':height})
            page.evaluate('document.fonts.ready')
            assert page.locator('.number').evaluate_all('(es)=>es.every(e=>e.scrollWidth<=e.clientWidth)'),width
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        page.close()
    browser.close()
