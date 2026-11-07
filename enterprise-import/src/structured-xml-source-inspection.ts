import { previewGraphmlReadOnly } from "./graphml-preview.js";
import { previewNmapXmlObservations } from "./nmap-xml-preview.js";
import { previewNessusSeveritySummary } from "./nessus-v2-preview.js";
import { previewDrawioStructure } from "./drawio-structural-preview.js";
import { EnterpriseImportError } from "./types.js";
import type { ExternalSourceTrack } from "./planned-format-profiles.js";

/**
 * IC-010/P1: strict, metadata-only, read-only source-profile identification.
 * This is NOT an enterprise import adapter, scenario projection, or UI consent.
 * The existing complete bounded profile parsers are the only content oracles.
 */
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export type ReadOnlyXmlProfileId =
  | "graphml.structural.v1"
  | "nmap.xml.v1"
  | "nessus.xml.v1"
  | "diagrams.drawio.v1";

export type XmlSourceSummary =
  | Readonly<{ kind: "GRAPH_STRUCTURE"; nodes: number; graphEdges: number }>
  | Readonly<{ kind: "NMAP_OBSERVATIONS"; observedHosts: number; reportedPorts: number }>
  | Readonly<{ kind: "NESSUS_REPORT"; reportedHosts: number; reportedFindings: number }>
  | Readonly<{ kind: "DRAWIO_DIAGRAM"; pages: number; vertices: number; drawnEdges: number }>;

export interface OriginalXmlSourceLocator {
  readonly kind: "source-document";
  readonly profileId: ReadOnlyXmlProfileId;
  readonly sourceSha256: string;
}

export type XmlSourceBlockedCode =
  | "IC010_XML_FILENAME_INVALID"
  | "IC010_XML_SOURCE_SIZE_INVALID"
  | "IC010_XML_EXTENSION_UNSUPPORTED"
  | "IC010_XML_PROFILE_UNSUPPORTED"
  | "IC010_XML_PROFILE_EXTENSION_MISMATCH"
  | "IC010_XML_CONTENT_UNRECOGNIZED"
  | "IC010_XML_CONTENT_AMBIGUOUS";

export interface BlockedXmlSource {
  readonly status: "BLOCKED";
  readonly code: XmlSourceBlockedCode;
  readonly candidateProfileIds: readonly ReadOnlyXmlProfileId[];
  readonly canActivate: false;
  readonly modelMutated: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
}

export interface InspectedXmlSource {
  readonly status: "REVIEW_REQUIRED" | "EVIDENCE_ONLY" | "PREVIEW_ONLY";
  readonly profileId: ReadOnlyXmlProfileId;
  readonly semanticTrack: ExternalSourceTrack;
  readonly sourceSha256: string;
  readonly documentLocator: OriginalXmlSourceLocator;
  readonly summary: XmlSourceSummary;
  readonly canActivate: false;
  readonly modelMutated: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
}

export type ReadOnlyXmlInspection = BlockedXmlSource | InspectedXmlSource;

interface Candidate {
  readonly id: ReadOnlyXmlProfileId;
  readonly suffixes: readonly string[];
  readonly inspect: (bytes: Uint8Array) => Promise<Pick<
    InspectedXmlSource,
    "status" | "semanticTrack" | "sourceSha256" | "summary"
  >>;
}

const CANDIDATES: readonly Candidate[] = Object.freeze([
  {
    id: "graphml.structural.v1",
    suffixes: Object.freeze([".graphml"]),
    async inspect(bytes) {
      const preview = await previewGraphmlReadOnly(bytes);
      return {
        status: preview.status,
        semanticTrack: preview.semanticTrack,
        sourceSha256: preview.sourceSha256,
        summary: Object.freeze({ kind: "GRAPH_STRUCTURE" as const, nodes: preview.nodes.length, graphEdges: preview.edges.length }),
      };
    },
  },
  {
    id: "nmap.xml.v1",
    suffixes: Object.freeze([".xml"]),
    async inspect(bytes) {
      const preview = await previewNmapXmlObservations(bytes);
      return {
        status: preview.status,
        semanticTrack: preview.semanticTrack,
        sourceSha256: preview.sourceSha256,
        summary: Object.freeze({ kind: "NMAP_OBSERVATIONS" as const, observedHosts: preview.hosts.length, reportedPorts: preview.observationsCount }),
      };
    },
  },
  {
    id: "nessus.xml.v1",
    suffixes: Object.freeze([".nessus", ".xml"]),
    async inspect(bytes) {
      const preview = await previewNessusSeveritySummary(bytes);
      return {
        status: preview.status,
        semanticTrack: preview.semanticTrack,
        sourceSha256: preview.sourceSha256,
        summary: Object.freeze({ kind: "NESSUS_REPORT" as const, reportedHosts: preview.hostCount, reportedFindings: preview.findingCount }),
      };
    },
  },
  {
    id: "diagrams.drawio.v1",
    suffixes: Object.freeze([".drawio", ".xml"]),
    async inspect(bytes) {
      const preview = await previewDrawioStructure(bytes);
      return {
        status: preview.status,
        semanticTrack: preview.semanticTrack,
        sourceSha256: preview.sourceSha256,
        summary: Object.freeze({ kind: "DRAWIO_DIAGRAM" as const, pages: preview.pageCount, vertices: preview.vertexCount, drawnEdges: preview.drawnEdgeCount }),
      };
    },
  },
]);

