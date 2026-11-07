/**
 * CORE-001: vocabulary for not-yet-supported external source profiles.
 *
 * This is deliberately NOT the EnterpriseImportAdapter registry and never
 * authorizes parsing, import, scenario activation or Engine mutations.
 * Filename suffixes are hints ONLY. A future enabled adapter must separately
 * validate the actual file signature, structure, producer variant and schema.
 *
 * Existing JSON/CSV/TSV/XLSX/ODS adapters remain the sole active adapters.
 */
export type ExternalSourceTrack = "TOPOLOGY_DECLARED" | "CONFIG_DOCUMENTED" | "EVIDENCE_OBSERVED";

export interface PlannedExternalSourceProfile {
  readonly profileId: string;
  readonly semanticTrack: ExternalSourceTrack;
  readonly suffixes: readonly string[];
}

const profile = (
  profileId: string,
  semanticTrack: ExternalSourceTrack,
  suffixes: readonly string[],
): PlannedExternalSourceProfile => Object.freeze({
  profileId,
  semanticTrack,
  suffixes: Object.freeze([...suffixes]),
});

export const plannedExternalSourceProfiles: readonly PlannedExternalSourceProfile[] = Object.freeze([
  profile("graphml.structural.v1", "TOPOLOGY_DECLARED", [".graphml"]),
  profile("nmap.xml.v1", "EVIDENCE_OBSERVED", [".xml"]),
  profile("nessus.xml.v1", "EVIDENCE_OBSERVED", [".nessus", ".xml"]),
  profile("diagrams.drawio.v1", "TOPOLOGY_DECLARED", [".drawio", ".xml"]),
  profile("visio.vsdx.v1", "TOPOLOGY_DECLARED", [".vsdx"]),
  profile("gns3.project.v1", "TOPOLOGY_DECLARED", [".gns3", ".gns3project"]),
  profile("eve-ng.unl.v1", "TOPOLOGY_DECLARED", [".unl"]),
  profile("cisco-cml.yaml.v1", "TOPOLOGY_DECLARED", [".yaml", ".yml"]),
  profile("inventory.yaml.v1", "CONFIG_DOCUMENTED", [".yaml", ".yml"]),
  profile("ansible.inventory.ini.v1", "CONFIG_DOCUMENTED", [".ini"]),
  profile("configuration.text.v1", "CONFIG_DOCUMENTED", [".cfg", ".conf", ".txt"]),
  profile("office.docx-tables.v1", "CONFIG_DOCUMENTED", [".docx"]),
  profile("office.odt-tables.v1", "CONFIG_DOCUMENTED", [".odt"]),
  profile("pdf.digital-tables.v1", "CONFIG_DOCUMENTED", [".pdf"]),
  profile("terraform.hcl.v1", "CONFIG_DOCUMENTED", [".tf"]),
  profile("terraform.state.v1", "CONFIG_DOCUMENTED", [".tfstate"]),
  profile("capture.pcap.v1", "EVIDENCE_OBSERVED", [".pcap", ".pcapng"]),
  profile("windows.evtx.v1", "EVIDENCE_OBSERVED", [".evtx"]),
  profile("logs.jsonl.v1", "EVIDENCE_OBSERVED", [".jsonl"]),
  profile("logs.text.v1", "EVIDENCE_OBSERVED", [".log", ".txt"]),
  profile("html.static-tables.v1", "CONFIG_DOCUMENTED", [".html", ".htm"]),
]);

export type PlannedProfileBlockCode =
  | "IMPORT_PROFILE_FILENAME_INVALID"
  | "IMPORT_PROFILE_UNKNOWN"
  | "IMPORT_PROFILE_NOT_IMPLEMENTED"
  | "IMPORT_PROFILE_AMBIGUOUS"
  | "IMPORT_PROFILE_EXTENSION_MISMATCH";

export interface PlannedProfileBlockedResult {
  readonly status: "BLOCKED";
  readonly code: PlannedProfileBlockCode;
  readonly candidateProfileIds: readonly string[];
}

/**
 * Human-readable discovery of PLANNED formats, never an import authorization.
 * No bytes are read; content signatures MUST be checked by any future parser.
 */
export function inspectPlannedExternalSource(
  filename: string,
  explicitProfileId?: string,
): PlannedProfileBlockedResult {
  const blocked = (code: PlannedProfileBlockCode, matches: readonly string[] = []): PlannedProfileBlockedResult =>
    Object.freeze({ status: "BLOCKED" as const, code, candidateProfileIds: Object.freeze([...matches]) });
  if (typeof filename !== "string" || !filename.trim() || filename.includes("\0")) {
    return blocked("IMPORT_PROFILE_FILENAME_INVALID");
  }
  const name = filename.replaceAll("\\", "/").split("/").at(-1)!.toLowerCase();
  const candidates = plannedExternalSourceProfiles.filter((item) => item.suffixes.some((suffix) => name.endsWith(suffix)));
  if (explicitProfileId !== undefined) {
    const selected = plannedExternalSourceProfiles.find((item) => item.profileId === explicitProfileId);
    if (!selected) return blocked("IMPORT_PROFILE_UNKNOWN");
    if (!candidates.some((item) => item.profileId === selected.profileId)) return blocked("IMPORT_PROFILE_EXTENSION_MISMATCH");
    return blocked("IMPORT_PROFILE_NOT_IMPLEMENTED", [selected.profileId]);
  }
  if (candidates.length === 0) return blocked("IMPORT_PROFILE_UNKNOWN");
  if (candidates.length > 1) return blocked("IMPORT_PROFILE_AMBIGUOUS", candidates.map((item) => item.profileId).sort());
  return blocked("IMPORT_PROFILE_NOT_IMPLEMENTED", [candidates[0]!.profileId]);
}
