import { asStringArray, isRecord } from "./json.js";
import type {
  AuthenticationDetails,
  EngineQueryResult,
  EngineState,
  MembershipDetails,
  PermissionDetails,
  TruthValue,
} from "./types.js";

interface MembershipGraph {
  readonly edges: ReadonlyMap<string, readonly string[]>;
  readonly complete: ReadonlySet<string>;
}

function buildMembershipGraph(state: EngineState): MembershipGraph {
  const mutable = new Map<string, Set<string>>();
  const complete = new Set<string>();
  const add = (subject: string, group: string): void => {
    const set = mutable.get(subject) ?? new Set<string>();
    set.add(group);
    mutable.set(subject, set);
  };

  for (const resource of Object.values(state.resources)) {
    const direct = asStringArray(resource.properties.memberOf);
    if (direct) {
      complete.add(resource.id);
      direct.forEach((group) => add(resource.id, group));
    }
    const members = asStringArray(resource.properties.members);
    if (members) members.forEach((subject) => add(subject, resource.id));
  }

  const edges = new Map<string, readonly string[]>();
  for (const [subject, groups] of mutable.entries()) edges.set(subject, [...groups].sort((a, b) => a.localeCompare(b, "en")));
  return { edges, complete };
}

export function queryMembership(state: EngineState, subject: string, group: string): EngineQueryResult<MembershipDetails> {
  if (!state.resources[subject] || !state.resources[group]) {
    return { truth: "UNKNOWN", explanation: [`Membership endpoint is absent from runtime state: '${subject}' -> '${group}'.`] };
  }
  if (subject === group) return { truth: "TRUE", value: { subject, group, path: [subject] }, explanation: [`'${subject}' equals the requested identity group.`] };

  const graph = buildMembershipGraph(state);
  const queue: string[][] = [[subject]];
  const visited = new Set<string>([subject]);
  let closedWorld = graph.complete.has(subject);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1]!;
    if (!graph.complete.has(current) && current !== subject) closedWorld = false;
    for (const next of graph.edges.get(current) ?? []) {
      if (visited.has(next)) continue;
      const candidate = [...path, next];
      if (next === group) {
        return {
          truth: "TRUE",
          value: { subject, group, path: candidate },
          explanation: [`Membership path: ${candidate.join(" -> ")}.`],
        };
      }
      visited.add(next);
      queue.push(candidate);
    }
  }

  if (closedWorld) {
    return { truth: "FALSE", value: { subject, group }, explanation: [`Declared complete memberOf data for '${subject}' does not lead to '${group}'.`] };
  }
  return { truth: "UNKNOWN", value: { subject, group }, explanation: [`No membership path to '${group}' is declared, but membership data is incomplete.`] };
}

interface PermissionEntry {
  readonly subject: string;
  readonly permission: string;
  readonly effect: "allow" | "deny";
}

function readPermissions(state: EngineState, resourceId: string): readonly PermissionEntry[] | undefined {
  const resource = state.resources[resourceId];
  if (!resource) return undefined;
  const raw = resource.properties.permissions;
  if (!Array.isArray(raw)) return undefined;
  const out: PermissionEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.subject !== "string" || typeof item.permission !== "string") continue;
    const effect = item.effect === "deny" ? "deny" : item.effect === "allow" || item.effect === undefined ? "allow" : undefined;
    if (!effect) continue;
    out.push({ subject: item.subject, permission: item.permission, effect });
  }
  return out;
}

function permissionMatches(entry: PermissionEntry, requested: string): boolean {
  return entry.permission === requested || entry.permission === "*";
}

