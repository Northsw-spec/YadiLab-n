/** One source of truth: package.json version + yadilabRelease fields.
 * Lockfile and Git identity are independent fail-closed cross-checks.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CHECKPOINT = /^[A-Z]+-[0-9]{3,}$/;
const SHA = /^[0-9a-f]{40}$/;
function json(filename) { return JSON.parse(fs.readFileSync(filename, "utf8")); }
function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/** Only Git-indexed, regular source bytes may enter an attested bundle.
 * git status --untracked-files=no alone misses untracked and ignored assets.
 * Generated output directories are deliberately excluded.
 */
function trackedPaths(root) {
  const bytes=execFileSync("git", ["ls-files", "--cached", "-z"], {
    cwd:root,encoding:"buffer",stdio:["ignore","pipe","pipe"],maxBuffer:16*1024*1024,
  });
  return new Set(bytes.toString("utf8").split("\0").filter(Boolean));
}
function sourcePath(root, filename) {
  const candidate=path.resolve(root,filename);
  const rel=path.relative(root,candidate).split(path.sep).join("/");
  if (!rel || rel===".." || rel.startsWith("../") || path.isAbsolute(rel)) {
    throw new Error("RELEASE_SOURCE_OUTSIDE_GIT: build input escapes source root");
  }
  return {candidate,rel};
}
function indexedRegularFile(root,tracked,filename) {
  const {candidate,rel}=sourcePath(root,filename);
  if (!tracked.has(rel)) {
    throw new Error(`RELEASE_SOURCE_UNTRACKED: copied or bundled input absent from Git index: ${rel}`);
  }
  let info;
  try { info=fs.lstatSync(candidate); }
  catch { throw new Error("RELEASE_SOURCE_MISSING: Git-indexed build input unavailable"); }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("RELEASE_SOURCE_NOT_REGULAR: symlinks and special files forbidden");
  }
}
function inventoryDirectory(root,tracked,dirname) {
  const {candidate}=sourcePath(root,dirname);
  let info;
  try { info=fs.lstatSync(candidate); }
  catch { throw new Error("RELEASE_SOURCE_MISSING: required asset directory absent"); }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error("RELEASE_SOURCE_NOT_REGULAR: asset directory must be real");
  }
  for (const entry of fs.readdirSync(candidate,{withFileTypes:true})) {
    const nested=path.join(dirname,entry.name);
    if (entry.isDirectory()) inventoryDirectory(root,tracked,nested);
    else indexedRegularFile(root,tracked,nested);
  }
}
/** Inspect copied assets, including Git-ignored and untracked extra files. */
export function assertGitCopiedAssets(root) {
  const tracked=trackedPaths(root);
  inventoryDirectory(root,tracked,"asset-library/builtin");
  for (const file of ["acceptance.html","acceptance-probe.js","manifest.webmanifest","app-shell.js"]) {
    indexedRegularFile(root,tracked,path.join("ui/public",file));
  }
}
/** Inspect actual esbuild inputs; only node_modules comes from locked npm. */
export function assertGitBundleInputs(root,metafile) {
  if (!metafile || !metafile.inputs || !Object.keys(metafile.inputs).length) {
    throw new Error("RELEASE_SOURCE_INPUTS_MISSING: actual bundle input inventory required");
  }
  const tracked=trackedPaths(root);
  for (const filename of Object.keys(metafile.inputs)) {
    const normalized=filename.replaceAll("\\","/");
    if (normalized.startsWith("<") || normalized.includes("\0")) {
      throw new Error("RELEASE_SOURCE_INPUT_INVALID: invalid bundle input");
    }
    // esbuild can append an import-attribute suffix to the *metafile key*
    // (e.g. app-config/branding.json with { type: 'json' }). That suffix is
    // not part of the on-disk filename. Strip ONLY this exact, known attribute.
    const jsonSuffix = " with { type: 'json' }";
    const inputFile = normalized.endsWith(jsonSuffix)
      ? normalized.slice(0, -jsonSuffix.length) : normalized;
    // Resolve before exempting installed locked npm inputs; a traversal via
    // node_modules/../../ must never bypass the Git-indexed source gate.
    const {rel} = sourcePath(root, inputFile);
    if (rel.startsWith("node_modules/")) continue;
    indexedRegularFile(root,tracked,rel);
  }
}

