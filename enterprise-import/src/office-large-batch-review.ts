import { previewDocxTableStructure,
  SCALE_OFFICE_LARGE_STRUCTURE_PROFILE as DOCX_LARGE_PROFILE,
  SCALE_OFFICE_S2_STRUCTURE_PROFILE as DOCX_S2_PROFILE,
  SCALE_OFFICE_S3_STRUCTURE_PROFILE as DOCX_S3_PROFILE,
  type DocxTableCellLocator } from "./docx-tables-structural-preview.js";
import { previewOdtTableStructure,
  SCALE_OFFICE_LARGE_STRUCTURE_PROFILE as ODT_LARGE_PROFILE,
  SCALE_OFFICE_S2_STRUCTURE_PROFILE as ODT_S2_PROFILE,
  SCALE_OFFICE_S3_STRUCTURE_PROFILE as ODT_S3_PROFILE,
  type OdtCellLocator } from "./odt-tables-structural-preview.js";
import { openSafeWorkbookArchive, productionWorkbookArchiveBackend,
  type WorkbookArchiveLimits } from "./workbook-archive.js";
import { childElements, parseSafeXml, parseSafeXmlOfficeS3, type XmlNode } from "./xml-lite.js";
import { EnterpriseImportError } from "./types.js";

/**
 * SCALE-001 P1b1: consented, bounded, **source-only** Office batch disclosure.
 * NOT an import adapter or a Builder/Engine activation path. The frozen
 * P1a structural validation is run once per batch; the selected original
 * source cells are extracted in one additional ZIP/XML pass per batch,
 * NEVER one ZIP/XML reparse per cell. Old per-cell APIs are unchanged.
 */
export const OFFICE_SCALED_BATCH_PROFILE = "office.scaled-reviewed-batch.v1" as const;
/** P3b separate explicit source-only version; never broadens v1. */
export const OFFICE_SCALED_BATCH_PROFILE_V2 = "office.scaled-reviewed-batch.v2" as const;
/** P4c2a: explicitly consented original 10k structural v3 source disclosures.
 * No broadening of v1/v2 and no activation of Builder, Runtime or Engine.
 */
export const OFFICE_SCALED_BATCH_PROFILE_V3 = "office.scaled-reviewed-batch.v3" as const;
export type OfficeScaledBatchFormat = "docx" | "odt";
export type OfficeScaledCellLocator = DocxTableCellLocator | OdtCellLocator;

export interface OfficeScaledColumnConsent {
  readonly cellOrdinal: number;
  readonly acknowledge: true;
}
export interface OfficeScaledBatchDecision {
  readonly format: OfficeScaledBatchFormat;
  readonly sourceSha256: string;
  readonly capacityProfile: typeof OFFICE_SCALED_BATCH_PROFILE | typeof OFFICE_SCALED_BATCH_PROFILE_V2;
  readonly tableOrdinal: number;
  /** Inclusive and intentionally excludes the source table header (row 0). */
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly columns: readonly OfficeScaledColumnConsent[];
  readonly acknowledgeSelectedRange: true;
  readonly acknowledgeDisclosure: true;
}
export interface OfficeScaledDisclosedCell {
  readonly locator: OfficeScaledCellLocator;
  readonly text: string;
}
export interface OfficeScaledDisclosedRow {
  readonly rowOrdinal: number;
  readonly cells: readonly OfficeScaledDisclosedCell[];
}
export interface OfficeScaledBatchDisclosure {
  readonly status: "REVEALED_UNVERIFIED";
  readonly capacityProfile: typeof OFFICE_SCALED_BATCH_PROFILE | typeof OFFICE_SCALED_BATCH_PROFILE_V2;
  readonly sourceSha256: string;
  readonly tableOrdinal: number;
  readonly rows: readonly OfficeScaledDisclosedRow[];
  readonly canActivate: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
}
const SHA = /^[0-9a-f]{64}$/;
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_BATCH_ROWS = 100;
const MAX_BATCH_COLUMNS = 4;
const DECISION_KEYS = ["format","sourceSha256","capacityProfile","tableOrdinal",
  "rowStart","rowEnd","columns","acknowledgeSelectedRange","acknowledgeDisclosure"];
