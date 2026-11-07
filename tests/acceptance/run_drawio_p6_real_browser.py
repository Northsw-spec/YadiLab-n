#!/usr/bin/env python3
"""DRAWIO P6 compiled Chromium: independently generated multi-page ordinal window navigation."""
import argparse, hashlib, json, os, sys, zlib, base64
from pathlib import Path
from urllib.parse import urlsplit, quote
from playwright.sync_api import expect, sync_playwright
from run_docx_p2_real_browser import setup, export_source, check_unchanged, require, menu
from run_drawio_p4_real_browser import open_panel, choose
from run_drawio_p5_real_browser import open_replay, select

CANARY="CUSTOMER_PRIVATE_SOURCE_203.0.113.181_DO_NOT_SHOW"
def graph(count,prefix):
    root='<mxCell id="0"/><mxCell id="1" parent="0"/>'
    cells=''.join(f'<mxCell id="{prefix}{i}" parent="1" vertex="1" value="{CANARY}"/>' for i in range(count))
    return '<mxGraphModel><root>'+root+cells+'</root></mxGraphModel>'
def compressed(s):
    # Independent Python raw-DEFLATE + URI encoding, not production JS helpers.
    obj=zlib.compressobj(level=9,wbits=-15)
    payload=quote(s,safe="-_.!~*'()").encode("ascii")
    return base64.b64encode(obj.compress(payload)+obj.flush()).decode("ascii")
def source45():
    return ('<?xml version="1.0"?><mxfile>'+
      '<diagram id="first" name="'+CANARY+'">'+graph(42,"first_")+'</diagram>'+
      '<diagram id="second">'+compressed(graph(3,"last_"))+'</diagram>'+
      '</mxfile>').encode("utf-8")

