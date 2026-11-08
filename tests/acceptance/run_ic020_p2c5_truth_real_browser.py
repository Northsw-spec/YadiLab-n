#!/usr/bin/env python3
"""IC-020 P2c5: actual compiled Chromium and five ORIGINAL producer files.
Verdicts must originate in Engine, not source parsing, DOM text tricks or guest commands.
"""
import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
from run_ic010_p2_shared_xml_real_browser import setup,exported_source,require

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"tests/fixtures/import"))
from generate_ic020_p2c5_network import build

FORMATS=("json","csv","tsv","xlsx","ods")
MIMES={"json":"application/json","csv":"text/csv","tsv":"text/tab-separated-values",
 "xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
 "ods":"application/vnd.oasis.opendocument.spreadsheet"}

def select_file(page,fmt,variant):
    data=build(fmt,variant)
    with page.expect_file_chooser(timeout=20000) as future:
        page.locator('[data-network-import-primary="true"]').click()
    future.value.set_files({"name":"consultant."+fmt,"mimeType":MIMES[fmt],"buffer":data})
    expect(page.locator('[data-network-import-panel="ready"]')).to_be_visible(timeout=30000)
    preview=page.locator('[data-network-import-preview]')
    expect(preview).to_be_visible(timeout=30000)
    require(hashlib.sha256(data).hexdigest() in
        page.locator('[data-network-import-sha]').inner_text(),
        "Original full source SHA was not displayed")
    return preview

def run_selected(pane,page,host,probe,destination,truth):
    source=pane.get_by_label("Källvärd")
    active=pane.get_by_label("Aktiv probe")
    source.select_option(host)
    active.select_option(probe)
    if destination:
        pane.locator("label.inspector-field").filter(has_text=re.compile(r"^Destination")).locator("select").select_option(destination)
    pane.get_by_role("button",name="Kör modellerad aktiv probe").click()
    transcript=page.locator('[data-active-probe-transcript]').first
    expect(transcript).to_be_visible(timeout=25000)
    expect(transcript).to_contain_text("verdict "+truth,timeout=20000)
    message=transcript.inner_text()
    require("NO_GUEST_COMMAND_EXECUTION" in message,
            "Modeled probe boundary incorrectly implies guest/physical execution")
    require(transcript.get_attribute("data-active-probe-scenario-hash")==
            page.locator(".app-frame").get_attribute("data-runtime-scenario-hash"),
            "Transcript not tied to actual active Runtime hash")
    require("Engine " in message,"Missing Engine-owned verdict/provenance")
    require("verdict TRUE" not in message,
            "Negative/UNKNOWN source was misreported as Engine PASS")
    return {"host":host,"probe":probe,"verdict":truth,
            "runtimeScenarioBound":True,"noGuestCommands":True}

def case_runtime(browser,url,fmt):
    page,errors,outside=setup(browser,url)
    try:
        source=select_file(page,fmt,"valid")
        expect(source).to_have_attribute("data-network-import-preview","READY")
        txt=source.inner_text()
        require("Devices: 3" in txt and "Explicit links: 2" in txt,
                "Unexpected modeled graph/connection count for "+fmt)
        require(page.locator('[data-network-import-runtime]').is_enabled(),
                "No explicit eligible modeled Runtime for "+fmt)
        page.locator('[data-network-import-runtime]').click()
        expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
        page.wait_for_function(
         "document.querySelector('.app-frame')?.getAttribute('data-runtime-scenario-hash') !== 'builder'",
         timeout=30000)
        pane=page.locator('[data-active-probe-engine]').first
        expect(pane).to_be_visible(timeout=25000)
        require(pane.get_attribute("open") is not None,"Modeled probe panel did not open")
        checks=[]
        for host,system in (("win01","windows"),("lin01","linux")):
            checks.append(run_selected(pane,page,host,system+".ping","rtr01","FALSE"))
            checks.append(run_selected(pane,page,host,
              "windows.resolve_dnsname" if system=="windows" else "linux.dig",
              None,"UNKNOWN"))
        require(not errors,"Compiled browser errors "+repr(errors))
        require(not outside,"Unexpected external HTTP request "+repr(outside))
        return {"case":"actual_"+fmt+"_imported_windows_linux_FALSE_UNKNOWN",
                "status":"PASS","probes":checks,"physicalProbes":False,
                "externalRequests":0}
    finally:page.close()

