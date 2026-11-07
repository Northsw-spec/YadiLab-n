import {
  inspectStaticAnsibleSourceReadOnly,
  type AnsibleReadOnlyInspection,
} from "../../../enterprise-import/src/structured-ansible-source-inspection.js";
import { previewAnsibleStaticInventory } from "../../../enterprise-import/src/ansible-yaml-preview.js";
import { previewAnsibleIniStaticInventory } from "../../../enterprise-import/src/ansible-ini-preview.js";
import { EnterpriseImportError } from "../../../enterprise-import/src/types.js";
import type { StructuredXmlReadableFile } from "./structured-xml-inspection-file.js";

const MAX_BYTES = 256 * 1024;
const ID = /^[A-Za-z0-9_][A-Za-z0-9_.:-]{0,127}$/;
const HEX = /^[0-9a-f]{64}$/;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);

export interface SharedBuilderReviewSnapshot {
  readonly scenarioId: string;
  readonly sourceRevision: number;
  readonly resources: readonly { readonly id: string; readonly label: string }[];
}
export interface SharedStaticHostReferenceDecision {
  readonly profileId: "ansible.inventory.static.yaml.v1" | "ansible.inventory.static.ini.v1";
  readonly sourceSha256: string;
  readonly scenarioId: string;
  readonly sourceRevision: number;
  readonly hostOrdinal: number;
  readonly resourceId: string;
  readonly acknowledgeNotVerified: true;
}
export interface SharedStaticHostReferenceSidecar {
  readonly formatId: "yadilab.ic010.shared-static-ansible-reference";
  readonly schemaVersion: "1.0.0";
  readonly status: "REVIEWED_REFERENCE_ONLY";
  readonly semanticTrack: "CONFIG_DOCUMENTED";
  readonly canActivate: false;
  readonly modelMutated: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
  readonly source: { readonly profileId: SharedStaticHostReferenceDecision["profileId"]; readonly sha256: string };
  readonly sourceItem: {
    readonly kind: "ansible-yaml-host-ordinal" | "ansible-ini-host-ordinal";
    readonly sourceSha256: string;
    readonly hostOrdinal: number;
    readonly originalLocatorCount: number;
  };
  readonly targetModel: { readonly scenarioId: string; readonly sourceRevision: number; readonly resourceId: string };
  readonly assertion: "USER_ASSERTED_REFERENCE_NOT_VERIFIED";
}

function deny(code: string): never {
  throw new EnterpriseImportError(code, code);
}
function id(value: unknown): value is string {
  return typeof value === "string" && ID.test(value) && !FORBIDDEN.has(value);
}
function validModel(value: SharedBuilderReviewSnapshot | null): value is SharedBuilderReviewSnapshot {
  if (!value || !id(value.scenarioId) || !Number.isSafeInteger(value.sourceRevision) ||
      value.sourceRevision < 0 || !Array.isArray(value.resources)) return false;
  const seen = new Set<string>();
  for (const r of value.resources) {
    if (!r || !id(r.id) || seen.has(r.id) || typeof r.label !== "string") return false;
    seen.add(r.id);
  }
  return true;
}
const yamlProfile = "ansible.inventory.static.yaml.v1";
const iniProfile = "ansible.inventory.static.ini.v1";

/**
 * IC-010 P3b shared UI: re-read original File and revalidate real per-host
 * locators, but export only a SHA-bound ordinal and a user-selected Builder ID.
 * No original host aliases/IP addresses/variables or raw locators leave here.
 * This is a separate UNVERIFIED sidecar, NEVER a ScenarioSource or Engine call.
 */
