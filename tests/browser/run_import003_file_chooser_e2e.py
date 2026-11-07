"""Optional Chromium E2E test for IMPORT-003, requires `playwright` + Chromium.

Network navigation is blocked in some cloud browsers. Inject the *actual* built JS/CSS
into an offline about:blank page to verify clickable DOM behavior. Note that such an
opaque-origin document lacks WebCrypto, so this cannot test Builder activation.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
CHROMIUM = '/usr/bin/chromium'

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROMIUM, headless=True,
                                args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 1280, 'height': 760})
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    page.set_content('<!DOCTYPE html><html><body><div id="app"></div></body></html>')
    page.add_style_tag(content=(ROOT / 'ui/app/app.css').read_text())
    page.add_script_tag(content=(ROOT / 'ui/dist/assets/app.js').read_text(), type='module')
    main = page.locator('[data-network-import-primary]')
    main.wait_for(timeout=15000)
    import json
    version=json.loads((ROOT/'package.json').read_text())['version']
    assert page.locator('[data-yadilab-build-version]').inner_text() == f'v{version}'
    assert page.locator('[data-development-checkpoint]').get_attribute('data-development-checkpoint') == 'IMPORT-004'
    assert page.locator('[data-network-import-panel]').count() == 0

    # Real click -> browser's native file chooser, without a second button press.
    with page.expect_file_chooser(timeout=5000) as chooser_info:
        main.click()
    assert page.locator('[role="dialog"]').is_visible()
    assert page.locator('[data-network-import-activate]').count() == 0
    chooser_info.value.set_files(str(ROOT / 'examples/enterprise-import/network-devices-example.csv'))
    preview = page.locator('[data-network-import-preview]')
    preview.wait_for(timeout=15000)
    assert preview.get_attribute('data-network-import-preview') == 'READY'
    assert 'Devices: 4 · Explicit links: 3' in preview.inner_text()
    assert page.locator('[data-network-import-activate]').is_enabled()

    # Closing the dialog must not change the underlying workspace.
    initial_scenario_id = page.locator('.app-frame[data-app-runtime]').get_attribute('data-runtime-scenario-id')
    page.get_by_role('button', name='Close network import').click()
    assert page.locator('[data-network-import-panel]').count() == 0
    assert page.locator('.app-frame[data-app-runtime]').get_attribute('data-runtime-scenario-id') == initial_scenario_id

    # Invalid references block import and activation.
    with page.expect_file_chooser(timeout=5000) as chooser_info:
        main.click()
    chooser_info.value.set_files({'name': 'invalid.csv', 'mimeType': 'text/csv',
                                   'buffer': b'Asset ID,Hostname,Device Type,Connected To\nnode01,Office PC,Windows,ghost\n'})
    invalid = page.locator('[data-network-import-preview]')
    invalid.wait_for(timeout=15000)
    assert invalid.get_attribute('data-network-import-preview') == 'BLOCKED', invalid.inner_text()
    assert page.locator('[data-network-import-activate]').is_disabled()
    assert page.locator('.app-frame[data-app-runtime]').get_attribute('data-runtime-scenario-id') == initial_scenario_id
    page.get_by_role('button', name='Close network import').click()

    # Binary .xlsx must also be accepted by the same native one-click path.
    with page.expect_file_chooser(timeout=5000) as chooser_info:
        main.click()
    chooser_info.value.set_files(str(ROOT / 'examples/enterprise-import/enterprise-import-template.xlsx'))
    xlsx = page.locator('[data-network-import-preview]')
    xlsx.wait_for(timeout=15000)
    assert xlsx.get_attribute('data-network-import-preview') == 'READY', xlsx.inner_text()
    assert '.xlsx' in xlsx.inner_text().lower()
    assert not errors, errors
    print('PASS IMPORT-004 Chromium real click -> filechooser, CSV 4 devices/3 links, visible dialog, cancel safety, blocked bad links, XLSX preview; runtime activation not tested on opaque offline origin')
    browser.close()