def case_conflicts(browser,url,fmt):
    page,errors,outside=setup(browser,url)
    try:
        before=exported_source(page)
        checked=[]
        for variant,code in (
            ("address-conflict","NETWORK_IMPORT_ADDRESS_CONFLICT"),
            ("prefix-conflict","NETWORK_IMPORT_ADDRESS_CONFLICT"),
            ("alias-conflict","NETWORK_IMPORT_FIELD_AMBIGUOUS"),
            ("duplicate-device","NETWORK_IMPORT_DUPLICATE_DEVICE_ID"),
        ):
            pane=select_file(page,fmt,variant)
            expect(pane).to_have_attribute("data-network-import-preview","BLOCKED")
            require(code in pane.inner_text(),"Invalid typed document was accepted: "+variant)
            require("10.9.10.99" not in pane.inner_text(),"Conflicting raw IP disclosed")
            require(page.locator('[data-network-import-activate]').is_disabled(),
                    "Conflicting document Builder was available")
            require(page.locator('[data-network-import-runtime]').is_disabled(),
                    "Conflicting document Runtime was available")
            page.get_by_role("button",name="Close network import").click()
            expect(page.locator('[data-network-import-panel]')).to_have_count(0)
            require(exported_source(page)==before,"Blocked preview mutated Builder")
            checked.append(variant)
        require(not errors,"Compiled browser errors "+repr(errors))
        require(not outside,"External HTTP request "+repr(outside))
        return {"case":"actual_"+fmt+"_conflicting_address_prefix_alias_and_duplicate",
                "status":"PASS","blocked":checked,"builderUnchanged":True,
                "externalRequests":0}
    finally:page.close()

