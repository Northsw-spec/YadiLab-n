import { EnterpriseImportError } from "./types.js";
import { webCryptoImportHashProvider } from "./hash.js";
import { openSafeWorkbookArchive, productionWorkbookArchiveBackend, type WorkbookArchiveLimits } from "./workbook-archive.js";
import { attr, childElements, descendants, firstChild, parseSafeXml, parseSafeXmlOfficeS3, type XmlNode } from "./xml-lite.js";

export const DOCX_TABLES_PROFILE = "office.docx-tables.structural.v1" as const;
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OPC_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OPC_TYPES_NS = "http://schemas.openxmlformats.org/package/2006/content-types";
const OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
const WORD_MAIN = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const LIMITS: WorkbookArchiveLimits = {
  maxFiles: 128, maxCompressedBytes: 16 * 1024 * 1024,
  maxDecompressedBytes: 32 * 1024 * 1024,
  maxSingleFileBytes: 4 * 1024 * 1024, maxCompressionRatio: 100,
};
// This larger byte budget is ONLY granted by the explicit S2 structural v2
// decision. Default/v1, compression-ratio and active-content denials persist.
const LIMITS_S2: WorkbookArchiveLimits = {
  ...LIMITS, maxDecompressedBytes: 64 * 1024 * 1024,
  maxSingleFileBytes: 8 * 1024 * 1024,
};
// P4c1: versioned structural-only 10k budget; existing ZIP bomb limits remain.
const LIMITS_S3: WorkbookArchiveLimits = {
  ...LIMITS_S2, maxDecompressedBytes: 96 * 1024 * 1024,
  maxSingleFileBytes: 16 * 1024 * 1024,
};

function fail(code: string): never { throw new EnterpriseImportError(code, code); }
/** SCALE-001 P1a opt-in; never an import/approval or Engine capability. */
export const SCALE_OFFICE_LARGE_STRUCTURE_PROFILE = "office.scaled-structural-review.v1" as const;
/** S2/P3a: separate opted-in 5000-row structural preview, never disclosure. */
export const SCALE_OFFICE_S2_STRUCTURE_PROFILE = "office.scaled-structural-review.v2" as const;
/** P4c1 explicit 10k structure only: never grants source-cell disclosure. */
export const SCALE_OFFICE_S3_STRUCTURE_PROFILE = "office.scaled-structural-review.v3" as const;
export interface OfficeLargeStructureDecision {
  readonly capacityProfile:
    typeof SCALE_OFFICE_LARGE_STRUCTURE_PROFILE |
    typeof SCALE_OFFICE_S2_STRUCTURE_PROFILE |
    typeof SCALE_OFFICE_S3_STRUCTURE_PROFILE;
}
function acceptLargeCapacity(decision: OfficeLargeStructureDecision | undefined):
  "default" | "v1" | "v2" | "v3" {
  if (decision === undefined) return "default";
  if (!decision || typeof decision !== "object" || Array.isArray(decision) ||
      Object.keys(decision).length !== 1 ||
      (decision.capacityProfile !== SCALE_OFFICE_LARGE_STRUCTURE_PROFILE &&
       decision.capacityProfile !== SCALE_OFFICE_S2_STRUCTURE_PROFILE &&
       decision.capacityProfile !== SCALE_OFFICE_S3_STRUCTURE_PROFILE)) {
    fail("SCALE_P1A_CAPACITY_PROFILE_INVALID");
  }
  return decision.capacityProfile === SCALE_OFFICE_S3_STRUCTURE_PROFILE ? "v3"
    : decision.capacityProfile === SCALE_OFFICE_S2_STRUCTURE_PROFILE ? "v2" : "v1";
}

