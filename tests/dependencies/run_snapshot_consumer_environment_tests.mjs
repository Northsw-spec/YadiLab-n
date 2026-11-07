import assert from "node:assert/strict";
import { validateSnapshotConsumerEnvironment } from "../../scripts/offline-dependency-snapshot-lib.mjs";

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const manifest = {
  target: { platform: "linux", arch: "x86_64" },
  preparedWith: { node: "v22.16.0", npm: "10.9.2" },
};

const exact = validateSnapshotConsumerEnvironment(manifest, {
  platform: "linux", arch: "x64", node: "v22.16.0", npm: "10.9.2",
});
ok(exact.ok, `exact producer/consumer tool identity accepted: ${JSON.stringify(exact.diagnostics)}`);
eq(exact.diagnostics, [], "exact consumer environment has no diagnostics");

const normalized = validateSnapshotConsumerEnvironment(manifest, {
  platform: "linux", arch: "x86_64", node: "v22.16.0", npm: "10.9.2",
});
ok(normalized.ok, "normalized x86_64 architecture identity accepted");

console.log(`PASS snapshot consumer-environment suite: ${checks} assertions.`);
