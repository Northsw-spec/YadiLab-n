import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = fs.readFileSync(path.join(root, "scripts/prepare_offline_browser_cache.sh"), "utf8");
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };

const online = 'npm ci --cache "$out/npm-cache" --no-audit --no-fund';
const verifyCache = 'npm cache verify --cache "$out/npm-cache" >/dev/null';
const destroy = 'rm -rf node_modules';
const offline = 'npm ci --offline --cache "$out/npm-cache" --no-audit --no-fund';
const readiness = 'node scripts/check_browser_build_readiness.mjs';
const toolchain = 'node scripts/check_browser_toolchain_execution.mjs';
const manifest = 'node scripts/create_offline_dependency_snapshot_manifest.mjs "$out"';
const preSigningVerify = 'node scripts/verify_offline_dependency_snapshot.mjs --pre-signing "$out"';

const onlineAt = script.indexOf(online);
const verifyAt = script.indexOf(verifyCache);
const destroyAt = script.indexOf(destroy);
const offlineAt = script.indexOf(offline);
const readinessFirst = script.indexOf(readiness);
const readinessLast = script.lastIndexOf(readiness);
const toolchainFirst = script.indexOf(toolchain);
const toolchainLast = script.lastIndexOf(toolchain);
const manifestAt = script.indexOf(manifest);
const preSigningVerifyAt = script.indexOf(preSigningVerify);

ok(onlineAt >= 0, "producer performs an online cache-populating npm ci");
ok(verifyAt > onlineAt, "npm cache integrity is verified after online population");
ok(destroyAt > verifyAt, "first node_modules tree is destroyed before replay");
ok(offlineAt > destroyAt, "producer performs a fresh strict-offline npm ci replay");
ok(!script.includes("npm ci --prefer-offline"), "producer never weakens replay to prefer-offline");
ok(readinessFirst > onlineAt && readinessFirst < destroyAt, "first install passes dependency readiness before destruction");
ok(toolchainFirst > readinessFirst && toolchainFirst < destroyAt, "first install executes the browser toolchain before destruction");
ok(readinessLast > offlineAt, "offline replay must pass dependency readiness");
ok(toolchainLast > readinessLast, "offline replay must execute the browser toolchain");
ok(manifestAt > toolchainLast, "snapshot manifest is created only after offline replay succeeds");
ok(preSigningVerifyAt > manifestAt, "unsigned snapshot structure is verified explicitly before provenance signing");
ok(!script.includes('node scripts/verify_offline_dependency_snapshot.mjs "$out"'), "cache producer does not require final provenance before the signing step");
ok((script.match(/npm ci --offline/g) ?? []).length === 1, "producer contains exactly one strict offline replay");
ok((script.match(/check_browser_toolchain_execution\.mjs/g) ?? []).length === 2, "toolchain is executed for both online population and offline replay");

console.log(`PASS dependency snapshot producer contract suite: ${checks} assertions.`);