function tag(node: XmlNode, wanted: string): boolean { return node.name === "w:" + wanted; }
function only(node: XmlNode, allowed: readonly string[]): void {
  for (const item of node.children) if (!allowed.some((name) => tag(item, name))) fail("DOCX_UNSUPPORTED_CELL_MARKUP");
}
function namespace(root: XmlNode, tagName: string, attribute: string, expected: string): void {
  if (root.name !== tagName || root.attributes[attribute] !== expected) fail("DOCX_UNSUPPORTED_NAMESPACE");
}
function assertNoNamespaceRedefinition(root: XmlNode): void {
  for (const node of [root, ...descendants(root, "body"), ...descendants(root, "tbl"),
    ...descendants(root, "tr"), ...descendants(root, "tc"), ...descendants(root, "p"), ...descendants(root, "r"),
    ...descendants(root, "t")]) {
    if (node !== root && Object.keys(node.attributes).some((k) => k.startsWith("xmlns:") || k === "xmlns")) {
      fail("DOCX_NAMESPACE_REDECLARATION");
    }
  }
}
function rejectUnsupportedDocument(root: XmlNode): void {
  const forbidden = ["altChunk", "fldSimple", "instrText", "delText", "ins", "del",
    "drawing", "object", "pict", "sdt", "txbxContent", "hyperlink", "gridSpan", "vMerge",
    "smartTag", "subDoc", "customXml", "commentRangeStart", "commentRangeEnd"];
  for (const name of forbidden) if (descendants(root, name).length) fail("DOCX_UNSUPPORTED_DOCUMENT_FEATURE");
  assertNoNamespaceRedefinition(root);
}
function cellTextLength(cell: XmlNode): number {
  const allowedCells = ["tcPr", "p"];
  const allowedParagraph = ["pPr", "r"];
  const allowedRun = ["rPr", "t"];
  only(cell, allowedCells);
  let length = 0;
  for (const p of childElements(cell, "p")) {
    if (!tag(p, "p")) fail("DOCX_UNSUPPORTED_CELL_MARKUP");
    only(p, allowedParagraph);
    for (const run of childElements(p, "r")) {
      if (!tag(run, "r")) fail("DOCX_UNSUPPORTED_CELL_MARKUP");
      only(run, allowedRun);
      for (const text of childElements(run, "t")) {
        if (!tag(text, "t") || text.children.length !== 0) fail("DOCX_UNSUPPORTED_CELL_MARKUP");
        length += text.text.length;
        if (length > 4096) fail("DOCX_CELL_TEXT_TOO_LARGE");
      }
    }
  }
  return length;
}

export interface DocxTableCellLocator {
  readonly kind: "docx-table-cell";
  readonly sourceSha256: string;
  readonly part: "word/document.xml";
  readonly tableOrdinal: number;
  readonly rowOrdinal: number;
  readonly cellOrdinal: number;
}
export interface DocxTableCellStructural {
  readonly cellOrdinal: number;
  readonly textCodeUnits: number;
  readonly locator: DocxTableCellLocator;
}
export interface DocxTableRowStructural {
  readonly rowOrdinal: number;
  readonly cells: readonly DocxTableCellStructural[];
}
export interface DocxTableStructural {
  readonly tableOrdinal: number;
  readonly rows: readonly DocxTableRowStructural[];
}
export interface DocxStructuralPreview {
  readonly profileId: typeof DOCX_TABLES_PROFILE;
  readonly capacityProfile?: typeof SCALE_OFFICE_LARGE_STRUCTURE_PROFILE |
    typeof SCALE_OFFICE_S2_STRUCTURE_PROFILE |
    typeof SCALE_OFFICE_S3_STRUCTURE_PROFILE;
  readonly status: "REVIEW_REQUIRED";
  readonly semanticTrack: "CONFIG_DOCUMENTED";
  readonly canActivate: false;
  readonly sourceSha256: string;
  readonly tables: readonly DocxTableStructural[];
  readonly totalCells: number;
  readonly textIncluded: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
}

/**
 * Strictly structural and read-only. No cell values are exposed, not even
 * obfuscated values or per-cell hashes (which can leak low-entropy secrets).
 * Not registered as an active workbook/scenario adapter.
 */
