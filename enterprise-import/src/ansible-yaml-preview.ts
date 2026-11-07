import { parseAllDocuments, YAMLMap, isAlias, isMap, isScalar, isSeq } from "yaml";
import { webCryptoImportHashProvider } from "./hash.js";
import { EnterpriseImportError } from "./types.js";

export const ANSIBLE_YAML_PREVIEW_PROFILE = "ansible.inventory.static.yaml.v1" as const;
const MAX_BYTES = 256 * 1024;
const MAX_AST_NODES = 12_000;
const MAX_AST_DEPTH = 40;
const MAX_GROUPS = 200;
const MAX_HOSTS = 500;
const MAX_GROUP_DEPTH = 10;
const MAX_MEMBERSHIPS = 2_000;
const NAME = /^[a-zA-Z_][a-zA-Z0-9_.-]{0,127}$/;
const ADDRESS = /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/;

export interface AnsibleInventoryLocator {
  readonly kind: "ansible-yaml-host";
  readonly sourceSha256: string;
  readonly groupPath: string;
  readonly hostKey: string;
}
export interface AnsibleHostObservation {
  readonly inventoryName: string;
  readonly reportedConnectionAddress?: string;
  readonly addressTruth: "REPORTED_NOT_VERIFIED" | "UNKNOWN";
  readonly groupPaths: readonly string[];
  readonly locators: readonly AnsibleInventoryLocator[];
}
export interface AnsibleStaticInventoryPreview {
  readonly status: "REVIEW_REQUIRED";
  readonly canActivate: false;
  readonly profileId: typeof ANSIBLE_YAML_PREVIEW_PROFILE;
  readonly semanticTrack: "CONFIG_DOCUMENTED";
  readonly sourceSha256: string;
  readonly hosts: readonly AnsibleHostObservation[];
  readonly groupPaths: readonly string[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string }[];
}
function fail(code: string, message: string): never {
  throw new EnterpriseImportError(code, message);
}
function mapEntries(node: unknown, description: string): Array<{ key: string; value: unknown }> {
  if (!isMap(node)) fail("ANSIBLE_YAML_EXPECTED_MAPPING", description + " must be a YAML mapping.");
  return node.items.map((pair) => {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string" || !pair.key.value.trim()) {
      fail("ANSIBLE_YAML_KEY_INVALID", "Only nonempty string mapping keys are supported.");
    }
    if (["__proto__", "constructor", "prototype", "<<"].includes(pair.key.value)) {
      fail("ANSIBLE_YAML_FORBIDDEN_KEY", "Reserved or YAML merge keys are forbidden.");
    }
    return { key: pair.key.value, value: pair.value };
  });
}
function inspectAst(node: unknown, depth: number, budget: { count: number }): void {
  if (node == null) return;
  if (++budget.count > MAX_AST_NODES || depth > MAX_AST_DEPTH) {
    fail("ANSIBLE_YAML_COMPLEXITY_LIMIT", "YAML tree exceeds strict depth or node-count limits.");
  }
  if (isAlias(node) || (typeof node === "object" && node !== null &&
      ("anchor" in node && Boolean(node.anchor)))) {
    fail("ANSIBLE_YAML_ALIAS_FORBIDDEN", "Anchors and aliases are unsupported in the static inventory profile.");
  }
  if (typeof node === "object" && node !== null && "tag" in node && Boolean(node.tag)) {
    fail("ANSIBLE_YAML_TAG_FORBIDDEN", "Explicit YAML tags and custom constructors are unsupported.");
  }
  if (isSeq(node)) {
    for (const value of node.items) inspectAst(value, depth + 1, budget);
  } else if (isMap(node)) {
    for (const pair of node.items) {
      inspectAst(pair.key, depth + 1, budget);
      inspectAst(pair.value, depth + 1, budget);
      if (isScalar(pair.key) && ["__proto__", "constructor", "prototype", "<<"].includes(String(pair.key.value))) {
        fail("ANSIBLE_YAML_FORBIDDEN_KEY", "Reserved or merge mapping key.");
      }
    }
  } else if (isScalar(node)) {
    if (typeof node.value === "string" && node.value.length > 16_384) {
      fail("ANSIBLE_YAML_SCALAR_TOO_LONG", "A YAML scalar exceeds the strict profile size budget.");
    }
  } else {
    fail("ANSIBLE_YAML_NODE_UNSUPPORTED", "Unsupported YAML node type.");
  }
}
function validatedName(name: string, kind: string): string {
  if (!NAME.test(name)) fail("ANSIBLE_YAML_NAME_INVALID", kind + " has an unsupported identifier.");
  return name;
}
function optionalReportedAddress(value: unknown): string {
  if (!isScalar(value) || typeof value.value !== "string" || !ADDRESS.test(value.value)) {
    fail("ANSIBLE_YAML_ADDRESS_UNSUPPORTED", "ansible_host must be one literal hostname or address string.");
  }
  if (/^\d+(?:\.\d+){3}$/.test(value.value) &&
      value.value.split(".").some((x) => Number(x) > 255)) {
    fail("ANSIBLE_YAML_ADDRESS_UNSUPPORTED", "Invalid IPv4 address literal.");
  }
  return value.value;
}

/**
 * Read-only interpretation of a deliberately bounded Ansible YAML inventory.
 * No Ansible execution; no secret vars are exported; no topology links exist.
 * Source SHA includes EVERY original byte, not a rewritten YAML serialization.
 */
