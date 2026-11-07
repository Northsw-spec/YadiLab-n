import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  compileScenario,
  highestSatisfying,
  satisfiesSemVer,
} from "../../dist-compiler-test/compiler/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const fixture = (rel) => JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures", rel), "utf8"));
const catalogFile = JSON.parse(fs.readFileSync(path.join(root, "catalog/builtin-catalog.json"), "utf8"));
const catalog = { capabilities: catalogFile.capabilities, profiles: catalogFile.profiles, assets: catalogFile.assets };
const schemaPass = () => ({ valid: true, diagnostics: [] });
const context = {
  validateSource: schemaPass,
  validateNormalized: schemaPass,
  catalog,
  engineBaselineVersion: "0.2.0",
};

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

// Semver resolution contract.
eq(highestSatisfying(["1.0.0", "1.2.0", "2.0.0"], "^1.0.0"), "1.2.0", "caret chooses highest compatible");
eq(highestSatisfying(["1.0.0", "1.9.9", "2.0.0"], "1.x"), "1.9.9", "major wildcard");
eq(highestSatisfying(["1.2.0", "1.2.9", "1.3.0"], "~1.2.0"), "1.2.9", "tilde range");
ok(satisfiesSemVer("1.5.0", ">=1.0.0 <2.0.0"), "comparator set");
ok(!satisfiesSemVer("0.3.0", "^0.2.3"), "caret zero-major upper bound");

// Canonical JSON key ordering is deterministic.
eq(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}', "canonical JSON ordering");

const source = fixture("valid/scenario-source.json");
const first = await compileScenario(source, context);
ok(first.ok, `valid source compiles: ${JSON.stringify(first.diagnostics)}`);
if (!first.ok) process.exit(1);
eq(first.model.formatId, "infrastructure-cyber-lab.scenario", "normalized format ID");
eq(first.model.minimumEngineVersion, "0.8.0", "minimum engine version reflects route/VLAN/ACL-aware reachability semantics");
eq(first.model.capabilityLocks, [
  { id: "core.network", version: "1.0.0" },
  { id: "core.windows", version: "1.0.0" },
], "exact capability locks");
eq(first.model.profileLocks, [{ id: "vendor.proxmox", version: "1.0.0" }], "exact profile lock");
eq(first.model.resources.find((r) => r.id === "firewall01")?.asset, { id: "network.firewall", version: "1.0.0" }, "firewall asset auto-resolves exactly");
eq(first.model.resources.find((r) => r.id === "admin01")?.asset, { id: "endpoint.windows", version: "1.0.0" }, "workstation maps to endpoint.windows asset");
ok(first.model.assetLocks.some((x) => x.id === "network.firewall" && x.path === "assets/builtin/network.firewall.svg" && x.trusted === true), "normalized exact trusted asset lock emitted");
ok(first.model.assetLocks.every((x) => x.version === "1.0.0"), "asset versions locked exactly");
eq(first.model.metadata.description, "", "metadata description default");
eq(first.model.metadata.authors, [], "authors default");
eq(first.model.resources.find((r) => r.id === "rds01")?.interfaces, [], "interfaces default");
eq(first.model.tests[0]?.label, "direct_rdp", "test label default");
eq(first.model.tests[0]?.expectedSolved, "FALSE", "solved-state expectation preserved");
ok(/^[0-9a-f]{64}$/.test(first.model.sourceHash), "source SHA-256 shape");
eq(first.layoutRequest.hints.length, 2, "layout hints emitted separately from semantic model");
ok(!("layout" in first.model), "layout is not canonical semantic state");

const second = await compileScenario(source, context);
ok(second.ok, "second compile succeeds");
if (second.ok) eq(second.model.sourceHash, first.model.sourceHash, "source hash deterministic");


