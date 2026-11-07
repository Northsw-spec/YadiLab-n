import type { EngineState } from "./types.js";
import type {
  OspfAreaLsdbAnchor, OspfAreaLsdbEntry, OspfAreaLsdbSession,
} from "./ospf-area-lsdb.js";
import { inspectOspfAreaLsdbSession, readOspfAreaLsdb } from "./ospf-area-lsdb.js";
import type { OspfLsaHeader, OspfLsaKind } from "./ospf-lsdb-summary.js";
import { OSPF_LSA_MAX_AGE } from "./ospf-lsdb-summary.js";

/**
 * RFC 2328 §14, MaxAge removal: (a) NOT on any neighbor's LS retransmission
 * list; (b) NO neighbors in Exchange or Loading. This is ONLY a synthetic
 * guard over a caller-DECLARED complete inventory. There is NO independent
 * packet/neighbor authentication, verified inventory completeness, real
 * flooding/ack, live LSDB removal, SPF, FULL or route installation.
 */
export const OSPF_MAXAGE_FLUSH_FORMAT = "yadilab.engine.ospfv2-maxage-flush-model" as const;
export const OSPF_MAXAGE_FLUSH_VERSION = "1.0.0" as const;
export const OSPF_MAXAGE_MAX_NEIGHBORS = 32 as const;
export const OSPF_MAXAGE_MAX_RETRANSMISSION_IDS = 128 as const;
export const OSPF_MAXAGE_MAX_REMOVAL_BATCH = 8 as const;
export const OSPF_MAXAGE_INVENTORY_SOURCE = "CALLER_DECLARED_SYNTHETIC_INVENTORY" as const;
const EVENT_SOURCE = "SYNTHETIC_OSPFV2_MAXAGE_FLUSH_MODEL" as const;

export type OspfMaxAgeNeighborPhase =
  | "DOWN" | "ATTEMPT" | "INIT" | "TWO_WAY" | "EXSTART"
  | "EXCHANGE" | "LOADING" | "FULL";
export interface OspfMaxAgeLsaIdentity {
  readonly lsaType: OspfLsaKind;
  readonly linkStateId: string;
  readonly advertisingRouter: string;
}
export interface OspfMaxAgeNeighborDeclaration {
  readonly routerId: string;
  readonly phase: OspfMaxAgeNeighborPhase;
  /** Must be true, but supplied by caller, NOT verified against a live peer. */
  readonly retransmissionListComplete: true;
  /** Model-only LSA identity references; even old instances block removal. */
  readonly retransmissionIdentities: readonly OspfMaxAgeLsaIdentity[];
}
export interface OspfMaxAgeInventoryDeclaration {
  readonly formatId: typeof OSPF_MAXAGE_FLUSH_FORMAT;
  readonly schemaVersion: typeof OSPF_MAXAGE_FLUSH_VERSION;
  readonly source: typeof OSPF_MAXAGE_INVENTORY_SOURCE;
  /** Caller assertion: all neighbors for this router/area are represented. */
  readonly allNeighborsDeclared: true;
  readonly observedAnchor: OspfAreaLsdbAnchor;
  readonly observedAtMs: number;
  /**
   * Exact LSDB bytes, versions, timings, and metadata when observed.
   * Avoids reusing an inventory after a same-time LSDB update.
   */
  readonly observedEntries: readonly OspfAreaLsdbEntry[];
  readonly neighbors: readonly OspfMaxAgeNeighborDeclaration[];
}
export type OspfMaxAgeFlushBlocker = "EXCHANGE_OR_LOADING" | "RETRANSMISSION";
export interface OspfMaxAgeFlushCandidate {
  readonly identity: OspfMaxAgeLsaIdentity;
  readonly ageSeconds: number;
  readonly disposition: "MODEL_ONLY_ELIGIBLE" | "MODEL_ONLY_BLOCKED";
  readonly blockers: readonly OspfMaxAgeFlushBlocker[];
  readonly retransmittingNeighborIds: readonly string[];
}
export type OspfMaxAgeFlushEvaluation =
  | { readonly ok: true; readonly inventorySource: typeof OSPF_MAXAGE_INVENTORY_SOURCE;
      readonly candidates: readonly OspfMaxAgeFlushCandidate[] }
  | { readonly ok: false; readonly code: string };