export async function previewAnsibleStaticInventory(bytes: Uint8Array): Promise<AnsibleStaticInventoryPreview> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    fail("ANSIBLE_YAML_SOURCE_SIZE_INVALID", "Source must be nonempty and at most 256 KiB.");
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("ANSIBLE_YAML_UTF8_INVALID", "Source is not valid UTF-8."); }
  if (text.includes("\0")) fail("ANSIBLE_YAML_NUL_FORBIDDEN", "Embedded NUL is forbidden.");

  let docs;
  try {
    docs = parseAllDocuments(text, {
      version: "1.2", schema: "core", strict: true, uniqueKeys: true,
      stringKeys: true, merge: false, resolveKnownTags: false,
      prettyErrors: false,
    });
  } catch { fail("ANSIBLE_YAML_PARSE_INVALID", "The input cannot be parsed as strict YAML."); }
  if (docs.length !== 1) fail("ANSIBLE_YAML_DOCUMENT_COUNT", "Exactly one YAML document is required.");
  const doc = docs[0]!;
  if (doc.errors.length || doc.warnings.length) {
    fail("ANSIBLE_YAML_PARSE_INVALID", "Invalid, duplicate or unsupported YAML mapping syntax.");
  }
  inspectAst(doc.contents, 0, { count: 0 });
  const root = mapEntries(doc.contents, "Inventory root");
  if (root.length !== 1 || root[0]!.key !== "all") {
    fail("ANSIBLE_YAML_ROOT_INVALID", "Static inventory must have exactly one root group named all.");
  }
  const sourceSha256 = await webCryptoImportHashProvider.sha256Bytes(bytes);
  const observed = new Map<string, {
    address?: string;
    groupPaths: string[];
    locators: AnsibleInventoryLocator[];
  }>();
  const groupPaths: string[] = [];
  const seenGroups = new Map<string, string>();
  let memberships = 0;
  let ignoredVars = false;

  function visit(groupName: string, value: unknown, parents: readonly string[]): void {
    validatedName(groupName, "Group");
    if (parents.includes(groupName)) {
      fail("ANSIBLE_YAML_GROUP_RECURSIVE", "Group hierarchy cannot contain its own ancestor.");
    }
    const path = [...parents, groupName].join("/");
    if (parents.length >= MAX_GROUP_DEPTH || groupPaths.length >= MAX_GROUPS) {
      fail("ANSIBLE_YAML_GROUP_BUDGET", "Group count or nesting budget exceeded.");
    }
    if (seenGroups.has(groupName) && seenGroups.get(groupName) !== path) {
      fail("ANSIBLE_YAML_GROUP_AMBIGUOUS", "A group declared in multiple hierarchy locations requires a different profile.");
    }
    seenGroups.set(groupName, path);
    groupPaths.push(path);
    const entries = mapEntries(value, "Group " + groupName);
    for (const entry of entries) {
      if (!["hosts", "children", "vars"].includes(entry.key)) {
        fail("ANSIBLE_YAML_GROUP_FIELD_UNSUPPORTED", "Only hosts, children and vars are allowed in a group.");
      }
    }
    for (const entry of entries) {
      if (entry.key === "vars") {
        mapEntries(entry.value, "Group vars");
        ignoredVars = true; // NEVER read or emit group variable values
      }
      if (entry.key === "hosts") {
        for (const host of mapEntries(entry.value, "Group hosts")) {
          const hostKey = validatedName(host.key, "Host");
          let reported: string | undefined;
          if (host.value !== null && !(isScalar(host.value) && host.value.value === null)) {
            const fields = mapEntries(host.value, "Host vars");
            if (fields.length) ignoredVars = true;
            for (const field of fields) {
              if (field.key === "ansible_host") reported = optionalReportedAddress(field.value);
            }
          }
          if (++memberships > MAX_MEMBERSHIPS || (!observed.has(hostKey) && observed.size >= MAX_HOSTS)) {
            fail("ANSIBLE_YAML_HOST_BUDGET", "Host count or group membership budget exceeded.");
          }
          const old = observed.get(hostKey);
          if (old && old.address !== reported) {
            fail("ANSIBLE_YAML_HOST_CONFLICT", "A repeated host has conflicting or missing connection address values.");
          }
          const item: { address?: string; groupPaths: string[]; locators: AnsibleInventoryLocator[] } = old ?? { ...(reported === undefined ? {} : { address: reported }),
            groupPaths: [], locators: [] };
          if (!item.groupPaths.includes(path)) {
            item.groupPaths.push(path);
            item.locators.push({ kind: "ansible-yaml-host", sourceSha256, groupPath: path, hostKey });
          }
          observed.set(hostKey, item);
        }
      }
      if (entry.key === "children") {
        for (const child of mapEntries(entry.value, "Child groups")) {
          if (child.value === null || (isScalar(child.value) && child.value.value === null)) {
            // Empty declared child group has no hosts or vars and is kept as a group.
            visit(child.key, new YAMLMap(), [...parents, groupName]);
          } else {
            visit(child.key, child.value, [...parents, groupName]);
          }
        }
      }
    }
  }
  visit("all", root[0]!.value, []);
  return {
    status: "REVIEW_REQUIRED",
    canActivate: false,
    profileId: ANSIBLE_YAML_PREVIEW_PROFILE,
    semanticTrack: "CONFIG_DOCUMENTED",
    sourceSha256,
    hosts: [...observed].map(([inventoryName, entry]) => ({
      inventoryName,
      ...(entry.address === undefined ? {} : { reportedConnectionAddress: entry.address }),
      addressTruth: entry.address === undefined ? "UNKNOWN" as const : "REPORTED_NOT_VERIFIED" as const,
      groupPaths: entry.groupPaths,
      locators: entry.locators,
    })),
    groupPaths,
    diagnostics: ignoredVars
      ? [{ code: "ANSIBLE_YAML_VARIABLES_NOT_IMPORTED", message: "Host and group variable values were not imported or exported." }]
      : [],
  };
}
