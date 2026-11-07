#!/usr/bin/env python3
"""AUDIT-006: verify exact release identity in a mounted, functional Chromium DOM.

The static JS string test is deliberately insufficient: a token-only JS bundle
must be rejected here even though it contains all expected version strings.
"""
import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright, expect


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def inspect_mounted(page, marker):
    header = page.locator('.app-frame .app-header')
    badge = header.locator('[data-yadilab-build-version]')
    checkpoint = header.locator('[data-development-checkpoint]')
    require(header.count() == 1 and header.is_visible(), 'Rendered app header missing')
    require(badge.count() == 1 and badge.is_visible(), 'Visible version element missing')
    require(checkpoint.count() == 1 and checkpoint.is_visible(), 'Visible checkpoint element missing')
    require(badge.get_attribute('data-yadilab-build-version') == marker['version'],
            'Version data does not match attested build marker')
    require(checkpoint.get_attribute('data-development-checkpoint') == marker['checkpoint'],
            'Checkpoint data does not match attested build marker')
    require(badge.get_attribute('data-source-commit') == marker['sourceCommit'],
            'Full source commit attribute does not match attested build marker')
    require('v' + marker['version'] in badge.inner_text(), 'Version not visibly rendered')
    require(marker['sourceCommit'][:12] in badge.inner_text(), 'Commit prefix not visibly rendered')
    require(marker['checkpoint'] in checkpoint.inner_text(), 'Checkpoint not visibly rendered')
    require(page.locator('.app-frame[data-app-runtime="ready"]').count() == 1,
            'Actual React app frame never mounted')
    require(page.locator('[data-network-import-primary="true"]').count() == 1,
            'Functional primary import control missing')
    menus = page.locator('.workspace-menu',
                         has=page.locator('summary', has_text='Import / Export'))
    require(menus.count() == 1, 'Functional Import / Export menu missing')
    if menus.get_attribute('open') is None:
        menus.locator('summary').click()
    require(menus.locator('[data-inspect-nessus="EVIDENCE_ONLY"]').is_visible(),
            'Opened import menu has no real application actions')


def test(browser, url, marker):
    context = browser.new_context(service_workers='block')
    failures = []
    external = []
    def on_request(request):
        if not request.url.startswith(url) and not request.url.startswith('data:') and not request.url.startswith('blob:'):
            external.append(request.url)
    try:
        page = context.new_page()
        page.on('pageerror', lambda error: failures.append(str(error)))
        page.on('request', on_request)
        page.goto(url, wait_until='domcontentloaded', timeout=25000)
        expect(page.locator('[data-network-import-primary="true"]')).to_be_visible(timeout=30000)
        inspect_mounted(page, marker)
        require(not failures, 'Actual app page emitted JS errors')
        require(not external, 'Actual app attempted nonlocal network requests')

        # Reproduce issue #1 BUG-002: the same literal identity tokens,
        # including marker values, but with no real UI being rendered.
        fake_context = browser.new_context(service_workers='block')
        try:
            fake = fake_context.new_page()
            tokens = 'data-yadilab-build-version data-development-checkpoint data-source-commit'
            tokens += ' ' + ' '.join([marker['version'], marker['checkpoint'], marker['sourceCommit']])
            fake_js = 'console.log(' + json.dumps(tokens) + ');'
            fake.route('**/assets/app.js',
                       lambda route: route.fulfill(status=200, content_type='application/javascript', body=fake_js))
            fake.goto(url, wait_until='domcontentloaded', timeout=25000)
            fake.wait_for_timeout(750)
            try:
                inspect_mounted(fake, marker)
            except (AssertionError, Exception):
                negative_rejected = True
            else:
                negative_rejected = False
            require(negative_rejected, 'Token-only JavaScript falsely passed mounted DOM release gate')
            require(fake.locator('.app-frame').count() == 0,
                    'Token-only JS unexpectedly created a real React app frame')
        finally:
            fake_context.close()
        return {
            'status': 'PASS',
            'visibleVersion': marker['version'],
            'visibleCheckpoint': marker['checkpoint'],
            'visibleCommitPrefix': marker['sourceCommit'][:12],
            'fullCommitMatched': True,
            'functionalImportMenu': True,
            'tokenOnlyJavascriptDenied': True,
            'externalRequests': 0,
        }
    finally:
        context.close()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',required=True)
    parser.add_argument('--expected-commit',required=True)
    parser.add_argument('--evidence-dir',required=True,type=Path)
    args=parser.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=='http' and u.hostname=='127.0.0.1' and u.port is not None
            and u.path=='/' and not u.query and not u.fragment
            and not u.username and not u.password,
            'Only an exact compiled YadiLab loopback release may be checked')
    require(len(args.expected_commit)==40 and all(c in '0123456789abcdef' for c in args.expected_commit),
            'Explicit exact Git commit required')
    with urllib.request.urlopen(args.url+'build-marker.json',timeout=10) as response:
        marker=json.load(response)
    require(marker['formatId']=='yadilab.browser-build-marker'
            and marker['sourceCommit']==args.expected_commit,
            'Server marker does not match exact checked Git commit')
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as playwright:
        flags=['--disable-background-networking','--disable-dev-shm-usage']
        if hasattr(os,'geteuid') and os.geteuid()==0:
            flags.append('--no-sandbox')
        browser=playwright.chromium.launch(headless=True,args=flags)
        try:
            result=test(browser,args.url,marker)
        finally:
            browser.close()
    (args.evidence_dir/'audit006-mounted-release-identity.json').write_text(
        json.dumps(result,indent=2)+'\n')
    print('PASS AUDIT-006 actual mounted Chromium release identity and token-only denial')
    print(json.dumps(result,indent=2))


if __name__=='__main__':
    try:
        main()
    except Exception as exc:
        print('FAIL AUDIT-006 Chromium release identity: '+str(exc),file=sys.stderr)
        raise
