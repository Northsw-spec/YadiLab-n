import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { computeSourceCheckoutIdentity, SOURCE_CHECKOUT_ID_SCHEMA_VERSION } from "../../scripts/source-checkout-identity.mjs";

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-source-id-"));
try {
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "ui", "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"fixture"}\n');
  fs.writeFileSync(path.join(dir, "scripts", "build.sh"), '#!/bin/sh\necho ok\n');
  fs.chmodSync(path.join(dir, "scripts", "build.sh"), 0o755);
  fs.writeFileSync(path.join(dir, "ui", "src", "main.mjs"), 'export const ok = true;\n');

  const first = computeSourceCheckoutIdentity(dir);
  const second = computeSourceCheckoutIdentity(dir);
  eq(first.schemaVersion, SOURCE_CHECKOUT_ID_SCHEMA_VERSION, "identity schema explicit");
  ok(/^[0-9a-f]{64}$/.test(first.sha256), "identity SHA-256 canonical");
  eq(first.fileCount, 3, "only source fixture files counted");
  ok(first.totalBytes > 0, "source byte count recorded");
  eq(second, first, "same checkout produces deterministic identity");

  fs.writeFileSync(path.join(dir, "package-lock.json"), "generated-lock\n");
  fs.mkdirSync(path.join(dir, "node_modules", "x"), { recursive: true });
  fs.writeFileSync(path.join(dir, "node_modules", "x", "index.js"), "generated\n");
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".git", "HEAD"), "ref: local\n");
  fs.mkdirSync(path.join(dir, "distribution", "linux-x86_64"), { recursive: true });
  fs.writeFileSync(path.join(dir, "distribution", "linux-x86_64", "app-launcher"), "generated\n");
  fs.mkdirSync(path.join(dir, "ui", "dist"), { recursive: true });
  fs.writeFileSync(path.join(dir, "ui", "dist", "assets.js"), "generated\n");
  fs.mkdirSync(path.join(dir, "dist-engine-test"), { recursive: true });
  fs.writeFileSync(path.join(dir, "dist-engine-test", "x.js"), "generated\n");
  fs.writeFileSync(path.join(dir, "launcher-smoke.log"), "generated\n");
  fs.writeFileSync(path.join(dir, "parrot-acceptance-report.txt"), "generated\n");
  eq(computeSourceCheckoutIdentity(dir), first, "developer/generated state is excluded from source identity");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

console.log(`PASS source checkout identity: ${checks} assertions.`);
