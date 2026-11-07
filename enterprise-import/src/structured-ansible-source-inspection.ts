import { previewAnsibleStaticInventory } from "./ansible-yaml-preview.js";
import { previewAnsibleIniStaticInventory } from "./ansible-ini-preview.js";
import { EnterpriseImportError } from "./types.js";

/**
 * IC-010 P3a: immutable metadata derived ONLY from fully validated static
 * Ansible inventory sources. This is not a general YAML/INI import adapter.
 */
export type AnsibleStaticProfileId =
  | "ansible.inventory.static.yaml.v1"
  | "ansible.inventory.static.ini.v1";
export type AnsibleBlockedCode =
  | "IC010_STATIC_FILENAME_INVALID"
  | "IC010_STATIC_SOURCE_SIZE_INVALID"
  | "IC010_STATIC_EXTENSION_UNSUPPORTED"
  | "IC010_STATIC_CONTENT_UNRECOGNIZED"
  | "IC010_STATIC_SOURCE_LOCATOR_INVALID";
export interface AnsibleDocumentLocator {
  readonly kind: "source-document";
  readonly profileId: AnsibleStaticProfileId;
  readonly sourceSha256: string;
}
export interface AnsibleAggregateSummary {
  readonly kind: "ANSIBLE_YAML_INVENTORY" | "ANSIBLE_INI_INVENTORY";
  readonly documentedHosts: number;
  readonly documentedGroups: number;
  /** Validated count only. No original host/source element names leave this API. */
  readonly originalHostLocatorCount: number;
}
export interface AnsibleBlockedInspection {
  readonly status: "BLOCKED";
  readonly code: AnsibleBlockedCode;
  readonly canActivate: false;
  readonly modelMutated: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
}
export interface AnsibleReadOnlyInspection {
  readonly status: "REVIEW_REQUIRED";
  readonly profileId: AnsibleStaticProfileId;
  readonly semanticTrack: "CONFIG_DOCUMENTED";
  readonly sourceSha256: string;
  readonly documentLocator: AnsibleDocumentLocator;
  readonly summary: AnsibleAggregateSummary;
  readonly canActivate: false;
  readonly modelMutated: false;
  readonly engineVerified: false;
  readonly physicalTopologyVerified: false;
}
export type AnsibleStaticInspection = AnsibleBlockedInspection | AnsibleReadOnlyInspection;

const MAX_BYTES = 256 * 1024;
const BOUNDARY = Object.freeze({
  canActivate: false as const, modelMutated: false as const,
  engineVerified: false as const, physicalTopologyVerified: false as const,
});
function blocked(code: AnsibleBlockedCode): AnsibleBlockedInspection {
  return Object.freeze({ status: "BLOCKED" as const, code, ...BOUNDARY });
}
function safeName(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= 255 &&
    name.trim() === name && !/[\\/\u0000-\u001f\u007f]/.test(name) &&
    name !== "." && name !== "..";
}

/**
 * Complete parsers validate source semantics and build original per-item
 * locators. Check their source hash/kind/index binding, then discard EVERY
 * original item name, address, variable, group path and original locator.
 * The shared UI never receives raw preview objects.
 */