const COLUMN_KEYS = ["cellOrdinal","acknowledge"];
const CREDENTIAL = /(?:password|passwd|passphrase|secret|token|credential|bearer|private|confidential|sensitive|api[ ._-]*key|access[ ._-]*key|ssh[ ._-]*key|authorization|connection[ ._-]*string|certificate[ ._-]*key)/i;
const LIMITS: Readonly<Record<OfficeScaledBatchFormat, WorkbookArchiveLimits>> = {
  docx: { maxFiles:128,maxCompressedBytes:16*1024*1024,
    maxDecompressedBytes:32*1024*1024,maxSingleFileBytes:4*1024*1024,
    maxCompressionRatio:100 },
  odt: { maxFiles:32,maxCompressedBytes:16*1024*1024,
    maxDecompressedBytes:32*1024*1024,maxSingleFileBytes:4*1024*1024,
    maxCompressionRatio:100 },
};
/** P3b v2 uses only the already reviewed P3a v2 8 MiB/64 MiB ZIP bounds. */
const LIMITS_V2: Readonly<Record<OfficeScaledBatchFormat, WorkbookArchiveLimits>> = {
  docx:{...LIMITS.docx,maxDecompressedBytes:64*1024*1024,maxSingleFileBytes:8*1024*1024},
  odt:{...LIMITS.odt,maxDecompressedBytes:64*1024*1024,maxSingleFileBytes:8*1024*1024},
};
// Separate S3-only ZIP bounds, same compression ratio and compressed limit.
const LIMITS_V3: Readonly<Record<OfficeScaledBatchFormat, WorkbookArchiveLimits>> = {
  docx:{...LIMITS_V2.docx,maxDecompressedBytes:96*1024*1024,maxSingleFileBytes:16*1024*1024},
  odt:{...LIMITS_V2.odt,maxDecompressedBytes:96*1024*1024,maxSingleFileBytes:16*1024*1024},
};

function deny(code: "SCALE_P1B1_SELECTION_INVALID" | "SCALE_P1B1_CONSENT_REQUIRED" |
  "SCALE_P1B1_SOURCE_CHANGED" | "SCALE_P1B1_SOURCE_BLOCKED" |
  "SCALE_P1B1_SENSITIVE_BLOCKED"): never {
  // Stable errors only: never attach source strings or raw archive exceptions.
  throw new EnterpriseImportError(code, code);
}
const ordinal = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number)>=0;
const exact = (v: unknown, keys: readonly string[]): boolean =>
  !!v && typeof v === "object" && !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === [...keys].sort().join(",");
function isSensitive(value: string): boolean {
  return value.length < 1 || value.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._:-]*$/.test(value) ||
    CREDENTIAL.test(value) ||
    /[A-Za-z0-9_-]{24,}/.test(value) ||
    /(?:[A-Fa-f0-9]{2}:){8,}[A-Fa-f0-9]{2}/.test(value);
}
function selectedText(format: OfficeScaledBatchFormat, node: XmlNode): string {
  return format === "docx"
    ? childElements(node,"p").flatMap(p=>childElements(p,"r").flatMap(r=>
      childElements(r,"t").map(t=>t.text))).join("")
    : childElements(node,"p").map(p=>p.text).join("");
}
function validateDecision(input: unknown): asserts input is OfficeScaledBatchDecision {
  if(!input||typeof input!=="object"||Array.isArray(input))
    deny("SCALE_P1B1_SELECTION_INVALID");
  const d=input as Partial<OfficeScaledBatchDecision>;
  if(d.acknowledgeSelectedRange!==true || d.acknowledgeDisclosure!==true ||
    (Array.isArray(d.columns) && d.columns.some(c=>c?.acknowledge!==true)))
    deny("SCALE_P1B1_CONSENT_REQUIRED");
  if(!exact(d,DECISION_KEYS) || (d.format!=="docx"&&d.format!=="odt") ||
    (d.capacityProfile!==OFFICE_SCALED_BATCH_PROFILE &&
     d.capacityProfile!==OFFICE_SCALED_BATCH_PROFILE_V2) ||
    typeof d.sourceSha256!=="string" || !SHA.test(d.sourceSha256) ||
    !ordinal(d.tableOrdinal) || d.tableOrdinal>=20 ||
    !ordinal(d.rowStart) || d.rowStart<1 ||
    !ordinal(d.rowEnd) || d.rowEnd<d.rowStart || d.rowEnd>(d.capacityProfile===OFFICE_SCALED_BATCH_PROFILE_V2?5000:1000) ||
    d.rowEnd-d.rowStart+1>MAX_BATCH_ROWS ||
    !Array.isArray(d.columns) || d.columns.length<1 ||
    d.columns.length>MAX_BATCH_COLUMNS)
    deny("SCALE_P1B1_SELECTION_INVALID");
  const seen=new Set<number>();
  for(const col of d.columns) {
    if(!exact(col,COLUMN_KEYS) || !ordinal(col.cellOrdinal) ||
      col.cellOrdinal>=16 || seen.has(col.cellOrdinal))
      deny("SCALE_P1B1_SELECTION_INVALID");
    seen.add(col.cellOrdinal);
  }
}

