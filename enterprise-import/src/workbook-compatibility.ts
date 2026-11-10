import type { ImportCell, ImportDiagnostic, ImportDocument, ImportRecord, ImportTable } from "./types.js";

/**
 * Explicit compatibility profiles for the two legacy Arvidsjaur workbooks.
 * These profiles are deliberately narrow: they select only the six named
 * canonical source sheets and retain every other populated sheet as
 * documentation evidence. No sheet is selected by position or by guessing.
 */
export type LegacyWorkbookProfile = "standard" | "legacy-six" | "legacy-src-22";

export interface PreservedDocumentationSheet {
  readonly sheet: string;
  readonly rows: number;
  readonly populatedCells: number;
}

export interface WorkbookCompatibility {
  readonly profile: LegacyWorkbookProfile;
  readonly document: ImportDocument;
  readonly originalSheets: readonly string[];
  readonly authoritativeSheets: readonly string[];
  readonly documentationSheets: readonly string[];
  readonly preservedDocumentation: readonly PreservedDocumentationSheet[];
  readonly diagnostics: readonly ImportDiagnostic[];
}

const CANONICAL = ["Nodes", "Interfaces", "Links", "Zones", "Layout", "Metadata"] as const;
const populated = (value: unknown): boolean => value !== undefined && value !== null &&
  !(typeof value === "string" && value.trim() === "");

function populatedCells(record: ImportRecord): number {
  return Object.values(record.fields).filter((cell) => populated(cell.value)).length;
}

function documentationSummary(table: ImportTable): PreservedDocumentationSheet {
  return {
    sheet: table.tableId,
    rows: table.records.length,
    populatedCells: table.records.reduce((count, record) => count + populatedCells(record), 0),
  };
}

function cloneTable(table: ImportTable, tableId: string): ImportTable {
  // Keep the original ImportCell locators (including the real worksheet name)
  // while exposing canonical table IDs to the existing mapper.
  return { tableId, records: table.records };
}

function hasPopulatedRows(table: ImportTable | undefined): boolean {
  return Boolean(table?.records.some((record) => Object.values(record.fields).some((cell) => populated(cell.value))));
}

export function resolveWorkbookCompatibility(document: ImportDocument): WorkbookCompatibility {
  const tables = new Map(document.tables.map((table) => [table.tableId, table] as const));
  const originalSheets = document.tables.map((table) => table.tableId);
  const diagnostics: ImportDiagnostic[] = [];
  const srcNames = CANONICAL.map((name) => `SRC ${name}`);
  const hasAllSrc = srcNames.every((name) => tables.has(name));
  const hasAnySrc = srcNames.some((name) => tables.has(name));
  const hasAllCanonical = CANONICAL.every((name) => tables.has(name));
  const hasAnyCanonical = CANONICAL.some((name) => tables.has(name));

  if (hasAnySrc && !hasAllSrc) {
    diagnostics.push({
      code: "WORKBOOK_SOURCE_PROFILE_INCOMPLETE",
      severity: "error",
      message: "A SRC workbook profile must contain exactly all six SRC Nodes, SRC Interfaces, SRC Links, SRC Zones, SRC Layout and SRC Metadata sheets.",
    });
  }
  if (hasAllSrc && hasAnyCanonical) {
    diagnostics.push({
      code: "WORKBOOK_SOURCE_TABLE_CONFLICT",
      severity: "error",
      message: "Both prefixed SRC sheets and unprefixed canonical sheets are present. Select one explicit source profile; no source is chosen automatically.",
    });
  }

  if (hasAllSrc && !hasAnyCanonical) {
    const authoritativeSheets = srcNames.slice();
    const documentationTables = document.tables.filter((table) => !authoritativeSheets.includes(table.tableId));
    const canonicalTables = CANONICAL.map((name) => cloneTable(tables.get(`SRC ${name}`)!, name));
    const documentationSheets = documentationTables.map((table) => table.tableId);
    for (const table of documentationTables) {
      if (hasPopulatedRows(table)) diagnostics.push({
        code: "WORKBOOK_DOCUMENTATION_SHEET_PRESERVED",
        severity: "info",
        message: `Populated worksheet '${table.tableId}' is retained as source documentation and is not projected as Builder topology.`,
        table: table.tableId,
      });
    }
    return {
      profile: "legacy-src-22",
      document: { tables: [...canonicalTables, ...documentationTables] },
      originalSheets,
      authoritativeSheets,
      documentationSheets,
      preservedDocumentation: documentationTables.map(documentationSummary),
      diagnostics,
    };
  }

  if (hasAllCanonical) {
    const extraFields = document.tables.some((table) =>
      table.tableId === "Nodes" && Object.keys(table.records[0]?.fields ?? {}).some((field) => field === "Floor / Area" || field === "Department" || field === "Function" || field === "Training Note")
      || table.tableId === "Interfaces" && Object.keys(table.records[0]?.fields ?? {}).some((field) => field === "Addressing Note")
      || table.tableId === "Links" && Object.keys(table.records[0]?.fields ?? {}).some((field) => field === "Medium" || field === "Training Note")
      || table.tableId === "Zones" && Object.keys(table.records[0]?.fields ?? {}).some((field) => field === "Illustrative Subnet" || field === "Segmentation Note")
      || table.tableId === "Metadata" && Object.keys(table.records[0]?.fields ?? {}).some((field) => field === "notice" || field === "sourceUrl" || field === "scope"));
    const documentationSheets: string[] = [];
    const preservedDocumentation: PreservedDocumentationSheet[] = [];
    if (extraFields) {
      // The six-sheet profile is a documented legacy source. Its additional
      // columns are source documentation, not unknown declarations.
      diagnostics.push({
        code: "WORKBOOK_LEGACY_PROFILE_DETECTED",
        severity: "info",
        message: "Recognized canonical six-sheet legacy workbook; supported documentation columns will be preserved as source notes.",
      });
    }
    return {
      profile: extraFields ? "legacy-six" : "standard",
      document,
      originalSheets,
      authoritativeSheets: CANONICAL.slice(),
      documentationSheets,
      preservedDocumentation,
      diagnostics,
    };
  }

  return {
    profile: "standard",
    document,
    originalSheets,
    authoritativeSheets: [],
    documentationSheets: [],
    preservedDocumentation: [],
    diagnostics,
  };
}

