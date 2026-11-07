import type { EngineState } from "./types.js";
import {
  compareOspfLsaHeaders, OSPF_LSA_MAX_AGE,
} from "./ospf-lsdb-summary.js";
import type { OspfLsaHeader } from "./ospf-lsdb-summary.js";
import { parseOspfLsaBody } from "./ospf-lsa-body.js";
import type { OspfParsedLsaBody } from "./ospf-lsa-body.js";

/**
 * RFC 2328 §§12.2,13.1,13.2,14: bounded, source-bound *model* of one
 * area's Type 1/2 LSDB. External input is SYNTHETIC and already associated
 * with an area by its caller; no OSPF wire/authentication, flooding,
 * acknowledgments, graph inference, route installation or FULL adjacency.
 */
export const OSPF_AREA_LSDB_FORMAT = "yadilab.engine.ospfv2-area-lsdb-model" as const;
export const OSPF_AREA_LSDB_VERSION = "1.0.0" as const;
export const OSPF_AREA_LSDB_MAX_ENTRIES = 128 as const;
export const OSPF_AREA_LSDB_MAX_BATCH = 8 as const;
export const OSPF_AREA_MIN_LS_ARRIVAL_MS = 1000 as const;
const SOURCE = "SYNTHETIC_OSPFV2_AREA_LSDB_MODEL" as const;

export type OspfAreaLsaSource = "FLOODING_MODEL" | "SYNC_MODEL";
export interface OspfAreaLsdbAnchor {
  readonly scenarioId: string;
  readonly scenarioHash: string;
  readonly stateRevision: number;
  readonly ownerResourceId: string;
  readonly areaId: string;
}
export interface OspfAreaLsdbEntry {
  /** Saved unmodified octets with a valid Fletcher checksum. */
  readonly bytes: readonly number[];
  readonly header: OspfLsaHeader;
  readonly receivedAtMs: number;
  readonly source: OspfAreaLsaSource;
}
export interface OspfAreaLsdbSession {
  readonly formatId: typeof OSPF_AREA_LSDB_FORMAT;
  readonly schemaVersion: typeof OSPF_AREA_LSDB_VERSION;
  readonly anchor: OspfAreaLsdbAnchor;
  readonly clockMs: number;
  readonly entries: readonly OspfAreaLsdbEntry[];
}
export interface OspfAreaLsdbObservation {
  readonly atMs: number;
  /** OSPF LSAs do not contain an area identifier: explicit caller context. */
  readonly areaId: string;
  readonly source: OspfAreaLsaSource;
  readonly lsas: readonly (readonly number[])[];
}
export type OspfAreaLsdbEventKind =
  | "LSA_STAGED_MODEL" | "LSA_REPLACED_MODEL"
  | "LSA_EQUIVALENT_IGNORED" | "LSA_OLDER_IGNORED"
  | "LSA_MIN_LS_ARRIVAL_DISCARDED"
  | "LSA_MAXAGE_REACHED_MODEL" | "LSA_MAXAGE_RETAINED_MODEL";
export interface OspfAreaLsdbEvent {
  readonly kind: OspfAreaLsdbEventKind;
  readonly atMs: number;
  readonly identity: string;
  readonly source: typeof SOURCE;
}
export interface OspfAreaLsdbReadEntry {
  readonly header: OspfLsaHeader;
  readonly body: OspfParsedLsaBody;
  readonly receivedAtMs: number;
  readonly receivedVia: OspfAreaLsaSource;
  readonly currentAgeSeconds: number;
  /** Cannot be used by a future SPF model when at MaxAge. */
  readonly maxAgeBlocked: boolean;
}
export type OspfAreaLsdbReadResult =
  | { readonly ok: true; readonly entries: readonly OspfAreaLsdbReadEntry[] }
  | { readonly ok: false; readonly code: string };