/**
 * Deliberately copied input preserves a coherent original-byte snapshot even
 * if the caller later mutates its own Uint8Array while async ZIP code runs.
 * Caller must still independently compare the actual original File and active
 * workspace immediately before any future Builder mutation (P1b2).
 */
export async function revealReviewedOfficeBatch(
  original: Uint8Array,
  decision: OfficeScaledBatchDecision,
): Promise<OfficeScaledBatchDisclosure> {
  validateDecision(decision);
  if(!(original instanceof Uint8Array) || original.byteLength<4 ||
    original.byteLength>MAX_SOURCE_BYTES)
    deny("SCALE_P1B1_SELECTION_INVALID");
  const bytes=Uint8Array.from(original);
  const s2=decision.capacityProfile===OFFICE_SCALED_BATCH_PROFILE_V2;
  let preview;
  try {
    preview=decision.format==="docx"
      ? await previewDocxTableStructure(bytes,{capacityProfile:s2?DOCX_S2_PROFILE:DOCX_LARGE_PROFILE})
      : await previewOdtTableStructure(bytes,{capacityProfile:s2?ODT_S2_PROFILE:ODT_LARGE_PROFILE});
  } catch {
    deny("SCALE_P1B1_SOURCE_BLOCKED");
  }
  if(preview.sourceSha256!==decision.sourceSha256)
    deny("SCALE_P1B1_SOURCE_CHANGED");
  const table=preview.tables[decision.tableOrdinal];
  if(!table || table.rows.length<=decision.rowEnd || !table.rows[0])
    deny("SCALE_P1B1_SELECTION_INVALID");
  // Check every structural cell before opening the source for selection.
  for(let r=decision.rowStart;r<=decision.rowEnd;r++) {
    if(!table.rows[r] || decision.columns.some(c=>
      !table.rows[r]?.cells[c.cellOrdinal]) ||
      decision.columns.some(c=>!table.rows[0]?.cells[c.cellOrdinal]))
      deny("SCALE_P1B1_SELECTION_INVALID");
  }
  let archive;
  try {
    archive=await openSafeWorkbookArchive(bytes,productionWorkbookArchiveBackend(),
      s2?LIMITS_V2[decision.format]:LIMITS[decision.format]);
    const xml=await archive.read(decision.format==="docx"
      ? "word/document.xml" : "content.xml");
    const root=parseSafeXml(xml,"SCALE-001 validated Office batch");
    const body=childElements(root,"body")[0];
    const holder=decision.format==="docx" ? body :
      body&&childElements(body,"text")[0];
    const tableNodes=holder&&childElements(holder,
      decision.format==="docx"?"tbl":"table");
    const originalTable=tableNodes?.[decision.tableOrdinal];
    const rows=originalTable&&childElements(originalTable,
      decision.format==="docx"?"tr":"table-row");
    if(!rows||rows.length<=decision.rowEnd)
      deny("SCALE_P1B1_SELECTION_INVALID");
    const cellsFor=(row:XmlNode)=>childElements(row,
      decision.format==="docx"?"tc":"table-cell");
    const header=cellsFor(rows[0]!);
    const inspected:OfficeScaledDisclosedRow[]=[];
    for(let r=decision.rowStart;r<=decision.rowEnd;r++){
      const originals=cellsFor(rows[r]!);
      const label=originals[0] ? selectedText(decision.format,originals[0]) : "";
      if(CREDENTIAL.test(label)) deny("SCALE_P1B1_SENSITIVE_BLOCKED");
      const selected:OfficeScaledDisclosedCell[]=[];
      for(const column of decision.columns){
        const ordinal=column.cellOrdinal;
        const heading=header[ordinal]?selectedText(decision.format,header[ordinal]!):"";
        if(CREDENTIAL.test(heading))
          deny("SCALE_P1B1_SENSITIVE_BLOCKED");
        const sourceCell=originals[ordinal];
        const expected=table.rows[r]?.cells[ordinal];
        if(!sourceCell||!expected)
          deny("SCALE_P1B1_SELECTION_INVALID");
        const value=selectedText(decision.format,sourceCell);
        if(value.length!==expected.textCodeUnits)
          deny("SCALE_P1B1_SOURCE_BLOCKED");
        if(isSensitive(value))
          deny("SCALE_P1B1_SENSITIVE_BLOCKED");
        selected.push(Object.freeze({
          locator:Object.freeze({...expected.locator}),
          text:value,
        }));
      }
      inspected.push(Object.freeze({
        rowOrdinal:r,cells:Object.freeze(selected),
      }));
    }
    return Object.freeze({
      status:"REVEALED_UNVERIFIED",
      capacityProfile:decision.capacityProfile,
      sourceSha256:preview.sourceSha256,
      tableOrdinal:decision.tableOrdinal,
      rows:Object.freeze(inspected),
      canActivate:false,engineVerified:false,physicalTopologyVerified:false,
    });
  }catch(error){
    if(error instanceof EnterpriseImportError && /^SCALE_P1B1_/.test(error.code))
      throw error;
    deny("SCALE_P1B1_SOURCE_BLOCKED");
  }finally{
    if(archive) await archive.close().catch(()=>{});
  }
  // Statically exhaustive fail-closed fallback: no implicit undefined return.
  return deny("SCALE_P1B1_SOURCE_BLOCKED");
}


