#!/usr/bin/env python3
"""SCALE-001 P3d3 frozen BEFORE product: genuine original DOCX 5000/5000
through the actual 100-batch review, then TWO actual Builder Inspector adds,
two separately consented edited bounded projections, original edges and isolated
added pages 51/52. A third edit stays blank/blocked. No inferred physical links.
"""
import argparse,json,os,sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import expect,sync_playwright
from run_ic010_p2_shared_xml_real_browser import setup,exported_source,require
from run_scale001_p3c2b_office_5000_real_browser import (
    choose,consent,original,assert_source,focused,snapshot
)
from run_scale001_p3d2_edited_5000_real_browser import create_extra,compile_only

def case(browser,url):
    page,errors,external=setup(browser,url)
    try:
        panel=choose(page,'docx',original('docx'))
        consent(panel)
        panel.locator('[data-scale-p3c2-confirm]').click()
        expect(page.locator('[data-scale-p3c2-panel]')).to_have_count(0,timeout=240000)
        baseline=exported_source(page)
        assert_source(baseline)
        focused(page,1)
        create_extra(page,'dev_extra_guard')
        stale=page.locator('[data-scale-p3d1-edited-source="BOUNDED_REVIEW_REQUIRED"]')
        expect(stale).to_be_visible(timeout=30000)
        require(not snapshot(page)['nodes'] and not snapshot(page)['edges'],
                'Unreviewed first add retained stale ReactFlow')
        first=exported_source(page)
        require(len(first['resources'])==5001 and len(first['connections'])==5000 and
                first['resources'][:5000]==baseline['resources'] and
                first['connections']==baseline['connections'],
                'First addition changed original Office network')
        compile_only(page)
        btn=page.locator('[data-scale-p3d2-rebuild-bounded="REVIEW_REQUIRED"]')
        expect(btn).to_be_enabled(timeout=30000)
        btn.click()
        expect(page.locator('[data-scale-p3d2-edited-focus="ADDED_UNLINKED_ONLY"]')).to_be_visible(
            timeout=180000)
        select=page.locator('[data-scale-p3c2-focus-page]')
        select.select_option('51')
        expect(page.locator('[data-scale-p3d2-added-page="ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_OFFICE_ROW"]')).to_be_visible(timeout=180000)
        require(snapshot(page)['nodes']==['dev_extra_guard'] and
                not snapshot(page)['edges'],'P3d2 page51 no longer isolated')
        create_extra(page,'dev_second_guard')
        expect(stale).to_be_visible(timeout=30000)
        require(not snapshot(page)['nodes'] and not snapshot(page)['edges'],
                'Second edit retained old approved canvas during invalidation')
        second=exported_source(page)
        require(len(second['resources'])==5002 and
                len(second['connections'])==5000 and
                second['resources'][:5000]==baseline['resources'] and
                second['connections']==baseline['connections'] and
                second['resources'][5000]['id']=='dev_extra_guard' and
                second['resources'][5001]['id']=='dev_second_guard',
                'Second actual Builder edit changed canonical original/added identity')
        compile_only(page)
        require(exported_source(page)==second,'Second safe compiler mutated source')
        review=page.locator('[data-scale-p3d3-rebuild-bounded="REVIEW_REQUIRED"]')
        expect(review).to_be_enabled(timeout=30000)
        review.click()
        expect(page.locator('[data-scale-p3d3-edited-focus="TWO_ADDED_UNLINKED_ONLY"]')).to_be_visible(timeout=180000)
        require(exported_source(page)==second,'Second refocus mutated canonical source')
        views=[focused(page,i) for i in [1,2,25,50]]
        select=page.locator('[data-scale-p3c2-focus-page]')
        expect(select.locator('option')).to_have_count(52)
        for number,identifier in [(51,'dev_extra_guard'),(52,'dev_second_guard')]:
            select.select_option(str(number))
            marker=page.locator('[data-scale-p3d3-added-page="ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_OFFICE_ROW"]')
            expect(marker).to_be_visible(timeout=180000)
            expect(marker).to_contain_text('Explicitly authored unconnected Builder device')
            expect(marker).to_contain_text('Page '+str(number)+':')
            page.wait_for_function("""expected => {
               const n=[...document.querySelectorAll('.react-flow__node[data-id]')];
               const e=[...document.querySelectorAll('.react-flow__edge[data-id]')];
               return n.length===1 && n[0].getAttribute('data-id')===expected &&
                      e.length===0;
            }""",arg=identifier,timeout=180000)
            require(snapshot(page)['nodes']==[identifier] and not snapshot(page)['edges'],
                    'Added resource page invented/crossed links or mixed page identities')
            require(exported_source(page)==second,'New page changed original source')
        focused(page,1)
        require(exported_source(page)==second,'Original page changed second edited source')
        create_extra(page,'dev_third_unreviewed')
        expect(stale).to_be_visible(timeout=30000)
        require(not snapshot(page)['nodes'] and not snapshot(page)['edges'],
                'Third unsupported edit displayed stale approved graph')
        third=exported_source(page)
        require(len(third['resources'])==5003 and
                third['connections']==baseline['connections'],
                'Third edit changed existing links')
        compile_only(page)
        review=page.locator('[data-scale-p3d3-rebuild-bounded="REVIEW_REQUIRED"]')
        expect(review).to_be_enabled(timeout=30000)
        review.click()
        expect(page.locator('.diagnostics')).to_contain_text(
            'SCALE_P3D3_APPEND_ONLY_BLOCKED',timeout=30000)
        require(not snapshot(page)['nodes'] and not snapshot(page)['edges'],
                'Third edit gained false approval')
        require(exported_source(page)==third,'Denied third edit mutated source')
        require(not errors and not external,'Unexpected actual browser/network error')
        return {'status':'PASS','format':'docx','originalNodes':5000,
                'originalPortLinks':5000,'editedNodes':5002,'addedPages':[51,52],
                'addedPageNodesEach':1,'addedPageLinksEach':0,
                'originalViews':[v['page'] for v in views],
                'thirdAdditionBlocked':True,'engineVerified':False,
                'physicalTopologyVerified':False,'full5002NodeDOM':False}
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
            'P3d3 must mount actual isolated localhost Linux web release')
    a.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        opts=['--disable-background-networking','--disable-dev-shm-usage']
        if hasattr(os,'geteuid') and os.geteuid()==0: opts.append('--no-sandbox')
        browser=pw.chromium.launch(headless=True,args=opts)
        try: outcome=case(browser,a.url)
        finally: browser.close()
    report={'kind':'SCALE-001 P3d3 genuine DOCX 5000/5000 two separate Builder additions',
            'status':'PASS','cases':[outcome],
            'engineVerified':False,'physicalTopologyVerified':False}
    (a.evidence_dir/'scale001-p3d3-two-unlinked-real-dom.json').write_text(
       json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print('PASS SCALE-001 P3d3 actual Chromium 5000/5000 -> 5002/5000: 50 original pages and two separate zero-link Builder pages; third blocked')
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    try: main()
    except Exception as error:
        print('FAIL SCALE-001 P3d3 genuine mounted Chromium:',str(error),file=sys.stderr)
        raise
