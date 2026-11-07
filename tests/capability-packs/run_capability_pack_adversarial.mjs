import assert from "node:assert/strict";
import { BUILTIN_CAPABILITY_PACK_REGISTRY, CapabilityPackRegistry } from "../../dist-capabilitypacks-test/capability-packs/src/index.js";
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks += 1; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks += 1; };

let result = BUILTIN_CAPABILITY_PACK_REGISTRY.resolveLocks([{ id: "core.ghost", version: "1.0.0" }]);
eq(result.ok, false, "unknown capability pack fails closed");
eq(result.diagnostics[0]?.code, "CAPABILITY_PACK_UNAVAILABLE", "unknown pack diagnostic named");

result = BUILTIN_CAPABILITY_PACK_REGISTRY.resolveLocks([{ id: "core.network", version: "9.9.9" }]);
eq(result.ok, false, "uninstalled exact capability version fails closed");
eq(result.diagnostics[0]?.code, "CAPABILITY_PACK_VERSION_UNAVAILABLE", "version mismatch diagnostic named");
ok(result.diagnostics[0]?.message.includes("1.0.0"), "version mismatch reports installed version");

result = BUILTIN_CAPABILITY_PACK_REGISTRY.resolveLocks([
  { id: "core.network", version: "1.0.0" },
  { id: "core.network", version: "1.0.0" },
]);
eq(result.ok, false, "duplicate scenario lock fails closed");
eq(result.diagnostics[0]?.code, "CAPABILITY_LOCK_DUPLICATE", "duplicate lock diagnostic named");

assert.throws(() => new CapabilityPackRegistry([
  { id: "core.network", version: "1.0.0", execution: "engine" },
  { id: "core.network", version: "1.0.0", execution: "declarative" },
]), /Duplicate capability pack runtime descriptor/);
checks += 1;
assert.throws(() => new CapabilityPackRegistry([{ id: "Bad ID", version: "1.0.0", execution: "engine" }]), /Invalid capability pack id/);
checks += 1;
assert.throws(() => new CapabilityPackRegistry([{ id: "core.test", version: "latest", execution: "engine" }]), /Invalid capability pack version/);
checks += 1;

const immutable = BUILTIN_CAPABILITY_PACK_REGISTRY.entries();
ok(Object.isFrozen(immutable), "built-in registry entry list is frozen");

console.log(`PASS capability-pack registry adversarial suite: ${checks} assertions.`);
