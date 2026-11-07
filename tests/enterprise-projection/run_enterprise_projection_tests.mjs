import assert from "node:assert/strict";
import fs from "node:fs";
import { projectEnterpriseBaselineToScenario } from "../../dist-enterprise-projection-test/enterprise-projection/src/index.js";
import { computeEnterpriseBaselineIdentity } from "../../dist-enterprise-projection-test/enterprise-model/src/index.js";
import { compileScenario } from "../../dist-enterprise-projection-test/compiler/src/index.js";
import { buildLayoutGraph } from "../../dist-enterprise-projection-test/layout/src/projection.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/valid/enterprise-baseline.json", import.meta.url), "utf8"));
let passed = 0;
async function ok(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`); }
async function mutate(base, fn) { const x = structuredClone(base); await fn(x); x.baselineIdentity = await computeEnterpriseBaselineIdentity(x); return x; }

const compilerContext = {
  validateSource: () => ({ valid: true, diagnostics: [] }),
  validateNormalized: () => ({ valid: true, diagnostics: [] }),
  engineBaselineVersion: "0.2.0",
  catalog: {
    capabilities: [
      { id: "core.network", version: "1.0.0", minimumEngineVersion: "0.2.0", claims: { resourceTypePrefixes: ["network."], connectionKinds: ["network", "management"], ruleOps: ["reachable"] } },
      { id: "core.identity", version: "1.0.0", minimumEngineVersion: "0.2.0", claims: { resourceTypePrefixes: ["identity."], connectionKinds: ["trust", "authentication"], ruleOps: ["member_of", "has_permission"] } },
      { id: "core.windows", version: "1.0.0", minimumEngineVersion: "0.2.0", claims: { resourceTypePrefixes: ["windows."] } },
      { id: "core.linux", version: "1.0.0", minimumEngineVersion: "0.2.0", claims: { resourceTypePrefixes: ["linux."] } },
    ],
    profiles: [],
    assets: [{ id: "resource.generic", version: "1.0.0", label: "Generic", path: "assets/builtin/resource.generic.svg", mime: "image/svg+xml", appliesTo: ["*"], width: 160, height: 100, trusted: true }],
  },
};

await ok("valid baseline projects explicit site/zone and endpoint", async () => {
  const result = await projectEnterpriseBaselineToScenario({ baseline: fixture });
  assert.equal(result.ok, true);
  assert.equal(result.report.status, "READY");
  assert.equal(result.source.zones.length, 2);
  assert.equal(result.source.resources.length, 1);
  const pc = result.source.resources[0];
  assert.equal(pc.id, "pc01");
  assert.equal(pc.zone, "users_vlan");
  assert.deepEqual(pc.interfaces[0].addresses, ["10.20.30.44"]);
  assert.equal(pc.properties.defaultGateway, undefined, "CONFLICTING gateway must not become active scenario truth");
  assert.equal(pc.properties.enterprise.facts.length, fixture.facts.filter((f) => f.subjectRef === "pc01").length);
});

await ok("projection binds exact enterprise origin without source display names", async () => {
  const result = await projectEnterpriseBaselineToScenario({ baseline: fixture });
  assert.equal(result.ok, true);
  assert.equal(result.source.enterpriseOrigin.baselineIdentity, fixture.baselineIdentity);
  assert.equal(result.source.enterpriseOrigin.projectionVersion, "0.1.0");
  assert.equal(result.source.enterpriseOrigin.sources.length, 2);
  assert.equal(Object.hasOwn(result.source.enterpriseOrigin.sources[0], "displayName"), false);
});

const connected = await mutate(fixture, async (x) => {
  x.entities.push({ entityId: "pc02", entityType: "endpoint.windows", label: "PC-02", zoneRef: "users_vlan" });
  x.relationships.push({ relationshipId: "rel_pc_pc", relationshipType: "network.adjacency", fromRef: "pc01", toRef: "pc02", state: "KNOWN", provenanceRefs: ["prov_host"] });
  x.facts.push({ factId: "fact_pc02_ip", subjectRef: "pc02", path: "/network/interfaces/eth0/ipv4", valueType: "ipv4", state: "KNOWN", value: "10.20.30.45", provenanceRefs: ["prov_ip"] });
});

await ok("known network relationship becomes semantic connection", async () => {
  const result = await projectEnterpriseBaselineToScenario({ baseline: connected });
  assert.equal(result.ok, true);
  assert.equal(result.source.connections.some((c) => c.id === "rel_pc_pc" && c.kind === "network"), true);
  assert.equal(result.source.requires.capabilities.some((c) => c.id === "core.network"), true);
});

await ok("projected source compiles through ordinary scenario compiler", async () => {
  const result = await projectEnterpriseBaselineToScenario({ baseline: connected });
  assert.equal(result.ok, true);
  const compiled = await compileScenario(result.source, compilerContext);
  assert.equal(compiled.ok, true, JSON.stringify(compiled.diagnostics));
  assert.equal(compiled.model.enterpriseOrigin.baselineIdentity, connected.baselineIdentity);
  assert.equal(compiled.model.resources.length, 2);
  assert.equal(compiled.model.connections.length, 1);
});

await ok("compiled projection feeds ordinary layout graph", async () => {
  const result = await projectEnterpriseBaselineToScenario({ baseline: connected });
  const compiled = await compileScenario(result.source, compilerContext);
  assert.equal(compiled.ok, true);
  const graph = buildLayoutGraph(compiled.model);
  assert.equal(graph.edges.some((e) => e.id === "rel_pc_pc"), true);
  const zone = graph.children.find((node) => node.id === "users_vlan");
  assert.ok(zone);
  assert.equal(zone.children.some((node) => node.id === "pc01"), true);
  assert.equal(zone.children.some((node) => node.id === "pc02"), true);
});

await ok("explicit resolved vendor/product and engine properties project", async () => {
  const b = await mutate(fixture, async (x) => {
    x.facts.push(
      { factId: "fact_vendor", subjectRef: "pc01", path: "/asset/vendor", valueType: "string", state: "KNOWN", value: "ExampleVendor", provenanceRefs: ["prov_host"] },
      { factId: "fact_product", subjectRef: "pc01", path: "/asset/product", valueType: "string", state: "KNOWN", value: "ExampleBox", provenanceRefs: ["prov_host"] },
      { factId: "fact_services", subjectRef: "pc01", path: "/services", valueType: "list", state: "KNOWN", value: [{ name: "rdp", protocol: "tcp", port: 3389, enabled: true }], provenanceRefs: ["prov_host"] },
      { factId: "fact_routes", subjectRef: "pc01", path: "/network/routes", valueType: "list", state: "KNOWN", value: [{ destination: "default", via: "10.20.30.1" }], provenanceRefs: ["prov_host"] }
    );
  });
  const result = await projectEnterpriseBaselineToScenario({ baseline: b });
  assert.equal(result.ok, true);
  const pc = result.source.resources.find((r) => r.id === "pc01");
  assert.equal(pc.vendor, "ExampleVendor");
  assert.equal(pc.product, "ExampleBox");
  assert.equal(pc.properties.services[0].port, 3389);
  assert.equal(pc.properties.routes[0].destination, "default");
});

await ok("zone parent derives only from explicit refs", async () => {
  const b = await mutate(fixture, async (x) => { x.entities.find((e) => e.entityId === "users_vlan").siteRef = "site_hq"; });
  const result = await projectEnterpriseBaselineToScenario({ baseline: b });
  assert.equal(result.ok, true);
  assert.equal(result.source.zones.find((z) => z.id === "users_vlan").parent, "site_hq");
});

await ok("projection output is deterministic", async () => {
  const a = await projectEnterpriseBaselineToScenario({ baseline: connected });
  const b = await projectEnterpriseBaselineToScenario({ baseline: structuredClone(connected) });
  assert.deepEqual(a, b);
});

await ok("projection report accounts for preserved and active facts", async () => {
  const result = await projectEnterpriseBaselineToScenario({ baseline: fixture });
  assert.equal(result.ok, true);
  assert.equal(result.report.stats.preservedFacts, fixture.facts.length);
  assert.ok(result.report.stats.projectedFacts >= 1);
  assert.equal(result.report.stats.resources, 1);
});

console.log(`PASS enterprise topology projection functional: ${passed}/${passed}`);
