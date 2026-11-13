#!/usr/bin/env python3
"""ATLAS-001 G5.1: real Chromium DOCX -> canonical Builder -> Atlas acceptance.

The negative cases deliberately exercise the G5.1 staging/approval path. They
never use a mock DOM and never write a PASS value into the manifest without
observing the corresponding browser state.
"""
import argparse
import hashlib
import io
import json
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = ROOT / "tests/fixtures/atlas001-g5.0"
CONTROL_A = FIXTURE_DIR / "atlas001-g5-control-a-500-pages.docx"
CONTROL_B = FIXTURE_DIR / "atlas001-g5-control-b-500-pages.docx"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
ODT_MIME = "application/vnd.oasis.opendocument.text"


def require(ok, message):
    if not ok:
        raise AssertionError(message)


def menu(page):
    advanced = page.locator(".workspace-menu-advanced")
    require(advanced.count() == 1, "advanced menu is not unique")
    if advanced.get_attribute("open") is None:
        advanced.locator("summary").click()
    return advanced


def export_source(page):
    with page.expect_download(timeout=30000) as incoming:
        menu(page).get_by_role("button", name="Exportera källfil").click()
    return json.loads(Path(incoming.value.path()).read_text(encoding="utf-8"))


def open_g51(page):
    menu(page).locator('[data-review-office-g5-1="REVIEW_REQUIRED"]').click()
    expect(page.locator('[data-office-p1b-panel="REVIEW_REQUIRED"]')).to_be_visible(timeout=15000)


def upload(page, name, data):
    page.locator('[data-office-p1b-file="true"]').set_input_files({
        "name": name, "mimeType": DOCX_MIME if name.endswith(".docx") else ODT_MIME,
        "buffer": data,
    })


def select_review(page, missing_target_port=False):
    expect(page.locator('[data-office-p1b-controls="REVIEW_REQUIRED"]')).to_be_visible(timeout=30000)
    for key, role in (("0:1:0", "network.router"), ("0:2:0", "network.switch")):
        page.locator('[data-office-p1b-cell-ordinal="true"]').select_option(key)
        page.locator('[data-office-p1b-add="true"]').click()
        page.locator(f'[data-office-p1b-role="{key}"]').select_option(role)
        page.locator(f'[data-office-p1b-cell-ack="{key}"]').check()
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
    if not missing_target_port:
        row.locator('[data-office-p4-target-port-ack="1:1"]').check()
    page.locator('[data-office-p4-modeled-ack="true"]').check()
    page.locator('[data-office-p1b-modeled-ack="true"]').check()


def stage(page):
    page.locator('[data-office-p1b-confirm="true"]').click()
    expect(page.locator('[data-office-g5-1-summary="REVIEW_REQUIRED"]')).to_be_visible(timeout=45000)


def new_page(browser, url):
    page = browser.new_page(accept_downloads=True, viewport={"width": 1366, "height": 768})
    page.on("dialog", lambda dialog: dialog.accept())
    page.add_init_script("Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });")
    page.goto(url, wait_until="domcontentloaded", timeout=30000)
    page.locator('[data-network-import-primary="true"]').wait_for(timeout=30000)
    return page


