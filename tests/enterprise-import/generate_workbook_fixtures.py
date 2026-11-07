from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED, ZIP_STORED
from xml.sax.saxutils import escape

OUT=Path(__file__).resolve().parents[1]/'fixtures'/'workbooks'
OUT.mkdir(parents=True,exist_ok=True)

CONTENT_TYPES='''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
 <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
 <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>'''
ROOT_RELS='''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>'''
WORKBOOK='''<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <sheets><sheet name="Devices" sheetId="1" r:id="rId1"/><sheet name="Metadata" sheetId="2" r:id="rId2"/></sheets>
</workbook>'''
WORKBOOK_RELS='''<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>'''

def inline(ref,value):
    return f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
def number(ref,value):
    return f'<c r="{ref}"><v>{value}</v></c>'
def formula_str(ref,formula,cached):
    return f'<c r="{ref}" t="str"><f>{escape(formula)}</f><v>{escape(cached)}</v></c>'

def sheet_xml(rows):
    parts=['<?xml version="1.0" encoding="UTF-8"?>','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    for r,cells in rows:
        parts.append(f'<row r="{r}">'+''.join(cells)+'</row>')
    parts.append('</sheetData></worksheet>')
    return ''.join(parts)

headers=['Asset ID','Hostname','IP Address','Default Gateway','OS','Notes']
row1=[inline(f'{chr(65+i)}1',h) for i,h in enumerate(headers)]
row2=[inline('A2','pc01'),inline('B2','PC-01'),inline('C2','10.20.30.44'),inline('D2','10.20.30.1'),inline('E2','Windows 11'),inline('F2','Primary user client')]
row3=[inline('A3','pc02'),formula_str('B3','"PC-02"','PC-02'),inline('C3','10.20.30.45'),inline('E3','Windows 11'),inline('F3','Gateway intentionally undocumented')]
SHEET1=sheet_xml([(1,row1),(2,row2),(3,row3)])
SHEET2=sheet_xml([(1,[inline('A1','Key'),inline('B1','Value')]),(2,[inline('A2','Owner'),inline('B2','Example')])])

def xlsx(path, *, external=False, macro=False, dtd=False, title_row=False, duplicate=False):
    wb=WORKBOOK
    rels=WORKBOOK_RELS
    if external:
        rels=rels.replace('</Relationships>','<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="https://example.invalid/book.xlsx" TargetMode="External"/></Relationships>')
    s1=SHEET1
    if title_row:
        s1=sheet_xml([(1,[inline('A1','Customer inventory')]),(2,[inline(f'{chr(65+i)}2',h) for i,h in enumerate(headers)]),(3,[inline('A3','pc01'),inline('B3','PC-01'),inline('C3','10.20.30.44'),inline('D3','10.20.30.1'),inline('E3','Windows 11')])])
    if dtd:
        s1='<?xml version="1.0"?><!DOCTYPE worksheet [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>&xxe;</t></is></c></row></sheetData></worksheet>'
    with ZipFile(path,'w',ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',CONTENT_TYPES)
        z.writestr('_rels/.rels',ROOT_RELS)
        z.writestr('xl/workbook.xml',wb)
        z.writestr('xl/_rels/workbook.xml.rels',rels)
        z.writestr('xl/worksheets/sheet1.xml',s1)
        z.writestr('xl/worksheets/sheet2.xml',SHEET2)
        if macro: z.writestr('xl/vbaProject.bin',b'not executed')
        if duplicate: z.writestr('xl/worksheets/sheet2.xml',SHEET2)

xlsx(OUT/'devices.xlsx')
xlsx(OUT/'devices-title-row.xlsx',title_row=True)
xlsx(OUT/'xlsx-external-link.xlsx',external=True)
xlsx(OUT/'xlsx-macro.xlsx',macro=True)
xlsx(OUT/'xlsx-dtd.xlsx',dtd=True)
xlsx(OUT/'xlsx-duplicate-entry.xlsx',duplicate=True)

ODS_MIME='application/vnd.oasis.opendocument.spreadsheet'
ODS_MANIFEST='''<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
 <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
 <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
</manifest:manifest>'''

def ods_content(*, external=False, hyperlink=False, formula=True, huge_repeat=False):
    href='<text:a xlink:href="https://example.invalid/">remote</text:a>' if hyperlink else 'local'
    table_source='<table:table-source xlink:href="https://example.invalid/data.ods"/>' if external else ''
    formula_attr=' table:formula="of:=CONCATENATE(&quot;PC-&quot;;&quot;02&quot;)" office:string-value="PC-02"' if formula else ' office:string-value="PC-02"'
    repeat=' table:number-columns-repeated="20000"' if huge_repeat else ''
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink">
<office:body><office:spreadsheet>
<table:table table:name="Devices">{table_source}
 <table:table-row><table:table-cell office:value-type="string"><text:p>Asset ID</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Hostname</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>IP Address</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Default Gateway</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>OS</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Notes</text:p></table:table-cell></table:table-row>
 <table:table-row><table:table-cell office:value-type="string"><text:p>pc01</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>PC-01</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>10.20.30.44</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>10.20.30.1</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Windows 11</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>{href}</text:p></table:table-cell></table:table-row>
 <table:table-row><table:table-cell office:value-type="string"><text:p>pc02</text:p></table:table-cell><table:table-cell office:value-type="string"{formula_attr}><text:p>PC-02</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>10.20.30.45</text:p></table:table-cell><table:table-cell/><table:table-cell office:value-type="string"><text:p>Windows 11</text:p></table:table-cell><table:table-cell office:value-type="string"{repeat}><text:p>repeat</text:p></table:table-cell></table:table-row>
</table:table>
<table:table table:name="Metadata"><table:table-row><table:table-cell office:value-type="string"><text:p>Key</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Value</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell office:value-type="string"><text:p>Owner</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Example</text:p></table:table-cell></table:table-row></table:table>
</office:spreadsheet></office:body></office:document-content>'''

def ods(path, *, external=False, hyperlink=False, scripts=False, encrypted=False, dtd=False, huge_repeat=False):
    content=ods_content(external=external, hyperlink=hyperlink, huge_repeat=huge_repeat)
    if dtd: content='<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'+content.split('?>',1)[1]
    manifest=ODS_MANIFEST
    if encrypted:
        manifest='''<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"><manifest:encryption-data/></manifest:file-entry></manifest:manifest>'''
    with ZipFile(path,'w') as z:
        z.writestr('mimetype',ODS_MIME,compress_type=ZIP_STORED)
        z.writestr('META-INF/manifest.xml',manifest,compress_type=ZIP_DEFLATED)
        z.writestr('content.xml',content,compress_type=ZIP_DEFLATED)
        if scripts: z.writestr('Basic/Standard/Module1.xml','<module/>',compress_type=ZIP_DEFLATED)

ods(OUT/'devices.ods')
ods(OUT/'ods-external-link.ods',external=True)
ods(OUT/'ods-hyperlink.ods',hyperlink=True)
ods(OUT/'ods-scripts.ods',scripts=True)
ods(OUT/'ods-encrypted.ods',encrypted=True)
ods(OUT/'ods-dtd.ods',dtd=True)
ods(OUT/'ods-huge-repeat.ods',huge_repeat=True)
print('generated', len(list(OUT.iterdir())), 'workbook fixtures')
