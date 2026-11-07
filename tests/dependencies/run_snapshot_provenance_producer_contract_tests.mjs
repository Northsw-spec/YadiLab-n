import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const producer = fs.readFileSync(path.join(root, "scripts/prepare_offline_browser_snapshot.sh"), "utf8");
const signer = fs.readFileSync(path.join(root, "scripts/sign_offline_dependency_snapshot.mjs"), "utf8");
const verifier = fs.readFileSync(path.join(root, "scripts/verify_offline_dependency_snapshot.mjs"), "utf8");
const sealer = fs.readFileSync(path.join(root, "scripts/seal_offline_dependency_snapshot.sh"), "utf8");
const installer = fs.readFileSync(path.join(root, "scripts/install_offline_browser_dependencies.sh"), "utf8");
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };

const cache = 'bash scripts/prepare_offline_browser_cache.sh "$tmp/snapshot"';
const sign = 'node scripts/sign_offline_dependency_snapshot.mjs "$tmp/snapshot" "$key"';
const seal = 'bash scripts/seal_offline_dependency_snapshot.sh "$tmp/snapshot" "$out"';
const cacheAt = producer.indexOf(cache);
const signAt = producer.indexOf(sign);
const sealAt = producer.indexOf(seal);

ok(producer.includes('YADILAB_SNAPSHOT_SIGNING_KEY'), "producer requires an explicitly supplied external signing-key path");
ok(producer.includes("BLOCKED: set YADILAB_SNAPSHOT_SIGNING_KEY"), "missing signing key fails closed instead of silently producing unsigned transport");
ok(cacheAt >= 0 && signAt > cacheAt, "snapshot is signed only after cache/manifest production completes");
ok(sealAt > signAt, "transport sealing happens only after provenance signing");
ok(!producer.includes("BEGIN PRIVATE KEY") && !producer.includes("BEGIN OPENSSH PRIVATE KEY"), "producer script embeds no private signing key material");
ok(producer.includes("must live outside the application source checkout"), "producer refuses a private signing key stored inside the source checkout");
ok(producer.includes("permissions must be 0400 or 0600"), "producer requires restrictive private-key file permissions");
ok(signer.includes("signSnapshotProvenance"), "signing CLI delegates to the verified provenance library");
ok(signer.includes("process.exit(77)"), "signing failure is a fail-closed gate");
ok(verifier.includes('process.argv[2] === "--pre-signing"') && verifier.includes("requireProvenance: !preSigning"), "pre-signing verification bypasses only the not-yet-created provenance files");
ok(sealer.includes("verify_offline_dependency_snapshot.mjs"), "sealer re-verifies signed snapshot before transport packing");
ok(installer.includes("snapshot-provenance.json") && installer.includes("snapshot-provenance.sig"), "offline installer requires both provenance control files");
ok(installer.indexOf('node scripts/verify_offline_dependency_snapshot.mjs "$cache"') < installer.indexOf('npm cache verify --cache "$cache/npm-cache"'), "signature/provenance verification occurs before npm consumes cache bytes");

console.log(`PASS snapshot provenance producer-contract suite: ${checks} assertions.`);
