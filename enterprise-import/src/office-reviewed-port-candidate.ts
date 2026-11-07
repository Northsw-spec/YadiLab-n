import type { ScenarioSource, Scenariosourceresource } from "../../core-model/src/generated/contracts.js";
import { EnterpriseImportError } from "./types.js";
import { previewDocxTableStructure, type DocxTableCellLocator } from "./docx-tables-structural-preview.js";
import { previewOdtTableStructure, type OdtCellLocator } from "./odt-tables-structural-preview.js";
import { discloseReviewedDocxCell } from "./docx-cell-disclosure.js";
import { discloseReviewedOdtCell } from "./odt-cell-disclosure.js";
import {
  mapReviewedOfficeOriginalToConnections,
  type OfficeReviewedConnectionsCandidate,
  type OfficeReviewedConnectionsDecision,
} from "./office-reviewed-connection-candidate.js";
import { OFFICE_REVIEWED_NODES_PROFILE, type OfficeOriginalLocator } from "./office-reviewed-node-candidate.js";

/**
 * IC-040 P3: canonical source-row PORT pairs are selected independently.
 * No source text can be inferred from headings/roles/proximity/IP addresses.
 * Portless P2 remains a separate, backward-compatible reviewed pathway.
 */
export interface OfficeReviewedPortSelection {
  readonly connectionIndex: number;
  readonly sourcePortCellOrdinal: number;
  readonly peerPortCellOrdinal: number;
  readonly acknowledgeSourcePortCell: boolean;
  readonly acknowledgePeerPortCell: boolean;
}
export interface OfficeReviewedPortsDecision extends OfficeReviewedConnectionsDecision {
  readonly portSelections: readonly OfficeReviewedPortSelection[];
  readonly acknowledgeModeledPorts: boolean;
}
export interface OfficeReviewedPortOrigin {
  readonly targetLinkId: string;
  readonly sourceNodeId: string;
  readonly peerNodeId: string;
  readonly sourcePortLocator: OfficeOriginalLocator;
  readonly peerPortLocator: OfficeOriginalLocator;
  readonly decision: "USER_CONSENTED_ORIGINAL_ENDPOINT_PORT_CELLS";
}
export interface OfficeReviewedPortsCandidate extends OfficeReviewedConnectionsCandidate {
  readonly selectedPorts: number;
  readonly portOrigins: readonly OfficeReviewedPortOrigin[];
}
const VALID_SHA = /^[0-9a-f]{64}$/;
const ID = /^[a-z][a-z0-9_-]{0,63}$/;
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const exact = (value: unknown, keys: readonly string[]) =>
  !!value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
