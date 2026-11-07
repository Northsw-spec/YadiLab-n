import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const SNAPSHOT_PROVENANCE_FORMAT_ID = "infrastructure-cyber-lab.offline-dependency-snapshot-provenance";
export const SNAPSHOT_PROVENANCE_SCHEMA_VERSION = "1.0.0";
export const SNAPSHOT_TRUST_FORMAT_ID = "infrastructure-cyber-lab.offline-snapshot-trust";
export const SNAPSHOT_TRUST_SCHEMA_VERSION = "1.2.0";
export const SNAPSHOT_TRUST_ACTIVATION_FORMAT_ID = "infrastructure-cyber-lab.offline-snapshot-trust-activation";
export const SNAPSHOT_TRUST_ACTIVATION_SCHEMA_VERSION = "1.0.0";
export const PROVENANCE_JSON = "snapshot-provenance.json";
export const PROVENANCE_SIGNATURE = "snapshot-provenance.sig";
export const TRUST_STORE_RELATIVE_PATH = "dependencies/offline-snapshot-trust.json";

const SHA256 = /^[0-9a-f]{64}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function diagnostic(code, fields = {}) {
  return { code, ...fields };
}

function normalizePublicKey(input) {
  if (input && typeof input === "object" && input.type === "public" && input.asymmetricKeyType) return input;
  if (input && typeof input === "object" && input.type === "private" && input.asymmetricKeyType) return crypto.createPublicKey(input);
  return crypto.createPublicKey(input);
}

function normalizePrivateKey(input) {
  if (input && typeof input === "object" && input.type === "private" && input.asymmetricKeyType) return input;
  return crypto.createPrivateKey(input);
}

export function keyIdForPublicKey(publicKey) {
  const key = normalizePublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Snapshot provenance public key must be Ed25519.");
  const der = key.export({ type: "spki", format: "der" });
  return `ed25519-sha256:${sha256Buffer(der)}`;
}

export function publicKeySpkiBase64(publicKey) {
  const key = normalizePublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("Snapshot provenance public key must be Ed25519.");
  return key.export({ type: "spki", format: "der" }).toString("base64");
}

function canonicalActivationProof(proof) {
  if (proof == null) return null;
  return {
    formatId: proof.formatId,
    schemaVersion: proof.schemaVersion,
    signatureBase64: proof.signatureBase64,
  };
}

export function canonicalTrustStoreValue(keys) {
  return {
    formatId: SNAPSHOT_TRUST_FORMAT_ID,
    schemaVersion: SNAPSHOT_TRUST_SCHEMA_VERSION,
    keys: [...keys]
      .map((entry) => ({
        activationProof: canonicalActivationProof(entry.activationProof),
        keyId: entry.keyId,
        label: entry.label,
        publicKeySpkiBase64: entry.publicKeySpkiBase64,
        role: "dependency-snapshot-producer",
        status: entry.status,
      }))
      .sort((a, b) => a.keyId.localeCompare(b.keyId)),
  };
}

