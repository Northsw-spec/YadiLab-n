#!/usr/bin/env python3
"""Create deterministic, source-independent ATLAS-001 capacity fixtures.

The writer is deliberately a tiny XLSX package writer used only for test
fixtures. It does not call YadiLab's parser, normalizer, mapper or Builder.
The manifest is an external truth source: tests compare product output against
these IDs/endpoints rather than feeding the manifest into the product.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
from xml.sax.saxutils import escape, quoteattr


SHEETS = ("Metadata", "Zones", "Nodes", "Interfaces", "Links", "Layout")
MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def column_name(index: int) -> str:
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def write_member(archive: ZipFile, path: str, value: str) -> None:
    info = ZipInfo(path, date_time=(2020, 1, 1, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o600 << 16
    archive.writestr(info, value)


def worksheet_xml(rows: list[tuple[str, ...]]) -> str:
    rendered = []
    for row_number, row in enumerate(rows, 1):
        cells = []
        for column_number, value in enumerate(row, 1):
            if value == "":
                continue
            ref = f"{column_name(column_number)}{row_number}"
            cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>')
        rendered.append(f'<row r="{row_number}">{"".join(cells)}</row>')
    body = "".join(rendered)
    return '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + "</sheetData></worksheet>"


def node_id(key: str, index: int) -> str:
    return f"cap_{key}_node_{index:04d}"


def link_id(key: str, index: int) -> str:
    return f"cap_{key}_link_{index:04d}"


def build_rows(key: str, resources: int, connections: int, topology: str) -> tuple[dict[str, list[tuple[str, ...]]], dict[str, object]]:
    nodes = [("nodeId", "displayName", "type", "zoneId")]
    interfaces = [("nodeId", "interfaceId", "name")]
    links = [("linkId", "nodeA", "interfaceA", "nodeB", "interfaceB", "kind")]
    zones = [("zoneId", "displayName", "kind")]
    layout = [("nodeId", "rank")]

    zone_count = max(1, min(10, (resources + 49) // 50))
    for zone_index in range(zone_count):
        zone = f"cap_{key}_zone_{zone_index + 1:02d}"
        zones.append((zone, f"Capacity {key} zone {zone_index + 1:02d}", "lan"))

    for index in range(1, resources + 1):
        identifier = node_id(key, index)
        zone = f"cap_{key}_zone_{((index - 1) * zone_count) // resources + 1:02d}"
        role = "network.switch" if index % 17 == 1 else "endpoint.windows"
        nodes.append((identifier, f"Capacity {key} device {index:04d}", role, zone))
        # Every endpoint has explicit left/right ports. Branch fixtures add a
        # second pair for the one parallel physical declaration.
        interfaces.extend(((identifier, "left", "left"), (identifier, "right", "right")))
        if topology == "branch" and index in (1, 2):
            interfaces.extend(((identifier, "parallel_left", "parallel-left"), (identifier, "parallel_right", "parallel-right")))
        layout.append((identifier, str(index)))

    endpoint_pairs: list[tuple[int, str, int, str]] = []
    if topology == "linear":
        for index in range(1, connections + 1):
            endpoint_pairs.append((index, "right", index + 1, "left"))
    elif topology == "branch":
        # Main component, an explicitly disconnected component, and one
        # parallel edge with distinct source-declared ports.
        main_last = resources - 10
        for index in range(1, main_last):
            endpoint_pairs.append((index, "right", index + 1, "left"))
        for index in range(main_last + 1, resources):
            endpoint_pairs.append((index, "right", index + 1, "left"))
        endpoint_pairs.append((1, "parallel_right", 2, "parallel_left"))
    else:
        raise ValueError(f"unknown topology: {topology}")
    if len(endpoint_pairs) != connections:
        raise AssertionError(f"fixture {key} produced {len(endpoint_pairs)} links, expected {connections}")
    for sequence, (left, left_port, right, right_port) in enumerate(endpoint_pairs, 1):
        links.append((link_id(key, sequence), node_id(key, left), left_port, node_id(key, right), right_port, "network"))

    scenario = f"atlas001_capacity_{key}"
    metadata = [
        ("schemaVersion", "scenarioId", "title", "description"),
        ("1.0.0", scenario, f"ATLAS-001 capacity {key}", "Deterministic synthetic fixture; no real network data."),
    ]
    table_rows = {"Metadata": metadata, "Zones": zones, "Nodes": nodes, "Interfaces": interfaces, "Links": links, "Layout": layout}
    truth = {
        "scenarioId": scenario,
        "resourceIds": [node_id(key, index) for index in range(1, resources + 1)],
        "connectionIds": [link_id(key, index) for index in range(1, connections + 1)],
        "connections": [
            {"id": link_id(key, sequence), "from": node_id(key, left), "fromPort": left_port,
             "to": node_id(key, right), "toPort": right_port}
            for sequence, (left, left_port, right, right_port) in enumerate(endpoint_pairs, 1)
        ],
        "zones": [row[0] for row in zones[1:]],
    }
    return table_rows, truth


def xlsx_bytes(tables: dict[str, list[tuple[str, ...]]], sheet_names: tuple[str, ...]) -> bytes:
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        content_types = [
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '<Default Extension="xml" ContentType="application/xml"/>',
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        ]
        content_types.extend(
            f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            for index in range(1, len(sheet_names) + 1)
        )
        content_types.append("</Types>")
        write_member(archive, "[Content_Types].xml", "".join(content_types))
        write_member(archive, "_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        sheets = "".join(f'<sheet name={quoteattr(name)} sheetId="{index}" r:id="rId{index}"/>' for index, name in enumerate(sheet_names, 1))
        write_member(archive, "xl/workbook.xml", f'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{sheets}</sheets></workbook>')
        relationships = ['<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
        relationships.extend(f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>' for index in range(1, len(sheet_names) + 1))
        relationships.append("</Relationships>")
        write_member(archive, "xl/_rels/workbook.xml.rels", "".join(relationships))
        for index, name in enumerate(sheet_names, 1):
            write_member(archive, f"xl/worksheets/sheet{index}.xml", worksheet_xml(tables[name]))
    return output.getvalue()


def digest_ids(values: list[str]) -> str:
    return hashlib.sha256(json.dumps(values, separators=(",", ":")).encode("utf-8")).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    cases = []
    definitions = [
        ("50-linear", 50, 49, "linear", False, "NORMAL"),
        ("100-linear", 100, 99, "linear", False, "NORMAL"),
        ("200-linear", 200, 199, "linear", False, "NORMAL"),
        ("201-linear", 201, 200, "linear", False, "BOUNDED_ATLAS"),
        ("300-branch", 300, 299, "branch", False, "BOUNDED_ATLAS"),
        ("300-branch-lowercase", 300, 299, "branch", True, "BOUNDED_ATLAS"),
        ("500-branch", 500, 499, "branch", False, "BOUNDED_ATLAS"),
        ("1000-linear", 1000, 999, "linear", False, "BOUNDED_ATLAS"),
        ("1001-linear", 1001, 1000, "linear", False, "BLOCKED"),
    ]
    for key, resources, connections, topology, lowercase, expected_decision in definitions:
        tables, truth = build_rows(key, resources, connections, topology)
        sheet_names = tuple(name.lower() for name in SHEETS) if lowercase else SHEETS
        remapped = {name: tables[canonical] for name, canonical in zip(sheet_names, SHEETS)}
        payload = xlsx_bytes(remapped, sheet_names)
        filename = f"atlas001-capacity-{key}.xlsx"
        path = args.output_dir / filename
        path.write_bytes(payload)
        cases.append({
            "key": key,
            "path": str(path.relative_to(args.output_dir.parent.parent.parent)),
            "filename": filename,
            "scenarioId": truth["scenarioId"],
            "sourceFormat": "xlsx",
            "mediaType": MIME,
            "byteSize": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "resources": resources,
            "connections": connections,
            "zones": len(truth["zones"]),
            "topology": topology,
            "rawSheets": list(sheet_names),
            "canonicalSheets": list(SHEETS),
            "expectedActivation": expected_decision,
            "resourceIds": truth["resourceIds"],
            "connectionIds": truth["connectionIds"],
            "connectionsTruth": truth["connections"],
            "zoneIds": truth["zones"],
            "resourceIdsSha256": digest_ids(truth["resourceIds"]),
            "connectionIdsSha256": digest_ids(truth["connectionIds"]),
        })
    manifest = {
        "format": "atlas001-import-visualization-capacity-manifest",
        "schemaVersion": "1.0.0",
        "generatedBy": "tests/fixtures/import/generate_atlas001_capacity_fixtures.py",
        "truthIsIndependentOfProductParser": True,
        "cases": cases,
    }
    args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": str(args.manifest), "cases": [{"key": c["key"], "sha256": c["sha256"], "bytes": c["byteSize"]} for c in cases]}, indent=2))


if __name__ == "__main__":
    main()
