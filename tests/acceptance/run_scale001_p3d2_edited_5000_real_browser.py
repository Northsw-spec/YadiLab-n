#!/usr/bin/env python3
"""P3d2 FROZEN-before-code real Chromium original DOCX 5000/5000 and one manual
Builder resource append. Requires actual original Office File import, 50+50
separate consents, real full compiler, genuine bounded ELK and ReactFlow SVG.
Never claim physical topology, Engine state or 5001 simultaneous DOM nodes.
"""
import argparse,json,os,sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect,sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup,exported_source,require
from run_scale001_p3c2b_office_5000_real_browser import (
    choose,consent,original,assert_source,focused,snapshot,device
)

def create_extra(page,identifier):
    editor_section=page.locator('.control-section').filter(
        has=page.locator('summary').filter(has_text='Builder Inspector & Authoring'))
    expect(editor_section).to_have_count(1)
    if editor_section.get_attribute('open') is None:
        editor_section.locator('summary').first.click()
    panel=editor_section.locator('.create-panel')
    expect(panel).to_be_visible()
    panel.locator('label.inspector-field').filter(has_text='ID').locator('input').fill(identifier)
    panel.locator('label.inspector-field').filter(has_text='Label').locator('input').fill(
        'Explicitly authored unconnected Builder device')
    panel.get_by_role('button',name='Skapa objekt').click()

def compile_only(page):
    menu=page.locator('.workspace-menu-advanced')
    if menu.get_attribute('open') is None:
        menu.locator('summary').click()
    menu.get_by_role('button',name='Kompilera + layout').click()
    expect(page.locator('[data-scale-p3d1-safe-compile="NO_UNBOUNDED_LAYOUT"]')).to_be_visible(
        timeout=180000)

def case(browser,url):
    page,errors,external=setup(browser,url)
    try:
        panel=choose(page,'docx',original('docx'))
        consent(panel)
        panel.locator('[data-scale-p3c2-confirm]').click()
        expect(page.locator('[data-scale-p3c2-panel]')).to_have_count(0,timeout=240000)
        before=exported_source(page)
        assert_source(before)
        focused(page,1)
        create_extra(page,'dev_extra_guard')
        stale=page.locator('[data-scale-p3d1-edited-source="BOUNDED_REVIEW_REQUIRED"]')
        expect(stale).to_be_visible(timeout=30000)
        require(not snapshot(page)['nodes'] and not snapshot(page)['edges'],
                'Unreviewed edited 5001 source had an unbounded/stale ReactFlow graph')
        changed=exported_source(page)
        require(len(changed['resources'])==5001 and len(changed['connections'])==5000 and
                changed['resources'][:5000]==before['resources'] and
                changed['connections']==before['connections'] and
                changed['resources'][-1]['id']=='dev_extra_guard',
                'One manually added Builder resource changed original 5000 devices/links/ports')
        compile_only(page)
        require(exported_source(page)==changed,'Safe compile mutated edited Builder source')
        button=page.locator('[data-scale-p3d2-rebuild-bounded="REVIEW_REQUIRED"]')
        expect(button).to_be_enabled(timeout=30000)
        button.click()
        expect(page.locator('[data-scale-p3d2-edited-focus="ADDED_UNLINKED_ONLY"]')).to_be_visible(
            timeout=180000)
        require(exported_source(page)==changed,'Rebuilding bounded pages mutated Builder source')
        views=[focused(page,i) for i in [1,2,25,50]]
        select=page.locator('[data-scale-p3c2-focus-page]')
        expect(select.locator('option')).to_have_count(51)
        select.select_option('51')
        expect(page.locator('[data-scale-p3d2-added-page="ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_OFFICE_ROW"]')).to_be_visible(
            timeout=180000)
        expect(page.locator('[data-scale-p3d2-added-page="ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_OFFICE_ROW"]')).to_contain_text(
            'Explicitly authored unconnected Builder device')
        page.wait_for_function("""() => {
          const n=[...document.querySelectorAll('.react-flow__node[data-id]')];
          const e=[...document.querySelectorAll('.react-flow__edge[data-id]')];
          return n.length===1&&n[0].getAttribute('data-id')==='dev_extra_guard'&&e.length===0;
        }""",timeout=180000)
        actual=snapshot(page)
        require(actual['nodes']==['dev_extra_guard'] and not actual['edges'],
                'Added unlinked resource page invented a cable or displayed original source rows')
        require(exported_source(page)==changed,'Added page mutated canonical Builder source')
        focused(page,1)
        require(exported_source(page)==changed,'Original row focus after edit mutated source')
        create_extra(page,'dev_second_unreviewed')
        expect(stale).to_be_visible(timeout=30000)
        require(not snapshot(page)['nodes'] and not snapshot(page)['edges'],
                'A SECOND unreviewed addition leaked the prior bounded ReactFlow view')
        second=exported_source(page)
        require(len(second['resources'])==5002 and second['connections']==before['connections'],
                'Second independent user edit lost original port-paired source links')
        compile_only(page)
        review=page.locator('[data-scale-p3d2-rebuild-bounded="REVIEW_REQUIRED"]')
        expect(review).to_be_visible()
        review.click()
        expect(page.locator('.diagnostics')).to_contain_text(
            'SCALE_P3D2_APPEND_ONLY_BLOCKED',timeout=30000)
        require(not snapshot(page)['nodes'] and not snapshot(page)['edges'],
                'Unsupported 5002 resource source rendered as approved')
        require(exported_source(page)==second,'Blocked second addition changed canonical source')
        require(not errors and not external,'Unexpected real browser/network exception')
        return {'status':'PASS','format':'docx','originalNodes':5000,
                'originalPortLinks':5000,'editedNodes':5001,'addedPageNodes':1,
                'addedPageLinks':0,'pages':[v['page'] for v in views]+[51],
                'secondAdditionBlocked':True,'engineVerified':False,
                'physicalNetworkVerified':False,'full5001NodeDOM':False}
    finally:
        page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--url',required=True)
    p.add_argument('--evidence-dir',type=Path,required=True)
    a=p.parse_args()
    u=urlsplit(a.url)
    require(u.scheme=='http' and u.hostname=='127.0.0.1' and u.port is not None and
            u.path=='/' and not u.query and not u.fragment,
            'P3d2 must mount the isolated actual localhost Linux web release')
    a.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        opts=['--disable-background-networking','--disable-dev-shm-usage']
        if hasattr(os,'geteuid') and os.geteuid()==0: opts.append('--no-sandbox')
        browser=pw.chromium.launch(headless=True,args=opts)
        try: out=case(browser,a.url)
        finally: browser.close()
    report={'kind':'SCALE-001 P3d2 original DOCX 5000/5000 append-only bounded edited real DOM',
            'status':'PASS','cases':[out],'engineVerified':False,
            'physicalTopologyVerified':False}
    (a.evidence_dir/'scale001-p3d2-edited-5000-real-dom.json').write_text(
        json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print('PASS SCALE-001 P3d2 actual mounted Chromium original DOCX 5000/5000 + 1 manually added resource; exact original source/port links and 50 bounded pages plus 1 separate unconnected added-resource page; second addition denied; no Engine')
    print(json.dumps(report,indent=2))
if __name__=='__main__':
    try: main()
    except Exception as error:
        print('FAIL SCALE-001 P3d2 mounted edited 5000/5000:',str(error),file=sys.stderr)
        raise
