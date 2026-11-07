import { canonicalEnterpriseJson } from "../../enterprise-model/src/canonical.js";
import type { EnterpriseImportHashProvider } from "./types.js";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const webCryptoImportHashProvider: EnterpriseImportHashProvider = {
  async sha256Bytes(input: Uint8Array): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable in this runtime");
    return bytesToHex(new Uint8Array(await subtle.digest("SHA-256", Uint8Array.from(input))));
  },
  async sha256Utf8(input: string): Promise<string> {
    return this.sha256Bytes(new TextEncoder().encode(input));
  },
};

export async function computeMappingProfileHash(profile: unknown, hashProvider: EnterpriseImportHashProvider = webCryptoImportHashProvider): Promise<string> {
  return hashProvider.sha256Utf8(canonicalEnterpriseJson(profile));
}

export async function computeRawValueHash(value: unknown, hashProvider: EnterpriseImportHashProvider = webCryptoImportHashProvider): Promise<string> {
  return hashProvider.sha256Utf8(canonicalEnterpriseJson(value));
}