/**
 * P3b source-only v2: one immutable ZIP snapshot, one structural preview and
 * one original XML read for up to 100 individually acknowledged batches.
 * No blanket consent and no unselected original cell values in the result.
 * This is not a Builder mutation API.
 */
export async function revealReviewedOfficeBatchesV2(
  original:Uint8Array,
  decisions:readonly OfficeScaledBatchDecision[],
):Promise<readonly OfficeScaledBatchDisclosure[]> {
  if(!Array.isArray(decisions)||decisions.length<1||decisions.length>100)
    deny("SCALE_P1B1_SELECTION_INVALID");
  // Array.isArray is a runtime guard and otherwise narrows readonly arrays
  // to any[] in TypeScript. Preserve the explicit decision element type.
  const approved:readonly OfficeScaledBatchDecision[]=decisions;
  for(const d of approved)validateDecision(d);
  const first:OfficeScaledBatchDecision=approved[0]!;
  if(approved.some(d=>d.capacityProfile!==OFFICE_SCALED_BATCH_PROFILE_V2||
      d.format!==first.format||d.sourceSha256!==first.sourceSha256))
    deny("SCALE_P1B1_SELECTION_INVALID");
  if(!(original instanceof Uint8Array)||original.byteLength<4||
      original.byteLength>MAX_SOURCE_BYTES)deny("SCALE_P1B1_SELECTION_INVALID");
  const bytes=Uint8Array.from(original);
  let preview;
  try{
    preview=first.format==="docx"
      ?await previewDocxTableStructure(bytes,{capacityProfile:DOCX_S2_PROFILE})
      :await previewOdtTableStructure(bytes,{capacityProfile:ODT_S2_PROFILE});
  }catch{deny("SCALE_P1B1_SOURCE_BLOCKED");}
  if(preview.sourceSha256!==first.sourceSha256)deny("SCALE_P1B1_SOURCE_CHANGED");

  // All-or-nothing: verify each approved original row and column before
  // disclosing any source value.
  for(const decision of approved){
    const table=preview.tables[decision.tableOrdinal];
    if(!table||!table.rows[0]||table.rows.length<=decision.rowEnd)
      deny("SCALE_P1B1_SELECTION_INVALID");
    for(let r=decision.rowStart;r<=decision.rowEnd;r++){
      if(!table.rows[r]||decision.columns.some(c=>
        !table.rows[r]?.cells[c.cellOrdinal]||
        !table.rows[0]?.cells[c.cellOrdinal]))
        deny("SCALE_P1B1_SELECTION_INVALID");
    }
  }
  let archive;
  try{
    archive=await openSafeWorkbookArchive(bytes,productionWorkbookArchiveBackend(),
      LIMITS_V2[first.format]);
    const xml=await archive.read(first.format==="docx"?"word/document.xml":"content.xml");
    const root=parseSafeXml(xml,"SCALE-001 P3b validated v2 Office batch");
    const body=childElements(root,"body")[0];
    const holder=first.format==="docx"?body:body&&childElements(body,"text")[0];
    const originals=holder&&childElements(holder,first.format==="docx"?"tbl":"table");
    if(!originals)deny("SCALE_P1B1_SOURCE_BLOCKED");
    const rowFor=(table:XmlNode)=>childElements(table,
      first.format==="docx"?"tr":"table-row");
    const cellsFor=(row:XmlNode)=>childElements(row,
      first.format==="docx"?"tc":"table-cell");
    const all:OfficeScaledBatchDisclosure[]=[];
    for(const decision of approved){
      const structure=preview.tables[decision.tableOrdinal]!;
      const sourceTable=originals[decision.tableOrdinal];
      const rows=sourceTable&&rowFor(sourceTable);
      if(!rows||rows.length!==structure.rows.length||!rows[0])
        deny("SCALE_P1B1_SOURCE_BLOCKED");
      const header=cellsFor(rows[0]!);
      const disclosed:OfficeScaledDisclosedRow[]=[];
      for(let r=decision.rowStart;r<=decision.rowEnd;r++){
        const rawRow=rows[r];
        if(!rawRow)deny("SCALE_P1B1_SOURCE_BLOCKED");
        const sourceCells=cellsFor(rawRow);
        const label=sourceCells[0]?selectedText(first.format,sourceCells[0]):"";
        if(CREDENTIAL.test(label))deny("SCALE_P1B1_SENSITIVE_BLOCKED");
        const selected:OfficeScaledDisclosedCell[]=[];
        for(const column of decision.columns){
          const c=column.cellOrdinal;
          const expected=structure.rows[r]?.cells[c];
          const cell=sourceCells[c],head=header[c];
          if(!expected||!cell||!head)deny("SCALE_P1B1_SOURCE_BLOCKED");
          const heading=selectedText(first.format,head);
          if(CREDENTIAL.test(heading))deny("SCALE_P1B1_SENSITIVE_BLOCKED");
          const value=selectedText(first.format,cell);
          if(value.length!==expected.textCodeUnits)deny("SCALE_P1B1_SOURCE_BLOCKED");
          if(isSensitive(value))deny("SCALE_P1B1_SENSITIVE_BLOCKED");
          selected.push(Object.freeze({
            locator:Object.freeze({...expected.locator}),text:value,
          }));
        }
        disclosed.push(Object.freeze({rowOrdinal:r,cells:Object.freeze(selected)}));
      }
      all.push(Object.freeze({
        status:"REVEALED_UNVERIFIED",capacityProfile:OFFICE_SCALED_BATCH_PROFILE_V2,
        sourceSha256:preview.sourceSha256,tableOrdinal:decision.tableOrdinal,
        rows:Object.freeze(disclosed),canActivate:false,engineVerified:false,
        physicalTopologyVerified:false,
      }));
    }
    return Object.freeze(all);
  }catch(error){
    if(error instanceof EnterpriseImportError&&/^SCALE_P1B1_/.test(error.code))
      throw error;
    deny("SCALE_P1B1_SOURCE_BLOCKED");
  }finally{
    if(archive)await archive.close().catch(()=>{});
  }
  return deny("SCALE_P1B1_SOURCE_BLOCKED");
}