export type OspfAreaLsdbResult =
  | {
      readonly ok: true;
      readonly session: OspfAreaLsdbSession;
      readonly events: readonly OspfAreaLsdbEvent[];
    }
  | { readonly ok: false; readonly session: OspfAreaLsdbSession; readonly code: string };

const validTime = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function ipv4(ip: unknown): boolean {
  if (typeof ip !== "string") return false;
  const parts = ip.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part)
    && String(Number(part)) === part && Number(part) <= 255);
}
function identity(h: Pick<OspfLsaHeader, "lsaType" | "linkStateId" | "advertisingRouter">): string {
  return [String(h.lsaType), ...h.linkStateId.split("."),
    ...h.advertisingRouter.split(".")].map((part) => part.padStart(3, "0")).join(".");
}
function sortEntries(items: OspfAreaLsdbEntry[]): OspfAreaLsdbEntry[] {
  return items.sort((a, b) => {
    const x = identity(a.header), y = identity(b.header);
    return x < y ? -1 : x > y ? 1 : 0;
  });
}
function cloneHeader(h: OspfLsaHeader): OspfLsaHeader {
  return {
    lsAge: h.lsAge, options: h.options, lsaType: h.lsaType,
    linkStateId: h.linkStateId, advertisingRouter: h.advertisingRouter,
    lsSequenceNumber: h.lsSequenceNumber, lsChecksum: h.lsChecksum,
    length: h.length,
  };
}
function anchorOf(
  state: EngineState, ownerResourceId: string, areaId: string,
): OspfAreaLsdbAnchor {
  return {
    scenarioId: state.scenarioId, scenarioHash: state.scenarioHash,
    stateRevision: state.stateRevision, ownerResourceId, areaId,
  };
}
function effectiveAge(e: OspfAreaLsdbEntry, atMs: number): number {
  return Math.min(OSPF_LSA_MAX_AGE, e.header.lsAge +
    Math.floor((atMs - e.receivedAtMs) / 1000));
}
function event(
  kind: OspfAreaLsdbEventKind, atMs: number, header: OspfLsaHeader,
): OspfAreaLsdbEvent {
  return { kind, atMs, identity: identity(header), source: SOURCE };
}
function fail(session: OspfAreaLsdbSession, code: string): OspfAreaLsdbResult {
  return { ok: false, session, code };
}
function crossingEvents(
  entries: readonly OspfAreaLsdbEntry[], startMs: number, endMs: number,
): OspfAreaLsdbEvent[] {
  return entries.filter((e) =>
    effectiveAge(e, startMs) < OSPF_LSA_MAX_AGE
    && effectiveAge(e, endMs) === OSPF_LSA_MAX_AGE)
    .map((e) => event("LSA_MAXAGE_REACHED_MODEL", endMs, e.header));
}

