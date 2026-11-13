// G4.1: one source-validated, bounded activation policy for large XLSX
// imports.  This is deliberately independent of fixture filenames, scenario
// IDs, resource/link prefixes and exact row counts.
export const ATLAS_BOUNDED_MAX_RESOURCES = 1000;
export const ATLAS_BOUNDED_MAX_CONNECTIONS = 2000;
export const ATLAS_BOUNDED_SUPPORTED_PROFILES = Object.freeze(["standard", "legacy-six"]);
const REQUIRED_CANONICAL_SHEETS = Object.freeze(["Metadata", "Zones", "Nodes", "Interfaces", "Links", "Layout"]);

const decision = (eligible, reason, candidate, extra = {}) => Object.freeze({
  eligible,
  reason,
  resourceCount: candidate?.source?.resources?.length ?? 0,
  connectionCount: candidate?.source?.connections?.length ?? 0,
  ...extra,
});

function endpointPortIsDeclared(resourceById, endpoint) {
  if (endpoint?.port === undefined) return true;
  if (typeof endpoint.port !== "string" || endpoint.port.length === 0) return false;
  const resource = resourceById.get(endpoint.resource);
  const interfaces = Array.isArray(resource?.interfaces) ? resource.interfaces : [];
  return interfaces.some(iface => iface?.id === endpoint.port || iface?.interfaceId === endpoint.port || iface?.name === endpoint.port);
}

/**
 * Decide whether an already successful, source-bound XLSX preview can use the
 * existing bounded Atlas page path.  All failures are explicit and fail
 * closed; this function does not grant consent and does not perform layout.
 */
export function evaluateBoundedAtlasEligibility(candidate, normalResourceBudget = 200) {
  if (!candidate?.ok || !candidate.source) return decision(false, "preview-not-validated", candidate);
  if (!/\.xlsx$/i.test(candidate.filename ?? "")) return decision(false, "source-is-not-xlsx", candidate);
  if (!ATLAS_BOUNDED_SUPPORTED_PROFILES.includes(candidate.workbookProfile)) return decision(false, "unsupported-workbook-profile", candidate);
  if (!Array.isArray(candidate.sheets) || REQUIRED_CANONICAL_SHEETS.some(sheet => !candidate.sheets.includes(sheet))) {
    return decision(false, "canonical-sheets-missing", candidate);
  }
  if (candidate.unmappedColumnCount !== 0) return decision(false, "unmapped-source-columns", candidate);
  if (candidate.linkSourceConflict || candidate.linkSourceChoice === undefined && candidate.linkSourceConflict) {
    return decision(false, "link-source-conflict", candidate);
  }
  const resources = candidate.source.resources;
  const connections = candidate.source.connections;
  if (!Array.isArray(resources) || !Array.isArray(connections) || resources.length <= normalResourceBudget) {
    return decision(false, "within-normal-resource-budget", candidate);
  }
  if (resources.length > ATLAS_BOUNDED_MAX_RESOURCES) return decision(false, "resource-bound-exceeded", candidate);
  if (connections.length > ATLAS_BOUNDED_MAX_CONNECTIONS) return decision(false, "connection-bound-exceeded", candidate);
  if (candidate.devices !== resources.length || candidate.links !== connections.length) {
    return decision(false, "preview-count-mismatch", candidate);
  }
  const resourceIds = new Set(resources.map(resource => resource?.id));
  if (resourceIds.size !== resources.length || [...resourceIds].some(id => typeof id !== "string" || id.length === 0)) {
    return decision(false, "resource-identity-invalid", candidate);
  }
  const connectionIds = new Set(connections.map(connection => connection?.id));
  if (connectionIds.size !== connections.length || [...connectionIds].some(id => typeof id !== "string" || id.length === 0)) {
    return decision(false, "connection-identity-invalid", candidate);
  }
  const resourceById = new Map(resources.map(resource => [resource.id, resource]));
  if (connections.some(connection => !resourceById.has(connection?.from?.resource) ||
      !resourceById.has(connection?.to?.resource) ||
      !endpointPortIsDeclared(resourceById, connection.from) ||
      !endpointPortIsDeclared(resourceById, connection.to))) {
    return decision(false, "endpoint-not-source-declared", candidate);
  }
  if (candidate.diagnostics?.some(diagnostic => diagnostic?.severity === "error")) {
    return decision(false, "preview-has-errors", candidate);
  }
  return decision(true, "validated-bounded-xlsx", candidate, {
    maxResources: ATLAS_BOUNDED_MAX_RESOURCES,
    maxConnections: ATLAS_BOUNDED_MAX_CONNECTIONS,
  });
}
