import assert from "node:assert/strict";
import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with { type: "json" };
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with { type: "json" };
import catalog from "../../catalog/builtin-catalog.json" with { type: "json" };
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import { previewNetworkTopologyFile } from "../../dist-browser-test/ui/src/browser/network-topology-import.js";
import { compileBuilderWorkspace, createBuilderWorkspace } from "../../dist-browser-test/ui/src/browser/index.js";

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
const compiled = await compileBuilderWorkspace(createBuilderWorkspace(result.source), compilerOptions);
assert.equal(compiled.compile.status, "valid", JSON.stringify(compiled.compile.diagnostics));
const excel = await previewNetworkTopologyFile(namedFile("examples/enterprise-import/enterprise-import-template.xlsx"));
assert.equal(excel.ok, true, JSON.stringify(excel.diagnostics));
assert.ok(excel.devices > 0);
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
