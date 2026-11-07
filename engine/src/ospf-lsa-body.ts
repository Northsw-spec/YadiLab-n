import type { OspfLsaHeader } from "./ospf-lsdb-summary.js";
import { verifyOspfLsaBinary } from "./ospf-lsa-binary.js";

/**
 * RFC 2328 Appendix A.4.2 and A.4.3 — structurally read complete, Fletcher
 * verified Router-LSA and Network-LSA bodies. This is NOT an LSDB, validated
 * physical topology, a link-adjacency assertion, SPF or routing installation.
 */
export const OSPF_LSA_BODY_FORMAT = "yadilab.engine.ospfv2-lsa-body-structure" as const;
export const OSPF_LSA_BODY_VERSION = "1.0.0" as const;
export const OSPF_LSA_BODY_MAX_ROUTER_LINKS = 128 as const;
export const OSPF_LSA_BODY_MAX_TOS_PER_LINK = 16 as const;
export const OSPF_LSA_BODY_MAX_ATTACHED_ROUTERS = 128 as const;

export type OspfRouterLinkKind = 1 | 2 | 3 | 4;
export interface OspfRouterTosMetric {
  readonly tos: number;
  readonly metric: number;
}
export interface OspfRouterLinkBody {
  readonly type: OspfRouterLinkKind;
  /** Raw IPv4-encoded Link ID; interpretation depends on link type. */
  readonly linkId: string;
  /**
   * 32-bit Link Data in dotted-octet notation. For unnumbered Type 1
   * links this may be an ifIndex, NOT an IPv4 interface address.
   */
  readonly linkData: string;
  readonly metric: number;
  readonly tosMetrics: readonly OspfRouterTosMetric[];
}
export interface OspfRouterLsaBody {
  readonly kind: "ROUTER_LSA_BODY";
  readonly header: OspfLsaHeader & { readonly lsaType: 1 };
  readonly bytes: readonly number[];
  readonly virtualLinkEndpoint: boolean;
  readonly asBoundaryRouter: boolean;
  readonly areaBorderRouter: boolean;
  readonly links: readonly OspfRouterLinkBody[];
}
export interface OspfNetworkLsaBody {
  readonly kind: "NETWORK_LSA_BODY";
  readonly header: OspfLsaHeader & { readonly lsaType: 2 };
  readonly bytes: readonly number[];
  readonly networkMask: string;
  readonly maskPrefixLength: number;
  /** Listed Router IDs do not independently prove live adjacency. */
  readonly attachedRouterIds: readonly string[];
}
export type OspfParsedLsaBody = OspfRouterLsaBody | OspfNetworkLsaBody;
export type OspfLsaBodyResult =
  | { readonly ok: true; readonly lsa: OspfParsedLsaBody }
  | { readonly ok: false; readonly code: string };

const reject = (code: string): OspfLsaBodyResult => ({ ok: false, code });
const word = (b: readonly number[], i: number): number => b[i]! * 256 + b[i + 1]!;
const address = (b: readonly number[], i: number): string =>
  [b[i], b[i + 1], b[i + 2], b[i + 3]].join(".");

function maskPrefix(b: readonly number[], i: number): number | null {
  let prefix = 0;
  let zeroSeen = false;
  for (let j = 0; j < 4; j += 1) {
    const octet = b[i + j]!;
    for (let bit = 7; bit >= 0; bit -= 1) {
      if ((octet & (1 << bit)) !== 0) {
        if (zeroSeen) return null;
        prefix += 1;
      } else {
        zeroSeen = true;
      }
    }
  }
  return prefix;
}
function nonzero(ip: string): boolean { return ip !== "0.0.0.0"; }

