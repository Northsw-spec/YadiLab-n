import type { AnsibleStaticInventoryPreview, AnsibleInventoryLocator } from "./ansible-yaml-preview.js";

export const ANSIBLE_ASSOCIATION_FORMAT = "yadilab.ansible-inventory-associations" as const;
const MAX_REVIEWED_ASSOCIATIONS = 80;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const HEX = /^[0-9a-f]{64}$/;

export interface AnsibleModeledResource {
  readonly id: string;
  readonly label: string;
}
export interface AnsibleBuilderSnapshot {
  readonly scenarioId: string;
  readonly sourceRevision: number;
  readonly resources: readonly AnsibleModeledResource[];
}
export interface AnsibleAssociationDecision {
  readonly sourceSha256: string;
  readonly scenarioId: string;
  readonly sourceRevision: number;
  readonly associations: readonly { readonly hostOrdinal: number; readonly resourceId: string }[];
  readonly acknowledgeNotVerified: boolean;
}
export interface AnsibleReviewedAssociation {
  readonly hostOrdinal: number;
  readonly inventoryName: string;
  readonly reportedConnectionAddress?: string;
  readonly addressTruth: "REPORTED_NOT_VERIFIED" | "UNKNOWN";
  readonly groupPaths: readonly string[];
  readonly hostLocators: readonly AnsibleInventoryLocator[];
  readonly targetResourceId: string;
  readonly assertion: "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED";
}
export interface AnsibleAssociationSidecar {
  readonly formatId: typeof ANSIBLE_ASSOCIATION_FORMAT;
  readonly schemaVersion: "1.0.0";
  readonly status: "REVIEWED_ASSOCIATIONS_ONLY";
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
  readonly source: {
    readonly profileId: "ansible.inventory.static.yaml.v1";
    readonly sha256: string;
    readonly semanticTrack: "CONFIG_DOCUMENTED";
  };
  readonly targetModel: { readonly scenarioId: string; readonly sourceRevision: number };
  readonly associations: readonly AnsibleReviewedAssociation[];
  readonly warnings: readonly string[];
}
export interface AnsibleAssociationResult {
  readonly status: "READY_FOR_EXPORT" | "BLOCKED";
  readonly sidecar?: AnsibleAssociationSidecar;
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}
function blocked(code: string, message: string): AnsibleAssociationResult {
  return { status: "BLOCKED", diagnostics: [{ code, message }] };
}
const validId = (x: unknown): x is string => typeof x === "string" && ID.test(x) && !["__proto__", "prototype", "constructor"].includes(x);
const validRevision = (x: unknown) => Number.isSafeInteger(x) && (x as number) >= 0;

/**
 * Reviewed associations are human decisions, not Ansible execution or Engine
 * evidence. No secret vars, inferred links or automatic asset matching.
 * Caller MUST pass its current Builder snapshot immediately before export.
 */