/** Every stored LSA is re-parsed and Fletcher-verified on each inspection. */
export function inspectOspfAreaLsdbSession(
  session: OspfAreaLsdbSession, state: EngineState,
): string | null {
  if (!session || session.formatId !== OSPF_AREA_LSDB_FORMAT
    || session.schemaVersion !== OSPF_AREA_LSDB_VERSION
    || !session.anchor || !validTime(session.clockMs)
    || !Array.isArray(session.entries)
    || session.entries.length > OSPF_AREA_LSDB_MAX_ENTRIES)
    return "OSPF_AREA_LSDB_SESSION_INVALID";
  const { ownerResourceId, areaId } = session.anchor;
  if (typeof ownerResourceId !== "string" || !ownerResourceId
    || !ipv4(areaId)
    || !state.resources[ownerResourceId]
    || state.resources[ownerResourceId]?.type !== "network.router"
    || !same(session.anchor, anchorOf(state, ownerResourceId, areaId)))
    return "OSPF_AREA_LSDB_STALE_SOURCE";
  let priorKey = "";
  for (const e of session.entries) {
    if (!e || !validTime(e.receivedAtMs) || e.receivedAtMs > session.clockMs
      || (e.source !== "FLOODING_MODEL" && e.source !== "SYNC_MODEL")
      || !Array.isArray(e.bytes))
      return "OSPF_AREA_LSDB_ENTRY_INVALID";
    const parsed = parseOspfLsaBody(e.bytes);
    if (!parsed.ok || !same(parsed.lsa.header, e.header))
      return "OSPF_AREA_LSDB_ENTRY_INVALID";
    const key = identity(e.header);
    if (key <= priorKey) return "OSPF_AREA_LSDB_ORDER_INVALID";
    priorKey = key;
  }
  return null;
}
/** Fresh area snapshot. Other areas require distinct, independently bound sessions. */
export function createOspfAreaLsdbSession(
  state: EngineState, ownerResourceId: string, areaId: string,
  nowMs = 0,
): OspfAreaLsdbSession {
  if (!validTime(nowMs) || !ipv4(areaId)
    || typeof ownerResourceId !== "string"
    || state.resources[ownerResourceId]?.type !== "network.router")
    throw Error("OSPF_AREA_LSDB_CONFIG_INVALID");
  const session: OspfAreaLsdbSession = {
    formatId: OSPF_AREA_LSDB_FORMAT,
    schemaVersion: OSPF_AREA_LSDB_VERSION,
    anchor: anchorOf(state, ownerResourceId, areaId),
    clockMs: nowMs, entries: [],
  };
  const invalid = inspectOspfAreaLsdbSession(session, state);
  if (invalid) throw Error(invalid);
  return session;
}
export function readOspfAreaLsdb(
  session: OspfAreaLsdbSession, state: EngineState,
): OspfAreaLsdbReadResult {
  const invalid = inspectOspfAreaLsdbSession(session, state);
  if (invalid) return { ok: false, code: invalid };
  const entries = session.entries.map((e): OspfAreaLsdbReadEntry => {
    // Inspection above already established structural checksum integrity.
    const parsed = parseOspfLsaBody(e.bytes);
    if (!parsed.ok) throw Error("OSPF_AREA_LSDB_UNREACHABLE_PARSE_FAILURE");
    const age = effectiveAge(e, session.clockMs);
    return {
      header: { ...cloneHeader(e.header), lsAge: age }, body: parsed.lsa,
      receivedAtMs: e.receivedAtMs, receivedVia: e.source,
      currentAgeSeconds: age, maxAgeBlocked: age === OSPF_LSA_MAX_AGE,
    };
  });
  return { ok: true, entries };
}
/**
 * Advance a virtual clock. MaxAge entries remain until a later checkpoint
 * proves BOTH: no neighbor retransmission lists and no Exchange/Loading
 * neighbors. Do not silently purge at 3600 seconds.
 */
export function advanceOspfAreaLsdb(
  session: OspfAreaLsdbSession, state: EngineState, untilMs: number,
): OspfAreaLsdbResult {
  const invalid = inspectOspfAreaLsdbSession(session, state);
  if (invalid) return fail(session, invalid);
  if (!validTime(untilMs) || untilMs < session.clockMs)
    return fail(session, "OSPF_AREA_LSDB_TIME_INVALID");
  const events = crossingEvents(session.entries, session.clockMs, untilMs);
  const next: OspfAreaLsdbSession = { ...session, clockMs: untilMs };
  const post = inspectOspfAreaLsdbSession(next, state);
  return post ? fail(session, post) : { ok: true, session: next, events };
}
/**
 * Transactional, synthetic receipt from an already area-associated source.
 * RFC 2328 MinLSArrival is applied if an existing LSA was installed from
 * FLOODING_MODEL less than 1000ms ago. This code NEVER floods or sends ACKs.
 */
