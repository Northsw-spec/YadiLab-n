import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { listSourceCheckoutFiles } from "../../scripts/source-checkout-identity.mjs";
import {
  activateSnapshotTrustKey,
  canonicalTrustStoreBytes,
  keyIdForPublicKey,
  onboardSnapshotTrustKey,
  readSnapshotTrustStore,
  revokeSnapshotTrustKey,
} from "../../scripts/offline-snapshot-provenance-lib.mjs";
import { createSignedTestSnapshot } from "./snapshot-signing-test-helper.mjs";
import { verifyOfflineDependencySnapshot } from "../../scripts/offline-dependency-snapshot-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let checks = 0; const ok=(v,m)=>{assert.ok(v,m);checks++;}; const eq=(a,b,m)=>{assert.equal(a,b,m);checks++;};
function copySource() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "trust-rotation-")); const source = path.join(base, "source"); fs.mkdirSync(source,{recursive:true});
  for (const item of listSourceCheckoutFiles(root)) { const src=path.join(root,...item.path.split("/")); const dst=path.join(source,...item.path.split("/")); fs.mkdirSync(path.dirname(dst),{recursive:true}); fs.copyFileSync(src,dst); fs.chmodSync(dst,item.mode); }
  fs.writeFileSync(path.join(source,"dependencies/offline-snapshot-trust.json"), canonicalTrustStoreBytes({keys:[]}));
  return {base,source};
}
function stageActivate(source, pair, label) { const id=keyIdForPublicKey(pair.publicKey); onboardSnapshotTrustKey(source,pair.publicKey.export({type:"spki",format:"pem"}),id,label); activateSnapshotTrustKey(source,id,pair.privateKey); return id; }
const tmp=copySource();
try {
  const oldPair=crypto.generateKeyPairSync("ed25519"); const newPair=crypto.generateKeyPairSync("ed25519");
  const oldId=stageActivate(tmp.source,oldPair,"producer-old");
  const newId=keyIdForPublicKey(newPair.publicKey);
  onboardSnapshotTrustKey(tmp.source,newPair.publicKey.export({type:"spki",format:"pem"}),newId,"producer-new");
  let trust=readSnapshotTrustStore(tmp.source);
  ok(trust.keys.has(oldId),"old producer stays active during rotation staging");
  ok(trust.pendingKeys.has(newId),"new producer is pending before proof of possession");
  activateSnapshotTrustKey(tmp.source,newId,newPair.privateKey);
  trust=readSnapshotTrustStore(tmp.source);
  eq(trust.keys.size,2,"overlap checkpoint permits two proven active producer keys");

  const oldSnap=createSignedTestSnapshot(tmp.source,oldPair.privateKey);
  const newSnapOverlap=createSignedTestSnapshot(tmp.source,newPair.privateKey);
  try {
    ok(verifyOfflineDependencySnapshot(tmp.source,oldSnap.dir).ok,"old-key snapshot verifies in overlap checkpoint");
    ok(verifyOfflineDependencySnapshot(tmp.source,newSnapOverlap.dir).ok,"new-key snapshot verifies in overlap checkpoint");

    revokeSnapshotTrustKey(tmp.source,oldId);
    trust=readSnapshotTrustStore(tmp.source);
    ok(trust.revokedKeys.has(oldId) && trust.keys.has(newId),"rotation checkpoint revokes old key while new key stays active");

    const oldAfter=verifyOfflineDependencySnapshot(tmp.source,oldSnap.dir);
    ok(!oldAfter.ok && oldAfter.diagnostics.some((d)=>d.code==="SNAPSHOT_PROVENANCE_REVOKED_KEY"),"old-key snapshot is explicitly blocked as revoked after rotation");
    ok(oldAfter.diagnostics.some((d)=>d.code==="SNAPSHOT_SOURCE_CHECKOUT_MISMATCH"),"trust-store mutation also changes source identity, invalidating pre-rotation snapshot checkout binding");
    const overlapNewAfter=verifyOfflineDependencySnapshot(tmp.source,newSnapOverlap.dir);
    ok(!overlapNewAfter.ok && overlapNewAfter.diagnostics.some((d)=>d.code==="SNAPSHOT_SOURCE_CHECKOUT_MISMATCH"),"even new-key snapshot from prior trust checkpoint is source-bound and must be regenerated");

    const newSnapFinal=createSignedTestSnapshot(tmp.source,newPair.privateKey);
    try { ok(verifyOfflineDependencySnapshot(tmp.source,newSnapFinal.dir).ok,"fresh new-key snapshot verifies after revocation checkpoint"); }
    finally { fs.rmSync(newSnapFinal.owner,{recursive:true,force:true}); }
  } finally { fs.rmSync(oldSnap.owner,{recursive:true,force:true}); fs.rmSync(newSnapOverlap.owner,{recursive:true,force:true}); }
} finally { fs.rmSync(tmp.base,{recursive:true,force:true}); }
console.log(`PASS snapshot trust rotation suite: ${checks} assertions.`);
