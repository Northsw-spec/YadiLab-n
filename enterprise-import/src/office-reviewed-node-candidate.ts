import type { ScenarioSource } from "../../core-model/src/generated/contracts.js";
import type { ImportCell, ImportDocument, ImportRecord } from "./types.js";
import { EnterpriseImportError } from "./types.js";
import { previewDocxTableStructure, type DocxTableCellLocator } from "./docx-tables-structural-preview.js";
import { previewOdtTableStructure, type OdtCellLocator } from "./odt-tables-structural-preview.js";
import { discloseReviewedDocxCell } from "./docx-cell-disclosure.js";
import { discloseReviewedOdtCell } from "./odt-cell-disclosure.js";
import { GRAPHML_MANUAL_ROLE_OPTIONS, type GraphmlManualRole } from "./graphml-review-mapping.js";
import { mapNetworkWorkbookToScenario } from "./workbook-mapping.js";

/** IC-040 P1a: source-only, NOT wired to the UI, Builder activation or Engine. */
export const OFFICE_REVIEWED_NODES_PROFILE = "office.reviewed-nodes.v1" as const;
export const OFFICE_REVIEWED_NODES_MAX = 4;
const VALID_SHA = /^[a-f0-9]{64}$/;
const VALID_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const ordinal = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const exactKeys = (v: unknown, keys: readonly string[]): boolean =>
  !!v && typeof v === "object" && !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === [...keys].sort().join(",");

export interface OfficeReviewedNodeSelection {
  readonly tableOrdinal: number;
  /** Deliberate user selection of a single original source row, never the header. */
  readonly rowOrdinal: number;
  readonly nodeIdCellOrdinal: number;
  /** User-chosen modeled role, not something inferred from document labels. */
  readonly role: GraphmlManualRole;
  readonly acknowledgeCell: boolean;
}
export interface OfficeReviewedNodesDecision {
  readonly format: "docx" | "odt";
  readonly sourceSha256: string;
  readonly nodes: readonly OfficeReviewedNodeSelection[];
  /** Separate affirmative interpretation as a modeled resource (not an actual host). */
  readonly acknowledgeModeledResources: boolean;
}
export type OfficeOriginalLocator = DocxTableCellLocator | OdtCellLocator;
export interface OfficeReviewedNodeOrigin {
  readonly targetId: string;
  readonly locator: OfficeOriginalLocator;
  readonly decision: "USER_CONSENTED_ID_CELL_AND_ROLE";
}
export interface OfficeReviewedNodesCandidate {
  readonly status: "READY_FOR_COMPILATION" | "BLOCKED";
  readonly profileId: typeof OFFICE_REVIEWED_NODES_PROFILE;
  readonly sourceSha256: string;
  readonly source?: ScenarioSource;
  readonly origins: readonly OfficeReviewedNodeOrigin[];
  readonly selectedResources: number;
  readonly canActivate: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
  readonly diagnostics: readonly { readonly code: string }[];
}
function blocked(sha: string, code: string): OfficeReviewedNodesCandidate {
  return {
    status: "BLOCKED", profileId: OFFICE_REVIEWED_NODES_PROFILE, sourceSha256: sha,
    origins: [], selectedResources: 0, canActivate: false, engineVerified: false,
    physicalTopologyVerified: false, diagnostics: [{ code }],
  };
}
const cell = (value: string, sheet: string, row: number, column: string): ImportCell =>
  ({ value, locator: { kind: "table-cell", sheet, row, column } });
const record = (sheet: string, row: number, values: Readonly<Record<string, string>>): ImportRecord =>
  ({ recordIndex: row, fields: Object.fromEntries(Object.entries(values).map(([key, value]) =>
      [key, cell(value, sheet, row, key)])) });

/**
 * Consume only explicitly approved source cells. Original DOCX/ODT P1/P3 guards,
 * credential checks and package budgets are re-executed for each selected cell.
 * No bulk table text is read, accepted from the caller, or exported.
 */