// Compiler must honor the injected authoritative schema validator gates.
{
  const rejectSourceContext = {
    ...context,
    validateSource: () => ({ valid: false, diagnostics: [{ severity: "error", code: "SCHEMA_TEST", path: "$", message: "synthetic source rejection" }] }),
  };
  const rejected = await compileScenario(source, rejectSourceContext);
  ok(!rejected.ok, "source schema validator rejection stops compilation");
  ok(rejected.diagnostics.some((d) => d.code === "SCHEMA_TEST"), "source schema diagnostic preserved");
}
{
  const rejectNormalizedContext = {
    ...context,
    validateNormalized: () => ({ valid: false, diagnostics: [{ severity: "error", code: "SCHEMA_TEST", path: "$", message: "synthetic normalized rejection" }] }),
  };
  const rejected = await compileScenario(source, rejectNormalizedContext);
  ok(!rejected.ok, "normalized schema validator rejection stops compilation");
  ok(rejected.diagnostics.some((d) => d.code === "NORMALIZED_SCHEMA_TEST"), "normalized diagnostic is namespaced");
}


const enterpriseOriginSource = fixture("valid/scenario-source-enterprise-origin.json");
const enterpriseOriginResult = await compileScenario(enterpriseOriginSource, context);
ok(enterpriseOriginResult.ok, `enterprise-origin scenario compiles: ${JSON.stringify(enterpriseOriginResult.diagnostics)}`);
if (enterpriseOriginResult.ok) {
  eq(enterpriseOriginResult.model.enterpriseOrigin, enterpriseOriginSource.enterpriseOrigin, "compiler preserves enterprise baseline origin binding");
}

const faultOriginSource = fixture("valid/scenario-source-fault-origin.json");
const faultOriginResult = await compileScenario(faultOriginSource, context);
ok(faultOriginResult.ok, `fault-origin scenario compiles: ${JSON.stringify(faultOriginResult.diagnostics)}`);
if (faultOriginResult.ok) {
  eq(faultOriginResult.model.faultOrigin, faultOriginSource.faultOrigin, "compiler preserves fault overlay origin binding");
}

const noteSource = fixture("valid/scenario-source-notes.json");
const noteResult = await compileScenario(noteSource, context);
ok(noteResult.ok, `note scenario compiles: ${JSON.stringify(noteResult.diagnostics)}`);
if (noteResult.ok) {
  eq(noteResult.model.notes?.length, 2, "compiler preserves portable notes");
  eq(noteResult.model.notes?.[0]?.target, "rds01", "compiler preserves note target");
}
{
  const badNoteSource = structuredClone(noteSource);
  badNoteSource.notes = [{ id: "note_unknown", text: "bad target", target: "missing_object" }];
  const rejected = await compileScenario(badNoteSource, context);
  ok(!rejected.ok, "unknown note target rejected by semantic compiler");
  ok(rejected.diagnostics.some((d) => d.code === "UNKNOWN_NOTE_TARGET"), "unknown note target diagnostic explicit");
}
{
  const duplicateNoteSource = structuredClone(noteSource);
  duplicateNoteSource.notes = [{ id: "rds01", text: "collision" }];
  const rejected = await compileScenario(duplicateNoteSource, context);
  ok(!rejected.ok, "note id collision rejected globally");
  ok(rejected.diagnostics.some((d) => d.code === "DUPLICATE_GLOBAL_ID"), "note global id collision diagnostic explicit");
}

const profileSource = fixture("valid/scenario-source-profile.json");
const profileResult = await compileScenario(profileSource, context);
ok(profileResult.ok, `profile scenario compiles: ${JSON.stringify(profileResult.diagnostics)}`);
if (!profileResult.ok) process.exit(1);
const pve = profileResult.model.resources.find((r) => r.id === "pve01");
eq(pve?.vendor, "Proxmox", "profile default vendor");
eq(pve?.product, "Proxmox VE", "profile default product");
eq(pve?.properties.management, { protocol: "https", port: 8006, bind: "10.0.0.10" }, "profile defaults deep-merge with source overrides");
eq(pve?.asset, { id: "virtualization.proxmox", version: "1.0.0" }, "explicit asset requirement resolves exact version");

