import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readReleaseContract, assertBundledRelease, assertGitBundleInputs } from "../../scripts/release-contract.mjs";
const root = process.cwd();
const real = readReleaseContract(root, { requireGit: false });
assert.equal(real.version, JSON.parse(fs.readFileSync("package.json", "utf8")).version);
assert.equal(real.checkpoint, JSON.parse(fs.readFileSync("package.json", "utf8")).yadilabRelease.checkpoint);
assert.match(fs.readFileSync("ui/app/main.mjs", "utf8"), /data-yadilab-build-version": releaseIdentity.version/);
assert.doesNotMatch(fs.readFileSync("ui/app/main.mjs", "utf8"), /"data-yadilab-build-version": "v?\d+\./);
assert.match(fs.readFileSync("start-yadilab.sh", "utf8"), /APP_VERSION=\$\(read_marker version\)/);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-version-gate-"));
function prepare(pkgMutator = x => x, lockMutator = x => x) {
  fs.writeFileSync(path.join(scratch, "package.json"), JSON.stringify(pkgMutator(JSON.parse(fs.readFileSync("package.json", "utf8")))));
  fs.writeFileSync(path.join(scratch, "package-lock.json"), JSON.stringify(lockMutator(JSON.parse(fs.readFileSync("package-lock.json", "utf8")))));
}
try {
  prepare();
  assert.deepEqual(readReleaseContract(scratch, {requireGit:false}), real);
  assert.throws(() => readReleaseContract(scratch), /RELEASE_GIT_UNVERIFIED/);
  prepare(x => ({ ...x, version: "1.1.1" }));
  assert.throws(() => readReleaseContract(scratch, {requireGit:false}), /RELEASE_LOCK_MISMATCH/);
  prepare(x => ({ ...x, yadilabRelease: {checkpoint: "INVALID"} }));
  assert.throws(() => readReleaseContract(scratch, {requireGit:false}), /RELEASE_CONTRACT_INVALID/);
  prepare(x => x, x => ({...x, version: "1.1.1"}));
  assert.throws(() => readReleaseContract(scratch, {requireGit:false}), /RELEASE_LOCK_MISMATCH/);
  const dir = path.join(scratch, "dist"); fs.mkdirSync(path.join(dir, "assets"), {recursive:true});
  const commit = "a".repeat(40), tree = "b".repeat(40);
  const identity = {...real,sourceCommit: commit,sourceTree:tree};
  const marker = {formatId:"yadilab.browser-build-marker",version:real.version,checkpoint:real.checkpoint,marker:`yadilab-v${real.version}`,sourceCommit:commit,sourceTree:tree};
  const js = `data-yadilab-build-version data-development-checkpoint data-source-commit ${real.version} ${real.checkpoint} ${commit}`;
  fs.writeFileSync(path.join(dir,"build-marker.json"),JSON.stringify(marker));
  fs.writeFileSync(path.join(dir,"assets/app.js"),js);
  assert.equal(assertBundledRelease(dir,identity).sourceCommit, commit);
  // Real Git checkout required: a modified tracked file or wrong expected commit must block.
  const gitRoot = path.join(scratch, "git-checkout"); fs.mkdirSync(gitRoot);
  fs.copyFileSync("package.json", path.join(gitRoot,"package.json"));
  fs.copyFileSync("package-lock.json", path.join(gitRoot,"package-lock.json"));
  const run = (...args) => execFileSync("git",args,{cwd:gitRoot,encoding:"utf8"}).trim();
  run("init","-q"); run("config","user.email","release-test@example.invalid"); run("config","user.name","Release Test");
  fs.mkdirSync(path.join(gitRoot,"asset-library/builtin"),{recursive:true});
  fs.mkdirSync(path.join(gitRoot,"ui/public"),{recursive:true});
  fs.writeFileSync(path.join(gitRoot,"asset-library/builtin/known.svg"),"<svg/>");
  for (const name of ["acceptance.html","acceptance-probe.js","manifest.webmanifest","app-shell.js"]) {
    fs.writeFileSync(path.join(gitRoot,"ui/public",name),"fixture");
  }
  run("add","package.json","package-lock.json","asset-library/builtin","ui/public"); run("commit","-q","-m","fixture");
  const verified = readReleaseContract(gitRoot);
  assert.match(verified.sourceCommit,/^[0-9a-f]{40}$/);
  assert.match(verified.sourceTree,/^[0-9a-f]{40}$/);
  // AUDIT-006 reproduction: untracked and Git-ignored copied assets must fail
  // without any HEAD change or modified tracked files.
  const fixedHead=run("rev-parse","HEAD");
  const untracked=path.join(gitRoot,"asset-library/builtin/extra.svg");
  fs.writeFileSync(untracked,"<svg data-untracked='true'/>");
  assert.throws(()=>readReleaseContract(gitRoot),/RELEASE_SOURCE_UNTRACKED/);
  fs.unlinkSync(untracked);
  fs.writeFileSync(path.join(gitRoot,".gitignore"),"asset-library/builtin/ignored.svg\n");
  const ignored=path.join(gitRoot,"asset-library/builtin/ignored.svg");
  fs.writeFileSync(ignored,"<svg data-ignored='true'/>");
  assert.throws(()=>readReleaseContract(gitRoot),/RELEASE_SOURCE_UNTRACKED/);
  fs.unlinkSync(ignored);fs.unlinkSync(path.join(gitRoot,".gitignore"));
  const badLink=path.join(gitRoot,"asset-library/builtin/linked.svg");
  fs.symlinkSync("known.svg",badLink);
  assert.throws(()=>readReleaseContract(gitRoot),/RELEASE_SOURCE_UNTRACKED|RELEASE_SOURCE_NOT_REGULAR/);
  fs.unlinkSync(badLink);
  assert.equal(run("rev-parse","HEAD"),fixedHead);
  assert.equal(readReleaseContract(gitRoot).sourceCommit,fixedHead);
  assertGitBundleInputs(gitRoot,{inputs:{"package.json":{}, "node_modules/react/index.js":{}}});
  // Real esbuild metafile: import attributes are appended to input keys.
  assertGitBundleInputs(gitRoot,{inputs:{"package.json with { type: 'json' }":{}}});
  // Recognized import attributes must not turn missing source into verified source.
  assert.throws(()=>assertGitBundleInputs(gitRoot,{inputs:{"untracked-entry.mjs with { type: 'json' }":{}}}),/RELEASE_SOURCE_UNTRACKED/);
  // Malformed, unrecognized import attributes must remain denied.
  assert.throws(()=>assertGitBundleInputs(gitRoot,{inputs:{"package.json with { type: 'javascript' }":{}}}),/RELEASE_SOURCE_UNTRACKED/);
  // Traversal-shaped npm paths may not bypass source-origin checks.
  assert.throws(()=>assertGitBundleInputs(gitRoot,{inputs:{"node_modules/../../escape.mjs":{}}}),/RELEASE_SOURCE_OUTSIDE_GIT/);
  assert.throws(()=>assertGitBundleInputs(gitRoot,{inputs:{"untracked-entry.mjs":{}}}),/RELEASE_SOURCE_UNTRACKED/);
  assert.throws(()=>assertGitBundleInputs(gitRoot,{inputs:{"../outside.mjs":{}}}),/RELEASE_SOURCE_OUTSIDE_GIT/);
  assert.throws(()=>assertGitBundleInputs(gitRoot,{inputs:{}}),/RELEASE_SOURCE_INPUTS_MISSING/);

  process.env.YADILAB_EXPECTED_COMMIT="0".repeat(40);
  assert.throws(() => readReleaseContract(gitRoot),/RELEASE_COMMIT_MISMATCH/);
  delete process.env.YADILAB_EXPECTED_COMMIT;
  fs.appendFileSync(path.join(gitRoot,"package-lock.json")," ");
  assert.throws(() => readReleaseContract(gitRoot),/RELEASE_GIT_DIRTY/);
  fs.writeFileSync(path.join(dir,"build-marker.json"),JSON.stringify({...marker,version:"1.1.1"}));
  assert.throws(() => assertBundledRelease(dir,identity), /RELEASE_MARKER_MISMATCH/);
  fs.writeFileSync(path.join(dir,"build-marker.json"),JSON.stringify(marker));
  fs.writeFileSync(path.join(dir,"assets/app.js"),js.replace(real.version,"1.1.1"));
  assert.throws(() => assertBundledRelease(dir,identity), /RELEASE_UI_MISMATCH/);
  fs.writeFileSync(path.join(dir,"assets/app.js"),js.replace(commit,"c".repeat(40)));
  assert.throws(() => assertBundledRelease(dir,identity), /RELEASE_UI_MISMATCH/);
  console.log("PASS VERSION-005: canonical metadata, outdated UI, tampered lock, unverified Git, forged marker, stale JS and commit mismatch all block");
} finally { fs.rmSync(scratch,{recursive:true,force:true}); }
