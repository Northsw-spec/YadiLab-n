import type { OspfLsaHeader } from "./ospf-lsdb-summary.js";
import { validOspfLsaHeader } from "./ospf-lsdb-summary.js";

/**
 * RFC 2328 §12.1.7, App. A.4: validate bounded raw LSA bytes and the
 * Fletcher-16 checksum over ALL bytes except the first two (LS age).
 * Verifies byte integrity and generic header, NOT Type 1/2 link semantics,
 * cryptographic origin, OSPF packet authentication or LSDB installation.
 */
export const OSPF_LSA_BINARY_FORMAT = "yadilab.engine.ospfv2-lsa-binary" as const;
export const OSPF_LSA_BINARY_VERSION = "1.0.0" as const;
export const OSPF_LSA_MAX_BYTES = 4096 as const;

export type OspfLsaBinaryResult =
  | { readonly ok: true; readonly header: OspfLsaHeader; readonly bytes: readonly number[] }
  | { readonly ok: false; readonly code: string };

function word(b: readonly number[], i: number): number {
  return b[i]! * 256 + b[i + 1]!;
}
function ip(b: readonly number[], i: number): string {
  return [b[i], b[i + 1], b[i + 2], b[i + 3]].join(".");
}
function signedSequence(b: readonly number[]): number {
  const u = (b[12]! * 16777216) + (b[13]! * 65536) + word(b, 14);
  return u >= 2147483648 ? u - 4294967296 : u;
}
function checksumCorrect(b: readonly number[]): boolean {
  let c0 = 0;
  let c1 = 0;
  for (let i = 2; i < b.length; i += 1) {
    c0 = (c0 + b[i]!) % 255;
    c1 = (c1 + c0) % 255;
  }
  return c0 === 0 && c1 === 0;
}

/** Deliberately no auto-repair, normalization or generated checksums. */
export function verifyOspfLsaBinary(input: readonly number[]): OspfLsaBinaryResult {
  if (!Array.isArray(input) || input.length < 24 || input.length > OSPF_LSA_MAX_BYTES
    || !input.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    return { ok: false, code: "OSPF_LSA_BYTES_INVALID" };
  }
  const b = [...input];
  if (word(b, 18) !== b.length) return { ok: false, code: "OSPF_LSA_LENGTH_MISMATCH" };
  if (b[3] === 2 && (b.length < 28 || (b.length - 24) % 4 !== 0)) {
    return { ok: false, code: "OSPF_LSA_NETWORK_BODY_INVALID" };
  }
  const h = {
    lsAge: word(b, 0), options: b[2]!, lsaType: b[3]!,
    linkStateId: ip(b, 4), advertisingRouter: ip(b, 8),
    lsSequenceNumber: signedSequence(b), lsChecksum: word(b, 16),
    length: word(b, 18),
  };
  if (!validOspfLsaHeader(h)) return { ok: false, code: "OSPF_LSA_HEADER_INVALID" };
  if (!checksumCorrect(b)) return { ok: false, code: "OSPF_LSA_FLETCHER_INVALID" };
  return { ok: true, header: h, bytes: b };
}
