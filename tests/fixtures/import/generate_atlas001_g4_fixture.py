#!/usr/bin/env python3
"""Generate the deterministic ATLAS-001 G4 synthetic XLSX fixture.

This is test data, not a production workbook writer.  The fixture uses the
already-supported canonical six-sheet profile and contains exactly 500
resources and 499 explicitly declared endpoint links.
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
LINK_COUNT = RESOURCE_COUNT - 1


def rows() -> dict[str, list[tuple[str, ...]]]:
    nodes = [("nodeId", "displayName", "type", "zoneId")]
    interfaces = [("nodeId", "interfaceId", "name")]
    links = [("linkId", "nodeA", "interfaceA", "nodeB", "interfaceB", "kind")]
    zones = [("zoneId", "displayName", "kind")]
    layout = [("nodeId", "rank")]
    for zone_index in range(10):
        zone_id = f"g4_zone_{zone_index + 1:02d}"
        zones.append((zone_id, f"G4 zone {zone_index + 1}", "lan"))
    for index in range(RESOURCE_COUNT):
        node_id = f"g4_node_{index + 1:03d}"
        zone_id = f"g4_zone_{index // 50 + 1:02d}"
        kind = "network.switch" if index % 10 == 0 else "endpoint.linux"
        nodes.append((node_id, f"G4 synthetic device {index + 1:03d}", kind, zone_id))
        if index > 0:
            interfaces.append((node_id, "left", "left"))
        if index < RESOURCE_COUNT - 1:
            interfaces.append((node_id, "right", "right"))
        layout.append((node_id, str(index)))
    for index in range(LINK_COUNT):
        left = f"g4_node_{index + 1:03d}"
        right = f"g4_node_{index + 2:03d}"
        links.append((f"g4_link_{index + 1:03d}", left, "right", right, "left", "network"))
    metadata = [
        ("schemaVersion", "scenarioId", "title", "description"),
        ("1.0.0", "atlas_g4_synthetic_500", "ATLAS-001 G4 synthetic fixture", "Synthetic test data only; no real enterprise network."),
    ]
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
    value = index
    while value:
        value, remainder = divmod(value - 1, 26)
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
        types = [
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '<Default Extension="xml" ContentType="application/xml"/>',
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        ]
        for index in range(1, len(SHEETS) + 1):
            types.append(f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
        types.append("</Types>")
        write_zip(archive, "[Content_Types].xml", "".join(types))
        write_zip(archive, "_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        sheets = "".join(f'<sheet name={quoteattr(name)} sheetId="{index}" r:id="rId{index}"/>' for index, name in enumerate(SHEETS, 1))
        write_zip(archive, "xl/workbook.xml", f'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{sheets}</sheets></workbook>')
        relationships = ['<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
        for index in range(1, len(SHEETS) + 1):
            relationships.append(f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>')
        relationships.append("</Relationships>")
        write_zip(archive, "xl/_rels/workbook.xml.rels", "".join(relationships))
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
    print(f"synthetic-xlsx-fixture resources={RESOURCE_COUNT} links={LINK_COUNT} sha256={hashlib.sha256(payload).hexdigest()} bytes={len(payload)} path={args.output}")


if __name__ == "__main__":
    main()
