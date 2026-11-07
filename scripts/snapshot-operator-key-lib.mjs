import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { computeSourceCheckoutIdentity } from "./source-checkout-identity.mjs";
import { keyIdForPublicKey, publicKeySpkiBase64 } from "./offline-snapshot-provenance-lib.mjs";

export const OPERATOR_KEY_BUNDLE_FORMAT_ID = "infrastructure-cyber-lab.snapshot-operator-key-bundle";
export const OPERATOR_KEY_BUNDLE_SCHEMA_VERSION = "1.0.0";
export const OPERATOR_KEY_ROLE = "dependency-snapshot-producer";
export const OPERATOR_KEY_PRIVATE = "snapshot-producer-private.pem";
export const OPERATOR_KEY_PUBLIC = "snapshot-producer-public.pem";
export const OPERATOR_KEY_FINGERPRINT = "snapshot-producer-fingerprint.txt";
export const OPERATOR_KEY_RECORD = "snapshot-producer-ceremony.json";
const REQUIRED_FILES = [OPERATOR_KEY_FINGERPRINT, OPERATOR_KEY_PRIVATE, OPERATOR_KEY_PUBLIC, OPERATOR_KEY_RECORD].sort();

function validateLabel(label) {
  if (typeof label !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(label)) {
    throw new Error("Operator key label is missing or invalid.");
  }
}

function isOutside(sourceRoot, candidate) {
  const rel = path.relative(path.resolve(sourceRoot), path.resolve(candidate));
  return rel === ".." || rel.startsWith(`..${path.sep}`);
}

function canonicalExternalTarget(sourceRoot, requestedPath) {
  const requested = path.resolve(requestedPath);
  const parent = path.dirname(requested);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) throw new Error("Operator key bundle parent directory does not exist.");
  const realParent = fs.realpathSync(parent);
  const target = path.join(realParent, path.basename(requested));
  if (!isOutside(sourceRoot, target)) throw new Error("Operator key bundle must resolve outside the application source checkout.");
  return target;
}

function canonicalExternalExistingDirectory(sourceRoot, requestedPath) {
  const requested = path.resolve(requestedPath);
  if (!fs.existsSync(requested)) throw new Error("Operator key bundle directory does not exist.");
  const stat = fs.lstatSync(requested);
  if (stat.isSymbolicLink()) throw new Error("Operator key bundle directory may not be a symlink.");
  if (!stat.isDirectory()) throw new Error("Operator key bundle path must be a directory.");
  const real = fs.realpathSync(requested);
  if (!isOutside(sourceRoot, real)) throw new Error("Operator key bundle must resolve outside the application source checkout.");
  return real;
}

function exactMode(file, expected) {
  const mode = fs.statSync(file).mode & 0o777;
  if (mode !== expected) throw new Error(`${path.basename(file)} permissions must be 0${expected.toString(8)}, got 0${mode.toString(8)}`);
}

function ensureRegularNoSymlink(file) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`${path.basename(file)} must be a regular non-symlink file.`);
}

function canonicalRecord(value) {
  return {
    formatId: OPERATOR_KEY_BUNDLE_FORMAT_ID,
    schemaVersion: OPERATOR_KEY_BUNDLE_SCHEMA_VERSION,
    role: OPERATOR_KEY_ROLE,
    label: value.label,
    keyId: value.keyId,
    publicKeySpkiBase64: value.publicKeySpkiBase64,
    generatedFromSource: {
      schemaVersion: value.generatedFromSource.schemaVersion,
      sha256: value.generatedFromSource.sha256,
      fileCount: value.generatedFromSource.fileCount,
      totalBytes: value.generatedFromSource.totalBytes,
    },
  };
}

function recordBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalRecord(value), null, 2)}\n`, "utf8");
}

function recordShapeValid(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const top = Object.keys(value).sort();
  if (JSON.stringify(top) !== JSON.stringify(["formatId", "generatedFromSource", "keyId", "label", "publicKeySpkiBase64", "role", "schemaVersion"])) return false;
  const source = value.generatedFromSource;
  if (!source || typeof source !== "object" || Array.isArray(source)) return false;
  const sourceFields = Object.keys(source).sort();
  if (JSON.stringify(sourceFields) !== JSON.stringify(["fileCount", "schemaVersion", "sha256", "totalBytes"])) return false;
  return value.formatId === OPERATOR_KEY_BUNDLE_FORMAT_ID
    && value.schemaVersion === OPERATOR_KEY_BUNDLE_SCHEMA_VERSION
    && value.role === OPERATOR_KEY_ROLE
    && typeof value.label === "string" && /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(value.label)
    && typeof value.keyId === "string" && /^ed25519-sha256:[0-9a-f]{64}$/.test(value.keyId)
    && typeof value.publicKeySpkiBase64 === "string"
    && source.schemaVersion === "1.0.0"
    && typeof source.sha256 === "string" && /^[0-9a-f]{64}$/.test(source.sha256)
    && Number.isSafeInteger(source.fileCount) && source.fileCount > 0
    && Number.isSafeInteger(source.totalBytes) && source.totalBytes > 0;
}

export function verifySnapshotOperatorKeyBundle(sourceRoot, bundlePath, { requireCurrentSource = true } = {}) {
  const source = path.resolve(sourceRoot);
  const bundle = canonicalExternalExistingDirectory(source, bundlePath);
  const names = fs.readdirSync(bundle).sort();
  if (JSON.stringify(names) !== JSON.stringify(REQUIRED_FILES)) throw new Error(`Operator key bundle must contain exactly: ${REQUIRED_FILES.join(", ")}`);
  const files = Object.fromEntries(REQUIRED_FILES.map((name) => [name, path.join(bundle, name)]));
  for (const file of Object.values(files)) ensureRegularNoSymlink(file);
  exactMode(files[OPERATOR_KEY_PRIVATE], 0o600);
  exactMode(files[OPERATOR_KEY_PUBLIC], 0o644);
  exactMode(files[OPERATOR_KEY_FINGERPRINT], 0o644);
  exactMode(files[OPERATOR_KEY_RECORD], 0o644);

  let privateKey;
  let publicKey;
  try { privateKey = crypto.createPrivateKey(fs.readFileSync(files[OPERATOR_KEY_PRIVATE])); }
  catch (error) { throw new Error(`Operator private key invalid: ${String(error)}`); }
  try { publicKey = crypto.createPublicKey(fs.readFileSync(files[OPERATOR_KEY_PUBLIC])); }
  catch (error) { throw new Error(`Operator public key invalid: ${String(error)}`); }
  if (privateKey.asymmetricKeyType !== "ed25519" || publicKey.asymmetricKeyType !== "ed25519") throw new Error("Operator key bundle must use Ed25519.");
  const derivedPublic = crypto.createPublicKey(privateKey);
  const privateDerivedId = keyIdForPublicKey(derivedPublic);
  const publicId = keyIdForPublicKey(publicKey);
  if (privateDerivedId !== publicId || publicKeySpkiBase64(derivedPublic) !== publicKeySpkiBase64(publicKey)) throw new Error("Operator private/public key pair mismatch.");

  const fingerprintBytes = fs.readFileSync(files[OPERATOR_KEY_FINGERPRINT]);
  if (!fingerprintBytes.equals(Buffer.from(`${publicId}\n`, "utf8"))) throw new Error("Operator key fingerprint file does not exactly match the public key.");

  let record;
  let rawRecord;
  try { rawRecord = fs.readFileSync(files[OPERATOR_KEY_RECORD]); record = JSON.parse(rawRecord.toString("utf8")); }
  catch (error) { throw new Error(`Operator key ceremony record invalid JSON: ${String(error)}`); }
  if (!recordShapeValid(record)) throw new Error("Operator key ceremony record contract invalid.");
  if (!rawRecord.equals(recordBytes(record))) throw new Error("Operator key ceremony record is not canonical.");
  if (record.keyId !== publicId || record.publicKeySpkiBase64 !== publicKeySpkiBase64(publicKey)) throw new Error("Operator key ceremony record does not match the public key.");
  if (requireCurrentSource) {
    const current = computeSourceCheckoutIdentity(source);
    const expected = record.generatedFromSource;
    if (current.schemaVersion !== expected.schemaVersion || current.sha256 !== expected.sha256 || current.fileCount !== expected.fileCount || current.totalBytes !== expected.totalBytes) {
      throw new Error("Operator key ceremony record source-checkout identity does not match the current checkout.");
    }
  }
  return { ok: true, bundle, keyId: publicId, label: record.label, record };
}

export function generateSnapshotOperatorKeyBundle(sourceRoot, outputPath, label) {
  const source = path.resolve(sourceRoot);
  validateLabel(label);
  const target = canonicalExternalTarget(source, outputPath);
  if (fs.existsSync(target)) throw new Error("Operator key bundle target already exists; refusing to overwrite key material.");
  const parent = path.dirname(target);
  const temp = path.join(parent, `.${path.basename(target)}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`);
  fs.mkdirSync(temp, { mode: 0o700 });
  try {
    const pair = crypto.generateKeyPairSync("ed25519");
    const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
    const publicPem = pair.publicKey.export({ type: "spki", format: "pem" });
    const keyId = keyIdForPublicKey(pair.publicKey);
    const sourceIdentity = computeSourceCheckoutIdentity(source);
    const record = {
      formatId: OPERATOR_KEY_BUNDLE_FORMAT_ID,
      schemaVersion: OPERATOR_KEY_BUNDLE_SCHEMA_VERSION,
      role: OPERATOR_KEY_ROLE,
      label,
      keyId,
      publicKeySpkiBase64: publicKeySpkiBase64(pair.publicKey),
      generatedFromSource: sourceIdentity,
    };
    const privatePath = path.join(temp, OPERATOR_KEY_PRIVATE);
    const publicPath = path.join(temp, OPERATOR_KEY_PUBLIC);
    const fingerprintPath = path.join(temp, OPERATOR_KEY_FINGERPRINT);
    const recordPath = path.join(temp, OPERATOR_KEY_RECORD);
    fs.writeFileSync(privatePath, privatePem, { flag: "wx", mode: 0o600 });
    fs.writeFileSync(publicPath, publicPem, { flag: "wx", mode: 0o644 });
    fs.writeFileSync(fingerprintPath, `${keyId}\n`, { flag: "wx", mode: 0o644 });
    fs.writeFileSync(recordPath, recordBytes(record), { flag: "wx", mode: 0o644 });
    // writeFileSync mode is filtered through the process umask. Enforce the
    // ceremony contract explicitly so secure launchers may use umask 077
    // without turning public metadata into mode 0600.
    fs.chmodSync(privatePath, 0o600);
    fs.chmodSync(publicPath, 0o644);
    fs.chmodSync(fingerprintPath, 0o644);
    fs.chmodSync(recordPath, 0o644);
    verifySnapshotOperatorKeyBundle(source, temp, { requireCurrentSource: true });
    fs.renameSync(temp, target);
    const verified = verifySnapshotOperatorKeyBundle(source, target, { requireCurrentSource: true });
    return { ...verified, privateKeyPath: path.join(target, OPERATOR_KEY_PRIVATE), publicKeyPath: path.join(target, OPERATOR_KEY_PUBLIC), fingerprintPath: path.join(target, OPERATOR_KEY_FINGERPRINT), recordPath: path.join(target, OPERATOR_KEY_RECORD) };
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw error;
  }
}
