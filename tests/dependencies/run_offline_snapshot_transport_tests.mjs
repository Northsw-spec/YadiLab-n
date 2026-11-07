import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { verifyOfflineDependencySnapshot } from "../../scripts/offline-dependency-snapshot-lib.mjs";
import { createTrustedTestSource, createSignedTestSnapshot } from "./snapshot-signing-test-helper.mjs";

const originalRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const trustedSource = createTrustedTestSource(originalRoot);
const root = trustedSource.sourceRoot;
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const shaFile = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: root, encoding: "utf8", ...opts });
}

function makeSnapshot(base) {
  return createSignedTestSnapshot(root, trustedSource.privateKey, base).dir;
}

const mutationBatchCache = new Map();
function mutateZip(src, dst, mode) {
  const modes = ["duplicate","traversal","deflate","extra","missing","symlink","timestamp","tamper","case","unsorted","provenance-tamper"];
  if (!modes.includes(mode)) throw new Error(`bad mutation mode: ${mode}`);
  let cache = mutationBatchCache.get(src);
  if (!cache) {
    // Generate every adversarial variant for this source ZIP in one Python
    // process. This preserves the exact ZIP mutations while avoiding flaky
    // repeated interpreter startup in constrained/offline CI environments.
    const key = crypto.createHash("sha256").update(src).digest("hex").slice(0, 12);
    cache = path.join(path.dirname(dst), `.mutation-batch-${key}`);
    fs.mkdirSync(cache, { recursive: true });
    const py = String.raw`
import sys, zipfile, pathlib
src,outdir=sys.argv[1:3]
outdir=pathlib.Path(outdir)
with zipfile.ZipFile(src,'r') as zin:
    infos=zin.infolist(); data={i.filename:zin.read(i.filename) for i in infos}
def add(z,name,payload=b'x',method=zipfile.ZIP_STORED,dt=(1980,1,1,0,0,0),modebits=(0o100000|0o644)):
    i=zipfile.ZipInfo(name,dt); i.create_system=3; i.external_attr=modebits<<16; i.compress_type=method
    z.writestr(i,payload)
def build(mode,dst):
    with zipfile.ZipFile(dst,'w',compression=zipfile.ZIP_STORED,allowZip64=True) as z:
        if mode=='duplicate':
            for i in infos: add(z,i.filename,data[i.filename])
            add(z,infos[0].filename,data[infos[0].filename])
        elif mode=='traversal':
            for i in infos: add(z,i.filename,data[i.filename])
            add(z,'../escape',b'x')
        elif mode=='deflate':
            for n in sorted(data): add(z,n,data[n],zipfile.ZIP_DEFLATED if n!='snapshot-manifest.json' else zipfile.ZIP_STORED)
        elif mode=='extra':
            for n in sorted(data): add(z,n,data[n])
            add(z,'npm-cache/unlisted',b'x')
        elif mode=='missing':
            victim=next(n for n in data if n.startswith('npm-cache/'))
            for n in sorted(data):
                if n!=victim: add(z,n,data[n])
        elif mode=='symlink':
            for n in sorted(data): add(z,n,data[n])
            add(z,'link',b'package-lock.json',modebits=(0o120000|0o777))
        elif mode=='timestamp':
            for n in sorted(data): add(z,n,data[n],dt=((1981,1,1,0,0,0) if n==sorted(data)[0] else (1980,1,1,0,0,0)))
        elif mode=='tamper':
            victim=next(n for n in data if n.startswith('npm-cache/'))
            for n in sorted(data): add(z,n,data[n]+(b'X' if n==victim else b''))
        elif mode=='case':
            for n in sorted(data): add(z,n,data[n])
            add(z,'SNAPSHOT-MANIFEST.JSON',data['snapshot-manifest.json'])
        elif mode=='unsorted':
            for n in sorted(data, reverse=True): add(z,n,data[n])
        elif mode=='provenance-tamper':
            for n in sorted(data,key=lambda x:(x.casefold(),x)):
                payload=data[n]
                if n=='snapshot-provenance.json': payload=payload.replace(b'"algorithm": "ed25519"',b'"algorithm": "ed25518"')
                add(z,n,payload)
        else: raise SystemExit('bad mode')
for mode in ${JSON.stringify(modes)}:
    build(mode, outdir / (mode + '.zip'))
`;
    const r = run("python3", ["-c", py, src, cache]);
    assert.equal(r.status, 0, `mutation batch helper failed: ${r.stderr}`);
    mutationBatchCache.set(src, cache);
  }
  const cached = path.join(cache, `${mode}.zip`);
  assert.ok(fs.existsSync(cached), `cached ${mode} mutation missing`);
  fs.copyFileSync(cached, dst, fs.constants.COPYFILE_EXCL);
}


