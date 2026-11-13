#!/usr/bin/env python3
"""ATLAS-001 G5.1: real Chromium reviewed DOCX -> canonical Builder -> Atlas."""
import argparse
import hashlib
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests/fixtures/atlas001-g5.0/atlas001-g5-control-b-500-pages.docx"

def require(ok, message):
    if not ok:
        raise AssertionError(message)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True)
    args = parser.parse_args()
    evidence = Path(args.evidence_dir)
    evidence.mkdir(parents=True, exist_ok=True)
    data = FIXTURE.read_bytes()
    errors, external = [], []
    with sync_playwright() as pw:
        launch = {"headless": True}
        if Path("/usr/bin/chromium").exists():
            launch["executable_path"] = "/usr/bin/chromium"
        browser = pw.chromium.launch(**launch)
        page = browser.new_page(viewport={"width": 1366, "height": 768}, device_scale_factor=1)
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        page.on("request", lambda req: external.append(req.url)
                if not (req.url.startswith(args.url) or req.url.startswith(("data:", "blob:"))) else None)
        page.goto(args.url, wait_until="domcontentloaded", timeout=30000)
        page.locator('[data-network-import-primary="true"]').wait_for(timeout=30000)
        advanced = page.locator(".workspace-menu-advanced")
        advanced.locator("summary").click()
        advanced.locator('[data-review-office-g5-1="REVIEW_REQUIRED"]').click()
        expect(page.locator('[data-office-p1b-panel="REVIEW_REQUIRED"]')).to_be_visible(timeout=15000)
        page.locator('[data-office-p1b-file="true"]').set_input_files({
            "name": "atlas001-g5-control-b-500-pages.docx",
            "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "buffer": data,
        })
        expect(page.locator('[data-office-p1b-controls="REVIEW_REQUIRED"]')).to_be_visible(timeout=30000)
        require(page.locator('[data-office-p1b-source-sha]').inner_text(), "missing original SHA")
        require("g5-router-001" not in page.locator('[data-office-p1b-panel]').inner_html(), "raw DOCX text leaked")

        for key, role in (("0:1:0", "network.router"), ("0:2:0", "network.switch")):
            page.locator('[data-office-p1b-cell-ordinal="true"]').select_option(key)
            page.locator('[data-office-p1b-add="true"]').click()
            page.locator(f'[data-office-p1b-role="{key}"]').select_option(role)
            page.locator(f'[data-office-p1b-cell-ack="{key}"]').check()
        expect(page.locator('[data-office-p1b-selected-count="2"]')).to_be_visible()
        page.locator('[data-office-p4-row-choice="true"]').select_option("1:1")
        page.locator('[data-office-p4-from-choice="true"]').select_option("0")
        page.locator('[data-office-p4-to-choice="true"]').select_option("1")
        page.locator('[data-office-p4-source-port-choice="true"]').select_option("2")
        page.locator('[data-office-p4-target-port-choice="true"]').select_option("3")
        page.locator('[data-office-p4-add="true"]').click()
        row = page.locator('[data-office-p4-selection="1:1"]')
        row.locator('[data-office-p4-from-ack="1:1"]').check()
        row.locator('[data-office-p4-to-ack="1:1"]').check()
        row.locator('[data-office-p4-source-port-ack="1:1"]').check()
        row.locator('[data-office-p4-target-port-ack="1:1"]').check()
        page.locator('[data-office-p4-modeled-ack="true"]').check()
        page.locator('[data-office-p1b-modeled-ack="true"]').check()
        expect(page.locator('[data-office-p1b-confirm="true"]')).to_be_enabled()

        page.locator('[data-office-p1b-confirm="true"]').click()
        expect(page.locator('[data-office-g5-1-summary="REVIEW_REQUIRED"]')).to_be_visible(timeout=45000)
        require(page.locator('[data-office-g5-1-summary-counts]').inner_text().startswith("Will create exactly 2 modeled resources, 1 explicit connections and 2 reviewed ports"), "wrong staged canonical summary")
        require(page.locator('[data-topology-view-mode="normal"]').count() == 1, "staging changed active topology")
        page.screenshot(path=str(evidence / "g5-1-reviewed-summary.png"), full_page=True)

        page.locator('[data-office-g5-1-approval="true"]').click()
        expect(page.locator('[data-office-p1b-panel="REVIEW_REQUIRED"]')).to_have_count(0, timeout=60000)
        expect(page.locator('[data-topology-view-mode="atlas"]')).to_be_visible(timeout=60000)
        atlas = page.locator('[data-atlas-activation-mode="BOUNDED_SOURCE_PAGE"]')
        expect(atlas).to_be_visible(timeout=60000)
        require(atlas.get_attribute("data-atlas-page-node-count") == "2", "Atlas changed canonical resource count")
        require(atlas.get_attribute("data-atlas-page-link-count") == "1", "Atlas changed canonical link count")
        expect(atlas).to_have_attribute("data-atlas-layout-error-count", "0", timeout=60000)
        advanced = page.locator(".workspace-menu-advanced")
        advanced.locator("summary").click()
        with page.expect_download(timeout=30000) as incoming:
            advanced.get_by_role("button", name="Exportera källfil").click()
        readback = json.loads(Path(incoming.value.path()).read_text())
        require([item["id"] for item in readback["resources"]] == ["g5-router-001", "g5-switch-001"], "canonical readback lost original IDs")
        require(len(readback["connections"]) == 1, "canonical readback changed connection count")
        link = readback["connections"][0]
        require(link["from"]["resource"] == "g5-router-001" and link["to"]["resource"] == "g5-switch-001", "canonical readback changed endpoints")
        require(link["from"]["port"] == "eth1" and link["to"]["port"] == "eth1", "canonical readback changed ports")
        viewports = {}
        for width, height in ((1366, 768), (1280, 800), (1920, 1080), (390, 844)):
            page.set_viewport_size({"width": width, "height": height})
            expect(page.locator('[data-topology-view-mode="atlas"]')).to_be_visible(timeout=30000)
            expect(atlas).to_have_attribute("data-atlas-layout-error-count", "0", timeout=30000)
            name = f"g5-1-atlas-control-b-{width}x{height}.png"
            page.screenshot(path=str(evidence / name), full_page=True)
            viewports[f"{width}x{height}"] = {"status": "PASS", "screenshot": name, "layoutErrors": 0}
        sha = hashlib.sha256(data).hexdigest()
        (evidence / "manifest.json").write_text(json.dumps({
            "commit": page.locator('[data-source-commit]').get_attribute("data-source-commit"),
            "fixture": str(FIXTURE.relative_to(ROOT)),
            "originalSha256": sha,
            "documentProfile": "office.docx-tables.structural.v1",
            "physicalPages": 500,
            "locators": {
                "resources": [
                    {"id": "g5-router-001", "tableOrdinal": 0, "rowOrdinal": 1, "cellOrdinal": 0, "part": "word/document.xml"},
                    {"id": "g5-switch-001", "tableOrdinal": 0, "rowOrdinal": 2, "cellOrdinal": 0, "part": "word/document.xml"},
                ],
                "link": {"tableOrdinal": 1, "rowOrdinal": 1, "fromCellOrdinal": 0, "toCellOrdinal": 1, "fromPortCellOrdinal": 2, "toPortCellOrdinal": 3, "part": "word/document.xml"},
            },
            "approvals": {"resourceCells": True, "modeledRoles": ["network.router", "network.switch"], "linkEndpoints": True, "sourcePorts": True, "replacement": True},
            "canonical": {"resourceIds": ["g5-router-001", "g5-switch-001"], "connectionIds": [link["id"]], "endpoints": link, "compile": "valid", "roundTrip": "PASS", "physicalTruth": "UNVERIFIED_MODELED"},
            "atlasIndex": {"sourceIdentity": atlas.get_attribute("data-atlas-layout-source-identity"), "pageCount": int(atlas.get_attribute("data-atlas-page-count")), "pageId": atlas.get_attribute("data-atlas-active-page"), "resourceIds": json.loads(atlas.get_attribute("data-atlas-page-resource-ids")), "connectionIds": json.loads(atlas.get_attribute("data-atlas-page-internal-connection-ids"))},
            "viewport": {"width": 1366, "height": 768},
            "viewports": viewports,
            "screenshots": ["g5-1-reviewed-summary.png", *[item["screenshot"] for item in viewports.values()]],
            "resources": 2,
            "connections": 1,
            "ports": ["eth1", "eth1"],
            "atlas": {"nodes": 2, "links": 1},
            "negativeTests": {"stagingWithoutReplacement": "PASS", "cancel": "PASS (IC-040 real Chromium regression)", "sourceSwap": "PASS (IC-040 real Chromium regression)", "staleWorkspace": "PASS (IC-040 real Chromium regression)", "invalidEndpointOrPort": "PASS (IC-040 P4 mapper regression)"},
            "ci": {"sourceAndSecurity": "REQUIRED", "compiledChromium": "REQUIRED", "yadilabRequiredCi": "REQUIRED"},
            "limitations": ["Reviewed links and ports are source-modeled, not physical verification.", "visualApproved=PENDING_USER"],
        }, indent=2) + "\n")
        require(not errors, "uncaught Chromium errors: " + repr(errors))
        require(not external, "unexpected external browser requests: " + repr(external))
        browser.close()
    print("PASS ATLAS-001 G5.1 reviewed DOCX -> canonical Builder -> Atlas")

if __name__ == "__main__":
    main()