export function queryPermission(state: EngineState, subject: string, resourceId: string, permission: string): EngineQueryResult<PermissionDetails> {
  if (!state.resources[subject] || !state.resources[resourceId]) {
    return { truth: "UNKNOWN", explanation: [`Permission endpoint is absent from runtime state: '${subject}' -> '${resourceId}'.`] };
  }
  const permissions = readPermissions(state, resourceId);
  if (!permissions) return { truth: "UNKNOWN", explanation: [`Resource '${resourceId}' has no declared authoritative permissions list.`] };

  const direct = permissions.filter((entry) => entry.subject === subject && permissionMatches(entry, permission));
  const directDeny = direct.find((entry) => entry.effect === "deny");
  if (directDeny) return { truth: "FALSE", value: { subject, resource: resourceId, permission, via: subject, effect: "deny" }, explanation: [`Direct deny on '${resourceId}' blocks '${permission}' for '${subject}'.`] };
  const directAllow = direct.find((entry) => entry.effect === "allow");
  if (directAllow) return { truth: "TRUE", value: { subject, resource: resourceId, permission, via: subject, effect: "allow" }, explanation: [`Direct allow on '${resourceId}' grants '${permission}' to '${subject}'.`] };

  let sawUnknownMembership = false;
  let allowVia: string | undefined;
  for (const entry of permissions.filter((item) => item.subject !== subject && permissionMatches(item, permission))) {
    const membership = queryMembership(state, subject, entry.subject);
    if (membership.truth === "UNKNOWN") sawUnknownMembership = true;
    if (membership.truth !== "TRUE") continue;
    if (entry.effect === "deny") {
      return {
        truth: "FALSE",
        value: { subject, resource: resourceId, permission, via: entry.subject, effect: "deny" },
        explanation: [...membership.explanation, `Group deny via '${entry.subject}' blocks '${permission}' on '${resourceId}'.`],
      };
    }
    allowVia ??= entry.subject;
  }

  if (allowVia) return { truth: "TRUE", value: { subject, resource: resourceId, permission, via: allowVia, effect: "allow" }, explanation: [`Effective permission '${permission}' is granted via membership in '${allowVia}'.`] };
  if (sawUnknownMembership) return { truth: "UNKNOWN", value: { subject, resource: resourceId, permission }, explanation: [`A relevant permission entry exists, but group membership evidence is incomplete.`] };
  return { truth: "FALSE", value: { subject, resource: resourceId, permission }, explanation: [`Authoritative permissions on '${resourceId}' contain no applicable allow for '${subject}'.`] };
}

export function queryAuthentication(state: EngineState, subject: string, target: string): EngineQueryResult<AuthenticationDetails> {
  const subjectResource = state.resources[subject];
  const targetResource = state.resources[target];
  if (!subjectResource || !targetResource) return { truth: "UNKNOWN", explanation: [`Authentication endpoint is absent from runtime state: '${subject}' -> '${target}'.`] };
  const raw = targetResource.properties.authentication;
  if (!isRecord(raw)) return { truth: "UNKNOWN", explanation: [`Target '${target}' has no declared authentication policy.`] };
  if (raw.enabled === false) return { truth: "FALSE", value: { subject, target }, explanation: [`Authentication is explicitly disabled on '${target}'.`] };

  const allowedSubjects = asStringArray(raw.allowedSubjects);
  const allowedGroups = asStringArray(raw.allowedGroups);
  let access: TruthValue = "UNKNOWN";
  let via: string | undefined;
  if (allowedSubjects?.includes(subject)) {
    access = "TRUE";
    via = subject;
  } else if (allowedSubjects || allowedGroups) {
    access = "FALSE";
    let unknown = false;
    for (const group of allowedGroups ?? []) {
      const membership = queryMembership(state, subject, group);
      if (membership.truth === "TRUE") {
        access = "TRUE";
        via = group;
        break;
      }
      if (membership.truth === "UNKNOWN") unknown = true;
    }
    if (access === "FALSE" && unknown) access = "UNKNOWN";
  }

  if (access !== "TRUE") {
    return {
      truth: access,
      value: { subject, target },
      explanation: [access === "FALSE" ? `Authentication policy on '${target}' does not authorize '${subject}'.` : `Authentication authorization data for '${subject}' on '${target}' is incomplete.`],
    };
  }

  const mfaRequired = raw.mfaRequired === true;
  if (mfaRequired) {
    const mfaEnabled = subjectResource.properties.mfaEnabled;
    if (mfaEnabled === false) return { truth: "FALSE", value: { subject, target, ...(via ? { via } : {}), mfaRequired }, explanation: [`'${subject}' is authorized but MFA is required and explicitly disabled.`] };
    if (mfaEnabled !== true) return { truth: "UNKNOWN", value: { subject, target, ...(via ? { via } : {}), mfaRequired }, explanation: [`'${subject}' is authorized but MFA capability/state is not declared.`] };
  }

  return { truth: "TRUE", value: { subject, target, ...(via ? { via } : {}), ...(mfaRequired ? { mfaRequired } : {}) }, explanation: [`Authentication policy on '${target}' authorizes '${subject}'${via && via !== subject ? ` via '${via}'` : ""}.`] };
}