export function receiveOspfAreaLsaBatch(
  session: OspfAreaLsdbSession, state: EngineState,
  observation: OspfAreaLsdbObservation,
): OspfAreaLsdbResult {
  const invalid = inspectOspfAreaLsdbSession(session, state);
  if (invalid) return fail(session, invalid);
  if (!observation || !validTime(observation.atMs)
    || observation.atMs < session.clockMs
    || observation.areaId !== session.anchor.areaId
    || (observation.source !== "FLOODING_MODEL" && observation.source !== "SYNC_MODEL"))
    return fail(session, "OSPF_AREA_LSDB_OBSERVATION_INVALID");
  if (!Array.isArray(observation.lsas) || observation.lsas.length < 1
    || observation.lsas.length > OSPF_AREA_LSDB_MAX_BATCH)
    return fail(session, "OSPF_AREA_LSDB_BATCH_INVALID");

  const parsedBodies: OspfParsedLsaBody[] = [];
  const seen = new Set<string>();
  for (const bytes of observation.lsas) {
    const parsed = parseOspfLsaBody(bytes);
    if (!parsed.ok) return fail(session, parsed.code);
    const key = identity(parsed.lsa.header);
    if (seen.has(key)) return fail(session, "OSPF_AREA_LSDB_DUPLICATE_BATCH_IDENTITY");
    seen.add(key);
    parsedBodies.push(parsed.lsa);
  }

  const events = crossingEvents(session.entries, session.clockMs, observation.atMs);
  const current = new Map(session.entries.map((e) => [identity(e.header), e]));
  for (const body of parsedBodies) {
    const h = body.header, key = identity(h);
    const existing = current.get(key);
    if (!existing) {
      // RFC §13 step 4 depends on neighbor Exchange/Loading state and ACK
      // behavior that we cannot verify. Refuse orphan MaxAge as proof.
      if (h.lsAge === OSPF_LSA_MAX_AGE)
        return fail(session, "OSPF_AREA_LSDB_MAXAGE_ORPHAN_UNMODELED");
      if (current.size >= OSPF_AREA_LSDB_MAX_ENTRIES)
        return fail(session, "OSPF_AREA_LSDB_CAPACITY");
      current.set(key, {
        bytes: [...body.bytes], header: cloneHeader(h),
        receivedAtMs: observation.atMs, source: observation.source,
      });
      events.push(event("LSA_STAGED_MODEL", observation.atMs, h));
      continue;
    }
    const ageAdjusted = { ...existing.header, lsAge: effectiveAge(existing, observation.atMs) };
    const comparison = compareOspfLsaHeaders(ageAdjusted, h);
    if (comparison === -1) {
      events.push(event("LSA_OLDER_IGNORED", observation.atMs, h));
      continue;
    }
    if (comparison === 0) {
      // Identical RFC recency is not proof of identical bytes: reject a
      // Fletcher collision or same-instance data rewrite, but ignore age.
      if (!same(existing.bytes.slice(2), body.bytes.slice(2)))
        return fail(session, "OSPF_AREA_LSDB_SAME_INSTANCE_COLLISION");
      events.push(event("LSA_EQUIVALENT_IGNORED", observation.atMs, h));
      continue;
    }
    if (existing.source === "FLOODING_MODEL"
      && observation.atMs - existing.receivedAtMs < OSPF_AREA_MIN_LS_ARRIVAL_MS) {
      events.push(event("LSA_MIN_LS_ARRIVAL_DISCARDED", observation.atMs, h));
      continue;
    }
    current.set(key, {
      bytes: [...body.bytes], header: cloneHeader(h),
      receivedAtMs: observation.atMs, source: observation.source,
    });
    events.push(event(h.lsAge === OSPF_LSA_MAX_AGE
      ? "LSA_MAXAGE_RETAINED_MODEL" : "LSA_REPLACED_MODEL", observation.atMs, h));
  }
  const next: OspfAreaLsdbSession = {
    ...session, clockMs: observation.atMs, entries: sortEntries([...current.values()]),
  };
  const post = inspectOspfAreaLsdbSession(next, state);
  return post ? fail(session, post) : { ok: true, session: next, events };
}