/** Exactly versioned disclosure decision for original source text only.
 * The old single-batch and 5k v2 functions deliberately do not accept v3.
 */
export interface OfficeScaledBatchDecisionV3 extends
  Omit<OfficeScaledBatchDecision,"capacityProfile"> {
  readonly capacityProfile: typeof OFFICE_SCALED_BATCH_PROFILE_V3;
}
export interface OfficeScaledBatchDisclosureV3 extends
  Omit<OfficeScaledBatchDisclosure,"capacityProfile"> {
  readonly capacityProfile: typeof OFFICE_SCALED_BATCH_PROFILE_V3;
}

/** P4c2a: zero inherited or pre-approved source-row consent. */
function validateV3(d:unknown):asserts d is OfficeScaledBatchDecisionV3 {
  if(!d||typeof d!=="object"||Array.isArray(d))
    deny("SCALE_P1B1_SELECTION_INVALID");
  const x=d as Partial<OfficeScaledBatchDecisionV3>;
  if(x.acknowledgeSelectedRange!==true||
     x.acknowledgeDisclosure!==true||
     (Array.isArray(x.columns)&&x.columns.some(c=>c?.acknowledge!==true)))
    deny("SCALE_P1B1_CONSENT_REQUIRED");
  if(!exact(x,DECISION_KEYS) ||
     (x.format!=="docx"&&x.format!=="odt")||
     x.capacityProfile!==OFFICE_SCALED_BATCH_PROFILE_V3||
     typeof x.sourceSha256!=="string"||!SHA.test(x.sourceSha256)||
     !ordinal(x.tableOrdinal)||x.tableOrdinal>=20||
     !ordinal(x.rowStart)||x.rowStart<1||
     !ordinal(x.rowEnd)||x.rowEnd<x.rowStart||x.rowEnd>10000||
     x.rowEnd-x.rowStart+1>MAX_BATCH_ROWS||
     !Array.isArray(x.columns)||x.columns.length<1||
     x.columns.length>MAX_BATCH_COLUMNS)
    deny("SCALE_P1B1_SELECTION_INVALID");
  const seen=new Set<number>();
  for(const col of x.columns){
    if(!exact(col,COLUMN_KEYS)||!ordinal(col.cellOrdinal)||
       col.cellOrdinal>=16||seen.has(col.cellOrdinal))
      deny("SCALE_P1B1_SELECTION_INVALID");
    seen.add(col.cellOrdinal);
  }
}