def case_dual_stack_source_truth(browser,url):
    """Real compiled UI: CSV IPv6/MTU/ports survive Builder activation exactly."""
    columns=[
        "Asset ID","Hostname","Device Type","IP Address","Prefix Length",
        "IPv6 Address","IPv6 Prefix","Interface ID","Interface Name",
        "MTU","MAC Address","Connected To",
    ]
    rows=[
        ["edge01","Edge Router","Router","10.14.0.1","24",
         "2001:db8:14::1","64","eth0","LAN Uplink","1500",
         "AA:BB:CC:DD:EE:01","peer01"],
        ["peer01","Peer","Server","","","fe80::2","","eth1","","9000","",""],
    ]
    data=("\n".join([",".join(columns)]+[",".join(row) for row in rows])+"\n").encode("utf-8")
    page,errors,outside=setup(browser,url)
    try:
        with page.expect_file_chooser(timeout=20000) as future:
            page.locator('[data-network-import-primary="true"]').click()
        future.value.set_files({"name":"dual-stack.csv","mimeType":"text/csv","buffer":data})
        preview=page.locator('[data-network-import-preview]')
        expect(preview).to_have_attribute("data-network-import-preview","READY",timeout=30000)
        require(hashlib.sha256(data).hexdigest() in
                page.locator('[data-network-import-sha]').inner_text(),
                "Dual-stack original CSV SHA mismatch")
        require(preview.locator('[data-network-import-unmapped="0"]').count()==1,
                "Documented IPv6/MTU/port columns were silently unmapped")
        require(page.locator('[data-network-import-activate]').is_enabled(),
                "Documented dual-stack CSV refused editable Builder")
        page.locator('[data-network-import-activate]').click()
        expect(page.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
        source=exported_source(page)
        resources={r["id"]:r for r in source["resources"]}
        require(set(resources)=={"edge01","peer01"},
                "Builder imported incorrect canonical device identities")
        edge=resources["edge01"]["interfaces"][0]
        peer=resources["peer01"]["interfaces"][0]
        require(edge=={"id":"eth0","label":"LAN Uplink",
                       "addresses":["10.14.0.1/24","2001:db8:14::1/64"],
                       "mac":"AA:BB:CC:DD:EE:01","mtu":1500},
                "Builder did not preserve explicit dual-stack/MTU/interface facts")
        require(peer=={"id":"eth1","label":"eth1","addresses":["fe80::2"],"mtu":9000},
                "IPv6-only peer did not preserve its exact source IPv6/MTU")
        require(len(source["connections"])==1 and
                source["connections"][0]["from"]=={"resource":"edge01"} and
                source["connections"][0]["to"]=={"resource":"peer01"},
                "Imported link must have explicit endpoint IDs, not inferred switch ports")
        require(not errors,"Compiled dual-stack browser errors "+repr(errors))
        require(not outside,"External HTTP request during offline import "+repr(outside))
    finally:page.close()

    # The exact same compiled UI must deny malformed IPv6, without replacing
    # any existing Builder source or inventing a valid network from the input.
    invalid,errors,outside=setup(browser,url)
    try:
        baseline=exported_source(invalid)
        data=("Asset ID,Hostname,Device Type,IPv6 Address\n"
              "edge01,Edge Router,Router,2001:::1\n").encode("utf-8")
        with invalid.expect_file_chooser(timeout=20000) as future:
            invalid.locator('[data-network-import-primary="true"]').click()
        future.value.set_files({"name":"bad-ipv6.csv","mimeType":"text/csv","buffer":data})
        blocked=invalid.locator('[data-network-import-preview]')
        expect(blocked).to_have_attribute("data-network-import-preview","BLOCKED",timeout=30000)
        require("WORKBOOK_IPV6_INVALID" in blocked.inner_text(),
                "Malformed IPv6 was not rejected in actual compiled app")
        require(invalid.locator('[data-network-import-activate]').is_disabled(),
                "Malformed IPv6 incorrectly offered Builder activation")
        require(invalid.locator('[data-network-import-runtime]').is_disabled(),
                "Malformed IPv6 incorrectly offered Runtime activation")
        # The import review is a modal and deliberately intercepts background
        # controls. Dismiss it before exporting the unchanged Builder source.
        # Never bypass the modal with a forced click or script-injected export.
        invalid.get_by_role("button",name="Close network import").click()
        expect(invalid.locator('[data-network-import-panel]')).to_have_count(0)
        require(exported_source(invalid)==baseline,
                "Blocked IPv6 import mutated the existing Builder")
        require(not errors,"Invalid IPv6 browser errors "+repr(errors))
        require(not outside,"External HTTP request during invalid import "+repr(outside))
    finally:invalid.close()
    return {"case":"actual_csv_dual_stack_source_and_invalid_ipv6",
            "status":"PASS","origin":"real_csv",
            "sourceIPv6Preserved":True,"MTUPreserved":True,
            "explicitInterfaceIDsPreserved":True,
            "malformedIPv6Rejected":True,"inventedPhysicalLinks":False,
            "externalRequests":0}

def case_unprojected_workbook(browser,url):
    """Actual compiled UI must not call silently dropped canonical facts READY."""
    original={
        "Metadata":[{"schemaVersion":"1.0.0","scenarioId":"original_workbook",
                     "title":"Original Network Workbook"}],
        "Nodes":[{"nodeId":"node01","displayName":"Router",
                  "type":"network.router"}],
    }
    variants=[
        ("declared_routes",
         {**original,"Routes":[{"destination":"0.0.0.0/0",
                               "nextHop":"192.0.2.1"}]},
         "WORKBOOK_SHEET_NOT_MAPPED", "BLOCKED"),
        ("unmapped_node_field",
         {**original,"Nodes":[{**original["Nodes"][0],"rack":"Building C"}]},
         "WORKBOOK_FIELD_NOT_MAPPED", "BLOCKED"),
        ("blank_optional_template",
         {**original,"Routes":[{"destination":"","nextHop":None}]},
         None, "READY"),
        ("boolean_metadata_title",
         {**original,"Metadata":[{**original["Metadata"][0],"title":False}]},
         "WORKBOOK_PROJECTED_FIELD_TYPE_INVALID", "BLOCKED"),
        ("object_metadata_description",
         {**original,"Metadata":[{**original["Metadata"][0],
                                  "description":{"owner":"operations"}}]},
         "WORKBOOK_PROJECTED_FIELD_TYPE_INVALID", "BLOCKED"),
        ("boolean_zone_label",
         {**original,"Zones":[{"zoneId":"site_a",
                               "displayName":False,"kind":"lan"}]},
         "WORKBOOK_PROJECTED_FIELD_TYPE_INVALID", "BLOCKED"),
        ("boolean_interface_label",
         {**original,"Interfaces":[{"nodeId":"node01",
                                    "interfaceId":"eth0","name":True}]},
         "WORKBOOK_PROJECTED_FIELD_TYPE_INVALID", "BLOCKED"),
        ("conflicting_gateway_columns",
         {**original,"Nodes":[{**original["Nodes"][0],
                               "gateway":"192.0.2.1",
                               "Default Gateway":"192.0.2.254"}]},
         "WORKBOOK_GATEWAY_DECLARATION_CONFLICT", "BLOCKED"),
        ("matching_gateway_columns",
         {**original,"Nodes":[{**original["Nodes"][0],
                               "gateway":"192.0.2.1",
                               "Default Gateway":" 192.0.2.1 "}]},
         None, "READY"),
        ("blank_metadata_title",
         {**original,"Metadata":[{**original["Metadata"][0],"title":" "}]},
         None, "READY"),
    ]
    checks=[]
    for name,document,code,expected in variants:
        page,errors,outside=setup(browser,url)
        try:
            before=exported_source(page)
            data=json.dumps(document,separators=(",",":")).encode("utf-8")
            with page.expect_file_chooser(timeout=20000) as future:
                page.locator('[data-network-import-primary="true"]').click()
            future.value.set_files({
                "name":name+".json","mimeType":"application/json","buffer":data,
            })
            preview=page.locator('[data-network-import-preview]')
            expect(preview).to_have_attribute(
                "data-network-import-preview",expected,timeout=30000)
            require(hashlib.sha256(data).hexdigest() in
                    page.locator('[data-network-import-sha]').inner_text(),
                    "Original canonical workbook SHA missing: "+name)
            if code:
                require(code in preview.inner_text(),
                        "Canonical source fact was discarded without error: "+name)
                original_locations={
                    "declared_routes":"Routes / row 1",
                    "unmapped_node_field":"Nodes / row 1 / field rack",
                    "boolean_metadata_title":"Metadata / row 1 / field title",
                    "object_metadata_description":"Metadata / row 1 / field description",
                    "boolean_zone_label":"Zones / row 1 / field displayName",
                    "boolean_interface_label":"Interfaces / row 1 / field name",
                    "conflicting_gateway_columns":"Nodes / row 1 / field Default Gateway",
                }
                original_location=original_locations[name]
                require(original_location in preview.inner_text(),
                        "The actual import UI did not locate the source row/field: "+name)
                require(page.locator('[data-network-import-activate]').is_disabled(),
                        "Unmapped canonical facts offered partial Builder activation")
                require(page.locator('[data-network-import-runtime]').is_disabled(),
                        "Unmapped canonical facts offered unsupported Runtime")
            else:
                require(page.locator('[data-network-import-activate]').is_enabled(),
                        "Empty optional workbook template incorrectly blocked a valid source")
            # The review dialog is modal. Close through the actual UI before
            # exporting the original Builder to assert no implicit mutation.
            page.get_by_role("button",name="Close network import").click()
            expect(page.locator('[data-network-import-panel]')).to_have_count(0)
            require(exported_source(page)==before,
                    "Workbook preview mutated canonical Builder: "+name)
            require(not errors,"Compiled workbook browser errors "+repr(errors))
            require(not outside,"Unexpected external request "+repr(outside))
            checks.append(name)
        finally:page.close()
    return {"case":"canonical_workbook_unprojected_source_fidelity",
            "status":"PASS","cases":checks,"sourceMutated":False,
            "inventedPhysicalLinks":False,"externalRequests":0}

def case_shorthand_supplemental_source_truth(browser,url):
    """Real multitable JSON must never silently drop second-sheet declarations."""
    devices=[
        {"Asset ID":"edge01","Hostname":"Edge","Device Type":"Router",
         "Connected To":"peer01"},
        {"Asset ID":"peer01","Hostname":"Peer","Device Type":"Server"},
    ]
    blocked=[
        ("route_assertion",
         {"Devices":devices,"Routes":[{"destination":"0.0.0.0/0","nextHop":"192.0.2.1"}]},
         "NETWORK_IMPORT_ADDITIONAL_SHEET_UNMAPPED", "Routes / row 1"),
        ("vlan_assertion",
         {"Devices":devices,"VLANs":[{"vlanId":20,"name":"Guest"}]},
         "NETWORK_IMPORT_ADDITIONAL_SHEET_UNMAPPED", "VLANs / row 1"),
        ("extra_interface",
         {"Devices":devices,"Interfaces":[{"nodeId":"edge01",
                                           "interfaceId":"eth1","IPv6":"2001:db8::1"}]},
         "NETWORK_IMPORT_ADDITIONAL_SHEET_UNMAPPED", "Interfaces / row 1"),
        ("extra_metadata",
         {"Devices":devices,"Metadata":[{"scenarioId":"customer_site",
                                         "title":"Original customer project"}]},
         "NETWORK_IMPORT_ADDITIONAL_SHEET_UNMAPPED", "Metadata / row 1"),
        ("link_ignored_bandwidth",
         {"Devices":[{**devices[0],"Connected To":""},devices[1]],
          "Links":[{"linkId":"edge01_peer01","nodeA":"edge01","nodeB":"peer01",
                    "speedMbps":1000}]},
         "NETWORK_IMPORT_LINK_FIELD_UNMAPPED", "Links / row 1 / field speedMbps"),
    ]
    page,errors,outside=setup(browser,url)
    try:
        baseline=exported_source(page)
        for name,document,diagnostic,locator in blocked:
            data=json.dumps(document,separators=(",",":")).encode("utf-8")
            with page.expect_file_chooser(timeout=20000) as future:
                page.locator('[data-network-import-primary="true"]').click()
            future.value.set_files({
                "name":name+".json","mimeType":"application/json","buffer":data,
            })
            review=page.locator('[data-network-import-preview]')
            expect(review).to_have_attribute(
                "data-network-import-preview","BLOCKED",timeout=30000)
            text=review.inner_text()
            require(diagnostic in text and locator in text,
                    "Silent supplementary source loss or missing original row: "+name)
            require(hashlib.sha256(data).hexdigest() in
                    page.locator('[data-network-import-sha]').inner_text(),
                    "Preview SHA was not original source file: "+name)
            require(page.locator('[data-network-import-activate]').is_disabled(),
                    "Partially projected source was offered as Builder")
            require(page.locator('[data-network-import-runtime]').is_disabled(),
                    "Discarded source facts were offered as modeled Runtime")
            page.get_by_role("button",name="Close network import").click()
            expect(page.locator('[data-network-import-panel]')).to_have_count(0)
            require(exported_source(page)==baseline,
                    "Rejected supplementary source mutated original Builder: "+name)
        require(not errors,"Browser errors in supplemental sheet denial "+repr(errors))
        require(not outside,"Unexpected external network traffic "+repr(outside))
    finally:page.close()

    # An empty optional Links/Routes template is NOT a link declaration.
    # The real explicit Devices.Connected To link must remain the only edge.
    allowed={
        "Devices":devices,
        "Links":[{"linkId":"","nodeA":None,"nodeB":" ","speedMbps":""}],
        "Routes":[{"destination":" ","nextHop":None}],
    }
    valid,errors,outside=setup(browser,url)
    try:
        raw=json.dumps(allowed,separators=(",",":")).encode("utf-8")
        with valid.expect_file_chooser(timeout=20000) as future:
            valid.locator('[data-network-import-primary="true"]').click()
        future.value.set_files({
            "name":"empty-templates.json","mimeType":"application/json",
            "buffer":raw,
        })
        review=valid.locator('[data-network-import-preview]')
        expect(review).to_have_attribute(
            "data-network-import-preview","READY",timeout=30000)
        require("NETWORK_IMPORT_LINK_SOURCES_CONFLICT" not in review.inner_text(),
                "An empty Links template incorrectly triggered link-source conflict")
        require(valid.locator('[data-network-import-activate]').is_enabled(),
                "Empty secondary templates wrongly blocked real Devices facts")
        valid.locator('[data-network-import-activate]').click()
        expect(valid.locator('[data-network-import-panel]')).to_have_count(0,timeout=45000)
        source=exported_source(valid)
        require({r["id"] for r in source["resources"]}=={"edge01","peer01"},
                "Empty templates changed the source device inventory")
        require(len(source["connections"])==1 and
                source["connections"][0]["id"]=="link_row_1" and
                source["connections"][0]["from"]=={"resource":"edge01"} and
                source["connections"][0]["to"]=={"resource":"peer01"},
                "An empty Links sheet fabricated or displaced a physical source link")
        require(not errors,"Valid optional templates caused browser errors "+repr(errors))
        require(not outside,"Unexpected external network traffic "+repr(outside))
    finally:valid.close()
    return {"case":"shorthand_multisheet_source_loss_denial",
            "status":"PASS","blocked":[name for name,*_ in blocked],
            "emptyTemplatesAccepted":True,"explicitConnections":1,
            "originalBuilderUnchanged":True,"physicalProbes":False,
            "externalRequests":0}

def case_declared_inline_link_ports(browser,url):
    """Real CSV ports and link kinds survive; no physical port is inferred."""
    columns=[
        "Asset ID","Hostname","Device Type","Interface ID","IP Address",
        "Connected To","Link ID","From Port","To Port","Link Type",
    ]
    rows=[
        ["edge01","Edge","Router","wan0","192.0.2.10",
         "peer01","edge_to_peer","wan0","lan0","management"],
        ["peer01","Peer","Server","lan0","","","","","",""],
    ]
    data=("\n".join([",".join(columns)]+[
        ",".join(row) for row in rows])+"\n").encode("utf-8")
    page,errors,outside=setup(browser,url)
    try:
        with page.expect_file_chooser(timeout=20000) as future:
            page.locator('[data-network-import-primary="true"]').click()
        future.value.set_files({
            "name":"documented-inline-ports.csv","mimeType":"text/csv","buffer":data,
        })
        review=page.locator('[data-network-import-preview]')
        expect(review).to_have_attribute("data-network-import-preview",
                                         "READY",timeout=30000)
        require(hashlib.sha256(data).hexdigest() in
                page.locator('[data-network-import-sha]').inner_text(),
                "Original CSV SHA not retained")
        require(review.locator('[data-network-import-unmapped="0"]').count()==1,
                "Link port, kind or ID columns were silently ignored")
        page.locator('[data-network-import-activate]').click()
        expect(page.locator('[data-network-import-panel]')).to_have_count(
            0,timeout=45000)
        source=exported_source(page)
        links=source["connections"]
        require(links==[{
            "id":"edge_to_peer","kind":"management",
            "from":{"resource":"edge01","port":"wan0"},
            "to":{"resource":"peer01","port":"lan0"},
            "properties":{},
        }], "Compiled Builder lost exact documented physical link ID/ports/kind")
        resources={r["id"]:r for r in source["resources"]}
        require(resources["edge01"]["interfaces"][0]["id"]=="wan0" and
                resources["peer01"]["interfaces"][0]["id"]=="lan0",
                "Physical port metadata did not match independently declared interfaces")
        require(not errors,"Positive inline link UI errors "+repr(errors))
        require(not outside,"Unexpected external request "+repr(outside))
    finally:page.close()

    # Negative cases retain the actual source byte hash, reject both modes,
    # and never change the preexisting Builder after closing the review.
    cases=[
        ("implicit_source_primary", [
            ["edge01","Edge","Router","","192.0.2.10",
             "peer01","edge_to_peer","primary","lan0","management"],
            rows[1]], "NETWORK_IMPORT_INLINE_LINK_PORT_UNDECLARED",
         "Devices / row 1 / field fromPort"),
        ("undeclared_target_port", [
            ["edge01","Edge","Router","wan0","192.0.2.10",
             "peer01","edge_to_peer","wan0","eth99","management"],
            rows[1]], "NETWORK_IMPORT_INLINE_LINK_PORT_UNDECLARED",
         "Devices / row 1 / field toPort"),
        ("orphan_link_details", [
            ["edge01","Edge","Router","wan0","192.0.2.10",
             "","edge_to_peer","wan0","lan0","management"],
            rows[1]], "NETWORK_IMPORT_LINK_DETAIL_WITHOUT_TARGET",
         "Devices / row 1 / field linkId"),
    ]
    for name,case_rows,code,locator in cases:
        blocked_page,errors,outside=setup(browser,url)
        try:
            before=exported_source(blocked_page)
            negative=("\n".join([",".join(columns)]+[
                ",".join(row) for row in case_rows])+"\n").encode("utf-8")
            with blocked_page.expect_file_chooser(timeout=20000) as future:
                blocked_page.locator('[data-network-import-primary="true"]').click()
            future.value.set_files({
                "name":name+".csv","mimeType":"text/csv","buffer":negative,
            })
            review=blocked_page.locator('[data-network-import-preview]')
            expect(review).to_have_attribute(
                "data-network-import-preview","BLOCKED",timeout=30000)
            text=review.inner_text()
            require(code in text and locator in text,
                    "Missing actual source port rejection: "+name)
            require(blocked_page.locator(
                '[data-network-import-activate]').is_disabled(),
                "Invalid physical port offered Builder activation")
            require(blocked_page.locator(
                '[data-network-import-runtime]').is_disabled(),
                "Invalid physical port offered modeled Runtime")
            require(hashlib.sha256(negative).hexdigest() in
                    blocked_page.locator('[data-network-import-sha]').inner_text(),
                    "Blocked source did not expose its original bytes SHA")
            blocked_page.get_by_role(
                "button",name="Close network import").click()
            expect(blocked_page.locator(
                '[data-network-import-panel]')).to_have_count(0)
            require(exported_source(blocked_page)==before,
                    "Invalid physical link mutated original Builder: "+name)
            require(not errors,"Negative inline port UI errors "+repr(errors))
            require(not outside,"Unexpected external request "+repr(outside))
        finally:blocked_page.close()
    return {"case":"declared_inline_link_ports_exact_source",
            "status":"PASS","positiveCSV":True,"negativeCSV":[c[0] for c in cases],
            "originalBuilderUnchanged":True,"physicalProbes":False,
            "externalRequests":0}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--url",required=True)
    ap.add_argument("--evidence-dir",type=Path,required=True)
    args=ap.parse_args()
    address=urlsplit(args.url)
    require(address.scheme=="http" and address.hostname=="127.0.0.1" and
            address.port is not None and address.path=="/" and
            not address.query and not address.fragment and
            not address.username and not address.password,
            "Only a local compiled browser application may be tested")
    args.evidence_dir.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as p:
        flags=["--disable-dev-shm-usage","--disable-background-networking"]
        if hasattr(os,"geteuid") and os.geteuid()==0:flags.append("--no-sandbox")
        browser=p.chromium.launch(headless=True,args=flags)
        try:
            cases=[]
            for fmt in FORMATS:
                cases.append(case_runtime(browser,args.url,fmt))
                cases.append(case_conflicts(browser,args.url,fmt))
            cases.append(case_dual_stack_source_truth(browser,args.url))
            cases.append(case_unprojected_workbook(browser,args.url))
            cases.append(case_shorthand_supplemental_source_truth(browser,args.url))
            cases.append(case_declared_inline_link_ports(browser,args.url))
        finally:browser.close()
    report={"status":"PASS","kind":"Actual compiled Chromium five-format P2c5 source-bound modeled verdicts",
            "environment":"GitHub Actions Ubuntu; Parrot-native/physical network NOT_RUN",
            "cases":cases,"networkCommandsExecuted":False,
            "inventedPhysicalLinks":False}
    (args.evidence_dir/"ic020-p2c5-five-format-contradiction-modeled-truth-chromium.json").write_text(
        json.dumps(report,indent=2)+"\n")
    print("PASS IC-020 P2c5 actual compiled Chromium five-format FALSE/UNKNOWN imported Engine and conflicting-fact denial",flush=True)
    print(json.dumps(report,indent=2))

if __name__=="__main__":
    try:main()
    except Exception as e:
        print("FAIL IC-020 P2c5 Chromium: "+str(e),file=sys.stderr)
        raise
