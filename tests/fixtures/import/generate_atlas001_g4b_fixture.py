#!/usr/bin/env python3
"""Generate an independent, structurally different ATLAS-001 G4.1 fixture.

The workbook intentionally keeps the supported canonical six-sheet contract
while changing the source identity, IDs, zoning, link count and topology:
parallel links, crossing zone links, an ungrouped set and a disconnected
component are all represented by explicit source rows.
"""
from __future__ import annotations

import argparse
import hashlib
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo
from xml.sax.saxutils import escape, quoteattr

SHEETS = ["Metadata", "Zones", "Nodes", "Interfaces", "Links", "Layout"]
RESOURCE_COUNT = 500


def node_id(index: int) -> str:
    return f"b4_device_{index:03d}"


def link_id(index: int) -> str:
    return f"b4_link_{index:03d}"


def rows() -> dict[str, list[tuple[str, ...]]]:
    nodes = [("nodeId", "displayName", "type", "zoneId")]
    interfaces = [("nodeId", "interfaceId", "name")]
    links = [("linkId", "nodeA", "interfaceA", "nodeB", "interfaceB", "kind")]
    zones = [("zoneId", "displayName", "kind")]
    layout = [("nodeId", "rank")]
    zone_ranges = (("b4_zone_north", 1, 120), ("b4_zone_core", 121, 260),
                   ("b4_zone_edge", 261, 480), ("b4_zone_remote", 491, 500))
    for zone_id, first, last in zone_ranges:
        zones.append((zone_id, zone_id.replace("b4_", "").replace("_", " ").title(), "lan"))
    for index in range(1, RESOURCE_COUNT + 1):
        zone = next((zone_id for zone_id, first, last in zone_ranges if first <= index <= last), "")
        kind = "network.router" if index in (1, 121, 261, 491) else ("network.switch" if index % 11 == 0 else "endpoint.windows")
        nodes.append((node_id(index), f"Independent B device {index:03d}", kind, zone))
        interfaces.extend(((node_id(index), "left", "left"), (node_id(index), "right", "right")))
        if index in (1, 2, 491, 492):
            interfaces.extend(((node_id(index), "left2", "parallel-left"), (node_id(index), "right2", "parallel-right")))
        layout.append((node_id(index), str((index * 17) % 503)))

    sequence = 1
    # Main connected component (with natural crossing links at zone boundaries).
    for index in range(1, 490):
        links.append((link_id(sequence), node_id(index), "right", node_id(index + 1), "left", "network"))
        sequence += 1
    # Separate disconnected component.
    for index in range(491, 500):
        links.append((link_id(sequence), node_id(index), "right", node_id(index + 1), "left", "network"))
        sequence += 1
    # Two explicitly declared parallel physical links with distinct ports.
    links.append((link_id(sequence), node_id(1), "right2", node_id(2), "left2", "network"))
    sequence += 1
    links.append((link_id(sequence), node_id(491), "right2", node_id(492), "left2", "network"))
    metadata = [("schemaVersion", "scenarioId", "title", "description"),
                ("1.0.0", "atlas_g4_b_synthetic_500", "ATLAS-001 G4.1 independent fixture",
                 "Independent synthetic validation source with explicit disconnected and parallel topology.")]
    return {"Metadata": metadata, "Zones": zones, "Nodes": nodes,
            "Interfaces": interfaces, "Links": links, "Layout": layout}


def write_zip(z: ZipFile, path: str, value: str) -> None:
    info = ZipInfo(path, date_time=(2020, 1, 1, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o600 << 16
    z.writestr(info, value)


def column_name(index: int) -> str:
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def worksheet_xml(table: list[tuple[str, ...]]) -> str:
    rendered = []
    for row_number, row in enumerate(table, 1):
        cells = []
        for column_number, value in enumerate(row, 1):
            if value == "":
                continue
            cell_ref = f"{column_name(column_number)}{row_number}"
            cells.append(f'<c r="{cell_ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>')
        rendered.append(f'<row r="{row_number}">{"".join(cells)}</row>')
    return '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + "".join(rendered) + "</sheetData></worksheet>"


def xlsx_bytes() -> bytes:
    tables = rows()
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        types = ['<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
                 '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
                 '<Default Extension="xml" ContentType="application/xml"/>',
                 '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>']
        types.extend(f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for index in range(1, len(SHEETS) + 1))
        types.append("</Types>")
        write_zip(archive, "[Content_Types].xml", "".join(types))
        write_zip(archive, "_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        sheets = "".join(f'<sheet name={quoteattr(name)} sheetId="{index}" r:id="rId{index}"/>' for index, name in enumerate(SHEETS, 1))
        write_zip(archive, "xl/workbook.xml", f'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{sheets}</sheets></workbook>')
        relationships = ['<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
        relationships.extend(f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>' for index in range(1, len(SHEETS) + 1))
        relationships.append("</Relationships>")
        write_zip(archive, "xl/_rels/workbook.xml.rels", "".join(relationships))
        tables = rows()
        for index, name in enumerate(SHEETS, 1):
            write_zip(archive, f"xl/worksheets/sheet{index}.xml", worksheet_xml(tables[name]))
    return output.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    payload = xlsx_bytes()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(payload)
    print(f"synthetic-xlsx-fixture resources={RESOURCE_COUNT} links=500 sha256={hashlib.sha256(payload).hexdigest()} bytes={len(payload)} path={args.output}")


if __name__ == "__main__":
    main()