def case(browser,url):
    page,scenario,errors,external=setup(browser,url)
    try:
        before=export_source(page)
        original=source45()
        sha=hashlib.sha256(original).hexdigest()
        open_panel(page)
        choose(page,"extended.drawio",original)
        expect(page.locator('[data-drawio-preview="PREVIEW_ONLY"]')).to_be_visible(timeout=25000)
        nav=page.locator('[data-drawio-position-navigation="true"]')
        expect(page.locator('[data-drawio-total-positions="45"]')).to_be_visible()
        require(page.locator('[data-drawio-associate-vertex]').count()==20,"Initial window must be 20")
        require(page.locator('[data-drawio-associate-vertex="0:20"]').count()==0,"Hidden ordinal was rendered")
        require(page.locator('[data-drawio-position-previous]').is_disabled(),"Initial previous enabled")
        options=page.locator('[data-drawio-associate-vertex="0:1"] option')
        require(options.count()>=4,"Three distinct modeled Builder resources required")
        ids=[options.nth(i).get_attribute("value") for i in (1,2,3)]
        require(all(ids) and len(set(ids))==3,"Expected three modeled IDs")
        a,b,c=ids
        require(page.locator('[data-drawio-association-export]').is_disabled(),"Default mapping is non-automatic")
        page.locator('[data-drawio-associate-vertex="0:1"]').select_option(a)
        page.locator('[data-drawio-position-next]').click()
        expect(page.locator('[data-drawio-position-window="2"]')).to_be_visible()
        require(page.locator('[data-drawio-associate-vertex]').count()==20,"Window 2 not bounded")
        page.locator('[data-drawio-associate-vertex="0:21"]').select_option(b)
        page.locator('[data-drawio-position-next]').click()
        expect(page.locator('[data-drawio-position-window="3"]')).to_be_visible()
        require(page.locator('[data-drawio-associate-vertex]').count()==5,"Final mixed-page window invalid")
        require(page.locator('[data-drawio-associate-vertex="1:2"]').count()==1,
                "Last vertex on second page inaccessible")
        require(page.locator('[data-drawio-position-next]').is_disabled(),"Last next must be disabled")
        page.locator('[data-drawio-associate-vertex="1:2"]').select_option(a)
        expect(page.locator('[data-drawio-association-duplicate="BLOCKED"]')).to_be_visible()
        require(page.locator('[data-drawio-association-export]').is_disabled(),
                "Hidden-window duplicate target exported")
        page.locator('[data-drawio-associate-vertex="1:2"]').select_option(c)
        expect(page.locator('[data-drawio-association-duplicate]')).to_have_count(0)
        expect(page.locator('[data-drawio-reference-count="3"]')).to_be_visible()
        page.locator('[data-drawio-association-ack]').check()
        with page.expect_download(timeout=25000) as dl:
            page.locator('[data-drawio-association-export]').click()
        report=Path(dl.value.path()).read_bytes()
        obj=json.loads(report)
        require(obj["status"]=="REVIEWED_ASSOCIATIONS_ONLY" and obj["source"]["sha256"]==sha,
                "Export source provenance or truth wrong")
        require([(x["locator"]["pageOrdinal"],x["locator"]["vertexOrdinal"]) for x in obj["associations"]]
                ==[(0,1),(0,21),(1,2)],"Window-spanning ordinals changed")
        require([x["targetResourceId"] for x in obj["associations"]]==[a,b,c],"Targets changed")
        require(all(obj[k] is False for k in (
                "engineVerified","physicalTopologyVerified","identityVerified","modelMutated")),
                "False verified data in source-sidecar")
        require(CANARY not in json.dumps(obj),"Private source leaked into sidecar")
        html=page.locator('[data-drawio-panel]').inner_html()
        for private in [CANARY,"203.0.113.181","first_0","last_2"]:
            require(private not in html,"Private source leaked into DOM")
        # Return to first window, change a hidden prior selection: consent MUST reset.
        page.locator('[data-drawio-position-previous]').click()
        page.locator('[data-drawio-position-previous]').click()
        require(page.locator('[data-drawio-associate-vertex="0:1"]').input_value()==a,
                "Selection lost across navigation")
        page.locator('[data-drawio-associate-vertex="0:1"]').select_option("")
        require(not page.locator('[data-drawio-association-ack]').is_checked(),
                "Changing a selection retained consent")
        require(page.locator('[data-drawio-association-export]').is_disabled(),
                "Changed selection exported without new consent")
        # Test reset and last position in max-1000 valid source.
        max_source=graph(1000,"max_").encode()
        choose(page,"maximum.drawio",max_source)
        expect(page.locator('[data-drawio-total-positions="1000"]')).to_be_visible(timeout=25000)
        expect(page.locator('[data-drawio-reference-count="0"]')).to_be_visible()
        require(not page.locator('[data-drawio-association-ack]').is_checked(),
                "Prior selections/ack survived source replacement")
        require(page.locator('[data-drawio-position-previous]').is_disabled(),
                "Window not reset after source replacement")
        for i in range(49):
            page.locator('[data-drawio-position-next]').click()
        expect(page.locator('[data-drawio-position-window="50"]')).to_be_visible()
        require(page.locator('[data-drawio-associate-vertex="0:999"]').count()==1,
                "Valid final ordinal #1000 inaccessible")
        require(page.locator('[data-drawio-associate-vertex]').count()==20,
                "Max-source window renders too many selectors")
        require(page.locator('[data-drawio-position-next]').is_disabled(),
                "Max-source next not disabled")
        page.locator('[data-drawio-close]').click()
        expect(page.locator('[data-drawio-panel]')).to_have_count(0)
        # Genuine earlier P4 sidecar still replays using exact original source.
        open_replay(page)
        select(page,'[data-drawio-replay-original]','extended.drawio',original)
        select(page,'[data-drawio-replay-report]','saved-p6.json',report)
        require(page.locator('[data-drawio-replay-verify]').is_disabled(),
                "Replay missing deliberate consent")
        page.locator('[data-drawio-replay-consent]').check()
        page.locator('[data-drawio-replay-verify]').click()
        expect(page.locator('[data-drawio-replay-result="REFERENCE_REPLAY_MATCH"]')).to_be_visible(timeout=25000)
        require(page.locator('[data-drawio-replay-count="3"]').count()==1,
                "P5 replay failed on newly browsed source ordinals")
        page.locator('[data-drawio-replay-close]').click()
        require(export_source(page)==before,"P6 changed canonical Builder source")
        check_unchanged(page,scenario,errors,external)
        return {"case":"bounded_45_and_1000_window_navigation_and_p5_replay","status":"PASS",
                "sourceSha256":sha,"selectedCount":3,"lastOrdinal":999,
                "maxRenderedAtOnce":20,"privateSourceExposed":False,"builderModified":False}
    finally: page.close()

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--url",required=True)
    p.add_argument("--evidence-dir",type=Path,required=True)
    args=p.parse_args()
    u=urlsplit(args.url)
    require(u.scheme=="http" and u.hostname=="127.0.0.1" and u.port is not None and
            u.path=="/" and not u.query and not u.fragment and not u.username and not u.password,
            "Only compiled loopback YadiLab")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        flags=["--disable-background-networking","--disable-dev-shm-usage"]
        if hasattr(os,"geteuid") and os.geteuid()==0: flags.append("--no-sandbox")
        browser=pw.chromium.launch(headless=True,args=flags)
        try: cases=[case(browser,args.url)]
        finally: browser.close()
    report={"status":"PASS","kind":"DRAWIO P6 compiled Chromium 45/1000 independent synthetic ordinals",
            "platform":"GitHub Ubuntu Chromium, not user Parrot","cases":cases,"builderMutated":False}
    (args.evidence_dir/"drawio-p6-real-chromium.json").write_text(json.dumps(report,indent=2)+"\n")
    print("PASS DRAWIO P6 compiled Chromium",flush=True)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try: main()
    except Exception as error:
        print("FAIL DRAWIO P6 Chromium "+str(error),file=sys.stderr)
        raise