const TRUTH_BARRIERS = Object.freeze({
  canActivate: false as const,
  modelMutated: false as const,
  engineVerified: false as const,
  physicalTopologyVerified: false as const,
});

function blocked(code: XmlSourceBlockedCode, ids: readonly ReadOnlyXmlProfileId[] = []): BlockedXmlSource {
  return Object.freeze({
    status: "BLOCKED" as const,
    code,
    candidateProfileIds: Object.freeze([...ids]),
    ...TRUTH_BARRIERS,
  });
}

/**
 * Return safe, non-sensitive metadata after *full producer-specific parsing*.
 * An ordinary failed parser match returns a fixed BLOCKED code, not its
 * potentially source-containing exception message. Unexpected operational
 * failures propagate (and must never be reported as a valid source).
 *
 * Only suffixes in this bounded XML subset are examined. Generic YAML/JSON,
 * arbitrary XML, future formats and the active five adapters are untouched.
 */
export async function inspectStructuredXmlSourceReadOnly(
  filename: string,
  originalBytes: Uint8Array,
  explicitProfileId?: string,
): Promise<ReadOnlyXmlInspection> {
  if (typeof filename !== "string" || !filename.trim() || filename.length > 255 ||
      filename !== filename.trim() || /[\\/\u0000-\u001f\u007f]/.test(filename) ||
      filename === "." || filename === "..") {
    return blocked("IC010_XML_FILENAME_INVALID");
  }
  if (!(originalBytes instanceof Uint8Array) ||
      originalBytes.byteLength === 0 || originalBytes.byteLength > MAX_SOURCE_BYTES) {
    return blocked("IC010_XML_SOURCE_SIZE_INVALID");
  }
  const lowerName = filename.toLowerCase();
  const supported = CANDIDATES.filter(item => item.suffixes.some(ext => lowerName.endsWith(ext)));
  if (supported.length === 0) return blocked("IC010_XML_EXTENSION_UNSUPPORTED");
  let selected = supported;
  if (explicitProfileId !== undefined) {
    const known = CANDIDATES.find(item => item.id === explicitProfileId);
    if (!known) return blocked("IC010_XML_PROFILE_UNSUPPORTED");
    if (!supported.includes(known)) return blocked("IC010_XML_PROFILE_EXTENSION_MISMATCH");
    selected = [known];
  }
  // Copy before the first await: callers cannot change the bytes beneath
  // signature validation and source hashing while inspection is in progress.
  const snapshot = Uint8Array.from(originalBytes);
  const matches: Array<{ id: ReadOnlyXmlProfileId; result: Awaited<ReturnType<Candidate["inspect"]>> }> = [];
  for (const candidate of selected) {
    try {
      const result = await candidate.inspect(snapshot);
      matches.push({ id: candidate.id, result });
    } catch (error) {
      if (!(error instanceof EnterpriseImportError)) throw error;
      // A malformed, wrong-producer, unsafe or unsupported XML structure is
      // merely not a verified match. Do not expose raw parser error messages.
    }
  }
  if (matches.length === 0) return blocked("IC010_XML_CONTENT_UNRECOGNIZED", selected.map(item => item.id));
  if (matches.length !== 1) return blocked("IC010_XML_CONTENT_AMBIGUOUS", matches.map(item => item.id));
  const match = matches[0]!;
  return Object.freeze({
    status: match.result.status,
    profileId: match.id,
    semanticTrack: match.result.semanticTrack,
    sourceSha256: match.result.sourceSha256,
    documentLocator: Object.freeze({
      kind: "source-document" as const,
      profileId: match.id,
      sourceSha256: match.result.sourceSha256,
    }),
    summary: match.result.summary,
    ...TRUTH_BARRIERS,
  });
}