export interface OspfMaxAgeFlushEvent {
  readonly kind: "MAXAGE_REMOVED_FROM_SYNTHETIC_SNAPSHOT";
  readonly atMs: number;
  readonly identity: OspfMaxAgeLsaIdentity;
  readonly source: typeof EVENT_SOURCE;
}
export type OspfMaxAgeFlushResult =
  | { readonly ok: true; readonly session: OspfAreaLsdbSession;
      readonly events: readonly OspfMaxAgeFlushEvent[] }
  | { readonly ok: false; readonly session: OspfAreaLsdbSession; readonly code: string };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function ipv4(ip: unknown, allowZero: boolean): ip is string {
  if (typeof ip !== "string") return false;
  const p = ip.split(".");
  return p.length === 4 && p.every((v) => /^(0|[1-9]\d{0,2})$/.test(v)
    && Number(v) <= 255) && (allowZero || ip !== "0.0.0.0");
}
function id(h: OspfMaxAgeLsaIdentity): string {
  return [String(h.lsaType), ...h.linkStateId.split("."),
    ...h.advertisingRouter.split(".")].map((p) => p.padStart(3, "0")).join(".");
}
function routerOrder(ip: string): string {
  return ip.split(".").map((p) => p.padStart(3, "0")).join(".");
}
function identity(h: Pick<OspfLsaHeader, "lsaType" | "linkStateId" | "advertisingRouter">): OspfMaxAgeLsaIdentity {
  return { lsaType: h.lsaType, linkStateId: h.linkStateId, advertisingRouter: h.advertisingRouter };
}
function validIdentity(value: unknown): value is OspfMaxAgeLsaIdentity {
  if (typeof value !== "object" || value === null) return false;
  const h = value as Partial<OspfMaxAgeLsaIdentity>;
  if ((h.lsaType !== 1 && h.lsaType !== 2)
    || !ipv4(h.linkStateId, true) || !ipv4(h.advertisingRouter, false)
    || (h.lsaType === 1 && h.linkStateId !== h.advertisingRouter)) return false;
  return same(value, identity(h as OspfMaxAgeLsaIdentity));
}
function verifyInventory(
  session: OspfAreaLsdbSession, state: EngineState,
  inventory: OspfMaxAgeInventoryDeclaration,
): string | null {
  const invalid = inspectOspfAreaLsdbSession(session, state);
  if (invalid) return invalid;
  if (!inventory || inventory.formatId !== OSPF_MAXAGE_FLUSH_FORMAT
    || inventory.schemaVersion !== OSPF_MAXAGE_FLUSH_VERSION
    || inventory.source !== OSPF_MAXAGE_INVENTORY_SOURCE)
    return "OSPF_MAXAGE_INVENTORY_INVALID";
  if (inventory.allNeighborsDeclared !== true || !Array.isArray(inventory.neighbors))
    return "OSPF_MAXAGE_INVENTORY_INCOMPLETE";
  if (!Number.isSafeInteger(inventory.observedAtMs)
    || !same(inventory.observedAnchor, session.anchor)
    || inventory.observedAtMs !== session.clockMs
    || !same(inventory.observedEntries, session.entries))
    return "OSPF_MAXAGE_INVENTORY_STALE";
  if (inventory.neighbors.length > OSPF_MAXAGE_MAX_NEIGHBORS)
    return "OSPF_MAXAGE_INVENTORY_LIMIT";
  let previous = "";
  for (const neighbor of inventory.neighbors) {
    if (!neighbor || !ipv4(neighbor.routerId, false)
      || !["DOWN", "ATTEMPT", "INIT", "TWO_WAY", "EXSTART",
        "EXCHANGE", "LOADING", "FULL"].includes(neighbor.phase))
      return "OSPF_MAXAGE_NEIGHBOR_INVALID";
    if (neighbor.retransmissionListComplete !== true
      || !Array.isArray(neighbor.retransmissionIdentities))
      return "OSPF_MAXAGE_INVENTORY_INCOMPLETE";
    const next = routerOrder(neighbor.routerId);
    if (next <= previous) return "OSPF_MAXAGE_NEIGHBOR_ORDER_INVALID";
    previous = next;
    if (neighbor.retransmissionIdentities.length > OSPF_MAXAGE_MAX_RETRANSMISSION_IDS)
      return "OSPF_MAXAGE_RETRANSMISSION_LIMIT";
    let prevId = "";
    for (const ref of neighbor.retransmissionIdentities) {
      if (!validIdentity(ref)) return "OSPF_MAXAGE_RETRANSMISSION_INVALID";
      const key = id(ref);
      if (key <= prevId) return "OSPF_MAXAGE_RETRANSMISSION_ORDER_INVALID";
      prevId = key;
    }
  }
  return null;
}
/** Inspect a declaration, NEVER treat it as independent proof of neighbor truth. */
export function inspectOspfMaxAgeInventory(
  session: OspfAreaLsdbSession, state: EngineState,
  inventory: OspfMaxAgeInventoryDeclaration,
): string | null {
  return verifyInventory(session, state, inventory);
}
/** All candidates are *model only*: caller-completeness is not verifiable. */
export function evaluateOspfMaxAgeFlush(
  session: OspfAreaLsdbSession, state: EngineState,
  inventory: OspfMaxAgeInventoryDeclaration,
): OspfMaxAgeFlushEvaluation {
  const invalid = verifyInventory(session, state, inventory);
  if (invalid) return { ok: false, code: invalid };
  const read = readOspfAreaLsdb(session, state);
  if (!read.ok) return { ok: false, code: read.code };
  const exchangeOrLoading = inventory.neighbors.some((neighbor) =>
    neighbor.phase === "EXCHANGE" || neighbor.phase === "LOADING");
  const candidates: OspfMaxAgeFlushCandidate[] = read.entries
    .filter((entry) => entry.maxAgeBlocked)
    .map((entry) => {
      const target = identity(entry.header);
      const matching = inventory.neighbors.filter((n) =>
        n.retransmissionIdentities.some((ref) => id(ref) === id(target)))
        .map((n) => n.routerId);
      const blockers: OspfMaxAgeFlushBlocker[] = [
        ...(exchangeOrLoading ? ["EXCHANGE_OR_LOADING" as const] : []),
        ...(matching.length ? ["RETRANSMISSION" as const] : []),
      ];
      return {
        identity: target,
        ageSeconds: OSPF_LSA_MAX_AGE,
        disposition: blockers.length ? "MODEL_ONLY_BLOCKED" as const : "MODEL_ONLY_ELIGIBLE" as const,
        blockers, retransmittingNeighborIds: matching,
      };
    });
  return { ok: true, inventorySource: OSPF_MAXAGE_INVENTORY_SOURCE, candidates };
}
/**
 * Explicitly remove only requested MaxAge records from this synthetic area
 * snapshot, never real LSDB or EngineState. All-or-nothing if ANY candidate
 * is not MaxAge, absent, held for retransmission or neighbors Exchange/Loading.
 */