function blocked(sha: string, code: string): OfficeReviewedPortsCandidate {
  return {
    status: "BLOCKED", profileId: OFFICE_REVIEWED_NODES_PROFILE,
    sourceSha256: sha, selectedResources: 0, selectedConnections: 0,
    selectedPorts: 0, origins: [], connectionOrigins: [], portOrigins: [],
    canActivate: false, engineVerified: false, physicalTopologyVerified: false,
    diagnostics: [{code}],
  };
}
export async function mapReviewedOfficeOriginalToPorts(
  original: Uint8Array,
  decision: OfficeReviewedPortsDecision,
): Promise<OfficeReviewedPortsCandidate> {
  const sha = typeof decision?.sourceSha256 === "string" &&
    VALID_SHA.test(decision.sourceSha256) ? decision.sourceSha256 : "";
  if (!(original instanceof Uint8Array) ||
      !exact(decision, [
        "format", "sourceSha256", "nodes", "acknowledgeModeledResources",
        "connections", "acknowledgeModeledConnections",
        "portSelections", "acknowledgeModeledPorts",
      ]) || (decision.format !== "docx" && decision.format !== "odt") ||
      !sha || decision.acknowledgeModeledPorts !== true ||
      !Array.isArray(decision.connections) ||
      !Array.isArray(decision.nodes) ||
      !Array.isArray(decision.portSelections) ||
      decision.portSelections.length < 1 ||
      decision.portSelections.length > 4) {
    return blocked(sha, "IC040_P3_DECISION_INVALID");
  }
  if (decision.portSelections.length !== decision.connections.length)
    return blocked(sha, "IC040_P3_PORT_DECISION_INVALID");
  const seen = new Set<number>();
  for (const selection of decision.portSelections) {
    if (!exact(selection, [
      "connectionIndex", "sourcePortCellOrdinal", "peerPortCellOrdinal",
      "acknowledgeSourcePortCell", "acknowledgePeerPortCell",
    ]) || !integer(selection.connectionIndex) ||
        !integer(selection.sourcePortCellOrdinal) ||
        !integer(selection.peerPortCellOrdinal) ||
        selection.connectionIndex >= decision.connections.length ||
        selection.sourcePortCellOrdinal >= 4 ||
        selection.peerPortCellOrdinal >= 4 ||
        selection.sourcePortCellOrdinal === selection.peerPortCellOrdinal ||
        selection.acknowledgeSourcePortCell !== true ||
        selection.acknowledgePeerPortCell !== true ||
        seen.has(selection.connectionIndex)) {
      return blocked(sha, "IC040_P3_PORT_DECISION_INVALID");
    }
    seen.add(selection.connectionIndex);
  }
  if (seen.size !== decision.connections.length) {
    return blocked(sha, "IC040_P3_PORT_DECISION_INVALID");
  }
  const legacy: OfficeReviewedConnectionsDecision = {
    format: decision.format, sourceSha256: sha,
    nodes: decision.nodes, acknowledgeModeledResources: decision.acknowledgeModeledResources,
    connections: decision.connections, acknowledgeModeledConnections: decision.acknowledgeModeledConnections,
  };
  try {
    const base = await mapReviewedOfficeOriginalToConnections(original, legacy);
    if (base.status !== "READY_FOR_COMPILATION" || !base.source) {
      return blocked(sha, base.diagnostics[0]?.code ?? "IC040_P3_SOURCE_BLOCKED");
    }
    const preview = decision.format === "docx" ?
      await previewDocxTableStructure(original) :
      await previewOdtTableStructure(original);
    if (preview.sourceSha256 !== sha) return blocked(sha, "IC040_P3_SOURCE_CHANGED");

    const perNode = new Map<string, Set<string>>();
    const byLink = new Map<number, {source: string; peer: string}>();
    const origins: OfficeReviewedPortOrigin[] = [];
    const usedCells = new Set<string>();
    for (const selected of decision.portSelections) {
      const link = decision.connections[selected.connectionIndex]!;
      const node = decision.nodes[link.fromNodeIndex]!;
      if (!node ||
          selected.sourcePortCellOrdinal === node.nodeIdCellOrdinal ||
          selected.peerPortCellOrdinal === node.nodeIdCellOrdinal ||
          selected.sourcePortCellOrdinal === link.peerCellOrdinal ||
          selected.peerPortCellOrdinal === link.peerCellOrdinal) {
        return blocked(sha, "IC040_P3_PORT_DECISION_INVALID");
      }
      const prefix = node.tableOrdinal + ":" + node.rowOrdinal + ":";
      const one = prefix + selected.sourcePortCellOrdinal;
      const two = prefix + selected.peerPortCellOrdinal;
      if (usedCells.has(one) || usedCells.has(two))
        return blocked(sha, "IC040_P3_PORT_DECISION_INVALID");
      usedCells.add(one); usedCells.add(two);
      const row = preview.tables[node.tableOrdinal]?.rows[node.rowOrdinal];
      const sourceCell = row?.cells[selected.sourcePortCellOrdinal];
      const peerCell = row?.cells[selected.peerPortCellOrdinal];
      if (!sourceCell || !peerCell)
        return blocked(sha, "IC040_P3_PORT_CELL_NOT_FOUND");
      const exposedSource = decision.format === "docx" ?
        await discloseReviewedDocxCell(original, sha, sourceCell.locator as DocxTableCellLocator, true) :
        await discloseReviewedOdtCell(original, sha, sourceCell.locator as OdtCellLocator, true);
      const exposedPeer = decision.format === "docx" ?
        await discloseReviewedDocxCell(original, sha, peerCell.locator as DocxTableCellLocator, true) :
        await discloseReviewedOdtCell(original, sha, peerCell.locator as OdtCellLocator, true);
      if (exposedSource.sourceSha256 !== sha || exposedPeer.sourceSha256 !== sha)
        return blocked(sha, "IC040_P3_SOURCE_CHANGED");
      const sourcePort = exposedSource.text;
      const peerPort = exposedPeer.text;
      if (!ID.test(sourcePort) || !ID.test(peerPort))
        return blocked(sha, "IC040_P3_PORT_INVALID");
      const selectedConnection = base.source.connections[selected.connectionIndex]!;
      const endpointA = selectedConnection.from.resource;
      const endpointB = selectedConnection.to.resource;
      for (const [id, port] of [[endpointA, sourcePort], [endpointB, peerPort]] as const) {
        const ports = perNode.get(id) ?? new Set<string>();
        if (ports.has(port)) return blocked(sha, "IC040_P3_PORT_REUSED");
        ports.add(port); perNode.set(id, ports);
      }
      byLink.set(selected.connectionIndex, {source: sourcePort, peer: peerPort});
      origins.push({
        targetLinkId: selectedConnection.id, sourceNodeId: endpointA, peerNodeId: endpointB,
        sourcePortLocator: Object.freeze({...exposedSource.locator}),
        peerPortLocator: Object.freeze({...exposedPeer.locator}),
        decision: "USER_CONSENTED_ORIGINAL_ENDPOINT_PORT_CELLS",
      });
    }
    const resources: Scenariosourceresource[] = base.source.resources.map(resource => ({
      ...resource,
      ...(perNode.has(resource.id) ? {interfaces: [
        ...(resource.interfaces ?? []),
        ...[...perNode.get(resource.id)!].sort().map(id=>({id})),
      ]} : {}),
    }));
    const connections = base.source.connections.map((link,index) => {
      const pair = byLink.get(index)!;
      return {...link, from: {...link.from, port: pair.source},
        to: {...link.to, port: pair.peer}};
    });
    const source: ScenarioSource = {
      ...base.source, resources, connections,
      notes: (base.source.notes ?? []).map(note=>note.id==="office_source_boundary"
        ? {...note, text:"Source SHA-256: "+sha+"; "+base.selectedResources+
          " separately consented original node IDs, "+base.selectedConnections+
          " reviewed peer links and "+(origins.length*2)+
          " independently disclosed endpoint interface IDs. Ports are MODELED from "+
          "original cells only, not verified physical cables; no IP, MAC, VLAN, "+
          "route, reachability or Engine/Runtime PASS was inferred."}
        : note),
    };
    return {...base, source, selectedPorts: origins.length*2,
      portOrigins: Object.freeze(origins)};
  } catch (error) {
    const code = error instanceof EnterpriseImportError &&
      /^(?:DOCX_|ODT_|IMPORT_|IC040_)[A-Z0-9_]+$/.test(error.code)
      ? error.code : "IC040_P3_SOURCE_BLOCKED";
    return blocked(sha, code);
  }
}
