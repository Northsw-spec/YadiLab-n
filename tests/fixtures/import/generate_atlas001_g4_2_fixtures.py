#!/usr/bin/env python3
"""Generate deterministic valid canonical XLSX fixtures for ATLAS-001 G4.2."""
from __future__ import annotations

import argparse
import hashlib
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
from xml.sax.saxutils import escape, quoteattr

SHEETS = ["Metadata", "Zones", "Nodes", "Interfaces", "Links", "Layout"]


def column_name(index: int) -> str:
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def worksheet_xml(table: list[tuple[str, ...]]) -> str:
    rows = []
    for row_number, row in enumerate(table, 1):
        cells = []
        for column_number, value in enumerate(row, 1):
            if value == "":
                continue
            cell_ref = f"{column_name(column_number)}{row_number}"
            cells.append(f'<c r="{cell_ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>')
        rows.append(f'<row r="{row_number}">{"".join(cells)}</row>')
    return '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + "".join(rows) + "</sheetData></worksheet>"


def write_zip(archive: ZipFile, path: str, value: str) -> None:
    archive.writestr(path, value)


def xlsx_bytes(resources: int, connections: int, prefix: str, scenario: str) -> bytes:
    node_id = lambda index: f"{prefix}_device_{index:04d}"
    link_id = lambda index: f"{prefix}_link_{index:04d}"
    zone_id = f"{prefix}_zone"
    tables: dict[str, list[tuple[str, ...]]] = {
        "Metadata": [("schemaVersion", "scenarioId", "title", "description"), ("1.0.0", scenario, "ATLAS-001 G4.2 fixture", "Canonical fail-closed activation fixture.")],
        "Zones": [("zoneId", "displayName", "kind"), (zone_id, "Fixture zone", "lan")],
        "Nodes": [("nodeId", "displayName", "type", "zoneId")],
        "Interfaces": [("nodeId", "interfaceId", "name")],
        "Links": [("linkId", "nodeA", "interfaceA", "nodeB", "interfaceB", "kind")],
        "Layout": [("nodeId", "rank")],
    }
    for index in range(1, resources + 1):
        node = node_id(index)
        tables["Nodes"].append((node, f"Fixture device {index:04d}", "endpoint.windows" if index % 7 else "network.switch", zone_id))
        tables["Interfaces"].extend(((node, "left", "left"), (node, "right", "right")))
        tables["Layout"].append((node, str(index)))
    for index in range(1, connections + 1):
        left = ((index - 1) % max(1, resources - 1)) + 1
        right = (index % max(1, resources - 1)) + 1
        tables["Links"].append((link_id(index), node_id(left), "right", node_id(right), "left", "network"))
    output = BytesIO()
    with ZipFile(output, "w") as archive:
        write_zip(archive, "[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, 7)) + "</Types>")
        write_zip(archive, "_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        sheets = "".join(f'<sheet name={quoteattr(name)} sheetId="{i}" r:id="rId{i}"/>' for i, name in enumerate(SHEETS, 1))
        write_zip(archive, "xl/workbook.xml", f'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{sheets}</sheets></workbook>')
        write_zip(archive, "xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, 7)) + "</Relationships>")
        for index, name in enumerate(SHEETS, 1):
            write_zip(archive, f"xl/worksheets/sheet{index}.xml", worksheet_xml(tables[name]))
    return output.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resources", type=int, required=True)
    parser.add_argument("--connections", type=int, required=True)
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--scenario", required=True)
    args = parser.parse_args()
    payload = xlsx_bytes(args.resources, args.connections, args.prefix, args.scenario)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(payload)
    print(f"resources={args.resources} connections={args.connections} sha256={hashlib.sha256(payload).hexdigest()} bytes={len(payload)} path={args.output}")


if __name__ == "__main__":
    main()
