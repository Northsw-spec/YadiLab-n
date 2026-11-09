import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with { type: "json" };
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with { type: "json" };
import catalog from "../../catalog/builtin-catalog.json" with { type: "json" };
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import { previewNetworkTopologyFile } from "../../dist-browser-test/ui/src/browser/network-topology-import.js";
import { compileBuilderWorkspace, createBuilderWorkspace } from "../../dist-browser-test/ui/src/browser/index.js";
import { createProjectDocument, readProjectDocument } from "../../ui/app/project-document.mjs";

const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: false, validateSchema: true });
const validateSource = ajv.compile(sourceSchema), validateNormalized = ajv.compile(normalizedSchema);
const compilerOptions = { compilerContext: { validateSource: (data) => ({ valid: Boolean(validateSource(data)), diagnostics: (validateSource.errors ?? []).map((e) => `${e.instancePath || "$"}: ${e.message}`) }), validateNormalized: (data) => ({ valid: Boolean(validateNormalized(data)), diagnostics: (validateNormalized.errors ?? []).map((e) => `${e.instancePath || "$"}: ${e.message}`) }), catalog: { capabilities: catalog.capabilities, profiles: catalog.profiles, assets: catalog.assets }, engineBaselineVersion: ENGINE_VERSION } };
const namedFile = (path) => { const bytes = fs.readFileSync(path); return { name: path.split("/").at(-1), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }; };
const result = await previewNetworkTopologyFile(namedFile("examples/enterprise-import/network-devices-example.csv"));
assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
assert.equal(result.devices, 4);
assert.equal(result.links, 3);
assert.ok(result.source);
assert.equal(Boolean(validateSource(result.source)), true, JSON.stringify(validateSource.errors));
const expectedSha = crypto.createHash("sha256").update(fs.readFileSync("examples/enterprise-import/network-devices-example.csv")).digest("hex");
assert.equal(result.source.networkImportProvenance.source.sha256, expectedSha);
assert.equal(result.source.networkImportProvenance.source.sourceId, `src_${expectedSha}`);
assert.equal(result.source.networkImportProvenance.source.mediaType, "text/csv");
assert.ok(result.source.networkImportProvenance.facts.some((fact) => fact.targetKind === "resource" && fact.targetId === "router01" && fact.locator.kind === "record-row"));
assert.ok(result.source.networkImportProvenance.facts.some((fact) => fact.targetKind === "connection" && fact.locator.kind === "record-row"));
// PROJECT-076D: shorthand normalization is allowed to construct editable
// defaults, but those defaults must never masquerade as cells in the uploaded
// CSV. Only source-bound fields receive facts; field aliases and value
// transformations disclose their actual mapping class.
const csvFacts = result.source.networkImportProvenance.facts;
assert.ok(!csvFacts.some((fact) => fact.field.startsWith("Metadata.")),
  "generated shorthand Metadata must not acquire a fabricated source locator");
assert.ok(!csvFacts.some((fact) => fact.field === "Interfaces.interfaceId" || fact.field === "Interfaces.name"),
  "generated primary interface names must not acquire source facts");
assert.ok(!csvFacts.some((fact) => fact.field === "Links.linkId"),
  "generated inline connection IDs must not acquire source facts");
assert.ok(csvFacts.every((fact) => fact.locator.kind === "record-row" && fact.locator.table === "Devices" && fact.locator.row >= 2 && fact.locator.row <= 5),
  "CSV facts must locate only physical Devices records in the uploaded file");
assert.ok(csvFacts.some((fact) => fact.field === "Nodes.nodeId" && fact.mapping === "ALIAS"),
  "header-based Asset ID mapping is explicitly an alias");
assert.ok(csvFacts.some((fact) => fact.field === "Nodes.type" && fact.mapping === "TRANSFORMED"),
  "role normalization is explicitly a transformation");
assert.ok(csvFacts.some((fact) => fact.field === "Links.nodeB" && fact.mapping === "ALIAS"),
  "explicit Connected To links retain their real source-row binding");
const transformedBytes = new TextEncoder().encode("Asset ID,Hostname,Device Type,CIDR\nedge01,Edge,Router,10.4.0.1/24\n");
const transformed = await previewNetworkTopologyFile({ name: "cidr.csv", arrayBuffer: async () => transformedBytes.buffer.slice(transformedBytes.byteOffset, transformedBytes.byteOffset + transformedBytes.byteLength) });
assert.equal(transformed.ok, true, JSON.stringify(transformed.diagnostics));
assert.ok(transformed.source.networkImportProvenance.facts.some((fact) => fact.field === "Interfaces.IPv4" && fact.mapping === "TRANSFORMED" && fact.locator.kind === "record-row" && fact.locator.row === 2),
  "a CIDR-derived IPv4 host retains its actual row but discloses transformation");
assert.ok(transformed.source.networkImportProvenance.facts.some((fact) => fact.field === "Interfaces.prefix" && fact.mapping === "TRANSFORMED"),
  "a CIDR-derived prefix is not claimed as an exact source field");
