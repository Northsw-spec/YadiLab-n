import type { AnsibleIniPreview, AnsibleIniHostLocator } from "./ansible-ini-preview.js";

export const ANSIBLE_INI_ASSOCIATION_FORMAT = "yadilab.ansible-ini-inventory-associations" as const;
const MAX_REVIEWED_ASSOCIATIONS = 80;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const HOST = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const HEX = /^[0-9a-f]{64}$/;
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);
const validId = (v: unknown): v is string => typeof v === "string" && ID.test(v) && !FORBIDDEN.has(v);
const validHost = (v: unknown): v is string => typeof v === "string" && HOST.test(v) && !FORBIDDEN.has(v) && v !== "ungrouped";
const validRevision = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

export interface AnsibleIniBuilderSnapshot {
  readonly scenarioId: string;
  readonly sourceRevision: number;
  readonly resources: readonly { readonly id: string; readonly label: string }[];
}
export interface AnsibleIniAssociationDecision {
  readonly sourceSha256: string;
  readonly scenarioId: string;
  readonly sourceRevision: number;
  readonly acknowledgeNotVerified: boolean;
  readonly associations: readonly { readonly hostOrdinal: number; readonly resourceId: string }[];
}
export interface AnsibleIniReviewedAssociation {
  readonly hostOrdinal: number;
  readonly inventoryName: string;
  readonly reportedConnectionAddress?: string;
  readonly addressTruth: "REPORTED_NOT_VERIFIED" | "UNKNOWN";
  readonly directGroups: readonly string[];
  readonly hostLocators: readonly AnsibleIniHostLocator[];
  readonly targetResourceId: string;
  readonly assertion: "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED";
}
export interface AnsibleIniAssociationSidecar {
  readonly formatId: typeof ANSIBLE_INI_ASSOCIATION_FORMAT;
  readonly schemaVersion: "1.0.0";
  readonly status: "REVIEWED_ASSOCIATIONS_ONLY";
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
  readonly source: {
    readonly profileId: "ansible.inventory.static.ini.v1";
    readonly sha256: string;
    readonly semanticTrack: "CONFIG_DOCUMENTED";
  };
  readonly targetModel: { readonly scenarioId: string; readonly sourceRevision: number };
  readonly associations: readonly AnsibleIniReviewedAssociation[];
  readonly warnings: readonly string[];
}
export interface AnsibleIniAssociationResult {
  readonly status: "READY_FOR_EXPORT" | "BLOCKED";
  readonly sidecar?: AnsibleIniAssociationSidecar;
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}
function block(code: string, message: string): AnsibleIniAssociationResult {
  return { status: "BLOCKED", diagnostics: [{ code, message }] };
}
/**
 * Pure operator-review gate. Does not run Ansible, infer asset identity, mutate
 * the Builder or activate the Engine. Call with CURRENT Builder snapshot at export.
 */