export function readReleaseContract(root, { requireGit = true } = {}) {
  const pkg = json(path.join(root, "package.json"));
  const lock = json(path.join(root, "package-lock.json"));
  const version = pkg.version;
  const checkpoint = pkg.yadilabRelease?.checkpoint;
  const description = pkg.yadilabRelease?.description;
  if (typeof version !== "string" || !VERSION.test(version) || typeof checkpoint !== "string" || !CHECKPOINT.test(checkpoint) || typeof description !== "string" || !description.trim()) {
    throw new Error("RELEASE_CONTRACT_INVALID: package.json is the authoritative version/checkpoint/description declaration");
  }
  if (lock.version !== version || lock.packages?.[""]?.version !== version || lock.name !== pkg.name || lock.packages?.[""]?.name !== pkg.name) {
    throw new Error("RELEASE_LOCK_MISMATCH: package-lock.json differs from authoritative package.json");
  }
  const contract = { version, checkpoint, description };
  if (!requireGit) return contract;
  let commit, tree, status;
  try {
    commit = git(root, "rev-parse", "--verify", "HEAD^{commit}");
    tree = git(root, "rev-parse", "HEAD^{tree}");
    status = git(root, "status", "--porcelain", "--untracked-files=no");
    if (git(root, "rev-parse", "--show-toplevel") !== fs.realpathSync(root)) throw new Error("not repository root");
  } catch (error) { throw new Error(`RELEASE_GIT_UNVERIFIED: real Git HEAD required: ${error.message}`); }
  if (!SHA.test(commit) || !SHA.test(tree)) throw new Error("RELEASE_GIT_INVALID: invalid Git commit/tree");
  if (status) throw new Error(`RELEASE_GIT_DIRTY: cannot release modified tracked files: ${status.slice(0, 350)}`);
  assertGitCopiedAssets(root);
  if (process.env.YADILAB_EXPECTED_COMMIT && process.env.YADILAB_EXPECTED_COMMIT !== commit) {
    throw new Error("RELEASE_COMMIT_MISMATCH: checked out HEAD differs from required commit");
  }
  return { ...contract, sourceCommit: commit, sourceTree: tree };
}

export function assertBundledRelease(dir, release) {
  const marker = json(path.join(dir, "build-marker.json"));
  const expected = { version: release.version, checkpoint: release.checkpoint, marker: `yadilab-v${release.version}`, sourceCommit: release.sourceCommit, sourceTree: release.sourceTree };
  if (marker.formatId !== "yadilab.browser-build-marker" || Object.entries(expected).some(([k,v]) => marker[k] !== v) || !SHA.test(marker.sourceCommit ?? "") || !SHA.test(marker.sourceTree ?? "")) {
    throw new Error("RELEASE_MARKER_MISMATCH: build-marker.json does not describe the verified Git source");
  }
  const js = fs.readFileSync(path.join(dir, "assets/app.js"), "utf8");
  // Static defense-in-depth ONLY: actual Chromium CI must independently assert
  // the mounted, visible and functional UI before publishing release artifacts.
  for (const value of [release.version, release.checkpoint, release.sourceCommit]) {
    if (!js.includes(value)) throw new Error(`RELEASE_UI_MISMATCH: compiled UI omits ${value}`);
  }
  if (!js.includes("data-yadilab-build-version") || !js.includes("data-development-checkpoint") || !js.includes("data-source-commit")) {
    throw new Error("RELEASE_UI_MARKER_MISSING: actual rendered UI identity contract absent");
  }
  return marker;
}
