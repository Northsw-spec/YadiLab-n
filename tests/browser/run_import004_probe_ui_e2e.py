"""Optional offline Chromium UI test; real bundle, real imported CSV, real Engine.

Cloud policy blocks navigation to local HTTP/file. Uses about:blank with a strictly
SHA-256-equivalent WebCrypto test shim (not part of production app).
"""
import hashlib
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[2]
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                                args=['--no-sandbox', '--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1400,'height':900})
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.expose_function('__test_sha256', lambda b: list(hashlib.sha256(bytes(b)).digest()))
    page.set_content('<!DOCTYPE html><html><body><div id="app"></div></body></html>')
    page.evaluate('''() => {
      Object.defineProperty(globalThis.crypto, 'subtle', {configurable:true, value:{
        digest: async (name, value) => {
          if (name !== 'SHA-256') throw new Error('unsupported test digest');
          const bytes = await globalThis.__test_sha256(Array.from(new Uint8Array(value)));
          return new Uint8Array(bytes).buffer;
        }
      }});
    }''')
    page.add_style_tag(content=(ROOT/'ui/app/app.css').read_text())
    page.add_script_tag(content=(ROOT/'ui/dist/assets/app.js').read_text(),type='module')
    page.locator('[data-network-import-primary]').wait_for(timeout=25000)
    import json
    current_version=json.loads((ROOT/'package.json').read_text())['version']
    assert page.locator('[data-yadilab-build-version]').inner_text()==f'v{current_version}'
    with page.expect_file_chooser(timeout=10000) as picker:
        page.locator('[data-network-import-primary]').click()
    picker.value.set_files(str(ROOT/'examples/enterprise-import/network-devices-example.csv'))
    preview=page.locator('[data-network-import-preview]')
    preview.wait_for(timeout=15000)
    assert preview.get_attribute('data-network-import-preview')=='READY', preview.inner_text()
    assert 'Devices: 4 · Explicit links: 3' in preview.inner_text()
    page.locator('[data-network-import-runtime]').click()
    page.wait_for_function('document.querySelector(".app-frame")?.getAttribute("data-runtime-scenario-hash") !== "builder"',timeout=30000)
    page.locator('[data-open-active-probes]').wait_for(timeout=30000)
    pane=page.locator('[data-active-probe-engine]')
    pane.wait_for(timeout=15000)
    assert pane.get_attribute('open') is not None, 'Imported Runtime probe disclosure should auto-open'
    pane.get_by_role('button',name='Kör modellerad aktiv probe').click()
    transcript=page.locator('[data-active-probe-transcript]')
    transcript.wait_for(timeout=15000)
    assert transcript.get_attribute('data-active-probe-scenario-hash')==page.locator('.app-frame').get_attribute('data-runtime-scenario-hash')
    assert 'NO_GUEST_COMMAND_EXECUTION' in transcript.inner_text()
    assert not errors,errors[:5]
    municipal_path = os.environ.get('YADILAB_IMPORT004_TEST_XLSX')
    if municipal_path:
        with page.expect_file_chooser(timeout=10000) as picker:
            page.locator('[data-network-import-primary]').click()
        picker.value.set_files(municipal_path)
        municipal=page.locator('[data-network-import-preview]')
        municipal.wait_for(timeout=20000)
        assert municipal.get_attribute('data-network-import-preview')=='READY',municipal.inner_text()
        assert 'Devices: 47 · Explicit links: 46' in municipal.inner_text()
        page.locator('[data-network-import-runtime]').click()
        page.wait_for_function('document.querySelector(".app-frame")?.getAttribute("data-runtime-scenario-id") === "arvidsjaur_kommunhus_training"',timeout=30000)
        pane=page.locator('[data-active-probe-engine]')
        pane.wait_for(timeout=12000)
        assert pane.get_attribute('open') is not None
        src_select=pane.locator('select').nth(0)
        assert src_select.locator('option').count()==16,src_select.locator('option').count()
        src_select.select_option('it_pc01')
        pane.locator('select').nth(1).select_option('windows.ping')
        pane.locator('select').nth(2).select_option('core_sw01')
        pane.get_by_role('button',name='Kör modellerad aktiv probe').click()
        transcript=page.locator('[data-active-probe-transcript]')
        transcript.wait_for(timeout=12000)
        assert 'Engine ' in transcript.inner_text()
        assert transcript.get_attribute('data-active-probe-scenario-id')=='arvidsjaur_kommunhus_training'
        assert 'NO_GUEST_COMMAND_EXECUTION' in transcript.inner_text()
        print('PASS municipal XLSX browser: 47 devices / 46 links, 16 probe sources, explicit IT PC -> core switch ping, Engine:', transcript.inner_text()[:190])
    print('PASS IMPORT-004 browser: one-click CSV -> explicit Runtime -> auto-open modeled probes -> actual Engine transcript. Truth:',transcript.inner_text()[:210])
    browser.close()