export function canonicalWorkbookSourceNames(profile: LegacyWorkbookProfile): readonly string[] {
  return profile === "legacy-src-22" ? CANONICAL : profile === "legacy-six" || profile === "standard" ? CANONICAL : [];
}

export function sourceSheetForCanonicalName(name: string, profile: LegacyWorkbookProfile): string {
  return profile === "legacy-src-22" ? `SRC ${name}` : name;
}

export function isLegacyDocumentationField(table: string, field: string): boolean {
  const fields: Readonly<Record<string, readonly string[]>> = {
    Nodes: ["Floor / Area", "Department", "Function", "Training Note"],
    Interfaces: ["Addressing Note"],
    Links: ["Medium", "Training Note"],
    Zones: ["Illustrative Subnet", "Segmentation Note"],
    Metadata: ["notice", "sourceUrl", "scope"],
  };
  return fields[table]?.includes(field) ?? false;
}

export function documentationNotes(document: ImportDocument, profile: LegacyWorkbookProfile): readonly {
  readonly table: string;
  readonly record: ImportRecord;
  readonly field: string;
  readonly cell: ImportCell;
}[] {
  if (profile !== "legacy-six" && profile !== "legacy-src-22") return [];
  const canonicalBySource = new Map<string, string>();
  for (const canonical of CANONICAL) canonicalBySource.set(canonical, canonical);
  for (const canonical of CANONICAL) canonicalBySource.set(`SRC ${canonical}`, canonical);
  const notes: { table: string; record: ImportRecord; field: string; cell: ImportCell }[] = [];
  for (const table of document.tables) {
    const canonical = canonicalBySource.get(table.tableId);
    if (canonical) {
      for (const record of table.records) for (const [field, cell] of Object.entries(record.fields)) {
        if (isLegacyDocumentationField(canonical, field) && populated(cell.value)) notes.push({ table: canonical, record, field, cell });
      }
    } else if (profile === "legacy-src-22") {
      // Keep every populated cell from the sixteen documentation worksheets
      // as an explicit note. The note is source documentation only; it is
      // never projected to a resource, port, link, route or Engine fact.
      for (const record of table.records) for (const [field, cell] of Object.entries(record.fields)) {
        if (populated(cell.value)) notes.push({ table: table.tableId, record, field, cell });
      }
    }
  }
  return notes;
}

export function workbookCompatibilityInfo(document: ImportDocument): WorkbookCompatibility {
  return resolveWorkbookCompatibility(document);
}
