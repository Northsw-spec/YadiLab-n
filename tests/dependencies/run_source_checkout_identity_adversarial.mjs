import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { computeSourceCheckoutIdentity } from "../../scripts/source-checkout-identity.mjs";

let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const ne = (a, b, m) => { assert.notDeepEqual(a, b, m); checks++; };

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-source-id-adv-"));
  fs.mkdirSync(path.join(dir, "scripts"));
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"fixture"}\n');
  fs.writeFileSync(path.join(dir, "scripts", "build.sh"), '#!/bin/sh\necho one\n');
  fs.chmodSync(path.join(dir, "scripts", "build.sh"), 0o755);
  return dir;
}

let dir = fixture();
try {
  const a = computeSourceCheckoutIdentity(dir);
  fs.writeFileSync(path.join(dir, "scripts", "build.sh"), '#!/bin/sh\necho two\n');
  const b = computeSourceCheckoutIdentity(dir);
  ne(b.sha256, a.sha256, "source byte drift changes identity");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

dir = fixture();
try {
  const a = computeSourceCheckoutIdentity(dir);
  fs.chmodSync(path.join(dir, "scripts", "build.sh"), 0o644);
  const b = computeSourceCheckoutIdentity(dir);
  ne(b.sha256, a.sha256, "Unix executable-mode drift changes identity");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

dir = fixture();
try {
  const a = computeSourceCheckoutIdentity(dir);
  fs.writeFileSync(path.join(dir, "scripts", "extra.mjs"), "export default 1;\n");
  const b = computeSourceCheckoutIdentity(dir);
  ne(b.sha256, a.sha256, "added source file changes identity");
  ok(b.fileCount === a.fileCount + 1, "added source file changes file count");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

dir = fixture();
try {
  const a = computeSourceCheckoutIdentity(dir);
  fs.renameSync(path.join(dir, "scripts", "build.sh"), path.join(dir, "scripts", "renamed.sh"));
  const b = computeSourceCheckoutIdentity(dir);
  ne(b.sha256, a.sha256, "source path rename changes identity");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

dir = fixture();
try {
  fs.symlinkSync("package.json", path.join(dir, "link"));
  let threw = false;
  try { computeSourceCheckoutIdentity(dir); } catch (error) { threw = /symlink is forbidden/.test(String(error)); }
  ok(threw, "source checkout symlink fails closed");
} finally { fs.rmSync(dir, { recursive: true, force: true }); }

console.log(`PASS source checkout identity adversarial: ${checks} assertions.`);
