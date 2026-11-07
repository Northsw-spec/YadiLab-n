#!/usr/bin/env python3
"""P2c2: independent deterministic *test fixture* ZIPs, never production XLSX/ODS writers.

Valid six-tab consulting inventory; variants exercise strict source parser denial.
No third-party dependencies, network I/O, formula execution or embedded code.
"""
from __future__ import annotations
import argparse
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED, ZIP_STORED

SHEETS = ["Metadata", "Zones", "Nodes", "Interfaces", "Links", "Layout"]
NODES = [
    ("rtr01", "Core edge router", "network.router", "mgmt", "10.41.0.254"),
    ("sw01", "Corporate switch", "network.switch", "corp", ""),
    ("sw02", "Server switch", "network.switch", "server", ""),
    ("win01", "Office Windows", "endpoint.windows", "corp", "10.41.10.254"),
    ("win02", "Support Windows", "endpoint.windows", "corp", ""),
    ("lin01", "Linux API", "endpoint.linux", "server", "10.41.20.254"),
    ("lin02", "Linux backup", "endpoint.linux", "server", ""),
    ("unknown01", "Unclassified archive", "resource.generic", "server", "10.41.20.254"),
]
INTERFACES = [
    ("rtr01", "lan0", "lan0", "10.41.0.1", "24", "1500"),
    ("sw01", "uplink0", "uplink0", "10.41.0.2", "24", "1500"),
    ("sw01", "port1", "port1", "", "", "1500"),
    ("sw01", "port2", "port2", "", "", "1500"),
    ("sw01", "port3", "port3", "", "", "1500"),
    ("sw02", "uplink0", "uplink0", "10.41.20.2", "24", "1500"),
    ("sw02", "port1", "port1", "", "", "1500"),
    ("sw02", "port2", "port2", "", "", "1500"),
    ("win01", "eth0", "eth0", "10.41.10.11", "24", "1500"),
    ("win02", "eth0", "eth0", "10.41.10.12", "24", "1500"),
    ("lin01", "eth0", "eth0", "10.41.20.11", "24", "1500"),
    ("lin02", "eth0", "eth0", "10.41.20.12", "24", "1500"),
]
LINKS = [
    ("edge_to_corp", "rtr01", "lan0", "sw01", "uplink0", "network"),
    ("corp_to_server", "sw01", "port1", "sw02", "uplink0", "network"),
    ("corp_to_win01", "sw01", "port2", "win01", "eth0", "network"),
    ("corp_to_win02", "sw01", "port3", "win02", "eth0", "network"),
    ("server_to_lin01", "sw02", "port1", "lin01", "eth0", "network"),
    ("server_to_lin02", "sw02", "port2", "lin02", "eth0", "network"),
]
EXPECTED_EDGES = [(a, b, c, d) for _,a,b,c,d,_ in LINKS]


def dataset(variant="valid"):
    if variant not in ("valid", "missing-port", "duplicate-interface", "missing-node"):
        raise ValueError("unsupported test-only variant")
    data = {
        "Metadata": [
            ("schemaVersion", "scenarioId", "title"),
            ("1.0.0", "imported_network", "Consultant six-sheet enterprise inventory"),
        ],
        "Zones": [
            ("zoneId", "displayName", "kind"),
            ("mgmt", "Management", "management"),
            ("corp", "Corporate LAN", "lan"),
            ("server", "Server estate", "server"),
        ],
        "Nodes": [
            ("nodeId", "displayName", "type", "zoneId", "gateway"),
            *NODES,
        ],
        "Interfaces": [
            ("nodeId", "interfaceId", "name", "IPv4", "prefix", "MTU"),
            *INTERFACES,
        ],
        "Links": [
            ("linkId", "nodeA", "interfaceA", "nodeB", "interfaceB", "kind"),
            *LINKS,
        ],
        "Layout": [
            ("nodeId", "rank"),
            *((node[0], str(i)) for i,node in enumerate(NODES)),
        ],
    }
    if variant == "missing-port":
        rows=list(data["Links"])
        row=list(rows[3]);row[2]="not_declared_port";rows[3]=tuple(row)
        data["Links"]=rows
    elif variant == "duplicate-interface":
        data["Interfaces"]=[*data["Interfaces"],("win01","eth0","eth0","10.41.10.99","24","1500")]
    elif variant == "missing-node":
        rows=list(data["Links"]);row=list(rows[2]);row[3]="absent_node";rows[2]=tuple(row);data["Links"]=rows
    return data


