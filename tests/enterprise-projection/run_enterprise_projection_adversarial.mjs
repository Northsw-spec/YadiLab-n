import assert from "node:assert/strict";
import fs from "node:fs";
import { projectEnterpriseBaselineToScenario } from "../../dist-enterprise-projection-test/enterprise-projection/src/index.js";
import { computeEnterpriseBaselineIdentity } from "../../dist-enterprise-projection-test/enterprise-model/src/index.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../fixtures/valid/enterprise-baseline.json", import.meta.url), "utf8"));
let passed = 0;
async function ok(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`); }
async function mutate(base, fn) { const x = structuredClone(base); await fn(x); x.baselineIdentity = await computeEnterpriseBaselineIdentity(x); return x; }

await ok("tampered baseline identity blocks projection", async () => {
  const b = structuredClone(fixture); b.baselineIdentity = "f".repeat(64);
  const r = await projectEnterpriseBaselineToScenario({ baseline: b });
  assert.equal(r.ok, false); assert.equal(r.report.diagnostics.some((d) => d.code === "PROJECTION_BASELINE_INVALID"), true);
});

await ok("invalid requested scenario id blocks projection", async () => {
  const r = await projectEnterpriseBaselineToScenario({ baseline: fixture, options: { scenarioId: "INVALID ID" } });
  assert.equal(r.ok, false); assert.equal(r.report.diagnostics.some((d) => d.code === "PROJECTION_SCENARIO_ID_INVALID"), true);
});

await ok("zone-only baseline fails closed instead of fabricating a resource", async () => {
  const b = await mutate(fixture, async (x) => { x.entities = x.entities.filter((e) => e.entityId !== "pc01"); x.relationships = []; x.facts = []; });
  const r = await projectEnterpriseBaselineToScenario({ baseline: b });
  assert.equal(r.ok, false); assert.equal(r.report.diagnostics.some((d) => d.code === "PROJECTION_NO_RESOURCE_ENTITIES"), true);
});

await ok("unknown relationship state never becomes active topology", async () => {
  const b = await mutate(fixture, async (x) => {
    x.entities.push({ entityId: "pc02", entityType: "endpoint.windows", label: "PC-02" });
    x.relationships.push({ relationshipId: "rel_unknown", relationshipType: "network.adjacency", fromRef: "pc01", toRef: "pc02", state: "UNKNOWN", provenanceRefs: [] });
  });
  const r = await projectEnterpriseBaselineToScenario({ baseline: b });
  assert.equal(r.ok, true); assert.equal(r.source.connections.some((c) => c.id === "rel_unknown"), false);
});

await ok("unsupported relationship type remains metadata only", async () => {
  const b = await mutate(fixture, async (x) => {
    x.entities.push({ entityId: "pc02", entityType: "endpoint.windows", label: "PC-02" });
    x.relationships.push({ relationshipId: "rel_dep", relationshipType: "service.depends_on", fromRef: "pc01", toRef: "pc02", state: "KNOWN", provenanceRefs: ["prov_host"] });
  });
  const r = await projectEnterpriseBaselineToScenario({ baseline: b });
  assert.equal(r.ok, true); assert.equal(r.source.connections.some((c) => c.id === "rel_dep"), false);
  assert.equal(r.report.diagnostics.some((d) => d.code === "PROJECTION_RELATIONSHIP_UNSUPPORTED"), true);
});

await ok("container endpoint relationship does not create fake resource edge", async () => {
  const r = await projectEnterpriseBaselineToScenario({ baseline: fixture });
  assert.equal(r.ok, true); assert.equal(r.source.connections.some((c) => c.id === "rel_pc_zone"), false);
  assert.equal(r.report.diagnostics.some((d) => d.code === "PROJECTION_RELATIONSHIP_CONTAINER_ENDPOINT"), true);
});

await ok("invalid interface identifier is preserved but not activated", async () => {
  const b = await mutate(fixture, async (x) => {
    x.facts.push({ factId: "fact_badif", subjectRef: "pc01", path: "/network/interfaces/Bad Interface/ipv4", valueType: "ipv4", state: "KNOWN", value: "10.0.0.2", provenanceRefs: ["prov_ip"] });
  });
  const r = await projectEnterpriseBaselineToScenario({ baseline: b });
  assert.equal(r.ok, true); assert.equal(r.report.diagnostics.some((d) => d.code === "PROJECTION_INTERFACE_ID_UNSUPPORTED"), true);
  assert.equal(r.source.resources[0].interfaces.some((i) => i.id === "Bad Interface"), false);
});

await ok("conflicting resolved duplicate semantic path is not arbitrarily selected", async () => {
  const b = await mutate(fixture, async (x) => {
    x.facts.push(
      { factId: "fact_gw_known1", subjectRef: "pc01", path: "/network/defaultGateway", valueType: "ipv4", state: "KNOWN", value: "10.20.30.1", provenanceRefs: ["prov_gw1"] },
      { factId: "fact_gw_known2", subjectRef: "pc01", path: "/network/defaultGateway", valueType: "ipv4", state: "KNOWN", value: "10.20.30.254", provenanceRefs: ["prov_gw2"] }
    );
  });
  const r = await projectEnterpriseBaselineToScenario({ baseline: b });
  assert.equal(r.ok, true); assert.equal(r.source.resources[0].properties.defaultGateway, undefined);
  assert.equal(r.report.diagnostics.some((d) => d.code === "PROJECTION_FACT_PATH_CONFLICT"), true);
});

await ok("unknown fact stays knowledge only", async () => {
  const r = await projectEnterpriseBaselineToScenario({ baseline: fixture });
  const pc = r.source.resources[0];
  assert.equal(pc.properties.dns, undefined);
  assert.equal(pc.properties.enterprise.facts.some((f) => f.factId === "fact_dns" && f.state === "UNKNOWN"), true);
});

await ok("unknown relationship interface does not forge an interface", async () => {
  const b = await mutate(fixture, async (x) => {
    x.entities.push({ entityId: "pc02", entityType: "endpoint.windows", label: "PC-02" });
    x.relationships.push({ relationshipId: "rel_port", relationshipType: "network.adjacency", fromRef: "pc01", toRef: "pc02", state: "KNOWN", provenanceRefs: ["prov_host"] });
    x.facts.push({ factId: "fact_rel_port", subjectRef: "rel_port", path: "/from/interface", valueType: "string", state: "KNOWN", value: "ghost0", provenanceRefs: ["prov_host"] });
  });
  const r = await projectEnterpriseBaselineToScenario({ baseline: b });
  assert.equal(r.ok, true); const c = r.source.connections.find((x) => x.id === "rel_port");
  assert.equal(c.from.port, undefined); assert.equal(r.report.diagnostics.some((d) => d.code === "PROJECTION_RELATIONSHIP_SOURCE_INTERFACE_UNKNOWN"), true);
});

await ok("self-parent zone is not emitted as a cyclic parent", async () => {
  const b = await mutate(fixture, async (x) => { const z=x.entities.find((e)=>e.entityId==="users_vlan"); z.zoneRef="users_vlan"; });
  const r = await projectEnterpriseBaselineToScenario({ baseline: b });
  assert.equal(r.ok, true); assert.equal(r.source.zones.find((z) => z.id === "users_vlan").parent, undefined);
});

console.log(`PASS enterprise topology projection adversarial: ${passed}/${passed}`);