const base = fs.mkdtempSync(path.join(os.tmpdir(), "yadilab-transport-"));
try {
  const snapshot = makeSnapshot(base);
  const sourceVerify = verifyOfflineDependencySnapshot(root, snapshot);
  ok(sourceVerify.ok, `fixture snapshot verifies: ${JSON.stringify(sourceVerify.diagnostics)}`);

  const zipA = path.join(base, "a.zip");
  const zipB = path.join(base, "b.zip");
  let r = run("python3", ["scripts/pack_offline_dependency_snapshot.py", snapshot, zipA]);
  eq(r.status, 0, `first canonical pack succeeds: ${r.stderr}`);
  r = run("python3", ["scripts/pack_offline_dependency_snapshot.py", snapshot, zipB]);
  eq(r.status, 0, `second canonical pack succeeds: ${r.stderr}`);
  eq(shaFile(zipA), shaFile(zipB), "identical snapshot produces byte-identical transport ZIP");
  eq(fs.readFileSync(zipA), fs.readFileSync(zipB), "transport ZIP bytes are exactly reproducible");

  const extracted = path.join(base, "extracted");
  r = run("python3", ["scripts/extract_offline_dependency_snapshot.py", zipA, extracted]);
  eq(r.status, 0, `canonical transport extracts: ${r.stderr}`);
  const extractedVerify = verifyOfflineDependencySnapshot(root, extracted);
  ok(extractedVerify.ok, `extracted snapshot independently verifies: ${JSON.stringify(extractedVerify.diagnostics)}`);
  eq(shaFile(path.join(snapshot, "snapshot-manifest.json")), shaFile(path.join(extracted, "snapshot-manifest.json")), "manifest bytes preserved exactly");

  const sealed = path.join(base, "sealed.zip");
  r = run("bash", ["scripts/seal_offline_dependency_snapshot.sh", snapshot, sealed]);
  eq(r.status, 0, `seal wrapper succeeds: ${r.stderr}`);
  ok(fs.existsSync(`${sealed}.sha256`), "seal wrapper emits SHA-256 sidecar");
  eq(fs.readFileSync(`${sealed}.sha256`, "utf8"), `${shaFile(sealed)}  ${path.basename(sealed)}\n`, "sidecar binds exact archive SHA-256 to basename only");
  eq(shaFile(sealed), shaFile(zipA), "seal wrapper uses canonical packer bytes");
  const imported = path.join(base, "imported");
  r = run("bash", ["scripts/import_offline_dependency_snapshot.sh", sealed, imported]);
  eq(r.status, 0, `sidecar + safe extraction + source binding import succeeds: ${r.stderr}`);
  ok(verifyOfflineDependencySnapshot(root, imported).ok, "import wrapper output independently verifies");

  const missingSidecar = path.join(base, "missing-sidecar.zip");
  fs.copyFileSync(sealed, missingSidecar);
  r = run("bash", ["scripts/import_offline_dependency_snapshot.sh", missingSidecar, path.join(base, "missing-sidecar-out")]);
  eq(r.status, 77, "transport import requires adjacent SHA-256 sidecar");

  const wrongHash = path.join(base, "wrong-hash.zip");
  fs.copyFileSync(sealed, wrongHash);
  fs.writeFileSync(`${wrongHash}.sha256`, `${"0".repeat(64)}  ${path.basename(wrongHash)}\n`);
  r = run("bash", ["scripts/import_offline_dependency_snapshot.sh", wrongHash, path.join(base, "wrong-hash-out")]);
  eq(r.status, 77, "transport import rejects wrong archive SHA-256 before extraction");

  const wrongName = path.join(base, "wrong-name.zip");
  fs.copyFileSync(sealed, wrongName);
  fs.writeFileSync(`${wrongName}.sha256`, `${shaFile(wrongName)}  ../other.zip\n`);
  r = run("bash", ["scripts/import_offline_dependency_snapshot.sh", wrongName, path.join(base, "wrong-name-out")]);
  eq(r.status, 77, "sidecar cannot redirect verifier to another path");

  const forged = path.join(base, "forged-provenance.zip");
  mutateZip(sealed, forged, "provenance-tamper");
  fs.writeFileSync(`${forged}.sha256`, `${shaFile(forged)}  ${path.basename(forged)}
`);
  r = run("bash", ["scripts/import_offline_dependency_snapshot.sh", forged, path.join(base, "forged-provenance-out")]);
  eq(r.status, 77, "repacked transport with a freshly recomputed SHA-256 sidecar still fails authenticity");
  ok(/SNAPSHOT_PROVENANCE_(?:CONTRACT_INVALID|SIGNATURE_MISMATCH)/.test(r.stderr), "forged provenance is rejected by provenance/signature verification rather than transport SHA alone");

  for (const mode of ["duplicate","traversal","deflate","extra","missing","symlink","timestamp","tamper","case","unsorted"]) {
    const bad = path.join(base, `${mode}.zip`);
    mutateZip(zipA, bad, mode);
    const out = path.join(base, `out-${mode}`);
    r = run("python3", ["scripts/extract_offline_dependency_snapshot.py", bad, out]);
    eq(r.status, 77, `${mode} transport is fail-closed`);
    ok(/BLOCKED dependency snapshot transport:/.test(r.stderr), `${mode} emits explicit transport diagnostic`);
  }

  const occupied = path.join(base, "occupied");
  fs.mkdirSync(occupied); fs.writeFileSync(path.join(occupied, "keep"), "x");
  r = run("python3", ["scripts/extract_offline_dependency_snapshot.py", zipA, occupied]);
  eq(r.status, 77, "extractor refuses non-empty output directory");
  eq(fs.readFileSync(path.join(occupied, "keep"), "utf8"), "x", "existing output content is not overwritten");

  const nonzip = path.join(base, "notzip.bin"); fs.writeFileSync(nonzip, "x");
  r = run("python3", ["scripts/extract_offline_dependency_snapshot.py", nonzip, path.join(base, "notzip-out")]);
  eq(r.status, 77, "non-ZIP transport rejected");

  const existing = path.join(base, "existing.zip"); fs.writeFileSync(existing, "do-not-overwrite");
  r = run("python3", ["scripts/pack_offline_dependency_snapshot.py", snapshot, existing]);
  eq(r.status, 1, "packer refuses to overwrite an existing archive");
  eq(fs.readFileSync(existing, "utf8"), "do-not-overwrite", "existing archive bytes preserved");
} finally {
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(trustedSource.base, { recursive: true, force: true });
}
console.log(`PASS offline dependency snapshot transport suite: ${checks} assertions.`);
