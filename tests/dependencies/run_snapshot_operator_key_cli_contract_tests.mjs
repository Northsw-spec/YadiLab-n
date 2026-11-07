import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(root, "scripts", "manage_snapshot_operator_key.mjs");
const base = fs.mkdtempSync(path.join(os.tmpdir(), "snapshot-operator-key-cli-"));
let assertions = 0;
function ok(value, message) { if (!value) throw new Error(message); assertions += 1; }
function run(args) { return spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" }); }
try {
  let r = run([]);
  ok(r.status === 2, "missing command must return usage exit 2");
  r = run(["generate"]);
  ok(r.status === 2, "incomplete generate command must return usage exit 2");
  r = run(["verify"]);
  ok(r.status === 2, "incomplete verify command must return usage exit 2");

  const target = path.join(base, "bundle");
  r = run(["generate", target, "cli-producer"]);
  ok(r.status === 0 && /PASS operator key bundle generated/.test(r.stdout), "CLI generation must pass");
  ok(/keyId=ed25519-sha256:[0-9a-f]{64}/.test(r.stdout), "CLI generation must print fingerprint");
  r = run(["verify", target]);
  ok(r.status === 0 && /PASS operator key bundle verified/.test(r.stdout), "CLI verification must pass");
  r = run(["generate", target, "duplicate"]);
  ok(r.status === 77 && /refusing to overwrite/.test(r.stderr), "CLI must fail closed on overwrite");
  r = run(["generate", path.join(root, "dist-operator-key-test"), "inside"]);
  ok(r.status === 77 && /outside/.test(r.stderr), "CLI must fail closed inside source checkout");
  fs.rmSync(path.join(root, "dist-operator-key-test"), { recursive: true, force: true });
  console.log(`PASS snapshot operator key CLI contract: ${assertions} assertions`);
} finally {
  fs.rmSync(path.join(root, "dist-operator-key-test"), { recursive: true, force: true });
  fs.rmSync(base, { recursive: true, force: true });
}
