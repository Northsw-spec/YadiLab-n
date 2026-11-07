/**
 * YadiLab — original project source.
 * Copyright © 2026 Daniel Ölund. All rights reserved.
 * Original author and copyright holder: Daniel Ölund.
 * No license is granted for commercial use, redistribution, or creation of
 * derivative works without prior written permission.
 * Third-party components retain their separate licenses; see THIRD_PARTY_NOTICES.md.
 */

export interface ParsedIpAddress {
  readonly family: 4 | 6;
  readonly bits: 32 | 128;
  readonly value: bigint;
}

function parseIpv4(text: string): ParsedIpAddress | undefined {
  const parts = text.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0n;
  for (const part of parts) {
    // Accept canonical, unambiguous decimal octets (not octal-like text).
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) return undefined;
    const n = Number(part);
    if (n > 255) return undefined;
    value = (value << 8n) | BigInt(n);
  }
  return { family: 4, bits: 32, value };
}

function ipv4TailToHextets(text: string): readonly [number, number] | undefined {
  const parsed = parseIpv4(text);
  if (!parsed) return undefined;
  const value = Number(parsed.value);
  return [(value >>> 16) & 0xffff, value & 0xffff];
}

function parseIpv6(text: string): ParsedIpAddress | undefined {
  if (text.includes("%")) return undefined;
  let source = text.toLowerCase();
  let ipv4Tail: readonly [number, number] | undefined;
  if (source.includes(".")) {
    const idx = source.lastIndexOf(":");
    if (idx < 0) return undefined;
    ipv4Tail = ipv4TailToHextets(source.slice(idx + 1));
    if (!ipv4Tail) return undefined;
    source = `${source.slice(0, idx)}:${ipv4Tail[0].toString(16)}:${ipv4Tail[1].toString(16)}`;
  }
  if ((source.match(/::/g) ?? []).length > 1) return undefined;
  const [leftRaw, rightRaw] = source.split("::");
  // Preserve unexpected empty hextets, rather than normalizing a malformed
  // ":" or ":::" sequence into an apparently valid IPv6 address.
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw !== undefined && rightRaw.length > 0 ? rightRaw.split(":") : [];
  const valid = (part: string) => /^[0-9a-f]{1,4}$/.test(part);
  if (!left.every(valid) || !right.every(valid)) return undefined;
  let parts: string[];
  if (rightRaw !== undefined) {
    const missing = 8 - left.length - right.length;
    if (missing < 1) return undefined;
    parts = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    if (left.length !== 8) return undefined;
    parts = left;
  }
  if (parts.length !== 8) return undefined;
  let value = 0n;
  for (const part of parts) value = (value << 16n) | BigInt(parseInt(part, 16));
  return { family: 6, bits: 128, value };
}

export function parseIpAddress(text: string): ParsedIpAddress | undefined {
  const slash = text.indexOf("/");
  const host = slash === -1 ? text : text.slice(0, slash);
  const address = host.includes(":") ? parseIpv6(host) : parseIpv4(host);
  if (!address) return undefined;
  if (slash !== -1) {
    // Interface notation is accepted only when its full mask is valid.
    // Discarding an arbitrary suffix must never turn malformed source into
    // known route or ACL truth.
    const prefixText = text.slice(slash + 1);
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(prefixText)) return undefined;
    if (Number(prefixText) > address.bits) return undefined;
  }
  return address;
}

export interface ParsedCidr {
  readonly address: ParsedIpAddress;
  readonly prefix: number;
  readonly network: bigint;
}

export function parseCidr(text: string): ParsedCidr | undefined {
  const slash = text.indexOf("/");
  const addressText = slash >= 0 ? text.slice(0, slash) : text;
  const address = parseIpAddress(addressText);
  if (!address) return undefined;
  // Number("") === 0: a missing mask must NEVER silently become /0.
  const prefixText = slash >= 0 ? text.slice(slash + 1) : undefined;
  if (prefixText !== undefined && !/^(?:0|[1-9][0-9]{0,2})$/.test(prefixText)) return undefined;
  const prefix = prefixText !== undefined ? Number(prefixText) : address.bits;
  if (!Number.isInteger(prefix) || prefix > address.bits) return undefined;
  const shift = BigInt(address.bits - prefix);
  const network = shift === 0n ? address.value : (address.value >> shift) << shift;
  return { address, prefix, network };
}

export function addressInCidr(addressText: string, cidrText: string): boolean | undefined {
  const address = parseIpAddress(addressText);
  const cidr = parseCidr(cidrText);
  if (!address || !cidr || address.family !== cidr.address.family) return undefined;
  const shift = BigInt(address.bits - cidr.prefix);
  const network = shift === 0n ? address.value : (address.value >> shift) << shift;
  return network === cidr.network;
}