/** Input is raw untrusted bytes; Fletcher and header checks run first. */
export function parseOspfLsaBody(input: readonly number[]): OspfLsaBodyResult {
  const verified = verifyOspfLsaBinary(input);
  if (!verified.ok) return reject(verified.code);
  const { bytes: b, header } = verified;
  if (header.lsaType === 1) {
    // Router-LSA: 20-byte common LSA header + 4-byte flags/link count.
    if ((b[20]! & 0xf8) !== 0 || b[21] !== 0)
      return reject("OSPF_ROUTER_LSA_FLAGS_RESERVED");
    const count = word(b, 22);
    if (count > OSPF_LSA_BODY_MAX_ROUTER_LINKS)
      return reject("OSPF_ROUTER_LSA_LINK_LIMIT");
    const links: OspfRouterLinkBody[] = [];
    let offset = 24;
    for (let j = 0; j < count; j += 1) {
      if (offset + 12 > b.length)
        return reject("OSPF_ROUTER_LSA_LINK_TRUNCATED");
      const type = b[offset + 8]!;
      const tosCount = b[offset + 9]!;
      const metric = word(b, offset + 10);
      if (type !== 1 && type !== 2 && type !== 3 && type !== 4)
        return reject("OSPF_ROUTER_LSA_LINK_TYPE_INVALID");
      if (tosCount > OSPF_LSA_BODY_MAX_TOS_PER_LINK)
        return reject("OSPF_ROUTER_LSA_TOS_LIMIT");
      const end = offset + 12 + tosCount * 4;
      if (end > b.length) return reject("OSPF_ROUTER_LSA_TOS_TRUNCATED");
      const linkId = address(b, offset);
      const linkData = address(b, offset + 4);
      if (type !== 3 && !nonzero(linkId))
        return reject("OSPF_ROUTER_LSA_LINK_ID_INVALID");
      if (type === 3 && maskPrefix(b, offset + 4) === null)
        return reject("OSPF_ROUTER_LSA_STUB_MASK_INVALID");
      const tosMetrics: OspfRouterTosMetric[] = [];
      const knownTos = new Set<number>();
      for (let t = 0; t < tosCount; t += 1) {
        const position = offset + 12 + t * 4;
        const tos = b[position]!;
        // TOS 0 is already represented by the required base metric.
        if (tos === 0 || b[position + 1] !== 0 || knownTos.has(tos))
          return reject("OSPF_ROUTER_LSA_TOS_INVALID");
        knownTos.add(tos);
        tosMetrics.push({ tos, metric: word(b, position + 2) });
      }
      links.push({
        type, linkId, linkData, metric, tosMetrics,
      });
      offset = end;
    }
    // Reject surplus bytes, fake link counts and implicit padding.
    if (offset !== b.length) return reject("OSPF_ROUTER_LSA_LENGTH_INVALID");
    return {
      ok: true,
      lsa: {
        kind: "ROUTER_LSA_BODY",
        header: { ...header, lsaType: 1 },
        bytes: b,
        virtualLinkEndpoint: (b[20]! & 0x04) !== 0,
        asBoundaryRouter: (b[20]! & 0x02) !== 0,
        areaBorderRouter: (b[20]! & 0x01) !== 0,
        links,
      },
    };
  }

  // Network-LSA: 20-byte generic header, 4-byte netmask, 4*N Router IDs.
  const prefix = maskPrefix(b, 20);
  if (prefix === null) return reject("OSPF_NETWORK_LSA_MASK_INVALID");
  const attachedCount = (b.length - 24) / 4;
  if (attachedCount === 0 || attachedCount > OSPF_LSA_BODY_MAX_ATTACHED_ROUTERS)
    return reject("OSPF_NETWORK_LSA_ATTACHED_LIMIT");
  const routers: string[] = [];
  const seen = new Set<string>();
  for (let i = 24; i < b.length; i += 4) {
    const routerId = address(b, i);
    if (!nonzero(routerId) || seen.has(routerId))
      return reject("OSPF_NETWORK_LSA_ROUTER_INVALID");
    seen.add(routerId);
    routers.push(routerId);
  }
  // RFC A.4.3 requires the Designated Router to list itself. This proves
  // only structural self-inclusion, NOT a valid elected DR or adjacency.
  if (!seen.has(header.advertisingRouter))
    return reject("OSPF_NETWORK_LSA_DR_NOT_LISTED");
  return {
    ok: true,
    lsa: {
      kind: "NETWORK_LSA_BODY",
      header: { ...header, lsaType: 2 },
      bytes: b, networkMask: address(b, 20),
      maskPrefixLength: prefix, attachedRouterIds: routers,
    },
  };
}
