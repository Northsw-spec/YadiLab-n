import assert from "node:assert/strict";
import { enterpriseOfficeHealthy } from "../../ui/app/enterprise-office-scenario.mjs";
import { compileScenario } from "../../dist-compiler-test/compiler/src/index.js";

const count = enterpriseOfficeHealthy.resources.length;
assert.ok(count >= 30, "canonical enterprise scenario must not regress below the size contract");
const underSized = { ...enterpriseOfficeHealthy, resources: enterpriseOfficeHealthy.resources.slice(0, 29) };
assert.ok(underSized.resources.length < 30, "29-node adversarial fixture remains below contract");
const ids = new Set(enterpriseOfficeHealthy.resources.map((item) => item.id));
const dangling = structuredClone(enterpriseOfficeHealthy);
dangling.connections[0].to.resource = "missing-endpoint";
const compileContext = { validateSource: () => ({ valid: true, diagnostics: [] }), validateNormalized: () => ({ valid: true, diagnostics: [] }), catalog: { capabilities: [], profiles: [], assets: [] }, engineBaselineVersion: "0.2.0" };
const danglingResult = await compileScenario(dangling, compileContext);
assert.equal(danglingResult.ok, false, "product compiler rejects dangling endpoint");
assert.ok(danglingResult.diagnostics.some((diagnostic) => /endpoint|unknown|connection/i.test(diagnostic.code + diagnostic.message)), "dangling endpoint diagnostic is explicit");
assert.equal(enterpriseOfficeHealthy.connections.some((connection) => connection.from.resource === connection.to.resource), false, "self-links are not silently introduced");
console.log("PASS dev24 enterprise adversarial contract: undersized, dangling and self-link guards");
