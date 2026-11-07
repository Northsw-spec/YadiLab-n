import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
function lockHashFromZip(zipPath) {
  const bytes = execFileSync("unzip", ["-p", zipPath, "package-lock.json"]);
  if (!bytes.length) throw new Error(`Checkpoint does not contain package-lock.json: ${zipPath}`);
  return sha256(bytes);
}
function lockHashFromDir(root) {
  const file = path.join(root, "package-lock.json");
  if (!fs.existsSync(file)) throw new Error(`Source does not contain package-lock.json: ${file}`);
  return sha256(fs.readFileSync(file));
}

export function verifyCheckpointLockBinding({ sourceRoot, checkpointZip, sealedZip }) {
  const working = lockHashFromDir(sourceRoot);
  const checkpoint = lockHashFromZip(checkpointZip);
  if (working !== checkpoint) throw new Error(`Working/checkpoint lock mismatch: ${working} != ${checkpoint}`);
  const result = { working, checkpoint };
  if (sealedZip) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-lock-readback-"));
    try {
      execFileSync("unzip", ["-q", sealedZip, "-d", temp]);
      const inner = fs.readdirSync(temp).find((name) => name.endsWith("_SOURCE_CHECKPOINT.zip"));
      if (!inner) throw new Error(`Sealed artifact has no inner source checkpoint: ${sealedZip}`);
      result.sealedInner = lockHashFromZip(path.join(temp, inner));
      if (result.checkpoint !== result.sealedInner) {
        throw new Error(`Checkpoint/sealed-inner lock mismatch: ${result.checkpoint} != ${result.sealedInner}`);
      }
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [sourceRoot, checkpointZip, sealedZip] = process.argv.slice(2);
  if (!sourceRoot || !checkpointZip) throw new Error("Usage: node verify_checkpoint_lock_binding.mjs SOURCE_ROOT CHECKPOINT_ZIP [SEALED_ZIP]");
  console.log(JSON.stringify({ status: "PASS", ...verifyCheckpointLockBinding({ sourceRoot, checkpointZip, sealedZip }) }, null, 2));
}