def make_odt():
    office = "urn:oasis:names:tc:opendocument:xmlns:office:1.0"
    table = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
    text = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
    manifest_ns = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"
    def cell(value):
        return f'<table:table-cell office:value-type="string"><text:p>{value}</text:p></table:table-cell>'
    rows = "".join("<table:table-row>" + "".join(cell(v) for v in values) + "</table:table-row>"
                    for values in (("Host", "Address"), ("node01", "10.0.0.1")))
    content = (f'<office:document-content xmlns:office="{office}" xmlns:table="{table}" '
               f'xmlns:text="{text}" office:version="1.3"><office:body><office:text>'
               f'<table:table table:name="Inventory"><table:table-column/>{rows}</table:table>'
               "</office:text></office:body></office:document-content>")
    manifest = (f'<manifest:manifest xmlns:manifest="{manifest_ns}" manifest:version="1.3">'
                f'<manifest:file-entry manifest:full-path="/" manifest:media-type="{ODT_MIME}"/>'
                '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
                "</manifest:manifest>")
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as package:
        info = zipfile.ZipInfo("mimetype", (1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_STORED
        package.writestr(info, ODT_MIME.encode("ascii"))
        package.writestr("content.xml", content.encode(), compress_type=zipfile.ZIP_DEFLATED)
        package.writestr("META-INF/manifest.xml", manifest.encode(), compress_type=zipfile.ZIP_DEFLATED)
    return stream.getvalue()


def mutate_docx(data, kind):
    with zipfile.ZipFile(io.BytesIO(data), "r") as source:
        members = {name: source.read(name) for name in source.namelist()}
    xml = members["word/document.xml"].decode("utf-8")
    if kind == "endpoint":
        old, new = ">g5-switch-001<", ">g5-ghost-001<"
    elif kind == "port":
        old, new = ">eth1<", ">bad port<"
    else:
        raise ValueError(kind)
    head, tail = xml.rsplit(old, 1)
    members["word/document.xml"] = (head + new + tail).encode("utf-8")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
        for name, value in members.items():
            target.writestr(name, value)
    return output.getvalue()


def open_project(page, path):
    with page.expect_file_chooser(timeout=10000) as chooser:
        page.locator('[data-project-action="open"]').click()
    chooser.value.set_files(str(path))


def positive(browser, url, evidence, data):
    page = new_page(browser, url)
    errors, external = [], []
    origin = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.on("request", lambda req: external.append(req.url)
            if not (req.url.startswith(origin) or req.url.startswith(("data:", "blob:"))) else None)
    try:
        open_g51(page)
        upload(page, CONTROL_B.name, data)
        expect(page.locator('[data-office-p1b-source-sha]')).to_be_visible(timeout=30000)
        require("g5-router-001" not in page.locator('[data-office-p1b-panel]').inner_html(), "raw DOCX text leaked")
        select_review(page)
        expect(page.locator('[data-office-p1b-confirm="true"]')).to_be_enabled()
        stage(page)
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
        readback = export_source(page)
        require([item["id"] for item in readback["resources"]] == ["g5-router-001", "g5-switch-001"], "canonical readback lost original IDs")
        link = readback["connections"][0]
        require(len(readback["connections"]) == 1 and link["from"]["resource"] == "g5-router-001" and link["to"]["resource"] == "g5-switch-001", "canonical readback changed endpoints")
        require(link["from"]["port"] == "eth1" and link["to"]["port"] == "eth1", "canonical readback changed ports")
        provenance = readback.get("officeReviewProvenance")
        require(provenance and provenance["status"] == "CURRENT", "current DOCX provenance missing from canonical export")
        require(provenance["source"]["sha256"] == hashlib.sha256(data).hexdigest(), "provenance SHA is not the verified original SHA")
        require(provenance["source"]["part"] == "word/document.xml", "wrong DOCX part")
        require(len(provenance["facts"]) == 6, "expected 2 resource + 2 endpoint + 2 port provenance facts")
        for fact in provenance["facts"]:
            require(fact["locator"]["sourceSha256"] == provenance["source"]["sha256"], "locator is not source-bound")
            require(fact["decision"] == "USER_CONSENTED_MODELED_UNVERIFIED", "provenance overstated verification")
        viewports = {}
        for width, height in ((1366, 768), (1280, 800), (1920, 1080), (390, 844)):
            page.set_viewport_size({"width": width, "height": height})
            expect(page.locator('[data-topology-view-mode="atlas"]')).to_be_visible(timeout=30000)
            expect(atlas).to_have_attribute("data-atlas-layout-error-count", "0", timeout=30000)
            name = f"g5-1-atlas-control-b-{width}x{height}.png"
            page.screenshot(path=str(evidence / name), full_page=True)
            viewports[f"{width}x{height}"] = {"status": "PASS", "screenshot": name, "layoutErrors": 0}
        runtime_commit = page.locator('[data-source-commit]').get_attribute("data-source-commit")
        return readback, {"positive": "PASS", "viewports": viewports, "runtimeCommit": runtime_commit}, errors, external
    finally:
        page.close()


def negative_cases(browser, url, data_b, data_a):
    results = {}
    page = new_page(browser, url)
    try:
        baseline = export_source(page)
        open_g51(page); upload(page, CONTROL_A.name, data_a)
        expect(page.locator('[data-office-p1b-controls="REVIEW_REQUIRED"]')).to_be_visible(timeout=30000)
        cell_options = page.locator('[data-office-p1b-cell-ordinal="true"] option').evaluate_all(
            "options => options.map(option => option.value).filter(Boolean)"
        )
        link_options = page.locator('[data-office-p4-row-choice="true"] option').evaluate_all(
            "options => options.map(option => option.value).filter(Boolean)"
        )
        require(not cell_options and not link_options, "control A exposed selectable topology cells or links")
        require(page.locator('[data-office-g5-1-summary]').count() == 0, "control A staged a summary")
        page.locator('[data-office-p1b-cancel="true"]').click()
        require(export_source(page) == baseline, "control A changed Builder")
        results["N1_control_a_no_topology"] = "PASS"
    finally:
        page.close()

    page = new_page(browser, url)
    try:
        open_g51(page); upload(page, CONTROL_B.name, data_b); select_review(page); stage(page)
        page.locator('[data-office-g5-1-cancel="true"]').click()
        require(page.locator('[data-office-g5-1-summary]').count() == 0, "cancel retained staged approval")
        page.locator('[data-office-p1b-cancel="true"]').click()
        require(export_source(page) == baseline, "staging cancel mutated Builder")
        open_g51(page)
        require(page.locator('[data-office-g5-1-summary]').count() == 0, "old approval reused after reopen")
        results["N2_cancel_before_replacement"] = "PASS"
    finally:
        page.close()

    page = new_page(browser, url)
    try:
        open_g51(page); upload(page, CONTROL_B.name, data_b); select_review(page); stage(page)
        page.evaluate(
            "bad => { const bytes = new Uint8Array(bad); File.prototype.arrayBuffer = () => Promise.resolve(bytes.buffer); }",
            list(data_a))
        page.locator('[data-office-g5-1-approval="true"]').click()
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_have_text("ATLAS_G5_1_SOURCE_CHANGED", timeout=30000)
        require(page.locator('[data-atlas-activation-mode="BOUNDED_SOURCE_PAGE"]').count() == 0, "changed original activated Atlas")
        results["N3_source_changed_after_staging"] = "PASS"
    finally:
        page.close()

    page = new_page(browser, url)
    try:
        open_g51(page); upload(page, CONTROL_B.name, data_b); select_review(page); stage(page)
        # The staged panel is an overlay; dispatch the real button event on
        # the underlying project control so the active Builder is replaced
        # while the old approval remains mounted and must become stale.
        page.locator('[data-project-action="new"]').evaluate("element => element.click()")
        page.locator('[data-office-g5-1-approval="true"]').click()
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_have_text("ATLAS_G5_1_STALE", timeout=30000)
        require(page.locator('[data-atlas-activation-mode="BOUNDED_SOURCE_PAGE"]').count() == 0, "stale workspace activated Atlas")
        results["N4_stale_workspace"] = "PASS"
    finally:
        page.close()

    page = new_page(browser, url)
    try:
        open_g51(page); upload(page, CONTROL_B.name, data_b); select_review(page, missing_target_port=True)
        require(page.locator('[data-office-p1b-confirm="true"]').is_disabled(), "missing port approval enabled staging")
        page.locator('[data-office-p1b-confirm="true"]').evaluate("el => el.click()")
        require(page.locator('[data-office-g5-1-summary]').count() == 0, "missing port approval reached staging")
        results["N5_missing_port_approval"] = "PASS"
    finally:
        page.close()

    for kind, expected in (("endpoint", "IC040_P4_LINK_ENDPOINT_UNKNOWN"), ("port", "IC040_P4_PORT_INVALID")):
        page = new_page(browser, url)
        try:
            open_g51(page); upload(page, f"g5-{kind}-mutated.docx", mutate_docx(data_b, kind)); select_review(page)
            page.locator('[data-office-p1b-confirm="true"]').click()
            expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_have_text(expected, timeout=30000)
        finally:
            page.close()
    results["N6_invalid_endpoint_or_port"] = "PASS"

    page = new_page(browser, url)
    try:
        open_g51(page); upload(page, "g5-odt-original.odt", make_odt())
        expect(page.locator('[data-office-p1b-error="BLOCKED"]')).to_have_text("ATLAS_G5_1_DOCX_ONLY", timeout=30000)
        require(page.locator('[data-office-g5-1-summary]').count() == 0, "ODT reached G5.1 staging")
        results["N7_odt_blocked_on_g51"] = "PASS"
    finally:
        page.close()
    return results


def project_file(source, path):
    content = {"source": source, "layoutOverrides": []}
    raw = json.dumps(content, ensure_ascii=False, separators=(",", ":"))
    document = {"formatId": "yadilab.project", "schemaVersion": 1, "digestAlgorithm": "SHA-256",
                "contentSha256": hashlib.sha256(raw.encode()).hexdigest(), "content": content}
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def save_open_and_tampered(browser, url, source, temp_dir):
    valid = temp_dir / "g5-valid.yadilab"
    project_file(source, valid)
    page = new_page(browser, url)
    try:
        open_project(page, valid)
        expect(page.locator('[data-project-message="true"]')).to_contain_text("Opened editable source", timeout=30000)
        reopened = export_source(page)
        require(reopened.get("officeReviewProvenance") == source.get("officeReviewProvenance"), "Save/Open lost office provenance")
    finally:
        page.close()
    tampered = json.loads(json.dumps(source))
    # A locator with a different source digest must be rejected before it can
    # replace the active Builder. This is deterministic without guessing the
    # physical row/cell bounds of the original DOCX.
    tampered["officeReviewProvenance"]["facts"][0]["locator"]["sourceSha256"] = "b" * 64
    invalid = temp_dir / "g5-tampered.yadilab"
    project_file(tampered, invalid)
    page = new_page(browser, url)
    try:
        baseline = export_source(page)
        open_project(page, invalid)
        expect(page.locator('[data-project-message="true"]')).to_contain_text("PROJECT_OFFICE_REVIEW_PROVENANCE_LOCATOR", timeout=30000)
        require(export_source(page) == baseline, "tampered provenance changed active Builder")
    finally:
        page.close()
    return "PASS"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True)
    args = parser.parse_args()
    evidence = Path(args.evidence_dir)
    evidence.mkdir(parents=True, exist_ok=True)
    data_a, data_b = CONTROL_A.read_bytes(), CONTROL_B.read_bytes()
    with sync_playwright() as pw:
        launch = {"headless": True}
        if Path("/usr/bin/chromium").exists(): launch["executable_path"] = "/usr/bin/chromium"
        browser = pw.chromium.launch(**launch)
        try:
            readback, positive_report, errors, external = positive(browser, args.url, evidence, data_b)
            negatives = negative_cases(browser, args.url, data_b, data_a)
            with tempfile.TemporaryDirectory(prefix="yadilab-g51-project-") as temp:
                save_open = save_open_and_tampered(browser, args.url, readback, Path(temp))
        finally:
            browser.close()
    require(not errors, "uncaught Chromium errors: " + repr(errors))
    require(not external, "unexpected external browser requests: " + repr(external))
    provenance = readback["officeReviewProvenance"]
    facts_by_field = {fact["field"]: fact["locator"] for fact in provenance["facts"]}
    runtime_commit = positive_report.get("runtimeCommit")
    require(runtime_commit and runtime_commit != "RUNTIME_BUILD_COMMIT", "runtime build commit marker missing")
    manifest = {
        "commit": runtime_commit, "fixture": str(CONTROL_B.relative_to(ROOT)),
        "originalSha256": hashlib.sha256(data_b).hexdigest(), "documentProfile": provenance["source"]["profileId"],
        "physicalPages": 500, "locators": {"factsByField": facts_by_field, "all": [fact["locator"] for fact in provenance["facts"]]},
        "provenance": {"formatId": provenance["formatId"], "status": provenance["status"], "targetModel": provenance["targetModel"], "factCount": len(provenance["facts"]), "physicalTopologyVerified": provenance["physicalTopologyVerified"]},
        "canonical": {"resourceIds": [item["id"] for item in readback["resources"]], "connectionIds": [readback["connections"][0]["id"]], "endpoints": readback["connections"][0], "compile": "valid", "roundTrip": "PASS", "physicalTruth": "UNVERIFIED_MODELED"},
        "atlas": {"nodes": 2, "links": 1}, "viewports": positive_report["viewports"],
        "screenshots": ["g5-1-reviewed-summary.png", *[item["screenshot"] for item in positive_report["viewports"].values()] ],
        "negativeTests": {**negatives, "N8_tampered_provenance": "PASS"}, "saveOpenProvenance": save_open,
        "ci": {"sourceAndSecurity": "REQUIRED", "compiledChromium": "REQUIRED", "yadilabRequiredCi": "REQUIRED"},
        "limitations": ["DOCX declarations and ports are source-modeled facts, not physical cable verification.", "500 physical document pages do not imply 500 Atlas pages.", "visualApproved=PENDING_USER"],
        "visualApproved": "PENDING_USER",
    }
    (evidence / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("PASS ATLAS-001 G5.1 positive DOCX, provenance round-trip, DOCX-only and negative Chromium N1-N8")


if __name__ == "__main__":
    main()
