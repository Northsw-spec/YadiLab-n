import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { verifyCheckpointLockBinding } from "../../scripts/verify_checkpoint_lock_binding.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-lock-contract-"));
const source = path.join(root, "source");
fs.mkdirSync(source);
fs.writeFileSync(path.join(source, "package.json"), '{"version":"dev6"}\n');
fs.writeFileSync(path.join(source, "package-lock.json"), '{"version":"dev6","lockfileVersion":3}\n');
const checkpoint = path.join(root, "checkpoint.zip");
execFileSync("zip", ["-q", "-X", checkpoint, "package.json", "package-lock.json"], { cwd: source });
assert.equal(verifyCheckpointLockBinding({ sourceRoot: source, checkpointZip: checkpoint }).working,
  verifyCheckpointLockBinding({ sourceRoot: source, checkpointZip: checkpoint }).checkpoint);
fs.writeFileSync(path.join(source, "package-lock.json"), '{"version":"tampered","lockfileVersion":3}\n');
assert.throws(() => verifyCheckpointLockBinding({ sourceRoot: source, checkpointZip: checkpoint }), /mismatch/);
console.log("PASS checkpoint-bound package-lock hashing and mismatch detection");