export function removeOspfAreaMaxAgeModel(
  session: OspfAreaLsdbSession, state: EngineState,
  inventory: OspfMaxAgeInventoryDeclaration,
  requested: readonly OspfMaxAgeLsaIdentity[],
): OspfMaxAgeFlushResult {
  const outcome = evaluateOspfMaxAgeFlush(session, state, inventory);
  if (!outcome.ok) return { ok: false, session, code: outcome.code };
  if (!Array.isArray(requested) || requested.length < 1
    || requested.length > OSPF_MAXAGE_MAX_REMOVAL_BATCH)
    return { ok: false, session, code: "OSPF_MAXAGE_REMOVE_BATCH_INVALID" };
  const entries = new Set(session.entries.map((e) => id(identity(e.header))));
  const candidates = new Map(outcome.candidates.map((c) => [id(c.identity), c]));
  const seen = new Set<string>();
  for (const target of requested) {
    if (!validIdentity(target)) return { ok: false, session, code: "OSPF_MAXAGE_REMOVE_ID_INVALID" };
    const key = id(target);
    if (seen.has(key)) return { ok: false, session, code: "OSPF_MAXAGE_REMOVE_DUPLICATE" };
    seen.add(key);
    if (!entries.has(key)) return { ok: false, session, code: "OSPF_MAXAGE_REMOVE_UNKNOWN" };
    const candidate = candidates.get(key);
    if (!candidate) return { ok: false, session, code: "OSPF_MAXAGE_REMOVE_NOT_MAXAGE" };
    if (candidate.disposition !== "MODEL_ONLY_ELIGIBLE")
      return { ok: false, session, code: "OSPF_MAXAGE_REMOVE_BLOCKED" };
  }
  const next: OspfAreaLsdbSession = {
    ...session,
    entries: session.entries.filter((e) => !seen.has(id(identity(e.header)))),
  };
  const post = inspectOspfAreaLsdbSession(next, state);
  if (post) return { ok: false, session, code: post };
  const events: OspfMaxAgeFlushEvent[] = requested.map((item) => ({
    kind: "MAXAGE_REMOVED_FROM_SYNTHETIC_SNAPSHOT",
    atMs: session.clockMs, identity: { ...item }, source: EVENT_SOURCE,
  }));
  return { ok: true, session: next, events };
}
