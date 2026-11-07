import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { BUILTIN_CAPABILITY_PACKS, BUILTIN_CAPABILITY_PACK_REGISTRY, CapabilityPackRegistry } from "../../dist-capabilitypacks-test/capability-packs/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "catalog/builtin-catalog.json"), "utf8"));
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks += 1; };

eq(BUILTIN_CAPABILITY_PACKS.length, 8, "Foundation exposes eight built-in capability packs");
eq(BUILTIN_CAPABILITY_PACK_REGISTRY.entries().length, 8, "registry contains all built-ins");

const catalogLocks = catalog.capabilities.map(({ id, version }) => ({ id, version })).sort((a, b) => a.id.localeCompare(b.id));
const runtimeLocks = BUILTIN_CAPABILITY_PACK_REGISTRY.entries().map(({ id, version }) => ({ id, version })).sort((a, b) => a.id.localeCompare(b.id));
eq(runtimeLocks, catalogLocks, "runtime registry exact locks match compiler catalog");

for (const item of BUILTIN_CAPABILITY_PACKS) {
  eq(BUILTIN_CAPABILITY_PACK_REGISTRY.resolveExact(item.id, item.version), item, `${item.id} exact runtime pack resolves`);
  eq(BUILTIN_CAPABILITY_PACK_REGISTRY.versions(item.id), [item.version], `${item.id} advertises exact installed version`);
}

const resolved = BUILTIN_CAPABILITY_PACK_REGISTRY.resolveLocks(catalogLocks);
ok(resolved.ok, "all catalog locks are executable/declarative Runtime-available");
eq(resolved.diagnostics, [], "available locks emit no diagnostics");
eq(resolved.resolved.length, catalogLocks.length, "all exact locks resolve");
ok(resolved.resolved.some((x) => x.id === "core.network" && x.execution === "engine"), "network capability is backed by Engine code");
ok(resolved.resolved.some((x) => x.id === "core.windows" && x.execution === "declarative"), "Windows domain pack uses trusted declarative Engine semantics");

const subset = new CapabilityPackRegistry([{ id: "core.network", version: "1.0.0", execution: "engine" }]);
const subsetResult = subset.resolveLocks([{ id: "core.network", version: "1.0.0" }]);
ok(subsetResult.ok, "custom trusted registry can expose a bounded capability subset");

console.log(`PASS capability-pack registry suite: ${checks} assertions.`);
