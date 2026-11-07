#!/usr/bin/env python3
"""Acceptance-only Chromium/Playwright UI workflow; not a shipped runtime dependency.

Runs only against a *real* dependency-resolved app on localhost. The shell and
synthetic release manifest are always rejected. Missing testing dependencies
are BLOCKED (77); a loaded app with a broken interaction is FAIL (1).
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile


class AcceptanceFailure(AssertionError):
    pass


def require(value, detail):
    if not value:
        raise AcceptanceFailure(detail)


def verify_downloaded_student_package(content):
    """Independent ZIP/hash/solution-policy check on actual browser download."""
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        infos = archive.infolist()
        names = [item.filename for item in infos]
        require(len(infos) <= 256 and sum(x.file_size for x in infos) <= 64*1024*1024
                and all(x.file_size <= 32*1024*1024 for x in infos), 'ZIP acceptance limits exceeded')
        require(len(names) == len(set(names)), 'duplicate ZIP paths')
        require(all(not n.startswith('/') and '\\' not in n and '..' not in n.split('/') for n in names), 'unsafe ZIP path')
        require({'manifest.json', 'scenario.json', 'layout.json'} <= set(names), 'missing core package files')
        require('solution.json' not in names, 'student package leaked canonical solution')
        manifest = json.loads(archive.read('manifest.json'))
        scenario = json.loads(archive.read('scenario.json'))
        layout = json.loads(archive.read('layout.json'))
        require(manifest['distribution'] == 'student', 'wrong package distribution')
        require(manifest['scenarioId'] == scenario['scenarioId'] == layout['scenarioId'], 'inconsistent scenario ID')
        require('canonicalSolution' not in scenario, 'student scenario leaked canonical solution')
        files = manifest['files']
        require(isinstance(files, list) and len(files) == len(names)-1, 'incomplete file manifest')
        paths = [record['path'] for record in files]
        require(len(paths) == len(set(paths)) and set(paths) == set(names)-{'manifest.json'}, 'file manifest mismatch')
        for record in files:
            b = archive.read(record['path'])
            require(len(b) == record['size'], 'package size mismatch')
            require(hashlib.sha256(b).hexdigest() == record['sha256'], 'package hash mismatch')
        return manifest, scenario


def tamper_student_zip(content):
    """Mutate scenario bytes but intentionally retain its original manifest/hash."""
    out = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(content)) as original, zipfile.ZipFile(out, 'w', compression=zipfile.ZIP_DEFLATED) as forged:
        for entry in original.infolist():
            data = original.read(entry.filename)
            if entry.filename == 'scenario.json':
                data = data + b'\n '
            forged.writestr(entry.filename, data)
    return out.getvalue()


def selftest():
    b = lambda value: json.dumps(value, sort_keys=True, separators=(',', ':')).encode()
    scenario = {'scenarioId': 'scenario_1', 'resources': [], 'formatId':'infrastructure-cyber-lab.scenario'}
    layout = {'scenarioId': 'scenario_1', 'nodes': []}
    s, l = b(scenario), b(layout)
    records = [{'path': name, 'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)} for name,data in [('scenario.json',s),('layout.json',l)]]
    m = b({'distribution': 'student', 'scenarioId': 'scenario_1', 'files': records})
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as z:
        for name, data in [('manifest.json',m),('scenario.json',s),('layout.json',l)]: z.writestr(name,data)
    content = out.getvalue()
    verify_downloaded_student_package(content)
    counter = 1
    for name, data in [('solution.json', b({'operations': []})), ('assets/../escape',b('x'))]:
        changed = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(content)) as original, zipfile.ZipFile(changed,'w') as z:
            for item in original.namelist(): z.writestr(item,original.read(item))
            z.writestr(name,data)
        try: verify_downloaded_student_package(changed.getvalue())
        except AcceptanceFailure: counter += 1
        else: raise AssertionError(f'must reject {name}')
    try: verify_downloaded_student_package(tamper_student_zip(content))
    except AcceptanceFailure: counter += 1
    else: raise AssertionError('must reject modified-hash package')
    modified = json.loads(m);modified['distribution']='author'
    changed=io.BytesIO()
    with zipfile.ZipFile(changed,'w') as z:
        z.writestr('manifest.json',b(modified));z.writestr('scenario.json',s);z.writestr('layout.json',l)
    try: verify_downloaded_student_package(changed.getvalue())
    except AcceptanceFailure: counter += 1
    else: raise AssertionError('must reject author distribution')
    print(f'PASS browser workflow independent ZIP verifier: {counter} fixture scenarios.')


def wait_condition(page, expression, msg, timeout=30000):
    try: page.wait_for_function(expression, timeout=timeout)
    except Exception as exc: raise AcceptanceFailure(f'{msg}: {exc}') from exc



def _free_loopback_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def verify_offline_reload(browser, launcher, evidence_dir):
    # Prove the packaged full app survives reload after its loopback server stops.
    launcher_path = Path(launcher).resolve()
    require(launcher_path.is_file(), 'offline reload launcher path is missing')
    port = _free_loopback_port()
    url = f'http://127.0.0.1:{port}/'
    log_path = evidence_dir/'offline-launcher.log'
    log = log_path.open('w')
    process = subprocess.Popen([str(launcher_path), '--port', str(port)], stdout=log, stderr=subprocess.STDOUT)
    context = None
    try:
        ready = False
        for _ in range(100):
            if process.poll() is not None:
                raise AcceptanceFailure(f'offline reload launcher exited early: {process.returncode}')
            try:
                with urllib.request.urlopen(url+'browser-build-manifest.json', timeout=.5) as response:
                    candidate = json.load(response)
                if candidate.get('status') == 'ready':
                    ready = True
                    break
            except Exception:
                time.sleep(.1)
        require(ready, 'offline reload launcher did not serve a ready browser release')
        context = browser.new_context()
        page = context.new_page()
        page.goto(url, wait_until='domcontentloaded', timeout=20000)
        wait_condition(page, 'document.documentElement.dataset.appRuntime === "ready"', 'offline preflight React mount failed')
        try:
            page.evaluate('''async () => {
              if (!("serviceWorker" in navigator)) throw new Error("serviceWorker unavailable");
              await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("serviceWorker ready timeout")), 15000))]);
              return true;
            }''')
        except Exception as exc:
            raise AcceptanceFailure(f'service worker never became ready: {exc}') from exc
        # A newly activated worker does not control the page until navigation; perform one online reload.
        page.reload(wait_until='domcontentloaded', timeout=20000)
        wait_condition(page, 'document.documentElement.dataset.appRuntime === "ready"', 'controlled online reload did not remount React')
        wait_condition(page, 'navigator.serviceWorker && !!navigator.serviceWorker.controller', 'service worker did not control app page')

        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill(); process.wait(timeout=5)
        log.flush()
        # This navigation can succeed only through the installed release-scoped service worker/cache.
        page.reload(wait_until='domcontentloaded', timeout=20000)
        wait_condition(page, 'document.documentElement.dataset.appRuntime === "ready"', 'offline reload did not remount real React Builder', timeout=30000)
        require(page.locator('nav[aria-label="Application actions"]').count()==1, 'offline reload missing Builder navigation')
        require(page.locator('.workspace-grid').count()==1, 'offline reload missing topology workspace')
        require(page.evaluate('navigator.serviceWorker && !!navigator.serviceWorker.controller'), 'offline reload lost service-worker control')
        evidence = {'status':'PASS','check':'server-stopped service-worker reload remounted real Builder'}
        (evidence_dir/'offline-reload-evidence.json').write_text(json.dumps(evidence, indent=2)+'\n')
        return 'server-stopped service-worker offline reload'
    finally:
        if context is not None:
            context.close()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill(); process.wait(timeout=5)
        log.close()

def live(url, chromium, evidence_dir, offline_launcher=None):
    if not url.startswith('http://127.0.0.1:'):
        raise AcceptanceFailure('Only an explicit loopback test URL is accepted.')
    base = urllib.parse.urlparse(url)
    require(base.scheme == 'http' and base.hostname == '127.0.0.1'
            and base.netloc == f'127.0.0.1:{base.port}'
            and 1024 <= base.port <= 65535
            and base.path in ('/', '') and not base.query and not base.fragment,
            'exact local loopback root and nonprivileged TCP port required')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(url+'browser-build-manifest.json',timeout=8) as response:
            manifest = json.load(response)
    except (urllib.error.URLError, json.JSONDecodeError) as exc:
        print(f'BLOCKED: release endpoint unavailable: {exc}',file=sys.stderr)
        return 77
    if manifest.get('status') != 'ready':
        print('BLOCKED: only an actual dependency-resolved browser release can be tested.',file=sys.stderr)
        return 77
    try: from playwright.sync_api import sync_playwright
    except ImportError:
        print('BLOCKED: acceptance-only Python Playwright package not installed.',file=sys.stderr)
        return 77
    evidence_dir.mkdir(parents=True,exist_ok=True)
    results=[]
    with sync_playwright() as p:
        try:
            browser=p.chromium.launch(executable_path=chromium,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'] if hasattr(__import__('os'),'geteuid') and __import__('os').geteuid()==0 else ['--disable-dev-shm-usage'])
        except Exception as exc:
            print(f'BLOCKED: Chromium cannot launch in this environment: {exc}',file=sys.stderr)
            return 77
        try:
            context=browser.new_context(accept_downloads=True)
            page=context.new_page()
            # Avoid exposing saved progress/download files outside the ephemeral acceptance directory.
            try: page.goto(url,wait_until='domcontentloaded',timeout=20000)
            except Exception as exc:
                if 'BLOCKED_BY_ADMINISTRATOR' in str(exc):
                    print('BLOCKED: Chromium navigation prohibited by administrator policy.',file=sys.stderr)
                    return 77
                raise
            wait_condition(page, 'document.documentElement.dataset.appRuntime === "ready"', 'React did not mount real Builder')
            require(page.locator('nav[aria-label="Application actions"]').count()==1,'missing real Builder navigation')
            require(page.locator('.workspace-grid').count()==1,'missing real topology workspace')
            require(page.get_by_role('button',name='Kompilera + layout').count()==1,'missing compile action')
            results.append('real React Builder mounted')
            page.get_by_role('button',name='Kompilera + layout').click()
            wait_condition(page, '''() => {
              const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Förhandsvisa körläge');
              return b&&!b.disabled&&document.querySelectorAll('.react-flow__node').length>0;
            }''','Compiler/layout did not yield a navigable topology',timeout=45000)
            require('valid' in page.locator('.status-grid').inner_text().lower(),'missing compiled-valid UI status')
            zone_header_overlaps = page.evaluate('''() => {
              const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
              const resources = [...document.querySelectorAll('.resource-node')].map((el) => ({ el, box: el.getBoundingClientRect() }));
              const overlaps = [];
              for (const zone of document.querySelectorAll('.zone-node')) {
                const zoneShell = zone.closest('.react-flow__node');
                const zoneId = zoneShell?.getAttribute('data-id') ?? zoneShell?.dataset?.id ?? 'zone';
                for (const header of zone.querySelectorAll(':scope > strong, :scope > small')) {
                  const h = header.getBoundingClientRect();
                  for (const resource of resources) {
                    if (intersects(h, resource.box)) {
                      const resourceShell = resource.el.closest('.react-flow__node');
                      overlaps.push({ zoneId, resourceId: resourceShell?.getAttribute('data-id') ?? resourceShell?.dataset?.id ?? 'resource', header: header.textContent ?? '' });
                    }
                  }
                }
              }
              return overlaps;
            }''')
            require(zone_header_overlaps == [], f'zone header overlaps rendered resource node(s): {zone_header_overlaps}')
            results.append('compile and actual React Flow layout without zone-header overlap')
            with page.expect_download(timeout=25000) as dl:
                page.get_by_role('button',name='Exportera källfil').click()
            source=json.loads(Path(dl.value.path()).read_text())
            require(source['scenarioId']=='foundation_acceptance','source export did not preserve scenario')
            source_path=evidence_dir/'source-acceptance.json'
            source_path.write_text(json.dumps(source,indent=2)+'\n')
            results.append('source JSON browser download and parse')
            with page.expect_download(timeout=30000) as dl:
                page.get_by_role('button',name='Exportera elevpaket').click()
            pkg=Path(dl.value.path()).read_bytes()
            pm,ps=verify_downloaded_student_package(pkg)
            require(pm['scenarioId']=='foundation_acceptance','wrong exported package')
            package_path=evidence_dir/'student-acceptance.yadilab';package_path.write_bytes(pkg)
            results.append('certified student ZIP browser download, independent hashes and stripped solution')
            page.get_by_role('button',name='Förhandsvisa körläge').click()
            wait_condition(page, '!!document.querySelector("[data-runtime-panel=tests]")','Runtime test evidence did not appear')
            require('TRUE' in page.locator('[data-runtime-panel="tests"]').inner_text(),'initial test was not evaluated')
            require('Direct RDP exposure' in page.locator('[data-runtime-panel="findings"]').inner_text(),'expected initial finding missing')
            results.append('actual Runtime initial tests/finding')

            # Phase 80 Living Packet Journey: prove real React/React Flow rendering is bound
            # to the same deterministic active-probe truth shown in the Runtime side panel.
            probe_panel = page.locator('[data-active-probe-engine="wave2"]')
            require(probe_panel.count() == 1, 'Living Journey acceptance missing active-probe panel')
            probe_panel.get_by_label('Källvärd').select_option('admin01')
            probe_panel.get_by_label('Aktiv probe').select_option('windows.test_netconnection')
            probe_panel.get_by_label('Destination').select_option('rds01')
            probe_panel.get_by_label('TCP port').fill('3389')
            probe_panel.get_by_role('button', name='Kör modellerad aktiv probe').click()
            wait_condition(page, 'document.querySelector("[data-visual-journey=ready]") !== null', 'Living Packet Journey did not materialize from active-probe evidence')
            player = page.locator('[data-visual-journey="ready"]')
            require(player.get_attribute('data-journey-terminal') == 'arrived', 'healthy modeled probe did not bind to arrival semantics')
            if player.get_by_role('button', name='Pausa').count():
                player.get_by_role('button', name='Pausa').click()
            # Restart deterministically, then step to the first rendered segment.
            player.get_by_role('button', name='Spela om').click()
            if player.get_by_role('button', name='Pausa').count():
                player.get_by_role('button', name='Pausa').click()
            player.get_by_role('button', name='Steg ▶').click()
            wait_condition(page, 'document.querySelector("[data-journey-connection=admin_rds][data-journey-state=active]") !== null', 'Journey did not highlight the Engine-proven admin_rds connection')
            require(page.locator('.journey-pdu').count() >= 1, 'PDU/envelope renderer did not draw the active modeled segment')
            event_before = page.locator('.journey-event').inner_text()
            player.get_by_label('Rendering').select_option('particle')
            wait_condition(page, 'document.querySelector(".journey-particle") !== null', 'particle renderer did not draw the active modeled segment')
            require(page.locator('.journey-event').inner_text() == event_before, 'renderer switch changed journey semantics/cursor')
            player.get_by_label('Rendering').select_option('pulse')
            wait_condition(page, 'document.querySelector(".journey-edge.journey-active.journey-mode-pulse") !== null', 'flow-pulse renderer did not draw the active modeled segment')
            require(page.locator('.journey-event').inner_text() == event_before, 'flow-pulse renderer switch changed journey semantics/cursor')
            # Step to terminal arrival and prove the endpoint—not a decorative arbitrary node—receives the state.
            for _ in range(4):
                if player.get_by_role('button', name='Steg ▶').is_disabled(): break
                player.get_by_role('button', name='Steg ▶').click()
            wait_condition(page, 'document.querySelector("[data-journey-node-state=arrived]") !== null', 'Journey terminal arrival state was not rendered on the destination')
            arrived = page.locator('[data-journey-node-state="arrived"]')
            require('RDS01' in arrived.inner_text(), 'Journey arrival was rendered on the wrong resource')
            require('MODELED' in page.locator('.journey-event').inner_text(), 'Journey provenance was not visible')
            results.append('Living Packet Journey healthy path, renderer switching, timeline step and truthful arrival')
            page.locator('.operation-editor').get_by_label('Mål').fill('firewall01')
            page.locator('.operation-editor').get_by_label('Sökväg').fill('properties.rules.0.action')
            page.locator('.operation-editor').get_by_label('JSON-värde').fill('"deny"')
            page.get_by_role('button',name='Verkställ via Engine').click()
            wait_condition(page, 'document.querySelector("[data-runtime-panel=progress]")?.textContent.includes("Tillståndsrevision: 1")','Runtime operation did not increment state')
            require('FALSE' in page.locator('[data-runtime-panel="tests"]').inner_text(),'remediation test was not reevaluated')
            require('TRUE' in page.locator('[data-runtime-panel="progress"]').inner_text(),'completion did not become true')
            results.append('configuration edit, reevaluation, completion')
            page.get_by_role('button',name='Skapa checkpoint').click()
            wait_condition(page, 'document.querySelector("[data-runtime-panel=progress]")?.textContent.includes("Checkpoints: 1")','Runtime checkpoint creation failed')
            with page.expect_download(timeout=20000) as dl:
                page.get_by_role('button',name='Exportera framsteg').click()
            portable=json.loads(Path(dl.value.path()).read_text())
            progress_path=evidence_dir/'portable-progress.yadiprogress'
            progress_path.write_text(json.dumps(portable,indent=2))
            results.append('portable progress browser download')
            page.get_by_role('button',name='Autospara nu').click()
            try:
                wait_condition(page, 'document.querySelector(".diagnostics")?.textContent.includes("TROUBLESHOOTING_SESSION_AUTOSAVE_SAVED")','IndexedDB autosave failed')
            except AcceptanceFailure as exc:
                detail = page.locator('.diagnostics').inner_text() if page.locator('.diagnostics').count() else 'no diagnostics rendered'
                raise AcceptanceFailure(f'{exc}; UI diagnostics: {detail}') from exc
            page.get_by_role('button',name='Återställ scenario').click()
            wait_condition(page, 'document.querySelector("[data-runtime-panel=progress]")?.textContent.includes("Tillståndsrevision: 0")','Runtime reset failed')
            require('FALSE' in page.locator('[data-runtime-panel="progress"]').inner_text(),'reset did not restore incomplete state')
            page.get_by_role('button',name='Ångra').click()
            wait_condition(page, 'document.querySelector("[data-runtime-panel=progress]")?.textContent.includes("Tillståndsrevision: 1")','Undo did not restore solved state')
            page.get_by_role('button',name='Gör om').click()
            wait_condition(page, 'document.querySelector("[data-runtime-panel=progress]")?.textContent.includes("Tillståndsrevision: 0")','Redo did not restore reset state')
            page.get_by_role('button',name='Återställ senaste checkpoint').click()
            wait_condition(page, 'document.querySelector("[data-runtime-panel=progress]")?.textContent.includes("Tillståndsrevision: 1")','checkpoint restore failed')
            page.get_by_role('button',name='Återställ scenario').click()
            page.get_by_role('button',name='Återställ autosparning').click()
            wait_condition(page, 'document.querySelector("[data-runtime-panel=progress]")?.textContent.includes("Tillståndsrevision: 1")','IndexedDB restore failed')
            page.get_by_role('button',name='Återställ scenario').click()
            page.locator('label.file-button').filter(has_text='Läs in framsteg').locator('input[type="file"]').set_input_files(str(progress_path))
            wait_condition(page, 'document.querySelector("[data-runtime-panel=progress]")?.textContent.includes("Tillståndsrevision: 1")','portable progress import failed')
            with page.expect_download(timeout=20000) as dl:
                page.get_by_role('button',name='Exportera sessionsbackup').click()
            session_path=evidence_dir/'portable-session.yadisession'
            session_path.write_bytes(Path(dl.value.path()).read_bytes())
            page.get_by_role('button',name='Återställ scenario').click()
            page.locator('label.file-button').filter(has_text='Importera sessionsbackup').locator('input[type="file"]').set_input_files(str(session_path))
            wait_condition(page, 'document.querySelector("[data-runtime-panel=progress]")?.textContent.includes("Tillståndsrevision: 1")','portable session import failed')
            results.append('undo/redo/reset/checkpoint, IndexedDB autosave/restore, portable progress and session import')
            page.get_by_role('button',name='Tillbaka till byggläget').click()
            wait_condition(page, '!document.querySelector("[data-runtime-panel=tests]")','Back to Builder failed')
            imported=dict(source)
            imported['metadata']=dict(source['metadata']);imported['metadata']['title']='Phase 43 imported source'
            import_source=evidence_dir/'source-import-acceptance.json';import_source.write_text(json.dumps(imported,indent=2)+'\n')
            page.locator('nav[aria-label="Application actions"] input[type="file"]').nth(0).set_input_files(str(import_source))
            wait_condition(page, 'document.querySelector(".mission-strip")?.textContent.includes("Phase 43 imported source")','Builder source import failed')
            results.append('exported source re-imported through actual Builder file input')
            page.locator('nav[aria-label="Application actions"] input[type="file"]').nth(1).set_input_files(str(package_path))
            wait_condition(page, '!!document.querySelector("[data-runtime-panel=tests]")','Student package import failed')
            results.append('downloaded student package opened in actual Runtime')
            page.get_by_role('button',name='Tillbaka till byggläget').click()
            bad=evidence_dir/'tampered-acceptance.yadilab';bad.write_bytes(tamper_student_zip(pkg))
            page.locator('nav[aria-label="Application actions"] input[type="file"]').nth(1).set_input_files(str(bad))
            wait_condition(page, 'document.querySelector(".diagnostics")?.textContent.includes("PACKAGE_")','tampered package was not rejected')
            require(page.get_by_role('button',name='Kompilera + layout').count()==1,'failed package import changed mode')
            results.append('hash-tampered ZIP rejected without changing Builder')
            if offline_launcher:
                results.append(verify_offline_reload(browser, offline_launcher, evidence_dir))
            print('PASS live Chromium Builder/Runtime browser workflow: '+', '.join(results))
            (evidence_dir/'browser-workflow-evidence.json').write_text(json.dumps({'status':'PASS','checks':results},indent=2)+'\n')
            return 0
        finally:browser.close()


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--selftest',action='store_true')
    p.add_argument('--url',default='http://127.0.0.1:18951/')
    p.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('chromium-browser') or '')
    p.add_argument('--evidence-dir',type=Path)
    p.add_argument('--offline-launcher',default='')
    args=p.parse_args()
    try:
        if args.selftest:
            selftest();return 0
        if not args.chromium:
            print('BLOCKED: Chromium executable not found',file=sys.stderr);return 77
        with tempfile.TemporaryDirectory(prefix='yadilab-browser-acceptance-') as td:
            return live(args.url,args.chromium,args.evidence_dir or Path(td), args.offline_launcher or None)
    except AcceptanceFailure as exc:
        print(f'FAIL live Chromium browser workflow: {exc}',file=sys.stderr);return 1
    except Exception as exc:
        print(f'FAIL unexpected browser acceptance error: {exc}',file=sys.stderr);return 1


if __name__=='__main__':sys.exit(main())
