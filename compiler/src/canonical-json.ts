import type { HashProvider } from "./types.js";

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value !== null && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const item = input[key];
      // A JSON own "__proto__" is source data. Assignment into {} would
      // trigger Object.prototype's setter and omit it from canonical hashes.
      if (item !== undefined) Object.defineProperty(output, key, {
        value: normalizeJson(item), enumerable: true, writable: true, configurable: true,
      });
    }
    return output;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export const webCryptoHashProvider: HashProvider = {
  async sha256Utf8(input: string): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error("Web Crypto SHA-256 is unavailable in this runtime");
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  },
};
