#!/usr/bin/env python3
"""Generate independent, deterministic XLSX fixtures for normal-link density.

The package writer and topology generator are test-only code.  They do not
import or call YadiLab's parser, mapper, Builder or layout implementation.
Every connection endpoint receives a distinct source-declared interface, so
parallel/redundant links never rely on invented or reused ports.
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
    rendered: list[str] = []
    for row_number, row in enumerate(rows, 1):
        cells: list[str] = []
        for column_number, value in enumerate(row, 1):
            if value == "":
                continue
            ref = f"{column_name(column_number)}{row_number}"
            cells.append(f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>')
        rendered.append(f'<row r="{row_number}">{"".join(cells)}</row>')
    return '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + "".join(rendered) + "</sheetData></worksheet>"


def xlsx_bytes(tables: dict[str, list[tuple[str, ...]]]) -> bytes:
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
            for index in range(1, len(SHEETS) + 1)
        )
        content_types.append("</Types>")
        write_member(archive, "[Content_Types].xml", "".join(content_types))
        write_member(archive, "_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        sheets = "".join(f'<sheet name={quoteattr(name)} sheetId="{index}" r:id="rId{index}"/>' for index, name in enumerate(SHEETS, 1))
        write_member(archive, "xl/workbook.xml", f'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{sheets}</sheets></workbook>')
        relationships = ['<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
        relationships.extend(f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>' for index in range(1, len(SHEETS) + 1))
        relationships.append("</Relationships>")
        write_member(archive, "xl/_rels/workbook.xml.rels", "".join(relationships))
        for index, sheet in enumerate(SHEETS, 1):
            write_member(archive, f"xl/worksheets/sheet{index}.xml", worksheet_xml(tables[sheet]))
    return output.getvalue()


def resource_id(key: str, index: int) -> str:
    return f"density_{key}_node_{index:04d}"


def connection_id(key: str, index: int) -> str:
    return f"density_{key}_link_{index:04d}"


def add_edge(edges: list[tuple[int, str, int, str]], ports: dict[int, list[str]], source: int, target: int) -> None:
    if source == target:
        raise AssertionError("density fixture cannot contain self-links")
    source_port = f"p{len(ports[source]) + 1:04d}"
    target_port = f"p{len(ports[target]) + 1:04d}"
    ports[source].append(source_port)
    ports[target].append(target_port)
    edges.append((source, source_port, target, target_port))


def build_edges(resources: int, connections: int, topology: str) -> tuple[list[tuple[int, str, int, str]], dict[int, list[str]]]:
    edges: list[tuple[int, str, int, str]] = []
    ports = {index: [] for index in range(1, resources + 1)}

    if topology == "linear":
        for index in range(1, resources):
            add_edge(edges, ports, index, index + 1)
    elif topology == "star":
        # Repeat the spoke set with distinct source ports.  The count is
        # deliberately exact even when it is not a whole multiple of spokes.
        leaf = 2
        while len(edges) < connections:
            add_edge(edges, ports, 1, leaf)
            leaf += 1
            if leaf > resources:
                leaf = 2
    elif topology == "redundant-ring":
        for index in range(1, resources + 1):
            add_edge(edges, ports, index, (index % resources) + 1)
        sequence = 0
        while len(edges) < connections:
            source = (sequence * 17) % resources + 1
            offset = 2 + ((sequence * 31) % max(1, resources - 2))
            target = (source - 1 + offset) % resources + 1
            if source == target:
                target = (target % resources) + 1
            add_edge(edges, ports, source, target)
            sequence += 1
    else:
        raise ValueError(f"unknown density topology: {topology}")

    if len(edges) != connections:
        raise AssertionError(f"generated {len(edges)} links, expected {connections}")
    return edges, ports


def build_fixture(key: str, resources: int, connections: int, topology: str) -> tuple[bytes, dict[str, object]]:
    edges, ports = build_edges(resources, connections, topology)
    zone_count = max(1, min(10, (resources + 9) // 10))
    zones = [("zoneId", "displayName", "kind")]
    zones.extend(
        (f"density_{key}_zone_{zone_index:02d}", f"Density {key} zone {zone_index:02d}", "lan")
        for zone_index in range(1, zone_count + 1)
    )
    nodes = [("nodeId", "displayName", "type", "zoneId")]
    interfaces = [("nodeId", "interfaceId", "name")]
    links = [("linkId", "nodeA", "interfaceA", "nodeB", "interfaceB", "kind")]
    layout = [("nodeId", "rank")]
    for index in range(1, resources + 1):
        identifier = resource_id(key, index)
        zone_id = zones[1 + ((index - 1) * zone_count) // resources][0]
        nodes.append((identifier, f"Density {key} device {index:04d}", "network.switch" if index == 1 else "endpoint.windows", zone_id))
        for port in ports[index]:
            interfaces.append((identifier, port, port))
        layout.append((identifier, str(index)))
    truth: list[dict[str, str]] = []
    for sequence, (source, source_port, target, target_port) in enumerate(edges, 1):
        identifier = connection_id(key, sequence)
        links.append((identifier, resource_id(key, source), source_port, resource_id(key, target), target_port, "network"))
        truth.append({"id": identifier, "from": resource_id(key, source), "fromPort": source_port, "to": resource_id(key, target), "toPort": target_port})
    metadata = [
        ("schemaVersion", "scenarioId", "title", "description"),
        ("1.0.0", f"atlas001_normal_density_{key}", f"ATLAS-001 normal density {key}", "Deterministic synthetic fixture; no real network data."),
    ]
    tables = {"Metadata": metadata, "Zones": zones, "Nodes": nodes, "Interfaces": interfaces, "Links": links, "Layout": layout}
    payload = xlsx_bytes(tables)
    resource_ids = [resource_id(key, index) for index in range(1, resources + 1)]
    connection_ids = [connection_id(key, index) for index in range(1, connections + 1)]
    digest = lambda values: hashlib.sha256(json.dumps(values, separators=(",", ":")).encode()).hexdigest()
    manifest = {
        "key": key,
        "scenarioId": f"atlas001_normal_density_{key}",
        "filename": f"atlas001-normal-density-{key}.xlsx",
        "sourceFormat": "xlsx",
        "mediaType": MIME,
        "resources": resources,
        "connections": connections,
        "topology": topology,
        "expectedActivation": "NORMAL",
        "resourceIds": resource_ids,
        "connectionIds": connection_ids,
        "connectionsTruth": truth,
        "zoneIds": [row[0] for row in zones[1:]],
        "resourceIdsSha256": digest(resource_ids),
        "connectionIdsSha256": digest(connection_ids),
        "portsPerResource": {identifier: len(values) for identifier, values in ((resource_id(key, index), ports[index]) for index in range(1, resources + 1))},
        "sha256": hashlib.sha256(payload).hexdigest(),
        "byteSize": len(payload),
    }
    return payload, manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    definitions = (
        ("50-linear", 50, 49, "linear"),
        ("50-star", 50, 150, "star"),
        ("50-redundant", 50, 400, "redundant-ring"),
        ("100-linear", 100, 99, "linear"),
        ("100-star", 100, 300, "star"),
        ("100-redundant", 100, 800, "redundant-ring"),
        ("200-linear", 200, 199, "linear"),
        ("200-star", 200, 600, "star"),
        ("200-redundant", 200, 1600, "redundant-ring"),
    )
    cases: list[dict[str, object]] = []
    for key, resources, connections, topology in definitions:
        payload, manifest = build_fixture(key, resources, connections, topology)
        path = args.output_dir / manifest["filename"]
        path.write_bytes(payload)
        cases.append({"path": str(path.relative_to(args.output_dir.parent.parent.parent)), **manifest})
    output = {
        "format": "atlas001-normal-connection-density-manifest",
        "schemaVersion": "1.0.0",
        "truthIsIndependentOfProductParser": True,
        "testPointsAreMeasurementsNotPermanentLimits": True,
        "cases": cases,
    }
    args.manifest.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"manifest": str(args.manifest), "cases": [{"key": item["key"], "resources": item["resources"], "connections": item["connections"], "sha256": item["sha256"]} for item in cases]}, indent=2))


if __name__ == "__main__":
    main()