{
  const bad = structuredClone(source);
  bad.resources[0].asset = { id: "missing.asset", version: "1.x" };
  const result = await compileScenario(bad, context);
  ok(!result.ok, "missing explicit asset rejected");
  ok(result.diagnostics.some((d) => d.code === "ASSET_UNAVAILABLE"), "missing explicit asset diagnostic");
}
{
  const bad = structuredClone(source);
  bad.resources[0].asset = { id: "network.firewall", version: "1.x" };
  const result = await compileScenario(bad, context);
  ok(!result.ok, "asset/resource type mismatch rejected");
  ok(result.diagnostics.some((d) => d.code === "ASSET_TYPE_MISMATCH"), "asset type mismatch diagnostic");
}
{
  const bad = structuredClone(source);
  bad.resources[1].asset = { id: "network.firewall", version: ">=9.0.0" };
  const result = await compileScenario(bad, context);
  ok(!result.ok, "unavailable asset version rejected");
  ok(result.diagnostics.some((d) => d.code === "ASSET_VERSION_UNAVAILABLE"), "asset version unavailable diagnostic");
}
{
  const duplicateAsset = { ...structuredClone(catalogFile.assets.find((x) => x.id === "network.firewall")), id: "network.firewall.alt" };
  const ambiguousContext = { ...context, catalog: { ...context.catalog, assets: [...context.catalog.assets, duplicateAsset] } };
  const result = await compileScenario(source, ambiguousContext);
  ok(!result.ok, "equally-specific automatic asset matches rejected");
  ok(result.diagnostics.some((d) => d.code === "ASSET_MATCH_AMBIGUOUS"), "ambiguous asset diagnostic");
}

const negativeCases = [
  ["invalid/compiler-missing-capability.json", "CAPABILITY_NOT_DECLARED"],
  ["invalid/compiler-unknown-resource.json", "UNKNOWN_RESOURCE_REFERENCE"],
  ["invalid/compiler-profile-mismatch.json", "PROFILE_TYPE_MISMATCH"],
  ["invalid/compiler-version-unavailable.json", "CAPABILITY_VERSION_UNAVAILABLE"],
  ["invalid/compiler-zone-cycle.json", "ZONE_PARENT_CYCLE"],
  ["invalid/compiler-duplicate-global-id.json", "DUPLICATE_GLOBAL_ID"],
];
for (const [rel, code] of negativeCases) {
  const result = await compileScenario(fixture(rel), context);
  ok(!result.ok, `${rel} rejected`);
  ok(result.diagnostics.some((d) => d.code === code), `${rel} reports ${code}: ${JSON.stringify(result.diagnostics)}`);
}

// Phase 74: learner-visible troubleshooting evidence objectives survive compilation unchanged.
{
  const reviewSource = fixture("valid/scenario-source-troubleshooting-objectives.json");
  const result = await compileScenario(reviewSource, context);
  ok(result.ok, `troubleshooting objective source compiles: ${JSON.stringify(result.diagnostics)}`);
  if (result.ok) {
    eq(result.model.troubleshootingObjectives, reviewSource.troubleshootingObjectives, "troubleshooting objectives are preserved exactly into normalized Runtime scenario");
    eq(result.model.troubleshootingObjectives?.[0]?.evidenceOrder, "ordered", "evidence order contract preserved");
    eq(result.model.troubleshootingObjectives?.[0]?.requirements?.[1]?.port, 3389, "probe matcher port preserved exactly");
  }
}

fs.mkdirSync(path.join(root, "tests/generated"), { recursive: true });
fs.writeFileSync(path.join(root, "tests/generated/compiled-foundation.json"), JSON.stringify(first.model, null, 2) + "\n");
fs.writeFileSync(path.join(root, "tests/generated/compiled-profile.json"), JSON.stringify(profileResult.model, null, 2) + "\n");

console.log(`PASS compiler suite: ${checks} assertions; generated outputs written for independent schema validation.`);
