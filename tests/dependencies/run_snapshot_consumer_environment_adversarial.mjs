import assert from "node:assert/strict";
import { validateSnapshotConsumerEnvironment } from "../../scripts/offline-dependency-snapshot-lib.mjs";

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const baseManifest = {
  target: { platform: "linux", arch: "x86_64" },
  preparedWith: { node: "v22.16.0", npm: "10.9.2" },
};
const baseRuntime = { platform: "linux", arch: "x64", node: "v22.16.0", npm: "10.9.2" };

for (const [field, value, code] of [
  ["platform", "darwin", "SNAPSHOT_CONSUMER_PLATFORM_MISMATCH"],
  ["arch", "arm64", "SNAPSHOT_CONSUMER_ARCH_MISMATCH"],
  ["node", "v22.17.0", "SNAPSHOT_CONSUMER_NODE_MISMATCH"],
  ["npm", "10.9.3", "SNAPSHOT_CONSUMER_NPM_MISMATCH"],
  ["npm", null, "SNAPSHOT_CONSUMER_NPM_MISMATCH"],
]) {
  const result = validateSnapshotConsumerEnvironment(baseManifest, { ...baseRuntime, [field]: value });
  ok(!result.ok, `${field} mismatch rejected`);
  ok(result.diagnostics.some((x) => x.code === code), `${field} mismatch emits ${code}`);
}

for (const [mutation, code] of [
  [{ target: { platform: "win32", arch: "x86_64" } }, "SNAPSHOT_CONSUMER_TARGET_METADATA_INVALID"],
  [{ target: { platform: "linux", arch: "arm64" } }, "SNAPSHOT_CONSUMER_TARGET_METADATA_INVALID"],
  [{ preparedWith: { node: "22.16", npm: "10.9.2" } }, "SNAPSHOT_CONSUMER_PREPARED_NODE_INVALID"],
  [{ preparedWith: { node: "v22.16.0", npm: "latest" } }, "SNAPSHOT_CONSUMER_PREPARED_NPM_INVALID"],
]) {
  const manifest = { ...baseManifest, ...mutation };
  const result = validateSnapshotConsumerEnvironment(manifest, baseRuntime);
  ok(!result.ok, `${code} case rejected`);
  ok(result.diagnostics.some((x) => x.code === code), `${code} emitted`);
}

console.log(`PASS snapshot consumer-environment adversarial suite: ${checks} assertions.`);