export async function mapReviewedOfficeOriginalToNodes(
  original: Uint8Array,
  decision: OfficeReviewedNodesDecision,
  maxNodes: 4 | 6 | 8 | 10 | 12 = OFFICE_REVIEWED_NODES_MAX,
): Promise<OfficeReviewedNodesCandidate> {
  const sha = typeof decision?.sourceSha256 === "string" && VALID_SHA.test(decision.sourceSha256)
    ? decision.sourceSha256 : "";
  if (!(original instanceof Uint8Array) || !exactKeys(decision,
      ["format", "sourceSha256", "nodes", "acknowledgeModeledResources"]) ||
      (decision.format !== "docx" && decision.format !== "odt") || !sha ||
      decision.acknowledgeModeledResources !== true ||
      !Array.isArray(decision.nodes) || decision.nodes.length < 1 ||
      decision.nodes.length > maxNodes) {
    return blocked(sha, "IC040_P1A_DECISION_INVALID");
  }
  const seenRows = new Set<string>();
  for (const node of decision.nodes) {
    if (!exactKeys(node, ["tableOrdinal", "rowOrdinal", "nodeIdCellOrdinal", "role", "acknowledgeCell"]) ||
        !ordinal(node.tableOrdinal) || !ordinal(node.rowOrdinal) || node.rowOrdinal === 0 ||
        !ordinal(node.nodeIdCellOrdinal) ||
        node.acknowledgeCell !== true ||
        !GRAPHML_MANUAL_ROLE_OPTIONS.includes(node.role)) {
      return blocked(sha, "IC040_P1A_NODE_DECISION_INVALID");
    }
    const rowKey = node.tableOrdinal + ":" + node.rowOrdinal;
    if (seenRows.has(rowKey)) return blocked(sha, "IC040_P1A_DUPLICATE_ROW");
    seenRows.add(rowKey);
  }
  try {
    // Validate original package, strict XML grammar and source-bound table
    // structure before any deliberate cell disclosure. Do not trust filename.
    const preview = decision.format === "docx"
      ? await previewDocxTableStructure(original) : await previewOdtTableStructure(original);
    if (preview.sourceSha256 !== sha) return blocked(sha, "IC040_P1A_SOURCE_CHANGED");
    const rows: ImportRecord[] = [];
    const origins: OfficeReviewedNodeOrigin[] = [];
    const ids = new Set<string>();
    for (const [index, node] of decision.nodes.entries()) {
      const chosen = preview.tables[node.tableOrdinal]?.rows[node.rowOrdinal]?.cells[node.nodeIdCellOrdinal];
      if (!chosen) return blocked(sha, "IC040_P1A_CELL_NOT_FOUND");
      // P3 disclosure rechecks the exact SHA, source structure and secret-looking
      // cell, row header and column heading. Only this one explicit cell is read.
      const exposed = decision.format === "docx"
        ? await discloseReviewedDocxCell(original, sha, chosen.locator as DocxTableCellLocator, true)
        : await discloseReviewedOdtCell(original, sha, chosen.locator as OdtCellLocator, true);
      if (exposed.sourceSha256 !== sha || !VALID_ID.test(exposed.text))
        return blocked(sha, "IC040_P1A_NODE_ID_INVALID");
      if (ids.has(exposed.text)) return blocked(sha, "IC040_P1A_DUPLICATE_NODE_ID");
      ids.add(exposed.text);
      rows.push(record("Nodes", index + 1, {
        nodeId: exposed.text, displayName: exposed.text, type: node.role,
      }));
      origins.push({
        targetId: exposed.text,
        locator: Object.freeze({ ...exposed.locator }),
        decision: "USER_CONSENTED_ID_CELL_AND_ROLE",
      });
    }
    const doc: ImportDocument = { tables: [
      { tableId: "Metadata", records: [record("Metadata", 1, {
        scenarioId: "office_reviewed", title: "Explicitly reviewed office network nodes",
        description: "Source-only modeled nodes. No imported physical cables, interfaces, routes or probes.",
      })] },
      { tableId: "Nodes", records: rows },
    ] };
    const mapped = mapNetworkWorkbookToScenario(doc);
    if (!mapped.ok || !mapped.source || mapped.source.connections.length ||
        mapped.source.resources.length !== rows.length) {
      return blocked(sha, "IC040_P1A_WORKBOOK_BLOCKED");
    }
    // Override the generic importer's tautological resource.type objective.
    // This property is intentionally unset: no imported Engine PASS.
    const condition = {
      op: "equals" as const, target: mapped.source.resources[0]!.id,
      path: "office_manual_verification", value: "VERIFIED",
    };
    const source: ScenarioSource = {
      ...mapped.source,
      objectives: [{
        id: "office_manual_verification", title: "Verify modeled devices independently",
        category: "import-review", required: true, condition,
      }],
      completion: condition,
      notes: [{
        id: "office_source_boundary",
        title: "DOCX/ODT source and non-verification boundary",
        text: `Source SHA-256: ${sha}; ${rows.length} explicitly consented node-ID cell(s) and operator roles. No other source cell, physical cable, IP, OS, device identity, reachability, Runtime or Engine PASS independently verified.`,
      }],
    };
    return {
      status: "READY_FOR_COMPILATION", profileId: OFFICE_REVIEWED_NODES_PROFILE,
      sourceSha256: sha, source, origins: Object.freeze(origins),
      selectedResources: rows.length, canActivate: false, engineVerified: false,
      physicalTopologyVerified: false, diagnostics: [],
    };
  } catch (error) {
    const code = error instanceof EnterpriseImportError && /^(?:DOCX_|ODT_|IMPORT_)[A-Z0-9_]+$/.test(error.code)
      ? error.code : "IC040_P1A_SOURCE_BLOCKED";
    return blocked(sha, code);
  }
}
