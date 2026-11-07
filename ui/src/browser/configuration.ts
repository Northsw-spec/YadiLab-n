import type { ScenarioSource, Scenariosourceconnection, Scenariosourceinterface } from "../../../core-model/src/generated/contracts.js";
import { cloneJson } from "./json.js";
import { setResourceProperty, upsertConnection } from "./builder.js";
import type { BrowserCommandResult, BuilderWorkspace } from "./types.js";

export type ConfigurationDomain = "interfaces" | "routes" | "vlans" | "stp" | "services" | "firewall" | "nat" | "flows" | "faults";

function failure(workspace: BuilderWorkspace, code: string, message: string, objectId?: string): BrowserCommandResult<BuilderWorkspace> {
  return { ok: false, workspace, diagnostics: [{ severity: "error", code, message, ...(objectId ? { objectId } : {}) }] };
}

function resource(workspace: BuilderWorkspace, resourceId: string) {
  return workspace.source.resources.find((item) => item.id === resourceId);
}

/** Author a complete interface list without bypassing the immutable Builder command path. */
export function setResourceInterfaces(
  workspace: BuilderWorkspace,
  resourceId: string,
  interfaces: readonly Scenariosourceinterface[],
): BrowserCommandResult<BuilderWorkspace> {
  const target = resource(workspace, resourceId);
  if (!target) return failure(workspace, "CONFIG_RESOURCE_UNKNOWN", `Resource '${resourceId}' does not exist.`, resourceId);
  const ids = new Set<string>();
  for (const item of interfaces) {
    if (ids.has(item.id)) return failure(workspace, "CONFIG_INTERFACE_DUPLICATE", `Interface '${item.id}' is duplicated.`, resourceId);
    ids.add(item.id);
  }
  return setResourceProperty(workspace, resourceId, "interfaces", cloneJson(interfaces));
}

/** Update one canonical networking/service/security field on a resource. */
export function setResourceConfiguration(
  workspace: BuilderWorkspace,
  resourceId: string,
  domain: ConfigurationDomain,
  value: unknown,
): BrowserCommandResult<BuilderWorkspace> {
  if (!resource(workspace, resourceId)) return failure(workspace, "CONFIG_RESOURCE_UNKNOWN", `Resource '${resourceId}' does not exist.`, resourceId);
  const path = domain === "interfaces" ? "interfaces" : `properties.${domain}`;
  return setResourceProperty(workspace, resourceId, path, cloneJson(value));
}

/** Replace only the canonical properties of an existing connection. */
export function setConnectionConfiguration(
  workspace: BuilderWorkspace,
  connectionId: string,
  properties: Record<string, unknown>,
): BrowserCommandResult<BuilderWorkspace> {
  const connection = workspace.source.connections.find((item) => item.id === connectionId);
  if (!connection) return failure(workspace, "CONFIG_CONNECTION_UNKNOWN", `Connection '${connectionId}' does not exist.`, connectionId);
  const next: Scenariosourceconnection = { ...cloneJson(connection), properties: cloneJson(properties) };
  return upsertConnection(workspace, next);
}

/** Return a stable summary used by the UI to show which authored domains are populated. */
export function configurationSummary(source: ScenarioSource): Readonly<Record<ConfigurationDomain, number>> {
  const summary: Record<ConfigurationDomain, number> = {
    interfaces: 0, routes: 0, vlans: 0, stp: 0, services: 0, firewall: 0, nat: 0, flows: 0, faults: 0,
  };
  for (const item of source.resources) {
    summary.interfaces += item.interfaces?.length ?? 0;
    for (const domain of ["routes", "vlans", "stp", "services", "firewall", "nat", "flows", "faults"] as const) {
      if (item.properties && Object.prototype.hasOwnProperty.call(item.properties, domain)) summary[domain] += 1;
    }
  }
  for (const connection of source.connections) {
    if (connection.kind === "data_flow") summary.flows += 1;
    if (connection.properties && Object.prototype.hasOwnProperty.call(connection.properties, "faults")) summary.faults += 1;
  }
  return summary;
}