export async function previewDocxTableStructure(input: Uint8Array,
  decision?: OfficeLargeStructureDecision): Promise<DocxStructuralPreview> {
  const capacity = acceptLargeCapacity(decision);
  const large = capacity !== "default";
  const s2 = capacity === "v2";
  const s3 = capacity === "v3";
  if (!(input instanceof Uint8Array) || input.byteLength < 4 || input.byteLength > 16 * 1024 * 1024) {
    fail("DOCX_SOURCE_SIZE_INVALID");
  }
  const archive = await openSafeWorkbookArchive(input, productionWorkbookArchiveBackend(),
    s3 ? LIMITS_S3 : s2 ? LIMITS_S2 : LIMITS);
  try {
    const paths = archive.paths;
    for (const name of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) {
      if (!archive.has(name)) fail("DOCX_REQUIRED_PACKAGE_MEMBER_MISSING");
    }
    if (paths.some((p) => /(^|\/)(vbaProject\.bin|activeX|embeddings|oleObject|altChunk|media)(\/|$)/i.test(p)
      || /\.(exe|dll|vbs|ps1|bin)$/i.test(p))) fail("DOCX_ACTIVE_OR_EMBEDDED_CONTENT");
    // Every package relationship is local and declarative: never follow links.
    for (const part of paths.filter((p) => p.endsWith(".rels"))) {
      const rels = parseSafeXml(await archive.read(part), "DOCX relationship");
      namespace(rels, "Relationships", "xmlns", OPC_REL_NS);
      for (const rel of rels.children) {
        if (rel.name !== "Relationship") fail("DOCX_INVALID_RELATIONSHIP");
        if (attr(rel, "TargetMode")?.toLowerCase() === "external" ||
            /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(attr(rel, "Target") ?? "")) {
          fail("DOCX_EXTERNAL_RELATIONSHIP");
        }
      }
    }
    const rootRels = parseSafeXml(await archive.read("_rels/.rels"), "DOCX root relationships");
    const docs = rootRels.children.filter((r) => attr(r, "Type") === OFFICE_REL);
    if (docs.length !== 1 || attr(docs[0]!, "Target") !== "word/document.xml") {
      fail("DOCX_UNSUPPORTED_DOCUMENT_RELATIONSHIP");
    }
    const types = parseSafeXml(await archive.read("[Content_Types].xml"), "DOCX content types");
    namespace(types, "Types", "xmlns", OPC_TYPES_NS);
    const docTypes = types.children.filter((t) => t.name === "Override"
      && attr(t, "PartName") === "/word/document.xml");
    if (docTypes.length !== 1 || attr(docTypes[0]!, "ContentType") !== WORD_MAIN) {
      fail("DOCX_UNSUPPORTED_CONTENT_TYPE");
    }
    if (types.children.some((t) => /macroEnabled|vbaProject|oleObject|activeX/i.test(attr(t, "ContentType") ?? ""))) {
      fail("DOCX_ACTIVE_OR_EMBEDDED_CONTENT");
    }
    const xmlBytes = await archive.read("word/document.xml");
    if (xmlBytes.byteLength > (s3 ? 16 : s2 ? 8 : large ? 4 : 1) * 1024 * 1024) fail("DOCX_DOCUMENT_XML_TOO_LARGE");
    const doc = s3
      ? parseSafeXmlOfficeS3(xmlBytes, "DOCX document")
      : parseSafeXml(xmlBytes, "DOCX document");
    namespace(doc, "w:document", "xmlns:w", WORD_NS);
    rejectUnsupportedDocument(doc);
    const bodies = doc.children.filter((x) => x.name === "w:body");
    if (bodies.length !== 1) fail("DOCX_BODY_INVALID");
    const body = bodies[0]!;
    // Reject unknown or namespace-spoofed tables anywhere in document.
    if (descendants(doc, "tbl").some((x) => x.name !== "w:tbl")) fail("DOCX_UNSUPPORTED_NAMESPACE");
    const bodyTables = body.children.filter((x) => tag(x, "tbl"));
    if (descendants(doc, "tbl").length !== bodyTables.length) fail("DOCX_NESTED_OR_WRAPPED_TABLE");
    if (bodyTables.length > 20) fail("DOCX_TOO_MANY_TABLES");
    const sha = await webCryptoImportHashProvider.sha256Bytes(input);
    const tables: DocxTableStructural[] = [];
    let totalCells = 0;
    for (let t = 0; t < bodyTables.length; t++) {
      const table = bodyTables[t]!;
      only(table, ["tblPr", "tblGrid", "tr"]);
      const rowNodes = childElements(table, "tr");
      if (rowNodes.length < 1 || rowNodes.length > (s3 ? 10001 : s2 ? 5001 : large ? 1001 : 200)) fail("DOCX_ROW_COUNT_UNSUPPORTED");
      const rows: DocxTableRowStructural[] = [];
      for (let r = 0; r < rowNodes.length; r++) {
        const row = rowNodes[r]!;
        only(row, ["trPr", "tc"]);
        const cells = childElements(row, "tc");
        if (cells.length < 1 || cells.length > 16) fail("DOCX_COLUMN_COUNT_UNSUPPORTED");
        const items: DocxTableCellStructural[] = [];
        for (let c = 0; c < cells.length; c++) {
          totalCells++;
          if (totalCells > (s3 ? 100000 : s2 ? 50000 : large ? 20000 : 2000)) fail("DOCX_TOO_MANY_CELLS");
          items.push(Object.freeze({
            cellOrdinal: c,
            textCodeUnits: cellTextLength(cells[c]!),
            locator: Object.freeze({kind: "docx-table-cell", sourceSha256: sha,
              part: "word/document.xml", tableOrdinal: t, rowOrdinal: r, cellOrdinal: c}),
          }));
        }
        rows.push(Object.freeze({rowOrdinal: r, cells: Object.freeze(items)}));
      }
      tables.push(Object.freeze({tableOrdinal: t, rows: Object.freeze(rows)}));
    }
    return Object.freeze({
      profileId: DOCX_TABLES_PROFILE,
      ...(large ? {capacityProfile:s3
        ? SCALE_OFFICE_S3_STRUCTURE_PROFILE
        : s2 ? SCALE_OFFICE_S2_STRUCTURE_PROFILE
        : SCALE_OFFICE_LARGE_STRUCTURE_PROFILE} : {}),
      status: "REVIEW_REQUIRED",
      semanticTrack: "CONFIG_DOCUMENTED", canActivate: false,
      sourceSha256: sha, tables: Object.freeze(tables), totalCells,
      textIncluded: false, engineVerified: false, physicalTopologyVerified: false,
    });
  } finally {
    await archive.close();
  }
}
