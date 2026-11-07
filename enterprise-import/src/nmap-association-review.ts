import type { NmapReadOnlyEvidence, NmapEvidenceLocator } from "./nmap-xml-preview.js";

/**
 * Only a snapshot of EXISTING Builder resources. A read-only evidence link is
 * never an imported resource, reachability result, Engine change, or device ID.
 */
export interface NmapModeledResource {
  readonly id: string;
  readonly label: string;
}
export interface NmapModelSnapshot {
  readonly scenarioId: string;
  readonly sourceRevision: number;
  readonly resources: readonly NmapModeledResource[];
}
export interface NmapManualAssociationDecision {
  readonly sourceSha256: string;
  readonly scenarioId: string;
  readonly sourceRevision: number;
  readonly associations: readonly { readonly hostOrdinal: number; readonly resourceId: string }[];
  readonly acknowledgeNotVerified: boolean;
}
export interface NmapReviewedAssociation {
  readonly hostLocator: NmapEvidenceLocator;
  readonly observedIpv4: string;
  readonly observedStatus: "up" | "down";
  readonly observedPortCount: number;
  readonly targetResourceId: string;
  readonly assertion: "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED";
}
export interface NmapAssociationSidecar {
  readonly formatId: "yadilab.nmap-observation-associations";
  readonly schemaVersion: "1.0.0";
  readonly status: "REVIEWED_ASSOCIATIONS_ONLY";
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
  readonly source: {
    readonly profileId: "nmap.xml.observations.v1";
    readonly sha256: string;
    readonly scanStart?: number;
  };
  readonly targetModel: {
    readonly scenarioId: string;
    readonly sourceRevision: number;
  };
  readonly associations: readonly NmapReviewedAssociation[];
  readonly warnings: readonly string[];
}
export interface NmapAssociationResult {
  readonly status: "READY_FOR_EXPORT" | "BLOCKED";
  readonly sidecar?: NmapAssociationSidecar;
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}

function blocked(code: string, message: string): NmapAssociationResult {
  return { status: "BLOCKED", diagnostics: [{ code, message }] };
}
const safeId = (text: unknown) =>
  typeof text === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/.test(text);
const safeRevision = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;

/**
 * No automatic IP/hostname equality guessing. Every association is
 * operator-selected and explicitly acknowledged. The result is a separate
 * evidence sidecar that is NEVER grafted into ScenarioSource or Engine.
 */
export function reviewNmapObservationAssociations(
  preview: NmapReadOnlyEvidence,
  modeled: NmapModelSnapshot | null,
  decision: NmapManualAssociationDecision,
): NmapAssociationResult {
  if (!preview || preview.profileId !== "nmap.xml.observations.v1" ||
      preview.semanticTrack !== "EVIDENCE_OBSERVED" ||
      preview.status !== "EVIDENCE_ONLY" || preview.canActivate !== false ||
      !/^[0-9a-f]{64}$/.test(preview.sourceSha256)) {
    return blocked("NMAP_ASSOC_SOURCE_INVALID", "A validated, read-only Nmap scan is required.");
  }
  if (!modeled || !safeId(modeled.scenarioId) || !safeRevision(modeled.sourceRevision) ||
      !Array.isArray(modeled.resources)) {
    return blocked("NMAP_ASSOC_BUILDER_REQUIRED", "Open an existing Builder scenario before associating evidence.");
  }
  if (!decision || decision.sourceSha256 !== preview.sourceSha256 ||
      decision.scenarioId !== modeled.scenarioId ||
      decision.sourceRevision !== modeled.sourceRevision) {
    return blocked("NMAP_ASSOC_STALE", "Nmap source or Builder identity changed since review.");
  }
  if (decision.acknowledgeNotVerified !== true) {
    return blocked("NMAP_ASSOC_ACK_REQUIRED", "Acknowledge that associations do not verify the asset identity.");
  }
  if (!Array.isArray(decision.associations) || decision.associations.length === 0 ||
      decision.associations.length > preview.hosts.length) {
    return blocked("NMAP_ASSOC_SELECTION_INVALID", "Choose at least one individually reviewed host association.");
  }
  const resources = new Set<string>();
  for (const entry of modeled.resources) {
    if (!entry || !safeId(entry.id) || resources.has(entry.id)) {
      return blocked("NMAP_ASSOC_MODEL_INVALID", "Modeled resources must have distinct valid identifiers.");
    }
    resources.add(entry.id);
  }
  const hosts = new Set<number>();
  const targets = new Set<string>();
  const associated: NmapReviewedAssociation[] = [];
  for (const entry of decision.associations) {
    if (!entry || !Number.isSafeInteger(entry.hostOrdinal) ||
        entry.hostOrdinal < 0 || entry.hostOrdinal >= preview.hosts.length ||
        !resources.has(entry.resourceId) || hosts.has(entry.hostOrdinal) || targets.has(entry.resourceId)) {
      return blocked("NMAP_ASSOC_SELECTION_INVALID", "Select distinct known hosts and distinct existing target resources.");
    }
    const host = preview.hosts[entry.hostOrdinal]!;
    if (host.locator.sourceSha256 !== preview.sourceSha256 ||
        host.locator.kind !== "nmap-host" || host.locator.hostOrdinal !== entry.hostOrdinal) {
      return blocked("NMAP_ASSOC_PROVENANCE_INVALID", "Host locator is not tied to the reviewed scan.");
    }
    hosts.add(entry.hostOrdinal);
    targets.add(entry.resourceId);
    associated.push({
      hostLocator: host.locator,
      observedIpv4: host.ipv4,
      observedStatus: host.observedStatus,
      observedPortCount: host.ports.length,
      targetResourceId: entry.resourceId,
      assertion: "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
    });
  }
  associated.sort((a, b) => a.hostLocator.hostOrdinal - b.hostLocator.hostOrdinal);
  return {
    status: "READY_FOR_EXPORT",
    diagnostics: [],
    sidecar: {
      formatId: "yadilab.nmap-observation-associations",
      schemaVersion: "1.0.0",
      status: "REVIEWED_ASSOCIATIONS_ONLY",
      engineVerified: false,
      physicalTopologyVerified: false,
      source: { profileId: "nmap.xml.observations.v1", sha256: preview.sourceSha256,
        ...(preview.scanStart === undefined ? {} : { scanStart: preview.scanStart }) },
      targetModel: { scenarioId: modeled.scenarioId, sourceRevision: modeled.sourceRevision },
      associations: associated,
      warnings: [
        "Manually associated scan observations; no physical identity, current reachability, port state, cable or Engine PASS has been independently verified.",
        "Association report is a separate local evidence sidecar. It has NOT changed Builder, ScenarioSource, network links or Engine state.",
      ],
    },
  };
}