export function reviewAnsibleIniInventoryAssociations(
  preview: AnsibleIniPreview,
  model: AnsibleIniBuilderSnapshot | null,
  decision: AnsibleIniAssociationDecision,
): AnsibleIniAssociationResult {
  if (!preview || preview.profileId !== "ansible.inventory.static.ini.v1" ||
      preview.status !== "REVIEW_REQUIRED" || preview.canActivate !== false ||
      preview.semanticTrack !== "CONFIG_DOCUMENTED" || !HEX.test(preview.sourceSha256) ||
      !Array.isArray(preview.hosts) || !Array.isArray(preview.groupNames) ||
      !preview.groupChildren || typeof preview.groupChildren !== "object") {
    return block("ANSIBLE_INI_ASSOC_SOURCE_INVALID", "A validated read-only static INI inventory is required.");
  }
  if (!model || !validId(model.scenarioId) || !validRevision(model.sourceRevision) ||
      !Array.isArray(model.resources)) {
    return block("ANSIBLE_INI_ASSOC_BUILDER_REQUIRED", "An existing Builder model is required.");
  }
  if (!decision || decision.sourceSha256 !== preview.sourceSha256 ||
      decision.scenarioId !== model.scenarioId ||
      decision.sourceRevision !== model.sourceRevision) {
    return block("ANSIBLE_INI_ASSOC_STALE", "Inventory source or Builder identity changed during review.");
  }
  if (decision.acknowledgeNotVerified !== true) {
    return block("ANSIBLE_INI_ASSOC_ACK_REQUIRED", "Explicit acknowledgment of unverified identities is required.");
  }
  if (!Array.isArray(decision.associations) || !decision.associations.length ||
      decision.associations.length > Math.min(preview.hosts.length, MAX_REVIEWED_ASSOCIATIONS)) {
    return block("ANSIBLE_INI_ASSOC_SELECTION_INVALID", "Select 1–80 declared source hosts and corresponding existing modeled resources.");
  }
  const resourceIds = new Set<string>();
  for (const r of model.resources) {
    if (!r || !validId(r.id) || typeof r.label !== "string" || resourceIds.has(r.id)) {
      return block("ANSIBLE_INI_ASSOC_MODEL_INVALID", "Modeled resource IDs must be unique and valid.");
    }
    resourceIds.add(r.id);
  }
  const visibleOrdinals = new Set<number>();
  const chosenTargets = new Set<string>();
  const associations: AnsibleIniReviewedAssociation[] = [];
  for (const choice of decision.associations) {
    if (!choice || !Number.isSafeInteger(choice.hostOrdinal) ||
        choice.hostOrdinal < 0 || choice.hostOrdinal >= preview.hosts.length ||
        !resourceIds.has(choice.resourceId) ||
        visibleOrdinals.has(choice.hostOrdinal) || chosenTargets.has(choice.resourceId)) {
      return block("ANSIBLE_INI_ASSOC_SELECTION_INVALID", "Source hosts must be declared; selected modeled targets and source ordinals must be distinct.");
    }
    const host = preview.hosts[choice.hostOrdinal]!;
    if (!host || !validHost(host.inventoryName) ||
        !Array.isArray(host.directGroups) || !Array.isArray(host.locators) ||
        !host.locators.length ||
        !["UNKNOWN", "REPORTED_NOT_VERIFIED"].includes(host.addressTruth) ||
        (host.addressTruth === "UNKNOWN" && host.reportedConnectionAddress !== undefined) ||
        (host.addressTruth === "REPORTED_NOT_VERIFIED" &&
          (typeof host.reportedConnectionAddress !== "string" ||
           host.reportedConnectionAddress.length === 0))) {
      return block("ANSIBLE_INI_ASSOC_PROVENANCE_INVALID", "Inventory host or address-truth contract is invalid.");
    }
    const seenGroups = new Set<string>();
    for (const group of host.directGroups) {
      if (!validHost(group) || !preview.groupNames.includes(group) || seenGroups.has(group)) {
        return block("ANSIBLE_INI_ASSOC_PROVENANCE_INVALID", "Invalid or duplicated directly declared group.");
      }
      seenGroups.add(group);
    }
    let previousLine = 0;
    const locatedGroups = new Set<string>();
    let ungroupedCount = 0;
    for (const locator of host.locators) {
      if (!locator || locator.kind !== "ansible-ini-host" ||
          locator.sourceSha256 !== preview.sourceSha256 ||
          locator.hostKey !== host.inventoryName ||
          !Number.isSafeInteger(locator.lineNumber) || locator.lineNumber < 1 ||
          locator.lineNumber <= previousLine ||
          typeof locator.section !== "string") {
        return block("ANSIBLE_INI_ASSOC_PROVENANCE_INVALID", "Original typed source locator must match the INI record.");
      }
      previousLine = locator.lineNumber;
      if (locator.section === "ungrouped") {
        ungroupedCount++;
      } else if (!seenGroups.has(locator.section) || locatedGroups.has(locator.section)) {
        return block("ANSIBLE_INI_ASSOC_PROVENANCE_INVALID", "Source locator section and direct membership conflict.");
      } else {
        locatedGroups.add(locator.section);
      }
    }
    if (ungroupedCount > 1 || locatedGroups.size !== seenGroups.size ||
        (host.directGroups.length === 0 && ungroupedCount !== 1) ||
        host.locators.length !== host.directGroups.length + ungroupedCount) {
      return block("ANSIBLE_INI_ASSOC_PROVENANCE_INVALID", "All original INI host occurrences must be retained.");
    }
    visibleOrdinals.add(choice.hostOrdinal);
    chosenTargets.add(choice.resourceId);
    associations.push({
      hostOrdinal: choice.hostOrdinal,
      inventoryName: host.inventoryName,
      ...(host.reportedConnectionAddress === undefined ? {} :
        { reportedConnectionAddress: host.reportedConnectionAddress }),
      addressTruth: host.addressTruth,
      directGroups: [...host.directGroups],
      hostLocators: host.locators.map((l: AnsibleIniHostLocator) => ({ ...l })),
      targetResourceId: choice.resourceId,
      assertion: "USER_ASSERTED_ASSOCIATION_NOT_VERIFIED",
    });
  }
  associations.sort((a,b) => a.hostOrdinal - b.hostOrdinal);
  return {
    status: "READY_FOR_EXPORT", diagnostics: [],
    sidecar: {
      formatId: ANSIBLE_INI_ASSOCIATION_FORMAT,
      schemaVersion: "1.0.0",
      status: "REVIEWED_ASSOCIATIONS_ONLY",
      engineVerified: false,
      physicalTopologyVerified: false,
      source: { profileId: "ansible.inventory.static.ini.v1",
        sha256: preview.sourceSha256, semanticTrack: "CONFIG_DOCUMENTED" },
      targetModel: { scenarioId: model.scenarioId, sourceRevision: model.sourceRevision },
      associations,
      warnings: [
        "Human-selected inventory-to-model references are NOT verified asset identities, network addresses, physical cables, reachability, routes or Engine PASS.",
        "This independent sidecar did NOT mutate Builder, ScenarioSource, resources, links or Engine state; host and group variables remain excluded.",
      ],
    },
  };
}