const canonicalBytes = new TextEncoder().encode(JSON.stringify({
  Metadata: [{ schemaVersion: "1.0.0", scenarioId: "canonical_source", title: "Canonical Source" }],
  Nodes: [{ nodeId: "nodea", displayName: "Node A", type: "network.router" }, { nodeId: "nodeb", displayName: "Node B", type: "endpoint.windows" }],
  Interfaces: [{ nodeId: "nodea", interfaceId: "eth0", name: "eth0", IPv4: "10.5.0.1" }, { nodeId: "nodeb", interfaceId: "eth0", name: "eth0", IPv4: "10.5.0.2" }],
  Links: [{ linkId: "linkab", nodeA: "nodea", nodeB: "nodeb", interfaceA: "eth0", interfaceB: "eth0", kind: "network" }],
}));
const canonical = await previewNetworkTopologyFile({ name: "canonical.json", arrayBuffer: async () => canonicalBytes.buffer.slice(canonicalBytes.byteOffset, canonicalBytes.byteOffset + canonicalBytes.byteLength) });
assert.equal(canonical.ok, true, JSON.stringify(canonical.diagnostics));
assert.ok(canonical.source.networkImportProvenance.facts.some((fact) => fact.field === "Metadata.scenarioId" && fact.mapping === "EXACT" && fact.locator.kind === "json-pointer" && fact.locator.pointer === "/Metadata/0/scenarioId"),
  "explicit canonical Metadata retains its exact original JSON locator");
assert.ok(canonical.source.networkImportProvenance.facts.some((fact) => fact.field === "Links.linkId" && fact.targetKind === "connection" && fact.targetId === "linkab" && fact.mapping === "EXACT"),
  "explicit canonical connection IDs retain exact source provenance");
const compiled = await compileBuilderWorkspace(createBuilderWorkspace(result.source), compilerOptions);
assert.equal(compiled.compile.status, "valid", JSON.stringify(compiled.compile.diagnostics));
assert.deepEqual(compiled.compile.model.networkImportProvenance, result.source.networkImportProvenance,
  "Compiler retains import history but does not interpret it as Engine evidence");
if (!globalThis.crypto?.subtle) globalThis.crypto = crypto.webcrypto;
const importedProject = await createProjectDocument({ mode: "builder", source: result.source,
  sourceRevision: 1, dirty: true, selection: { ids: [] }, layoutOverrides: [] }, { validateSource });
assert.deepEqual((await readProjectDocument(importedProject, { validateSource })).source.networkImportProvenance,
  result.source.networkImportProvenance, "filtered source-bound provenance survives native Save/Open");
const excel = await previewNetworkTopologyFile(namedFile("examples/enterprise-import/enterprise-import-template.xlsx"));
// The historical template is a Devices shorthand workbook with populated
// unsupported columns and a competing Metadata sheet. Activation must remain
// fail-closed; the canonical JSON case above is the positive full-workbook
// provenance contract.
assert.equal(excel.ok, false, "unsupported populated shorthand workbook fields must block activation");
assert.ok(excel.diagnostics.some((item) => item.code === "NETWORK_IMPORT_DEVICE_FIELD_UNMAPPED"));
const invalidBytes = new TextEncoder().encode("Asset ID,Hostname,Device Type,Connected To\nfoo,Host,Windows,ghost\n");
const invalid = await previewNetworkTopologyFile({ name: "devices.csv", arrayBuffer: async () => invalidBytes.buffer.slice(invalidBytes.byteOffset,invalidBytes.byteOffset+invalidBytes.byteLength) });
assert.equal(invalid.ok, false);
const ui = fs.readFileSync("ui/app/main.mjs", "utf8");
assert.ok(ui.includes('"data-import-network-action": "true"'));
assert.ok(ui.includes('"data-network-import-activate": "true"'));
assert.ok(ui.includes('"data-network-import-panel": "ready"'));
// Source-level identity wiring contract: the visible checkpoint comes from current package metadata,
// not from an obsolete literal embedded in a historical IMPORT-004 fixture.
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.equal(typeof pkg.yadilabRelease?.checkpoint, "string");
assert.ok(pkg.yadilabRelease.checkpoint.length > 0);
assert.match(ui, /const releaseIdentity\s*=\s*\{[^;]*checkpoint:\s*releasePackage\.yadilabRelease\.checkpoint/);
const hasReleaseHeaderBindings = (text) =>
  /"data-yadilab-build-version":\s*releaseIdentity\.version\b/.test(text)
  && /"data-source-commit":\s*releaseIdentity\.sourceCommit\b/.test(text)
  && /"data-development-checkpoint":\s*releaseIdentity\.checkpoint\b/.test(text);
assert.equal(hasReleaseHeaderBindings(ui), true, "UI header must bind release fields to their real releaseIdentity properties");
// Negative control: replacing the bound checkpoint with a historical constant MUST fail.
assert.equal(
  hasReleaseHeaderBindings(ui.replace('"data-development-checkpoint": releaseIdentity.checkpoint', '"data-development-checkpoint": "IMPORT-004"')),
  false,
  "Source wiring check must reject literal old checkpoint values"
);
console.log("PASS network topology browser source contract: CSV/XLSX input, validation, compile, invalid refs, UI actions and current package-bound release identity (DOM not asserted here).");
