import fs from "node:fs";
import path from "node:path";

const TARGETS = [
  { rel: "package-lock.json", kind: "file" },
  { rel: "node_modules", kind: "dir" },
  { rel: "ui/dist", kind: "dir" },
  { rel: "distribution/linux-x86_64", kind: "dir" },
];

function txDirFor(root) {
  const base = path.basename(root);
  return path.join(path.dirname(root), `.${base}.offline-install-transaction`);
}
function journalPath(root) { return path.join(txDirFor(root), "journal.json"); }
function writeJournal(root, journal) {
  const p = journalPath(root);
  fs.writeFileSync(p, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
}
function safeRemove(p) { fs.rmSync(p, { recursive: true, force: true }); }
function ensureParent(p) { fs.mkdirSync(path.dirname(p), { recursive: true }); }

export function recoverOfflineBuildTransaction(rootPath) {
  const root = path.resolve(rootPath);
  const tx = txDirFor(root);
  if (!fs.existsSync(tx)) return { recovered: false };
  const jp = journalPath(root);
  if (!fs.existsSync(jp)) throw new Error(`Transaction directory exists without journal: ${tx}`);
  const journal = JSON.parse(fs.readFileSync(jp, "utf8"));
  if (journal?.schemaVersion !== "1.0.0" || journal?.root !== root || !Array.isArray(journal.targets)) {
    throw new Error(`Invalid offline-install transaction journal: ${jp}`);
  }
  for (const item of [...journal.targets].reverse()) {
    const dst = path.join(root, ...item.rel.split("/"));
    const backup = path.join(tx, "backup", ...item.rel.split("/"));
    if (item.promoted && fs.existsSync(dst)) safeRemove(dst);
    if (item.backedUp) {
      if (!fs.existsSync(backup)) throw new Error(`Missing transaction backup for ${item.rel}`);
      ensureParent(dst);
      fs.renameSync(backup, dst);
    }
  }
  safeRemove(tx);
  return { recovered: true };
}

export function promoteOfflineBuild(rootPath, stagedRootPath, options = {}) {
  const root = path.resolve(rootPath);
  const stagedRoot = path.resolve(stagedRootPath);
  recoverOfflineBuildTransaction(root);
  const tx = txDirFor(root);
  fs.mkdirSync(path.join(tx, "backup"), { recursive: true, mode: 0o700 });
  const targets = TARGETS.map((spec) => ({ ...spec, backedUp: false, promoted: false, hadOriginal: false }));
  const journal = { schemaVersion: "1.0.0", root, stagedRoot, phase: "prepared", targets };
  writeJournal(root, journal);
  let promotionCount = 0;
  const crashAfter = Number(options.crashAfter ?? process.env.YADILAB_PROMOTION_CRASH_AFTER ?? 0);
  const failAfter = Number(options.failAfter ?? process.env.YADILAB_PROMOTION_FAIL_AFTER ?? 0);
  try {
    for (const item of targets) {
      const src = path.join(stagedRoot, ...item.rel.split("/"));
      const stat = fs.lstatSync(src);
      if ((item.kind === "file" && !stat.isFile()) || (item.kind === "dir" && !stat.isDirectory()) || stat.isSymbolicLink()) {
        throw new Error(`Invalid staged promotion target: ${item.rel}`);
      }
    }
    journal.phase = "backing-up"; writeJournal(root, journal);
    for (const item of targets) {
      const dst = path.join(root, ...item.rel.split("/"));
      const backup = path.join(tx, "backup", ...item.rel.split("/"));
      if (fs.existsSync(dst)) {
        item.hadOriginal = true;
        ensureParent(backup);
        fs.renameSync(dst, backup);
        item.backedUp = true;
        writeJournal(root, journal);
      }
    }
    journal.phase = "promoting"; writeJournal(root, journal);
    for (const item of targets) {
      const src = path.join(stagedRoot, ...item.rel.split("/"));
      const dst = path.join(root, ...item.rel.split("/"));
      ensureParent(dst);
      fs.renameSync(src, dst);
      item.promoted = true;
      promotionCount += 1;
      writeJournal(root, journal);
      if (crashAfter === promotionCount) process.exit(86);
      if (failAfter === promotionCount) throw new Error(`Injected promotion failure after ${promotionCount}`);
    }
    journal.phase = "committed"; writeJournal(root, journal);
    safeRemove(tx);
    return { promoted: targets.map((x) => x.rel) };
  } catch (error) {
    try { recoverOfflineBuildTransaction(root); }
    catch (recoveryError) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; rollback failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
    }
    throw error;
  }
}