export async function inspectStaticAnsibleSourceReadOnly(
  filename: string, originalBytes: Uint8Array,
): Promise<AnsibleStaticInspection> {
  if (!safeName(filename)) return blocked("IC010_STATIC_FILENAME_INVALID");
  if (!(originalBytes instanceof Uint8Array) ||
      originalBytes.byteLength === 0 || originalBytes.byteLength > MAX_BYTES)
    return blocked("IC010_STATIC_SOURCE_SIZE_INVALID");
  const lower = filename.toLowerCase();
  const yaml = lower.endsWith(".yml") || lower.endsWith(".yaml");
  const ini = lower.endsWith(".ini");
  if (!yaml && !ini) return blocked("IC010_STATIC_EXTENSION_UNSUPPORTED");
  const snapshot = Uint8Array.from(originalBytes);
  try {
    if (yaml) {
      const parsed = await previewAnsibleStaticInventory(snapshot);
      if (parsed.status !== "REVIEW_REQUIRED" || parsed.canActivate !== false ||
          parsed.profileId !== "ansible.inventory.static.yaml.v1" ||
          parsed.semanticTrack !== "CONFIG_DOCUMENTED")
        return blocked("IC010_STATIC_SOURCE_LOCATOR_INVALID");
      let locators = 0;
      for (const host of parsed.hosts) {
        if (host.locators.length < 1) return blocked("IC010_STATIC_SOURCE_LOCATOR_INVALID");
        for (const loc of host.locators) {
          if (loc.kind !== "ansible-yaml-host" ||
              loc.sourceSha256 !== parsed.sourceSha256 ||
              loc.hostKey !== host.inventoryName ||
              !host.groupPaths.includes(loc.groupPath))
            return blocked("IC010_STATIC_SOURCE_LOCATOR_INVALID");
          locators++;
        }
      }
      return Object.freeze({
        status: "REVIEW_REQUIRED" as const,
        profileId: parsed.profileId, semanticTrack: "CONFIG_DOCUMENTED" as const,
        sourceSha256: parsed.sourceSha256,
        documentLocator: Object.freeze({
          kind: "source-document" as const,
          profileId: parsed.profileId, sourceSha256: parsed.sourceSha256,
        }),
        summary: Object.freeze({
          kind: "ANSIBLE_YAML_INVENTORY" as const,
          documentedHosts: parsed.hosts.length,
          documentedGroups: parsed.groupPaths.length,
          originalHostLocatorCount: locators,
        }),
        ...BOUNDARY,
      });
    }
    const parsed = await previewAnsibleIniStaticInventory(snapshot);
    if (parsed.status !== "REVIEW_REQUIRED" || parsed.canActivate !== false ||
        parsed.profileId !== "ansible.inventory.static.ini.v1" ||
        parsed.semanticTrack !== "CONFIG_DOCUMENTED")
      return blocked("IC010_STATIC_SOURCE_LOCATOR_INVALID");
    let locators = 0;
    for (const host of parsed.hosts) {
      if (host.locators.length < 1) return blocked("IC010_STATIC_SOURCE_LOCATOR_INVALID");
      for (const loc of host.locators) {
        if (loc.kind !== "ansible-ini-host" ||
            loc.sourceSha256 !== parsed.sourceSha256 ||
            loc.hostKey !== host.inventoryName ||
            !Number.isSafeInteger(loc.lineNumber) || loc.lineNumber < 1 ||
            (loc.section !== "ungrouped" && !host.directGroups.includes(loc.section)))
          return blocked("IC010_STATIC_SOURCE_LOCATOR_INVALID");
        locators++;
      }
    }
    return Object.freeze({
      status: "REVIEW_REQUIRED" as const,
      profileId: parsed.profileId, semanticTrack: "CONFIG_DOCUMENTED" as const,
      sourceSha256: parsed.sourceSha256,
      documentLocator: Object.freeze({
        kind: "source-document" as const,
        profileId: parsed.profileId, sourceSha256: parsed.sourceSha256,
      }),
      summary: Object.freeze({
        kind: "ANSIBLE_INI_INVENTORY" as const,
        documentedHosts: parsed.hosts.length,
        documentedGroups: parsed.groupNames.length,
        originalHostLocatorCount: locators,
      }),
      ...BOUNDARY,
    });
  } catch (error) {
    if (!(error instanceof EnterpriseImportError)) throw error;
    // Unsafe/unsupported source messages might include untrusted strings.
    // The shared caller receives only fixed safe rejection codes.
    return blocked("IC010_STATIC_CONTENT_UNRECOGNIZED");
  }
}