export function canonicalTrustStoreBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalTrustStoreValue(value.keys ?? []), null, 2)}\n`, "utf8");
}

function activationProofShapeValid(proof) {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return false;
  const fields = Object.keys(proof).sort();
  if (JSON.stringify(fields) !== JSON.stringify(["formatId", "schemaVersion", "signatureBase64"])) return false;
  return proof.formatId === SNAPSHOT_TRUST_ACTIVATION_FORMAT_ID
    && proof.schemaVersion === SNAPSHOT_TRUST_ACTIVATION_SCHEMA_VERSION
    && typeof proof.signatureBase64 === "string"
    && BASE64.test(proof.signatureBase64);
}

function trustEntryShapeValid(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const fields = Object.keys(entry).sort();
  const expected = ["activationProof", "keyId", "label", "publicKeySpkiBase64", "role", "status"];
  if (JSON.stringify(fields) !== JSON.stringify(expected)) return false;
  const basic = typeof entry.keyId === "string"
    && /^ed25519-sha256:[0-9a-f]{64}$/.test(entry.keyId)
    && typeof entry.label === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(entry.label)
    && typeof entry.publicKeySpkiBase64 === "string"
    && BASE64.test(entry.publicKeySpkiBase64)
    && entry.role === "dependency-snapshot-producer"
    && (entry.status === "pending" || entry.status === "active" || entry.status === "revoked");
  if (!basic) return false;
  if (entry.status === "pending") return entry.activationProof === null;
  if (entry.status === "active") return activationProofShapeValid(entry.activationProof);
  return entry.activationProof === null || activationProofShapeValid(entry.activationProof);
}

export function trustActivationPayload(entry) {
  return {
    formatId: SNAPSHOT_TRUST_ACTIVATION_FORMAT_ID,
    schemaVersion: SNAPSHOT_TRUST_ACTIVATION_SCHEMA_VERSION,
    keyId: entry.keyId,
    label: entry.label,
    publicKeySpkiBase64: entry.publicKeySpkiBase64,
    role: "dependency-snapshot-producer",
  };
}

export function trustActivationPayloadBytes(entry) {
  return Buffer.from(`${JSON.stringify(trustActivationPayload(entry), null, 2)}\n`, "utf8");
}

function activationProofValid(entry, publicKey) {
  if (entry.activationProof === null) return entry.status !== "active";
  if (!activationProofShapeValid(entry.activationProof)) return false;
  let signature;
  try { signature = Buffer.from(entry.activationProof.signatureBase64, "base64"); }
  catch { return false; }
  if (signature.length !== 64) return false;
  try { return crypto.verify(null, trustActivationPayloadBytes(entry), publicKey, signature); }
  catch { return false; }
}

export function readSnapshotTrustStore(sourceRoot) {
  const file = path.join(path.resolve(sourceRoot), TRUST_STORE_RELATIVE_PATH);
  if (!fs.existsSync(file)) return { ok: false, diagnostics: [diagnostic("SNAPSHOT_TRUST_STORE_MISSING")] };
  let raw;
  let value;
  try { raw = fs.readFileSync(file); value = JSON.parse(raw.toString("utf8")); }
  catch (error) { return { ok: false, diagnostics: [diagnostic("SNAPSHOT_TRUST_STORE_INVALID_JSON", { message: String(error) })] }; }
  const diagnostics = [];
  const topFields = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : [];
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(topFields) !== JSON.stringify(["formatId", "keys", "schemaVersion"])
      || value.formatId !== SNAPSHOT_TRUST_FORMAT_ID
      || value.schemaVersion !== SNAPSHOT_TRUST_SCHEMA_VERSION
      || !Array.isArray(value.keys)) {
    diagnostics.push(diagnostic("SNAPSHOT_TRUST_STORE_CONTRACT_INVALID"));
    return { ok: false, diagnostics, value };
  }
  const keys = new Map();
  const pendingKeys = new Map();
  const revokedKeys = new Map();
  const allKeys = new Map();
  for (const entry of value.keys) {
    if (!trustEntryShapeValid(entry)) {
      diagnostics.push(diagnostic("SNAPSHOT_TRUST_KEY_ENTRY_INVALID", { entry }));
      continue;
    }
    let publicKey;
    try {
      publicKey = crypto.createPublicKey({ key: Buffer.from(entry.publicKeySpkiBase64, "base64"), type: "spki", format: "der" });
      if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("not ed25519");
    } catch (error) {
      diagnostics.push(diagnostic("SNAPSHOT_TRUST_PUBLIC_KEY_INVALID", { keyId: entry.keyId, message: String(error) }));
      continue;
    }
    const derivedId = keyIdForPublicKey(publicKey);
    if (entry.keyId !== derivedId) {
      diagnostics.push(diagnostic("SNAPSHOT_TRUST_KEY_ID_MISMATCH", { declared: entry.keyId, derived: derivedId }));
      continue;
    }
    if (allKeys.has(entry.keyId)) {
      diagnostics.push(diagnostic("SNAPSHOT_TRUST_DUPLICATE_KEY_ID", { keyId: entry.keyId }));
      continue;
    }
    if (!activationProofValid(entry, publicKey)) {
      diagnostics.push(diagnostic("SNAPSHOT_TRUST_ACTIVATION_PROOF_MISMATCH", { keyId: entry.keyId, status: entry.status }));
      continue;
    }
    allKeys.set(entry.keyId, publicKey);
    if (entry.status === "pending") pendingKeys.set(entry.keyId, publicKey);
    else if (entry.status === "active") keys.set(entry.keyId, publicKey);
    else revokedKeys.set(entry.keyId, publicKey);
  }
  if (diagnostics.length === 0 && !raw.equals(canonicalTrustStoreBytes(value))) {
    diagnostics.push(diagnostic("SNAPSHOT_TRUST_STORE_NON_CANONICAL"));
  }
  return { ok: diagnostics.length === 0, diagnostics, value, keys, pendingKeys, revokedKeys, allKeys };
}

function writeTrustStoreAtomic(sourceRoot, value) {
  const source = path.resolve(sourceRoot);
  const file = path.join(source, TRUST_STORE_RELATIVE_PATH);
  const tmp = `${file}.tmp-${process.pid}`;
  const bytes = canonicalTrustStoreBytes(value);
  try {
    fs.writeFileSync(tmp, bytes, { flag: "wx", mode: 0o644 });
    fs.renameSync(tmp, file);
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
}

export function onboardSnapshotTrustKey(sourceRoot, publicKeyInput, expectedKeyId, label) {
  const source = path.resolve(sourceRoot);
  const inputBytes = Buffer.isBuffer(publicKeyInput) ? publicKeyInput : Buffer.from(publicKeyInput);
  if (/PRIVATE KEY/.test(inputBytes.toString("utf8"))) throw new Error("Trust onboarding accepts a public key only, never private key material.");
  if (!/^ed25519-sha256:[0-9a-f]{64}$/.test(expectedKeyId ?? "")) throw new Error("Expected trust key ID must be an explicit ed25519-sha256 fingerprint.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(label ?? "")) throw new Error("Trust key label is missing or invalid.");
  let publicKey;
  try { publicKey = crypto.createPublicKey(inputBytes); }
  catch (error) { throw new Error(`Trust onboarding public key invalid: ${String(error)}`); }
  if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Trust onboarding public key must be Ed25519.");
  const derived = keyIdForPublicKey(publicKey);
  if (derived !== expectedKeyId) throw new Error(`Trust key fingerprint mismatch: expected ${expectedKeyId}, derived ${derived}`);
  const trust = readSnapshotTrustStore(source);
  if (!trust.ok) throw new Error(`Snapshot trust store invalid before onboarding: ${JSON.stringify(trust.diagnostics)}`);
  const existing = trust.value.keys.find((entry) => entry.keyId === derived);
  if (existing) {
    if (existing.status === "revoked") throw new Error(`Revoked trust key cannot be reactivated: ${derived}`);
    if (existing.publicKeySpkiBase64 !== publicKeySpkiBase64(publicKey) || existing.label !== label) throw new Error(`Existing trust key metadata mismatch: ${derived}`);
    return { changed: false, keyId: derived, status: existing.status };
  }
  const entry = {
    activationProof: null,
    keyId: derived,
    label,
    publicKeySpkiBase64: publicKeySpkiBase64(publicKey),
    role: "dependency-snapshot-producer",
    status: "pending",
  };
  writeTrustStoreAtomic(source, canonicalTrustStoreValue([...trust.value.keys, entry]));
  const after = readSnapshotTrustStore(source);
  if (!after.ok || !after.pendingKeys.has(derived) || after.keys.has(derived)) throw new Error(`Trust store failed post-onboarding verification: ${JSON.stringify(after.diagnostics)}`);
  return { changed: true, keyId: derived, status: "pending" };
}

export function activateSnapshotTrustKey(sourceRoot, keyId, privateKeyInput) {
  const source = path.resolve(sourceRoot);
  if (!/^ed25519-sha256:[0-9a-f]{64}$/.test(keyId ?? "")) throw new Error("Activation key ID must be an explicit ed25519-sha256 fingerprint.");
  const trust = readSnapshotTrustStore(source);
  if (!trust.ok) throw new Error(`Snapshot trust store invalid before activation: ${JSON.stringify(trust.diagnostics)}`);
  const existing = trust.value.keys.find((entry) => entry.keyId === keyId);
  if (!existing) throw new Error(`Trust key not found for activation: ${keyId}`);
  if (existing.status === "revoked") throw new Error(`Revoked trust key cannot be activated: ${keyId}`);
  let privateKey;
  try { privateKey = normalizePrivateKey(privateKeyInput); }
  catch (error) { throw new Error(`Trust activation private key invalid: ${String(error)}`); }
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Trust activation private key must be Ed25519.");
  const publicKey = crypto.createPublicKey(privateKey);
  const derived = keyIdForPublicKey(publicKey);
  if (derived !== keyId || publicKeySpkiBase64(publicKey) !== existing.publicKeySpkiBase64) throw new Error(`Trust activation private key does not match staged public key: ${keyId}`);
  if (existing.status === "active") return { changed: false, keyId, status: "active" };
  const signature = crypto.sign(null, trustActivationPayloadBytes(existing), privateKey);
  const activationProof = {
    formatId: SNAPSHOT_TRUST_ACTIVATION_FORMAT_ID,
    schemaVersion: SNAPSHOT_TRUST_ACTIVATION_SCHEMA_VERSION,
    signatureBase64: signature.toString("base64"),
  };
  const entries = trust.value.keys.map((entry) => entry.keyId === keyId ? { ...entry, activationProof, status: "active" } : entry);
  writeTrustStoreAtomic(source, canonicalTrustStoreValue(entries));
  const after = readSnapshotTrustStore(source);
  if (!after.ok || !after.keys.has(keyId) || after.pendingKeys.has(keyId)) throw new Error(`Trust store failed post-activation verification: ${JSON.stringify(after.diagnostics)}`);
  return { changed: true, keyId, status: "active" };
}

export function revokeSnapshotTrustKey(sourceRoot, keyId) {
  const source = path.resolve(sourceRoot);
  if (!/^ed25519-sha256:[0-9a-f]{64}$/.test(keyId ?? "")) throw new Error("Revocation key ID must be an explicit ed25519-sha256 fingerprint.");
  const trust = readSnapshotTrustStore(source);
  if (!trust.ok) throw new Error(`Snapshot trust store invalid before revocation: ${JSON.stringify(trust.diagnostics)}`);
  let found = false;
  let changed = false;
  const entries = trust.value.keys.map((entry) => {
    if (entry.keyId !== keyId) return entry;
    found = true;
    if (entry.status === "revoked") return entry;
    changed = true;
    return { ...entry, status: "revoked" };
  });
  if (!found) throw new Error(`Trust key not found for revocation: ${keyId}`);
  if (changed) writeTrustStoreAtomic(source, canonicalTrustStoreValue(entries));
  const after = readSnapshotTrustStore(source);
  if (!after.ok || !after.revokedKeys.has(keyId) || after.keys.has(keyId) || after.pendingKeys.has(keyId)) throw new Error(`Trust store failed post-revocation verification: ${JSON.stringify(after.diagnostics)}`);
  return { changed, keyId };
}

export function buildSnapshotProvenance(manifestBytes, manifest, signingPublicKey) {
  const key = normalizePublicKey(signingPublicKey);
  const keyId = keyIdForPublicKey(key);
  const sourceSha = manifest?.sourceContract?.sourceCheckout?.sha256;
  if (!SHA256.test(sourceSha ?? "")) throw new Error("Snapshot manifest source checkout identity is missing/invalid.");
  return {
    formatId: SNAPSHOT_PROVENANCE_FORMAT_ID,
    schemaVersion: SNAPSHOT_PROVENANCE_SCHEMA_VERSION,
    algorithm: "ed25519",
    keyId,
    snapshotManifestSha256: sha256Buffer(manifestBytes),
    sourceCheckoutSha256: sourceSha,
    target: {
      platform: manifest?.target?.platform,
      arch: manifest?.target?.arch,
    },
    preparedWith: {
      node: manifest?.preparedWith?.node,
      npm: manifest?.preparedWith?.npm,
    },
  };
}

export function provenanceBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function signSnapshotProvenance(sourceRoot, snapshotRoot, privateKeyInput) {
  const source = path.resolve(sourceRoot);
  const snapshot = path.resolve(snapshotRoot);
  const manifestPath = path.join(snapshot, "snapshot-manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("snapshot-manifest.json missing before provenance signing.");
  const trust = readSnapshotTrustStore(source);
  if (!trust.ok) throw new Error(`Snapshot trust store invalid: ${JSON.stringify(trust.diagnostics)}`);
  let privateKey;
  try { privateKey = normalizePrivateKey(privateKeyInput); }
  catch (error) { throw new Error(`Snapshot provenance private key invalid: ${String(error)}`); }
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Snapshot provenance private key must be Ed25519.");
  const publicKey = crypto.createPublicKey(privateKey);
  const keyId = keyIdForPublicKey(publicKey);
  if (trust.revokedKeys?.has(keyId)) throw new Error(`Snapshot signing key is revoked by ${TRUST_STORE_RELATIVE_PATH}: ${keyId}`);
  if (!trust.keys.has(keyId)) throw new Error(`Snapshot signing key is not trusted by ${TRUST_STORE_RELATIVE_PATH}: ${keyId}`);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const provenance = buildSnapshotProvenance(manifestBytes, manifest, publicKey);
  const bytes = provenanceBytes(provenance);
  const signature = crypto.sign(null, bytes, privateKey);
  fs.writeFileSync(path.join(snapshot, PROVENANCE_JSON), bytes, { flag: "wx" });
  fs.writeFileSync(path.join(snapshot, PROVENANCE_SIGNATURE), `${signature.toString("base64")}\n`, { flag: "wx" });
  return provenance;
}

export function verifySnapshotProvenance(sourceRoot, snapshotRoot, manifest = null) {
  const source = path.resolve(sourceRoot);
  const snapshot = path.resolve(snapshotRoot);
  const diagnostics = [];
  const manifestPath = path.join(snapshot, "snapshot-manifest.json");
  const provenancePath = path.join(snapshot, PROVENANCE_JSON);
  const signaturePath = path.join(snapshot, PROVENANCE_SIGNATURE);
  if (!fs.existsSync(provenancePath)) diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_MISSING"));
  if (!fs.existsSync(signaturePath)) diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_SIGNATURE_MISSING"));
  if (!fs.existsSync(manifestPath)) diagnostics.push(diagnostic("SNAPSHOT_MANIFEST_MISSING"));
  if (diagnostics.length) return { ok: false, diagnostics };

  const trust = readSnapshotTrustStore(source);
  if (!trust.ok) diagnostics.push(...trust.diagnostics);

  let manifestBytes;
  let parsedManifest = manifest;
  try {
    manifestBytes = fs.readFileSync(manifestPath);
    if (!parsedManifest) parsedManifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_MANIFEST_READ_FAILED", { message: String(error) }));
  }

  let provenance;
  let rawProvenance;
  try {
    rawProvenance = fs.readFileSync(provenancePath);
    provenance = JSON.parse(rawProvenance.toString("utf8"));
  } catch (error) {
    diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_INVALID_JSON", { message: String(error) }));
  }

  let signature = null;
  try {
    const raw = fs.readFileSync(signaturePath, "utf8");
    if (!/^[A-Za-z0-9+/]+={0,2}\n?$/.test(raw)) throw new Error("signature is not canonical base64");
    signature = Buffer.from(raw.trim(), "base64");
    if (signature.length !== 64) throw new Error(`unexpected Ed25519 signature length ${signature.length}`);
  } catch (error) {
    diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_SIGNATURE_INVALID_ENCODING", { message: String(error) }));
  }

  if (provenance) {
    if (provenance.formatId !== SNAPSHOT_PROVENANCE_FORMAT_ID || provenance.schemaVersion !== SNAPSHOT_PROVENANCE_SCHEMA_VERSION || provenance.algorithm !== "ed25519" || typeof provenance.keyId !== "string" || !SHA256.test(provenance.snapshotManifestSha256 ?? "") || !SHA256.test(provenance.sourceCheckoutSha256 ?? "")) {
      diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_CONTRACT_INVALID"));
    }
    if (manifestBytes && provenance.snapshotManifestSha256 !== sha256Buffer(manifestBytes)) {
      diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_MANIFEST_HASH_MISMATCH"));
    }
    if (parsedManifest) {
      if (provenance.sourceCheckoutSha256 !== parsedManifest?.sourceContract?.sourceCheckout?.sha256) diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_SOURCE_IDENTITY_MISMATCH"));
      if (provenance?.target?.platform !== parsedManifest?.target?.platform || provenance?.target?.arch !== parsedManifest?.target?.arch) diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_TARGET_MISMATCH"));
      if (provenance?.preparedWith?.node !== parsedManifest?.preparedWith?.node || provenance?.preparedWith?.npm !== parsedManifest?.preparedWith?.npm) diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_PREPARED_WITH_MISMATCH"));
    }
    const publicKey = trust.keys?.get(provenance.keyId);
    if (!publicKey) {
      if (trust.revokedKeys?.has(provenance.keyId)) diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_REVOKED_KEY", { keyId: provenance.keyId }));
      else diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_UNTRUSTED_KEY", { keyId: provenance.keyId }));
    } else if (signature && rawProvenance) {
      let valid = false;
      try { valid = crypto.verify(null, rawProvenance, publicKey, signature); }
      catch (error) { diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_SIGNATURE_VERIFY_FAILED", { message: String(error) })); }
      if (!valid) diagnostics.push(diagnostic("SNAPSHOT_PROVENANCE_SIGNATURE_MISMATCH"));
    }
  }

  return { ok: diagnostics.length === 0, diagnostics, provenance, trustStore: trust.value };
}