def write_zip(z, path, value, compression=ZIP_DEFLATED):
    info=ZipInfo(path, date_time=(2020,1,1,0,0,0))
    info.compress_type=compression
    info.create_system=3
    info.external_attr=0o600 << 16
    z.writestr(info, value)


def xmlrows(rows):
    out=[]
    for number,row in enumerate(rows,1):
        cells=[]
        for col,value in enumerate(row,1):
            if value == "":
                continue
            letters="";i=col
            while i:
                i,rem=divmod(i-1,26)
                letters=chr(65+rem)+letters
            cells.append('<c r="'+letters+str(number)+'" t="inlineStr"><is><t>'+
                         escape(str(value))+'</t></is></c>')
        out.append('<row r="'+str(number)+'">'+''.join(cells)+'</row>')
    return '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+''.join(out)+'</sheetData></worksheet>'


def xlsx_bytes(variant="valid", tables_override=None):
    tables=dataset(variant) if tables_override is None else tables_override
    names=list(tables) if tables_override is not None else SHEETS
    out=BytesIO()
    with ZipFile(out,"w") as z:
        types=['<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
         '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
         '<Default Extension="xml" ContentType="application/xml"/>',
         '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>']
        for i in range(1,len(names)+1):
            types.append(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
        types.append("</Types>")
        write_zip(z,"[Content_Types].xml","".join(types))
        write_zip(z,"_rels/.rels",
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        workbook=[
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
        ]
        rels=['<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
        for i,name in enumerate(names,1):
            workbook.append(f'<sheet name={quoteattr(name)} sheetId="{i}" r:id="rId{i}"/>')
            rels.append('<Relationship Id="rId'+str(i)+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+str(i)+'.xml"/>')
        workbook.append("</sheets></workbook>");rels.append("</Relationships>")
        write_zip(z,"xl/workbook.xml","".join(workbook))
        write_zip(z,"xl/_rels/workbook.xml.rels","".join(rels))
        for i,name in enumerate(names,1):
            write_zip(z,f"xl/worksheets/sheet{i}.xml",xmlrows(tables[name]))
    return out.getvalue()


def ods_bytes(variant="valid", tables_override=None):
    tables=dataset(variant) if tables_override is None else tables_override
    names=list(tables) if tables_override is not None else SHEETS
    content=[
      '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"><office:body><office:spreadsheet>'
    ]
    for name in names:
        content.append('<table:table table:name='+quoteattr(name)+'>')
        for row in tables[name]:
            content.append("<table:table-row>")
            for val in row:
                if val=="":
                    content.append("<table:table-cell/>")
                else:
                    content.append('<table:table-cell office:value-type="string"><text:p>'+escape(str(val))+'</text:p></table:table-cell>')
            content.append("</table:table-row>")
        content.append("</table:table>")
    content.append("</office:spreadsheet></office:body></office:document-content>")
    out=BytesIO()
    with ZipFile(out,"w") as z:
        write_zip(z,"mimetype","application/vnd.oasis.opendocument.spreadsheet",ZIP_STORED)
        write_zip(z,"META-INF/manifest.xml",
          '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>')
        write_zip(z,"content.xml","".join(content))
    return out.getvalue()


def build_flat(fmt, rows):
    """P2c5 test-only true single-Devices-sheet Office archive producer."""
    tables={"Devices":rows}
    if fmt=="xlsx":
        return xlsx_bytes(tables_override=tables)
    if fmt=="ods":
        return ods_bytes(tables_override=tables)
    raise ValueError("unsupported format")

def build(fmt="xlsx",variant="valid"):
    return xlsx_bytes(variant) if fmt=="xlsx" else ods_bytes(variant) if fmt=="ods" else None


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--out-dir",type=Path,required=True)
    a=p.parse_args()
    a.out_dir.mkdir(parents=True,exist_ok=True)
    for fmt in ("xlsx","ods"):
        for variant in ("valid","missing-port","duplicate-interface","missing-node"):
            output=a.out_dir/("ic020-p2c2-"+variant+"."+fmt)
            output.write_bytes(build(fmt,variant))
            print(output.name,len(output.read_bytes()))

if __name__=="__main__": main()