export async function reviewSharedStaticHostOriginalReference(
  originalFile: StructuredXmlReadableFile,
  expected: AnsibleReadOnlyInspection,
  getCurrentBuilder: () => SharedBuilderReviewSnapshot | null,
  decision: SharedStaticHostReferenceDecision,
  isCurrent: () => boolean,
): Promise<SharedStaticHostReferenceSidecar> {
  if (!expected || expected.status !== "REVIEW_REQUIRED" ||
      ![yamlProfile, iniProfile].includes(expected.profileId) ||
      expected.semanticTrack !== "CONFIG_DOCUMENTED" ||
      expected.canActivate !== false || expected.modelMutated !== false ||
      expected.engineVerified !== false || expected.physicalTopologyVerified !== false ||
      !HEX.test(expected.sourceSha256) ||
      expected.documentLocator?.kind !== "source-document" ||
      expected.documentLocator.profileId !== expected.profileId ||
      expected.documentLocator.sourceSha256 !== expected.sourceSha256 ||
      !Number.isSafeInteger(expected.summary?.documentedHosts) ||
      expected.summary.documentedHosts < 1)
    return deny("IC010_P3B_SOURCE_INVALID");
  if (!decision || decision.acknowledgeNotVerified !== true)
    return deny("IC010_P3B_ACK_REQUIRED");
  if (decision.profileId !== expected.profileId ||
      decision.sourceSha256 !== expected.sourceSha256)
    return deny("IC010_P3B_SOURCE_CHANGED");
  if (!Number.isSafeInteger(decision.hostOrdinal) || decision.hostOrdinal < 0 ||
      decision.hostOrdinal >= expected.summary.documentedHosts || !id(decision.resourceId))
    return deny("IC010_P3B_SELECTION_INVALID");
  if (typeof isCurrent !== "function" || !isCurrent())
    return deny("IC010_P3B_STALE");
  if (typeof getCurrentBuilder !== "function")
    return deny("IC010_P3B_BUILDER_REQUIRED");
  const initial = getCurrentBuilder();
  if (!validModel(initial)) return deny("IC010_P3B_BUILDER_REQUIRED");
  const fingerprint = JSON.stringify(initial);
  if (decision.scenarioId !== initial.scenarioId ||
      decision.sourceRevision !== initial.sourceRevision ||
      !initial.resources.some(resource => resource.id === decision.resourceId))
    return deny("IC010_P3B_STALE");
  if (!originalFile || typeof originalFile.name !== "string" ||
      originalFile.name.length > 255 || !/^[^/\\\u0000-\u001f\u007f]+\.(?:yaml|yml|ini)$/i.test(originalFile.name) ||
      originalFile.name.trim() !== originalFile.name ||
      typeof originalFile.arrayBuffer !== "function" ||
      (originalFile.size !== undefined &&
        (!Number.isSafeInteger(originalFile.size) || originalFile.size < 1 || originalFile.size > MAX_BYTES)))
    return deny("IC010_P3B_SOURCE_BLOCKED");
  const yaml = /\.(?:yaml|yml)$/i.test(originalFile.name);
  if ((yaml ? yamlProfile : iniProfile) !== expected.profileId)
    return deny("IC010_P3B_SOURCE_CHANGED");

  let original: Uint8Array;
  try {
    const bytes: unknown = await originalFile.arrayBuffer();
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES)
      return deny("IC010_P3B_SOURCE_BLOCKED");
    original = Uint8Array.from(new Uint8Array(bytes));
  } catch {
    return deny("IC010_P3B_SOURCE_BLOCKED");
  }
  if (!isCurrent()) return deny("IC010_P3B_STALE");
  const afterRead = getCurrentBuilder();
  if (!validModel(afterRead) || JSON.stringify(afterRead) !== fingerprint)
    return deny("IC010_P3B_STALE");

  let originalLocatorCount = 0;
  try {
    const rechecked = await inspectStaticAnsibleSourceReadOnly(originalFile.name, original);
    if (rechecked.status !== "REVIEW_REQUIRED" ||
        JSON.stringify(rechecked) !== JSON.stringify(expected))
      return deny("IC010_P3B_SOURCE_CHANGED");
    if (yaml) {
      const preview = await previewAnsibleStaticInventory(original);
      const host = preview.hosts[decision.hostOrdinal];
      if (!host || !host.locators.length || host.locators.length !== host.groupPaths.length)
        return deny("IC010_P3B_LOCATOR_INVALID");
      for (let i=0; i<host.locators.length; i++) {
        const loc = host.locators[i];
        if (!loc || loc.kind !== "ansible-yaml-host" ||
            loc.sourceSha256 !== rechecked.sourceSha256 ||
            loc.hostKey !== host.inventoryName || loc.groupPath !== host.groupPaths[i])
          return deny("IC010_P3B_LOCATOR_INVALID");
        originalLocatorCount++;
      }
    } else {
      const preview = await previewAnsibleIniStaticInventory(original);
      const host = preview.hosts[decision.hostOrdinal];
      if (!host || !host.locators.length)
        return deny("IC010_P3B_LOCATOR_INVALID");
      for (const loc of host.locators) {
        if (!loc || loc.kind !== "ansible-ini-host" ||
            loc.sourceSha256 !== rechecked.sourceSha256 ||
            loc.hostKey !== host.inventoryName ||
            !Number.isSafeInteger(loc.lineNumber) || loc.lineNumber < 1 ||
            (loc.section !== "ungrouped" && !host.directGroups.includes(loc.section)))
          return deny("IC010_P3B_LOCATOR_INVALID");
        originalLocatorCount++;
      }
    }
  } catch (error) {
    if (error instanceof EnterpriseImportError && /^IC010_P3B_/.test(error.code))
      throw error;
    return deny("IC010_P3B_SOURCE_BLOCKED");
  }
  if (!isCurrent()) return deny("IC010_P3B_STALE");
  const finalModel = getCurrentBuilder();
  if (!validModel(finalModel) || JSON.stringify(finalModel) !== fingerprint ||
      !finalModel.resources.some(resource => resource.id === decision.resourceId))
    return deny("IC010_P3B_STALE");

  return Object.freeze({
    formatId: "yadilab.ic010.shared-static-ansible-reference" as const,
    schemaVersion: "1.0.0" as const,
    status: "REVIEWED_REFERENCE_ONLY" as const,
    semanticTrack: "CONFIG_DOCUMENTED" as const,
    canActivate: false as const,
    modelMutated: false as const,
    engineVerified: false as const,
    physicalTopologyVerified: false as const,
    source: Object.freeze({profileId: expected.profileId,sha256: expected.sourceSha256}),
    sourceItem: Object.freeze({
      kind: yaml ? "ansible-yaml-host-ordinal" as const : "ansible-ini-host-ordinal" as const,
      sourceSha256: expected.sourceSha256,
      hostOrdinal: decision.hostOrdinal,
      originalLocatorCount,
    }),
    targetModel: Object.freeze({
      scenarioId: finalModel.scenarioId,
      sourceRevision: finalModel.sourceRevision,
      resourceId: decision.resourceId,
    }),
    assertion: "USER_ASSERTED_REFERENCE_NOT_VERIFIED" as const,
  });
}