export function reviewAnsibleInventoryAssociations(
  preview: AnsibleStaticInventoryPreview,
  model: AnsibleBuilderSnapshot | null,
  decision: AnsibleAssociationDecision,
): AnsibleAssociationResult {
  if (!preview || preview.profileId !== "ansible.inventory.static.yaml.v1" ||
      preview.status !== "REVIEW_REQUIRED" || preview.semanticTrack !== "CONFIG_DOCUMENTED" ||
      preview.canActivate !== false || !HEX.test(preview.sourceSha256) ||
      !Array.isArray(preview.hosts)) {
    return blocked("ANSIBLE_ASSOC_SOURCE_INVALID", "A validated read-only static Ansible inventory is required.");
  }
  if (!model || !validId(model.scenarioId) || !validRevision(model.sourceRevision) ||
      !Array.isArray(model.resources)) {
    return blocked("ANSIBLE_ASSOC_BUILDER_REQUIRED", "An existing Builder model is required.");
  }
  if (!decision || decision.sourceSha256 !== preview.sourceSha256 ||
      decision.scenarioId !== model.scenarioId ||
      decision.sourceRevision !== model.sourceRevision) {
    return blocked("ANSIBLE_ASSOC_STALE", "The inventory source or Builder identity changed since review.");
  }
  if (decision.acknowledgeNotVerified !== true) {
    return blocked("ANSIBLE_ASSOC_ACK_REQUIRED", "Acknowledge that inventory entries are not verified asset identities.");
  }
  if (!Array.isArray(decision.associations) || !decision.associations.length ||
      decision.associations.length > Math.min(preview.hosts.length, MAX_REVIEWED_ASSOCIATIONS)) {
    return blocked("ANSIBLE_ASSOC_SELECTION_INVALID", "Select 1–80 declared inventory hosts and existing modeled resources.");
  }
  const resourceIds = new Set<string>();
  for (const resource of model.resources) {
    if (!resource || !validId(resource.id) || resourceIds.has(resource.id) ||
        typeof resource.label !== "string") {
      return blocked("ANSIBLE_ASSOC_MODEL_INVALID", "Modeled resource identifiers must be unique and valid.");
    }
    resourceIds.add(resource.id);
  }
  const hostOrdinals = new Set<number>();
  const chosenTargets = new Set<string>();
  const associations: AnsibleReviewedAssociation[] = [];
  for (const selected of decision.associations) {
    if (!selected || !Number.isSafeInteger(selected.hostOrdinal) || selected.hostOrdinal < 0 ||
        selected.hostOrdinal >= preview.hosts.length ||
        !resourceIds.has(selected.resourceId) ||
        hostOrdinals.has(selected.hostOrdinal) || chosenTargets.has(selected.resourceId)) {
      return blocked("ANSIBLE_ASSOC_SELECTION_INVALID", "Selected declared source hosts and known modeled targets must be distinct.");
    }
    const host = preview.hosts[selected.hostOrdinal]!;
    if (!host || !validId(host.inventoryName) ||
        !Array.isArray(host.groupPaths) || !host.groupPaths.length ||
        !Array.isArray(host.locators) || host.locators.length !== host.groupPaths.length ||
        !["UNKNOWN", "REPORTED_NOT_VERIFIED"].includes(host.addressTruth) ||
        (host.addressTruth === "UNKNOWN" && host.reportedConnectionAddress !== undefined) ||
        (host.addressTruth === "REPORTED_NOT_VERIFIED" &&
          (typeof host.reportedConnectionAddress !== "string" || !host.reportedConnectionAddress.length))) {
      return blocked("ANSIBLE_ASSOC_PROVENANCE_INVALID", "Host record does not match the read-only inventory contract.");
    }
    const groups = new Set<string>();
    for (let i = 0; i < host.locators.length; i++) {
      const locator = host.locators[i];
      const group = host.groupPaths[i];
      if (!locator || locator.kind !== "ansible-yaml-host" ||
          locator.sourceSha256 !== preview.sourceSha256 ||
          locator.hostKey !== host.inventoryName || locator.groupPath !== group ||
          typeof group !== "string" || !group.startsWith("all") ||
          groups.has(group)) {
        return blocked("ANSIBLE_ASSOC_PROVENANCE_INVALID", "Original YAML host and group locators must match.");
      }
      groups.add(group);
    }
    hostOrdinals.add(selected.hostOrdinal);
    chosenTargets.add(selected.resourceId);
    associations.push({
      hostOrdinal: selected.hostOrdinal,
      inventoryName: host.inventoryName,
      ...(host.reportedConnectionAddress === undefined ? {} :
        { reportedConnectionAddress: host.reportedConnectionAddress }),
      addressTruth: host.addressTruth,
      groupPaths: [...host.groupPaths],
      hostLocators: host.locators.map((l: AnsibleInventoryLocator) => ({ ...l })),
      targetResourceId: selected.resourceId,
      assertion: "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
    });
  }
  associations.sort((a, b) => a.hostOrdinal - b.hostOrdinal);
  return {
    status: "READY_FOR_EXPORT",
    diagnostics: [],
    sidecar: {
      formatId: ANSIBLE_ASSOCIATION_FORMAT,
      schemaVersion: "1.0.0",
      status: "REVIEWED_ASSOCIATIONS_ONLY",
      engineVerified: false,
      physicalTopologyVerified: false,
      source: { profileId: "ansible.inventory.static.yaml.v1",
        sha256: preview.sourceSha256, semanticTrack: "CONFIG_DOCUMENTED" },
      targetModel: { scenarioId: model.scenarioId, sourceRevision: model.sourceRevision },
      associations,
      warnings: [
        "Human-selected inventory-to-model references are NOT verified asset identities, network addresses, physical cables, current reachability, routes or Engine PASS.",
        "This separate JSON sidecar did NOT mutate Builder, ScenarioSource, resource properties, links or Engine state. Host/group variables and credentials are deliberately excluded.",
      ],
    },
  };
}