/** Independently acknowledged 1..200 original source batches.
 *
 * 1 coherent immutable ZIP snapshot → 1 structural source validation
 * → 1 additional v3-restricted original XML read for every selected batch.
 * Reject ALL invalid/mixed/reordered/overlapping grants before revealing any
 * original-cell text. NOT a user interface, Builder mapping or Engine proof.
 */
export async function revealReviewedOfficeBatchesV3(
  original:Uint8Array,
  decisions:readonly OfficeScaledBatchDecisionV3[],
):Promise<readonly OfficeScaledBatchDisclosureV3[]> {
  if(!Array.isArray(decisions)||decisions.length<1||decisions.length>200)
    deny("SCALE_P1B1_SELECTION_INVALID");
  const approved:readonly OfficeScaledBatchDecisionV3[]=decisions;
  for(const grant of approved)validateV3(grant);
  const first=approved[0]!;
  const latestEnd=new Map<number,number>();
  let priorTable=-1;
  for(const grant of approved){
    if(grant.format!==first.format||
       grant.sourceSha256!==first.sourceSha256||
       grant.tableOrdinal<priorTable||
       grant.rowStart<=(latestEnd.get(grant.tableOrdinal)??0))
      deny("SCALE_P1B1_SELECTION_INVALID");
    latestEnd.set(grant.tableOrdinal,grant.rowEnd);
    priorTable=grant.tableOrdinal;
  }
  if(!(original instanceof Uint8Array)||original.byteLength<4||
     original.byteLength>MAX_SOURCE_BYTES)
    deny("SCALE_P1B1_SELECTION_INVALID");
  const bytes=Uint8Array.from(original);
  let preview;
  try {
    preview=first.format==="docx"
      ?await previewDocxTableStructure(bytes,{capacityProfile:DOCX_S3_PROFILE})
      :await previewOdtTableStructure(bytes,{capacityProfile:ODT_S3_PROFILE});
  }catch{deny("SCALE_P1B1_SOURCE_BLOCKED");}
  if(preview.sourceSha256!==first.sourceSha256)
    deny("SCALE_P1B1_SOURCE_CHANGED");

  // Preflight every selected original row and every approved cell ordinal;
  // do not allow a later invalid grant to produce a partial result.
  for(const grant of approved){
    const table=preview.tables[grant.tableOrdinal];
    if(!table||!table.rows[0]||table.rows.length<=grant.rowEnd)
      deny("SCALE_P1B1_SELECTION_INVALID");
    for(let row=grant.rowStart;row<=grant.rowEnd;row++){
      if(!table.rows[row]||
         grant.columns.some(col=>!table.rows[row]?.cells[col.cellOrdinal]||
           !table.rows[0]?.cells[col.cellOrdinal]))
        deny("SCALE_P1B1_SELECTION_INVALID");
    }
  }
  let archive;
  try {
    archive=await openSafeWorkbookArchive(bytes,productionWorkbookArchiveBackend(),
      LIMITS_V3[first.format]);
    const xml=await archive.read(first.format==="docx"?"word/document.xml":"content.xml");
    const root=parseSafeXmlOfficeS3(xml,
      "SCALE-001 P4c2a original v3 Office source selection");
    const body=childElements(root,"body")[0];
    const holder=first.format==="docx"?body:body&&childElements(body,"text")[0];
    const tables=holder&&childElements(holder,
      first.format==="docx"?"tbl":"table");
    if(!tables)deny("SCALE_P1B1_SOURCE_BLOCKED");
    const rowsFor=(table:XmlNode)=>childElements(table,
      first.format==="docx"?"tr":"table-row");
    const cellsFor=(row:XmlNode)=>childElements(row,
      first.format==="docx"?"tc":"table-cell");
    const disclosed:OfficeScaledBatchDisclosureV3[]=[];
    for(const grant of approved){
      const structure=preview.tables[grant.tableOrdinal]!;
      const sourceTable=tables[grant.tableOrdinal];
      const rows=sourceTable&&rowsFor(sourceTable);
      if(!rows||rows.length!==structure.rows.length||!rows[0])
        deny("SCALE_P1B1_SOURCE_BLOCKED");
      const headers=cellsFor(rows[0]!);
      const selectedRows:OfficeScaledDisclosedRow[]=[];
      for(let row=grant.rowStart;row<=grant.rowEnd;row++){
        const sourceRow=rows[row];
        if(!sourceRow)deny("SCALE_P1B1_SOURCE_BLOCKED");
        const sourceCells=cellsFor(sourceRow);
        const firstCell=sourceCells[0]
          ?selectedText(first.format,sourceCells[0]):"";
        if(CREDENTIAL.test(firstCell))deny("SCALE_P1B1_SENSITIVE_BLOCKED");
        const selected:OfficeScaledDisclosedCell[]=[];
        for(const column of grant.columns){
          const col=column.cellOrdinal;
          const expected=structure.rows[row]?.cells[col];
          const sourceCell=sourceCells[col],header=headers[col];
          if(!expected||!sourceCell||!header)
            deny("SCALE_P1B1_SOURCE_BLOCKED");
          const heading=selectedText(first.format,header);
          if(CREDENTIAL.test(heading))deny("SCALE_P1B1_SENSITIVE_BLOCKED");
          const text=selectedText(first.format,sourceCell);
          if(text.length!==expected.textCodeUnits)
            deny("SCALE_P1B1_SOURCE_BLOCKED");
          if(isSensitive(text))deny("SCALE_P1B1_SENSITIVE_BLOCKED");
          selected.push(Object.freeze({
            locator:Object.freeze({...expected.locator}),text
          }));
        }
        selectedRows.push(Object.freeze({
          rowOrdinal:row,cells:Object.freeze(selected)
        }));
      }
      disclosed.push(Object.freeze({
        status:"REVEALED_UNVERIFIED",
        capacityProfile:OFFICE_SCALED_BATCH_PROFILE_V3,
        sourceSha256:preview.sourceSha256,
        tableOrdinal:grant.tableOrdinal,rows:Object.freeze(selectedRows),
        canActivate:false,engineVerified:false,physicalTopologyVerified:false
      }));
    }
    return Object.freeze(disclosed);
  }catch(error){
    if(error instanceof EnterpriseImportError&&/^SCALE_P1B1_/.test(error.code))
      throw error;
    deny("SCALE_P1B1_SOURCE_BLOCKED");
  }finally{
    if(archive)await archive.close().catch(()=>{});
  }
  return deny("SCALE_P1B1_SOURCE_BLOCKED");
}
