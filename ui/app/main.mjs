/**
 * YadiLab — original project source.
 * Copyright © 2026 Daniel Ölund. All rights reserved.
 * Original author and copyright holder: Daniel Ölund.
 * No license is granted for commercial use, redistribution, or creation of
 * derivative works without prior written permission.
 * Third-party components retain their separate licenses; see THIRD_PARTY_NOTICES.md.
 */

import { UdpIcmpFailureXRay } from "./udp-icmp-xray.mjs";
import { modeledTcpProbeInterpretation } from "./tcp-probe-interpretation.mjs";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ProjectFileControls } from "./project-file-controls.mjs";
import { createPendingBuilderDraftRegistry } from "./builder-draft-guard.mjs";
import { liveCanvasWorkspace, liveBuilderCanvasMutationWorkspace } from "./topology-workspace-guard.mjs";
import { markApplicationReady, markApplicationStopped } from "../src/browser/runtime-readiness.mjs";
import { createRoot } from "react-dom/client";
import {
  Background,
  Controls,
  Handle,
  NodeResizer,
  Position,
  ReactFlow,
  ViewportPortal,
  getBezierPath,
  useStoreApi,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./app.css";
import catalog from "../../catalog/builtin-catalog.json";
import branding from "../../app-config/branding.json";
import releasePackage from "../../package.json";
const releaseIdentity = { version: releasePackage.version, checkpoint: releasePackage.yadilabRelease.checkpoint, description: releasePackage.yadilabRelease.description, sourceCommit: __YADILAB_SOURCE_COMMIT__ };
import welcomeScenario from "./welcome-scenario.json";
import { enterpriseOfficeScenarios, enterpriseScenarioById } from "./enterprise-office-scenario.mjs";
import { verifiedDeliveryExplanation, verifiedDeliveryProbePresets, verifiedDeliveryScenarioById, verifiedDeliveryScenarios } from "./verified-delivery-scenarios.mjs";
import curriculumManifest from "../../curriculum/builtin/wave1-manifest.json";
import guidedWinGateway from "../../curriculum/builtin/wave1/windows-gateway.json";
import guidedWinDns from "../../curriculum/builtin/wave1/windows-dns.json";
import guidedWinFirewall from "../../curriculum/builtin/wave1/windows-firewall.json";
import guidedWinRdp from "../../curriculum/builtin/wave1/windows-rdp.json";
import guidedLinuxGateway from "../../curriculum/builtin/wave1/linux-gateway.json";
import guidedLinuxDns from "../../curriculum/builtin/wave1/linux-dns.json";
import guidedLinuxFirewall from "../../curriculum/builtin/wave1/linux-firewall.json";
import guidedLinuxSsh from "../../curriculum/builtin/wave1/linux-ssh.json";
import guidedLinuxLayeredSsh from "../../curriculum/builtin/wave1/linux-layered-ssh.json";
import defaultEnterpriseMapping from "../../examples/enterprise-import/enterprise-import-template.mapping.json";
import { previewNetworkTopologyFile, verifyNetworkTopologyOriginalForActivation } from "../src/browser/network-topology-import.js";
import { compareCoreNetworkReimport } from "../src/browser/core-network-reimport-review.js";
import { savedCoreReimportReportText, readSavedCoreReimportReport, matchSavedCoreReimportReport } from "../src/browser/core-network-reimport-saved-report.js";
import { previewGraphmlFileReadOnly, verifyGraphmlOriginalForReviewedActivation } from "../src/browser/graphml-import-preview.js";
import { inspectSharedDocumentFileReadOnly } from "../src/browser/structured-document-inspection-file.js";
import { reviewSharedStaticHostOriginalReference } from "../src/browser/shared-ansible-original-reference.js";
import { StructuredXmlInspectionPanel } from "./structured-xml-inspection-panel.mjs";
import { mapReviewedGraphmlToBuilder, GRAPHML_MANUAL_ROLE_OPTIONS } from "../../enterprise-import/src/graphml-review-mapping.js";
import { GraphmlReadOnlyPanel } from "./graphml-preview-panel.mjs";
import { previewNmapXmlFileReadOnly } from "../src/browser/nmap-xml-file-preview.js";
import { replayNmapSavedReportFiles } from "../src/browser/nmap-report-replay-file.js";
import { NmapSavedReferenceReplayPanel } from "./nmap-reference-replay-panel.mjs";
import { reviewNmapOriginalFileAssociations } from "../src/browser/nmap-association-file.js";
import { NmapObservationPanel } from "./nmap-observation-panel.mjs";
import { NessusSeverityPanel } from "./nessus-severity-panel.mjs";
import { DrawioStructurePanel } from "./drawio-structure-panel.mjs";
import { DrawioReviewedBuilderPanel } from "./drawio-reviewed-builder-panel.mjs";
import { previewDrawioCandidateFile, verifyDrawioOriginalForReviewedActivation } from "../src/browser/drawio-reviewed-candidate-file.js";
import { mapReviewedDrawioOriginalToBuilder } from "../../enterprise-import/src/drawio-reviewed-candidate.js";
import { DrawioSavedReferenceReplayPanel } from "./drawio-reference-replay-panel.mjs";
import { replayDrawioSavedReportFiles } from "../src/browser/drawio-report-replay-file.js";
import { previewDrawioFileReadOnly } from "../src/browser/drawio-file-preview.js";
import { reviewDrawioOriginalFileReferences } from "../src/browser/drawio-association-file.js";
import { previewNessusFileReadOnly } from "../src/browser/nessus-v2-file-preview.js";
import { reviewNessusOriginalFileAssociations } from "../src/browser/nessus-association-file.js";
import { replayNessusSavedReportFiles } from "../src/browser/nessus-report-replay-file.js";
import { NessusSavedReferenceReplayPanel } from "./nessus-reference-replay-panel.mjs";
import { previewAnsibleYamlFileReadOnly } from "../src/browser/ansible-yaml-file-preview.js";
import { replayAnsibleYamlSavedReportFiles } from "../src/browser/ansible-yaml-report-replay-file.js";
import { AnsibleYamlSavedReferenceReplayPanel } from "./ansible-yaml-reference-replay-panel.mjs";
import { reviewAnsibleYamlOriginalFileAssociations } from "../src/browser/ansible-yaml-association-file.js";
import { AnsibleInventoryPanel } from "./ansible-inventory-panel.mjs";
import { previewAnsibleIniFileReadOnly } from "../src/browser/ansible-ini-file-preview.js";
import { replayAnsibleIniSavedReportFiles } from "../src/browser/ansible-ini-report-replay-file.js";
import { AnsibleIniSavedReferenceReplayPanel } from "./ansible-ini-reference-replay-panel.mjs";
import { reviewAnsibleIniOriginalFileAssociations } from "../src/browser/ansible-ini-association-file.js";
import { AnsibleIniInventoryPanel } from "./ansible-ini-inspection-panel.mjs";
import { previewDocxFileStructure, reviewDocxFileCell } from "../src/browser/docx-file-structural-preview.js";
import { DocxTableStructurePanel } from "./docx-structure-panel.mjs";
import { OfficeReviewedBuilderPanel } from "./office-reviewed-builder-panel.mjs";
import { ScaledOfficeBuilderPanel } from "./scaled-office-builder-panel.mjs";
import { ScaledOfficeThousandBuilderPanel } from "./scaled-office-thousand-builder-panel.mjs";
import { ScaledOfficeFiveThousandBuilderPanel } from "./scaled-office-five-thousand-builder-panel.mjs";
import { ScaledOfficeTenThousandPreflightPanel } from "./scaled-office-ten-thousand-preflight-panel.mjs";
import { ScaledOfficeTenThousandBuilderPanel } from "./scaled-office-ten-thousand-builder-panel.mjs";
import { buildScaledOfficeThousandFocus } from "./scaled-office-thousand-focus.mjs";
import { buildScaledOfficeFiveThousandFocus } from "./scaled-office-five-thousand-focus.mjs";
import { buildScaledNetworkTenThousandFocus } from "./scaled-network-ten-thousand-focus.mjs";
import { buildScaledOfficeTenThousandFocus } from "./scaled-office-ten-thousand-builder-focus.mjs";
import { buildScaledOfficeTenThousandEditedFocus } from "./scaled-office-ten-thousand-edited-focus.mjs";
import { buildScaledXlsxTenThousandEditedFocus } from "./scaled-xlsx-ten-thousand-edited-focus.mjs";
import { buildScaledOdsTenThousandEditedFocus } from "./scaled-ods-ten-thousand-edited-focus.mjs";
import { buildScaledOfficeFiveThousandEditedFocus } from "./scaled-office-five-thousand-edited-focus.mjs";
import { buildScaledOfficeFiveThousandTwoEditedFocus } from "./scaled-office-five-thousand-two-edited-focus.mjs";
import { classifyScaledOfficeFiveThousandView } from "./scaled-office-five-thousand-session-guard.mjs";
import { DeclaredOfficeSiteReviewPanel } from "./scaled-office-declared-site-review-panel.mjs";
import { validateDeclaredOfficeSiteHierarchy } from "./scaled-office-declared-site-hierarchy.mjs";
import { buildDeclaredOfficeHierarchyFocus } from "./scaled-office-declared-hierarchy-focus.mjs";
import { DeclaredOfficeHierarchyNavigation } from "./scaled-office-declared-hierarchy-navigation.mjs";
import { mapReviewedOfficeBatchesToSource, mapReviewedOfficeBatchesV3ToSource } from "../../enterprise-import/src/office-large-reviewed-topology.js";
import { previewDocxTableStructure, SCALE_OFFICE_LARGE_STRUCTURE_PROFILE as DOCX_LARGE_PROFILE, SCALE_OFFICE_S2_STRUCTURE_PROFILE as DOCX_S2_PROFILE, SCALE_OFFICE_S3_STRUCTURE_PROFILE as DOCX_S3_PROFILE } from "../../enterprise-import/src/docx-tables-structural-preview.js";
import { previewOdtTableStructure, SCALE_OFFICE_LARGE_STRUCTURE_PROFILE as ODT_LARGE_PROFILE, SCALE_OFFICE_S2_STRUCTURE_PROFILE as ODT_S2_PROFILE, SCALE_OFFICE_S3_STRUCTURE_PROFILE as ODT_S3_PROFILE } from "../../enterprise-import/src/odt-tables-structural-preview.js";
import { previewOfficeNodesFile, verifyOfficeCandidateFile } from "../src/browser/office-reviewed-nodes-file.js";
import { previewOdtFileStructure, reviewOdtFileCell } from "../src/browser/odt-file-structural-preview.js";
import { OdtStructurePanel } from "./odt-structure-panel.mjs";
import { replaySavedDocxReportFiles } from "../src/browser/docx-report-replay-file.js";
import { DocxReferenceReplayPanel } from "./docx-reference-replay-panel.mjs";
import { OdtReferenceReplayPanel } from "./odt-reference-replay-panel.mjs";
import { replaySavedOdtReportFiles } from "../src/browser/odt-report-replay-file.js";
import { reviewAnsibleIniInventoryAssociations } from "../../enterprise-import/src/ansible-ini-association-review.js";
import { reviewDocxCellAssociation } from "../../enterprise-import/src/docx-association-review.js";
import { reviewOdtCellAssociation } from "../../enterprise-import/src/odt-association-review.js";
import { reviewOdtMultiReferences } from "../../enterprise-import/src/odt-multi-reference-review.js";
import { reviewDocxMultiReferences } from "../../enterprise-import/src/docx-multi-reference-review.js";
import { reviewAnsibleInventoryAssociations } from "../../enterprise-import/src/ansible-association-review.js";
import { reviewNmapObservationAssociations } from "../../enterprise-import/src/nmap-association-review.js";
import networkFaultPack from "../../fault-packs/builtin/network-core.json";
import windowsFaultPack from "../../fault-packs/builtin/windows-core.json";
import linuxFaultPack from "../../fault-packs/builtin/linux-core.json";
import { buildTroubleshootingSummary, createTroubleshootingSummaryDownload, troubleshootingSummaryStatusLabel } from "../src/browser/troubleshooting-summary.js";
import { buildNextBestCheck } from "../src/browser/next-check.js";

const builtinFaultPacks = [networkFaultPack, windowsFaultPack, linuxFaultPack];
const builtinFaultPackLabels = {
  "foundation.network.core": "Network core",
  "foundation.os.windows": "Windows",
  "foundation.os.linux": "Linux",
};
import {
  autoLayoutBuilder,
  buildBuilderViewModel,
  buildRuntimeViewModel,
  compileBuilderWorkspace,
  createBuilderWorkspace,
  createScenarioDraftWorkspace,
  canonicalScenarioDraftId,
  createScenarioSourceDownload,
  previewRuntime,
  readScenarioSourceFile,
  openRuntimePackage,
  buildBuilderPackageExport,
  resetRuntime,
  setBuilderSelection,
  setLayoutOverride,
  setRuntimeSelection,
  applyRuntimeOperation,
  createProgressDownload,
  loadRuntimeProgressFile,
  IndexedDbProgressStore,
  autosaveRuntimeProgress,
  restoreAutosavedRuntimeProgress,
  clearAutosavedRuntimeProgress,
  IndexedDbTroubleshootingSessionStore,
  autosaveTroubleshootingSession,
  restoreAutosavedTroubleshootingSession,
  clearAutosavedTroubleshootingSession,
  createTroubleshootingSessionDownload,
  loadTroubleshootingSessionFile,
  undoRuntime,
  redoRuntime,
  createRuntimeCheckpoint,
  restoreRuntimeCheckpoint,
  buildRuntimeDetailModel,
  buildBuilderInspectorModel,
  applyMissionInspector,
  applyZoneInspector,
  applyResourceInspector,
  applyConnectionInspector,
  createZoneFromInspector,
  createResourceFromInspector,
  createConnectionFromInspector,
  duplicateSelectedBuilderResource,
  deleteSelectedBuilderObject,
  ZONE_KINDS,
  CONNECTION_KINDS,
  buildBuilderAuthoringModel,
  applyTestsAuthoring,
  applyFindingsAuthoring,
  applyObjectivesAuthoring,
  applyTroubleshootingObjectivesAuthoring,
  applyHintsAuthoring,
  applyNotesAuthoring,
  applyCompletionAuthoring,
  applyCanonicalSolutionAuthoring,
  applyBuilderCanvasSelection,
  resizeBuilderZone,
  createBuilderConnectionFromCanvas,
  BUILDER_ZONE_RESIZE_LIMITS,
  buildBuilderAssetLibraryModel,
  applyAssetToSelectedResource,
  configurationSummary,
  emptyImportWorkbench,
  parseScenarioImport,
  previewScenarioImport,
  compileScenarioImport,
  activateScenarioImport,
  clearAssetFromSelectedResource,
  readEnterpriseImportFile,
  readEnterpriseMappingProfileFile,
  reviewEnterpriseImport,
  applyImportHelperMappingDecisions,
  importEnterpriseBaseline,
  previewEnterpriseReimport,
  planImportHelperMerge,
  applyImportHelperMerge,
  nextMappingProfileVersion,
  findEntityConflictCandidates,
  projectImportHelperBaseline,
  buildFaultDefinitionViews,
  createBuilderFaultDraft,
  previewFaultUi,
  previewBuilderFaultDraft,
  injectFaultIntoRuntime,
  injectBuilderFaultDraft,
  rollbackRuntimeFaultUi,
  materializeBuilderFaultVariant,
  previewGeneratedBuilderFaultVariant,
  materializeGeneratedBuilderFaultVariant,
  buildRuntimeObservationModel,
  runRuntimeObservation,
  buildRuntimeActiveProbeModel,
  runRuntimeActiveProbe,
  captureRuntimeObservationEvidence,
  captureRuntimeActiveProbeEvidence,
  addRuntimeTroubleshootingNote,
  createTroubleshootingNotebookDownload,
  loadTroubleshootingNotebookFile,
  reviewRuntimeTroubleshootingEvidence,
  previewRuntimeTypedRemediation,
  commitRuntimeTypedRemediation,
  runtimeTypedRemediationContext,
  reviewRuntimeRemediation,
  buildGuidedTroubleshootingWorkflow,
  buildGuidedLabCatalog,
  cloneGuidedLabSource,
  buildEvidenceWorkspace,
  buildTroubleshootingTimeline,
  createPedagogicalLabContract,
  buildVisualJourneyFromActiveProbe,
  visualJourneyFrame,
  visualJourneyXRayFrame,
  buildModeledObservationTopologyVisual,
  buildModeledNodeStateVisual,
  createTroubleshootingCase,
  addTroubleshootingCaseNote,
  addTroubleshootingBookmark,
  attachCaseRun,
  resetTroubleshootingCase,
  exportTroubleshootingCase,
  compareSelectedRuns,
  createSavedDiagnosticSession,
  exportSavedDiagnosticSession,
  importSavedDiagnosticSession,
  forkExperimentFromCase,
  markExperimentTested,
  resetExperimentBranch,
  discardExperimentBranch,
  generateChangeSet,
  markChangeSetStatus,
  createVerificationSuite,
  runVerificationSuite,
  computeCanonicalSourceIdentity,
  buildVariantMatrix,
  filterVariantMatrix,
  summarizeVariantMatrix,
  selectMatrixResult,
  variantById,
  replaceExperimentWorkingSource,
  createPromotionPreview,
  promoteWithPreview,
  rollbackPromotion,
  computeCaseSourceIdentity,
  createVerifiedBaseline,
  exportVerifiedBaseline,
  reproduceVerifiedBaseline,
  verifyVerifiedBaseline,
  createRegressionCampaign,
  exportRegressionCampaign,
  runRegressionCampaign,
  summarizeRegressionCampaign,
  buildResultTransitionMatrix,
  filterResultTransitionMatrix,
  createCampaignBundle,
  exportCampaignBundle,
  createPromotionVerificationGate,
  createEndpointSet,
  createFlowProfile,
  createNetworkIntentContract,
  exportNetworkIntentContract,
  previewNetworkIntent,
  expandNetworkIntent,
  executeNetworkIntent,
  verifyIntentRunCurrent,
  exportIntentRun,
  buildIntentResultMatrix,
  filterIntentResultMatrix,
  intentMatrixCellCases,
  createIntentBundle,
  exportIntentBundle,
  importIntentBundle,
  previewIntentBundle,
} from "../src/browser/index.ts";
import { toReactFlowProjection } from "../src/canvas/react-flow-adapter.ts";
import { ZONE_HEADER_RESERVED_HEIGHT } from "../../layout/src/geometry-policy.ts";
import { createCompilerSchemaValidator } from "../../validator/src/compiler-adapter.ts";
import { validateContract } from "../../validator/src/index.ts";
import { SafePackageIO, ZipJsArchiveBackend } from "../../package-io/src/index.ts";
import { ElkLayoutBackend } from "../../layout/src/elk-backend.ts";
import { scenarioLaunchStillCurrent } from "./scenario-launch-guard.mjs";
import { ENGINE_VERSION } from "../../engine/src/index.ts";
import { buildTopologyFocusPage, buildTopologySearchIndex, buildTopologySearchIndexFromNetwork, filterTopologyNodes, searchTopologyWithCount } from "../src/canvas/topology-navigation.ts";
import { buildNetworkOverviewProjection } from "../src/canvas/network-overview.ts";
import { buildHierarchicalTopologyIndex, buildHierarchicalTopologyView } from "../src/canvas/hierarchical-topology.ts";
import { createTopologyRequestKey, layoutHierarchicalTopologyView, topologyViewportBucket, TOPOLOGY_LAYOUT_CONFIG_VERSION } from "../src/canvas/topology-elk-adapter.ts";
import { compactNormalTopologyProjection } from "../src/canvas/normal-topology.ts";
import { projectScenarioSubsetToCanvas } from "../src/canvas/projection.ts";
import { atlasPageForResource, buildAtlasIndex, projectAtlasPage } from "../src/canvas/atlas-topology.ts";
import { createTopologyViewportLifecycle } from "../src/canvas/topology-viewport-lifecycle.ts";
import { anchorOrthogonalRoute, orthogonalEdgePath } from "./semantic-edge-routing.mjs";
import { iconDescriptor, iconRegistry } from "../src/canvas/icon-registry.ts";

const e = React.createElement;
const NORMAL_TOPOLOGY_RESOURCE_BUDGET = 200;
const TOPOLOGY_VIEW_MODES = Object.freeze({
  NORMAL: "normal",
  CONNECTED_EXPLORER: "connected-explorer",
  INVENTORY_SUMMARY: "inventory-summary",
  ATLAS: "atlas",
});
const packageIO = new SafePackageIO(
  new ZipJsArchiveBackend(),
  (input) => {
    const result = validateContract("manifest", input);
    return { valid: result.valid, diagnostics: result.errors.map((error) => `${error.instancePath || "$"}: ${error.message ?? error.keyword}`) };
  },
);
const packageValidator = (kind) => (input) => {
  const result = validateContract(kind, input);
  return { valid: result.valid, diagnostics: result.errors.map((error) => `${error.instancePath || "$"}: ${error.message ?? error.keyword}`) };
};

const compilerOptions = {
  compilerContext: {
    validateSource: createCompilerSchemaValidator("source"),
    validateNormalized: createCompilerSchemaValidator("normalized"),
    catalog: { capabilities: catalog.capabilities, profiles: catalog.profiles, assets: catalog.assets },
    engineBaselineVersion: ENGINE_VERSION,
  },
};

const guidedLabSourceMap = {
  "curriculum/builtin/wave1/windows-gateway.json": guidedWinGateway,
  "curriculum/builtin/wave1/windows-dns.json": guidedWinDns,
  "curriculum/builtin/wave1/windows-firewall.json": guidedWinFirewall,
  "curriculum/builtin/wave1/windows-rdp.json": guidedWinRdp,
  "curriculum/builtin/wave1/linux-gateway.json": guidedLinuxGateway,
  "curriculum/builtin/wave1/linux-dns.json": guidedLinuxDns,
  "curriculum/builtin/wave1/linux-firewall.json": guidedLinuxFirewall,
  "curriculum/builtin/wave1/linux-ssh.json": guidedLinuxSsh,
  "curriculum/builtin/wave1/linux-layered-ssh.json": guidedLinuxLayeredSsh,
};
const guidedLabCatalog = buildGuidedLabCatalog(curriculumManifest, guidedLabSourceMap);
const builtinGuidedLabs = guidedLabCatalog.ok ? guidedLabCatalog.labs : [];

function handlesFor(data) {
  const interfaces = Array.isArray(data?.interfaces) ? data.interfaces : [];
  const visualAttachments = Array.isArray(data?.visualAttachmentHandles) ? data.visualAttachmentHandles : [];
  const activeInterfaces = new Set(Array.isArray(data?.activeInterfaceIds) ? data.activeInterfaceIds : []);
  const result = [
    e(Handle, { key: "generic-in", id: "generic-in", type: "target", position: Position.Left, className: "semantic-handle generic-handle", title: "Semantic attachment", "data-react-flow-handle-id": "generic-in", "data-react-flow-handle-type": "target" }),
    e(Handle, { key: "generic-out", id: "generic-out", type: "source", position: Position.Right, className: "semantic-handle generic-handle", title: "Semantic attachment", "data-react-flow-handle-id": "generic-out", "data-react-flow-handle-type": "source" }),
  ];
  interfaces.forEach((iface, index) => {
    const top = `${20 + ((index + 1) * 60) / (interfaces.length + 1)}%`;
    const active = activeInterfaces.has(iface.interfaceId);
    const title = `${iface.label} · ${iface.stateLabel}${iface.addresses.length ? ` · ${iface.addresses.join(", ")}` : ""}`;
    result.push(e(Handle, { key: iface.targetHandleId, id: iface.targetHandleId, type: "target", position: Position.Left, style: { top }, className: `semantic-handle interface-handle${active ? " active" : ""}`, title, "data-interface-id": iface.interfaceId, "data-interface-state": iface.stateLabel.toLowerCase(), "data-react-flow-handle-id": iface.targetHandleId, "data-react-flow-handle-type": "target" }));
    result.push(e(Handle, { key: iface.sourceHandleId, id: iface.sourceHandleId, type: "source", position: Position.Right, style: { top }, className: `semantic-handle interface-handle${active ? " active" : ""}`, title, "data-interface-id": iface.interfaceId, "data-interface-state": iface.stateLabel.toLowerCase(), "data-react-flow-handle-id": iface.sourceHandleId, "data-react-flow-handle-type": "source" }));
  });
  visualAttachments.forEach((attachment, index) => {
    const top = `${Number.isFinite(attachment.topPercent) ? attachment.topPercent : 20 + ((index + 1) * 60) / (visualAttachments.length + 1)}%`;
    const isSource = attachment.direction === "source";
    result.push(e(Handle, {
      key: attachment.handleId,
      id: attachment.handleId,
      type: isSource ? "source" : "target",
      position: isSource ? Position.Right : Position.Left,
      style: { top },
      className: "semantic-handle visual-attachment-handle",
      title: "Visual attachment · source port NOT DOCUMENTED",
      "data-visual-attachment": "true",
      "data-connection-id": attachment.connectionId,
      "data-react-flow-handle-id": attachment.handleId,
      "data-react-flow-handle-type": isSource ? "source" : "target",
    }));
  });
  return result;
}

function DeviceChassis({ family, active }) {
  const detail = family === "switch"
    ? e("span", { className: "switch-port-bank" }, ...Array.from({ length: 8 }, (_, index) => e("i", { key: index })))
    : family === "firewall"
      ? e("span", { className: "firewall-bricks" }, ...Array.from({ length: 6 }, (_, index) => e("i", { key: index })))
      : family === "server"
        ? e("span", { className: "server-bays" }, ...Array.from({ length: 3 }, (_, index) => e("i", { key: index }, e("b"))))
        : family === "router"
          ? e("span", { className: "router-radial" }, e("i", { className: "router-core" }), ...Array.from({ length: 4 }, (_, index) => e("i", { key: index, className: `router-spoke spoke-${index + 1}` })))
          : family === "client"
            ? e("span", { className: "client-monitor" }, e("i", { className: "client-screen" }), e("i", { className: "client-stand" }))
            : family === "hypervisor"
              ? e("span", { className: "hypervisor-stack" }, ...Array.from({ length: 3 }, (_, index) => e("i", { key: index })))
              : family === "actor"
                ? e("span", { className: "actor-shape" }, e("i", { className: "actor-head" }), e("i", { className: "actor-body" }))
                : e("span", { className: "generic-shape" });
  return e("span", { className: `device-chassis chassis-${family}`, "aria-hidden": "true", "data-device-activity": active ? "active" : "idle" },
    detail,
    e("i", { className: `device-activity-led${active ? " active" : ""}` }));
}

function SemanticIcon({ iconKey = "unknown-resource", label, className = "" }) {
  const icon = iconDescriptor(iconKey);
  return e("span", { className: `semantic-icon semantic-icon-${icon.className} ${className}`.trim(), "data-icon-key": icon.key, "data-icon-class": icon.className, title: label ?? icon.title, "aria-label": label ?? icon.accessibleName, role: "img" },
    e("svg", { viewBox: icon.viewBox, width: 22, height: 22, focusable: "false", "aria-hidden": "true" }, e("path", { d: icon.path })));
}

function ResourceNode({ data, selected }) {
  if (data.overviewGroup) {
    const members = Array.isArray(data.overviewMembers) ? data.overviewMembers : [];
    return e("div", {
      className: `overview-group-node${selected ? " selected" : ""}`,
      "data-overview-group": data.overviewGroupId ?? "true",
      "data-overview-role": data.overviewRole ?? "documented-type",
      title: members.join("\n"),
    },
      e(Handle, { key: "overview-in", id: "overview-in", type: "target", position: Position.Top, className: "overview-handle overview-handle-in", title: "Visual summary input", "data-overview-handle": "in" }),
      e(Handle, { key: "overview-out", id: "overview-out", type: "source", position: Position.Bottom, className: "overview-handle overview-handle-out", title: "Visual summary output", "data-overview-handle": "out" }),
      e(SemanticIcon, { iconKey: "presentation-group", label: "Visningsgrupp" }),
      e("strong", null, data.label ?? data.overviewGroupId),
      e("span", { className: "overview-group-role" }, data.deviceRoleLabel ?? "DOCUMENTED TYPE · NEUTRAL VIEW"),
      e("span", { className: "overview-group-summary" }, data.overviewSummary ?? "Visual summary of declared source data; not a physical link or resource."),
      e("small", null, members.length ? `${members.length} source IDs · click to open a real device` : "No source members"),
    );
  }
  const family = data.deviceFamily ?? "generic";
  const modeledStateFocus = Boolean(data.modeledStateFocus);
  const active = modeledStateFocus || ["current", "arrived", "dropped", "uncertain", "no_path"].includes(data.journeyState) || (data.activeInterfaceIds?.length ?? 0) > 0;
  const hierarchyVisual = data.hierarchyVisual === true;
  const connectionState = hierarchyVisual ? (data.connectionState ?? "SOURCE_ISOLATED") : undefined;
  const boundaryCount = Number(data.boundaryConnectionCount ?? 0);
  const atlasBoundaryReferences = Array.isArray(data.atlasBoundaryReferences) ? data.atlasBoundaryReferences : [];
  const visibleConnectionCount = Number(data.visibleConnectionCount ?? 0);
  const omittedConnectionCount = Number(data.omittedConnectionCount ?? 0);
  const isProxmox = String(data.resourceType ?? "").toLowerCase().includes("proxmox") || String(data.vendor ?? "").toLowerCase().includes("proxmox") || String(data.product ?? "").toLowerCase().includes("proxmox");
  const interfaces = Array.isArray(data.interfaces) ? data.interfaces : [];
  const semanticBadges = Array.isArray(data.semanticBadges) ? data.semanticBadges : [];
  const icon = iconDescriptor(data.iconKey ?? "unknown-resource");
  return e("div", { className: `resource-node device-${family}${hierarchyVisual ? ` topology-connection-${connectionState.toLowerCase()}` : ""}${isProxmox ? " device-proxmox" : ""}${modeledStateFocus ? " modeled-state-focus" : ""}${selected ? " selected" : ""}${data.journeyState && data.journeyState !== "idle" ? ` journey-node-${data.journeyState}` : ""}`, onDoubleClick: data.onDoubleClick, "data-journey-node-state": data.journeyState ?? "idle", "data-journey-outcome-marker": data.journeyOutcomeMarker ?? "none", "data-modeled-state-focus": modeledStateFocus ? "true" : "false", "data-device-family": family, "data-device-role": isProxmox ? "proxmox" : family, ...(hierarchyVisual ? { "data-topology-connection-state": connectionState, "data-topology-visible-links": String(visibleConnectionCount), "data-topology-boundary-links": String(boundaryCount), "data-topology-omitted-links": String(omittedConnectionCount), ...(data.presentationGroupId ? { "data-topology-presentation-group": data.presentationGroupId } : {}) } : {}), ...(data.atlasPageId ? { "data-atlas-page-id": data.atlasPageId, "data-atlas-boundary-count": String(atlasBoundaryReferences.length) } : {}) },
    ...handlesFor(data),
    e("div", { className: "device-heading" },
      e("div", { className: "device-icon-stack" }, e(SemanticIcon, { iconKey: icon.key, label: data.iconAccessibleName ?? icon.accessibleName }), e(DeviceChassis, { family, active })),
      e("span", { className: "device-identity" },
        e("strong", null, data.label ?? data.semanticId),
        e("small", null, data.deviceRoleLabel ?? data.resourceType ?? "Resource"),
        data.vendor ? e("small", { className: "device-vendor" }, `${data.vendor}${data.product ? ` · ${data.product}` : ""}`) : null,
        ...semanticBadges.map((badge) => e("span", { key: badge, className: "semantic-badge", "data-semantic-badge": badge }, badge)))),
    data.asset ? e("img", { className: "resource-asset", src: `./${data.asset.path}`, alt: "", "aria-hidden": "true", draggable: false }) : null,
    interfaces.length ? e("div", { className: "resource-port-strip", "aria-label": "Declared interfaces" },
      ...interfaces.slice(0, 3).map((iface) => e("span", { key: iface.interfaceId, className: `compact-port${data.activeInterfaceIds?.includes(iface.interfaceId) ? " active" : ""}`, title: `${iface.label}${iface.addresses.length ? ` · ${iface.addresses.join(", ")}` : ""}`, "data-port-state": "declared" },
        e("i", { "aria-hidden": "true" }), e("b", null, iface.label), e("small", null, iface.addresses[0] ?? "DECLARED"))),
      interfaces.length > 3 ? e("span", { className: "compact-port more-ports" }, `+${interfaces.length - 3}`) : null)
      : e("span", { className: "ports-not-modeled" }, "PORTS NOT MODELED"),
    hierarchyVisual ? e("span", { className: `topology-connection-badge topology-connection-badge-${connectionState.toLowerCase()}`, "data-topology-connection-badge": connectionState }, connectionState === "CONNECTED"
      ? `${visibleConnectionCount} connected`
      : connectionState === "BOUNDARY_CONNECTED"
        ? `${boundaryCount} outside current view`
        : connectionState === "INCOMPLETE_VIEW"
          ? `${omittedConnectionCount} links omitted — view incomplete`
          : "Source isolated") : null,
    hierarchyVisual && boundaryCount > 0 ? e("span", { className: "topology-boundary-badge", "data-topology-boundary-indicator": "true" }, `${boundaryCount} boundary link${boundaryCount === 1 ? "" : "s"}`) : null,
    data.atlasPageId && atlasBoundaryReferences.length > 0 ? e("span", { className: "atlas-boundary-badge", "data-atlas-boundary-indicator": "true" }, `${atlasBoundaryReferences.length} fortsättningslänk${atlasBoundaryReferences.length === 1 ? "" : "ar"}`) : null,
    data.journeyState && data.journeyState !== "idle" ? e("span", { className: `journey-node-badge ${data.journeyState}`, "aria-hidden": "true" }, data.journeyState === "current" ? "●" : data.journeyState === "source" ? "▶" : data.journeyState === "destination" ? "◎" : data.journeyState === "uncertain" ? "?" : "●") : null,
  );
}

function ZoneNode({ data, selected }) {
  const presentationOnly = data.presentationOnly === true;
  const members = Array.isArray(data.memberIds) ? data.memberIds : [];
  return e("div", { className: `zone-node zone-${data.zoneKind ?? "custom"}${presentationOnly ? " navigation-group-node" : ""}${selected ? " selected" : ""}`, "data-zone-kind": data.zoneKind ?? "custom", "data-navigation-group": presentationOnly ? "true" : undefined, "data-navigation-group-kind": data.navigationGroupKind, "data-navigation-group-members": members.join(",") },
    data.builderEditable ? e(NodeResizer, {
      isVisible: selected,
      minWidth: BUILDER_ZONE_RESIZE_LIMITS.minWidth,
      minHeight: BUILDER_ZONE_RESIZE_LIMITS.minHeight,
      onResizeEnd: (_event, params) => data.onResizeEnd?.(params),
    }) : null,
    e("div", { className: "zone-heading" }, presentationOnly ? e(SemanticIcon, { iconKey: "presentation-group", label: "Visningsgrupp" }) : e(SemanticIcon, { iconKey: "place", label: "Dokumenterad zon" }), e("i", { className: "zone-status", "aria-hidden": "true" }), e("span", null,
      e("strong", null, data.label ?? data.semanticId),
      e("small", null, presentationOnly ? `${data.navigationGroupKind ?? "derived-navigation"} · ${members.length} devices` : (data.zoneKind ?? "zone")))),
  );
}

const nodeTypes = { resource: ResourceNode, zone: ZoneNode };

function JourneyPacket({ mode, motionPath, duration, source, target }) {
  const [motionReady, setMotionReady] = useState(false);
  useEffect(() => {
    setMotionReady(false);
    let firstFrame;
    let secondFrame;
    const reveal = () => {
      secondFrame = globalThis.requestAnimationFrame?.(() => setMotionReady(true));
      if (secondFrame === undefined) setMotionReady(true);
    };
    firstFrame = globalThis.requestAnimationFrame?.(reveal);
    if (firstFrame === undefined) globalThis.setTimeout(reveal, 0);
    return () => {
      if (firstFrame !== undefined) globalThis.cancelAnimationFrame?.(firstFrame);
      if (secondFrame !== undefined) globalThis.cancelAnimationFrame?.(secondFrame);
    };
  }, [mode, motionPath, source, target]);
  const attrs = {
    className: mode === "particle" ? "journey-particle" : "journey-pdu",
    "aria-hidden": "true",
    "data-journey-packet": "true",
    "data-journey-packet-geometry": "resolved",
    "data-journey-packet-source": source,
    "data-journey-packet-target": target,
    style: { visibility: motionReady ? "visible" : "hidden" },
  };
  return mode === "particle"
    ? e("g", attrs, e("circle", { cx: 0, cy: 0, r: 6 }), e("animateMotion", { dur: duration, repeatCount: "indefinite", path: motionPath }))
    : e("g", attrs,
      e("rect", { x: -12, y: -8, width: 24, height: 16, rx: 3 }),
      e("path", { d: "M -10 -6 L 0 1 L 10 -6 M -10 6 L -2 0 M 10 6 L 2 0" }),
      e("animateMotion", { dur: duration, repeatCount: "indefinite", path: motionPath }),
    );
}

function SemanticJourneyEdge({ id, source, target, sourceHandleId, targetHandleId, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }) {
  const hasRoute = data?.routeKind === "orthogonal" && Array.isArray(data?.route);
  const isHierarchical = data?.hierarchyVisual === true;
  const route = hasRoute ? anchorOrthogonalRoute({ sourceX, sourceY, targetX, targetY, route: data.route, routeOrigin: data?.routeOrigin, sourcePosition, targetPosition }) : [];
  // The route is computed from source geometry, then anchored to the actual
  // live React Flow handles. Hierarchical edges never discard bends for a
  // shared fallback corridor and never fall back to a Bezier path.
  const [basePath, labelX, labelY] = hasRoute
    ? orthogonalEdgePath({ sourceX, sourceY, targetX, targetY, route, routeOrigin: data?.routeOrigin, sourcePosition, targetPosition })
    : isHierarchical
      ? orthogonalEdgePath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
      : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const journey = data?.journey;
  const journeyEndpoint = data?.journeyEndpoint;
  const endpoint = (resourceId, fallbackX, fallbackY) => resourceId === journeyEndpoint?.resourceId
    ? { x: journeyEndpoint.x, y: journeyEndpoint.y }
    : { x: fallbackX, y: fallbackY };
  const motionSource = endpoint(source, sourceX, sourceY);
  const motionTarget = endpoint(target, targetX, targetY);
  const pathComparison = data?.pathComparison;
  const visual = data?.visual ?? { tone: "network", kindLabel: "NETWORK", enabled: true, direction: "unspecified", accessibleLabel: "NETWORK" };
  const reverse = journey?.direction?.from === target && journey?.direction?.to === source;
  const motionPath = reverse
    ? getBezierPath({ sourceX: motionTarget.x, sourceY: motionTarget.y, targetX: motionSource.x, targetY: motionSource.y, sourcePosition: targetPosition, targetPosition: sourcePosition })[0]
    : getBezierPath({ sourceX: motionSource.x, sourceY: motionSource.y, targetX: motionTarget.x, targetY: motionTarget.y, sourcePosition, targetPosition })[0];
  const markerId = `journey-arrow-${String(id).replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const semanticMarkerId = `semantic-arrow-${String(id).replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const comparisonForwardMarkerId = `comparison-forward-arrow-${String(id).replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const comparisonReturnMarkerId = `comparison-return-arrow-${String(id).replace(/[^A-Za-z0-9_-]/g, "_")}`;
  const comparisonPath = (direction) => direction?.from === target && direction?.to === source
    ? getBezierPath({ sourceX: targetX, sourceY: targetY, targetX: sourceX, targetY: sourceY, sourcePosition: targetPosition, targetPosition: sourcePosition })[0]
    : basePath;
  // Playback advances every 900 ms at 1×. Keep a packet segment within that
  // event window so a hop reaches its next Engine-authoritative node before
  // the following decision event replaces it.
  const duration = `${Math.max(.24, .9 / Number(journey?.speed || 1)).toFixed(2)}s`;
  const state = journey?.state ?? "idle";
  const mode = journey?.mode ?? "pulse";
  const active = state === "active";
  const highlighted = active || state === "completed";
  const summaryOnly = data?.summaryOnly === true || data?.properties?.summaryOnly === true;
  const declaredLinkCount = Number(data?.declaredLinkCount ?? data?.properties?.declaredLinkCount ?? 0);
  const motionGeometryResolved = Boolean(data?.journeyGeometryReady)
    && [motionSource.x, motionSource.y, motionTarget.x, motionTarget.y].every((value) => Number.isFinite(value));
  return e(React.Fragment, null,
    e("defs", null,
      e("marker", { id: markerId, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" },
        e("path", { d: "M 0 0 L 10 5 L 0 10 z", className: "journey-arrowhead" })),
      e("marker", { id: semanticMarkerId, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" },
        e("path", { d: "M 0 0 L 10 5 L 0 10 z", className: `semantic-arrowhead tone-${visual.tone}` })),
      e("marker", { id: comparisonForwardMarkerId, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" },
        e("path", { d: "M 0 0 L 10 5 L 0 10 z", className: "path-comparison-arrowhead forward" })),
      e("marker", { id: comparisonReturnMarkerId, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" },
        e("path", { d: "M 0 0 L 10 5 L 0 10 z", className: "path-comparison-arrowhead return" }))),
    e("path", { className: "semantic-edge-hit-area", d: basePath, fill: "none", "aria-hidden": "true", focusable: "false" }),
    e("path", {
      id,
      d: basePath,
      fill: "none",
      markerEnd: visual.direction === "forward" || visual.direction === "bidirectional" ? `url(#${semanticMarkerId})` : undefined,
      markerStart: visual.direction === "reverse" || visual.direction === "bidirectional" ? `url(#${semanticMarkerId})` : undefined,
      className: `react-flow__edge-path semantic-edge tone-${visual.tone}${summaryOnly ? " summary-edge" : ""}${visual.enabled ? "" : " disabled"}${selected ? " selected" : ""}`,
      "data-connection-kind": data?.connectionKind ?? "network",
      // Auditable ACTUAL rendered ReactFlow endpoints. Never infer these from
      // a document label, edge ID, IP, layout order or imported source cache.
      "data-connection-source": source,
      "data-connection-target": target,
      // Actual ReactFlow handle IDs, not guessed from source document text.
      "data-connection-source-port": sourceHandleId?.startsWith("out:") ? sourceHandleId.slice(4) : undefined,
      "data-connection-target-port": targetHandleId?.startsWith("in:") ? targetHandleId.slice(3) : undefined,
      "data-link-enabled": visual.enabled ? "true" : "false",
      "data-link-vlan": visual.vlanLabel ?? "NOT_DOCUMENTED",
      "data-hierarchy-visual": isHierarchical ? "true" : undefined,
      "data-route-kind": hasRoute ? "orthogonal" : isHierarchical ? "orthogonal-fallback" : "bezier",
      "data-route-origin": data?.routeOrigin ?? (hasRoute ? "legacy" : undefined),
      "aria-label": visual.accessibleLabel,
      ...(summaryOnly ? {
        "data-overview-summary-edge": "true",
        "data-overview-declared-links": String(Number.isFinite(declaredLinkCount) ? declaredLinkCount : 0),
        "data-overview-source-hash": String(data?.overviewSourceHash ?? ""),
        "data-overview-summary-label": visual.accessibleLabel,
      } : {}),
    }),
    selected || data?.showEdgeLabel === true ? e("text", { x: labelX, y: labelY - 8, className: `semantic-edge-label tone-${visual.tone}`, textAnchor: "middle" }, visual.accessibleLabel) : null,
    pathComparison?.forward ? e("path", {
      d: comparisonPath(pathComparison.forwardDirection),
      fill: "none",
      markerEnd: `url(#${comparisonForwardMarkerId})`,
      className: `path-comparison-edge forward symmetry-${String(pathComparison.symmetry ?? "UNRESOLVED").toLowerCase()}`,
      "data-path-comparison": "forward",
    }) : null,
    pathComparison?.return ? e("path", {
      d: comparisonPath(pathComparison.returnDirection),
      fill: "none",
      markerEnd: `url(#${comparisonReturnMarkerId})`,
      className: `path-comparison-edge return symmetry-${String(pathComparison.symmetry ?? "UNRESOLVED").toLowerCase()}`,
      "data-path-comparison": "return",
    }) : null,
    e("circle", { cx: sourceX, cy: sourceY, r: active ? 5 : 3.5, className: `link-led source tone-${visual.tone}${active ? " active" : highlighted ? " completed" : ""}`, "data-link-activity": active ? "active" : highlighted ? "completed" : "idle" }),
    e("circle", { cx: targetX, cy: targetY, r: active ? 5 : 3.5, className: `link-led target tone-${visual.tone}${active ? " active" : highlighted ? " completed" : ""}`, "data-link-activity": active ? "active" : highlighted ? "completed" : "idle" }),
    highlighted && (state !== "active" || motionGeometryResolved) ? e("path", {
      d: motionPath,
      fill: "none",
      markerEnd: `url(#${markerId})`,
      className: `journey-edge journey-${state} journey-mode-${mode} journey-truth-${String(journey?.truth ?? "UNKNOWN").toLowerCase()}`,
      "data-journey-connection": id,
      "data-journey-state": state,
      "data-journey-decision": journey?.decisionKind ?? "",
    }) : null,
    active && motionGeometryResolved && (mode === "particle" || mode === "pdu")
      ? e(JourneyPacket, { mode, motionPath, duration, source: reverse ? target : source, target: reverse ? source : target })
      : null,
  );
}

const edgeTypes = { semantic: SemanticJourneyEdge };

function ReactFlowGeometryRepair({ panelRef, nodeIds, revision }) {
  const store = useStoreApi();
  const nodeIdentity = nodeIds.join("|");
  useEffect(() => {
    let firstFrame;
    let secondFrame;
    let retryInterval;
    let refreshCount = 0;
    const refresh = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const nodeElements = new Map([...panel.querySelectorAll(".react-flow__node")]
        .map((element) => [element.getAttribute("data-id"), element])
        .filter(([id]) => id));
      const updates = new Map(nodeIds
        .map((id) => [id, { id, nodeElement: nodeElements.get(id), force: true }])
        .filter(([, update]) => update.nodeElement));
      if (updates.size > 0) {
        if (retryInterval !== undefined) globalThis.clearInterval(retryInterval);
        store.getState().updateNodeInternals(updates);
        const next = store.getState();
        const nodesInitialized = [...next.nodeLookup.values()]
          .filter((node) => !node.hidden)
          .every((node) => node.measured?.width > 0 && node.measured?.height > 0 && node.internals.handleBounds);
        panel.dataset.topologyReactFlowStoreNodeCount = String(next.nodeLookup.size);
        panel.dataset.topologyReactFlowStoreEdgeCount = String(next.edges.length);
        panel.dataset.topologyReactFlowStoreEdgeIds = next.edges.map((edge) => edge.id).sort((left, right) => left.localeCompare(right, "en")).join(",");
        panel.dataset.topologyReactFlowStoreUnmeasuredNodeIds = [...next.nodeLookup.values()]
          .filter((node) => !node.hidden && !(node.measured?.width > 0 && node.measured?.height > 0 && node.internals.handleBounds))
          .map((node) => node.id)
          .sort((left, right) => left.localeCompare(right, "en"))
          .join(",");
        panel.dataset.topologyReactFlowStoreNodesInitialized = String(nodesInitialized);
        // React Flow mutates its internal lookup while measuring. Clone the
        // lookup to publish the geometry change to EdgeRenderer in controlled
        // mode, where no onNodesChange callback is supplied by the app.
        // Publish the current edge set atomically with fresh measured geometry.
        // Never reverse and asynchronously restore a captured edge array: a
        // scheduled restore can overwrite a subsequent imported Builder graph.
        store.setState({
          nodeLookup: new Map(next.nodeLookup),
          nodesInitialized,
          edges: [...next.edges],
        });
      } else if (refreshCount++ >= 30 && retryInterval !== undefined) {
        globalThis.clearInterval(retryInterval);
      }
    };
    refresh();
    retryInterval = globalThis.setInterval(refresh, 100);
    firstFrame = globalThis.requestAnimationFrame?.(() => {
      secondFrame = globalThis.requestAnimationFrame?.(refresh);
    });
    return () => {
      if (firstFrame !== undefined) globalThis.cancelAnimationFrame?.(firstFrame);
      if (secondFrame !== undefined) globalThis.cancelAnimationFrame?.(secondFrame);
      if (retryInterval !== undefined) globalThis.clearInterval(retryInterval);
    };
  }, [panelRef, nodeIdentity, revision, store]);
  return null;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Chromium may not consume the Blob URL until the current event task
  // returns; synchronous revocation can silently cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadJson(descriptor) {
  downloadBlob(new Blob([descriptor.text], { type: descriptor.mime }), descriptor.filename);
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function Topology({ workspace, getWorkspace, projectGeneration, getScenarioTransitionId, getPendingDraftChanges, setWorkspace, setDiagnostics, journey, stateFocus, scaledThousandFocus, onScaledThousandFocusPage, scaledThousandFocusBusy, scaledFiveThousandFocus, onScaledFiveThousandFocusPage, scaledFiveThousandFocusBusy, scaledFiveThousandSessionActive, scaledFiveThousandSafeCompileAttempted, onReviewEditedFiveThousandFocus, scaledTenThousandFocus, scaledTenThousandSessionActive, scaledTenThousandFocusBusy, onScaledTenThousandFocusPage, onReviewEditedTenThousandFocus, declaredOfficeHierarchy, onReviewDeclaredOfficeHierarchy, declaredOfficeFocus, declaredOfficeFocusBusy, onFocusDeclaredOfficeHierarchy, onRestoreDeclaredOfficeHierarchyFocus }) {
  // ReactFlow may deliver an onSelectionChange/pane click or drag callback
  // from a render that predates an inspector Apply, New/Open, or source import.
  // Never publish the closed-over workspace: it may silently restore a stale
  // canonical source and falsely clear the project's unsaved state.
  const liveTopologyWorkspace = () =>
    liveCanvasWorkspace(workspace, getWorkspace(), projectGeneration, getScenarioTransitionId());
  const liveTopologyMutationWorkspace = () =>
    liveBuilderCanvasMutationWorkspace(workspace, getWorkspace(), projectGeneration, getScenarioTransitionId());
  const flowApi = useRef(null);
  const topologyPanelRef = useRef(null);
  const topologyContextMenuRef = useRef(null);
  const topologyViewportRef = useRef(null);
  const topologyResizeFrameRef = useRef(null);
  const topologyInitialFitIdentityRef = useRef("");
  const topologyLifecycleRef = useRef(null);
  if (!topologyLifecycleRef.current) topologyLifecycleRef.current = createTopologyViewportLifecycle();
  const journeyLoopTimerRef = useRef(null);
  const [topologyViewportState, setTopologyViewportState] = useState(() => topologyLifecycleRef.current.snapshot());
  const [topologyGeometryRevision, setTopologyGeometryRevision] = useState(0);
  const [topologyZoom, setTopologyZoom] = useState(1);
  const [topologyQuery, setTopologyQuery] = useState("");
  const [scaledThousandDeviceQuery, setScaledThousandDeviceQuery] = useState("");
  const [scaledFiveThousandDeviceQuery, setScaledFiveThousandDeviceQuery] = useState("");
  const [scaledTenThousandDeviceQuery,setScaledTenThousandDeviceQuery]=useState("");
  const [topologyType, setTopologyType] = useState("");
  const [topologyZone, setTopologyZone] = useState("");
  const [topologyVlan, setTopologyVlan] = useState("");
  const [topologyFocusRoot, setTopologyFocusRoot] = useState(null);
  const [topologyFocusPage, setTopologyFocusPage] = useState(1);
  const [topologyFocusProjection, setTopologyFocusProjection] = useState(null);
  const [topologyHierarchyScope, setTopologyHierarchyScope] = useState(null);
  const [topologyViewMode, setTopologyViewMode] = useState(TOPOLOGY_VIEW_MODES.NORMAL);
  const [atlasPageId, setAtlasPageId] = useState(null);
  const [atlasPageHistory, setAtlasPageHistory] = useState([]);
  const [topologyOverviewReadyIdentity, setTopologyOverviewReadyIdentity] = useState("");
  const [topologyCameraMode, setTopologyCameraMode] = useState("read");
  const topologyFocusRequestRef = useRef(0);
  const topologyLayoutRequestRef = useRef(0);
  const [hierarchicalTopologyLayout, setHierarchicalTopologyLayout] = useState(null);
  const [atlasLayout, setAtlasLayout] = useState(null);
  const atlasLayoutRequestRef = useRef(0);
  const [topologyViewHistory, setTopologyViewHistory] = useState([{ kind: "overview", label: "Nätverksöversikt" }]);
  const [topologyGroup, setTopologyGroup] = useState(null);
  const [topologyGroupQuery, setTopologyGroupQuery] = useState("");
  const [topologyGroupPage, setTopologyGroupPage] = useState(1);
  const [topologyContextMenu, setTopologyContextMenu] = useState(null);
  const [topologyContextDetails, setTopologyContextDetails] = useState(null);
  const [topologyPathFocus, setTopologyPathFocus] = useState(false);
  const [journeyMode, setJourneyMode] = useState("pdu");
  const [journeyCursor, setJourneyCursor] = useState(0);
  const [journeyPlaying, setJourneyPlaying] = useState(false);
  const [journeyLoop, setJourneyLoop] = useState(false);
  const [journeyPlaybackIteration, setJourneyPlaybackIteration] = useState(0);
  const [journeySpeed, setJourneySpeed] = useState(1);
  const [journeyOutcomeMarkerExpiry, setJourneyOutcomeMarkerExpiry] = useState(0);
  const [journeyOutcomeTiming, setJourneyOutcomeTiming] = useState(null);
  const [showSuccessMarker, setShowSuccessMarker] = useState(true);
  const [showDropMarker, setShowDropMarker] = useState(true);
  const reducedMotion = useMemo(() => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true, []);
  const journeyKey = journey ? `${journey.scenarioHash}:${journey.stateRevision}:${journey.playbackIdentity ?? journey.flowId}` : "";
  const canonicalNetwork = useMemo(() => workspace.mode === "builder"
    ? { resources: workspace.source.resources, connections: workspace.source.connections, zones: workspace.source.zones }
    : { resources: workspace.scenario.resources, connections: workspace.scenario.connections, zones: workspace.scenario.zones }, [workspace.mode, workspace.mode === "builder" ? workspace.source : workspace.scenario]);
  const canonicalResourceById = useMemo(() => new Map(canonicalNetwork.resources.map((resource) => [resource.id, resource])), [canonicalNetwork]);
  const canonicalConnectionById = useMemo(() => new Map(canonicalNetwork.connections.map((connection) => [connection.id, connection])), [canonicalNetwork]);
  const sourceIdentity = workspace.mode === "builder" ? `${workspace.sourceRevision}:${workspace.source.scenarioId}` : workspace.scenario.sourceHash;
  const atlasIndex = useMemo(() => {
    try {
      return buildAtlasIndex({
        resources: canonicalNetwork.resources,
        connections: canonicalNetwork.connections,
        zones: canonicalNetwork.zones,
        sourceIdentity,
      }, { version: "atlas-001-v1" });
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [canonicalNetwork, sourceIdentity]);
  const validAtlasIndex = atlasIndex && !atlasIndex.error ? atlasIndex : null;
  const firstAtlasPageId = validAtlasIndex?.pages[0]?.id ?? null;
  const atlasPage = validAtlasIndex?.pageById.get(atlasPageId ?? firstAtlasPageId ?? "") ?? null;
  const atlasPageProjection = useMemo(() => {
    if (topologyViewMode !== TOPOLOGY_VIEW_MODES.ATLAS || !validAtlasIndex || !atlasPage) return null;
    try { return projectAtlasPage(canonicalNetwork, validAtlasIndex, atlasPage.id); }
    catch { return null; }
  }, [canonicalNetwork, topologyViewMode, validAtlasIndex, atlasPage]);
  useEffect(() => {
    const defaultMode = canonicalNetwork.resources.length <= NORMAL_TOPOLOGY_RESOURCE_BUDGET
      ? TOPOLOGY_VIEW_MODES.NORMAL
      : TOPOLOGY_VIEW_MODES.CONNECTED_EXPLORER;
    setTopologyViewMode(defaultMode);
    setAtlasPageId(null);
    setAtlasPageHistory([]);
    setTopologyFocusRoot(null);
    setTopologyFocusPage(1);
    setTopologyFocusProjection(null);
    setTopologyHierarchyScope(null);
    topologyFocusRequestRef.current += 1;
    setTopologyViewHistory([{ kind: "overview", label: "Nätverksöversikt" }]);
    setTopologyCameraMode("read");
    setTopologyGroup(null);
    setTopologyGroupQuery("");
    setTopologyGroupPage(1);
    setTopologyContextMenu(null);
    setTopologyContextDetails(null);
    setTopologyQuery("");
  }, [projectGeneration, getScenarioTransitionId(), sourceIdentity, canonicalNetwork.resources.length]);
  useEffect(() => {
    if (!topologyContextMenu) return undefined;
    const onKeyDown = (event) => { if (event.key === "Escape") setTopologyContextMenu(null); };
    const onPointerDown = (event) => {
      if (!topologyContextMenuRef.current?.contains(event.target)) setTopologyContextMenu(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => { document.removeEventListener("keydown", onKeyDown); document.removeEventListener("pointerdown", onPointerDown); };
  }, [topologyContextMenu]);
  const clearJourneyLoopTimer = () => {
    if (journeyLoopTimerRef.current !== null) globalThis.clearTimeout(journeyLoopTimerRef.current);
    journeyLoopTimerRef.current = null;
  };
  useEffect(() => {
    clearJourneyLoopTimer();
    setJourneyCursor(0);
    setJourneyPlaying(Boolean(journey) && !reducedMotion);
    setJourneyLoop(false);
    setJourneyPlaybackIteration(0);
    setJourneyOutcomeMarkerExpiry(0);
    setJourneyOutcomeTiming(null);
  }, [journeyKey, reducedMotion]);
  useEffect(() => () => clearJourneyLoopTimer(), []);
  useEffect(() => {
    if (!journey || !journeyPlaying || journeyCursor >= journey.events.length - 1) return undefined;
    const timer = globalThis.setTimeout(() => setJourneyCursor((value) => Math.min(value + 1, journey.events.length - 1)), Math.max(180, 900 / journeySpeed));
    return () => globalThis.clearTimeout(timer);
  }, [journeyKey, journey, journeyPlaying, journeyCursor, journeySpeed]);
  useEffect(() => {
    if (journey && journeyCursor >= journey.events.length - 1) setJourneyPlaying(false);
  }, [journeyKey, journey, journeyCursor]);
  const journeyFrame = journey ? visualJourneyFrame(journey, journeyCursor) : null;
  const journeyXRay = journey ? visualJourneyXRayFrame(journey, journeyCursor) : null;
  const journeyAtTerminal = Boolean(journey && journeyCursor >= journey.events.length - 1);
  const currentJourneyOutcome = journeyFrame?.outcome ?? (journeyAtTerminal ? journey?.outcome ?? null : null);
  useEffect(() => {
    const outcome = currentJourneyOutcome;
    clearJourneyLoopTimer();
    if (!journeyAtTerminal || !outcome) {
      setJourneyOutcomeMarkerExpiry(0);
      setJourneyOutcomeTiming(null);
      return undefined;
    }
    setJourneyPlaying(false);
    const durationMs = Math.max(1000, Number(outcome.markerDurationMs) || 4000);
    const terminalReachedAt = Date.now();
    const markerCreatedAt = outcome.marker === "none" ? undefined : terminalReachedAt;
    const markerExpiresAt = markerCreatedAt === undefined ? undefined : markerCreatedAt + durationMs;
    setJourneyOutcomeMarkerExpiry(markerExpiresAt ?? 0);
    setJourneyOutcomeTiming(markerCreatedAt === undefined ? null : {
      terminalReachedAt,
      markerCreatedAt,
      markerExpiresAt,
      markerDurationMs: durationMs,
    });
    const markerTimer = markerCreatedAt === undefined
      ? undefined
      : globalThis.setTimeout(() => setJourneyOutcomeMarkerExpiry(0), durationMs);
    if (journeyLoop) {
      journeyLoopTimerRef.current = globalThis.setTimeout(() => {
        journeyLoopTimerRef.current = null;
        setJourneyCursor(0);
        setJourneyPlaybackIteration((value) => value + 1);
        setJourneyPlaying(Boolean(journey) && !reducedMotion);
      }, (markerCreatedAt === undefined ? 650 : durationMs + 650));
    }
    return () => {
      if (markerTimer !== undefined) globalThis.clearTimeout(markerTimer);
      clearJourneyLoopTimer();
    };
  }, [journeyKey, journeyAtTerminal, journeyFrame?.event.eventId, currentJourneyOutcome?.marker, currentJourneyOutcome?.markerDurationMs, journeyLoop, reducedMotion]);
  const markerEnabled = currentJourneyOutcome?.marker === "success"
    ? showSuccessMarker
    : currentJourneyOutcome?.marker === "drop"
      ? showDropMarker
      : false;
  const terminalJourneyOutcome = journeyAtTerminal ? currentJourneyOutcome : null;
  const journeyOutcomeMarkerVisible = journeyOutcomeMarkerExpiry > Date.now();
  const visibleJourneyOutcome = terminalJourneyOutcome && journeyOutcomeMarkerExpiry > Date.now() && markerEnabled ? terminalJourneyOutcome : null;
  const journeyOutcomeMarkerScale = Math.min(4, Math.max(.5, 1 / topologyZoom));
  const activeRouteDecision = journeyFrame?.event.kind === "route.decision" ? journeyFrame.event.routeDecision : null;
  const activeNeighborDecision = journeyFrame?.event.kind === "neighbor.decision" ? journeyFrame.event.neighborDecision : null;
  const activeMacDecision = journeyFrame?.event.kind?.startsWith("mac.") ? journeyFrame.event.macDecision : null;
  const activeVlanDecision = journeyFrame?.event.kind?.startsWith("vlan.") ? journeyFrame.event.vlanDecision : null;
  const activeStpDecision = journeyFrame?.event.kind?.startsWith("stp.") ? journeyFrame.event.stpDecision : null;
  const activeMtuEvaluation = journeyFrame?.event.kind === "mtu.evaluation" ? journeyFrame.event.mtuEvaluation : null;
  const activeNatDecision = journeyFrame?.event.kind === "nat.transform" ? journeyFrame.event.natDecision : null;
  const activeConntrackDecision = journeyFrame?.event.kind === "conntrack.lookup" ? journeyFrame.event.conntrackDecision : null;
  const activePolicyDecision = journeyFrame?.event.kind === "policy.decision" ? journeyFrame.event.policyDecision : null;
  const hostStackDecision = journeyFrame?.event.kind === "hoststack.decision" ? journeyFrame.event.hostStackDecision : null;
  const listenerServiceDecision = journeyFrame?.event.kind === "listener.service" ? journeyFrame.event.listenerServiceDecision : null;
  const tcpStateMachineDecision = journeyFrame?.event.kind === "tcp.state" ? journeyFrame.event.tcpStateMachineDecision : null;
  const dnsChainDecision = journeyFrame?.event.kind === "dns.resolve" ? journeyFrame.event.dnsChainDecision : null;
  const dhcpDoraDecision = journeyFrame?.event.kind === "dhcp.dora" ? journeyFrame.event.dhcpDoraDecision : null;
  const udpIcmpFailureDecision = journeyFrame?.event.kind === "udp.failure" || journeyFrame?.event.kind === "icmp.failure" ? journeyFrame.event.udpIcmpFailureDecision : null;
  const journeyDnsChainDecision = journey?.dnsChainDecision ?? null;
  const journeySegments = new Map((journey?.events ?? []).filter((event) => event.kind === "flow.segment" && event.connectionId).map((event) => [event.connectionId, event]));
  const comparisonForwardSegments = new Map((journey?.pathComparison?.forwardSegments ?? []).map((segment) => [segment.connectionId, segment]));
  const comparisonReturnSegments = new Map((journey?.pathComparison?.returnSegments ?? []).map((segment) => [segment.connectionId, segment]));
  const validThousandFocus = workspace.mode === "builder" &&
    workspace.compile.status === "valid" &&
    scaledThousandFocus?.source === workspace.source &&
    scaledThousandFocus.model === workspace.compile.model
      ? scaledThousandFocus : null;
  const fiveThousandFocusMatches=workspace.mode==="builder"&&
    workspace.compile.status==="valid"&&
    scaledFiveThousandFocus?.source===workspace.source&&
    scaledFiveThousandFocus.model===workspace.compile.model;
  const fiveThousandView=classifyScaledOfficeFiveThousandView({
    mode:workspace.mode,
    resources:workspace.mode==="builder"?workspace.source.resources.length:0,
    connections:workspace.mode==="builder"?workspace.source.connections.length:0,
    sessionActive:scaledFiveThousandSessionActive,
    focusMatches:Boolean(fiveThousandFocusMatches)
  });
  const fiveThousandWorkspace=fiveThousandView.guarded;
  // P3d1's fail-closed classifier remains unchanged. Edited graph visibility
  // requires separately reviewed P3d2 (first) or P3d3 (second) append proof.
  const approvedEditedFiveThousandFocus=fiveThousandView.guarded&&
    Boolean(fiveThousandFocusMatches)&&
    scaledFiveThousandFocus?.editedBounded===true&&
    workspace.source.connections.length===5000&&(
      (workspace.source.resources.length===5001&&
        scaledFiveThousandFocus?.twoEditedBounded!==true)||
      (workspace.source.resources.length===5002&&
        scaledFiveThousandFocus?.twoEditedBounded===true));
  const validFiveThousandFocus=
    fiveThousandView.showBoundedFocus||approvedEditedFiveThousandFocus
      ?scaledFiveThousandFocus:null;
  // P4b1: exact original source and compiled-model identity only. A subsequent
  // edit never permits a 10k full-graph fallback or a stale page.
  const reviewedTenThousandEdited=workspace.mode==="builder"&&
    scaledTenThousandSessionActive&&
    (scaledTenThousandFocus?.sourceKind==="office-p4c3b"||scaledTenThousandFocus?.sourceKind==="xlsx-p4e1"||scaledTenThousandFocus?.sourceKind==="ods-p4f2")&&
    scaledTenThousandFocus?.editedBounded===true&&
    workspace.source.resources.length===10001&&
    workspace.source.connections.length===10000;
  const validTenThousandFocus=workspace.mode==="builder"&&
    workspace.compile.status==="valid"&&
    workspace.source.connections.length===10000&&
    (workspace.source.resources.length===10000||reviewedTenThousandEdited)&&
    scaledTenThousandFocus?.source===workspace.source&&
    scaledTenThousandFocus?.model===workspace.compile.model
      ?scaledTenThousandFocus:null;
  const tenThousandHierarchyIndex = useMemo(() => {
    if (!validTenThousandFocus?.model || validTenThousandFocus.model.resources.length !== 10000 || validTenThousandFocus.model.connections.length !== 10000) return null;
    try { return buildHierarchicalTopologyIndex(validTenThousandFocus.model); }
    catch { return null; }
  }, [validTenThousandFocus?.model]);
  const hierarchicalTopologySelection = useMemo(() => {
    if (!tenThousandHierarchyIndex || topologyViewMode === TOPOLOGY_VIEW_MODES.INVENTORY_SUMMARY) return null;
    try {
      return buildHierarchicalTopologyView(
        tenThousandHierarchyIndex,
        topologyHierarchyScope?.rootId ? "branch" : "overview",
        topologyHierarchyScope?.rootId,
        topologyFocusPage,
      );
    } catch { return null; }
  }, [tenThousandHierarchyIndex, topologyHierarchyScope?.rootId, topologyFocusPage, topologyViewMode]);
  useEffect(() => {
    if (!hierarchicalTopologySelection || !tenThousandHierarchyIndex) {
      topologyLayoutRequestRef.current += 1;
      setHierarchicalTopologyLayout(null);
      return undefined;
    }
    const panelWidth = topologyViewportState.width || topologyPanelRef.current?.getBoundingClientRect?.().width || 0;
    const request = {
      sourceHash: tenThousandHierarchyIndex.sourceHash,
      scope: hierarchicalTopologySelection.kind,
      ...(hierarchicalTopologySelection.rootId ? { rootId: hierarchicalTopologySelection.rootId } : {}),
      page: hierarchicalTopologySelection.page,
      viewportBucket: topologyViewportBucket(panelWidth),
      configVersion: TOPOLOGY_LAYOUT_CONFIG_VERSION,
    };
    const requestKey = createTopologyRequestKey(request);
    const token = ++topologyLayoutRequestRef.current;
    if (hierarchicalTopologyLayout?.requestKey !== requestKey) setHierarchicalTopologyLayout(null);
    let cancelled = false;
    void layoutHierarchicalTopologyView(hierarchicalTopologySelection, request)
      .then((result) => {
        if (cancelled || token !== topologyLayoutRequestRef.current || result.requestKey !== requestKey) return;
        setHierarchicalTopologyLayout(result);
      })
      .catch((error) => {
        if (cancelled || token !== topologyLayoutRequestRef.current) return;
        // Fail closed: an ELK failure must never silently fall back to the
        // pre-P094 manual grid/cable strategy.  Keep the selection unavailable
        // until a fresh, identity-matched ELK result is produced.
        setHierarchicalTopologyLayout(null);
        setDiagnostics((current) => [...current, {
          severity: "error",
          code: "TOPOLOGY_LAYOUT_ELK_FAILED",
          message: error instanceof Error ? error.message : String(error),
        }]);
      });
    return () => { cancelled = true; };
  }, [hierarchicalTopologySelection, tenThousandHierarchyIndex, topologyViewportState.width]);
  const hierarchicalTopologyView = hierarchicalTopologySelection && hierarchicalTopologyLayout
    ? { ...hierarchicalTopologySelection, projection: hierarchicalTopologyLayout.projection, layoutStrategy: "elk.layered" }
    : null;
  useEffect(() => {
    if (tenThousandHierarchyIndex) {
      topologyFocusRequestRef.current += 1;
      setTopologyFocusProjection(null);
      return undefined;
    }
    const source = validTenThousandFocus?.source;
    const model = validTenThousandFocus?.model;
    const rootId = topologyFocusRoot;
    if (!source || !model || !rootId) {
      topologyFocusRequestRef.current += 1;
      setTopologyFocusProjection(null);
      return undefined;
    }
    const request = ++topologyFocusRequestRef.current;
    const generation = projectGeneration;
    const transition = getScenarioTransitionId();
    setTopologyFocusProjection(null);
    void buildScaledNetworkTenThousandFocus(model, validTenThousandFocus.nodeOrder, topologyFocusPage, { rootId })
      .then((focus) => {
        const active = liveTopologyWorkspace();
        if (request !== topologyFocusRequestRef.current || generation !== projectGeneration || transition !== getScenarioTransitionId() ||
            !active || active.mode !== "builder" || active.source !== source || active.compile.model !== model) return;
        setTopologyFocusProjection(focus);
      })
      .catch((error) => {
        if (request === topologyFocusRequestRef.current) {
          setTopologyFocusProjection(null);
          setDiagnostics([{ severity: "error", code: typeof error?.code === "string" ? error.code : "SCALE_P4B1_FOCUS_BLOCKED", message: "Fokuserad topologiprojektion blockerades; den kanoniska Builder-källan ändrades inte." }]);
        }
      });
    return () => { topologyFocusRequestRef.current += 1; };
  }, [tenThousandHierarchyIndex, validTenThousandFocus?.source, validTenThousandFocus?.model, validTenThousandFocus?.nodeOrder, topologyFocusRoot, topologyFocusPage, projectGeneration]);
  const tenThousandGuard=workspace.mode==="builder"&&(
    workspace.source.resources.length>=5000||
    (scaledTenThousandSessionActive&&
      workspace.source.scenarioId===scaledTenThousandFocus?.source?.scenarioId));
  // Avoid projecting all 1,000 offscreen resource handles into ReactFlow;
  // this is a VIEW of the compiled original source, not a new Builder model.
  const validDeclaredHierarchy=validThousandFocus &&
    declaredOfficeHierarchy?.source===workspace.source &&
    declaredOfficeHierarchy?.model===workspace.compile.model &&
    declaredOfficeHierarchy?.sourceRevision===workspace.sourceRevision
      ? declaredOfficeHierarchy:null;
  const validHierarchyFocus=validDeclaredHierarchy &&
    declaredOfficeFocus?.hierarchy===validDeclaredHierarchy &&
    declaredOfficeFocus?.source===workspace.source &&
    declaredOfficeFocus?.model===workspace.compile.model &&
    declaredOfficeFocus?.sourceRevision===workspace.sourceRevision
      ? declaredOfficeFocus:null;
  // PROJECT-088: the overview is an explicit secondary mode. Normal topology
  // must remain the primary projection for a manageable canonical graph.
  const topologyOverview = topologyViewMode === TOPOLOGY_VIEW_MODES.INVENTORY_SUMMARY && !topologyFocusRoot
    ? buildNetworkOverviewProjection({
        scenarioId: workspace.mode === "builder" ? workspace.source.scenarioId : workspace.scenario.scenarioId,
        sourceHash: workspace.mode === "builder" ? workspace.compile.model?.sourceHash : workspace.scenario.sourceHash,
        resources: canonicalNetwork.resources,
        connections: canonicalNetwork.connections,
      })
    : null;
  const topologyOverviewIdentity = topologyOverview
    ? `${projectGeneration}:${getScenarioTransitionId()}:${sourceIdentity}:${topologyOverview.sourceHash}:${topologyOverview.strategy}:${topologyOverview.canonicalNodes}:${topologyOverview.canonicalLinks}:${topologyOverview.groups.map((group) => `${group.id}:${group.members.length}`).join(",")}`
    : "none";
  useEffect(() => {
    setTopologyOverviewReadyIdentity("");
    if (!topologyOverview) return undefined;
    let firstFrame;
    let retryInterval;
    let readyTimer;
    let attempts = 0;
    let stableFrames = 0;
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => globalThis.setTimeout(callback, 0));
    const cancel = (handle) => {
      if (typeof globalThis.cancelAnimationFrame === "function") globalThis.cancelAnimationFrame(handle);
      else globalThis.clearTimeout(handle);
    };
    const checkRenderedEdges = () => {
      const panel = topologyPanelRef.current;
      const rendered = [...(panel?.querySelectorAll('path[data-overview-summary-edge="true"]') ?? [])]
        .filter((edge) => edge.getAttribute("data-overview-source-hash") === topologyOverview.sourceHash).length;
      if (rendered >= topologyOverview.edges.length) {
        stableFrames += 1;
        // React Flow can finish its internal edge commit one frame after the
        // controlled projection is rendered. Require two stable observations,
        // then yield once more before exposing the sidebar summary so callers
        // never observe the summary card without its actual SVG paths.
        if (stableFrames >= 2 && readyTimer === undefined) {
          readyTimer = globalThis.setTimeout(() => {
            readyTimer = undefined;
            const latestPanel = topologyPanelRef.current;
            const latestRendered = [...(latestPanel?.querySelectorAll('path[data-overview-summary-edge="true"]') ?? [])]
              .filter((edge) => edge.getAttribute("data-overview-source-hash") === topologyOverview.sourceHash).length;
            if (latestRendered >= topologyOverview.edges.length) {
              if (retryInterval !== undefined) globalThis.clearInterval(retryInterval);
              setTopologyOverviewReadyIdentity(topologyOverviewIdentity);
            } else {
              stableFrames = 0;
            }
          }, 32);
        }
      } else if (++attempts >= 120 && retryInterval !== undefined) {
        globalThis.clearInterval(retryInterval);
        stableFrames = 0;
      }
    };
    firstFrame = schedule(checkRenderedEdges);
    retryInterval = globalThis.setInterval(checkRenderedEdges, 16);
    return () => {
      if (firstFrame !== undefined) cancel(firstFrame);
      if (retryInterval !== undefined) globalThis.clearInterval(retryInterval);
      if (readyTimer !== undefined) globalThis.clearTimeout(readyTimer);
    };
  }, [topologyOverviewIdentity]);
  const activeTopologyGroup = topologyGroup && !topologyFocusRoot ? topologyGroup : null;
  const topologyGroupMembers = activeTopologyGroup
    ? activeTopologyGroup.members.map((memberId) => canonicalResourceById.get(memberId)).filter(Boolean)
    : [];
  const normalizedTopologyGroupQuery = topologyGroupQuery.trim().toLowerCase();
  const filteredTopologyGroupMembers = normalizedTopologyGroupQuery
    ? topologyGroupMembers.filter((resource) => [resource.id, resource.label, resource.type, resource.vendor, resource.product]
      .some((value) => String(value ?? "").toLowerCase().includes(normalizedTopologyGroupQuery)))
    : topologyGroupMembers;
  const topologyGroupPageCount = Math.max(1, Math.ceil(filteredTopologyGroupMembers.length / 50));
  const boundedTopologyGroupPage = Math.min(Math.max(1, topologyGroupPage), topologyGroupPageCount);
  const topologyGroupPageItems = filteredTopologyGroupMembers.slice((boundedTopologyGroupPage - 1) * 50, boundedTopologyGroupPage * 50);
  // An edited 5000 model with stale focus must never fall back to unbounded layout.
  // Atlas renders a bounded canonical subset through the existing Canvas/ELK
  // path.  Do not materialize a full Builder Canvas just to select a page;
  // NORMAL TOPOLOGY retains the established view-model path unchanged.
  const vm = useMemo(() => validThousandFocus || fiveThousandWorkspace || tenThousandGuard ||
    (workspace.mode === "builder" && topologyViewMode === TOPOLOGY_VIEW_MODES.ATLAS) ? null :
    workspace.mode === "builder" ? buildBuilderViewModel(workspace) : buildRuntimeViewModel(workspace),
    [workspace, topologyViewMode, validThousandFocus, fiveThousandWorkspace, tenThousandGuard]);
  const hasManualLayoutOverrides = workspace.layout?.nodes?.some((node) => node.manualOverride === true) === true;
  const normalTopologyCanvas = workspace.mode === "builder" && topologyViewMode === TOPOLOGY_VIEW_MODES.NORMAL &&
    canonicalNetwork.resources.length <= NORMAL_TOPOLOGY_RESOURCE_BUDGET &&
    vm?.canvas && !hasManualLayoutOverrides
    ? compactNormalTopologyProjection(vm.canvas)
    : vm?.canvas;
  const atlasScenario = workspace.mode === "builder"
    ? workspace.compile.status === "valid" ? workspace.compile.model : null
    : workspace.scenario;
  const atlasTopologyCanvas = useMemo(() => {
    if (topologyViewMode !== TOPOLOGY_VIEW_MODES.ATLAS || !atlasPageProjection || !atlasScenario) return null;
    const pageCanvas = projectScenarioSubsetToCanvas(
      atlasScenario,
      atlasPageProjection.page.resourceIds,
      atlasPageProjection.page.internalConnectionIds,
    );
    return {
      ...pageCanvas,
      nodes: pageCanvas.nodes.map((node) => node.type === "resource" ? {
        ...node,
        data: {
          ...node.data,
          atlasPageId: atlasPageProjection.page.id,
          atlasPageBasis: atlasPageProjection.page.basis,
          atlasBoundaryReferences: atlasPageProjection.boundaryReferences.filter((reference) => reference.localResourceId === node.id),
        },
      } : node),
    };
  }, [atlasPageProjection, atlasScenario, topologyViewMode]);
  const atlasPageView = useMemo(() => {
    if (!atlasTopologyCanvas || !atlasPageProjection) return null;
    const directMembers = new Map();
    for (const node of atlasTopologyCanvas.nodes) {
      if (node.type !== "resource" || !node.parentId) continue;
      const members = directMembers.get(node.parentId) ?? [];
      members.push(node.id);
      directMembers.set(node.parentId, members);
    }
    const projection = {
      ...atlasTopologyCanvas,
      nodes: atlasTopologyCanvas.nodes.map((node) => node.type === "zone" ? {
        ...node,
        data: {
          ...node.data,
          presentationOnly: true,
          navigationGroupKind: "declared-zone",
          memberIds: (directMembers.get(node.id) ?? []).slice().sort((left, right) => left.localeCompare(right, "en")),
        },
      } : node),
    };
    return {
      kind: "overview",
      page: 1,
      pageCount: 1,
      nodeIds: atlasPageProjection.page.resourceIds,
      edgeIds: atlasPageProjection.page.internalConnectionIds,
      hiddenNodeCount: 0,
      hiddenConnectionCount: atlasPageProjection.page.boundaryConnectionIds.length + atlasPageProjection.page.externalConnectionIds.length,
      hiddenNeighborCount: 0,
      hiddenBoundaryConnectionCount: atlasPageProjection.page.boundaryConnectionIds.length,
      visibleConnectionCount: atlasPageProjection.page.internalConnectionIds.length,
      projection,
      navigationGroups: atlasTopologyCanvas.nodes.filter((node) => node.type === "zone").map((node) => ({ id: node.id, label: node.data.label, memberIds: directMembers.get(node.id) ?? [], kind: "declared-zone", presentationOnly: true, level: 0 })),
      partition: { internal: atlasPageProjection.connections, boundary: atlasPageProjection.page.boundaryConnectionIds.map((id) => validAtlasIndex.connectionById.get(id)).filter(Boolean), external: atlasPageProjection.page.externalConnectionIds.map((id) => validAtlasIndex.connectionById.get(id)).filter(Boolean) },
      incompleteView: atlasPageProjection.page.renderMode === "link-list",
      layoutStrategy: "elk.layered",
      roleLabel: `ATLAS · ${atlasPageProjection.page.label}`,
    };
  }, [atlasPageProjection, atlasTopologyCanvas, validAtlasIndex]);
  useEffect(() => {
    if (topologyViewMode !== TOPOLOGY_VIEW_MODES.ATLAS || !atlasPageView) {
      atlasLayoutRequestRef.current += 1;
      setAtlasLayout(null);
      return undefined;
    }
    const request = {
      sourceHash: `${projectGeneration}:${atlasPageProjection?.sourceIdentity ?? "unknown-source"}:${atlasPageProjection?.page.id ?? "unknown-page"}`,
      scope: "overview",
      page: 1,
      viewportBucket: topologyViewportBucket(topologyViewportState.width || 0),
      configVersion: "atlas-001-elk-v1",
    };
    const token = ++atlasLayoutRequestRef.current;
    const requestKey = createTopologyRequestKey(request);
    setAtlasLayout((current) => current?.requestKey === requestKey ? current : null);
    let cancelled = false;
    void layoutHierarchicalTopologyView(atlasPageView, request)
      .then((result) => {
        if (cancelled || token !== atlasLayoutRequestRef.current || result.requestKey !== requestKey) return;
        setAtlasLayout(result);
      })
      .catch((error) => {
        if (cancelled || token !== atlasLayoutRequestRef.current) return;
        setAtlasLayout({ requestKey, engine: "elk.layered", projection: atlasTopologyCanvas, quality: null, diagnostics: [{ severity: "error", code: "ATLAS_LAYOUT_ELK_FAILED", message: error instanceof Error ? error.message : String(error) }] });
      });
    return () => { cancelled = true; };
  }, [atlasPageProjection?.sourceIdentity, atlasPageProjection?.page.id, atlasPageView, atlasTopologyCanvas, projectGeneration, topologyViewMode, topologyViewportState.width]);
  const activeAtlasCanvas = atlasLayout?.projection ?? atlasTopologyCanvas;
  // Geographic focus is a view only; the whole 1000/999 Builder remains.
  const tenThousandTopologyProjection = validTenThousandFocus && topologyFocusRoot && topologyFocusProjection?.focusRoot === topologyFocusRoot
    ? topologyFocusProjection
    : null;
  const projection = activeAtlasCanvas ?? topologyOverview ?? hierarchicalTopologyView?.projection ?? tenThousandTopologyProjection?.focusCanvas ?? validHierarchyFocus?.focusCanvas ??
    validTenThousandFocus?.focusCanvas ??
    validFiveThousandFocus?.focusCanvas ??
    validThousandFocus?.focusCanvas ?? normalTopologyCanvas;
  const localFocusPage = tenThousandTopologyProjection?.focusPage ?? (!tenThousandHierarchyIndex && !validDeclaredHierarchy && !validTenThousandFocus && !validFiveThousandFocus && !validThousandFocus && topologyFocusRoot && projection
    ? (() => { try { return buildTopologyFocusPage(canonicalNetwork, topologyFocusRoot, topologyFocusPage, 100, 250); } catch { return null; } })()
    : null);
  // Keep the established focus-count contract available for the bounded
  // PROJECT-090 hierarchy too. The values are derived from the canonical
  // adjacency index; they are not synthetic summary links.
  const hierarchicalFocusCounts = hierarchicalTopologyView?.kind === "branch" && hierarchicalTopologyView.rootId && tenThousandHierarchyIndex
    ? (() => {
      const rootId = hierarchicalTopologyView.rootId;
      const rootNeighbors = tenThousandHierarchyIndex.adjacency.get(rootId) ?? [];
      const visibleEdgeIds = new Set(hierarchicalTopologyView.edgeIds);
      const visibleRootLinks = rootNeighbors.filter((neighbor) => visibleEdgeIds.has(neighbor.connectionId)).length;
      const visibleNeighbors = new Set(rootNeighbors
        .filter((neighbor) => visibleEdgeIds.has(neighbor.connectionId))
        .map((neighbor) => neighbor.neighborId)).size;
      const totalNeighbors = new Set(rootNeighbors.map((neighbor) => neighbor.neighborId)).size;
      return {
        visibleNeighbors,
        totalNeighbors,
        visibleRootLinks,
        totalRootLinks: rootNeighbors.length,
        hiddenRootLinks: Math.max(0, rootNeighbors.length - visibleRootLinks),
        visibleNeighborLinks: Math.max(0, hierarchicalTopologyView.visibleConnectionCount - visibleRootLinks),
        totalVisibleLinks: hierarchicalTopologyView.visibleConnectionCount,
      };
    })()
    : null;
  const visibleProjection = localFocusPage && projection
    ? { ...projection, nodes: projection.nodes.filter((node) => localFocusPage.nodeIds.includes(node.id)), edges: projection.edges.filter((edge) => localFocusPage.edgeIds.includes(edge.id)) }
    : projection;
  // ReactFlow maintains an internal node/edge store. On site/building/floor
  // switches, a same-count previous edge set must never survive under the
  // newly approved scope label while the controlled store catches up.
  // Remount only when the exact reviewed hierarchy page identity changes.
  const hierarchyCanvasKey = topologyOverview
    ? `network-overview:${projectGeneration}:${getScenarioTransitionId()}:${sourceIdentity}:${topologyOverview.sourceHash}:${topologyOverview.strategy}:${topologyOverview.canonicalNodes}:${topologyOverview.canonicalLinks}:${topologyOverview.groups.map((group) => `${group.id}:${group.members.length}`).join(",")}`
    : `${topologyViewMode}:` + (hierarchicalTopologyView
      ? `project-090:${hierarchicalTopologyView.kind}:${hierarchicalTopologyView.rootId ?? "overview"}:${hierarchicalTopologyView.page}:${hierarchicalTopologyView.edgeIds.join(",")}`
      : validHierarchyFocus
    ? `scale001-p2b2c:${validHierarchyFocus.sourceModelHash}:${validHierarchyFocus.scopeKind}:${validHierarchyFocus.scopeId}:${validHierarchyFocus.page}`
    : validTenThousandFocus
      ? `${validTenThousandFocus.editedBounded?(validTenThousandFocus.sourceKind==="xlsx-p4e1"?"scale001-p4e2":validTenThousandFocus.sourceKind==="ods-p4f2"?"scale001-p4f3":"scale001-p4c4a"):validTenThousandFocus.sourceKind==="office-p4c3b"?"scale001-p4c3b":validTenThousandFocus.sourceKind==="ods-p4f2"?"scale001-p4f2":validTenThousandFocus.sourceKind==="xlsx-p4e1"?"scale001-p4e1":"scale001-p4b1"}:${validTenThousandFocus.sourceOriginalSha256}:${validTenThousandFocus.sourceModelHash}:${validTenThousandFocus.page}:${topologyFocusRoot ?? "overview"}`
    : validFiveThousandFocus
      ? `scale001-p3c2:${validFiveThousandFocus.sourceModelHash}:${validFiveThousandFocus.page}`
      : atlasPageProjection
        ? `atlas-001:${atlasPageProjection.sourceIdentity}:${atlasPageProjection.page.id}:${atlasPageProjection.page.internalConnectionIds.join(",")}:${atlasLayout?.requestKey ?? "pending"}`
      : "regular-topology");
  const baseFlow = useMemo(() => visibleProjection ? toReactFlowProjection(visibleProjection) : { nodes: [], edges: [] }, [visibleProjection]);
  void topologyGeometryRevision;
  const topologyGeometryIdentity = `${baseFlow.nodes.map((node) => `${node.id}:${node.position.x}:${node.position.y}:${node.width ?? ""}:${node.height ?? ""}`).join("|")}::${baseFlow.edges.map((edge) => `${edge.id}:${edge.source}:${edge.target}`).join("|")}`;
  useEffect(() => {
    const panel = topologyPanelRef.current;
    const lifecycle = topologyLifecycleRef.current;
    if (!panel || !lifecycle) return undefined;
    lifecycle.setEdgeIds(baseFlow.edges.map((edge) => edge.id));
    const cancelRepair = () => {
      if (topologyResizeFrameRef.current !== null) globalThis.cancelAnimationFrame?.(topologyResizeFrameRef.current);
      topologyResizeFrameRef.current = null;
    };
    const repairVisualGeometry = () => {
      cancelRepair();
      const schedule = globalThis.requestAnimationFrame ?? ((callback) => globalThis.setTimeout(callback, 0));
      topologyResizeFrameRef.current = schedule(() => {
        topologyResizeFrameRef.current = null;
        const instance = flowApi.current;
        if (instance) {
          const viewport = topologyViewportRef.current;
          if (viewport && instance.setViewport) instance.setViewport(viewport, { duration: 0 });
        }
        setTopologyGeometryRevision((value) => value + 1);
      });
    };
    const measure = (forceRepair = false) => {
      const rect = panel.getBoundingClientRect();
      const next = lifecycle.observe({ width: rect.width, height: rect.height });
      setTopologyViewportState(next);
      if (next.phase === "valid" && (forceRepair || next.rebuildVisualGeometry)) repairVisualGeometry();
    };
    const resizeObserver = typeof globalThis.ResizeObserver === "function" ? new globalThis.ResizeObserver(measure) : null;
    resizeObserver?.observe(panel);
    const onResize = () => measure(true);
    const onVisibility = () => { if (document.visibilityState === "visible") measure(true); };
    const onPageShow = () => measure(true);
    globalThis.addEventListener?.("resize", onResize);
    globalThis.addEventListener?.("visibilitychange", onVisibility);
    globalThis.addEventListener?.("pageshow", onPageShow);
    // The first valid measurement establishes the baseline only. React Flow
    // must finish its initial node/edge mount before any repair is requested.
    let initialFitFrame;
    let initialFitSecondFrame;
    let initialFitTimer;
    const runInitialFit = () => {
      const rect = topologyPanelRef.current?.getBoundingClientRect();
      const instance = flowApi.current;
      if (!rect || rect.width <= 0 || rect.height <= 0 || !instance) return false;
      // React Flow exposes the instance before its node internals have been
      // measured. Fitting at that point records a stale transform (often
      // scale=1 with the left side of the graph off-screen), and the old
      // one-shot identity guard then prevents the real fit. Wait until every
      // mounted node has usable measured geometry before consuming the fit
      // identity.
      const measured = baseFlow.nodes.every((node) => {
        const internal = instance.getInternalNode?.(node.id);
        const dimensions = internal?.measured ?? internal?.internals?.measured;
        return Number(dimensions?.width ?? internal?.width ?? node.width ?? 0) > 0 &&
          Number(dimensions?.height ?? internal?.height ?? node.height ?? 0) > 0;
      });
      if (!measured) return false;
      const overviewCamera = topologyOverview || topologyCameraMode === "overview";
      const hierarchyOverviewCamera = Boolean(hierarchicalTopologyView?.kind === "overview");
      const readableHierarchy = Boolean(hierarchicalTopologyView && topologyCameraMode === "read");
      const compactMobileRead = topologyCameraMode === "read" && rect.width < 600 && !hierarchicalTopologyView;
      const readableRootId = readableHierarchy
        ? hierarchicalTopologyView?.rootId ?? hierarchicalTopologyView.navigationGroups[0]?.memberIds[0]
        : null;
      const rootNode = readableRootId ? baseFlow.nodes.find((node) => node.id === readableRootId) : null;
      const rootRect = rootNode ? topologyWorldRect(rootNode.id) : null;
      if (rootRect && instance.setCenter) {
        instance.setCenter(rootRect.x + rootRect.width / 2, rootRect.y + rootRect.height / 2, { zoom: 1, duration: 0 });
      } else {
        instance.fitView?.({
          duration: 0,
          padding: overviewCamera ? 0.2 : 0.08,
          // A hierarchy overview must keep every source-derived group/card in
          // the overview camera.  READ is the camera mode with the effective
          // label-size gate; OVERVIEW is allowed to be a true map overview
          // rather than cropping the lower Arvidsjaur groups.
          minZoom: topologyOverview ? 0.58 : hierarchyOverviewCamera ? 0.08 : overviewCamera || compactMobileRead ? 0.32 : 1,
          maxZoom: topologyOverview ? 1.25 : overviewCamera ? 1.05 : 1.35,
        });
      }
      setTopologyGeometryRevision((value) => value + 1);
      return true;
    };
    measure(false);
    if (topologyInitialFitIdentityRef.current !== topologyGeometryIdentity) {
      const fitIdentity = topologyGeometryIdentity;
      const tryInitialFit = () => {
        if (topologyInitialFitIdentityRef.current === fitIdentity) return;
        if (runInitialFit()) {
          topologyInitialFitIdentityRef.current = fitIdentity;
          return;
        }
        initialFitTimer = globalThis.setTimeout(tryInitialFit, 32);
      };
      initialFitFrame = globalThis.requestAnimationFrame?.(() => {
        initialFitSecondFrame = globalThis.requestAnimationFrame?.(tryInitialFit);
      });
      initialFitTimer = globalThis.setTimeout(tryInitialFit, 120);
    }
    return () => {
      resizeObserver?.disconnect();
      globalThis.removeEventListener?.("resize", onResize);
      globalThis.removeEventListener?.("visibilitychange", onVisibility);
      globalThis.removeEventListener?.("pageshow", onPageShow);
      cancelRepair();
      if (initialFitFrame !== undefined) globalThis.cancelAnimationFrame?.(initialFitFrame);
      if (initialFitSecondFrame !== undefined) globalThis.cancelAnimationFrame?.(initialFitSecondFrame);
      if (initialFitTimer !== undefined) globalThis.clearTimeout(initialFitTimer);
    };
  }, [topologyGeometryIdentity, journeyKey, topologyOverview?.strategy, topologyOverview?.canonicalNodes, topologyOverview?.canonicalLinks, hierarchicalTopologyView?.kind, hierarchicalTopologyView?.rootId, topologyCameraMode]);
  const topologyIndex = useMemo(() => buildTopologySearchIndexFromNetwork(canonicalNetwork), [canonicalNetwork]);
  const topologySearch = useMemo(() => searchTopologyWithCount(topologyIndex, topologyQuery), [topologyIndex, topologyQuery]);
  const topologySearchResults = topologySearch.results;
  const journeyPathNodeIds = useMemo(() => [...new Set((journey?.events ?? []).flatMap((event) => [event.resourceId, event.targetResourceId].filter(Boolean)))], [journey]);
  const topologyMarks = useMemo(() => filterTopologyNodes(projection?.nodes ?? [], { query: topologyQuery, nodeType: topologyType || undefined, zone: topologyZone || undefined, vlan: topologyVlan || undefined, pathNodeIds: topologyPathFocus ? journeyPathNodeIds : [] }), [projection, topologyQuery, topologyType, topologyZone, topologyVlan, topologyPathFocus, journeyPathNodeIds]);
  const selectedIds = new Set(workspace.selection.ids);
  const activeConnectionIds = new Set(journeyFrame?.activeConnectionIds ?? []);
  const activeProjectedEdges = baseFlow.edges.filter((edge) => activeConnectionIds.has(edge.id));
  const activeInterfacesByResourceSet = new Map();
  const addActiveInterface = (resourceId, interfaceId) => {
    if (!interfaceId) return;
    const ids = activeInterfacesByResourceSet.get(resourceId) ?? new Set();
    ids.add(interfaceId);
    activeInterfacesByResourceSet.set(resourceId, ids);
  };
  for (const edge of activeProjectedEdges) {
    if (edge.sourceHandle?.startsWith("out:")) addActiveInterface(edge.source, edge.sourceHandle.slice(4));
    if (edge.targetHandle?.startsWith("in:")) addActiveInterface(edge.target, edge.targetHandle.slice(3));
  }
  if (activeMacDecision?.ingressInterface) addActiveInterface(activeMacDecision.resourceId, activeMacDecision.ingressInterface);
  if (activeVlanDecision?.ingressInterface) addActiveInterface(activeVlanDecision.resourceId, activeVlanDecision.ingressInterface);
  if (activeVlanDecision?.egressInterface) addActiveInterface(activeVlanDecision.resourceId, activeVlanDecision.egressInterface);
  if (activeStpDecision?.ingressInterface) addActiveInterface(activeStpDecision.resourceId, activeStpDecision.ingressInterface);
  if (activeStpDecision?.egressInterface) addActiveInterface(activeStpDecision.resourceId, activeStpDecision.egressInterface);
  const activeInterfacesByResource = new Map([...activeInterfacesByResourceSet].map(([resourceId, ids]) => [resourceId, [...ids].sort()]));
  const flowNodeById = new Map(baseFlow.nodes.map((node) => [node.id, node]));
  const absoluteNodePosition = (node) => {
    let x = node.position.x;
    let y = node.position.y;
    let parentId = node.parentId;
    const visited = new Set();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = flowNodeById.get(parentId);
      if (!parent) break;
      x += parent.position.x;
      y += parent.position.y;
      parentId = parent.parentId;
    }
    return { x, y };
  };
  const journeyEndpointResourceId = currentJourneyOutcome?.anchorResourceId ?? journey?.destinationId;
  const journeyEndpointNode = journeyEndpointResourceId
    ? baseFlow.nodes.find((node) => node.id === journeyEndpointResourceId)
    : undefined;
  const journeyEndpointRuntimeNode = journeyEndpointResourceId
    ? flowApi.current?.getInternalNode?.(journeyEndpointResourceId)
    : undefined;
  const journeyEndpointPosition = journeyEndpointRuntimeNode?.internals?.positionAbsolute
    ?? (journeyEndpointNode ? absoluteNodePosition(journeyEndpointNode) : undefined);
  const journeyEndpoint = journeyEndpointNode
    ? {
        resourceId: journeyEndpointNode.id,
        x: (journeyEndpointPosition?.x ?? journeyEndpointNode.position.x) + (journeyEndpointNode.width ?? 150) / 2,
        y: (journeyEndpointPosition?.y ?? journeyEndpointNode.position.y) + (journeyEndpointNode.height ?? 72) / 2,
      }
    : undefined;
  const reactFlowNodeGeometryReady = (nodeId) => {
    const node = flowApi.current?.getInternalNode?.(nodeId);
    const position = node?.internals?.positionAbsolute;
    const measured = node?.measured ?? node?.internals?.measured;
    const width = Number(measured?.width ?? node?.width ?? 0);
    const height = Number(measured?.height ?? node?.height ?? 0);
    return Boolean(node) && Number.isFinite(position?.x) && Number.isFinite(position?.y) && width > 0 && height > 0;
  };
  const flow = {
    nodes: baseFlow.nodes.map((node) => ({
      ...node,
      zIndex: node.type === "resource" && visibleJourneyOutcome && terminalJourneyOutcome?.anchorResourceId === node.id ? 100 : node.zIndex,
      className: topologyMarks[node.id] === "dim" ? "topology-node-dim" : "topology-node-match",
      selected: selectedIds.has(node.id),
      data: node.type === "zone" && workspace.mode === "builder"
        ? {
            ...node.data,
            builderEditable: true,
            onResizeEnd: (params) => {
              const active = liveTopologyMutationWorkspace();
              // A geometry callback from a retired projection cannot edit a
              // newer canonical graph, even within the same project.
              if (!active) return;
              const result = resizeBuilderZone(active, {
                id: node.id,
                x: params.x,
                y: params.y,
                width: params.width,
                height: params.height,
              });
              setDiagnostics(result.diagnostics);
              if (result.ok) setWorkspace(result.workspace);
            },
          }
        : {
          ...node.data,
            activeInterfaceIds: activeInterfacesByResource.get(node.id) ?? [],
            ...(journey && node.type === "resource" ? (() => {
              const outcomeAnchoredHere = terminalJourneyOutcome?.anchorResourceId === node.id;
              const outcomeState = outcomeAnchoredHere
                ? terminalJourneyOutcome.kind === "destination_reached"
                  ? "arrived"
                  : terminalJourneyOutcome.kind === "dropped"
                    ? "dropped"
                    : terminalJourneyOutcome.kind === "unknown"
                      ? "uncertain"
                      : undefined
                : undefined;
              return {
                journeyState: outcomeState
                  ?? (journeyFrame?.currentResourceId === node.id
                    ? "current"
                    : node.id === journey.sourceId
                      ? "source"
                      : node.id === journey.destinationId
                        ? "destination"
                        : "idle"),
                ...(stateFocus?.targetResourceId === node.id ? { modeledStateFocus: true } : {}),
              };
            })() : {}),
          ...(stateFocus && node.type === "resource" && stateFocus.targetResourceId === node.id ? { modeledStateFocus: true } : {}),
          },
    })),
    edges: baseFlow.edges.map((edge) => {
      const segment = journeySegments.get(edge.id);
      const completed = Boolean(journeyFrame?.completedConnectionIds.includes(edge.id));
      const active = activeConnectionIds.has(edge.id);
      const projectedMacDirection = active && activeMacDecision
        ? edge.source === activeMacDecision.resourceId
          ? { from: edge.source, to: edge.target }
          : edge.target === activeMacDecision.resourceId
            ? { from: edge.target, to: edge.source }
            : undefined
        : undefined;
      const projectedVlanDirection = active && activeVlanDecision
        ? edge.source === activeVlanDecision.resourceId
          ? { from: edge.source, to: edge.target }
          : edge.target === activeVlanDecision.resourceId
            ? { from: edge.target, to: edge.source }
            : undefined
            : undefined;
      const projectedStpDirection = active && activeStpDecision
        ? edge.source === activeStpDecision.resourceId
          ? { from: edge.source, to: edge.target }
          : edge.target === activeStpDecision.resourceId
            ? { from: edge.target, to: edge.source }
            : undefined
        : undefined;
      const projectedDecisionDirection = projectedMacDirection ?? projectedVlanDirection ?? projectedStpDirection;
      const direction = projectedDecisionDirection ?? (segment ? { from: segment.resourceId, to: segment.targetResourceId } : undefined);
      const showJourney = Boolean(segment || (active && projectedDecisionDirection));
      const comparisonForward = comparisonForwardSegments.get(edge.id);
      const comparisonReturn = comparisonReturnSegments.get(edge.id);
      return {
        ...edge,
        selected: selectedIds.has(edge.id),
        data: {
          ...edge.data,
          showEdgeLabel: selectedIds.has(edge.id),
          ...(comparisonForward || comparisonReturn ? {
            pathComparison: {
              forward: Boolean(comparisonForward),
              return: Boolean(comparisonReturn),
              symmetry: journey?.pathComparison?.trace.symmetry ?? "UNRESOLVED",
              ...(comparisonForward ? { forwardDirection: { from: comparisonForward.from, to: comparisonForward.to } } : {}),
              ...(comparisonReturn ? { returnDirection: { from: comparisonReturn.from, to: comparisonReturn.to } } : {}),
            },
          } : {}),
          ...(showJourney ? {
            journey: {
              state: active ? "active" : completed ? "completed" : "pending",
              mode: journeyMode,
              speed: journeySpeed,
              truth: journeyFrame?.event.truth ?? journey?.truth ?? "UNKNOWN",
              decisionKind: journeyFrame?.event.kind ?? "",
              ...(direction ? { direction } : {}),
            },
            journeyGeometryReady: reactFlowNodeGeometryReady(edge.source) && reactFlowNodeGeometryReady(edge.target),
          } : {}),
          ...(active && journeyEndpoint && (edge.source === journeyEndpoint.resourceId || edge.target === journeyEndpoint.resourceId)
            ? { journeyEndpoint }
            : {}),
        },
      };
    }),
  };
  const blockedCanvasActionRef = useRef(null);
  const denyUnappliedCanvasChange = (active, action = "mutation") => {
    if (active.mode !== "builder" || !getPendingDraftChanges()) {
      blockedCanvasActionRef.current = null;
      return false;
    }
    // ReactFlow may repeatedly publish an unchanged selection after a
    // parent diagnostic render. Do not create a feedback loop of App updates
    // while preserving an unapplied draft.
    if (blockedCanvasActionRef.current !== action) {
      blockedCanvasActionRef.current = action;
      setDiagnostics([{ severity: "error", code: "BUILDER_CANVAS_UNAPPLIED_DRAFT",
        message: "Apply or revert the Inspector/JSON fields before selecting or changing topology objects. The staged text is preserved." }]);
    }
    return true;
  };
  const onSelectionChange = ({ nodes, edges }) => {
    const active = liveTopologyWorkspace();
    if (!active) return;
    if (tenThousandHierarchyIndex) return;
    const nodeIds = nodes.map((node) => node.id);
    const edgeIds = edges.map((edge) => edge.id);
    if (active.mode !== "builder") return;
    if (active.mode === "builder" && getPendingDraftChanges()) {
      // A repeated callback describing the ALREADY-selected nodes is not a
      // user attempt to discard the pending form; it needs no diagnostics.
      const selected = active.selection?.ids ?? [];
      const requested = [...nodeIds, ...edgeIds];
      if (JSON.stringify(selected) !== JSON.stringify(requested))
        denyUnappliedCanvasChange(active, "selection:" + JSON.stringify(requested));
      return;
    }
    blockedCanvasActionRef.current = null;
    const primary = [...nodeIds, ...edgeIds].at(-1);
    const currentIds = active.selection?.ids ?? [];
    if (JSON.stringify(currentIds) === JSON.stringify([...nodeIds, ...edgeIds]) && active.selection?.primary === primary) return;
    // Selection carries no authority to replace the canonical source.
    // Apply it to the synchronously published current workspace only.
    setWorkspace(applyBuilderCanvasSelection(active, { nodeIds, edgeIds, primary }));
  };
  const findTopologyGroup = (groupId) => topologyOverview?.groups.find((group) => group.id === groupId)
    ?? (topologyGroup?.id === groupId ? topologyGroup : undefined);
  const openTopologyGroup = (group) => {
    if (!group) return;
    setTopologyFocusRoot(null);
    setTopologyFocusPage(1);
    setTopologyFocusProjection(null);
    topologyFocusRequestRef.current += 1;
    setTopologyGroup({ id: group.id, label: group.label, role: group.role, members: [...group.members] });
    setTopologyGroupQuery("");
    setTopologyGroupPage(1);
    setTopologyViewHistory((history) => {
      const last = history.at(-1);
      if (last?.kind === "group" && last.groupId === group.id) return history;
      return [...history, { kind: "group", groupId: group.id, label: `Grupp: ${group.label}`, page: 1 }];
    });
    setTopologyContextMenu(null);
    setTopologyContextDetails(null);
  };
  const openTopologyGroupFromNode = (node) => {
    const groupId = node.data?.overviewGroupId ?? node.id;
    const group = findTopologyGroup(groupId) ?? {
      id: groupId,
      label: String(node.data?.label ?? groupId).replace(/\s+·\s+\d+ devices$/, ""),
      role: node.data?.overviewRole ?? "documented-type",
      members: Array.isArray(node.data?.overviewMembers) ? node.data.overviewMembers : [],
    };
    openTopologyGroup(group);
  };
  const onNodeClick = (_event, node) => {
    const active = liveTopologyWorkspace();
    if (!active || denyUnappliedCanvasChange(active, `node-click:${node.id}`)) return;
    if (node.data?.overviewGroup) {
      openTopologyGroupFromNode(node);
      return;
    }
    if (active.selection?.primary === node.id && active.selection?.ids?.length === 1) return;
    if (active.mode === "builder") setWorkspace(applyBuilderCanvasSelection(active, { nodeIds: [node.id], primary: node.id }));
    else setWorkspace(setRuntimeSelection(active, [node.id], node.id));
  };
  const onNodeDoubleClick = (event, node) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.target;
    const domResource = target?.closest?.(".react-flow__node-resource[data-id]");
    const domHandle = target?.closest?.("[data-nodeid]");
    const domNode = target?.closest?.("[data-id]");
    const candidates = [
      domHandle?.getAttribute?.("data-nodeid"),
      domResource?.getAttribute?.("data-id"),
      domNode?.getAttribute?.("data-id"),
      node.id,
    ];
    if (node.data?.overviewGroup) {
      openTopologyGroupFromNode(node);
      return;
    }
    if (typeof document !== "undefined" && Number.isFinite(event.clientX) && Number.isFinite(event.clientY)) {
      const pointResource = document.elementsFromPoint(event.clientX, event.clientY)
        .map((element) => element.closest?.(".react-flow__node-resource[data-id]")?.getAttribute?.("data-id"))
        .find((candidate) => canonicalResourceById.has(candidate));
      if (pointResource) candidates.unshift(pointResource);
    }
    const resolvedId = candidates.find((candidate) => canonicalResourceById.has(candidate)) ?? node.id;
    const resource = canonicalResourceById.get(resolvedId);
    focusTopologyNode(resolvedId, resource?.label ?? resolvedId);
  };
  const onEdgeClick = (_event, edge) => {
    const active = liveTopologyWorkspace();
    if (!active || denyUnappliedCanvasChange(active, `edge-click:${edge.id}`)) return;
    if (active.selection?.primary === edge.id && active.selection?.ids?.length === 1) return;
    setWorkspace(active.mode === "builder"
      ? applyBuilderCanvasSelection(active, { edgeIds: [edge.id], primary: edge.id })
      : setRuntimeSelection(active, [edge.id], edge.id));
  };
  const onNodeContextMenu = (event, node) => node.data?.overviewGroup
    ? openTopologyContextMenu(event, { kind: "group", groupId: node.data?.overviewGroupId ?? node.id })
    : openTopologyContextMenu(event, { kind: "node", nodeId: node.id });
  const onEdgeContextMenu = (event, edge) => openTopologyContextMenu(event, { kind: "edge", edgeId: edge.id });
  const onPaneContextMenu = (event) => openTopologyContextMenu(event, { kind: "pane" });
  const onNodeDragStop = (_event, node) => {
    const active = liveTopologyMutationWorkspace();
    if (!active || denyUnappliedCanvasChange(active) ||
        validThousandFocus || fiveThousandWorkspace || tenThousandGuard) return;
    setWorkspace(setLayoutOverride(active, {
      id: node.id,
      x: node.position.x,
      y: node.parentId ? Math.max(node.position.y, ZONE_HEADER_RESERVED_HEIGHT) : node.position.y,
      width: node.measured?.width ?? node.width,
      height: node.measured?.height ?? node.height,
    }));
  };
  const onConnect = (connection) => {
    const active = liveTopologyMutationWorkspace();
    if (!active || denyUnappliedCanvasChange(active) ||
        validThousandFocus || fiveThousandWorkspace || tenThousandGuard) return;
    const result = createBuilderConnectionFromCanvas(active, connection);
    setDiagnostics(result.diagnostics);
    if (result.ok) setWorkspace(result.workspace);
  };
  const clearSelection = () => {
    const active = liveTopologyWorkspace();
    if (!active || denyUnappliedCanvasChange(active)) return;
    if (active.mode === "builder") setWorkspace(applyBuilderCanvasSelection(active, {}));
    else setWorkspace(setRuntimeSelection(active, []));
  };
  const openAtlasPage = (pageId, focusResourceId = null) => {
    if (!validAtlasIndex) return;
    const page = validAtlasIndex.pageById.get(pageId);
    if (!page) return;
    setTopologyViewMode(TOPOLOGY_VIEW_MODES.ATLAS);
    setAtlasPageId(page.id);
    setAtlasPageHistory((history) => history.at(-1)?.pageId === page.id ? history : [...history, { pageId: page.id, label: page.label }]);
    setTopologyFocusRoot(null);
    setTopologyFocusPage(1);
    setTopologyFocusProjection(null);
    setTopologyHierarchyScope(null);
    topologyFocusRequestRef.current += 1;
    setTopologyGroup(null);
    setTopologyViewHistory((history) => history.at(-1)?.kind === "atlas" && history.at(-1)?.pageId === page.id
      ? history
      : [...history, { kind: "atlas", pageId: page.id, label: `Atlas · ${page.label}` }]);
    setTopologyContextMenu(null);
    setTopologyContextDetails(null);
    globalThis.requestAnimationFrame?.(() => flowApi.current?.fitView?.({ duration: 180, padding: 0.12 }));
    if (focusResourceId && page.resourceIds.includes(focusResourceId)) {
      globalThis.requestAnimationFrame?.(() => {
        const target = baseFlow.nodes.find((node) => node.id === focusResourceId);
        if (target) flowApi.current?.setCenter?.(target.position.x + (target.width ?? 160) / 2, target.position.y + (target.height ?? 90) / 2, { zoom: 1.15, duration: 220 });
      });
    }
  };
  const navigateOverview = () => {
    if (topologyViewMode === TOPOLOGY_VIEW_MODES.ATLAS && firstAtlasPageId) {
      const first = validAtlasIndex?.pageById.get(firstAtlasPageId);
      setAtlasPageId(firstAtlasPageId);
      setAtlasPageHistory(first ? [{ pageId: first.id, label: first.label }] : []);
      setTopologyViewHistory(first ? [{ kind: "atlas", pageId: first.id, label: `Atlas · ${first.label}` }] : [{ kind: "overview", label: "Nätverksöversikt" }]);
      setTopologyContextMenu(null);
      setTopologyContextDetails(null);
      globalThis.requestAnimationFrame?.(() => flowApi.current?.fitView?.({ duration: 220, padding: 0.12 }));
      return;
    }
    setTopologyFocusRoot(null);
    setTopologyFocusPage(1);
    setTopologyFocusProjection(null);
    setTopologyHierarchyScope(null);
    topologyFocusRequestRef.current += 1;
    setTopologyGroup(null);
    setTopologyGroupQuery("");
    setTopologyGroupPage(1);
    setTopologyViewHistory([{ kind: "overview", label: "Nätverksöversikt" }]);
    setTopologyContextMenu(null);
    setTopologyContextDetails(null);
    flowApi.current?.fitView?.({ duration: 220, padding: 0.1 });
  };
  const topologyWorldRect = (nodeId) => {
    const byId = new Map(baseFlow.nodes.map((node) => [node.id, node]));
    const cache = new Map();
    const resolve = (id, visiting = new Set()) => {
      if (cache.has(id)) return cache.get(id);
      if (visiting.has(id)) return null;
      const node = byId.get(id);
      if (!node) return null;
      const parent = node.parentId ? resolve(node.parentId, new Set([...visiting, id])) : null;
      const value = {
        x: (parent?.x ?? 0) + Number(node.position?.x ?? 0),
        y: (parent?.y ?? 0) + Number(node.position?.y ?? 0),
        width: Number(node.width ?? 168),
        height: Number(node.height ?? 88),
      };
      cache.set(id, value);
      return value;
    };
    return resolve(nodeId);
  };
  const changeTopologyViewMode = (mode) => {
    if (!Object.values(TOPOLOGY_VIEW_MODES).includes(mode)) return;
    setTopologyViewMode(mode);
    setTopologyFocusRoot(null);
    setTopologyFocusPage(1);
    setTopologyFocusProjection(null);
    setTopologyHierarchyScope(null);
    topologyFocusRequestRef.current += 1;
    setTopologyGroup(null);
    setTopologyGroupQuery("");
    setTopologyGroupPage(1);
    if (mode === TOPOLOGY_VIEW_MODES.ATLAS) {
      const first = firstAtlasPageId ? validAtlasIndex?.pageById.get(firstAtlasPageId) : null;
      setAtlasPageId(first?.id ?? null);
      setAtlasPageHistory(first ? [{ pageId: first.id, label: first.label }] : []);
    } else {
      setAtlasPageId(null);
      setAtlasPageHistory([]);
    }
    setTopologyContextMenu(null);
    setTopologyContextDetails(null);
    const label = mode === TOPOLOGY_VIEW_MODES.NORMAL
      ? "NORMAL TOPOLOGY"
      : mode === TOPOLOGY_VIEW_MODES.CONNECTED_EXPLORER
        ? "CONNECTED EXPLORER"
        : mode === TOPOLOGY_VIEW_MODES.INVENTORY_SUMMARY
          ? "INVENTORY SUMMARY"
          : `Atlas · ${firstAtlasPageId ? validAtlasIndex?.pageById.get(firstAtlasPageId)?.label ?? firstAtlasPageId : "ingen sida"}`;
    setTopologyViewHistory(mode === TOPOLOGY_VIEW_MODES.ATLAS && firstAtlasPageId
      ? [{ kind: "atlas", pageId: firstAtlasPageId, label }]
      : [{ kind: "overview", label }]);
    globalThis.requestAnimationFrame?.(() => flowApi.current?.fitView?.({ duration: 180, padding: mode === TOPOLOGY_VIEW_MODES.INVENTORY_SUMMARY ? 0.16 : 0.12 }));
  };
  const changeTopologyCameraMode = (mode) => {
    if (mode !== "read" && mode !== "overview") return;
    setTopologyCameraMode(mode);
    const instance = flowApi.current;
    if (!instance) return;
    const readableRootId = mode === "read" && hierarchicalTopologyView
      ? hierarchicalTopologyView.rootId ?? hierarchicalTopologyView.navigationGroups[0]?.memberIds[0]
      : null;
    const readableRoot = readableRootId ? topologyWorldRect(readableRootId) : null;
    if (readableRoot && instance.setCenter) {
      // Every hierarchy READ camera is anchored to a real scope resource.
      // React Flow positions child nodes in their parent-local frame, so the
      // world-space rect must be resolved before centering; otherwise the root
      // can be rendered above the panel while the breadcrumb still says READ.
      instance.setCenter(readableRoot.x + readableRoot.width / 2, readableRoot.y + readableRoot.height / 2, { duration: 0, zoom: 1 });
    } else if (mode === "overview") {
      // Read the mounted panel identity as well as React state.  Camera
      // buttons can be clicked during the async ELK commit; a closure from
      // the pre-layout render must still select the bounded hierarchy fit.
      const boundedHierarchy = Boolean(document.querySelector(".topology-panel")?.getAttribute("data-topology-layout-bakeoff"));
      instance.fitView?.({ duration: 0, padding: boundedHierarchy ? 0.2 : 0.16, minZoom: boundedHierarchy ? 0.08 : 0.32, maxZoom: 1.05 });
    }
    else instance.fitView?.({ duration: 0, padding: 0.08, minZoom: 0.62, maxZoom: 1.35 });
  };
  const focusTopologyNode = (nodeId, label = nodeId) => {
    const active = liveTopologyWorkspace();
    if (!active || denyUnappliedCanvasChange(active, `focus:${nodeId}`)) return;
    const nodeOrder = validTenThousandFocus?.nodeOrder ?? scaledTenThousandFocus?.nodeOrder;
    if (topologyViewMode === TOPOLOGY_VIEW_MODES.ATLAS && validAtlasIndex) {
      const page = atlasPageForResource(validAtlasIndex, nodeId);
      if (page) openAtlasPage(page.id, nodeId);
    } else if (tenThousandHierarchyIndex) {
      const role = tenThousandHierarchyIndex.roleById.get(nodeId) ?? "device";
      const hierarchyLabel = role === "distribution" ? `Distribution branch: ${label}` : role === "access" ? `Access network: ${label}` : `Connected branch: ${label}`;
      setTopologyHierarchyScope({ rootId: nodeId });
      setTopologyFocusRoot(nodeId);
      setTopologyFocusPage(1);
      setTopologyViewHistory((history) => [...history, { kind: "focus", rootId: nodeId, label: hierarchyLabel, page: 1 }]);
    } else if (validTenThousandFocus) {
      setTopologyFocusRoot(nodeId);
      setTopologyFocusPage(1);
      setTopologyViewHistory((history) => [...history, { kind: "focus", rootId: nodeId, label: `Fokuserad enhet: ${label}`, page: 1 }]);
    } else if (nodeOrder?.includes(nodeId) && onScaledTenThousandFocusPage && !baseFlow.nodes.some((node) => node.id === nodeId)) {
      void onScaledTenThousandFocusPage(Math.floor(nodeOrder.indexOf(nodeId) / 100) + 1);
    } else {
      setTopologyFocusRoot(nodeId);
      setTopologyFocusPage(1);
      setTopologyViewHistory((history) => [...history, { kind: "focus", rootId: nodeId, label: `Fokuserad enhet: ${label}`, page: 1 }]);
      const target = baseFlow.nodes.find((node) => node.id === nodeId);
      if (target) flowApi.current?.setCenter?.(target.position.x + (target.width ?? 160) / 2, target.position.y + (target.height ?? 90) / 2, { zoom: 1.15, duration: 260 });
    }
    // The bounded 10k explorer is a read-only visual projection. Avoid
    // rebuilding the 10,000-row Builder selection map during navigation.
    if (!validTenThousandFocus || tenThousandHierarchyIndex) {
      if (active.mode === "builder") setWorkspace(setBuilderSelection(active, [nodeId], nodeId));
      else setWorkspace(setRuntimeSelection(active, [nodeId], nodeId));
    }
    setTopologyContextMenu(null);
  };
  useEffect(() => {
    if (!validTenThousandFocus) return undefined;
    const panel = topologyPanelRef.current;
    if (!panel) return undefined;
    const onNativeDoubleClick = (event) => {
      const resourceNode = event.target?.closest?.(".react-flow__node-resource, .react-flow__node[data-id]")?.closest?.(".react-flow__node[data-id]");
      const nodeId = resourceNode?.getAttribute?.("data-id");
      if (!nodeId || !canonicalResourceById.has(nodeId)) return;
      event.preventDefault();
      event.stopPropagation();
      const resource = canonicalResourceById.get(nodeId);
      focusTopologyNode(nodeId, resource?.label ?? nodeId);
    };
    document.addEventListener("dblclick", onNativeDoubleClick, true);
    return () => document.removeEventListener("dblclick", onNativeDoubleClick, true);
  }, [validTenThousandFocus, tenThousandHierarchyIndex, canonicalResourceById, topologyFocusRoot]);
  const goTopologyBack = () => {
    if (topologyViewMode === TOPOLOGY_VIEW_MODES.ATLAS) {
      const previous = atlasPageHistory.at(-2);
      if (!previous) return;
      setAtlasPageHistory((history) => history.slice(0, -1));
      setAtlasPageId(previous.pageId);
      setTopologyViewHistory((history) => history.length > 1 ? history.slice(0, -1) : history);
      setTopologyContextMenu(null);
      return;
    }
    setTopologyViewHistory((history) => {
      if (history.length <= 1) return history;
      const next = history.slice(0, -1);
      const previous = next.at(-1);
      if (previous?.kind === "group") {
        const group = findTopologyGroup(previous.groupId);
        if (group) {
          setTopologyGroup({ id: group.id, label: group.label, role: group.role, members: [...group.members] });
          setTopologyGroupQuery("");
          setTopologyGroupPage(previous.page ?? 1);
        }
        setTopologyFocusRoot(null);
        setTopologyFocusPage(1);
        setTopologyHierarchyScope(null);
      } else {
        setTopologyGroup(null);
        setTopologyGroupQuery("");
        setTopologyGroupPage(1);
        setTopologyFocusRoot(previous?.rootId ?? null);
        setTopologyFocusPage(previous?.page ?? 1);
        setTopologyHierarchyScope(previous?.rootId ? { rootId: previous.rootId } : null);
      }
      return next;
    });
    setTopologyContextMenu(null);
  };
  const openTopologyContextMenu = (event, menu) => {
    event.preventDefault();
    event.stopPropagation();
    setTopologyContextDetails(null);
    setTopologyContextMenu({ ...menu, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 300)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 280)) });
  };
  useEffect(() => {
    if (!validTenThousandFocus || tenThousandHierarchyIndex) return undefined;
    const onNativeContextMenu = (event) => {
      const resourceNode = event.target?.closest?.(".react-flow__node-resource, .react-flow__node[data-id]")?.closest?.(".react-flow__node[data-id]");
      const nodeId = resourceNode?.getAttribute?.("data-id");
      if (!nodeId || !canonicalResourceById.has(nodeId)) return;
      openTopologyContextMenu(event, { kind: "node", nodeId });
    };
    document.addEventListener("contextmenu", onNativeContextMenu, true);
    return () => document.removeEventListener("contextmenu", onNativeContextMenu, true);
  }, [validTenThousandFocus, tenThousandHierarchyIndex, canonicalResourceById]);
  const selectedCanonicalResource = workspace.selection.primary ? canonicalResourceById.get(workspace.selection.primary) : undefined;
  const selectedCanonicalConnection = workspace.selection.primary ? canonicalConnectionById.get(workspace.selection.primary) : undefined;
  const canonicalIncidentLinkCounts = useMemo(() => {
    const counts = new Map();
    for (const connection of canonicalNetwork.connections) {
      counts.set(connection.from.resource, (counts.get(connection.from.resource) ?? 0) + 1);
      counts.set(connection.to.resource, (counts.get(connection.to.resource) ?? 0) + 1);
    }
    return counts;
  }, [canonicalNetwork.connections]);
  const selectedCanonicalLinkCount = selectedCanonicalResource
    ? canonicalIncidentLinkCounts.get(selectedCanonicalResource.id) ?? 0
    : 0;
  const contextResource = topologyContextMenu?.nodeId ? canonicalResourceById.get(topologyContextMenu.nodeId) : undefined;
  const contextGroup = topologyContextMenu?.groupId ? findTopologyGroup(topologyContextMenu.groupId) : undefined;
  const contextConnection = topologyContextMenu?.edgeId ? canonicalConnectionById.get(topologyContextMenu.edgeId) : undefined;
  const focusTopologyResult = (result) => {
    const active = liveTopologyWorkspace();
    if (!active || denyUnappliedCanvasChange(active)) return;
    if (!canonicalResourceById.has(result.nodeId) && !baseFlow.nodes.some((node) => node.id === result.nodeId)) return;
    focusTopologyNode(result.nodeId, result.nodeLabel ?? result.nodeId);
  };
  const contextNeighbors = contextResource
    ? canonicalNetwork.connections.flatMap((connection) => connection.from.resource === contextResource.id
      ? [canonicalResourceById.get(connection.to.resource)].filter(Boolean)
      : connection.to.resource === contextResource.id
        ? [canonicalResourceById.get(connection.from.resource)].filter(Boolean)
        : []).filter((resource, index, all) => all.findIndex((candidate) => candidate.id === resource.id) === index)
    : [];
  const contextLinkCount = contextResource
    ? canonicalNetwork.connections.filter((connection) => connection.from.resource === contextResource.id || connection.to.resource === contextResource.id).length
    : 0;
  const selectedResourceAddresses = selectedCanonicalResource?.interfaces?.flatMap((iface) => iface.addresses ?? []) ?? [];
  const selectedLinkProperties = selectedCanonicalConnection?.properties ?? {};
  const selectedLinkSourcePort = selectedCanonicalConnection?.from.port;
  const selectedLinkTargetPort = selectedCanonicalConnection?.to.port;
  const topologyGroupNavigator = activeTopologyGroup ? e("section", {
    className: "topology-group-navigator",
    "data-topology-group-navigator": activeTopologyGroup.id,
  },
    e("strong", null, `${activeTopologyGroup.label} · ${topologyGroupMembers.length} documented members`),
    e("small", null, activeTopologyGroup.role === "documented-type" ? "Neutral documented type group; no physical role inferred." : `Documented role: ${activeTopologyGroup.role.toUpperCase()}`),
    e("label", null, "Sök inom grupp",
      e("input", {
        type: "search",
        value: topologyGroupQuery,
        placeholder: "ID, namn eller typ",
        "aria-label": "Sök inom grupp",
        "data-topology-group-search": "true",
        onChange: (event) => { setTopologyGroupQuery(event.target.value); setTopologyGroupPage(1); },
      })),
    e("p", { "data-topology-group-counts": "true" }, filteredTopologyGroupMembers.length
      ? `Visar ${(boundedTopologyGroupPage - 1) * 50 + 1}–${Math.min(boundedTopologyGroupPage * 50, filteredTopologyGroupMembers.length)} av ${filteredTopologyGroupMembers.length} matchande medlemmar`
      : "Inga medlemmar matchar sökningen"),
    e("div", { className: "topology-group-member-list", "data-topology-group-members": "true", role: "listbox", "aria-label": `Medlemmar i ${activeTopologyGroup.label}` },
      ...topologyGroupPageItems.map((resource) => e("button", {
        key: resource.id,
        type: "button",
        role: "option",
        "data-topology-group-member-id": resource.id,
        onClick: () => focusTopologyNode(resource.id, resource.label ?? resource.id),
      }, e("strong", null, resource.label ?? resource.id), e("small", null, `${resource.id} · ${resource.type ?? "okänd typ"}`)))),
    e("div", { className: "topology-group-pagination" },
      e("button", { type: "button", "data-topology-group-page": "previous", disabled: boundedTopologyGroupPage <= 1, onClick: () => setTopologyGroupPage((page) => Math.max(1, page - 1)) }, "Föregående"),
      e("span", { "data-topology-group-page-count": "true" }, `${boundedTopologyGroupPage} / ${topologyGroupPageCount}`),
      e("button", { type: "button", "data-topology-group-page": "next", disabled: boundedTopologyGroupPage >= topologyGroupPageCount, onClick: () => setTopologyGroupPage((page) => Math.min(topologyGroupPageCount, page + 1)) }, "Nästa"),
    ),
  ) : null;
  const atlasBoundaryReferences = atlasPageProjection?.boundaryReferences ?? [];
  const atlasPageRows = validAtlasIndex?.pages ?? [];
  const atlasPageResourceIds = atlasPageProjection?.page.resourceIds ?? [];
  const atlasPageInternalConnections = atlasPageProjection?.connections.map((connection) => ({
    id: connection.id,
    from: connection.from,
    to: connection.to,
  })) ?? [];
  const atlasResourceParentMap = atlasTopologyCanvas
    ? Object.fromEntries(atlasTopologyCanvas.nodes.filter((node) => node.type === "resource").map((node) => [node.id, node.parentId ?? null]))
    : {};
  const atlasLayoutRoutes = atlasLayout?.projection.edges.map((edge) => ({ id: edge.id, route: edge.data.route ?? null })) ?? [];
  const atlasLayoutErrorCount = atlasLayout ? atlasLayout.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length : null;
  const activeTopologyStats = atlasPageProjection
    ? {
      devices: atlasPageProjection.resources.length,
      links: atlasPageProjection.connections.length,
      groups: baseFlow.nodes.filter((node) => node.type === "zone").length,
      hiddenLinks: atlasPageProjection.page.boundaryConnectionIds.length + atlasPageProjection.page.externalConnectionIds.length,
      canonical: false,
    }
    : hierarchicalTopologyView
    ? {
      devices: hierarchicalTopologyView.nodeIds.length,
      links: hierarchicalTopologyView.visibleConnectionCount,
      groups: hierarchicalTopologyView.navigationGroups.length,
      hiddenLinks: hierarchicalTopologyView.hiddenConnectionCount,
      canonical: false,
    }
    : topologyOverview
      ? {
        devices: topologyOverview.canonicalNodes,
        links: topologyOverview.canonicalLinks,
        groups: topologyOverview.groups.length,
        hiddenLinks: 0,
        canonical: true,
      }
      : {
        devices: baseFlow.nodes.filter((node) => node.type === "resource").length,
        links: baseFlow.edges.length,
        groups: baseFlow.nodes.filter((node) => node.type === "zone").length,
        hiddenLinks: 0,
        canonical: false,
      };
  const topologyExplorer = e("aside", { className: "topology-explorer-sidebar", "data-topology-explorer": "true", "aria-label": "Topology Explorer" },
    e("div", { className: "topology-explorer-heading" },
      e("div", null, e("strong", null, topologyViewHistory.at(-1)?.label ?? "Nätverksöversikt"), e("small", { "data-topology-active-mode": topologyViewMode }, topologyViewMode === TOPOLOGY_VIEW_MODES.NORMAL
      ? "Verkliga resurser, zoner och deklarerade länkar · redigerbar Builder-yta"
      : topologyViewMode === TOPOLOGY_VIEW_MODES.CONNECTED_EXPLORER
        ? "Anslutningsbaserad, bunden delgraf · sök, fokusera och expandera verkliga grannar"
        : topologyViewMode === TOPOLOGY_VIEW_MODES.INVENTORY_SUMMARY
          ? "Sekundär inventeringsöversikt · gruppkort och sammanfattningskanter är inte fysiska länkar"
          : "ATLAS · aktiv sida med interna deklarerade länkar och klickbara fortsättningsreferenser")),
      e("span", { className: "topology-truth-badge" }, activeTopologyStats.canonical ? "CANONICAL INVENTORY" : "VISIBLE SOURCE VIEW"),
    ),
    e("div", { className: "topology-stat-strip", "data-topology-active-stats": "true" },
      e("div", { className: "topology-stat", "data-topology-active-device-count": String(activeTopologyStats.devices) }, e("strong", null, String(activeTopologyStats.devices)), e("span", null, "aktiva enheter")),
      e("div", { className: "topology-stat", "data-topology-active-link-count": String(activeTopologyStats.links) }, e("strong", null, String(activeTopologyStats.links)), e("span", null, "aktiva länkar")),
      e("div", { className: "topology-stat topology-stat-presentation", "data-topology-active-group-count": String(activeTopologyStats.groups) }, e("strong", null, String(activeTopologyStats.groups)), e("span", null, "presentationsgrupper")),
      e("div", { className: "topology-stat topology-stat-canonical", "data-topology-canonical-counts": "true" }, e("strong", null, `${canonicalNetwork.resources.length} · ${canonicalNetwork.connections.length}`), e("span", null, "hela canonical-nätet")),
    ),
    e("span", { className: "sr-only", "data-topology-legacy-counts": "true" }, `${canonicalNetwork.resources.length} dokumenterade enheter · ${canonicalNetwork.connections.length} deklarerade länkar`),
    e("p", { className: "topology-stat-note", "data-topology-active-stat-note": "true" }, activeTopologyStats.hiddenLinks > 0
      ? `${activeTopologyStats.hiddenLinks} deklarerade länkar ligger utanför aktuell vy; de är inte aggregerade.`
      : activeTopologyStats.canonical
        ? "Gruppkort och sammanfattningskanter är presentation; de räknas inte som fysiska enheter eller länkar."
        : "Presentationsgrupper är visuella behållare och räknas inte som fysiska nätverksenheter."),
    topologyOverview && topologyOverviewReadyIdentity === topologyOverviewIdentity ? e("section", { "data-topology-overview": topologyOverview.strategy },
      e("strong", null, "Logisk nätverksöversikt"),
      e("p", null, `${topologyOverview.canonicalNodes} canonical devices · ${topologyOverview.canonicalLinks} declared links · ${topologyOverview.groups.length} bounded visual groups`),
      e("small", null, topologyOverview.strategy === "documented-role-bands"
        ? "Core / Distribution / Access / Client order is used only because the source declared those roles."
        : "Neutral type bands are used because the source does not prove Core / Distribution / Access roles."),
      e("small", null, "Group cards and dashed summary edges are visual summaries; click a group to open a real source device."),
    ) : null,
    e("section", { className: "topology-icon-overview", "data-topology-icon-overview": "true", "aria-label": "Ikonöversikt" },
      e("strong", null, "Ikonöversikt"),
      e("small", null, "Ikonerna följer dokumenterad semantik; VLAN och länkattribut visas som metadata, inte som extra enheter."),
      e("div", { className: "topology-icon-overview-grid" },
        ...iconRegistry().filter((icon) => ["switch", "router", "firewall", "server", "client", "hypervisor", "wireless", "storage", "vlan", "network-segment", "place", "presentation-group", "link-attribute", "service"].includes(icon.key)).map((icon) =>
          e("span", { key: icon.key, className: "topology-icon-overview-item", "data-icon-overview-key": icon.key, title: icon.title },
            e(SemanticIcon, { iconKey: icon.key, label: icon.accessibleName }),
            e("small", null, icon.title),
          )),
      ),
    ),
    atlasPageProjection ? e("section", {
      className: "atlas-page-status",
      "data-atlas-page": atlasPageProjection.page.id,
      "data-atlas-page-basis": atlasPageProjection.page.basis,
      "data-atlas-render-mode": atlasPageProjection.page.renderMode,
      "data-atlas-page-count": String(atlasPageRows.length),
    },
      e("strong", null, `ATLAS · ${atlasPageProjection.page.label}`),
      e("p", null, `${atlasPageProjection.resources.length} dokumenterade enheter · ${atlasPageProjection.connections.length} interna deklarerade länkar`),
      e("small", null, `${atlasPageProjection.page.boundaryConnectionIds.length} boundary-länkar · ${atlasPageProjection.page.externalConnectionIds.length} externa länkar i denna sida; inget är tyst borttaget.`),
      atlasPageProjection.page.renderMode === "link-list" ? e("strong", { className: "topology-hierarchy-incomplete", "data-atlas-link-list": "true" }, atlasPageProjection.page.blockedReason) : null,
      atlasLayout?.quality ? e("small", { "data-atlas-layout-quality": atlasLayout.quality.hardGate, "data-atlas-layout-quality-gate": atlasLayout.quality.baselineComparison.qualityGate, "data-atlas-layout-error-count": String(atlasLayoutErrorCount ?? 0), "data-atlas-layout-winner": atlasLayout.quality.winnerId }, `ELK bake-off: ${atlasLayout.quality.hardGate} · ${atlasLayout.quality.winnerId}`) : e("small", { "data-atlas-layout-status": "PENDING", "data-atlas-layout-error-count": "PENDING" }, "ELK-layout: väntar på identitetsmatchat svar"),
      atlasLayout?.diagnostics?.length ? e("small", { "data-atlas-layout-diagnostic": "true" }, atlasLayout.diagnostics[0].message) : null,
      e("div", { className: "atlas-page-list", "data-atlas-page-list": "true", role: "listbox", "aria-label": "ATLAS-sidor" },
        ...atlasPageRows.map((page) => e("button", {
          key: page.id,
          type: "button",
          role: "option",
          "aria-selected": page.id === atlasPageProjection.page.id,
          "data-atlas-page-option": page.id,
          onClick: () => openAtlasPage(page.id),
        }, `${page.label} · ${page.resourceIds.length} enheter`)),
      ),
      e("div", { className: "atlas-boundary-list", "data-atlas-boundary-list": "true" },
        e("strong", null, "Fortsättningsreferenser"),
        atlasBoundaryReferences.length
          ? atlasBoundaryReferences.map((reference) => e("button", {
            key: `${reference.originalConnectionId}:${reference.localResourceId}:${reference.localPortId ?? ""}`,
            type: "button",
            className: "atlas-boundary-button",
            "data-atlas-boundary-connection": reference.originalConnectionId,
            "data-atlas-destination-page": reference.destinationPageId,
            onClick: () => openAtlasPage(reference.destinationPageId, reference.remoteResourceId),
          }, `${reference.originalConnectionId} · ${reference.remoteResourceId}${reference.remotePortId ? `:${reference.remotePortId}` : ""}`))
          : e("small", null, "Inga boundary-länkar på denna sida."),
      ),
    ) : null,
    hierarchicalTopologyView ? e("section", {
      className: "topology-hierarchy-status",
      "data-topology-hierarchy": hierarchicalTopologyView.kind === "overview" ? "overview" : hierarchicalTopologyView.rootId,
      "data-topology-hierarchy-hidden-links": String(hierarchicalTopologyView.hiddenConnectionCount),
      "data-topology-hierarchy-hidden-boundary-links": String(hierarchicalTopologyView.hiddenBoundaryConnectionCount),
      "data-topology-hierarchy-layout": hierarchicalTopologyView.layoutStrategy,
      ...(hierarchicalTopologyLayout ? { "data-topology-layout-hard-gate": hierarchicalTopologyLayout.quality.hardGate, "data-topology-layout-winner": hierarchicalTopologyLayout.quality.winnerId } : {}),
    },
      e("strong", null, hierarchicalTopologyView.roleLabel),
      e("p", null, hierarchicalTopologyView.kind === "overview"
        ? `${tenThousandHierarchyIndex?.roleCounts.core ?? 0} core · ${tenThousandHierarchyIndex?.roleCounts.distribution ?? 0} distribution · ${hierarchicalTopologyView.nodeIds.length} synliga källnoder`
        : `${hierarchicalTopologyView.nodeIds.length} synliga källnoder · ${hierarchicalTopologyView.visibleConnectionCount} synliga deklarerade länkar`),
      e("small", { "data-topology-hierarchy-groups": String(hierarchicalTopologyView.navigationGroups.length) }, `${hierarchicalTopologyView.navigationGroups.length} Arvidsjaur-stilade presentationsgrupper`),
      e("small", null, `${hierarchicalTopologyView.hiddenConnectionCount} deklarerade länkar ligger utanför vyn; ${hierarchicalTopologyView.hiddenBoundaryConnectionCount} korsar vygränsen och är inte aggregerade.`),
      hierarchicalTopologyView.incompleteView ? e("strong", { className: "topology-hierarchy-incomplete", "data-topology-hierarchy-incomplete": "true" }, "INCOMPLETE VIEW · länkbudget överskriden; inga länkar döljs tyst") : null,
      hierarchicalTopologyLayout?.diagnostics?.length ? e("strong", { className: "topology-hierarchy-incomplete", "data-topology-layout-diagnostic": "true" }, hierarchicalTopologyLayout.diagnostics[0]?.message) : null,
      hierarchicalTopologyView.pageCount > 1 ? e("small", null, `Grenvy ${hierarchicalTopologyView.page}/${hierarchicalTopologyView.pageCount}`) : null,
    ) : null,
    topologyGroupNavigator,
    hierarchicalFocusCounts ? e("p", { "data-topology-focus-counts": "true", "data-topology-total-root-links": String(hierarchicalFocusCounts.totalRootLinks), "data-topology-visible-root-links": String(hierarchicalFocusCounts.visibleRootLinks), "data-topology-hidden-root-links": String(hierarchicalFocusCounts.hiddenRootLinks), "data-topology-visible-neighbor-links": String(hierarchicalFocusCounts.visibleNeighborLinks), "data-topology-total-visible-links": String(hierarchicalFocusCounts.totalVisibleLinks) }, `${hierarchicalFocusCounts.visibleNeighbors} synliga av ${hierarchicalFocusCounts.totalNeighbors} direktanslutna grannar · ${hierarchicalFocusCounts.visibleRootLinks} av ${hierarchicalFocusCounts.totalRootLinks} direktlänkar synliga · ${hierarchicalFocusCounts.visibleNeighborLinks} synliga grannlänkar · ${hierarchicalFocusCounts.totalVisibleLinks} länkar totalt i vyn`) : localFocusPage ? e("p", { "data-topology-focus-counts": "true", "data-topology-total-root-links": String(localFocusPage.totalRootLinks ?? localFocusPage.totalLinks), "data-topology-visible-root-links": String(localFocusPage.visibleRootLinks ?? localFocusPage.visibleLinks), "data-topology-hidden-root-links": String(localFocusPage.hiddenRootLinks ?? localFocusPage.hiddenLinks), "data-topology-visible-neighbor-links": String(localFocusPage.visibleNeighborLinks ?? 0), "data-topology-total-visible-links": String(localFocusPage.totalVisibleLinks ?? localFocusPage.visibleLinks) }, `${localFocusPage.visibleNeighbors} synliga av ${localFocusPage.totalNeighbors} direktanslutna grannar · ${localFocusPage.visibleRootLinks ?? localFocusPage.visibleLinks} av ${localFocusPage.totalRootLinks ?? localFocusPage.totalLinks} direktlänkar synliga · ${localFocusPage.visibleNeighborLinks ?? 0} synliga grannlänkar · ${localFocusPage.totalVisibleLinks ?? localFocusPage.visibleLinks} länkar totalt i vyn`) : null,
    selectedCanonicalConnection ? e("section", { className: "topology-link-inspector", "data-topology-selected-link": selectedCanonicalConnection.id, "aria-label": `Vald länk ${selectedCanonicalConnection.id}` },
      e("strong", null, selectedCanonicalConnection.id),
      e("small", null, `${selectedCanonicalConnection.from.resource} → ${selectedCanonicalConnection.to.resource}`),
      e("small", null, `Källport: ${selectedLinkSourcePort ?? "NOT DOCUMENTED"} · Målport: ${selectedLinkTargetPort ?? "NOT DOCUMENTED"}`),
      e("small", null, `Typ: ${selectedCanonicalConnection.kind} · VLAN: ${typeof selectedLinkProperties.vlan === "number" || typeof selectedLinkProperties.vlan === "string" ? `VLAN ${selectedLinkProperties.vlan}` : "NOT DOCUMENTED"}`),
      e("small", null, `Status: ${selectedLinkProperties.enabled === false ? "DISABLED" : "DECLARED"}`),
      e("button", { type: "button", "data-topology-focus-link": selectedCanonicalConnection.id, onClick: () => { focusTopologyNode(selectedCanonicalConnection.from.resource, selectedCanonicalConnection.from.resource); } }, "Fokusera båda ändpunkter"),
    ) : selectedCanonicalResource ? e("section", { "data-topology-selected-details": selectedCanonicalResource.id },
      e("strong", null, selectedCanonicalResource.label ?? selectedCanonicalResource.id),
      e("small", null, `${selectedCanonicalResource.id} · ${selectedCanonicalResource.type ?? "okänd typ"}`),
      selectedResourceAddresses.length ? e("small", null, selectedResourceAddresses.join(", ")) : null,
      e("small", null, `${selectedCanonicalLinkCount} deklarerade länkar`),
      e("button", { type: "button", onClick: () => focusTopologyNode(selectedCanonicalResource.id, selectedCanonicalResource.label ?? selectedCanonicalResource.id) }, "Öppna fokuserad topologi"),
    ) : e("p", { className: "helper-note" }, "Välj en dokumenterad enhet eller länk för detaljer."),
  );
  const topologyActiveSummary = e("section", {
    className: "topology-active-summary",
    "data-topology-active-summary": "true",
    "aria-label": "Aktiv topology",
  },
    e("strong", null, topologyViewHistory.at(-1)?.label ?? "Nätverksöversikt"),
    e("span", null, `${activeTopologyStats.devices} aktiva enheter · ${activeTopologyStats.links} aktiva länkar · ${activeTopologyStats.groups} presentationsgrupper`),
    e("small", null, `${canonicalNetwork.resources.length} · ${canonicalNetwork.connections.length} i hela canonical-nätet · gruppkort räknas inte som fysiska enheter`),
  );
  return e("div", { className: "topology-column" },
    e("section", { className: "topology-navigation", "aria-label": "Topology navigation" },
      e("div", { className: "topology-mode-switcher", "data-topology-view-mode": topologyViewMode, role: "group", "aria-label": "Topology view mode" },
        e("strong", null, "Topology mode"),
        ...[
          [TOPOLOGY_VIEW_MODES.NORMAL, "NORMAL TOPOLOGY"],
          [TOPOLOGY_VIEW_MODES.CONNECTED_EXPLORER, "CONNECTED EXPLORER"],
          [TOPOLOGY_VIEW_MODES.INVENTORY_SUMMARY, "INVENTORY SUMMARY"],
          [TOPOLOGY_VIEW_MODES.ATLAS, "ATLAS PAGES"],
        ].map(([mode, label]) => e("button", {
          key: mode,
          type: "button",
          "data-topology-mode": mode,
          "aria-pressed": topologyViewMode === mode,
          onClick: () => changeTopologyViewMode(mode),
        }, label)),
      ),
      e("div", { className: "topology-camera-switcher", "data-topology-camera-mode": topologyCameraMode, role: "group", "aria-label": "Kameraläge" },
        e("strong", null, "Kameraläge"),
        e("button", { type: "button", "data-topology-camera": "read", "aria-pressed": topologyCameraMode === "read", onClick: () => changeTopologyCameraMode("read") }, "Läsvy"),
        e("button", { type: "button", "data-topology-camera": "overview", "aria-pressed": topologyCameraMode === "overview", onClick: () => changeTopologyCameraMode("overview") }, "Översikt"),
      ),
      e("nav", { className: "topology-breadcrumbs", "data-topology-breadcrumbs": "true", "aria-label": "Topology breadcrumb" },
        ...topologyViewHistory.map((item, index) => e(React.Fragment, { key: `${item.kind}:${item.rootId ?? "overview"}:${index}` },
          index > 0 ? e("span", { "aria-hidden": "true" }, " › ") : null,
          e("button", { type: "button", "data-topology-breadcrumb": item.kind, onClick: () => {
            setTopologyViewHistory((history) => history.slice(0, index + 1));
            if (item.kind === "atlas") {
              if (item.pageId) {
                setTopologyViewMode(TOPOLOGY_VIEW_MODES.ATLAS);
                setAtlasPageId(item.pageId);
                setAtlasPageHistory((history) => {
                  const position = history.findIndex((entry) => entry.pageId === item.pageId);
                  return position >= 0 ? history.slice(0, position + 1) : [...history, { pageId: item.pageId, label: item.label }];
                });
              }
              setTopologyFocusRoot(null);
              setTopologyFocusPage(1);
              setTopologyHierarchyScope(null);
              setTopologyGroup(null);
            } else if (item.kind === "group") {
              const group = findTopologyGroup(item.groupId);
              if (group) setTopologyGroup({ id: group.id, label: group.label, role: group.role, members: [...group.members] });
              setTopologyGroupQuery("");
              setTopologyGroupPage(item.page ?? 1);
              setTopologyFocusRoot(null);
              setTopologyFocusPage(1);
            } else {
              setTopologyGroup(null);
              setTopologyGroupQuery("");
              setTopologyGroupPage(1);
              setTopologyFocusRoot(item.rootId ?? null);
              setTopologyFocusPage(item.page ?? 1);
              setTopologyHierarchyScope(item.rootId ? { rootId: item.rootId } : null);
            }
            setTopologyContextMenu(null);
          } }, item.label))),
        e("button", { type: "button", onClick: goTopologyBack, disabled: topologyViewHistory.length <= 1, "data-topology-back": "true" }, "Tillbaka"),
        e("button", { type: "button", onClick: navigateOverview, disabled: topologyViewHistory.length <= 1, "data-topology-overview": "true" }, "Nätverksöversikt")),
      validThousandFocus ? e("div",{"data-scale-p2b1-focus-view":"SOURCE_ROW_NOT_SITE"},
        e("p",{"data-scale-p2b1-source-counts":"true"},
          validThousandFocus.canonicalNodes+" original Builder devices and "+
          validThousandFocus.canonicalLinks+" original port-linked references retained; "+
          (validHierarchyFocus?.focusedNodes??validThousandFocus.focusedNodes)+" drawn devices and "+
          (validHierarchyFocus?.focusedEdges??validThousandFocus.focusedEdges)+" drawn source edges. "+
          (validHierarchyFocus?.hiddenOriginalLinks??validThousandFocus.hiddenOriginalLinks)+" source links outside this view."),
        e("p",null,"Source-row pages are NOT buildings, floors, verified cables or Engine results. Focus view is read-only; the full Builder source remains editable."),
        e("button",{type:"button","data-scale-p2b2-open":"true",
          disabled:scaledThousandFocusBusy,onClick:onReviewDeclaredOfficeHierarchy},
          "Declare site / building / floor membership (separate presentation)"),
        validDeclaredHierarchy ? e("section",{
          "data-scale-p2b2-summary":"READY_FOR_PRESENTATION",
          "data-scale-p2b2-original-count":String(validThousandFocus.canonicalNodes),
          "data-scale-p2b2-member-count":String(validDeclaredHierarchy.validated.memberships.length),
          "data-scale-p2b2-unassigned-count":String(validDeclaredHierarchy.validated.unassignedDeviceIds.length),
          "data-scale-p2b2-cross-site-count":String(validDeclaredHierarchy.validated.crossSiteOriginalLinks.length)
        },
          e("strong",null,"MODELED_NOT_PHYSICAL · user-approved presentation labels only"),
          e("p",null,validDeclaredHierarchy.validated.declaredSites.length+" manually entered sites · "+
            validDeclaredHierarchy.validated.declaredBuildings.length+" buildings · "+
            validDeclaredHierarchy.validated.declaredFloors.length+" floors."),
          e("p",null,validDeclaredHierarchy.validated.memberships.length+" original devices manually assigned, "+
            validDeclaredHierarchy.validated.unassignedDeviceIds.length+" original devices unassigned."),
          e("p",null,validDeclaredHierarchy.validated.crossSiteOriginalLinks.length+
            " references to exact original cross-site port links. No synthetic aggregate cable is drawn."),
          e("p",null,"Original DOCX/ODT hash: "+
            validDeclaredHierarchy.validated.sourceOriginalSha256+" · full Builder hash: "+
            validDeclaredHierarchy.validated.sourceModelHash)
        ):null,
        validDeclaredHierarchy ? e(DeclaredOfficeHierarchyNavigation,{
          key:validDeclaredHierarchy.version,
          approved:validDeclaredHierarchy.validated,
          focus:validHierarchyFocus,
          busy:declaredOfficeFocusBusy,
          canonicalDeviceIds:workspace.source.resources.map(n=>n.id),
          onNavigate:onFocusDeclaredOfficeHierarchy,
          onRestore:onRestoreDeclaredOfficeHierarchyFocus
        }):null,
        e("label",null,"Original device source-row group",
          e("select",{"data-scale-p2b1-focus-page":"true",
            value:String(validThousandFocus.page),disabled:scaledThousandFocusBusy,
            onChange:event=>void onScaledThousandFocusPage(Number(event.currentTarget.value))},
            ...Array.from({length:10},(_,i)=>e("option",{key:i,value:String(i+1)},
              "Original Nodes rows "+(i*100+1)+"–"+((i+1)*100))))),
        e("label",null,"Find approved original device ID",
          e("input",{"data-scale-p2b1-focus-search":"true",
            value:scaledThousandDeviceQuery,disabled:scaledThousandFocusBusy,
            onChange:event=>setScaledThousandDeviceQuery(event.currentTarget.value),
            placeholder:"Exact original device ID"})),
        e("button",{"data-scale-p2b1-focus-search-go":"true",
          type:"button",disabled:scaledThousandFocusBusy||
            !validThousandFocus.nodeOrder.includes(scaledThousandDeviceQuery),
          onClick:()=>{
            const index=validThousandFocus.nodeOrder.indexOf(scaledThousandDeviceQuery);
            if(index>=0)void onScaledThousandFocusPage(Math.floor(index/100)+1);
          }},"Focus original device"),
        scaledThousandFocusBusy ? e("p",{"data-scale-p2b1-focus-busy":"true"},
          "Computing a bounded view from the unmodified compiled source…") : null
      ) : null,
      validTenThousandFocus?e("div",{[validTenThousandFocus.sourceKind==="office-p4c3b"?"data-scale-p4c3b-focus-view":validTenThousandFocus.sourceKind==="xlsx-p4e1"?"data-scale-p4e1-focus-view":"data-scale-p4b1-focus-view"]:"SOURCE_ROW_NOT_SITE"},
        e("p",{[validTenThousandFocus.sourceKind==="office-p4c3b"?"data-scale-p4c3b-source-counts":validTenThousandFocus.sourceKind==="xlsx-p4e1"?"data-scale-p4e1-source-counts":"data-scale-p4b1-source-counts"]:"true"},
          validTenThousandFocus.canonicalNodes+" canonical source devices and "+
          validTenThousandFocus.canonicalLinks+" explicitly source-declared links retained; "+
          validTenThousandFocus.focusedNodes+" bounded drawn devices, "+
          validTenThousandFocus.focusedEdges+" original links drawn, "+
          validTenThousandFocus.hiddenOriginalLinks+" original links remain offscreen."),
        validTenThousandFocus.editedBounded
          ?e("p",{[validTenThousandFocus.sourceKind==="xlsx-p4e1"?"data-scale-p4e2-edited-focus":validTenThousandFocus.sourceKind==="ods-p4f2"?"data-scale-p4f3-edited-focus":"data-scale-p4c4a-edited-focus"]:"ADDED_UNLINKED_ONLY"},
            "Separately reviewed, append-only editable Office Builder: 10,000 unchanged original devices + all 10,000 original exact port links; exactly one locally authored unconnected device has its own isolated page 101. No physical cable or Engine proof.")
          :null,
        validTenThousandFocus.editedBounded&&validTenThousandFocus.page===101
          ?e("p",{[validTenThousandFocus.sourceKind==="xlsx-p4e1"?"data-scale-p4e2-added-page":validTenThousandFocus.sourceKind==="ods-p4f2"?"data-scale-p4f3-added-page":"data-scale-p4c4a-added-page"]:validTenThousandFocus.sourceKind==="xlsx-p4e1"?"ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_XLSX_ROW":validTenThousandFocus.sourceKind==="ods-p4f2"?"ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_ODS_ROW":"ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_OFFICE_ROW"},
            "Page 101: independently authored unlinked Builder device ID "+
            validTenThousandFocus.addedResourceId+
            ". No original or inferred links drawn. Full user label (unaltered): "+
            validTenThousandFocus.addedResourceOriginalLabel)
          :null,
        e("p",{[validTenThousandFocus.sourceKind==="office-p4c3b"?"data-scale-p4c3b-active-page":validTenThousandFocus.sourceKind==="ods-p4f2"?"data-scale-p4f2-active-page":validTenThousandFocus.sourceKind==="xlsx-p4e1"?"data-scale-p4e1-active-page":"data-scale-p4b1-active-page"]:String(validTenThousandFocus.page)},
          "Original "+(validTenThousandFocus.sourceKind==="office-p4c3b"?"DOCX/ODT":validTenThousandFocus.sourceKind==="ods-p4f2"?"ODS":validTenThousandFocus.sourceKind==="xlsx-p4e1"?"XLSX":"CSV")+" source rows "+validTenThousandFocus.rowFirst+"–"+
          validTenThousandFocus.rowLast+". NOT sites, discovered physical cables or Engine evidence."),
        validTenThousandFocus.layoutStrategy === "bounded-deterministic-topology" || validTenThousandFocus.layoutStrategy === "bounded-deterministic-grid" ? e("p", { "data-scale-p4b1-layout-diagnostic": "FALLBACK", role: "status" }, "ELK-layouten validerade inte denna begränsade vy; en deterministisk, topologimedveten och bunden layout används och behåller alla valda källnoder och länkar.") : null,
        tenThousandTopologyProjection ? e("p", { "data-scale-p4b1-focused-subgraph": "true", role: "status" }, `Fokuserad kanonisk delgraf: ${tenThousandTopologyProjection.focusPage.visibleNeighbors} grannar på sida ${tenThousandTopologyProjection.focusPage.page}/${tenThousandTopologyProjection.focusPage.pageCount}; ${tenThousandTopologyProjection.layoutStrategy === "elk.layered" ? "ELK" : "topologimedveten fallback"}-layout.`) : null,
        e("label",null,"Original "+(validTenThousandFocus.sourceKind==="office-p4c3b"?"Office":validTenThousandFocus.sourceKind==="ods-p4f2"?"ODS":validTenThousandFocus.sourceKind==="xlsx-p4e1"?"XLSX":"CSV")+" device row page",
          e("select",{[validTenThousandFocus.sourceKind==="office-p4c3b"?"data-scale-p4c3b-focus-page":validTenThousandFocus.sourceKind==="ods-p4f2"?"data-scale-p4f2-focus-page":validTenThousandFocus.sourceKind==="xlsx-p4e1"?"data-scale-p4e1-focus-page":"data-scale-p4b1-focus-page"]:"true",
            value:String(validTenThousandFocus.page),disabled:scaledTenThousandFocusBusy,
            onChange:event=>void onScaledTenThousandFocusPage(Number(event.currentTarget.value))},
            ...Array.from({length:validTenThousandFocus.pageCount},(_,i)=>
              e("option",{key:i,value:String(i+1)},
                i>=100?"Locally added unconnected Builder device (NOT original imported data)":
                "Original "+(validTenThousandFocus.sourceKind==="office-p4c3b"?"Office":validTenThousandFocus.sourceKind==="ods-p4f2"?"ODS":validTenThousandFocus.sourceKind==="xlsx-p4e1"?"XLSX":"CSV")+" device rows "+(i*100+1)+"–"+((i+1)*100))))),
        e("label",null,"Exact source device ID",
          e("input",{[validTenThousandFocus.sourceKind==="office-p4c3b"?"data-scale-p4c3b-focus-search":"data-scale-p4b1-focus-search"]:"true",
            value:scaledTenThousandDeviceQuery,disabled:scaledTenThousandFocusBusy,
            placeholder:"Exact imported original device ID",
            onChange:event=>setScaledTenThousandDeviceQuery(event.currentTarget.value)})),
        e("button",{type:"button",[validTenThousandFocus.sourceKind==="office-p4c3b"?"data-scale-p4c3b-focus-search-go":"data-scale-p4b1-focus-search-go"]:"true",
          disabled:scaledTenThousandFocusBusy||
            !validTenThousandFocus.nodeOrder.includes(scaledTenThousandDeviceQuery),
          onClick:()=>{
            const i=validTenThousandFocus.nodeOrder.indexOf(scaledTenThousandDeviceQuery);
            if(i>=0)void onScaledTenThousandFocusPage(Math.floor(i/100)+1);
          }},"Focus exact original "+(validTenThousandFocus.sourceKind==="office-p4c3b"?"Office":validTenThousandFocus.sourceKind==="ods-p4f2"?"ODS":validTenThousandFocus.sourceKind==="xlsx-p4e1"?"XLSX":"CSV")+" source ID")
      ):tenThousandGuard&&!validFiveThousandFocus&&!fiveThousandView.guarded
        ?e("div",{
            "data-scale-p4b1-stale":"BLOCKED",
            ...(scaledTenThousandSessionActive&&scaledTenThousandFocus?.sourceKind==="xlsx-p4e1"
              ?{"data-scale-p4e1-stale":"BLOCKED","data-scale-p4e2-stale":"REVIEW_REQUIRED"}:{}),
            ...(scaledTenThousandSessionActive&&scaledTenThousandFocus?.sourceKind==="ods-p4f2"
              ?{"data-scale-p4f3-stale":"REVIEW_REQUIRED"}:{}),
            ...(scaledTenThousandSessionActive&&
                scaledTenThousandFocus?.sourceKind==="office-p4c3b"
              ?{"data-scale-p4c4a-stale":"REVIEW_REQUIRED"}:{})
          },
          e("p",null,"The full large canonical source remains editable and exportable. No full-graph layout, Runtime/Engine verification or stale bounded graph may be displayed after changes; a separate review is required."),
          scaledTenThousandSessionActive&&
          (scaledTenThousandFocus?.sourceKind==="office-p4c3b"||scaledTenThousandFocus?.sourceKind==="xlsx-p4e1"||scaledTenThousandFocus?.sourceKind==="ods-p4f2")&&
          workspace.mode==="builder"&&
          (workspace.compile.status==="valid"||
            ((scaledTenThousandFocus.sourceKind==="xlsx-p4e1"||
              scaledTenThousandFocus.sourceKind==="ods-p4f2")&&
             workspace.source.resources.length!==10001))&&
          scaledTenThousandFocus.source!==workspace.source&&
          !scaledTenThousandFocusBusy
            ?e("button",{type:"button",
               [scaledTenThousandFocus.sourceKind==="xlsx-p4e1"?"data-scale-p4e2-rebuild-bounded":scaledTenThousandFocus.sourceKind==="ods-p4f2"?"data-scale-p4f3-rebuild-bounded":"data-scale-p4c4a-rebuild-bounded"]:"REVIEW_REQUIRED",
               onClick:()=>void onReviewEditedTenThousandFocus()},
               "Separately review unchanged original 10,000 Office devices/10,000 port links and exactly ONE appended unlinked Builder device; restore 101 bounded pages")
            :null)
        :null,
      validFiveThousandFocus ? e("div",{"data-scale-p3c2-focus-view":"SOURCE_ROW_NOT_SITE"},
        e("p",{"data-scale-p3c2-source-counts":"true"},
          validFiveThousandFocus.editedBounded
          ?validFiveThousandFocus.canonicalNodes+(validFiveThousandFocus.twoEditedBounded?" canonical Builder devices (5,000 original Office rows + exactly two separately reviewed locally authored unlinked devices), and ":" canonical Builder devices (5,000 original Office rows + exactly one locally authored unlinked device), and ")+
            validFiveThousandFocus.canonicalLinks+" original source-declared port links retained; "+
            validFiveThousandFocus.focusedNodes+" bounded drawn devices and "+
            validFiveThousandFocus.focusedEdges+" original links visible, "+
            validFiveThousandFocus.hiddenOriginalLinks+" original links outside current view."
          :validFiveThousandFocus.canonicalNodes+" original Builder devices and "+
            validFiveThousandFocus.canonicalLinks+" source-declared port links retained; "+
            validFiveThousandFocus.focusedNodes+" drawn devices, "+
            validFiveThousandFocus.focusedEdges+" original links visible, "+
            validFiveThousandFocus.hiddenOriginalLinks+" links outside current view."),
        e("p",null,"Original source row pages are not geographical sites or verified physical links. Canonical Builder source remains editable."),
        validFiveThousandFocus.twoEditedBounded
          ?e("p",{"data-scale-p3d3-edited-focus":"TWO_ADDED_UNLINKED_ONLY"},
              "Separately reviewed second append-only Builder focus: 5,000 original Office nodes, all original port links and two individually appended, unconnected Builder resources. No inferred link or physical truth.")
          :validFiveThousandFocus.editedBounded
          ?e("p",{"data-scale-p3d2-edited-focus":"ADDED_UNLINKED_ONLY"},
              "Separately reviewed add-only Builder focus. The 5,001st device is a locally authored, unconnected resource, not an original Office row or inferred cable.")
          :null,
        validFiveThousandFocus.twoEditedBounded&&validFiveThousandFocus.page>=51
          ?e("p",{"data-scale-p3d3-added-page":"ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_OFFICE_ROW"},
              "Page "+validFiveThousandFocus.page+": only a separately reviewed manually appended unlinked Builder resource, exact ID "+
              validFiveThousandFocus.addedResourceId+". No original or inferred links drawn. Full Builder label (not altered): "+
              validFiveThousandFocus.addedResourceOriginalLabel)
          :validFiveThousandFocus.editedBounded&&validFiveThousandFocus.page===51
          ?e("p",{"data-scale-p3d2-added-page":"ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_OFFICE_ROW"},
              "Page 51: only the manually appended unlinked Builder resource. No original or inferred links were drawn. Full Builder label (not altered): "+
              validFiveThousandFocus.addedResourceOriginalLabel)
          :null,
        e("label",null,"Exact original device row page",
          e("select",{"data-scale-p3c2-focus-page":"true",
            value:String(validFiveThousandFocus.page),disabled:scaledFiveThousandFocusBusy,
            onChange:event=>void onScaledFiveThousandFocusPage(Number(event.currentTarget.value))},
            ...Array.from({length:validFiveThousandFocus.pageCount},
              (_,i)=>e("option",{key:i,value:String(i+1)},
                i>=50?"Locally added unconnected Builder device "+(i-49)+" (NOT an original Office row)"
                  :"Original source devices "+(i*100+1)+"–"+((i+1)*100))))),
        e("label",null,"Exact original source device ID",
          e("input",{"data-scale-p3c2-exact-id-search":"true",
            value:scaledFiveThousandDeviceQuery,disabled:scaledFiveThousandFocusBusy,
            placeholder:"Exact approved original device ID",
            onChange:event=>setScaledFiveThousandDeviceQuery(event.currentTarget.value)})),
        e("button",{type:"button","data-scale-p3c2-exact-id-search-confirm":"true",
          disabled:scaledFiveThousandFocusBusy||
            !validFiveThousandFocus.nodeOrder.includes(scaledFiveThousandDeviceQuery),
          onClick:()=>{
            const index=validFiveThousandFocus.nodeOrder.indexOf(scaledFiveThousandDeviceQuery);
            if(index>=0)void onScaledFiveThousandFocusPage(Math.floor(index/100)+1);
          }},"Focus original device"),
        scaledFiveThousandFocusBusy?e("p",{"data-scale-p3c2-focus-busy":"true"},
          "Laying out only selected original source rows…"):null
      ):fiveThousandWorkspace?e("div",{
        "data-scale-p3d1-edited-source":"BOUNDED_REVIEW_REQUIRED",
        "data-scale-p3c2-focus-stale":"BLOCKED"
      },
        e("p",null,"The editable reviewed 5,000-device source was modified or its bounded focus was temporarily invalidated. Canonical source remains editable/exportable; no unbounded graph or physical/Engine truth is displayed."),
        scaledFiveThousandSafeCompileAttempted?e("p",{
          "data-scale-p3d1-safe-compile":"NO_UNBOUNDED_LAYOUT"
        },"Compiler-only review requested. Full-source ELK layout and Engine activation remain blocked for this reviewed Office session."):null,
        scaledFiveThousandSessionActive&&
        scaledFiveThousandFocus?.model&&
        workspace.mode==="builder"&&
        workspace.compile.status==="valid"&&
        !scaledFiveThousandFocusBusy
          ?e("div",null,
            e("button",{type:"button",
              "data-scale-p3d2-rebuild-bounded":"REVIEW_REQUIRED",
              onClick:()=>void onReviewEditedFiveThousandFocus("first")},
              "Review and rebuild bounded focus for exactly one locally added unlinked Builder resource"),
            workspace.source.resources.length>=5002
              ?e("button",{type:"button",
                "data-scale-p3d3-rebuild-bounded":"REVIEW_REQUIRED",
                onClick:()=>void onReviewEditedFiveThousandFocus("second")},
                "Separately review second unlinked Builder addition and rebuild bounded 52-page focus")
              :null)
          :null
      ):null,
      e("label", null, "Sök i topology", e("input", { value: topologyQuery, onChange: (event) => setTopologyQuery(event.target.value), placeholder: "Node, ID, IP, interface eller service", "aria-label": "Sök i topology" })),
      topologyQuery ? e("small", { "data-topology-search-count": String(topologySearch.total) }, `${topologySearch.total} träffar i hela den kanoniska importen`) : null,
      e("label", null, "Typ", e("select", { value: topologyType, onChange: (event) => setTopologyType(event.target.value), "aria-label": "Filtrera topology efter typ" }, e("option", { value: "" }, "Alla typer"), ...[...new Set((projection?.nodes ?? []).map((node) => node.type === "resource" ? node.data.resourceType : "zone"))].sort().map((value) => e("option", { key: value, value }, value)))),
      e("label", null, "Zon", e("select", { value: topologyZone, onChange: (event) => setTopologyZone(event.target.value), "aria-label": "Filtrera topology efter zon" }, e("option", { value: "" }, "Alla zoner"), ...[...new Set((projection?.nodes ?? []).map((node) => node.data.zoneKind).filter(Boolean))].sort().map((value) => e("option", { key: value, value }, value)))),
      e("label", null, "VLAN", e("input", { value: topologyVlan, onChange: (event) => setTopologyVlan(event.target.value), placeholder: "VLAN", "aria-label": "Filtrera topology efter VLAN" })),
      e("button", { type: "button", onClick: () => { setTopologyQuery(""); setTopologyType(""); setTopologyZone(""); setTopologyVlan(""); setTopologyPathFocus(false); }, disabled: !topologyQuery && !topologyType && !topologyZone && !topologyVlan && !topologyPathFocus }, "Återställ filter"),
      e("button", { type: "button", onClick: () => setTopologyPathFocus((value) => !value), disabled: !journeyPathNodeIds.length, "aria-pressed": topologyPathFocus }, topologyPathFocus ? "Visa hela topology" : "Fokusera väg"),
      stateFocus ? e("div", { className: "topology-state-focus", "data-modeled-state-visual": "ready", "data-modeled-state-target": stateFocus.targetResourceId, "data-modeled-state-category": stateFocus.category, "aria-live": "polite" }, e("strong", null, "Engine state focus"), e("span", null, `${stateFocus.label} · ${stateFocus.category}`), e("small", null, "CLASS B · node.state · ingen packet journey fabricerad")) : null,
      topologyQuery ? e("div", { className: "topology-search-results", role: "listbox", "aria-label": "Sökresultat" }, topologySearchResults.map((result) => e("button", { type: "button", key: `${result.entity}:${result.nodeId}:${result.field}:${result.value}`, onClick: () => focusTopologyResult(result), role: "option" }, e("strong", null, result.value), e("small", null, `${result.detail} · ${result.nodeId}`)))) : null,
      localFocusPage && localFocusPage.pageCount > 1 ? e("div", { className: "topology-focus-pagination", "data-topology-focus-pagination": "true" },
        e("button", { type: "button", disabled: topologyFocusPage <= 1, onClick: () => { const page = Math.max(1, topologyFocusPage - 1); setTopologyFocusPage(page); setTopologyViewHistory((history) => history.map((item, index) => index === history.length - 1 ? { ...item, page } : item)); } }, "Föregående fokusvy"),
        e("span", null, `Sida ${topologyFocusPage}/${localFocusPage.pageCount}`),
        e("button", { type: "button", disabled: topologyFocusPage >= localFocusPage.pageCount, onClick: () => { const page = Math.min(localFocusPage.pageCount, topologyFocusPage + 1); setTopologyFocusPage(page); setTopologyViewHistory((history) => history.map((item, index) => index === history.length - 1 ? { ...item, page } : item)); } }, "Nästa fokusvy")) : null
    ),
    topologyActiveSummary,
    e("section", {
      ref: topologyPanelRef,
      className: "topology-panel",
      "aria-label": "Topology",
      "data-topology-camera-mode": topologyCameraMode,
      "data-topology-readable-mode": topologyCameraMode === "read" ? "true" : "false",
      "data-topology-pan-button": "middle",
      "data-topology-viewport-phase": topologyViewportState.phase,
      "data-topology-edge-count": String(baseFlow.edges.length),
      ...(atlasPageProjection ? {
        "data-atlas-active-page": atlasPageProjection.page.id,
        "data-atlas-page-count": String(atlasPageRows.length),
        "data-atlas-page-node-count": String(atlasPageProjection.resources.length),
        "data-atlas-page-link-count": String(atlasPageProjection.connections.length),
        "data-atlas-page-resource-ids": JSON.stringify(atlasPageResourceIds),
        "data-atlas-page-internal-connection-ids": JSON.stringify(atlasPageProjection.page.internalConnectionIds),
        "data-atlas-page-internal-connections": JSON.stringify(atlasPageInternalConnections),
        "data-atlas-resource-parent-map": JSON.stringify(atlasResourceParentMap),
        "data-atlas-boundary-count": String(atlasBoundaryReferences.length),
        "data-atlas-boundary-connection-ids": atlasPageProjection.page.boundaryConnectionIds.join(","),
        "data-atlas-layout-page-id": atlasPageProjection.page.id,
        "data-atlas-layout-source-identity": atlasPageProjection.sourceIdentity,
        "data-atlas-layout-error-count": atlasLayout ? String(atlasLayoutErrorCount ?? 0) : "PENDING",
        ...(atlasLayout?.quality ? {
          "data-atlas-layout-quality": atlasLayout.quality.hardGate,
          "data-atlas-layout-quality-gate": atlasLayout.quality.baselineComparison.qualityGate,
          "data-atlas-layout-winner": atlasLayout.quality.winnerId,
          "data-atlas-layout-request-key": atlasLayout.requestKey,
          "data-atlas-layout-routes": JSON.stringify(atlasLayoutRoutes),
        } : {}),
      } : {}),
      "data-topology-edge-ids": baseFlow.edges.map((edge) => edge.id).sort((a, b) => a.localeCompare(b, "en")).join(","),
      "data-topology-projection-edge-ids": (visibleProjection?.edges ?? []).map((edge) => edge.id).sort((a, b) => a.localeCompare(b, "en")).join(","),
      "data-topology-react-flow-edge-ids": baseFlow.edges.map((edge) => edge.id).sort((a, b) => a.localeCompare(b, "en")).join(","),
      "data-topology-react-flow-edge-handles": JSON.stringify(baseFlow.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle ?? null, targetHandle: edge.targetHandle ?? null }))),
      ...(hierarchicalTopologyLayout ? {
        "data-topology-layout-quality": hierarchicalTopologyLayout.quality.hardGate,
        "data-topology-layout-quality-gate": hierarchicalTopologyLayout.quality.baselineComparison.qualityGate,
        "data-topology-layout-winner": hierarchicalTopologyLayout.quality.winnerId,
        "data-topology-layout-request-key": hierarchicalTopologyLayout.requestKey,
        "data-topology-layout-bakeoff": JSON.stringify(hierarchicalTopologyLayout.quality),
      } : {}),
      ...(hierarchicalTopologyView ? {
        "data-topology-hierarchy": hierarchicalTopologyView.kind === "overview" ? "overview" : hierarchicalTopologyView.rootId,
        "data-topology-hierarchy-node-count": String(hierarchicalTopologyView.nodeIds.length),
        "data-topology-hierarchy-link-count": String(hierarchicalTopologyView.edgeIds.length),
        "data-topology-hierarchy-edge-ids": hierarchicalTopologyView.edgeIds.slice().sort((a, b) => a.localeCompare(b, "en")).join(","),
        "data-topology-hierarchy-hidden-links": String(hierarchicalTopologyView.hiddenConnectionCount),
        "data-topology-hierarchy-group-count": String(hierarchicalTopologyView.navigationGroups.length),
        "data-topology-hierarchy-incomplete": String(hierarchicalTopologyView.incompleteView),
      } : {}),
      ...(topologyFocusRoot ? { "data-topology-focus-root": topologyFocusRoot, "data-topology-focus-page": String(topologyFocusPage) } : {}),
      "data-topology-last-valid-size": topologyViewportState.lastValidSize ? `${topologyViewportState.lastValidSize.width}x${topologyViewportState.lastValidSize.height}` : "UNMEASURED",
      "data-topology-preserve-canonical-geometry": String(topologyViewportState.preserveCanonicalGeometry),
      "data-topology-rebuild-visual-geometry": String(topologyViewportState.rebuildVisualGeometry),
    },
    e(ReactFlow, {
      key: hierarchyCanvasKey,
      nodes: flow.nodes,
      edges: flow.edges,
      nodeTypes,
      edgeTypes,
      fitView: true,
      minZoom: 0.15,
      maxZoom: topologyOverview ? 1.05 : 2,
      nodesDraggable: workspace.mode === "builder" && !validThousandFocus && !fiveThousandWorkspace,
      nodesConnectable: workspace.mode === "builder" && !validThousandFocus && !fiveThousandWorkspace,
      elementsSelectable: true,
      panOnDrag: [1],
      zoomOnScroll: true,
      zoomOnDoubleClick: false,
      panOnScroll: false,
      selectionOnDrag: workspace.mode === "builder" && !validThousandFocus && !fiveThousandWorkspace,
      multiSelectionKeyCode: "Shift",
      selectionKeyCode: "Shift",
      onNodeClick,
      onNodeDoubleClick,
      onNodeContextMenu,
      onEdgeClick,
      onEdgeContextMenu,
      onSelectionChange,
      onPaneClick: clearSelection,
      onPaneContextMenu,
      onNodeDragStop,
      onConnect,
      onInit: (instance) => { flowApi.current = instance; topologyViewportRef.current = instance.getViewport?.() ?? null; setTopologyZoom(instance.getZoom?.() ?? 1); setTopologyGeometryRevision((value) => value + 1); },
      onMove: (_event, viewport) => { topologyViewportRef.current = viewport; setTopologyZoom(viewport.zoom); },
    }, e(Background), e(Controls), e(ReactFlowGeometryRepair, {
      panelRef: topologyPanelRef,
      nodeIds: baseFlow.nodes.map((node) => node.id),
      revision: `${topologyGeometryRevision}:${journeyKey}`,
    }),
      visibleJourneyOutcome && journeyEndpointNode ? e(ViewportPortal, null,
        e("div", {
          className: "journey-outcome-overlay",
          "data-terminal-outcome-overlay": "true",
          "data-outcome-marker": visibleJourneyOutcome.marker,
          "data-outcome-marker-created-at": String(journeyOutcomeTiming?.markerCreatedAt ?? ""),
          "data-outcome-marker-expires-at": String(journeyOutcomeTiming?.markerExpiresAt ?? ""),
          "data-outcome-marker-duration-ms": String(journeyOutcomeTiming?.markerDurationMs ?? visibleJourneyOutcome.markerDurationMs),
          "data-outcome-anchor": visibleJourneyOutcome.anchorResourceId ?? "UNMODELED",
          "data-outcome-flow-position": journeyEndpointPosition ? `${journeyEndpointPosition.x},${journeyEndpointPosition.y}` : "UNRESOLVED",
          style: {
            left: `${(journeyEndpointPosition?.x ?? journeyEndpointNode.position.x) + (journeyEndpointNode.width ?? 150) + 10}px`,
            top: `${(journeyEndpointPosition?.y ?? journeyEndpointNode.position.y) + 12}px`,
          },
        },
          e("span", {
            className: `journey-node-badge outcome-${visibleJourneyOutcome.marker}`,
            style: { "--journey-marker-scale": String(journeyOutcomeMarkerScale) },
            "data-outcome-marker": visibleJourneyOutcome.marker,
            "aria-label": visibleJourneyOutcome.marker === "success" ? "Paketet nådde destinationen" : visibleJourneyOutcome.marker === "drop" ? "Paketet droppades eller blockerades här" : "Paketets slutresultat är okänt",
          }, visibleJourneyOutcome.marker === "success" ? "✓" : visibleJourneyOutcome.marker === "drop" ? "✕" : "?"),
        ),
      ) : null),
    ),
    topologyExplorer,
    journey ? e("section", {
      className: `journey-player truth-${journey.truth.toLowerCase()}`,
      "data-visual-journey": "ready",
      "data-journey-mode": journeyMode,
      "data-journey-terminal": journey.terminalKind,
      "data-journey-outcome": journey.outcome.kind,
      "data-journey-outcome-marker": journey.outcome.marker,
      "data-journey-outcome-marker-ms": String(journey.outcome.markerDurationMs),
      "data-playback-source": "recorded-engine-journey",
      "data-playback-iteration": String(journeyPlaybackIteration),
      "data-loop-enabled": String(journeyLoop),
      "aria-label": "Visuell paketresa",
    },
      e("div", { className: "journey-player-heading" },
        e("strong", null, journeyDnsChainDecision
          ? `DNS · ${journey.sourceId} · ${journeyDnsChainDecision.queryName}`
          : `${journey.protocol?.toUpperCase() ?? "FLOW"}${journey.port ? `/${journey.port}` : ""} · ${journey.sourceId} → ${journey.destinationId ?? "target"}`),
        e("span", { className: `journey-verdict ${journey.truth.toLowerCase()}` }, journey.truth)),
      e("div", { className: "journey-controls" },
        e("button", { type: "button", onClick: () => { clearJourneyLoopTimer(); setJourneyOutcomeMarkerExpiry(0); setJourneyOutcomeTiming(null); setJourneyCursor(0); setJourneyPlaying(!reducedMotion); } }, "Spela om"),
        e("button", { type: "button", disabled: journeyCursor <= 0, onClick: () => { clearJourneyLoopTimer(); setJourneyLoop(false); setJourneyOutcomeMarkerExpiry(0); setJourneyOutcomeTiming(null); setJourneyPlaying(false); setJourneyCursor((value) => Math.max(0, value - 1)); } }, "◀ Steg"),
        e("button", { type: "button", onClick: () => { if (journeyPlaying) { clearJourneyLoopTimer(); setJourneyLoop(false); } setJourneyPlaying((value) => !value); }, disabled: journey.events.length <= 1 }, journeyPlaying ? "Pausa" : "Spela"),
        e("button", { type: "button", disabled: journeyCursor >= journey.events.length - 1, onClick: () => { clearJourneyLoopTimer(); setJourneyLoop(false); setJourneyOutcomeMarkerExpiry(0); setJourneyOutcomeTiming(null); setJourneyPlaying(false); setJourneyCursor((value) => Math.min(journey.events.length - 1, value + 1)); } }, "Steg ▶"),
        e("label", null, "Rendering", e("select", { value: journeyMode, onChange: (event) => setJourneyMode(event.target.value) },
          e("option", { value: "pdu" }, "PDU / kuvert"),
          e("option", { value: "particle" }, "Partiklar"),
          e("option", { value: "pulse" }, "Flödespuls"))),
        e("label", null, "Hastighet", e("select", { value: String(journeySpeed), onChange: (event) => setJourneySpeed(Number(event.target.value)) },
          e("option", { value: "0.25" }, "0.25×"), e("option", { value: "0.5" }, "0.5×"), e("option", { value: "1" }, "1×"), e("option", { value: "2" }, "2×"), e("option", { value: "4" }, "4×")))),
        e("label", { className: "journey-loop-control", "data-loop-control": "true" }, e("input", { type: "checkbox", checked: journeyLoop, onChange: (event) => { const enabled = event.target.checked; setJourneyLoop(enabled); if (!enabled) clearJourneyLoopTimer(); }, "aria-label": "Loop animation" }), "Loop animation"),
      e("div", { className: "journey-marker-toggles", "aria-label": "Resultatmarkörer" },
        e("label", null, e("input", { type: "checkbox", checked: showSuccessMarker, onChange: (event) => setShowSuccessMarker(event.target.checked), "data-outcome-toggle": "success" }), "✓ Visa lyckad leverans"),
        e("label", null, e("input", { type: "checkbox", checked: showDropMarker, onChange: (event) => setShowDropMarker(event.target.checked), "data-outcome-toggle": "drop" }), "✕ Visa drop/block")),
      e("input", { className: "journey-scrubber", type: "range", min: 0, max: Math.max(0, journey.events.length - 1), step: 1, value: journeyCursor, onChange: (event) => { setJourneyOutcomeMarkerExpiry(0); setJourneyPlaying(false); setJourneyCursor(Number(event.target.value)); }, "aria-label": "Paketresans tidslinje" }),
      e("div", { className: "journey-event", "aria-live": "polite" },
        e("span", null, `${journeyCursor + 1}/${journey.events.length}`),
        e("strong", null, journeyFrame?.event.kind ?? "flow"),
        e("span", null, journeyFrame?.event.summary ?? ""),
        e("small", null, `MODELED · Runtime rev ${journey.stateRevision} · evidence ${journey.evidenceRefs.length}`)),
      journeyXRay ? e("section", {
        className: `event-xray truth-${journeyXRay.truth.toLowerCase()}`,
        "data-event-xray": "ready",
        "data-xray-event-id": journeyXRay.eventId,
        "data-xray-event-kind": journeyXRay.eventKind,
        "data-xray-decision-kind": journeyXRay.decisionKind,
        "data-xray-sequence": String(journeyXRay.sequence),
        "data-xray-event-count": String(journeyXRay.eventCount),
        "data-xray-current-resource": journeyXRay.currentResourceId,
        "data-xray-truth": journeyXRay.truth,
        "data-xray-provenance": journeyXRay.provenance,
        "aria-label": `Händelse-X-Ray steg ${journeyXRay.sequence} av ${journeyXRay.eventCount}`,
      },
        e("div", { className: "event-xray-heading" },
          e("strong", null, "Händelse-X-Ray"),
          e("span", { className: "event-xray-step" }, `Steg ${journeyXRay.sequence}/${journeyXRay.eventCount}`),
          e("span", { className: `journey-verdict ${journeyXRay.truth.toLowerCase()}` }, journeyXRay.truth)),
        e("div", { className: "event-xray-grid" },
          e("span", null, e("b", null, "Event"), e("code", null, journeyXRay.eventKind)),
          e("span", null, e("b", null, "Beslut"), e("code", null, journeyXRay.decisionKind)),
          e("span", null, e("b", null, "Aktuell nod"), e("code", null, journeyXRay.currentResourceId)),
          e("span", null, e("b", null, "Källa"), e("code", null, journeyXRay.sourceResourceId)),
          e("span", null, e("b", null, "Mål"), e("code", null, journeyXRay.targetResourceId ?? "INTE MODELLERAT")),
          e("span", null, e("b", null, "Länk"), e("code", null, journeyXRay.connectionId ?? (journeyXRay.projectedConnectionIds.length ? journeyXRay.projectedConnectionIds.join(", ") : "INGEN / EJ AKTUELL"))),
          e("span", null, e("b", null, "Protokoll"), e("code", null, journeyXRay.protocol ? `${journeyXRay.protocol.toUpperCase()}${journeyXRay.port !== undefined ? `/${journeyXRay.port}` : ""}` : "EJ AKTUELLT")),
          e("span", null, e("b", null, "Proveniens"), e("code", null, journeyXRay.provenance))),
        e("div", { className: "event-xray-summary" }, journeyXRay.summary),
        e("div", { className: "event-xray-evidence" },
          e("b", null, "Evidens"),
          ...(journeyXRay.evidenceRefs.length
            ? journeyXRay.evidenceRefs.map((ref) => e("code", { key: ref }, ref))
            : [e("span", { key: "none" }, "Ingen separat evidensreferens för detta event")])) ,
        e("small", { className: "event-xray-proof" }, "ENGINE TRACE · X-Ray följer exakt aktuellt playback-event. UI:t ändrar inte eventordning, beslut, sanning eller proveniens.")) : null,
      e("div", {
        className: `journey-outcome outcome-${journey.outcome.kind}${journeyAtTerminal ? " terminal" : " pending"}`,
        "data-journey-outcome-status": journeyAtTerminal ? journey.outcome.kind : "pending",
        "data-journey-outcome-anchor": journeyAtTerminal ? (journey.outcome.anchorResourceId ?? "UNMODELED") : "PENDING",
        "data-journey-outcome-exact-location": journeyAtTerminal ? String(journey.outcome.exactLocation) : "false",
        "aria-live": "polite",
      },
        e("strong", null, "Resultat:"),
        !journeyAtTerminal
          ? e("span", null, "Paketresan pågår")
          : journey.outcome.kind === "destination_reached"
            ? e("span", null, `Nådde destination${journey.outcome.destinationId ? ` · ${journey.outcome.destinationId}` : ""}`)
            : journey.outcome.kind === "dropped"
              ? e("span", null, journey.outcome.anchorResourceId ? `Dropped/blockerad · ${journey.outcome.anchorResourceId}` : "Dropped/blockerad · exakt plats inte modellerad")
              : e("span", null, "UNKNOWN / ofullständigt modellerat"),
        journeyAtTerminal ? e("small", null, journey.outcome.reason) : null),
      journey.pathComparison ? e("section", {
        className: `path-comparison-xray symmetry-${journey.pathComparison.trace.symmetry.toLowerCase()}`,
        "data-path-comparison-xray": "ready",
        "data-path-symmetry": journey.pathComparison.trace.symmetry,
        "data-return-evaluation": journey.pathComparison.trace.returnEvaluationMode,
        "data-return-security": journey.pathComparison.trace.returnSecurityStatus,
        "aria-label": "Forward/Return Path Comparison",
      },
        e("div", { className: "path-comparison-heading" },
          e("strong", null, "Forward / Return Path X-Ray"),
          e("span", { className: `path-symmetry-badge ${journey.pathComparison.trace.symmetry.toLowerCase()}` }, journey.pathComparison.trace.symmetry)),
        e("div", { className: "path-comparison-summary" },
          e("span", null, `Forward: ${journey.pathComparison.trace.forwardTruth}`),
          e("span", null, `Return: ${journey.pathComparison.trace.returnTruth}`),
          e("span", null, `Return evaluation: ${journey.pathComparison.trace.returnEvaluationMode}`),
          e("span", null, `Reverse security: ${journey.pathComparison.trace.returnSecurityStatus}`),
          e("span", null, `NAT/state: ${journey.pathComparison.trace.natStateImplication}`)),
        e("div", { className: "path-comparison-paths" },
          e("div", null, e("b", null, "Forward"), e("code", null, journey.pathComparison.trace.forwardPath?.join(" → ") ?? "NO PROVEN PATH")),
          e("div", null, e("b", null, "Return"), e("code", null, journey.pathComparison.trace.returnPath?.join(" → ") ?? "NO PROVEN PATH"))),
        journey.pathComparison.trace.interfaceComparisons.length ? e("div", { className: "path-comparison-table-scroll" },
          e("table", { className: "path-comparison-table" },
            e("thead", null, e("tr", null, e("th", null, "Resource"), e("th", null, "Forward egress"), e("th", null, "Return egress"), e("th", null, "Different"))),
            e("tbody", null, ...journey.pathComparison.trace.interfaceComparisons.map((row) => e("tr", { key: row.resourceId, className: row.differs ? "path-interface-diff" : "" },
              e("td", null, row.resourceId), e("td", null, row.forwardOutgoingInterface ?? "NOT MODELED"), e("td", null, row.returnOutgoingInterface ?? "NOT MODELED"), e("td", null, row.differs ? "YES" : "NO")))))) : null,
        journey.pathComparison.trace.symmetry === "ASYMMETRIC" ? e("div", { className: "path-asymmetry-warning", role: "status" }, "⚠ Asymmetric routing: forward and return do not traverse the same path in reverse order.") : null,
        e("small", { className: "path-comparison-proof" }, journey.pathComparison.trace.returnEvaluationMode === "NETWORK_ONLY"
          ? "ENGINE TRACE · return routing/L2 path is projected exactly. Reverse TCP/UDP firewall, NAT and conntrack truth is intentionally not fabricated because the client ephemeral return port is not modeled."
          : "ENGINE TRACE · forward and return path/security evidence is projected from Engine decisions; the UI performs no path, firewall, NAT or state recomputation."),
      ) : null,
      dnsChainDecision ? e("section", {
        className: `dns-chain-xray truth-${dnsChainDecision.truth.toLowerCase()}`,
        "data-dns-chain-xray": "ready",
        "data-dns-chain-truth": dnsChainDecision.truth,
        "data-dns-config-state": dnsChainDecision.configuredResolversState,
        "data-selected-dns-resolver": dnsChainDecision.selectedResolverResourceId ?? "none",
        "data-dns-answer": dnsChainDecision.resolvedAddress ?? "none",
        "aria-label": `DNS Chain X-Ray for ${dnsChainDecision.queryName}`,
      },
        e("div", { className: "dns-chain-heading" },
          e("strong", null, `DNS Chain X-Ray · ${dnsChainDecision.queryName}`),
          e("span", { className: `journey-verdict ${dnsChainDecision.truth.toLowerCase()}` }, dnsChainDecision.truth)),
        e("div", { className: "dns-chain-summary" },
          e("span", null, `Source: ${dnsChainDecision.sourceId}`),
          e("span", null, `Resolver config: ${dnsChainDecision.configuredResolversState}`),
          e("span", null, `Configured order: ${dnsChainDecision.resolverAddresses.length ? dnsChainDecision.resolverAddresses.join(" → ") : "NOT MODELED / NONE"}`),
          e("span", null, `Selected resolver: ${dnsChainDecision.selectedResolverResourceId ?? "NONE"}`),
          e("span", null, `Answer: ${dnsChainDecision.resolvedAddress ?? "NONE / NOT PROVABLE"}`),
          e("span", null, `Resource mapping: ${dnsChainDecision.resolvedResourceIds?.length ? dnsChainDecision.resolvedResourceIds.join(", ") : "NONE"}`)),
        e("div", { className: "dns-chain-table-scroll" },
          e("table", { className: "dns-chain-table", "data-dns-resolver-table": "ready" },
            e("thead", null, e("tr", null,
              e("th", null, "#"), e("th", null, "Resolver address"), e("th", null, "Mapped resource"),
              e("th", null, "Network"), e("th", null, "DNS service"), e("th", null, "Records"),
              e("th", null, "Matches"), e("th", null, "Answer"), e("th", null, "Disposition"))),
            e("tbody", null, ...(dnsChainDecision.attempts.length
              ? dnsChainDecision.attempts.map((attempt) => e("tr", {
                  key: `${attempt.index}:${attempt.resolverAddress}`,
                  className: attempt.disposition === "RESOLVED" ? "dns-resolved" : attempt.disposition.includes("UNKNOWN") || attempt.disposition.includes("AMBIGUOUS") || attempt.disposition.includes("MALFORMED") || attempt.disposition === "UNMAPPED" || attempt.disposition === "RECORDS_UNKNOWN" ? "dns-uncertain" : "",
                  "data-dns-resolver-disposition": attempt.disposition,
                  "data-dns-resolver-selected": attempt.selectedResourceId === dnsChainDecision.selectedResolverResourceId ? "true" : "false",
                },
                e("td", null, attempt.index + 1),
                e("td", null, attempt.resolverAddress),
                e("td", null, attempt.selectedResourceId ?? (attempt.mappedResourceIds.length ? attempt.mappedResourceIds.join(", ") : "NONE")),
                e("td", null, attempt.networkTruth ?? "NOT EVALUATED"),
                e("td", null, attempt.serviceState === "KNOWN" ? (attempt.serviceEnabled ? "ENABLED" : "DISABLED") : attempt.serviceState ?? "NOT EVALUATED"),
                e("td", null, attempt.recordsState ?? "NOT EVALUATED"),
                e("td", null, attempt.matchedRecordCount ?? "—"),
                e("td", null, attempt.answerAddress ?? "—"),
                e("td", null, attempt.disposition)))
              : [e("tr", { key: "no-dns-attempts" }, e("td", { colSpan: 9 }, dnsChainDecision.configuredResolversState === "KNOWN" ? "No resolver attempts were required/available." : "Resolver configuration is not provable; no DNS attempt is fabricated."))])))),
        e("small", { className: "dns-chain-proof" }, "ENGINE TRACE · configured resolver order, resolver-resource mapping, resolver reachability, DNS service/record state and answer selection are projected exactly; the UI performs no DNS resolution, resolver selection or record matching."),
      ) : null,
      dhcpDoraDecision ? e("section", {
        className: `dns-chain-xray dhcp-dora-xray truth-${dhcpDoraDecision.truth.toLowerCase()}`,
        "data-dhcp-dora-xray": "ready",
        "data-dhcp-dora-truth": dhcpDoraDecision.truth,
        "data-dhcp-client-state": dhcpDoraDecision.clientState,
        "data-selected-dhcp-server": dhcpDoraDecision.selectedServerResourceId ?? "none",
        "data-dhcp-offered-address": dhcpDoraDecision.offeredAddress ?? "none",
        "aria-label": `DHCP DORA X-Ray for ${dhcpDoraDecision.clientId}`,
      },
        e("div", { className: "dns-chain-heading" },
          e("strong", null, `DHCP DORA X-Ray · ${dhcpDoraDecision.clientId}`),
          e("span", { className: `journey-verdict ${dhcpDoraDecision.truth.toLowerCase()}` }, dhcpDoraDecision.truth)),
        e("div", { className: "dns-chain-summary dhcp-dora-summary" },
          e("span", null, `Client state: ${dhcpDoraDecision.clientState}`),
          e("span", null, `Client enabled: ${dhcpDoraDecision.clientEnabled === undefined ? "NOT MODELED" : dhcpDoraDecision.clientEnabled ? "YES" : "NO"}`),
          e("span", null, `Selected server: ${dhcpDoraDecision.selectedServerResourceId ?? "NONE / NOT PROVABLE"}`),
          e("span", null, `Lease: ${dhcpDoraDecision.offeredAddress ? `${dhcpDoraDecision.offeredAddress}/${dhcpDoraDecision.prefixLength}` : "NONE / NOT PROVABLE"}`),
          e("span", null, `Gateway: ${dhcpDoraDecision.gateway ?? "NOT MODELED"}`),
          e("span", null, `DNS: ${dhcpDoraDecision.dnsServers?.length ? dhcpDoraDecision.dnsServers.join(", ") : "NOT MODELED"}`)),
        e("div", { className: "dhcp-dora-stage-grid", "data-dhcp-stage-grid": "ready" },
          ...dhcpDoraDecision.stages.map((stage) => e("div", {
            key: stage.stage,
            className: `dhcp-dora-stage truth-${stage.truth.toLowerCase()}`,
            "data-dhcp-stage": stage.stage,
            "data-dhcp-stage-truth": stage.truth,
          }, e("strong", null, stage.stage), e("span", null, stage.truth), e("small", null, stage.serverResourceId ? `Server: ${stage.serverResourceId}` : "Local client stage")))),
        e("div", { className: "dns-chain-table-scroll" },
          e("table", { className: "dns-chain-table dhcp-dora-table", "data-dhcp-server-table": "ready" },
            e("thead", null, e("tr", null,
              e("th", null, "#"), e("th", null, "Server"), e("th", null, "Discover"), e("th", null, "Discover path"),
              e("th", null, "Offer return"), e("th", null, "Offer path"), e("th", null, "Server"), e("th", null, "Leases"), e("th", null, "Offer"), e("th", null, "Disposition"))),
            e("tbody", null, ...(dhcpDoraDecision.attempts.length
              ? dhcpDoraDecision.attempts.map((attempt) => e("tr", {
                  key: `${attempt.index}:${attempt.serverResourceId}`,
                  className: attempt.disposition === "OFFERED" ? "dhcp-offered" : attempt.disposition.includes("UNKNOWN") || attempt.disposition.includes("AMBIGUOUS") || attempt.disposition.includes("MALFORMED") ? "dhcp-uncertain" : "",
                  "data-dhcp-server-disposition": attempt.disposition,
                  "data-dhcp-server-selected": attempt.serverResourceId === dhcpDoraDecision.selectedServerResourceId ? "true" : "false",
                },
                e("td", null, attempt.index + 1),
                e("td", null, attempt.serverResourceId),
                e("td", null, attempt.discoverTruth),
                e("td", null, attempt.discoverPath?.length ? attempt.discoverPath.join(" → ") : "NONE / NOT PROVABLE"),
                e("td", null, attempt.offerReturnTruth ?? "NOT EVALUATED"),
                e("td", null, attempt.offerReturnPath?.length ? attempt.offerReturnPath.join(" → ") : "NONE / NOT PROVABLE"),
                e("td", null, attempt.serverEnabled === undefined ? "NOT EVALUATED" : attempt.serverEnabled ? "ENABLED" : "DISABLED"),
                e("td", null, attempt.availableLeases ?? "NOT MODELED"),
                e("td", null, attempt.offeredAddress ?? "—"),
                e("td", null, attempt.disposition)))
              : [e("tr", { key: "no-dhcp-attempts" }, e("td", { colSpan: 10 }, dhcpDoraDecision.clientState === "KNOWN" ? "No modeled DHCP server attempts are available." : "Client DHCP state is not provable; no server attempt or lease is fabricated."))])))),
        e("small", { className: "dns-chain-proof dhcp-dora-proof" }, "ENGINE TRACE · DORA stage truth, local L2 Discover/Offer paths, server state, pool state, explicit offer and lease options are projected exactly; the UI performs no DHCP server selection, address allocation or relay inference. DHCP relay and dynamic lease mutation are NOT MODELED in Phase 94."),
      ) : null,
      e(UdpIcmpFailureXRay, { trace: udpIcmpFailureDecision }),
      tcpStateMachineDecision ? e("section", {
        className: `host-stack-xray tcp-state-machine-xray truth-${tcpStateMachineDecision.truth.toLowerCase()}`,
        "data-tcp-state-machine-xray": "ready",
        "data-tcp-resource": tcpStateMachineDecision.destinationId,
        "data-tcp-truth": tcpStateMachineDecision.truth,
        "data-tcp-model": tcpStateMachineDecision.model,
        "data-tcp-disposition": tcpStateMachineDecision.disposition,
        "aria-label": `TCP State Machine X-Ray for ${tcpStateMachineDecision.destinationId}`,
      },
        e("div", { className: "host-stack-heading" },
          e("strong", null, `TCP State Machine X-Ray · ${tcpStateMachineDecision.destinationId}:${tcpStateMachineDecision.port}`),
          e("span", { className: `journey-verdict ${tcpStateMachineDecision.truth.toLowerCase()}` }, tcpStateMachineDecision.truth)),
        e("div", { className: "host-stack-summary" },
          e("span", null, `Model: ${tcpStateMachineDecision.model}`),
          e("span", null, `Disposition: ${tcpStateMachineDecision.disposition}`),
          e("span", null, `Listener truth: ${tcpStateMachineDecision.listenerTruth}`),
          e("span", null, `Current state(s): ${tcpStateMachineDecision.currentStates.length ? tcpStateMachineDecision.currentStates.join(", ") : "NOT MODELED"}`),
          e("span", null, `Snapshot: ${tcpStateMachineDecision.complete ? "COMPLETE" : "PARTIAL / DECLARATION ONLY"}`),
          e("span", null, `Sequence/ACK timeline: ${tcpStateMachineDecision.sequenceAckTimeline}`),
          e("span", null, `Retransmission markers: ${tcpStateMachineDecision.retransmissionMarkers}`)),
        e("div", { className: "host-stack-table-scroll" },
          e("table", { className: "host-stack-table tcp-state-socket-table", "data-tcp-state-socket-table": "ready" },
            e("thead", null, e("tr", null,
              e("th", null, "Socket"), e("th", null, "Role"), e("th", null, "Local"), e("th", null, "State"), e("th", null, "Peer"), e("th", null, "Allowed next"))),
            e("tbody", null, ...(tcpStateMachineDecision.socketRows.length
              ? tcpStateMachineDecision.socketRows.map((socket) => e("tr", { key: socket.socketId, className: socket.selected ? "host-stack-selected" : "", "data-tcp-socket-selected": socket.selected ? "true" : "false" },
                e("td", null, socket.socketId),
                e("td", null, socket.role),
                e("td", null, `${socket.localAddress}:${socket.localPort}`),
                e("td", null, socket.state),
                e("td", null, socket.remoteAddress ? `${socket.remoteAddress}:${socket.remotePort ?? "?"}` : "NOT MODELED"),
                e("td", null, socket.allowedNextStates.length ? socket.allowedNextStates.join(" → ") : "NONE")))
              : [e("tr", { key: "no-tcp-sockets" }, e("td", { colSpan: 6 }, "TCP socket lifecycle state is NOT MODELED for this destination/port."))])))),
        e("div", { className: "host-stack-table-scroll" },
          e("table", { className: "host-stack-table tcp-state-transition-table", "data-tcp-transition-table": "ready" },
            e("thead", null, e("tr", null, e("th", null, "From"), e("th", null, "Trigger"), e("th", null, "To"))),
            e("tbody", null, ...tcpStateMachineDecision.canonicalTransitions.map((transition, index) => e("tr", { key: `${transition.from}:${transition.to}:${index}` },
              e("td", null, transition.from), e("td", null, transition.trigger), e("td", null, transition.to)))))),
        e("small", { className: "host-stack-proof tcp-state-proof" }, "ENGINE TRACE · current TCP lifecycle state comes only from explicit Host Stack socket evidence. Canonical next-state transitions are protocol knowledge; the UI does not simulate packets, timers, sequence/ACK numbers or retransmissions. Those remain NOT MODELED in Phase 96."),
      ) : null,
      listenerServiceDecision ? e("section", {
        className: `host-stack-xray listener-service-xray truth-${listenerServiceDecision.truth.toLowerCase()}`,
        "data-listener-service-xray": "ready",
        "data-listener-resource": listenerServiceDecision.resourceId,
        "data-listener-truth": listenerServiceDecision.truth,
        "data-listener-model": listenerServiceDecision.model,
        "data-listener-state": listenerServiceDecision.listenerState,
        "data-service-state": listenerServiceDecision.serviceState,
        "data-listener-disposition": listenerServiceDecision.disposition,
        "data-listener-complete": listenerServiceDecision.complete ? "true" : "false",
        "aria-label": `Listener / Service State X-Ray for ${listenerServiceDecision.resourceId}`,
      },
        e("div", { className: "host-stack-heading" },
          e("strong", null, `Listener / Service State X-Ray · ${listenerServiceDecision.resourceId}`),
          e("span", { className: `journey-verdict ${listenerServiceDecision.truth.toLowerCase()}` }, listenerServiceDecision.truth)),
        e("div", { className: "host-stack-summary" },
          e("span", null, `Model: ${listenerServiceDecision.model}`),
          e("span", null, `Socket listener truth: ${listenerServiceDecision.listenerState}`),
          e("span", null, `Service declaration state: ${listenerServiceDecision.serviceState}`),
          e("span", null, `Disposition: ${listenerServiceDecision.disposition}`),
          e("span", null, `Snapshot: ${listenerServiceDecision.complete ? "COMPLETE" : "PARTIAL / DECLARATION ONLY"}`),
          e("span", null, `Consistency: ${listenerServiceDecision.listenerConsistency}`),
          e("span", null, `Selected service: ${listenerServiceDecision.selectedServiceNames.length ? listenerServiceDecision.selectedServiceNames.join(", ") : "NONE / NOT MODELED"}`),
          e("span", null, `Selected socket: ${listenerServiceDecision.selectedSocketIds.length ? listenerServiceDecision.selectedSocketIds.join(", ") : "NONE / NOT MODELED"}`)),
        listenerServiceDecision.listenerConsistency === "MISMATCH"
          ? e("div", { className: "path-comparison-alert", "data-listener-service-mismatch": "true" }, "Service declaration and socket listener evidence disagree. Engine listener truth follows explicit Host Stack socket evidence when the snapshot is complete; service state remains separately visible.")
          : null,
        e("small", { className: "host-stack-proof listener-service-proof" }, "ENGINE TRACE · listener state and service state are separate truths. The UI performs no listener inference, service enablement inference or socket discovery; declaration-only compatibility is explicitly labeled when process/socket state is NOT MODELED."),
      ) : null,
      hostStackDecision ? e("section", {
        className: `host-stack-xray truth-${hostStackDecision.truth.toLowerCase()}`,
        "data-host-stack-xray": "ready",
        "data-host-stack-resource": hostStackDecision.resourceId,
        "data-host-stack-truth": hostStackDecision.truth,
        "data-host-stack-model": hostStackDecision.model,
        "data-host-stack-complete": hostStackDecision.complete ? "true" : "false",
        "data-host-listener-consistency": hostStackDecision.listenerConsistency,
        "aria-label": `Host Stack Microscope for ${hostStackDecision.resourceId}`,
      },
        e("div", { className: "host-stack-heading" },
          e("strong", null, `Host Stack Microscope · ${hostStackDecision.resourceId}`),
          e("span", { className: `journey-verdict ${hostStackDecision.truth.toLowerCase()}` }, hostStackDecision.truth)),
        e("div", { className: "host-stack-summary" },
          e("span", null, `Model: ${hostStackDecision.model}`),
          e("span", null, `Snapshot: ${hostStackDecision.complete ? "COMPLETE" : "PARTIAL / NOT MODELED"}`),
          e("span", null, `Listener consistency: ${hostStackDecision.listenerConsistency}`),
          e("span", null, `Selected service: ${hostStackDecision.selectedServiceNames.length ? hostStackDecision.selectedServiceNames.join(", ") : "NONE / NOT MODELED"}`),
          e("span", null, `Selected socket: ${hostStackDecision.selectedSocketIds.length ? hostStackDecision.selectedSocketIds.join(", ") : "NONE / NOT MODELED"}`)),
        e("div", { className: "host-stack-table-scroll" },
          e("table", { className: "host-stack-table host-stack-service-table", "data-host-service-table": "ready" },
            e("thead", null, e("tr", null,
              e("th", null, "Service"), e("th", null, "Enabled"), e("th", null, "Protocol"), e("th", null, "Port"), e("th", null, "Process ownership"), e("th", null, "Sockets"))),
            e("tbody", null, ...(hostStackDecision.services.length
              ? hostStackDecision.services.map((service) => e("tr", { key: `${service.index}:${service.name}`, className: hostStackDecision.selectedServiceNames.includes(service.name) ? "host-stack-selected" : "" },
                e("td", null, service.name),
                e("td", null, service.enabled === undefined ? "NOT MODELED" : service.enabled ? "ENABLED" : "DISABLED"),
                e("td", null, service.protocol ?? "NOT MODELED"),
                e("td", null, service.port ?? "NOT MODELED"),
                e("td", null, service.owningProcessIds.length ? service.owningProcessIds.join(", ") : "NOT MODELED"),
                e("td", null, service.socketIds.length ? service.socketIds.join(", ") : "NOT MODELED")))
              : [e("tr", { key: "no-host-services" }, e("td", { colSpan: 6 }, "No modeled service declarations are available."))])))),
        e("div", { className: "host-stack-grid" },
          e("div", { className: "host-stack-table-scroll" },
            e("table", { className: "host-stack-table host-stack-process-table", "data-host-process-table": "ready" },
              e("thead", null, e("tr", null, e("th", null, "Process ID"), e("th", null, "Process"), e("th", null, "PID"), e("th", null, "Service"))),
              e("tbody", null, ...(hostStackDecision.processes.length
                ? hostStackDecision.processes.map((process) => e("tr", { key: process.processId },
                  e("td", null, process.processId), e("td", null, process.name), e("td", null, process.pid ?? "NOT MODELED"), e("td", null, process.service ?? "NOT MODELED")))
                : [e("tr", { key: "no-host-processes" }, e("td", { colSpan: 4 }, "Process/PID ownership: NOT MODELED"))])))),
          e("div", { className: "host-stack-table-scroll" },
            e("table", { className: "host-stack-table host-stack-socket-table", "data-host-socket-table": "ready" },
              e("thead", null, e("tr", null, e("th", null, "Socket"), e("th", null, "Protocol"), e("th", null, "Local bind"), e("th", null, "Bind scope"), e("th", null, "State"), e("th", null, "Remote"), e("th", null, "Process"), e("th", null, "Service"))),
              e("tbody", null, ...(hostStackDecision.sockets.length
                ? hostStackDecision.sockets.map((socket) => e("tr", { key: socket.socketId, className: hostStackDecision.selectedSocketIds.includes(socket.socketId) ? "host-stack-selected" : "", "data-host-socket-selected": hostStackDecision.selectedSocketIds.includes(socket.socketId) ? "true" : "false" },
                  e("td", null, socket.socketId), e("td", null, socket.protocol.toUpperCase()), e("td", null, `${socket.localAddress}:${socket.localPort}`),
                  e("td", null, socket.bindScope), e("td", null, socket.state), e("td", null, socket.remoteAddress ? `${socket.remoteAddress}:${socket.remotePort ?? "?"}` : "NOT MODELED"),
                  e("td", null, socket.processId ?? "NOT MODELED"), e("td", null, socket.service ?? "NOT MODELED")))
                : [e("tr", { key: "no-host-sockets" }, e("td", { colSpan: 8 }, "Socket/bind ownership: NOT MODELED"))]))))),
        e("small", { className: "host-stack-proof" }, "ENGINE TRACE · process, PID, socket, bind scope and service ownership are rendered only when explicitly modeled. NOT MODELED remains visible; the UI performs no process discovery, socket inference or listener calculation."),
      ) : null,
      activeRouteDecision ? e("section", {
        className: `routing-xray truth-${activeRouteDecision.truth.toLowerCase()}`,
        "data-routing-xray": "ready",
        "data-route-resource": activeRouteDecision.resourceId,
        "data-selected-route": activeRouteDecision.selectedRouteId ?? "none",
        "aria-label": `Routing X-Ray for ${activeRouteDecision.resourceId}`,
      },
        e("div", { className: "routing-xray-heading" },
          e("strong", null, `Routing X-Ray · ${activeRouteDecision.resourceId}`),
          e("span", { className: `journey-verdict ${activeRouteDecision.truth.toLowerCase()}` }, activeRouteDecision.truth)),
        e("div", { className: "routing-xray-summary" },
          e("span", null, `Destination: ${activeRouteDecision.destinationId}`),
          e("span", null, `Topology next hop: ${activeRouteDecision.nextHopResourceId}`),
          e("span", null, `Declared via: ${activeRouteDecision.declaredNextHop ?? "NOT MODELED"}`),
          e("span", null, `Egress: ${activeRouteDecision.outgoingInterface ?? "NOT MODELED"}`)),
        e("div", { className: "routing-table-scroll" },
          e("table", { className: "routing-table" },
            e("thead", null, e("tr", null,
              e("th", null, "Winner"), e("th", null, "Route"), e("th", null, "Destination"),
              e("th", null, "Prefix"), e("th", null, "Metric"), e("th", null, "Preference"),
              e("th", null, "Via"), e("th", null, "Interface"), e("th", null, "Action"), e("th", null, "Match"))),
            e("tbody", null, ...(activeRouteDecision.candidates.length
              ? activeRouteDecision.candidates.map((candidate) => e("tr", {
                  key: `${candidate.index}:${candidate.routeId}`,
                  className: candidate.selected ? "route-winner" : "",
                  "data-route-selected": candidate.selected ? "true" : "false",
                },
                e("td", null, candidate.selected ? "SELECTED" : "—"),
                e("td", null, candidate.routeId),
                e("td", null, candidate.destination ?? "NOT AVAILABLE"),
                e("td", null, candidate.prefixLength ?? "—"),
                e("td", null, candidate.declaredMetric ?? "NOT MODELED"),
                e("td", null, candidate.declaredPreference ?? "NOT MODELED"),
                e("td", null, candidate.via ?? "NOT MODELED"),
                e("td", null, candidate.outgoingInterface ?? "NOT MODELED"),
                e("td", null, candidate.action ?? "forward"),
                e("td", null, candidate.disposition)))
              : [e("tr", { key: "no-route-rows" }, e("td", { colSpan: 10 }, "No valid modeled route rows are available."))])))),
        e("small", { className: "routing-xray-proof" }, "ENGINE TRACE · row order and winner are projected exactly; declared metric/preference are not recalculated by the UI."),
      ) : null,
      activeNeighborDecision ? e("section", {
        className: `neighbor-xray truth-${activeNeighborDecision.truth.toLowerCase()}`,
        "data-neighbor-xray": "ready",
        "data-neighbor-resource": activeNeighborDecision.resourceId,
        "data-selected-neighbor": activeNeighborDecision.selectedEntryId ?? "none",
        "aria-label": `ARP/ND X-Ray for ${activeNeighborDecision.resourceId}`,
      },
        e("div", { className: "neighbor-xray-heading" },
          e("strong", null, `ARP/ND X-Ray · ${activeNeighborDecision.resourceId}`),
          e("span", { className: `journey-verdict ${activeNeighborDecision.truth.toLowerCase()}` }, activeNeighborDecision.truth)),
        e("div", { className: "neighbor-xray-summary" },
          e("span", null, `Destination: ${activeNeighborDecision.destinationId}`),
          e("span", null, `Next hop: ${activeNeighborDecision.nextHopResourceId}`),
          e("span", null, `Protocol: ${activeNeighborDecision.selectedProtocol ?? "NOT MODELED"}`),
          e("span", null, `State: ${activeNeighborDecision.selectedState ?? "UNKNOWN"}`),
          e("span", null, `Address: ${activeNeighborDecision.selectedAddress ?? "NOT AVAILABLE"}`),
          e("span", null, `MAC: ${activeNeighborDecision.selectedMac ?? "NOT MODELED"}`),
          e("span", null, `Interface: ${activeNeighborDecision.outgoingInterface ?? "NOT MODELED"}`)),
        e("div", { className: "neighbor-table-scroll" },
          e("table", { className: "neighbor-table" },
            e("thead", null, e("tr", null,
              e("th", null, "Vald"), e("th", null, "Entry"), e("th", null, "Target"),
              e("th", null, "Protocol"), e("th", null, "Address"), e("th", null, "MAC"),
              e("th", null, "Interface"), e("th", null, "State"), e("th", null, "Match"))),
            e("tbody", null, ...(activeNeighborDecision.candidates.length
              ? activeNeighborDecision.candidates.map((candidate) => e("tr", {
                  key: `${candidate.index}:${candidate.entryId}`,
                  className: candidate.selected ? "neighbor-selected" : "",
                  "data-neighbor-selected": candidate.selected ? "true" : "false",
                },
                e("td", null, candidate.selected ? "SELECTED" : "—"),
                e("td", null, candidate.entryId),
                e("td", null, candidate.targetResourceId ?? "NOT MODELED"),
                e("td", null, candidate.protocol ?? "UNKNOWN"),
                e("td", null, candidate.address ?? "NOT AVAILABLE"),
                e("td", null, candidate.mac ?? "NOT MODELED"),
                e("td", null, candidate.interfaceId ?? "NOT MODELED"),
                e("td", null, candidate.state ?? "UNKNOWN"),
                e("td", null, candidate.disposition)))
              : [e("tr", { key: "no-neighbor-rows" }, e("td", { colSpan: 9 }, "No valid modeled ARP/ND rows are available."))])))),
        e("small", { className: "neighbor-xray-proof" }, "ENGINE TRACE · ARP/ND row, selection and state are projected exactly; the UI performs no neighbor resolution."),
      ) : null,
      activeMacDecision ? e("section", {
        className: `mac-xray truth-${activeMacDecision.truth.toLowerCase()}`,
        "data-mac-xray": "ready",
        "data-mac-resource": activeMacDecision.resourceId,
        "data-selected-mac-entry": activeMacDecision.selectedEntryId ?? "none",
        "data-mac-forwarding": activeMacDecision.forwarding,
        "data-mac-learning": activeMacDecision.learning,
        "data-mac-flood-count": String(activeMacDecision.floodInterfaces?.length ?? 0),
        "aria-label": `MAC/CAM X-Ray for ${activeMacDecision.resourceId}`,
      },
        e("div", { className: "mac-xray-heading" },
          e("strong", null, `MAC/CAM X-Ray · ${activeMacDecision.resourceId}`),
          e("span", { className: `journey-verdict ${activeMacDecision.truth.toLowerCase()}` }, activeMacDecision.truth)),
        e("div", { className: "mac-xray-summary" },
          e("span", null, `Source MAC: ${activeMacDecision.sourceMac ?? "UNKNOWN"}`),
          e("span", null, `Ingress: ${activeMacDecision.ingressInterface ?? "NOT MODELED"}`),
          e("span", null, `Learning: ${activeMacDecision.learning}`),
          e("span", null, `Destination MAC: ${activeMacDecision.destinationMac ?? "UNKNOWN"}`),
          e("span", null, `Forwarding: ${activeMacDecision.forwarding}`),
          e("span", null, `Expected egress: ${activeMacDecision.expectedEgressInterface ?? "NOT MODELED"}`),
          e("span", null, `Selected egress: ${activeMacDecision.selectedEgressInterface ?? "NOT AVAILABLE"}`),
          e("span", null, `Flood set: ${activeMacDecision.floodInterfaces?.length ? activeMacDecision.floodInterfaces.join(", ") : "NOT AVAILABLE"}`),
          e("span", null, `VLAN: ${activeMacDecision.vlan ?? "NOT MODELED"}`)),
        e("div", { className: "mac-table-scroll" },
          e("table", { className: "mac-table" },
            e("thead", null, e("tr", null,
              e("th", null, "Vald"), e("th", null, "Entry"), e("th", null, "MAC"),
              e("th", null, "Interface"), e("th", null, "VLAN"), e("th", null, "Role"))),
            e("tbody", null, ...(activeMacDecision.candidates.length
              ? activeMacDecision.candidates.map((candidate) => e("tr", {
                  key: `${candidate.index}:${candidate.entryId}`,
                  className: candidate.selected ? "mac-selected" : "",
                  "data-mac-selected": candidate.selected ? "true" : "false",
                },
                e("td", null, candidate.selected ? "SELECTED" : "—"),
                e("td", null, candidate.entryId),
                e("td", null, candidate.mac ?? "UNKNOWN"),
                e("td", null, candidate.interfaceId ?? "NOT MODELED"),
                e("td", null, candidate.vlan ?? "NOT MODELED"),
                e("td", null, candidate.disposition)))
              : [e("tr", { key: "no-mac-rows" }, e("td", { colSpan: 6 }, "No valid modeled MAC/CAM rows are available."))])))),
        e("small", { className: "mac-xray-proof" }, "ENGINE TRACE · learning, destination lookup, winner and flood set are projected exactly; the UI performs no MAC learning or forwarding calculation."),
      ) : null,
      activeVlanDecision ? e("section", {
        className: `vlan-xray truth-${activeVlanDecision.truth.toLowerCase()}`,
        "data-vlan-xray": "ready",
        "data-vlan-resource": activeVlanDecision.resourceId,
        "data-vlan-id": activeVlanDecision.vlan ?? "unknown",
        "data-vlan-rewrite": activeVlanDecision.rewrite,
        "data-vlan-ingress-mode": activeVlanDecision.ingressMode ?? "unknown",
        "data-vlan-egress-mode": activeVlanDecision.egressMode ?? "unknown",
        "aria-label": `VLAN/Trunk X-Ray for ${activeVlanDecision.resourceId}`,
      },
        e("div", { className: "vlan-xray-heading" },
          e("strong", null, `VLAN/Trunk X-Ray · ${activeVlanDecision.resourceId}`),
          e("span", { className: `journey-verdict ${activeVlanDecision.truth.toLowerCase()}` }, activeVlanDecision.truth)),
        e("div", { className: "vlan-xray-summary" },
          e("span", null, `VLAN: ${activeVlanDecision.vlan ?? "UNKNOWN"}`),
          e("span", null, `Ingress: ${activeVlanDecision.ingressInterface ?? "NOT MODELED"} · ${activeVlanDecision.ingressMode ?? "UNKNOWN"} · ${activeVlanDecision.ingressTag ?? "UNKNOWN"}`),
          e("span", null, `Egress: ${activeVlanDecision.egressInterface ?? "NOT MODELED"} · ${activeVlanDecision.egressMode ?? "UNKNOWN"} · ${activeVlanDecision.egressTag ?? "UNKNOWN"}`),
          e("span", null, `Rewrite: ${activeVlanDecision.rewrite}`)),
        e("div", { className: "vlan-decision-table-wrap" },
          e("strong", { className: "vlan-table-title" }, "VLAN decision table"),
          e("div", { className: "vlan-table-scroll" },
            e("table", { className: "vlan-table vlan-decision-table", "data-vlan-decision-table": "ready" },
              e("thead", null, e("tr", null,
                e("th", null, "VLAN"), e("th", null, "Ingress"), e("th", null, "Ingress wire"),
                e("th", null, "Egress"), e("th", null, "Egress wire"), e("th", null, "Rewrite"), e("th", null, "Truth"))),
              e("tbody", null, e("tr", null,
                e("td", null, activeVlanDecision.vlan ?? "UNKNOWN"),
                e("td", null, `${activeVlanDecision.ingressInterface ?? "NOT MODELED"} · ${activeVlanDecision.ingressMode ?? "UNKNOWN"}`),
                e("td", null, activeVlanDecision.ingressTag ?? "UNKNOWN"),
                e("td", null, `${activeVlanDecision.egressInterface ?? "NOT MODELED"} · ${activeVlanDecision.egressMode ?? "UNKNOWN"}`),
                e("td", null, activeVlanDecision.egressTag ?? "UNKNOWN"),
                e("td", null, activeVlanDecision.rewrite),
                e("td", null, activeVlanDecision.truth))))),
        ),
        e("strong", { className: "vlan-table-title" }, "Trunk / access port table"),
        e("div", { className: "vlan-table-scroll" },
          e("table", { className: "vlan-table vlan-port-table", "data-vlan-port-table": "ready" },
            e("thead", null, e("tr", null,
              e("th", null, "Interface"), e("th", null, "Läge"), e("th", null, "Access VLAN"),
              e("th", null, "Allowed VLANs"), e("th", null, "Native VLAN"), e("th", null, "Wire egress"), e("th", null, "Role"))),
            e("tbody", null, ...(activeVlanDecision.ports.length
              ? activeVlanDecision.ports.map((port) => e("tr", {
                  key: port.interfaceId,
                  className: port.disposition === "INGRESS" || port.disposition === "EGRESS" ? "vlan-selected" : port.disposition === "BLOCKED" || port.disposition === "MALFORMED" ? "vlan-blocked" : "",
                  "data-vlan-port-role": port.disposition,
                },
                e("td", null, port.interfaceId),
                e("td", null, port.mode ?? "NOT MODELED"),
                e("td", null, port.accessVlan ?? "—"),
                e("td", null, port.allowedVlans?.length ? port.allowedVlans.join(", ") : "—"),
                e("td", null, port.nativeVlan ?? "—"),
                e("td", null, port.egressTag ?? "—"),
                e("td", null, port.disposition)))
              : [e("tr", { key: "no-vlan-rows" }, e("td", { colSpan: 7 }, "No authoritative switchport rows are available."))])))),
        e("small", { className: "vlan-xray-proof" }, "ENGINE TRACE · access/trunk mode, VLAN classification, native VLAN and tag rewrite are projected exactly; the UI performs no VLAN inference."),
      ) : null,
      activeStpDecision ? e("section", {
        className: `stp-xray truth-${activeStpDecision.truth.toLowerCase()}`,
        "data-stp-xray": "ready",
        "data-stp-resource": activeStpDecision.resourceId,
        "data-stp-truth": activeStpDecision.truth,
        "data-stp-model-complete": activeStpDecision.modelComplete ? "true" : "false",
        "data-stp-egress": activeStpDecision.egressInterface ?? "unknown",
        "data-stp-root": activeStpDecision.rootBridgeId ?? "not-modeled",
        "aria-label": `STP/BPDU X-Ray for ${activeStpDecision.resourceId}`,
      },
        e("div", { className: "stp-xray-heading" },
          e("strong", null, `STP/BPDU X-Ray · ${activeStpDecision.resourceId}`),
          e("span", { className: `journey-verdict ${activeStpDecision.truth.toLowerCase()}` }, activeStpDecision.truth)),
        e("div", { className: "stp-xray-summary" },
          e("span", null, `Protocol: ${activeStpDecision.protocol ?? "NOT MODELED"}`),
          e("span", null, `Bridge: ${activeStpDecision.bridgeId ?? "NOT MODELED"}`),
          e("span", null, `Root: ${activeStpDecision.rootBridgeId ?? "NOT MODELED"}`),
          e("span", null, `Root bridge: ${activeStpDecision.isRootBridge === undefined ? "UNKNOWN" : activeStpDecision.isRootBridge ? "YES" : "NO"}`),
          e("span", null, `Root path cost: ${activeStpDecision.rootPathCost ?? "NOT MODELED"}`),
          e("span", null, `Ingress: ${activeStpDecision.ingressInterface ?? "UNKNOWN"}`),
          e("span", null, `Egress: ${activeStpDecision.egressInterface ?? "UNKNOWN"}`),
          e("span", null, `Model completeness: ${activeStpDecision.modelComplete ? "COMPLETE" : "INCOMPLETE"}`)),
        e("div", { className: "stp-table-scroll" },
          e("table", { className: "stp-table", "data-stp-port-table": "ready" },
            e("thead", null, e("tr", null,
              e("th", null, "Interface"), e("th", null, "Path role"), e("th", null, "STP role"),
              e("th", null, "State"), e("th", null, "BPDU"))),
            e("tbody", null, ...(activeStpDecision.ports.length
              ? activeStpDecision.ports.map((port) => e("tr", {
                  key: port.interfaceId,
                  className: port.state === "FORWARDING" ? "stp-forwarding" : port.state && port.state !== "UNKNOWN" ? "stp-blocked" : "stp-unknown",
                  "data-stp-port-state": port.state ?? "NOT_MODELED",
                  "data-stp-port-role": port.role ?? "NOT_MODELED",
                },
                e("td", null, port.interfaceId),
                e("td", null, port.disposition),
                e("td", null, port.role ?? "NOT MODELED"),
                e("td", null, port.state ?? "UNKNOWN"),
                e("td", null, port.bpdu ?? "NOT MODELED")))
              : [e("tr", { key: "no-stp-rows" }, e("td", { colSpan: 5 }, "No authoritative STP port rows are available."))])))),
        e("small", { className: "stp-xray-proof" }, "ENGINE TRACE · root identity, port role/state, BPDU direction and forwarding/blocking decision are projected exactly; the UI performs no STP election or port-state calculation."),
      ) : null,
      activeMtuEvaluation ? e("section", {
        className: `mtu-xray truth-${activeMtuEvaluation.truth.toLowerCase()}`,
        "data-mtu-xray": "ready",
        "data-mtu-resource": activeMtuEvaluation.resourceId,
        "data-mtu-interface": activeMtuEvaluation.egressInterface,
        "data-mtu-comparison": activeMtuEvaluation.comparison,
        "data-mtu-provenance": activeMtuEvaluation.provenance,
        "aria-label": `MTU/PMTUD X-Ray for ${activeMtuEvaluation.resourceId}`,
      },
        e("div", { className: "mtu-xray-heading" },
          e("strong", null, `MTU/PMTUD X-Ray · ${activeMtuEvaluation.resourceId}.${activeMtuEvaluation.egressInterface}`),
          e("span", { className: `journey-verdict ${activeMtuEvaluation.truth.toLowerCase()}` }, activeMtuEvaluation.truth)),
        e("div", { className: "mtu-xray-summary" },
          e("span", null, `Packet: ${activeMtuEvaluation.packetSize ?? "UNMODELED"} bytes`),
          e("span", null, `Egress MTU: ${activeMtuEvaluation.egressMtu ?? "UNKNOWN"} bytes`),
          e("span", null, `Path MTU: ${activeMtuEvaluation.pathMtu ?? "NOT AVAILABLE"}`),
          e("span", null, `Result: ${activeMtuEvaluation.comparison}`),
          e("span", null, `Fragmentation: ${activeMtuEvaluation.fragmentation}`),
          e("span", null, `ICMP/PTB: ${activeMtuEvaluation.icmp}`)),
        e("small", { className: "mtu-xray-proof" }, `ENGINE TRACE · ${activeMtuEvaluation.provenance} · UI renders explicit packet/MTU truth and does not infer fragmentation, ICMP/PTB or PMTUD timing.`),
      ) : activeNatDecision ? e("section", {
        className: `nat-xray truth-${activeNatDecision.truth.toLowerCase()}`,
        "data-nat-xray": "ready",
        "data-nat-kind": activeNatDecision.kind,
        "data-nat-resource": activeNatDecision.resourceId,
        "data-nat-truth": activeNatDecision.truth,
        "data-nat-transformation": activeNatDecision.transformation,
        "data-selected-nat-rule": activeNatDecision.selectedRuleId ?? "none",
        "aria-label": `NAT/PAT X-Ray for ${activeNatDecision.resourceId}`,
      },
        e("div", { className: "nat-xray-heading" },
          e("strong", null, `NAT/PAT X-Ray · ${activeNatDecision.resourceId}`),
          e("span", { className: `journey-verdict ${activeNatDecision.truth.toLowerCase()}` }, activeNatDecision.truth)),
        e("div", { className: "nat-xray-summary" },
          e("span", null, `Layer: ${activeNatDecision.kind}`),
          e("span", null, `Destination: ${activeNatDecision.destinationId}`),
          e("span", null, `Policy: ${activeNatDecision.policyMode ?? "NOT DECLARED"}`),
          e("span", null, `Transformation: ${activeNatDecision.transformation}`),
          e("span", null, `Selected: ${activeNatDecision.selectedRuleId ?? "NONE"}`),
          e("span", null, `Source: ${activeNatDecision.inputSource ?? "UNKNOWN"} → ${activeNatDecision.outputSource ?? "UNKNOWN"}`),
          e("span", null, `Port: ${activeNatDecision.inputPort ?? "any"} → ${activeNatDecision.outputPort ?? "any"}`)),
        e("div", { className: "nat-table-scroll" },
          e("table", { className: "nat-table", "data-nat-rule-table": "ready" },
            e("thead", null, e("tr", null,
              e("th", null, "Vald"), e("th", null, "#"), e("th", null, "Rule"), e("th", null, "Type"),
              e("th", null, "Source"), e("th", null, "Destination"), e("th", null, "Protocol"), e("th", null, "Port/ext"),
              e("th", null, "Action"), e("th", null, "Translated source"), e("th", null, "Translated port"),
              e("th", null, "Source match"), e("th", null, "Destination match"), e("th", null, "Protocol match"),
              e("th", null, "Port match"), e("th", null, "Evaluation"))),
            e("tbody", null, ...(activeNatDecision.rules.length
              ? activeNatDecision.rules.map((rule) => e("tr", {
                  key: `${rule.index}:${rule.ruleId}`,
                  className: rule.selected ? "nat-selected" : rule.disposition === "INDETERMINATE" || rule.disposition === "MALFORMED" || rule.disposition === "DECLARED" ? "nat-uncertain" : rule.disposition === "NOT_EVALUATED" ? "nat-not-evaluated" : "",
                  "data-nat-rule-selected": rule.selected ? "true" : "false",
                  "data-nat-rule-disposition": rule.disposition,
                },
                e("td", null, rule.selected ? "SELECTED" : "—"),
                e("td", null, rule.index + 1),
                e("td", null, rule.ruleId),
                e("td", null, rule.declaredType ?? "dnat(default)"),
                e("td", null, rule.source ?? "any"),
                e("td", null, rule.destination ?? "any"),
                e("td", null, rule.protocol ?? "any"),
                e("td", null, rule.externalPort ?? rule.port ?? "any"),
                e("td", null, rule.action ?? "translate(default)"),
                e("td", null, rule.translatedSource ?? "—"),
                e("td", null, rule.translatedPort ?? "—"),
                e("td", null, rule.sourceMatch ?? "—"),
                e("td", null, rule.destinationMatch === undefined ? "—" : rule.destinationMatch ? "MATCH" : "NO MATCH"),
                e("td", null, rule.protocolMatch === undefined ? "—" : rule.protocolMatch ? "MATCH" : "NO MATCH"),
                e("td", null, rule.portMatch === undefined ? "—" : rule.portMatch ? "MATCH" : "NO MATCH"),
                e("td", null, rule.disposition)))
              : [e("tr", { key: "no-nat-rows" }, e("td", { colSpan: 16 }, `No authoritative ${activeNatDecision.kind} rule rows are available.`))])))),
        e("small", { className: "nat-xray-proof" }, "ENGINE TRACE · rule order, selected transformation and before/after source/port values are projected exactly; the UI performs no NAT/PAT evaluation. Forward/return implications are shown only from Engine comparison evidence."),
      ) : null,
      activeConntrackDecision ? e("section", {
        className: `conntrack-xray truth-${activeConntrackDecision.truth.toLowerCase()}`,
        "data-conntrack-xray": "ready",
        "data-conntrack-resource": activeConntrackDecision.resourceId,
        "data-conntrack-truth": activeConntrackDecision.truth,
        "data-conntrack-complete": activeConntrackDecision.complete === undefined ? "unknown" : activeConntrackDecision.complete ? "true" : "false",
        "data-selected-conntrack-entry": activeConntrackDecision.selectedEntryId ?? "none",
        "data-conntrack-state": activeConntrackDecision.connectionState ?? "none",
        "aria-label": `Conntrack/Session X-Ray for ${activeConntrackDecision.resourceId}`,
      },
        e("div", { className: "conntrack-xray-heading" },
          e("strong", null, `Conntrack/Session X-Ray · ${activeConntrackDecision.resourceId}`),
          e("span", { className: `journey-verdict ${activeConntrackDecision.truth.toLowerCase()}` }, activeConntrackDecision.truth)),
        e("div", { className: "conntrack-xray-summary" },
          e("span", null, `Destination: ${activeConntrackDecision.destinationId}`),
          e("span", null, `Table: ${activeConntrackDecision.complete === true ? "COMPLETE" : activeConntrackDecision.complete === false ? "INCOMPLETE" : "MALFORMED/UNKNOWN"}`),
          e("span", null, `Selected: ${activeConntrackDecision.selectedEntryId ?? "NONE"}`),
          e("span", null, `State: ${activeConntrackDecision.connectionState ?? "NOT PROVABLE"}`),
          e("span", null, `Observed source: ${activeConntrackDecision.observedSource ?? "NOT PROVABLE"}`),
          e("span", null, `Observed port: ${activeConntrackDecision.observedPort ?? "n/a"}`)),
        e("div", { className: "conntrack-table-scroll" },
          e("table", { className: "conntrack-table", "data-conntrack-entry-table": "ready" },
            e("thead", null, e("tr", null,
              e("th", null, "Vald"), e("th", null, "#"), e("th", null, "Entry"), e("th", null, "Source"),
              e("th", null, "Destination"), e("th", null, "Protocol"), e("th", null, "Port"), e("th", null, "State"),
              e("th", null, "Source match"), e("th", null, "Destination match"), e("th", null, "Protocol match"),
              e("th", null, "Port match"), e("th", null, "Evaluation"))),
            e("tbody", null, ...(activeConntrackDecision.entries.length
              ? activeConntrackDecision.entries.map((entry) => e("tr", {
                  key: `${entry.index}:${entry.entryId}`,
                  className: entry.selected ? "conntrack-selected" : entry.disposition === "INDETERMINATE" || entry.disposition === "MALFORMED" ? "conntrack-uncertain" : entry.disposition === "DISABLED" ? "conntrack-disabled" : "",
                  "data-conntrack-entry-selected": entry.selected ? "true" : "false",
                  "data-conntrack-entry-disposition": entry.disposition,
                  "data-conntrack-entry-state": entry.state ?? "UNKNOWN",
                },
                e("td", null, entry.selected ? "SELECTED" : "—"),
                e("td", null, entry.index + 1),
                e("td", null, entry.entryId),
                e("td", null, entry.source ?? "UNKNOWN"),
                e("td", null, entry.destination ?? "UNKNOWN"),
                e("td", null, entry.protocol ?? "UNKNOWN"),
                e("td", null, entry.port ?? "n/a"),
                e("td", null, entry.state ?? "UNKNOWN"),
                e("td", null, entry.sourceMatch ?? "—"),
                e("td", null, entry.destinationMatch === undefined ? "—" : entry.destinationMatch ? "MATCH" : "NO MATCH"),
                e("td", null, entry.protocolMatch === undefined ? "—" : entry.protocolMatch ? "MATCH" : "NO MATCH"),
                e("td", null, entry.portMatch === undefined ? "—" : entry.portMatch ? "MATCH" : "NO MATCH"),
                e("td", null, entry.disposition)))
              : [e("tr", { key: "no-conntrack-rows" }, e("td", { colSpan: 13 }, activeConntrackDecision.complete === true ? "Complete table contains no matching session rows." : "No authoritative conntrack rows are available."))])))),
        e("small", { className: "conntrack-xray-proof" }, "ENGINE TRACE · table completeness, exact tuple match, selected entry and session state are projected exactly; the UI performs no conntrack inference, session creation or expiry."),
      ) : null,
      activePolicyDecision ? e("section", {
        className: `policy-xray truth-${activePolicyDecision.truth.toLowerCase()}`,
        "data-policy-xray": "ready",
        "data-policy-kind": activePolicyDecision.kind,
        "data-policy-firewall-scope": activePolicyDecision.firewallScope ?? "none",
        "data-policy-resource": activePolicyDecision.resourceId,
        "data-policy-truth": activePolicyDecision.truth,
        "data-selected-policy": activePolicyDecision.selectedPolicyId ?? "none",
        "data-policy-default-used": activePolicyDecision.usedDefault ? "true" : "false",
        "aria-label": `Firewall/ACL X-Ray for ${activePolicyDecision.resourceId}`,
      },
        e("div", { className: "policy-xray-heading" },
          e("strong", null, `Firewall/ACL X-Ray · ${activePolicyDecision.resourceId}`),
          e("span", { className: `journey-verdict ${activePolicyDecision.truth.toLowerCase()}` }, activePolicyDecision.truth)),
        e("div", { className: "policy-xray-summary" },
          e("span", null, `Policy kind: ${activePolicyDecision.kind}`),
          e("span", null, `Firewall scope: ${activePolicyDecision.firewallScope === "LOCAL_HOST" ? "LOCAL HOST" : activePolicyDecision.firewallScope ?? "N/A"}`),
          e("span", null, `Destination: ${activePolicyDecision.destinationId}`),
          e("span", null, `Observed source: ${activePolicyDecision.observedSource ?? "NOT PROVABLE"}`),
          e("span", null, `Selected: ${activePolicyDecision.selectedPolicyId ?? "NONE"}`),
          e("span", null, `Default action: ${activePolicyDecision.defaultAction ?? "NOT DECLARED"}`),
          e("span", null, `Default used: ${activePolicyDecision.usedDefault ? "YES" : "NO"}`)),
        e("div", { className: "policy-table-scroll" },
          e("table", { className: "policy-table", "data-policy-rule-table": "ready" },
            e("thead", null, e("tr", null,
              e("th", null, "Vald"), e("th", null, "#"), e("th", null, "Rule"),
              e("th", null, "Source"), e("th", null, "Destination"), e("th", null, "Protocol"),
              e("th", null, "Port"), e("th", null, "Action"), e("th", null, "Connection state"), e("th", null, "State match"), e("th", null, "Source match"),
              e("th", null, "Destination match"), e("th", null, "Protocol match"), e("th", null, "Port match"),
              e("th", null, "Evaluation"))),
            e("tbody", null, ...(activePolicyDecision.rules.length
              ? activePolicyDecision.rules.map((rule) => e("tr", {
                  key: `${rule.index}:${rule.ruleId}`,
                  className: rule.selected ? "policy-selected" : rule.disposition === "INDETERMINATE" || rule.disposition === "MALFORMED" ? "policy-uncertain" : rule.disposition === "NOT_EVALUATED" ? "policy-not-evaluated" : "",
                  "data-policy-rule-selected": rule.selected ? "true" : "false",
                  "data-policy-rule-disposition": rule.disposition,
                },
                e("td", null, rule.selected ? "SELECTED" : "—"),
                e("td", null, rule.index + 1),
                e("td", null, rule.ruleId),
                e("td", null, rule.source ?? "any"),
                e("td", null, rule.destination ?? "any"),
                e("td", null, rule.protocol ?? "any"),
                e("td", null, rule.port ?? "any"),
                e("td", null, rule.action ?? "NOT MODELED"),
                e("td", null, rule.connectionState ?? "any"),
                e("td", null, rule.connectionStateMatch ?? "—"),
                e("td", null, rule.sourceMatch ?? "—"),
                e("td", null, rule.destinationMatch === undefined ? "—" : rule.destinationMatch ? "MATCH" : "NO MATCH"),
                e("td", null, rule.protocolMatch === undefined ? "—" : rule.protocolMatch ? "MATCH" : "NO MATCH"),
                e("td", null, rule.portMatch === undefined ? "—" : rule.portMatch ? "MATCH" : "NO MATCH"),
                e("td", null, rule.disposition)))
              : [e("tr", { key: "no-policy-rows" }, e("td", { colSpan: 15 }, activePolicyDecision.usedDefault ? "No ordered rule matched; Engine used the declared default action." : "No authoritative ordered rule rows are available."))])))),
        e("small", { className: "policy-xray-proof" }, "ENGINE TRACE · policy location (network vs local host), rule order, packet match components, conntrack-state match, terminal selection and default use are projected exactly; the UI performs no firewall/ACL or session-state evaluation."),
      ) : null,
    ) : null,
    topologyContextMenu ? e("div", {
      ref: topologyContextMenuRef,
      className: "topology-context-menu",
      role: "menu",
      "data-topology-context-menu": topologyContextMenu.kind,
      style: { position: "fixed", left: `${topologyContextMenu.x}px`, top: `${topologyContextMenu.y}px`, zIndex: 1000 },
    },
      topologyContextMenu.kind === "group" && contextGroup ? [
        e("strong", { key: "heading" }, `${contextGroup.label} · ${contextGroup.members.length} documented members`),
        e("button", { key: "members", type: "button", role: "menuitem", "data-topology-context-action": "group-members", onClick: () => openTopologyGroup(contextGroup) }, "Bläddra i gruppens medlemmar"),
        e("button", { key: "overview", type: "button", role: "menuitem", "data-topology-context-action": "group-overview", onClick: navigateOverview }, "Visa nätverksöversikt"),
      ] : topologyContextMenu.kind === "node" && contextResource ? [
        e("strong", { key: "heading" }, `${contextResource.label ?? contextResource.id} · ${contextResource.id}`),
        e("button", { key: "details", type: "button", role: "menuitem", "data-topology-context-action": "details", onClick: () => { setTopologyContextDetails({ kind: "node", id: contextResource.id, label: contextResource.label ?? contextResource.id, type: contextResource.type ?? "unknown", addresses: contextResource.interfaces?.flatMap((iface) => iface.addresses ?? []) ?? [], neighbors: contextNeighbors.map((resource) => resource.id) }); setTopologyContextMenu(null); } }, "Visa enhetsdetaljer"),
        e("button", { key: "focus", type: "button", role: "menuitem", "data-topology-context-action": "focus", onClick: () => focusTopologyNode(contextResource.id, contextResource.label ?? contextResource.id) }, "Öppna fokuserad topologi"),
        e("button", { key: "neighbors", type: "button", role: "menuitem", "data-topology-context-action": "neighbors", onClick: () => { focusTopologyNode(contextResource.id, contextResource.label ?? contextResource.id); setTopologyContextDetails({ kind: "neighbors", id: contextResource.id, neighbors: contextNeighbors.map((resource) => resource.id) }); } }, "Visa direkt anslutna enheter"),
        e("button", { key: "links", type: "button", role: "menuitem", "data-topology-context-action": "links", onClick: () => { setTopologyContextDetails({ kind: "links", id: contextResource.id, links: canonicalNetwork.connections.filter((connection) => connection.from.resource === contextResource.id || connection.to.resource === contextResource.id).map((connection) => connection.id) }); setTopologyContextMenu(null); } }, "Visa deklarerade länkar"),
        e("button", { key: "copy", type: "button", role: "menuitem", "data-topology-context-action": "copy-id", onClick: () => { void navigator.clipboard?.writeText(contextResource.id); setTopologyContextMenu(null); } }, "Kopiera enhets-ID"),
      ] : topologyContextMenu.kind === "edge" && contextConnection ? [
        e("strong", { key: "heading" }, contextConnection.id),
        e("button", { key: "details", type: "button", role: "menuitem", "data-topology-context-action": "edge-details", onClick: () => { setTopologyContextDetails({ kind: "edge", id: contextConnection.id, source: contextConnection.from.resource, target: contextConnection.to.resource }); setTopologyContextMenu(null); } }, "Visa länkdetaljer"),
        e("button", { key: "focus", type: "button", role: "menuitem", "data-topology-context-action": "edge-focus", onClick: () => focusTopologyNode(contextConnection.from.resource, contextConnection.from.resource) }, "Fokusera länkens ändpunkter"),
        e("button", { key: "copy", type: "button", role: "menuitem", "data-topology-context-action": "edge-copy-id", onClick: () => { void navigator.clipboard?.writeText(contextConnection.id); setTopologyContextMenu(null); } }, "Kopiera länk-ID"),
      ] : [
        e("strong", { key: "heading" }, "Topologivy"),
        e("button", { key: "fit", type: "button", role: "menuitem", "data-topology-context-action": "fit", onClick: () => { flowApi.current?.fitView?.({ duration: 220, padding: 0.1 }); setTopologyContextMenu(null); } }, "Anpassa aktuell vy"),
        e("button", { key: "back", type: "button", role: "menuitem", disabled: topologyViewHistory.length <= 1, "data-topology-context-action": "back", onClick: goTopologyBack }, "Tillbaka till överordnad vy"),
        e("button", { key: "overview", type: "button", role: "menuitem", "data-topology-context-action": "overview", onClick: navigateOverview }, "Visa nätverksöversikt"),
        e("button", { key: "reset", type: "button", role: "menuitem", "data-topology-context-action": "reset-camera", onClick: () => { flowApi.current?.fitView?.({ duration: 220, padding: 0.1 }); setTopologyContextMenu(null); } }, "Återställ kameran"),
        e("small", { key: "counts", "data-topology-context-counts": "true" }, `${canonicalNetwork.resources.length} enheter · ${canonicalNetwork.connections.length} länkar`),
      ],
    ) : null,
    topologyContextDetails ? e("aside", { className: "topology-context-details", "data-topology-context-details": topologyContextDetails.kind, role: "status" },
      e("strong", null, topologyContextDetails.label ?? topologyContextDetails.id),
      topologyContextDetails.id ? e("small", null, topologyContextDetails.id) : null,
      topologyContextDetails.type ? e("small", null, topologyContextDetails.type) : null,
      topologyContextDetails.source ? e("small", null, `${topologyContextDetails.source} → ${topologyContextDetails.target}`) : null,
      topologyContextDetails.addresses?.length ? e("small", null, topologyContextDetails.addresses.join(", ")) : null,
      topologyContextDetails.neighbors?.length ? e("small", null, `${topologyContextDetails.neighbors.length} deklarerade grannar`) : null,
      topologyContextDetails.links?.length ? e("small", null, `${topologyContextDetails.links.length} deklarerade länkar`) : null,
      e("button", { type: "button", onClick: () => setTopologyContextDetails(null) }, "Stäng detaljer"),
    ) : null,
  );
}

function BuilderAssetLibrary({ workspace, getWorkspace, setWorkspace, setDiagnostics, getPendingDraftChanges }) {
  const model = buildBuilderAssetLibraryModel(workspace, catalog.assets);
  const selected = workspace.source.resources.find((resource) => resource.id === model.selectedResourceId);
  const run = (result) => {
    if (getPendingDraftChanges()) {
      setDiagnostics([{ severity: "error", code: "BUILDER_ASSET_UNAPPLIED_DRAFT",
        message: "Apply or revert the edited Inspector/JSON fields before changing an asset." }]);
      return;
    }
    if (getWorkspace() !== workspace) {
      setDiagnostics([{ severity: "error", code: "BUILDER_ASSET_STALE_WORKSPACE",
        message: "The project changed before the asset action completed. No previous Builder was restored." }]);
      return;
    }
    setDiagnostics(result.diagnostics);
    if (result.ok) setWorkspace(result.workspace);
  };
  return e("section", { className: "asset-library-panel", "data-asset-library": "ready" },
    e("h3", null, "Resursbibliotek"),
    e("p", { className: "asset-library-status" }, selected
      ? `Vald resurs: ${selected.id} · ${selected.type}`
      : "Välj en resurs för att använda en inbyggd tillgång."),
    model.explicitAssetId ? e("p", { className: "asset-library-status" }, `Explicit: ${model.explicitAssetId}@${model.explicitAssetVersion}`) : null,
    e("div", { className: "asset-library-grid" }, ...model.items.map((item) =>
      e("button", {
        key: `${item.id}@${item.version}`,
        type: "button",
        className: `asset-card${item.compatibleWithSelection ? " compatible" : ""}`,
        disabled: !item.compatibleWithSelection,
        title: item.appliesTo.join(", "),
        onClick: () => {
          const definition = catalog.assets.find((asset) => asset.id === item.id && asset.version === item.version);
          if (!definition) return;
          run(applyAssetToSelectedResource(workspace, definition));
        },
      },
        e("img", { src: `./${item.path}`, alt: "", "aria-hidden": "true", draggable: false }),
        e("span", null, item.label),
        e("small", null, `${item.id}@${item.version}`),
      )
    )),
    selected?.asset ? e("button", { type: "button", onClick: () => run(clearAssetFromSelectedResource(workspace)) }, "Använd automatiskt tillgångsval") : null,
  );
}

function ScenarioStudioToolbar({ workspace, getWorkspace, projectGeneration, getScenarioTransitionId, setWorkspace, setDiagnostics, onCompile, onExport, canReplaceProject }) {
  const [draft, setDraft] = useState(() => ({
    scenarioId: "studio_scenario", title: "Nytt Scenario Studio-scenario",
  }));
  // React can batch input followed by Create in a single native event task.
  // Use what was actually typed, not the values captured at the last render.
  const liveDraftRef = useRef(draft);
  const editDraft = (key, value) => {
    const next = { ...liveDraftRef.current, [key]: value };
    liveDraftRef.current = next;
    setDraft(next);
  };
  if (workspace.mode !== "builder") return null;
  const createDraft = () => {
    if (!scenarioLaunchStillCurrent(projectGeneration, getScenarioTransitionId(),
      workspace, getWorkspace())) {
      setDiagnostics([{ severity: "error", code: "STUDIO_STALE_WORKSPACE",
        message: "The active project changed before Create. Reopen Scenario Studio on the current project." }]);
      return;
    }
    if (!canReplaceProject()) return;
    setWorkspace(createScenarioDraftWorkspace(liveDraftRef.current));
    setDiagnostics([]);
  };
  return e("section", { className: "scenario-studio-toolbar", "data-scenario-studio": "ready" },
    e("div", null,
      e("h2", null, "Scenario Studio"),
      e("p", { className: "studio-helper" }, "Redigera canonical source data. Validate/Compile skapar aktiv Engine truth först efter godkänd kompilering."),
    ),
    e("div", { className: "studio-actions" },
      e("label", { className: "inspector-field" }, "Nytt scenario-ID", e("input", { value: draft.scenarioId, onChange: (event) => editDraft("scenarioId", event.target.value), "data-studio-scenario-id": "true" })),
      e("label", { className: "inspector-field" }, "Titel", e("input", { value: draft.title, onChange: (event) => editDraft("title", event.target.value), "data-studio-scenario-title": "true" })),
      e("small", { "data-studio-canonical-id": "true", role: "status" },
        "Kanoniskt ID i projektfilen: " + canonicalScenarioDraftId(draft.scenarioId)),
      e("button", { type: "button", onClick: createDraft, "data-studio-action": "create" }, "Nytt scenario"),
      e("button", { type: "button", onClick: onCompile, disabled: workspace.compile.status === "valid", "data-studio-action": "validate-compile" }, "Validera + kompilera"),
      e("button", { type: "button", onClick: onExport, "data-studio-action": "export" }, "Exportera canonical JSON"),
    ),
    e("p", { className: "studio-status", "data-studio-draft-revision": String(workspace.sourceRevision) },
      `Draft: ${workspace.source.scenarioId} · Revision ${workspace.sourceRevision} · Status ${workspace.compile.status} · ${workspace.dirty ? "osparat" : "oförändrat"}`,
    ),
  );
}

function BuilderInspector({ workspace, getWorkspace, setWorkspace, setDiagnostics, onPendingDraftChange, getOtherPendingDrafts, projectGeneration }) {
  const model = buildBuilderInspectorModel(workspace);
  const configuration = configurationSummary(workspace.source);
  const [form, setForm] = useState(() => ({ ...model }));
  // Keep the latest typed values synchronously. A fast Apply click in the
  // same event turn as an input change must not commit the previous render's
  // form object and silently leave the project marked unchanged.
  const latestFormRef = useRef(form);
  const initialFormRef = useRef({ ...form });
  const draftOwnerRef = useRef({});
  const hasPendingFormRef = useRef(false);
  useEffect(() => () => onPendingDraftChange(draftOwnerRef.current, false, projectGeneration),
    [onPendingDraftChange]);
  const editForm = (key, value) => {
    const next = { ...latestFormRef.current, [key]: value };
    latestFormRef.current = next;
    hasPendingFormRef.current =
      JSON.stringify(next) !== JSON.stringify(initialFormRef.current);
    onPendingDraftChange(draftOwnerRef.current, hasPendingFormRef.current, projectGeneration);
    setForm(next);
  };
  const [cascade, setCascade] = useState(false);
  const [duplicateId, setDuplicateId] = useState("");
  const [duplicateLabel, setDuplicateLabel] = useState("");
  const [createKind, setCreateKind] = useState("resource");
  const [createId, setCreateId] = useState("");
  const [createLabel, setCreateLabel] = useState("");
  const [createType, setCreateType] = useState("server.generic");
  const [createZone, setCreateZone] = useState("");
  const [createFrom, setCreateFrom] = useState("");
  const [createTo, setCreateTo] = useState("");

  const run = (result, inspectorApply = false) => {
    // A different Builder operation would remount this inspector and silently
    // discard text the operator has not yet committed with Apply.
    if (!inspectorApply && hasPendingFormRef.current) {
      setDiagnostics([{ severity: "error", code: "BUILDER_INSPECTOR_UNAPPLIED_DRAFT",
        message: "Apply or revert the edited inspector fields before creating, deleting or duplicating objects." }]);
      return;
    }
    if (getOtherPendingDrafts(draftOwnerRef.current)) {
      setDiagnostics([{ severity: "error", code: "BUILDER_OTHER_EDITOR_UNAPPLIED",
        message: "Apply or revert the pending edits in the other Builder form first. No source change was committed." }]);
      return;
    }
    // A New/Open or an import can publish the next project synchronously.
    // Old React buttons remain clickable until repaint; never let them
    // resurrect the previous source or corrupt the new project's draft.
    if (getWorkspace() !== workspace) {
      setDiagnostics([{ severity: "error", code: "BUILDER_INSPECTOR_STALE_WORKSPACE",
        message: "The Builder changed before Apply. Reopen the inspector on the current project." }]);
      return;
    }
    setDiagnostics(result.diagnostics);
    if (result.ok) {
      hasPendingFormRef.current = false;
      onPendingDraftChange(draftOwnerRef.current, false, projectGeneration);
      setWorkspace(result.workspace);
    }
  };
  const revertForm = () => {
    if (!hasPendingFormRef.current ||
        !window.confirm("Förkasta inspektörens ej verkställda ändringar?")) return;
    const restored = { ...initialFormRef.current };
    latestFormRef.current = restored;
    hasPendingFormRef.current = false;
    onPendingDraftChange(draftOwnerRef.current, false, projectGeneration);
    setForm(restored);
    setDiagnostics([{ severity: "warning", code: "BUILDER_INSPECTOR_DRAFT_REVERTED",
      message: "Inspektörsutkastet har återställts. Kanonisk projektdata ändrades inte." }]);
  };
  const field = (label, key, extra = {}) => e("label", { className: "inspector-field" }, label,
    e("input", { value: form[key] ?? "", onChange: (event) => editForm(key, event.target.value), ...extra }));
  const textArea = (label, key) => e("label", { className: "inspector-field" }, label,
    e("textarea", { rows: 6, value: form[key] ?? "", onChange: (event) => editForm(key, event.target.value) }));
  const selectField = (label, key, values, allowEmpty = false) => e("label", { className: "inspector-field" }, label,
    e("select", { value: form[key] ?? "", onChange: (event) => editForm(key, event.target.value) },
      ...(allowEmpty ? [e("option", { key: "__empty", value: "" }, "—")] : []),
      ...values.map((value) => e("option", { key: value, value }, value))));

  const apply = () => {
    const draft = latestFormRef.current;
    if (model.kind === "mission") return run(applyMissionInspector(workspace, draft), true);
    if (model.kind === "zone") return run(applyZoneInspector(workspace, model.id, { label: draft.label, kind: draft.zoneKind, parent: draft.parent }), true);
    if (model.kind === "resource") return run(applyResourceInspector(workspace, model.id, {
      label: draft.label, type: draft.resourceType, zone: draft.zone, profile: draft.profile, vendor: draft.vendor, product: draft.product,
      assetId: draft.assetId, assetVersion: draft.assetVersion, propertiesJson: draft.propertiesJson, interfacesJson: draft.interfacesJson,
    }), true);
    return run(applyConnectionInspector(workspace, model.id, {
      kind: draft.connectionKind, fromResource: draft.fromResource, fromPort: draft.fromPort,
      toResource: draft.toResource, toPort: draft.toPort, propertiesJson: draft.propertiesJson,
    }), true);
  };

  const create = () => {
    if (createKind === "zone") {
      run(createZoneFromInspector(workspace, createId, { label: createLabel, kind: createType || "custom", parent: createZone }));
    } else if (createKind === "resource") {
      run(createResourceFromInspector(workspace, createId, {
        label: createLabel, type: createType || "server.generic", zone: createZone,
        propertiesJson: "{}", interfacesJson: "[]",
      }));
    } else {
      run(createConnectionFromInspector(workspace, createId, {
        kind: createType || "network", fromResource: createFrom, toResource: createTo, propertiesJson: "{}",
      }));
    }
  };

  const selectionActions = model.kind === "mission" ? null : e("section", { className: "inspector-actions" },
    model.kind === "resource" ? e(React.Fragment, null,
      e("label", { className: "inspector-field" }, "Duplicate id", e("input", { value: duplicateId, onChange: (event) => setDuplicateId(event.target.value), placeholder: `${model.id}_copy` })),
      e("label", { className: "inspector-field" }, "Duplicate label", e("input", { value: duplicateLabel, onChange: (event) => setDuplicateLabel(event.target.value) })),
      e("button", { type: "button", onClick: () => run(duplicateSelectedBuilderResource(workspace, duplicateId, duplicateLabel || undefined)) }, "Duplicate selected"),
    ) : null,
    e("label", { className: "inline-check" }, e("input", { type: "checkbox", checked: cascade, onChange: (event) => setCascade(event.target.checked) }), "Cascade referenced children/connections"),
    e("button", { type: "button", className: "danger-button", onClick: () => run(deleteSelectedBuilderObject(workspace, cascade)) }, "Delete selected"),
  );

  const editFields = model.kind === "mission" ? e(React.Fragment, null,
    field("Title", "title"), field("Language", "language"), field("Briefing", "briefing"), field("Description", "description"),
  ) : model.kind === "zone" ? e(React.Fragment, null,
    e("p", { className: "immutable-id" }, `ID: ${model.id}`), field("Label", "label"), selectField("Kind", "zoneKind", ZONE_KINDS), selectField("Parent zone", "parent", model.availableParents, true),
  ) : model.kind === "resource" ? e(React.Fragment, null,
    e("p", { className: "immutable-id" }, `ID: ${model.id}`), field("Label", "label"), field("Resource type", "resourceType"),
    selectField("Zone", "zone", model.availableZones, true), field("Profile", "profile"), field("Vendor", "vendor"), field("Product", "product"),
    field("Asset ID (optional explicit override)", "assetId"), field("Asset version/range", "assetVersion"),
    textArea("Properties (JSON object)", "propertiesJson"), textArea("Interfaces (JSON array)", "interfacesJson"),
  ) : e(React.Fragment, null,
    e("p", { className: "immutable-id" }, `ID: ${model.id}`), selectField("Kind", "connectionKind", CONNECTION_KINDS),
    selectField("From resource", "fromResource", model.availableResources), field("From port/interface", "fromPort"),
    selectField("To resource", "toResource", model.availableResources), field("To port/interface", "toPort"), textArea("Properties (JSON object)", "propertiesJson"),
  );

  return e(React.Fragment, null,
    e("section", { className: "configuration-summary", "data-configuration-summary": "ready" },
      e("h3", null, "Nätverkskonfiguration"),
      e("p", null, "Canonical authoring: interface/IP, routes, VLAN, STP, services, firewall/NAT, flows och faults."),
      e("div", { className: "configuration-summary-grid" },
        ...Object.entries(configuration).map(([key, count]) => e("span", { key, "data-configuration-domain": key }, `${key}: ${count}`))),
    ),
    e("section", { className: "typed-inspector", "data-builder-inspector": model.kind,
      "data-builder-unapplied": String(JSON.stringify(form) !== JSON.stringify(initialFormRef.current)) },
      e("h3", null, `Inspektör · ${model.kind}`),
      JSON.stringify(form) !== JSON.stringify(initialFormRef.current)
        ? e("p", { role: "status" }, "UNAPPLIED: Inspector fields have not been committed to the project. Apply or revert before Save/New.") : null,
      editFields,
      e("button", { type: "button", onClick: apply }, "Verkställ inspektörsändringar"),
      e("button", { type: "button", onClick: revertForm,
        disabled: JSON.stringify(form) === JSON.stringify(initialFormRef.current) },
        "Förkasta inspektörsutkast"),
      selectionActions,
    ),
    e("section", { className: "create-panel" },
      e("h3", null, "Skapa topologiobjekt"),
      e("label", { className: "inspector-field" }, "Objekttyp", e("select", { value: createKind, onChange: (event) => { setCreateKind(event.target.value); setCreateType(event.target.value === "zone" ? "custom" : event.target.value === "connection" ? "network" : "server.generic"); } },
        e("option", { value: "zone" }, "Zon"), e("option", { value: "resource" }, "Resurs"), e("option", { value: "connection" }, "Anslutning"))),
      e("label", { className: "inspector-field" }, "ID", e("input", { value: createId, onChange: (event) => setCreateId(event.target.value), placeholder: "server01" })),
      createKind !== "connection" ? e("label", { className: "inspector-field" }, "Label", e("input", { value: createLabel, onChange: (event) => setCreateLabel(event.target.value) })) : null,
      createKind === "zone" ? e("label", { className: "inspector-field" }, "Zone kind", e("select", { value: createType, onChange: (event) => setCreateType(event.target.value) }, ...ZONE_KINDS.map((value) => e("option", { key: value, value }, value)))) : null,
      createKind === "resource" ? e(React.Fragment, null,
        e("label", { className: "inspector-field" }, "Resource type", e("input", { value: createType, onChange: (event) => setCreateType(event.target.value) })),
        e("label", { className: "inspector-field" }, "Zone", e("select", { value: createZone, onChange: (event) => setCreateZone(event.target.value) }, e("option", { value: "" }, "—"), ...workspace.source.zones.map((zone) => e("option", { key: zone.id, value: zone.id }, zone.id)))),
      ) : null,
      createKind === "zone" ? e("label", { className: "inspector-field" }, "Parent zone", e("select", { value: createZone, onChange: (event) => setCreateZone(event.target.value) }, e("option", { value: "" }, "—"), ...workspace.source.zones.map((zone) => e("option", { key: zone.id, value: zone.id }, zone.id)))) : null,
      createKind === "connection" ? e(React.Fragment, null,
        e("label", { className: "inspector-field" }, "Connection kind", e("select", { value: createType, onChange: (event) => setCreateType(event.target.value) }, ...CONNECTION_KINDS.map((value) => e("option", { key: value, value }, value)))),
        e("label", { className: "inspector-field" }, "From", e("select", { value: createFrom, onChange: (event) => setCreateFrom(event.target.value) }, e("option", { value: "" }, "—"), ...workspace.source.resources.map((resource) => e("option", { key: resource.id, value: resource.id }, resource.id)))),
        e("label", { className: "inspector-field" }, "To", e("select", { value: createTo, onChange: (event) => setCreateTo(event.target.value) }, e("option", { value: "" }, "—"), ...workspace.source.resources.map((resource) => e("option", { key: resource.id, value: resource.id }, resource.id)))),
      ) : null,
      e("button", { type: "button", onClick: create }, "Skapa objekt"),
    ),
  );
}

function ImportWorkbenchPanel({ state, setState, getImportState, importRequestEpochRef, onParse, setWorkspace, setDiagnostics, compilerOptions, canReplaceProject }) {
  const parse = onParse;
  const preview = () => {
    const active = getImportState();
    if (!active || active.status === "COMPILING" || active.status === "READING") return;
    // An explicit Preview after a previous compile supersedes the old
    // result; it must not be rolled back by an already queued completion.
    importRequestEpochRef.current++;
    const next = previewScenarioImport(active);
    setState(next); setDiagnostics(next.diagnostics);
  };
  const compile = async () => {
    const active = getImportState();
    if (!active?.workspace || !active.source ||
        active.status === "COMPILING" || active.status === "READING") return;
    const ticket = ++importRequestEpochRef.current;
    const compiling = { ...active, status: "COMPILING", diagnostics: [] };
    setState(compiling);
    try {
      const next = await compileScenarioImport(active, compilerOptions);
      if (ticket !== importRequestEpochRef.current ||
          getImportState() !== compiling) return;
      setState(next); setDiagnostics(next.diagnostics);
    } catch (error) {
      if (ticket !== importRequestEpochRef.current ||
          getImportState() !== compiling) return;
      const failure = { ...active, status: "INVALID", diagnostics: [{
        severity: "error", code: "IMPORT_WORKBENCH_COMPILE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      }] };
      setState(failure); setDiagnostics(failure.diagnostics);
    }
  };
  const activate = () => {
    const active = getImportState();
    // Stale enabled buttons from a previously READY render cannot activate
    // a superseded file while a new parse or compile is pending.
    if (!active || active.status !== "READY_TO_ACTIVATE") return;
    if (!canReplaceProject()) return;
    importRequestEpochRef.current++;
    const next = activateScenarioImport(active);
    setState(next); setDiagnostics(next.diagnostics);
    if (next.status === "ACTIVE" && next.workspace) setWorkspace(next.workspace);
  };
  return e("section", { className: "import-workbench", "data-import-workbench": state.status },
    e("h3", null, "Import Workbench"),
    e("p", null, "Parse → Validate → Preview → Compile → Activate. Parse och preview ändrar inte aktiv Runtime."),
    e("label", { className: "file-button" }, "Välj native JSON", e("input", {
      type: "file", accept: ".json,application/json",
      onChange: (event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) void parse(file);
      }, hidden: true })),
    e("span", { className: "import-state", "data-import-state": state.status },
      `State: ${state.status}${state.fileName ? " · " + state.fileName : ""}`),
    state.status === "READING" ? e("p", { role: "status", "aria-live": "polite" },
      "Reading selected JSON. The previous import cannot be activated while the new file is loading.") :
    state.status === "COMPILING" ? e("p", { role: "status", "aria-live": "polite" },
      "Validating and compiling this exact import. A later file selection cancels the pending result.") : null,
    state.preview && state.status !== "READING" ? e("div", { className: "import-preview", "data-import-preview": "PREVIEW" },
      e("strong", null, `PREVIEW · ${state.preview.title}`),
      e("span", null, `Nodes ${state.preview.nodes} · Links ${state.preview.links} · Zones ${state.preview.zones} · Flows ${state.preview.flows} · Faults ${state.preview.faults}`),
    ) : null,
    e("div", { className: "import-workbench-actions" },
      e("button", { type: "button", onClick: preview,
        disabled: !state.source || state.status === "READING" || state.status === "COMPILING" }, "Preview"),
      e("button", { type: "button", onClick: compile,
        disabled: !state.workspace || state.status === "ACTIVE" ||
          state.status === "READING" || state.status === "COMPILING" }, "Validate + Compile"),
      e("button", { type: "button", onClick: activate, disabled: state.status !== "READY_TO_ACTIVATE" }, "Activate"),
    ),
  );
}

function BuilderAuthoringPanels({ workspace, getWorkspace, setWorkspace, setDiagnostics, onPendingDraftChange, getOtherPendingDrafts, projectGeneration }) {
  const model = buildBuilderAuthoringModel(workspace);
  // The JSX/React render can lag behind a native input event. Maintain an
  // authoritative synchronous draft so Input -> Apply in one JS task commits
  // the text that the operator actually entered, not a stale rendered prop.
  const [drafts, setDrafts] = useState(() => ({
    testsJson: model.testsJson,
    findingsJson: model.findingsJson,
    objectivesJson: model.objectivesJson,
    troubleshootingObjectivesJson: model.troubleshootingObjectivesJson,
    hintsJson: model.hintsJson,
    notesJson: model.notesJson,
    completionJson: model.completionJson,
    solutionJson: model.canonicalSolutionJson,
  }));
  const liveDraftsRef = useRef(drafts);
  const originalDraftsRef = useRef({ ...drafts });
  const draftOwnerRef = useRef({});
  const dirtyKeys = () => Object.keys(originalDraftsRef.current).filter(
    key => liveDraftsRef.current[key] !== originalDraftsRef.current[key]);
  useEffect(() => () => onPendingDraftChange(draftOwnerRef.current, false, projectGeneration),
    [onPendingDraftChange]);
  const editDraft = (key, value) => {
    const next = { ...liveDraftsRef.current, [key]: value };
    liveDraftsRef.current = next;
    onPendingDraftChange(draftOwnerRef.current, dirtyKeys().length > 0, projectGeneration);
    setDrafts(next);
  };
  const applyDraft = (key, apply) => {
    // A New/Open/import may replace the entire canonical source before React
    // remounts these controls. No queued click from the previous project may
    // apply its JSON to the new project or restore an obsolete workspace.
    if (getWorkspace() !== workspace) {
      setDiagnostics([{ severity: "error", code: "BUILDER_AUTHORING_STALE_WORKSPACE",
        message: "The Builder changed before JSON Apply. Review the current project's source again." }]);
      return;
    }
    if (getOtherPendingDrafts(draftOwnerRef.current)) {
      setDiagnostics([{ severity: "error", code: "BUILDER_OTHER_EDITOR_UNAPPLIED",
        message: "Apply or revert the pending Inspector/other Builder form before editing canonical JSON." }]);
      return;
    }
    if (dirtyKeys().some(other => other !== key)) {
      setDiagnostics([{ severity: "error", code: "BUILDER_AUTHORING_MULTIPLE_UNAPPLIED",
        message: "Apply or revert changes in the other JSON panels first. Applying one source revision would otherwise discard their unpublished text." }]);
      return;
    }
    const result = apply(workspace, liveDraftsRef.current[key]);
    setDiagnostics(result.diagnostics);
    if (result.ok) {
      onPendingDraftChange(draftOwnerRef.current, false, projectGeneration);
      setWorkspace(result.workspace);
    }
  };
  const revertDraft = (key, title) => {
    if (liveDraftsRef.current[key] === originalDraftsRef.current[key] ||
        !window.confirm("Förkasta ej verkställda ändringar i " + title + "?")) return;
    const next = { ...liveDraftsRef.current, [key]: originalDraftsRef.current[key] };
    liveDraftsRef.current = next;
    onPendingDraftChange(draftOwnerRef.current, dirtyKeys().length > 0, projectGeneration);
    setDrafts(next);
    setDiagnostics([{ severity: "warning", code: "BUILDER_AUTHORING_DRAFT_REVERTED",
      message: "JSON-utkastet har återställts. Kanonisk projektdata ändrades inte." }]);
  };
  const panel = (title, key, apply, rows = 7) => e("details", { className: "authoring-panel" },
    e("summary", null, title),
    e("textarea", { rows, value: drafts[key],
      onChange: (event) => editDraft(key, event.target.value), "aria-label": title }),
    e("button", { type: "button", onClick: () => applyDraft(key, apply) }, `Apply ${title}`),
    e("button", { type: "button", onClick: () => revertDraft(key, title),
      disabled: drafts[key] === originalDraftsRef.current[key] },
      `Förkasta utkast: ${title}`),
  );
  return e("section", { className: "builder-authoring", "data-builder-authoring": "ready",
    "data-builder-unapplied": String(Object.keys(drafts).some(key => drafts[key] !== originalDraftsRef.current[key])) },
    e("h3", null, "Redigeringspaneler"),
    Object.keys(drafts).some(key => drafts[key] !== originalDraftsRef.current[key])
      ? e("p", { role: "status" }, "UNAPPLIED: JSON draft text is not part of the current project. Apply one panel at a time before Save/New.") : null,
    e("p", null, "Valideringsstatus: ", e("strong", null, model.compileStatus)),
    model.compileDiagnostics.length ? e("ul", { className: "validation-list" }, ...model.compileDiagnostics.map((d, i) => e("li", { key: `${d.code}-${i}` }, `${d.code}: ${d.message}`))) : null,
    panel("Test JSON", "testsJson", applyTestsAuthoring),
    panel("Fynd JSON", "findingsJson", applyFindingsAuthoring),
    panel("Mål JSON", "objectivesJson", applyObjectivesAuthoring),
    panel("Mål för felsökningsevidens JSON", "troubleshootingObjectivesJson", applyTroubleshootingObjectivesAuthoring, 10),
    panel("Ledtrådar JSON", "hintsJson", applyHintsAuthoring, 5),
    panel("Anteckningar JSON", "notesJson", applyNotesAuthoring),
    panel("Slutföranderegel JSON", "completionJson", applyCompletionAuthoring),
    panel("Kanonisk lösning JSON", "solutionJson", applyCanonicalSolutionAuthoring),
  );
}

function ImportHelper({ workspace, setWorkspace, setDiagnostics }) {
  const [source, setSource] = useState(null);
  const [mappingProfile, setMappingProfile] = useState(() => structuredClone(defaultEnterpriseMapping));
  const [baselineId, setBaselineId] = useState("enterprise_baseline");
  const [reviewState, setReviewState] = useState(null);
  const [mappingChoices, setMappingChoices] = useState({});
  const [importState, setImportState] = useState(null);
  const [conflictChoices, setConflictChoices] = useState({});
  const [ancestorBaseline, setAncestorBaseline] = useState(null);
  const [currentBaseline, setCurrentBaseline] = useState(null);
  const [incomingBaseline, setIncomingBaseline] = useState(null);
  const [diffView, setDiffView] = useState(null);
  const [mergeState, setMergeState] = useState(null);
  const [mergeChoices, setMergeChoices] = useState({});
  const [busy, setBusy] = useState(false);
  const [projectionState, setProjectionState] = useState(null);

  const helperError = (code, error) => setDiagnostics([{ severity: "error", code, message: error instanceof Error ? error.message : String(error) }]);
  const clearSourceAnalysis = () => {
    setReviewState(null); setMappingChoices({}); setImportState(null); setConflictChoices({}); setIncomingBaseline(null); setDiffView(null); setMergeState(null); setMergeChoices({}); setProjectionState(null);
  };
  const loadSource = async (file) => {
    if (!file) return;
    try {
      const next = await readEnterpriseImportFile(file);
      setSource(next); clearSourceAnalysis(); setDiagnostics([]);
    } catch (error) { helperError("IMPORT_HELPER_SOURCE_FAILED", error); }
  };
  const loadMapping = async (file) => {
    if (!file) return;
    try {
      const next = await readEnterpriseMappingProfileFile(file);
      setMappingProfile(next); setReviewState(null); setMappingChoices({}); setImportState(null); setConflictChoices({}); setDiagnostics([]);
    } catch (error) { helperError("IMPORT_HELPER_MAPPING_FAILED", error); }
  };
  const review = async (profile = mappingProfile) => {
    if (!source) return;
    setBusy(true);
    try {
      const result = await reviewEnterpriseImport({ source, mappingProfile: profile, options: { trimStrings: true } });
      setReviewState(result); setMappingChoices({});
      setDiagnostics(result.review.diagnostics.map((d) => ({ severity: d.severity === "error" ? "error" : "warning", code: d.code, message: d.message })));
      return result;
    } catch (error) { helperError("IMPORT_HELPER_REVIEW_FAILED", error); }
    finally { setBusy(false); }
  };
  const applyMappingChoices = async () => {
    if (!reviewState?.document) return;
    try {
      const decisions = [];
      for (const table of reviewState.review.tables) {
        const tableChoice = mappingChoices[`table:${table.tableId}`];
        if (!table.sourceTablePresent && tableChoice) decisions.push({ kind: "table", tableId: table.tableId, sourceTable: tableChoice });
      }
      for (const table of reviewState.review.tables) for (const mapping of table.mappings) {
        if (mapping.status === "RESOLVED") continue;
        const field = mappingChoices[`field:${mapping.mappingId}`];
        if (field) decisions.push({ kind: "field", mappingId: mapping.mappingId, field });
      }
      if (!decisions.length) throw new Error("Choose at least one unresolved table or field mapping before applying review decisions.");
      const nextProfile = applyImportHelperMappingDecisions({ profile: mappingProfile, document: reviewState.document, decisions, nextVersion: nextMappingProfileVersion(mappingProfile.version) });
      setMappingProfile(nextProfile);
      await review(nextProfile);
    } catch (error) { helperError("IMPORT_HELPER_MAPPING_DECISION_FAILED", error); }
  };
  const runImport = async (resolutions = []) => {
    if (!source) return;
    setBusy(true);
    try {
      const result = await importEnterpriseBaseline({ baselineId, source, mappingProfile, options: { trimStrings: true }, conflictResolutions: resolutions });
      setImportState(result); setConflictChoices({});
      setDiagnostics(result.report.diagnostics.map((d) => ({ severity: d.severity === "error" ? "error" : "warning", code: d.code, message: d.message })));
      if (result.report.status === "READY" && result.baseline) {
        if (!currentBaseline) {
          setAncestorBaseline(result.baseline); setCurrentBaseline(result.baseline); setIncomingBaseline(null); setDiffView(null); setMergeState(null);
        } else {
          setIncomingBaseline(result.baseline);
          const diff = previewEnterpriseReimport(currentBaseline, result.baseline);
          setDiffView(diff.view);
          const merge = await planImportHelperMerge(ancestorBaseline ?? currentBaseline, currentBaseline, result.baseline);
          setMergeState(merge); setMergeChoices({});
        }
      }
    } catch (error) { helperError("IMPORT_HELPER_IMPORT_FAILED", error); }
    finally { setBusy(false); }
  };
  const retryConflicts = async () => {
    if (!importState?.report.conflicts?.length || !reviewState?.document) return;
    try {
      const resolutions = importState.report.conflicts.map((conflict) => {
        const selected = conflictChoices[conflict.conflictId];
        if (!selected) throw new Error(`Select a source record for conflict ${conflict.conflictId}.`);
        const [table, rowText] = selected.split(":");
        return { resolutionId: conflict.conflictId, code: conflict.code, choice: { strategy: "select-record", table, row: Number(rowText) } };
      });
      await runImport(resolutions);
    } catch (error) { helperError("IMPORT_HELPER_CONFLICT_RESOLUTION_FAILED", error); }
  };
  const applyMerge = async () => {
    if (!mergeState?.plan || !ancestorBaseline || !currentBaseline || !incomingBaseline) return;
    setBusy(true);
    try {
      const resolutions = mergeState.plan.entries.filter((entry) => entry.decision === "REVIEW_REQUIRED").map((entry) => {
        const choice = mergeChoices[entry.entryKey];
        if (!choice) throw new Error(`Choose a merge resolution for ${entry.entryKey}.`);
        return { entryKey: entry.entryKey, choice };
      });
      const merged = await applyImportHelperMerge({ ancestor: ancestorBaseline, current: currentBaseline, incoming: incomingBaseline, plan: mergeState.plan, resolutions });
      setCurrentBaseline(merged); setAncestorBaseline(incomingBaseline); setIncomingBaseline(null); setDiffView(null); setMergeState(null); setMergeChoices({}); setImportState(null);
      setDiagnostics([{ severity: "warning", code: "IMPORT_HELPER_MERGE_APPLIED", message: `Re-import merge applied. Baseline identity: ${merged.baselineIdentity}` }]);
    } catch (error) { helperError("IMPORT_HELPER_MERGE_FAILED", error); }
    finally { setBusy(false); }
  };
  const projectTopology = async () => {
    if (!currentBaseline) return;
    setBusy(true);
    try {
      const projected = await projectImportHelperBaseline(currentBaseline);
      setProjectionState(projected.report);
      const projectionDiagnostics = projected.report.diagnostics.map((d) => ({ severity: d.severity === "error" ? "error" : "warning", code: d.code, message: d.message, ...(d.objectId ? { objectId: d.objectId } : {}) }));
      if (!projected.workspace) { setDiagnostics(projectionDiagnostics); return; }
      let next = await compileBuilderWorkspace(projected.workspace, compilerOptions);
      if (next.compile.status !== "valid") {
        setDiagnostics([...projectionDiagnostics, ...next.compile.diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message }))]);
        return;
      }
      const laidOut = await autoLayoutBuilder(next, new ElkLayoutBackend());
      if (laidOut.ok) next = laidOut.workspace;
      setWorkspace(next);
      setDiagnostics([...projectionDiagnostics, ...laidOut.diagnostics]);
    } catch (error) { helperError("IMPORT_HELPER_PROJECTION_FAILED", error); }
    finally { setBusy(false); }
  };
  const reset = () => {
    setSource(null); setMappingProfile(structuredClone(defaultEnterpriseMapping)); setBaselineId("enterprise_baseline"); clearSourceAnalysis(); setAncestorBaseline(null); setCurrentBaseline(null); setProjectionState(null); setDiagnostics([]);
  };
  const exportMapping = () => downloadJson({ filename: `${mappingProfile.profileId}-${mappingProfile.version}.json`, mime: "application/json", text: `${JSON.stringify(mappingProfile, null, 2)}\n` });

  const reviewRows = reviewState?.view.tables.flatMap((table) => table.mappings.map((mapping) => ({ table, mapping }))) ?? [];
  const unknownFacts = currentBaseline?.facts.filter((fact) => fact.state === "UNKNOWN") ?? [];
  const conflictingFacts = currentBaseline?.facts.filter((fact) => fact.state === "CONFLICTING") ?? [];
  const invalidFacts = currentBaseline?.facts.filter((fact) => fact.state === "INVALID") ?? [];

  return e("details", { className: "import-helper", "data-import-helper": "ready" },
    e("summary", null, "Importhjälp"),
    e("div", { className: "import-helper-body" },
      e("p", { className: "helper-note" }, "Offline deterministic enterprise import. No AI is required; unresolved mappings and conflicts stay explicit."),
      e("div", { className: "helper-grid" },
        e("label", { className: "inspector-field" }, "Baseline ID", e("input", { value: baselineId, onChange: (event) => setBaselineId(event.target.value), disabled: Boolean(currentBaseline) })),
        e("div", { className: "helper-actions" },
          e("label", { className: "file-button" }, source ? `Source: ${source.displayName}` : "Choose enterprise source", e("input", { type: "file", accept: ".xlsx,.ods,.csv,.tsv,.json", onChange: (event) => loadSource(event.target.files?.[0]), hidden: true })),
          e("label", { className: "file-button" }, `Mapping: ${mappingProfile.profileId}@${mappingProfile.version}`, e("input", { type: "file", accept: ".json,application/json", onChange: (event) => loadMapping(event.target.files?.[0]), hidden: true })),
          e("button", { type: "button", onClick: exportMapping }, "Export mapping profile"),
        ),
      ),
      source ? e("section", { className: "helper-stage" },
        e("h4", null, "1. Granska mappning"),
        e("button", { type: "button", onClick: () => review(), disabled: busy }, busy ? "Working…" : "Analyze mappings"),
        reviewState ? e(React.Fragment, null,
          e("p", { className: `helper-status ${reviewState.review.status.toLowerCase()}` }, `Status: ${reviewState.review.status} · adapter ${reviewState.view.adapter}`),
          ...reviewState.review.tables.map((table) => e("div", { key: table.tableId, className: "helper-table" },
            e("strong", null, `${table.tableId} → ${table.sourceTable}`),
            !table.sourceTablePresent ? e("label", { className: "inspector-field" }, "Choose source table",
              e("select", { value: mappingChoices[`table:${table.tableId}`] ?? "", onChange: (event) => setMappingChoices((old) => ({ ...old, [`table:${table.tableId}`]: event.target.value })) },
                e("option", { value: "" }, "— review required —"), ...reviewState.review.availableTables.map((name) => e("option", { key: name, value: name }, name)))) : null,
            ...table.mappings.map((mapping) => e("div", { key: `${table.tableId}-${mapping.mappingId}`, className: "helper-mapping-row" },
              e("span", null, mapping.mappingId), e("span", null, `${mapping.role}${mapping.required ? " · required" : " · optional"}`),
              mapping.status === "RESOLVED"
                ? e("strong", null, `${mapping.selectedField} · ${mapping.selectedClass}`)
                : e("select", { value: mappingChoices[`field:${mapping.mappingId}`] ?? "", onChange: (event) => setMappingChoices((old) => ({ ...old, [`field:${mapping.mappingId}`]: event.target.value })) },
                    e("option", { value: "" }, `— ${mapping.status} —`), ...table.availableFields.map((field) => e("option", { key: field.field, value: field.field }, `${field.field} (${field.occurrences})`))),
            )),
          )),
          reviewState.review.status === "REVIEW_REQUIRED" ? e("button", { type: "button", onClick: applyMappingChoices }, "Apply selected mappings") : null,
          reviewState.review.status === "READY" ? e("button", { type: "button", onClick: () => runImport(), disabled: busy }, currentBaseline ? "Import as re-import candidate" : "Import baseline") : null,
        ) : null,
      ) : null,
      importState ? e("section", { className: "helper-stage" },
        e("h4", null, "2. Importrapport"),
        e("p", { className: `helper-status ${importState.report.status.toLowerCase()}` }, `Status: ${importState.report.status}`),
        e("div", { className: "helper-metrics" },
          e("span", null, `Tables ${importState.view.tables}`), e("span", null, `Records ${importState.view.records}`), e("span", null, `Entities ${importState.view.entities}`), e("span", null, `Facts ${importState.view.facts}`), e("span", null, `Unknown ${importState.view.unknownFacts}`), e("span", null, `Invalid ${importState.view.invalidFacts}`)),
        importState.report.unmappedFields.length ? e("details", null, e("summary", null, `${importState.report.unmappedFields.length} omappade fält`), e("ul", null, ...importState.report.unmappedFields.map((item) => e("li", { key: `${item.table}-${item.field}` }, `${item.table}.${item.field} · ${item.occurrences}`)))) : null,
        importState.report.conflicts.length && reviewState?.document ? e("div", { className: "helper-conflicts" },
          e("strong", null, "Explicit conflict resolution required"),
          ...importState.report.conflicts.map((conflict) => {
            const entityId = conflict.refs[0] ?? "";
            const candidates = findEntityConflictCandidates(reviewState.document, mappingProfile, entityId);
            return e("label", { key: conflict.conflictId, className: "inspector-field" }, conflict.message,
              e("select", { value: conflictChoices[conflict.conflictId] ?? "", onChange: (event) => setConflictChoices((old) => ({ ...old, [conflict.conflictId]: event.target.value })) },
                e("option", { value: "" }, "— choose exact source record —"), ...candidates.map((candidate) => e("option", { key: `${candidate.table}:${candidate.row}`, value: `${candidate.table}:${candidate.row}` }, `${candidate.table} row ${candidate.row}${candidate.label ? ` · ${candidate.label}` : ""}`))));
          }),
          e("button", { type: "button", onClick: retryConflicts }, "Retry import with explicit conflict choices"),
        ) : null,
      ) : null,
      currentBaseline ? e("section", { className: "helper-stage" },
        e("h4", null, "3. Nuvarande företagsbaslinje"),
        e("p", { className: "baseline-identity" }, currentBaseline.baselineIdentity),
        e("div", { className: "helper-metrics" }, e("span", null, `Entities ${currentBaseline.entities.length}`), e("span", null, `Relationships ${currentBaseline.relationships.length}`), e("span", null, `Facts ${currentBaseline.facts.length}`), e("span", null, `Unknown ${unknownFacts.length}`), e("span", null, `Conflicting ${conflictingFacts.length}`), e("span", null, `Invalid ${invalidFacts.length}`)),
        (unknownFacts.length || conflictingFacts.length || invalidFacts.length) ? e("details", null, e("summary", null, "Granska ofullständiga/osäkra fakta"), e("ul", null,
          ...[...unknownFacts, ...conflictingFacts, ...invalidFacts].map((fact) => e("li", { key: fact.factId }, `${fact.subjectRef}${fact.path} · ${fact.state}`)))) : null,
      ) : null,
      diffView ? e("section", { className: "helper-stage" },
        e("h4", null, "4. Skillnader vid återimport"),
        e("div", { className: "helper-metrics" }, ...Object.entries(diffView.summary).map(([key, value]) => e("span", { key }, `${key}: ${value}`))),
        e("details", null, e("summary", null, "Ändrade semantiska objekt"), e("ul", null,
          ...diffView.entityChanges.map((change) => e("li", { key: `e-${change.entityId}` }, `ENTITY ${change.entityId} · ${change.kind}`)),
          ...diffView.relationshipChanges.map((change) => e("li", { key: `r-${change.relationshipId}` }, `RELATIONSHIP ${change.relationshipId} · ${change.kind}`)),
          ...diffView.factChanges.map((change) => e("li", { key: `f-${change.subjectRef}-${change.path}` }, `FACT ${change.subjectRef}${change.path} · ${change.kind}`)))),
      ) : null,
      mergeState ? e("section", { className: "helper-stage" },
        e("h4", null, "5. Sammanfogning som bevarar baslinjen"),
        e("p", { className: `helper-status ${mergeState.plan.status.toLowerCase()}` }, `Status: ${mergeState.plan.status} · ${mergeState.view.reviewRequired} review decision(s)`),
        ...mergeState.plan.entries.filter((entry) => entry.decision === "REVIEW_REQUIRED").map((entry) => e("label", { key: entry.entryKey, className: "inspector-field" }, `${entry.objectKind} ${entry.entryKey} · ${entry.reason}`,
          e("select", { value: mergeChoices[entry.entryKey] ?? "", onChange: (event) => setMergeChoices((old) => ({ ...old, [entry.entryKey]: event.target.value })) },
            e("option", { value: "" }, "— explicit choice required —"),
            Object.prototype.hasOwnProperty.call(entry, "current") ? e("option", { value: "CURRENT" }, "Keep current") : null,
            Object.prototype.hasOwnProperty.call(entry, "incoming") ? e("option", { value: "INCOMING" }, "Use incoming") : null,
            e("option", { value: "DELETE" }, "Delete object")))),
        e("button", { type: "button", onClick: applyMerge, disabled: busy }, mergeState.plan.status === "READY" ? "Apply deterministic re-import merge" : "Apply reviewed re-import merge"),
      ) : null,
      currentBaseline ? e("section", { className: "helper-stage", "data-import-helper-projection": "ready" },
        e("h4", null, "6. Skapa visuell topologi"),
        e("p", { className: "helper-note" }, "Projects the verified enterprise baseline through the ordinary Scenario → Compiler → Layout → Canvas pipeline. This explicit action replaces the current Builder scenario."),
        e("button", { type: "button", onClick: projectTopology, disabled: busy }, "Replace Builder with imported topology"),
        projectionState ? e("div", { className: "helper-metrics" },
          e("span", null, `Status ${projectionState.status}`),
          e("span", null, `Zones ${projectionState.stats.zones}`),
          e("span", null, `Resources ${projectionState.stats.resources}`),
          e("span", null, `Connections ${projectionState.stats.connections}`),
          e("span", null, `Skipped relations ${projectionState.stats.skippedRelationships}`)) : null,
      ) : null,
      e("div", { className: "helper-actions" }, e("button", { type: "button", onClick: reset }, "Reset Import Helper")),
    ),
  );
}


function FaultInjectionPanel({ workspace, setWorkspace, setDiagnostics, onTopologyState }) {
  const compiledScenario = workspace.mode === "runtime" ? workspace.scenario : workspace.compile.status === "valid" ? workspace.compile.model : null;
  const scenarioKey = compiledScenario?.sourceHash ?? "uncompiled";
  const [packId, setPackId] = useState(networkFaultPack.packId);
  const selectedPack = builtinFaultPacks.find((pack) => pack.packId === packId) ?? networkFaultPack;
  const [faultId, setFaultId] = useState(networkFaultPack.faults[0]?.faultId ?? "");
  const [bindings, setBindings] = useState({});
  const [seed, setSeed] = useState("1");
  const [previewState, setPreviewState] = useState(null);
  const [runtimeOverlay, setRuntimeOverlay] = useState(null);
  const [builderDraft, setBuilderDraft] = useState(null);
  const [variantScenarioId, setVariantScenarioId] = useState("fault_variant");
  const [generatorSeed, setGeneratorSeed] = useState("1");
  const [generatorFaultCount, setGeneratorFaultCount] = useState("2");
  const [generatorPackIds, setGeneratorPackIds] = useState(() => builtinFaultPacks.map((pack) => pack.packId));
  const [generatorPreview, setGeneratorPreview] = useState(null);
  const [generatedVariantScenarioId, setGeneratedVariantScenarioId] = useState("generated_fault_variant");
  const [busy, setBusy] = useState(false);

  const faultViews = useMemo(() => compiledScenario ? buildFaultDefinitionViews(selectedPack, compiledScenario) : [], [scenarioKey, selectedPack.packIdentity]);
  const selectedFault = faultViews.find((fault) => fault.faultId === faultId) ?? faultViews[0];
  const activeOverlay = workspace.mode === "runtime" ? runtimeOverlay : builderDraft?.overlay;

  useEffect(() => {
    setPreviewState(null);
    setRuntimeOverlay(null);
    setBuilderDraft(null);
    setGeneratorPreview(null);
    setBindings({});
  }, [scenarioKey, workspace.mode, workspace.mode === "builder" ? workspace.sourceRevision : 0]);

  useEffect(() => {
    if (!selectedFault) return;
    const next = {};
    for (const binding of selectedFault.bindings) {
      const selected = workspace.selection.primary;
      const selectedOption = binding.options.find((option) => option.resourceId === selected);
      next[binding.name] = selectedOption?.resourceId ?? binding.options[0]?.resourceId ?? "";
    }
    setBindings(next);
    setPreviewState(null);
  }, [selectedFault?.faultId, selectedPack.packIdentity, scenarioKey]);

  useEffect(() => {
    setPreviewState(null);
  }, [workspace.mode === "runtime" ? workspace.engineState.stateRevision : builderDraft?.state.stateRevision ?? -1]);

  const uiDiagnostics = (items) => items.map((item) => ({ severity: item.severity === "error" ? "error" : "warning", code: item.code, message: item.message, ...(item.objectId ? { objectId: item.objectId } : {}) }));
  const parsedSeed = () => {
    const value = Number(seed);
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error("Seed must be an unsigned 32-bit integer.");
    return value;
  };
  const requestBindings = () => Object.fromEntries((selectedFault?.bindings ?? []).map((binding) => [binding.name, bindings[binding.name] ?? ""]));

  const ensureBuilderDraft = () => {
    if (workspace.mode !== "builder") return null;
    if (builderDraft) return builderDraft;
    const created = createBuilderFaultDraft(workspace);
    setDiagnostics(created.diagnostics);
    if (!created.ok) return null;
    setBuilderDraft(created.value);
    return created.value;
  };

  const previewFault = async () => {
    if (!compiledScenario || !selectedFault) return;
    setBusy(true);
    try {
      const value = parsedSeed();
      const selectedBindings = requestBindings();
      const preview = workspace.mode === "runtime"
        ? await previewFaultUi({ scenario: workspace.scenario, state: workspace.engineState, pack: selectedPack, faultId: selectedFault.faultId, bindings: selectedBindings, seed: value, mode: "RUNTIME_INJECTION", ...(runtimeOverlay ? { activeOverlay: runtimeOverlay } : {}) })
        : await previewBuilderFaultDraft({ workspace, draft: ensureBuilderDraft(), pack: selectedPack, faultId: selectedFault.faultId, bindings: selectedBindings, seed: value });
      setPreviewState(preview);
      setDiagnostics(uiDiagnostics(preview.diagnostics));
    } catch (error) {
      setPreviewState(null);
      setDiagnostics([{ severity: "error", code: "FAULT_UI_PREVIEW_FAILED", message: error instanceof Error ? error.message : String(error) }]);
    } finally { setBusy(false); }
  };

  const injectSelectedFault = async () => {
    if (!previewState?.ok || !selectedFault) return;
    setBusy(true);
    try {
      const value = parsedSeed();
      const selectedBindings = requestBindings();
      if (workspace.mode === "runtime") {
        const result = await injectFaultIntoRuntime({ workspace, pack: selectedPack, faultId: selectedFault.faultId, bindings: selectedBindings, seed: value, previewToken: previewState.token, ...(runtimeOverlay ? { activeOverlay: runtimeOverlay } : {}) });
        setDiagnostics(result.diagnostics);
        if (result.ok) {
          setWorkspace(result.value.workspace);
          setRuntimeOverlay(result.value.overlay);
          setPreviewState(null);
          const targetResourceId = result.value.overlay.instances.at(-1)?.changedResources?.[0];
          onTopologyState?.(targetResourceId ? buildModeledNodeStateVisual(result.value.workspace.scenario, targetResourceId, "fault-injection", selectedFault.faultId, result.value.workspace.engineState.stateRevision) : null);
        }
      } else {
        const draft = ensureBuilderDraft(); if (!draft) return;
        const result = await injectBuilderFaultDraft({ workspace, draft, pack: selectedPack, faultId: selectedFault.faultId, bindings: selectedBindings, seed: value, previewToken: previewState.token });
        setDiagnostics(result.diagnostics);
        if (result.ok) { setBuilderDraft(result.value); setPreviewState(null); }
      }
    } catch (error) {
      setDiagnostics([{ severity: "error", code: "FAULT_UI_INJECT_FAILED", message: error instanceof Error ? error.message : String(error) }]);
    } finally { setBusy(false); }
  };

  const rollbackLatest = async () => {
    if (workspace.mode !== "runtime" || !runtimeOverlay?.instances.length) return;
    setBusy(true);
    try {
      const result = await rollbackRuntimeFaultUi({ workspace, overlay: runtimeOverlay });
      setDiagnostics(result.diagnostics);
      if (result.ok) { setWorkspace(result.value.workspace); setRuntimeOverlay(result.value.overlay.instances.length ? result.value.overlay : null); setPreviewState(null); onTopologyState?.(null); }
    } finally { setBusy(false); }
  };

  const createVariant = () => {
    if (workspace.mode !== "builder" || !builderDraft) return;
    const result = materializeBuilderFaultVariant({ workspace, draft: builderDraft, variantScenarioId });
    setDiagnostics(result.diagnostics);
    if (result.ok) { setWorkspace(result.value); setBuilderDraft(null); setPreviewState(null); }
  };

  const previewGeneratedVariant = async () => {
    if (workspace.mode !== "builder") return;
    setBusy(true);
    try {
      const nextSeed = Number(generatorSeed);
      const nextCount = Number(generatorFaultCount);
      if (!Number.isInteger(nextSeed) || nextSeed < 0 || nextSeed > 0xffffffff) throw new Error("Generator seed must be an unsigned 32-bit integer.");
      if (!Number.isInteger(nextCount) || nextCount < 1 || nextCount > 32) throw new Error("Fault count must be an integer from 1 through 32.");
      const packs = builtinFaultPacks.filter((pack) => generatorPackIds.includes(pack.packId));
      if (!packs.length) throw new Error("Select at least one exact-versioned Fault Pack.");
      const result = await previewGeneratedBuilderFaultVariant({ workspace, packs, seed: nextSeed, faultCount: nextCount });
      setDiagnostics(result.diagnostics);
      setGeneratorPreview(result.ok ? result.value : null);
    } catch (error) {
      setGeneratorPreview(null);
      setDiagnostics([{ severity: "error", code: "FAULT_GENERATOR_UI_PREVIEW_FAILED", message: error instanceof Error ? error.message : String(error) }]);
    } finally { setBusy(false); }
  };

  const createGeneratedVariant = async () => {
    if (workspace.mode !== "builder" || !generatorPreview) return;
    setBusy(true);
    try {
      const result = await materializeGeneratedBuilderFaultVariant({ workspace, preview: generatorPreview, previewToken: generatorPreview.token, variantScenarioId: generatedVariantScenarioId });
      setDiagnostics(result.diagnostics);
      if (result.ok) { setWorkspace(result.value); setGeneratorPreview(null); setBuilderDraft(null); setPreviewState(null); }
    } finally { setBusy(false); }
  };

  const toggleGeneratorPack = (id) => {
    setGeneratorPackIds((old) => old.includes(id) ? old.filter((item) => item !== id) : [...old, id].sort());
    setGeneratorPreview(null);
  };

  const clearSession = () => {
    setRuntimeOverlay(null); setBuilderDraft(null); setPreviewState(null); setDiagnostics([]);
  };

  if (!compiledScenario) return e("details", { className: "fault-helper", "data-fault-injection-ui": "blocked" },
    e("summary", null, "Felinjektion"),
    e("div", { className: "fault-helper-body" }, e("p", { className: "helper-note" }, "Compile the current Builder scenario before creating a fault variant.")),
  );

  const currentOverlay = workspace.mode === "runtime" ? runtimeOverlay : builderDraft?.overlay;
  const lastInstance = currentOverlay?.instances.at(-1);
  return e("details", { className: "fault-helper", "data-fault-injection-ui": "ready" },
    e("summary", null, "Felinjektion"),
    e("div", { className: "fault-helper-body" },
      e("p", { className: "helper-note" }, workspace.mode === "runtime"
        ? "Injects deterministic faults into Runtime state without modifying the healthy scenario source. Preview is mandatory before injection."
        : "Builds an isolated fault-variant draft. The healthy Builder source is unchanged until you explicitly create a new scenario variant."),
      workspace.mode === "builder" ? e("section", { className: "helper-stage", "data-fault-scenario-generator": "ready" },
        e("h4", null, "Deterministisk scenariogenerator"),
        e("p", { className: "helper-note" }, "Generates a compatible multi-fault variant from exact locked Fault Packs. Same baseline + seed + pack versions + constraints reproduces the same plan. Preview is mandatory; hidden ground truth remains author-side."),
        e("div", { className: "fault-generator-packs" },
          e("strong", null, "Allowed Fault Packs"),
          ...builtinFaultPacks.map((pack) => e("label", { key: `generator-${pack.packId}`, className: "fault-generator-pack" },
            e("input", { type: "checkbox", checked: generatorPackIds.includes(pack.packId), onChange: () => toggleGeneratorPack(pack.packId) }),
            `${builtinFaultPackLabels[pack.packId] ?? pack.packId} · ${pack.version}`))),
        e("label", { className: "inspector-field" }, "Fault count", e("input", { type: "number", min: 1, max: 32, step: 1, value: generatorFaultCount, onChange: (event) => { setGeneratorFaultCount(event.target.value); setGeneratorPreview(null); } })),
        e("label", { className: "inspector-field" }, "Generator seed", e("input", { type: "number", min: 0, max: 4294967295, step: 1, value: generatorSeed, onChange: (event) => { setGeneratorSeed(event.target.value); setGeneratorPreview(null); } })),
        e("p", { className: "helper-note" }, "Compatibility is fail-closed: path overlap, declared incompatibilities, violated preconditions, broken earlier expected effects/negative controls, blast-radius limits and failed combined recovery reject a combination."),
        e("div", { className: "helper-actions" },
          e("button", { type: "button", onClick: previewGeneratedVariant, disabled: busy || generatorPackIds.length === 0 }, busy ? "Arbetar…" : "Förhandsgranska genererad variant")),
        generatorPreview ? e("section", { className: "fault-preview ready" },
          e("strong", null, `Generator preview verified · ${generatorPreview.plan.selections.length} faults`),
          e("small", null, `Plan ${generatorPreview.plan.planIdentity.slice(0, 12)}… · overlay ${generatorPreview.plan.groundTruth.overlayIdentity.slice(0, 12)}…`),
          e("span", null, `Changed resources: ${generatorPreview.plan.groundTruth.changedResources.join(", ") || "none"}`),
          ...generatorPreview.plan.selections.map((selection) => e("div", { key: selection.instanceId, className: "fault-instance" },
            e("span", null, `${selection.ordinal}. ${selection.faultId}`),
            e("small", null, `${selection.packId}@${selection.packVersion} · seed ${selection.seed} · ${Object.entries(selection.bindings).map(([name,target]) => `${name}=${target}`).join(", ")}`))),
          e("strong", null, "Expected combined learner-visible symptoms"),
          e("ul", null, ...generatorPreview.plan.groundTruth.expectedSymptoms.map((item) => e("li", { key: item }, item))),
          e("details", null, e("summary", null, "Handledarens facit / referensordning för felsökning"),
            e("p", { className: "helper-note" }, "This order is based only on verified fault preconditions and stable generator order. Wave 1 observations can now expose modeled command evidence, but the application still does not infer or fabricate causal diagnostic order from command output."),
            e("ol", null, ...generatorPreview.plan.groundTruth.referenceInvestigationOrder.map((step) => e("li", { key: step.instanceId }, `${step.faultId} · ${step.rationale}`)))),
          e("label", { className: "inspector-field" }, "New generated scenario ID", e("input", { value: generatedVariantScenarioId, onChange: (event) => setGeneratedVariantScenarioId(event.target.value) })),
          e("button", { type: "button", onClick: createGeneratedVariant, disabled: busy || !generatedVariantScenarioId }, "Skapa genererad scenariovariant")) : null,
      ) : null,
      e("label", { className: "inspector-field" }, "Fault pack",
        e("select", { value: selectedPack.packId, onChange: (event) => { const next=builtinFaultPacks.find((pack)=>pack.packId===event.target.value) ?? networkFaultPack; setPackId(next.packId); setFaultId(next.faults[0]?.faultId ?? ""); setPreviewState(null); } },
          ...builtinFaultPacks.map((pack) => e("option", { key: pack.packId, value: pack.packId }, `${builtinFaultPackLabels[pack.packId] ?? pack.packId} · ${pack.version}`)))),
      e("label", { className: "inspector-field" }, "Fault",
        e("select", { value: selectedFault?.faultId ?? "", onChange: (event) => { setFaultId(event.target.value); setPreviewState(null); } },
          ...faultViews.map((fault) => e("option", { key: fault.faultId, value: fault.faultId }, `${fault.title} · ${fault.domain}`)))),
      selectedFault ? e(React.Fragment, null,
        ...selectedFault.bindings.map((binding) => e("label", { key: binding.name, className: "inspector-field" }, `Target: ${binding.name}`,
          e("select", { value: bindings[binding.name] ?? "", onChange: (event) => { setBindings((old) => ({ ...old, [binding.name]: event.target.value })); setPreviewState(null); } },
            ...binding.options.map((option) => e("option", { key: option.resourceId, value: option.resourceId }, `${option.label} · ${option.resourceId} · ${option.resourceType}`))))),
        e("label", { className: "inspector-field" }, "Seed",
          e("input", { type: "number", min: 0, max: 4294967295, step: 1, value: seed, onChange: (event) => { setSeed(event.target.value); setPreviewState(null); } })),
        e("div", { className: "fault-difficulty", "aria-label": "Difficulty dimensions" },
          e("strong", null, "Difficulty dimensions"),
          e("span", null, `Layers ${selectedFault.difficulty.layers}`),
          e("span", null, `Dependency depth ${selectedFault.difficulty.dependencyDepth}`),
          e("span", null, `Evidence visibility ${selectedFault.difficulty.evidenceVisibility}`),
          e("span", null, `Remediation constraints ${selectedFault.difficulty.remediationConstraints}`)),
        e("div", { className: "helper-actions" },
          e("button", { type: "button", onClick: previewFault, disabled: busy || selectedFault.bindings.some((binding) => !(bindings[binding.name] ?? "")) }, busy ? "Working…" : "Preview fault"),
          e("button", { type: "button", onClick: injectSelectedFault, disabled: busy || !previewState?.ok }, workspace.mode === "runtime" ? "Inject fault" : "Add fault to variant draft"),
          workspace.mode === "runtime" ? e("button", { type: "button", onClick: rollbackLatest, disabled: busy || !runtimeOverlay?.instances.length }, "Rollback latest fault") : null,
          e("button", { type: "button", onClick: clearSession, disabled: busy || (!currentOverlay?.instances.length && !previewState) }, "Clear fault session")),
        previewState ? e("section", { className: `fault-preview ${previewState.ok ? "ready" : "blocked"}` },
          e("strong", null, previewState.ok ? "Preview verified" : "Preview blocked"),
          e("span", null, `Actual changed resources: ${previewState.changedResources.length}`),
          previewState.changedResources.length ? e("small", null, previewState.changedResources.join(", ")) : null,
          ...previewState.operations.map((operation, index) => e("code", { key: `${index}-${operation.target}-${operation.path}` }, `${operation.op} ${operation.target}.${operation.path}`))) : null,
        currentOverlay?.instances.length ? e("section", { className: "fault-active-overlay" },
          e("strong", null, `Active overlay · ${currentOverlay.instances.length} fault${currentOverlay.instances.length === 1 ? "" : "s"}`),
          e("small", null, `Overlay ${currentOverlay.overlayIdentity.slice(0, 12)}…`),
          ...currentOverlay.instances.map((instance) => e("div", { key: instance.instanceId, className: "fault-instance" },
            e("span", null, `${instance.instanceId}: ${instance.faultId}`),
            e("small", null, `seed ${instance.seed} · rev ${instance.beforeStateRevision}→${instance.afterStateRevision} · changed ${instance.changedResources.join(", ") || "none"}`)))) : null,
        workspace.mode === "builder" && builderDraft?.overlay?.instances.length ? e("section", { className: "fault-variant-stage" },
          e("label", { className: "inspector-field" }, "New scenario ID", e("input", { value: variantScenarioId, onChange: (event) => setVariantScenarioId(event.target.value) })),
          e("button", { type: "button", onClick: createVariant, disabled: busy || !variantScenarioId }, "Create faulted scenario variant")) : null,
        e("section", { className: "fault-explanation" },
          e("strong", null, "Expected learner-visible symptoms"),
          e("ul", null, ...selectedFault.symptoms.map((item) => e("li", { key: item }, item))),
          e("details", null, e("summary", null, "Handledarens facit"), e("p", null, selectedFault.hiddenTruth), e("ul", null, ...selectedFault.learningObjectives.map((item) => e("li", { key: item }, item))))),
      ) : null,
      lastInstance && workspace.mode === "runtime" && workspace.engineState.stateRevision !== lastInstance.afterStateRevision
        ? e("p", { className: "fault-warning" }, "Runtime state has diverged from the latest fault revision. Direct rollback/additional injection will fail closed; use Runtime history/checkpoints or clear the fault session.") : null,
    ),
  );
}



const guidedToolActions = {
  COLLECT_EVIDENCE: [
    { tool: "observations", label: "Öppna observationer" },
    { tool: "probes", label: "Öppna aktiva prober" },
  ],
  REVIEW_EVIDENCE: [
    { tool: "observations", label: "Öppna observationer" },
    { tool: "probes", label: "Öppna aktiva prober" },
    { tool: "notebook", label: "Öppna evidensanteckningar" },
  ],
  FORM_HYPOTHESIS: [{ tool: "notebook", label: "Öppna hypotesanteckningar" }],
  REMEDIATE: [{ tool: "remediation", label: "Öppna Typed Remediation" }],
  COLLECT_AFTER_EVIDENCE: [
    { tool: "observations", label: "Öppna observationer" },
    { tool: "probes", label: "Öppna aktiva prober" },
  ],
  VERIFICATION_COMPLETE: [{ tool: "notebook", label: "Visa verifieringsresultat" }],
  CONTINUE_INVESTIGATION: [
    { tool: "observations", label: "Fortsätt med observationer" },
    { tool: "probes", label: "Fortsätt med aktiva prober" },
  ],
};

function RuntimeGuidedTroubleshootingPanel({ workspace, notebook, setDiagnostics, onOpenTool, onPrepareNextCheck }) {
  const [workflow, setWorkflow] = useState(null);
  const [nextCheck, setNextCheck] = useState(null);
  const [navigationFeedback, setNavigationFeedback] = useState("");
  useEffect(() => {
    let active = true;
    buildGuidedTroubleshootingWorkflow(workspace, notebook ?? undefined).then((result) => {
      if (!active) return;
      if (result.diagnostics.length) setDiagnostics(result.diagnostics);
      setWorkflow(result.ok ? result.workflow ?? null : null);
    });
    buildNextBestCheck(workspace, notebook ?? undefined).then((result) => {
      if (!active) return;
      if (result.diagnostics.length) setDiagnostics(result.diagnostics);
      setNextCheck(result.ok ? result.nextCheck ?? null : null);
    });
    return () => { active = false; };
  }, [workspace.scenario.sourceHash, workspace.engineState.stateRevision, notebook?.notebookIdentity]);
  useEffect(() => { setNavigationFeedback(""); }, [workspace.scenario.sourceHash, workspace.engineState.stateRevision]);
  const actions = workflow ? guidedToolActions[workflow.phase] ?? [] : [];
  const navigateToTool = (action) => {
    const opened = onOpenTool?.(action.tool);
    setNavigationFeedback(opened
      ? `${action.label} öppnades. Välj själv mål och kommando innan du kör något.`
      : "Arbetsytan kunde inte öppnas i det aktuella körläget.");
  };
  return e("details", { className: "observation-helper guided-troubleshooting", "data-guided-troubleshooting": "v0.77" },
    e("summary", null, "Guidad felsökning"),
    e("div", { className: "observation-helper-body" },
      e("p", { className: "helper-note" }, "Endast processvägledning. Arbetsflödet ordnar din evidens → hypotes → typad åtgärd → efterevidens. Det väljer aldrig mål, kommando, probe, diagnos, åtgärd eller värde åt dig."),
      nextCheck ? e("section", { className: "next-check-panel", "data-next-check": nextCheck.kind },
        e("h3", null, "Nästa kontroll"),
        e("strong", { "data-next-check-title": "true" }, nextCheck.title),
        e("p", { className: "helper-note", "data-next-check-reason": "true" }, nextCheck.reason),
        nextCheck.progress.total > 0 ? e("small", { "data-next-check-progress": "true" }, `${nextCheck.progress.completed} av ${nextCheck.progress.total} obligatoriska kontroller dokumenterade.`) : null,
        nextCheck.requirementStatus === "OUT_OF_ORDER" ? e("p", { className: "helper-note", "data-next-check-order": "OUT_OF_ORDER" }, "Evidensen finns ännu inte i rätt ordning; samla den här kontrollen utan att markera kedjan som klar.") : null,
        nextCheck.preparation?.options?.length ? e("p", { className: "helper-note", "data-next-check-options": "true" }, `Flera stödda alternativ finns: ${nextCheck.preparation.options.map((option) => option.label).join(" eller ")}. Välj själv i verktyget.`) : null,
        e("button", { type: "button", "data-next-check-open": "true", onClick: () => onPrepareNextCheck?.(nextCheck) }, nextCheck.actionLabel),
      ) : null,
      workflow ? e(React.Fragment, null,
        e("div", { className: "status-grid" },
          e("span", null, "Aktuell fas"), e("strong", { "data-guided-phase": workflow.phase }, workflow.phase),
          e("span", null, "Körlägesrevision"), e("strong", null, String(workflow.stateRevision)),
          e("span", null, "Aktuell evidens"), e("strong", null, String(workflow.currentRevisionEvidenceCount)),
          e("span", null, "Obligatorisk evidens"), e("strong", null, workflow.requiredEvidenceStatus),
          e("span", null, "Arbetsflödesidentitet"), e("strong", null, `${workflow.workflowIdentity.slice(0, 12)}…`)),
        e("p", { className: "helper-note", "data-guided-next-action": workflow.phase }, workflow.nextAction),
        e("div", { className: "helper-actions guided-next-actions", "data-guided-next-actions": workflow.phase },
          ...actions.map((action) => e("button", {
            key: action.tool,
            type: "button",
            "data-guided-next-tool": action.tool,
            onClick: () => navigateToTool(action),
          }, action.label))),
        navigationFeedback ? e("p", { className: "helper-note", role: "status", "data-guided-navigation-feedback": "true" }, navigationFeedback) : null,
        e("ol", { className: "guided-troubleshooting-steps" }, ...workflow.steps.map((step) => e("li", { key: step.stepId, "data-guided-step": step.stepId, "data-guided-status": step.status },
          e("strong", null, `${step.label} · ${step.status}`),
          e("p", null, step.detail)))),
      ) : e("p", { className: "helper-note" }, "Bygger deterministiskt felsökningsflöde…"),
    ),
  );
}

function RuntimeTroubleshootingSummaryPanel({ workspace, notebook, setDiagnostics }) {
  const [summary, setSummary] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState("");
  const textRef = useRef(null);
  useEffect(() => {
    let active = true;
    setSummary(null);
    setCopyFeedback("");
    buildTroubleshootingSummary(workspace, notebook ?? undefined).then((result) => {
      if (!active) return;
      if (result.diagnostics.length) setDiagnostics(result.diagnostics);
      setSummary(result.ok ? result.summary ?? null : null);
    });
    return () => { active = false; };
  }, [workspace.scenario.sourceHash, workspace.engineState.stateRevision, notebook?.notebookIdentity]);
  const copySummary = async () => {
    if (!summary) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(summary.markdown);
      setCopyFeedback("Sammanfattningen kopierades till urklipp.");
    } catch {
      textRef.current?.focus();
      textRef.current?.select();
      setCopyFeedback("Urklipp kunde inte användas. Texten är markerad — kopiera manuellt med Ctrl+C.");
    }
  };
  const downloadSummary = () => {
    if (summary) downloadBlob(new Blob([summary.markdown], { type: "text/markdown" }), createTroubleshootingSummaryDownload(summary).filename);
  };
  return e("details", { open: true, className: "observation-helper troubleshooting-summary", "data-troubleshooting-summary": "v0.82" },
    e("summary", null, "Felsökningssammanfattning"),
    e("div", { className: "observation-helper-body" },
      summary ? e(React.Fragment, null,
        e("p", { className: "helper-note" }, "Samma aktuella Runtime- och Notebook-evidens används för visningen, kopieringen och Markdown-nedladdningen. Rapporten visar inte dold facit- eller lösningsinformation."),
        e("div", { className: "status-grid", "data-troubleshooting-summary-status": summary.status },
          e("span", null, "Ärende / labb"), e("strong", null, summary.title),
          e("span", null, "Status"), e("strong", null, summary.statusLabel),
          e("span", null, "Runtime-revision"), e("strong", null, String(summary.runtimeRevision)),
          e("span", null, "Completion separat"), e("strong", null, summary.completionLabel),
        ),
        e("section", { className: "summary-section" }, e("h4", null, "Problem"), e("p", null, summary.problem)),
        e("section", { className: "summary-section" }, e("h4", null, "Undersökningar"), summary.evidence.length
          ? e("ul", { className: "notebook-entries" }, ...summary.evidence.map((item) => e("li", { key: item.entryId, "data-summary-evidence": item.entryId },
            e("strong", null, `${item.command}${item.truth ? ` · ${item.truth}` : ""}`),
            e("small", null, `${item.source}${item.destination ? ` → ${item.destination}` : ""} · rev ${item.revision}`),
            !item.truth ? e("p", null, item.result) : null)))
          : e("p", { className: "helper-note" }, "Ingen observation eller aktiv probe är sparad ännu.")),
        e("section", { className: "summary-section", "data-summary-actions": "true" }, e("h4", null, "Genomförda åtgärder"), summary.actions.length
          ? e("ol", { className: "notebook-entries" }, ...summary.actions.map((action) => e("li", { key: action.entryId, "data-summary-action": action.entryId },
            e("strong", null, `${action.label} · ${action.target}`),
            e("small", null, `${action.operation} · rev ${action.beforeRevision} → ${action.afterRevision}`),
            e("p", null, `${action.beforeValue} → ${action.afterValue}`),
            action.note ? e("p", null, action.note) : null)))
          : e("p", { className: "helper-note" }, "Ingen åtgärd är dokumenterad.")),
        e("section", { className: "summary-section", "data-summary-verifications": "true" }, e("h4", null, "Verifieringar per åtgärd"), summary.verifications.length
          ? e("ul", { className: "notebook-entries" }, ...summary.verifications.map((verification) => e("li", { key: verification.remediationEntryId ?? verification.status, "data-summary-remediation-verification": verification.remediationEntryId ?? "unknown" },
            e("strong", null, `${troubleshootingSummaryStatusLabel(verification.status)}${verification.historical ? " · historisk" : ""}`),
            ...verification.pairs.map((pair, index) => e("small", { key: `${verification.remediationEntryId ?? "verification"}-${index}`, "data-summary-remediation-verification-status": pair.pairStatus }, `${pair.label}: ${pair.before} → ${pair.after} · ${pair.pairStatus}`)))))
          : e("p", { className: "helper-note" }, "Ingen matchad före-/efterevidens finns ännu.")),
        e("section", { className: "summary-section", "data-summary-final-verification": summary.fullRecoveryVerified ? "TRUE" : "FALSE" }, e("h4", null, "Slutverifiering"), e("p", null, `Fullständig incidentåterställning verifierad: ${summary.fullRecoveryVerified ? "JA" : "NEJ"}`), e("p", null, `Aktuella slutprober: ${summary.finalVerification.completed.length}/${summary.finalVerification.required.length}`)),
        e("section", { className: "summary-section" }, e("h4", null, "Användarens hypotes"), e("p", null, summary.hypothesis ? `${summary.hypothesis.text}${summary.hypothesis.historical ? " · historisk revision" : ""}` : "Ingen hypotes är dokumenterad.")),
        e("section", { className: "summary-section" }, e("h4", null, "Genomförd åtgärd"), summary.action
          ? e(React.Fragment, null,
            e("p", null, `${summary.action.label} · ${summary.action.target}`),
            e("small", null, `${summary.action.operation} · rev ${summary.action.beforeRevision} → ${summary.action.afterRevision}`),
            e("p", null, `${summary.action.beforeValue} → ${summary.action.afterValue}`),
            summary.action.note ? e("p", null, summary.action.note) : null)
          : e("p", null, "Ingen åtgärd är dokumenterad.")),
        e("section", { className: "summary-section" }, e("h4", null, "Verifiering"), summary.verification?.pairs.length
          ? e("ul", { className: "notebook-entries" }, ...summary.verification.pairs.map((pair, index) => e("li", { key: `${pair.label}-${index}`, "data-summary-verification": pair.pairStatus },
            e("strong", null, pair.label), e("small", null, `${pair.before} → ${pair.after} · ${pair.pairStatus}${summary.verification.historical ? " · historisk" : ""}`))))
          : e("p", null, "Ingen matchad före-/efterevidens finns ännu.")),
        e("section", { className: "summary-section", "data-summary-uncertainty": "true" }, e("h4", null, "Kvarstående osäkerhet"), e("p", null, summary.uncertainty)),
        e("p", { className: "helper-note" }, summary.modeledEnvironment),
        e("label", { className: "summary-copy-field" }, "Rapporttext", e("textarea", { ref: textRef, readOnly: true, value: summary.markdown, rows: 12, "data-summary-markdown": "true", onFocus: (event) => event.currentTarget.select() })),
        e("div", { className: "helper-actions" },
          e("button", { type: "button", onClick: copySummary, "data-summary-copy": "true" }, "Kopiera för IT-ärende"),
          e("button", { type: "button", onClick: downloadSummary, "data-summary-download": "true" }, "Ladda ner sammanfattning (.md)")),
        copyFeedback ? e("p", { className: "helper-note", role: "status", "data-summary-copy-feedback": "true" }, copyFeedback) : null,
      ) : e("p", { className: "helper-note" }, "Bygger aktuell felsökningssammanfattning…"),
    ),
  );
}

function RuntimeObservationPanel({ workspace, setDiagnostics, onSaveEvidence, onTopologyState, nextCheckPreparation = null, onNextCheckPreparationHandled }) {
  const observationDisclosureRef = useRef(null);
  const observationTargetRef = useRef(null);
  const observationCommandRef = useRef(null);
  const preparedObservationCommandRef = useRef(null);
  const initialModel = buildRuntimeObservationModel(workspace, workspace.selection.primary);
  const [targetId, setTargetId] = useState(initialModel.targetId ?? "");
  const [commandId, setCommandId] = useState(initialModel.commands[0]?.commandId ?? "");
  const [transcript, setTranscript] = useState(null);
  const model = buildRuntimeObservationModel(workspace, targetId || workspace.selection.primary);
  const commands = model.commands;

  useEffect(() => {
    const next = buildRuntimeObservationModel(workspace, targetId || workspace.selection.primary);
    if (next.targetId && next.targetId !== targetId) setTargetId(next.targetId);
    if (!next.commands.some((command) => command.commandId === commandId)) setCommandId(next.commands[0]?.commandId ?? "");
    setTranscript(null);
  }, [workspace.scenario.sourceHash, workspace.engineState.stateRevision, workspace.selection.primary]);

  useEffect(() => {
    const next = buildRuntimeObservationModel(workspace, targetId);
    const preparedCommandId = preparedObservationCommandRef.current;
    preparedObservationCommandRef.current = null;
    if (preparedCommandId && next.commands.some((command) => command.commandId === preparedCommandId)) setCommandId(preparedCommandId);
    else if (!next.commands.some((command) => command.commandId === commandId)) setCommandId(next.commands[0]?.commandId ?? "");
    setTranscript(null);
  }, [targetId]);

  useEffect(() => {
    if (!nextCheckPreparation || nextCheckPreparation.tool !== "observations" || nextCheckPreparation.scenarioHash !== workspace.scenario.sourceHash) return;
    const next = buildRuntimeObservationModel(workspace, nextCheckPreparation.targetId);
    if (next.targetId) setTargetId(next.targetId);
    if (nextCheckPreparation.commandId && next.commands.some((command) => command.commandId === nextCheckPreparation.commandId)) {
      preparedObservationCommandRef.current = nextCheckPreparation.commandId;
      setCommandId(nextCheckPreparation.commandId);
    }
    setTranscript(null);
    if (observationDisclosureRef.current) observationDisclosureRef.current.open = true;
    globalThis.requestAnimationFrame?.(() => (nextCheckPreparation.commandId ? observationCommandRef.current : observationTargetRef.current)?.focus({ preventScroll: true }));
    onNextCheckPreparationHandled?.(nextCheckPreparation.requestId);
  }, [nextCheckPreparation?.requestId, workspace.scenario.sourceHash]);

  const run = () => {
    if (!targetId || !commandId) return;
    const result = runRuntimeObservation(workspace, targetId, commandId);
    const visual = result.ok && result.transcript
      ? buildModeledObservationTopologyVisual(workspace.scenario, result.transcript)
      : null;
    setDiagnostics([...result.diagnostics, ...(visual?.diagnostics ?? [])]);
    setTranscript(result.ok ? result.transcript : null);
    onTopologyState?.(visual?.ok ? visual.model ?? null : null);
  };

  return e("details", { ref: observationDisclosureRef, className: "observation-helper", "data-observation-engine": "wave1" },
    e("summary", null, "Diagnostik / observationsmotor"),
    e("div", { className: "observation-helper-body" },
      e("p", { className: "helper-note" }, "Kör deterministiska modellerade observationer mot aktuellt Engine-tillstånd. Välkända Windows-/Linux-kommandon är endast ett pedagogiskt gränssnitt; inget gäst-OS-, PowerShell-, shell-, systemctl- eller kärnkommando körs."),
      model.targets.length ? e(React.Fragment, null,
        e("label", { className: "inspector-field" }, "Mål",
          e("select", { ref: observationTargetRef, value: targetId, onChange: (event) => setTargetId(event.target.value) },
            ...model.targets.map((target) => e("option", { key: target.id, value: target.id }, `${target.label} · ${target.id} · ${target.os}`)))),
        e("label", { className: "inspector-field" }, "Modellerat kommando",
          e("select", { ref: observationCommandRef, value: commandId, onChange: (event) => { setCommandId(event.target.value); setTranscript(null); } },
            ...commands.map((command) => e("option", { key: command.commandId, value: command.commandId }, `${command.command} · ${command.label}`)))),
        commands.find((command) => command.commandId === commandId) ? e("p", { className: "helper-note" }, commands.find((command) => command.commandId === commandId).description) : null,
        e("button", { type: "button", onClick: run, disabled: !commandId }, "Kör modellerad observation"),
        transcript ? e("section", { className: "observation-transcript", "data-observation-transcript": "ready", "data-observation-scenario-id": transcript.scenarioId, "data-observation-scenario-hash": transcript.scenarioHash },
          e("strong", null, `${transcript.command} · ${transcript.targetLabel}`),
          e("small", null, `Engine ${transcript.engineId}@${transcript.engineVersion} · Runtime revision ${transcript.stateRevision} · ${transcript.boundary}`),
          e("pre", null, transcript.lines.join("\n")),
          e("details", null, e("summary", null, `Direkt modellerad evidens (${transcript.evidence.length})`),
            e("ul", null, ...transcript.evidence.map((item, index) => e("li", { key: `${item.path}-${index}` }, `${item.path} · ${item.state}${Object.prototype.hasOwnProperty.call(item, "value") ? ` · ${JSON.stringify(item.value)}` : ""}`)))),
          e("button", { type: "button", onClick: () => onSaveEvidence?.(transcript) }, "Spara evidens i anteckningar"),
        ) : null,
      ) : e("p", { className: "helper-note" }, "Scenariot saknar modellerade Windows- eller Linux-mål i körläget."),
    ),
  );
}


function RuntimeActiveProbePanel({ workspace, setDiagnostics, onSaveEvidence, onVisualJourney, onTopologyState, scenarioLoadKey = 0, autoOpen = false, diagnosticSourceRequest = null, onDiagnosticSourceRequestHandled, nextCheckPreparation = null, onNextCheckPreparationHandled }) {
  const probeDisclosureRef = useRef(null);
  const sourceSelectRef = useRef(null);
  useEffect(() => { if (autoOpen && probeDisclosureRef.current) probeDisclosureRef.current.open = true; }, [autoOpen, workspace.scenario.sourceHash, scenarioLoadKey]);
  const acceptancePresets = verifiedDeliveryProbePresets[workspace.scenario.scenarioId] ?? [];
  const initial = buildRuntimeActiveProbeModel(workspace, workspace.selection.primary);
  const [sourceId, setSourceId] = useState(initial.sourceId ?? "");
  const [probeId, setProbeId] = useState(initial.probes[0]?.probeId ?? "");
  const [destinationId, setDestinationId] = useState(initial.destinationId ?? "");
  const [port, setPort] = useState("80");
  const [queryName, setQueryName] = useState("app.lab.test");
  const [presetId, setPresetId] = useState(acceptancePresets[0]?.id ?? "");
  const [transcript, setTranscript] = useState(null);
  const visualRunSequenceRef = useRef(0);
  const model = buildRuntimeActiveProbeModel(workspace, sourceId || workspace.selection.primary, destinationId);
  const probe = model.probes.find((item) => item.probeId === probeId) ?? model.probes[0];
  const tcpInterpretation = modeledTcpProbeInterpretation(transcript);

  const applyAcceptancePreset = (preset) => {
    if (!preset) return;
    setPresetId(preset.id);
    setSourceId(preset.sourceId);
    setProbeId(preset.probeId);
    setDestinationId(preset.destinationId ?? "");
    setPort(preset.port === undefined ? "80" : String(preset.port));
    setQueryName(preset.queryName ?? "app.lab.test");
    setTranscript(null);
    onVisualJourney?.(null);
    onTopologyState?.(null);
  };

  useEffect(() => {
    const nextPresets = verifiedDeliveryProbePresets[workspace.scenario.scenarioId] ?? [];
    setPresetId(nextPresets[0]?.id ?? "");
    if (nextPresets[0]) applyAcceptancePreset(nextPresets[0]);
    const next = buildRuntimeActiveProbeModel(workspace, workspace.selection.primary);
    if (next.sourceId && next.sourceId !== sourceId) setSourceId(next.sourceId);
    if (!next.probes.some((item) => item.probeId === probeId)) setProbeId(next.probes[0]?.probeId ?? "");
    setDestinationId(next.destinationId ?? "");
    setTranscript(null);
  }, [workspace.scenario.sourceHash, scenarioLoadKey]);

  useEffect(() => {
    if (!diagnosticSourceRequest || diagnosticSourceRequest.scenarioHash !== workspace.scenario.sourceHash) return;
    const requestedSourceId = diagnosticSourceRequest.sourceId;
    const requested = buildRuntimeActiveProbeModel(workspace, requestedSourceId);
    if (requested.sourceId !== requestedSourceId) {
      onDiagnosticSourceRequestHandled?.(diagnosticSourceRequest.requestId);
      return;
    }
    setSourceId(requestedSourceId);
    setProbeId(requested.probes[0]?.probeId ?? "");
    setDestinationId(requested.destinationId ?? "");
    setTranscript(null);
    onVisualJourney?.(null);
    onTopologyState?.(null);
    if (probeDisclosureRef.current) probeDisclosureRef.current.open = true;
    globalThis.requestAnimationFrame?.(() => sourceSelectRef.current?.focus({ preventScroll: true }));
    onDiagnosticSourceRequestHandled?.(diagnosticSourceRequest.requestId);
  }, [diagnosticSourceRequest?.requestId, workspace.scenario.sourceHash]);

  useEffect(() => {
    if (!nextCheckPreparation || nextCheckPreparation.tool !== "probes" || nextCheckPreparation.scenarioHash !== workspace.scenario.sourceHash) return;
    const requested = buildRuntimeActiveProbeModel(workspace, nextCheckPreparation.sourceId, nextCheckPreparation.destinationId);
    if (requested.sourceId !== nextCheckPreparation.sourceId) {
      onNextCheckPreparationHandled?.(nextCheckPreparation.requestId);
      return;
    }
    setSourceId(nextCheckPreparation.sourceId);
    if (nextCheckPreparation.probeId && requested.probes.some((item) => item.probeId === nextCheckPreparation.probeId)) setProbeId(nextCheckPreparation.probeId);
    if (nextCheckPreparation.destinationId && requested.destinations.some((item) => item.id === nextCheckPreparation.destinationId)) setDestinationId(nextCheckPreparation.destinationId);
    if (nextCheckPreparation.port !== undefined) setPort(String(nextCheckPreparation.port));
    if (nextCheckPreparation.queryName !== undefined) setQueryName(nextCheckPreparation.queryName);
    setTranscript(null);
    onVisualJourney?.(null);
    onTopologyState?.(null);
    if (probeDisclosureRef.current) probeDisclosureRef.current.open = true;
    globalThis.requestAnimationFrame?.(() => sourceSelectRef.current?.focus({ preventScroll: true }));
    onNextCheckPreparationHandled?.(nextCheckPreparation.requestId);
  }, [nextCheckPreparation?.requestId, workspace.scenario.sourceHash]);

  useEffect(() => {
    const next = buildRuntimeActiveProbeModel(workspace, sourceId, destinationId);
    if (sourceId && !next.sources.some((item) => item.id === sourceId)) {
      const fallback = buildRuntimeActiveProbeModel(workspace, workspace.selection.primary);
      setSourceId(fallback.sourceId ?? "");
      setProbeId(fallback.probes[0]?.probeId ?? "");
      setDestinationId(fallback.destinationId ?? "");
      setTranscript(null);
      return;
    }
    if (!next.probes.some((item) => item.probeId === probeId)) setProbeId(next.probes[0]?.probeId ?? "");
    if (next.destinationId && !next.destinations.some((item) => item.id === destinationId)) setDestinationId(next.destinationId);
    setTranscript(null);
  }, [sourceId, workspace.engineState]);

  const run = () => {
    if (!sourceId || !probe) return;
    onTopologyState?.(null);
    const args = { sourceId, probeId: probe.probeId };
    if (probe.argumentKind === "destination" || probe.argumentKind === "destination_port") args.destinationId = destinationId;
    if (probe.argumentKind === "destination_port") args.port = Number(port);
    if (probe.argumentKind === "dns_name") args.queryName = queryName;
    const result = runRuntimeActiveProbe(workspace, args);
    setTranscript(result.ok ? result.transcript : null);
    if (result.ok && result.transcript) {
      const visual = buildVisualJourneyFromActiveProbe(workspace.scenario, result.transcript);
      setDiagnostics([...result.diagnostics, ...visual.diagnostics]);
      const playbackModel = visual.ok && visual.model
        ? { ...visual.model, playbackIdentity: `${visual.model.flowId}:${++visualRunSequenceRef.current}` }
        : null;
      onVisualJourney?.(playbackModel);
    } else {
      setDiagnostics(result.diagnostics);
      onVisualJourney?.(null);
    }
  };

  return e("details", { ref: probeDisclosureRef, className: "observation-helper", "data-active-probe-engine": "wave2" },
    e("summary", null, "Modellerade aktiva prober"),
    e("div", { className: "observation-helper-body" },
      e("p", { className: "helper-note" }, "Kör deterministiska skrivskyddade anslutnings-, DNS- och DHCP-prober genom aktuellt modellerat Engine-tillstånd. Kommandonamnen är endast pedagogiska; inget gästkommando, paket, socket, DNS-anrop eller DHCP-utbyte körs."),
      model.sources.length ? e(React.Fragment, null,
        acceptancePresets.length ? e("section", { className: "verified-delivery-preset", "data-verified-delivery-presets": workspace.scenario.scenarioId },
          e("label", { className: "inspector-field" }, "Probe preset / flöde",
            e("select", { value: presetId, onChange: (event) => applyAcceptancePreset(acceptancePresets.find((preset) => preset.id === event.target.value)), "data-verified-delivery-preset": "true", "data-verified-delivery-flow-selector": workspace.scenario.scenarioId === "verified_delivery_mixed" ? "true" : "false" },
              ...acceptancePresets.map((preset) => e("option", { key: preset.id, value: preset.id }, preset.label)))),
          e("p", { className: "helper-note" }, workspace.scenario.scenarioId === "verified_delivery_mixed" ? "Välj ett explicit flöde. Mixed startar deterministiskt med Allowed flow efter varje scenario-load; varje körning visar endast sitt eget Engine-resultat." : "Preset fyller bara i befintlig Active Probe-panel. Resultatet kommer från Validator → Compiler → Engine → Active Probe."),
          e("details", { className: "verified-delivery-explanation", "data-verified-delivery-explanation": "true" },
            e("summary", null, "Varför finns dessa tre demos?"),
            e("p", null, verifiedDeliveryExplanation),
            e("p", null, "Grönt ✓ betyder Engine TRUE/DELIVERED. Rött ✕ betyder Engine FALSE/DROP. UNKNOWN förblir lila och får ingen terminalmarkör.")),
        ) : null,
        e("label", { className: "inspector-field" }, "Källvärd",
          e("select", { ref: sourceSelectRef, value: sourceId, onChange: (event) => setSourceId(event.target.value), "data-active-probe-source": sourceId },
            ...model.sources.map((target) => e("option", { key: target.id, value: target.id }, `${target.label} · ${target.id} · ${target.os}`)))),
        e("label", { className: "inspector-field" }, "Aktiv probe",
          e("select", { value: probe?.probeId ?? "", onChange: (event) => { setProbeId(event.target.value); setTranscript(null); } },
            ...model.probes.map((item) => e("option", { key: item.probeId, value: item.probeId }, `${item.commandTemplate} · ${item.label}`)))),
        probe?.argumentKind === "destination" || probe?.argumentKind === "destination_port" ? e("label", { className: "inspector-field" }, "Destination",
          e("select", { value: destinationId, onChange: (event) => { setDestinationId(event.target.value); setTranscript(null); } },
            ...model.destinations.map((target) => e("option", { key: target.id, value: target.id }, `${target.label} · ${target.id} · ${target.type}`)))) : null,
        probe?.argumentKind === "destination_port" ? e("label", { className: "inspector-field" }, "TCP port", e("input", { inputMode: "numeric", value: port, onChange: (event) => setPort(event.target.value) })) : null,
        probe?.argumentKind === "dns_name" ? e("label", { className: "inspector-field" }, "DNS-namn", e("input", { value: queryName, onChange: (event) => setQueryName(event.target.value) })) : null,
        probe ? e("p", { className: "helper-note" }, probe.description) : null,
        e("button", { type: "button", onClick: run, disabled: !probe || ((probe.argumentKind === "destination" || probe.argumentKind === "destination_port") && !destinationId) }, "Kör modellerad aktiv probe"),
        transcript ? e("section", { className: "observation-transcript", "data-active-probe-transcript": "ready", "data-active-probe-scenario-id": transcript.scenarioId, "data-active-probe-scenario-hash": transcript.scenarioHash },
          e("strong", null, `${transcript.command} · ${transcript.sourceLabel}`),
          e("small", null, `Engine ${transcript.engineId}@${transcript.engineVersion} · Runtime revision ${transcript.stateRevision} · ${transcript.boundary} · verdict ${transcript.truth}`),
          e("pre", null, transcript.lines.join("\n")),
          tcpInterpretation ? e("p", {
            className: "helper-note tcp-probe-interpretation",
            "data-tcp-probe-interpretation": tcpInterpretation.code,
          }, tcpInterpretation.text) : null,
          probe?.category === "dns" ? e("p", {
            className: "helper-note dns-probe-interpretation",
            "data-dns-probe-interpretation": transcript.truth,
          }, transcript.truth === "UNKNOWN"
            ? "Tolkning: namnuppslagningen kunde inte verifieras med den aktuella resolverkonfigurationen. Det bevisar inte att IP-vägen generellt är nere — jämför med en separat modellerad IP-probe."
            : transcript.truth === "TRUE"
              ? "Tolkning: DNS-svaret verifierades mot den modellerade resolverkonfigurationen. Detta är separat evidens från generell IP-reachability."
              : "Tolkning: DNS-proben gav inget verifierat namnuppslag. Jämför med en separat modellerad IP-probe och kontrollera resolverkonfigurationen." ) : null,
          e("details", null, e("summary", null, `Direkt modellerad evidens (${transcript.evidence.length})`),
            e("ul", null, ...transcript.evidence.map((item, index) => e("li", { key: `${item.kind}-${item.subject}-${index}` }, `${item.kind} · ${item.subject} · ${item.state}${Object.prototype.hasOwnProperty.call(item, "value") ? ` · ${JSON.stringify(item.value)}` : ""}`)))),
          e("button", { type: "button", onClick: () => onSaveEvidence?.(transcript) }, "Spara evidens i anteckningar"),
        ) : null,
      ) : e("p", { className: "helper-note" }, "Scenariot saknar modellerade Windows- eller Linux-källvärdar för aktiva prober."),
    ),
  );
}


function RuntimeTroubleshootingNotebookPanel({ workspace, setWorkspace, notebook, setNotebook, setDiagnostics, onTopologyState }) {
  const [noteKind, setNoteKind] = useState("hypothesis");
  const [noteText, setNoteText] = useState("");
  const [evidenceReview, setEvidenceReview] = useState(null);
  const [remTarget, setRemTarget] = useState(workspace.scenario.resources.find((r) => r.type.startsWith("windows.") || r.type.startsWith("linux."))?.id ?? "");
  const [remActionId, setRemActionId] = useState("");
  const [remGateway, setRemGateway] = useState("");
  const [remDnsServers, setRemDnsServers] = useState("");
  const [remFirewallAction, setRemFirewallAction] = useState("allow");
  const [remInterfaceIndex, setRemInterfaceIndex] = useState("0");
  const [remAddresses, setRemAddresses] = useState("");
  const [remService, setRemService] = useState("");
  const [remEnabled, setRemEnabled] = useState("true");
  const [remPort, setRemPort] = useState("22");
  const [remProfile, setRemProfile] = useState("private");
  const [remNote, setRemNote] = useState("");
  const [remPreview, setRemPreview] = useState(null);
  const [remediationReview, setRemediationReview] = useState(null);
  useEffect(() => { setEvidenceReview(null); setRemediationReview(null); }, [workspace.scenario.sourceHash, notebook?.notebookIdentity]);
  useEffect(() => { if (!workspace.scenario.resources.some((r) => r.id === remTarget && (r.type.startsWith("windows.") || r.type.startsWith("linux.")))) setRemTarget(workspace.scenario.resources.find((r) => r.type.startsWith("windows.") || r.type.startsWith("linux."))?.id ?? ""); setRemPreview(null); }, [workspace.scenario.sourceHash, workspace.engineState.stateRevision]);

  const runEvidenceReview = async () => {
    const result = await reviewRuntimeTroubleshootingEvidence(workspace, notebook ?? undefined);
    setDiagnostics(result.diagnostics);
    setEvidenceReview(result.ok ? result.review ?? null : null);
  };

  const typedRemediation = runtimeTypedRemediationContext(workspace, remTarget);
  const effectiveRemActionId = remActionId === "" ? "" : typedRemediation.actions.some((action) => action.actionId === remActionId) ? remActionId : (typedRemediation.actions[0]?.actionId ?? "");
  const remediationRequest = () => {
    if (!remTarget || !effectiveRemActionId) throw new Error("Select a Windows or Linux target and a typed remediation action.");
    if (effectiveRemActionId === "change_default_gateway") return { actionId: effectiveRemActionId, targetId: remTarget, parameters: { gateway: remGateway.trim() } };
    if (effectiveRemActionId === "change_dns_servers") return { actionId: effectiveRemActionId, targetId: remTarget, parameters: { servers: remDnsServers.split(",").map((value) => value.trim()).filter(Boolean) } };
    if (effectiveRemActionId === "set_firewall_default_action") return { actionId: effectiveRemActionId, targetId: remTarget, parameters: { action: remFirewallAction } };
    if (effectiveRemActionId === "set_interface_addresses") return { actionId: effectiveRemActionId, targetId: remTarget, parameters: { interfaceIndex: Number(remInterfaceIndex), addresses: remAddresses.split(",").map((value) => value.trim()).filter(Boolean) } };
    if (effectiveRemActionId === "set_service_enabled") return { actionId: effectiveRemActionId, targetId: remTarget, parameters: { service: remService || typedRemediation.services[0]?.name || "", enabled: remEnabled === "true" } };
    if (effectiveRemActionId === "set_service_port") return { actionId: effectiveRemActionId, targetId: remTarget, parameters: { service: remService || typedRemediation.services.find((service) => service.port !== undefined)?.name || "", port: Number(remPort) } };
    if (effectiveRemActionId === "set_windows_network_profile") return { actionId: effectiveRemActionId, targetId: remTarget, parameters: { profile: remProfile } };
    throw new Error("Unsupported typed remediation action.");
  };
  const previewRemediation = async () => {
    try { const result = await previewRuntimeTypedRemediation(workspace, notebook ?? undefined, remediationRequest()); setDiagnostics(result.diagnostics); setRemPreview(result.ok ? result.preview ?? null : null); }
    catch (cause) { setDiagnostics([{ severity: "error", code: "TYPED_REMEDIATION_UI_INPUT_INVALID", message: cause instanceof Error ? cause.message : String(cause) }]); setRemPreview(null); }
  };
  const commitRemediation = async () => {
    if (!remPreview) return;
    try { const result = await commitRuntimeTypedRemediation(workspace, notebook ?? undefined, remediationRequest(), remPreview.token, remNote); setDiagnostics(result.diagnostics); if (result.ok && result.workspace && result.notebook) { setWorkspace(result.workspace); setNotebook(result.notebook); onTopologyState?.(buildModeledNodeStateVisual(result.workspace.scenario, remTarget, "remediation", effectiveRemActionId, result.workspace.engineState.stateRevision)); setRemPreview(null); setRemNote(""); } }
    catch (cause) { setDiagnostics([{ severity: "error", code: "TYPED_REMEDIATION_UI_INPUT_INVALID", message: cause instanceof Error ? cause.message : String(cause) }]); }
  };
  const runRemediationReview = async (entryId) => { const result = await reviewRuntimeRemediation(workspace, notebook ?? undefined, entryId); setDiagnostics(result.diagnostics); setRemediationReview(result.ok ? result.review ?? null : null); };

  const addNote = async () => {
    if (!noteText.trim()) return;
    const result = await addRuntimeTroubleshootingNote(workspace, notebook ?? undefined, noteKind, noteText);
    setDiagnostics(result.diagnostics);
    if (result.ok && result.notebook) { setNotebook(result.notebook); setNoteText(""); }
  };
  const importNotebook = async (file) => {
    if (!file) return;
    const result = await loadTroubleshootingNotebookFile(workspace, file, packageValidator("troubleshootingNotebook"));
    setDiagnostics(result.diagnostics);
    if (result.ok && result.notebook) setNotebook(result.notebook);
  };
  return e("details", { className: "observation-helper troubleshooting-notebook", "data-troubleshooting-notebook": "v0.75" },
    e("summary", null, "Felsökningssession / evidensanteckningar"),
    e("div", { className: "observation-helper-body" },
      e("p", { className: "helper-note" }, "Build a learner-owned proof chain from saved modeled observations, active probes and manual hypotheses. Entries are bound to the exact scenario hash and Runtime revision. Local Runtime autosave persists the notebook and Runtime progress as one content-addressed troubleshooting session. The notebook never imports hidden fault truth or canonical solution material."),
      workspace.scenario.troubleshootingObjectives?.length ? e("section", { className: "evidence-review", "data-evidence-review": "v0.74" },
        e("h4", null, "Mål för felsökningsevidens"),
        e("p", { className: "helper-note" }, "Scenario-authored, learner-visible evidence requirements are checked only against notebook entries. This review does not inspect hidden fault truth, infer root cause, grade hypotheses or calculate a score."),
        e("button", { type: "button", onClick: runEvidenceReview }, "Review collected evidence"),
        evidenceReview ? e(React.Fragment, null,
          e("div", { className: "status-grid" },
            e("span", null, "Required evidence"), e("strong", null, evidenceReview.requiredEvidenceStatus),
            e("span", null, "Review identity"), e("strong", null, `${evidenceReview.reviewIdentity.slice(0, 12)}…`)),
          e("ol", { className: "notebook-entries" }, ...evidenceReview.objectives.map((objective) => e("li", { key: objective.objectiveId, "data-evidence-objective-status": objective.status },
            e("strong", null, `${objective.title} · ${objective.status}${objective.required ? " · required" : " · optional"}`),
            objective.description ? e("p", null, objective.description) : null,
            e("small", null, `Evidence order: ${objective.evidenceOrder}`),
            e("ul", null, ...objective.requirements.map((requirement) => e("li", { key: requirement.requirementId, "data-evidence-requirement-status": requirement.status },
              `${requirement.label} · ${requirement.status}${requirement.matchedEntryId ? ` · ${requirement.matchedEntryId}` : ""}`))))))
        ) : null
      ) : e("p", { className: "helper-note" }, "This scenario does not define troubleshooting evidence objectives."),
      e("section", { className: "evidence-review remediation-loop", "data-remediation-loop": "v0.75" },
        e("h4", null, "Åtgärds- och verifieringsloop"),
        e("p", { className: "helper-note" }, "Enter a modeled remediation yourself, preview the exact state change, then commit it as one Runtime history step. The workflow never reads canonical solution or hidden fault truth. Save current evidence before remediation, then re-run the same observations/probes afterward to verify improvement."),
        e("p", { className: "helper-note" }, "Typed remediation action: choose a learner-facing safe operation such as Change default gateway, Change DNS servers, Enable or disable service, Set interface addresses or Change firewall default policy. Internal Engine paths are not editable here."),
        e("label", { className: "inspector-field" }, "Target", e("select", { value: remTarget, onChange: (event) => { setRemTarget(event.target.value); setRemService(""); setRemPreview(null); } }, ...workspace.scenario.resources.filter((r) => r.type.startsWith("windows.") || r.type.startsWith("linux.")).map((r) => e("option", { key: r.id, value: r.id }, `${r.label} (${r.id})`)))),
        e("label", { className: "inspector-field" }, "Typed remediation action", e("select", { value: effectiveRemActionId, onChange: (event) => { setRemActionId(event.target.value); setRemService(""); setRemPreview(null); } }, e("option", { value: "", disabled: true }, "Välj åtgärd…"), ...typedRemediation.actions.map((action) => e("option", { key: action.actionId, value: action.actionId }, action.label)))),
        typedRemediation.actions.find((action) => action.actionId === effectiveRemActionId)?.description ? e("p", { className: "helper-note" }, typedRemediation.actions.find((action) => action.actionId === effectiveRemActionId).description) : null,
        effectiveRemActionId === "change_default_gateway" ? e("label", { className: "inspector-field" }, "Gateway IPv4 address", e("input", { value: remGateway, onChange: (event) => { setRemGateway(event.target.value); setRemPreview(null); }, placeholder: "10.0.0.1" })) : null,
        effectiveRemActionId === "change_dns_servers" ? e("label", { className: "inspector-field" }, "DNS servers (comma-separated IPv4)", e("input", { value: remDnsServers, onChange: (event) => { setRemDnsServers(event.target.value); setRemPreview(null); }, placeholder: "10.0.0.53, 10.0.0.54" })) : null,
        effectiveRemActionId === "set_firewall_default_action" ? e("label", { className: "inspector-field" }, "Firewall default policy", e("select", { value: remFirewallAction, onChange: (event) => { setRemFirewallAction(event.target.value); setRemPreview(null); } }, e("option", { value: "allow" }, "allow"), e("option", { value: "deny" }, "deny"))) : null,
        effectiveRemActionId === "set_interface_addresses" ? e(React.Fragment, null,
          e("label", { className: "inspector-field" }, "Interface", e("select", { value: remInterfaceIndex, onChange: (event) => { setRemInterfaceIndex(event.target.value); setRemPreview(null); } }, ...typedRemediation.interfaces.map((iface) => e("option", { key: iface.index, value: String(iface.index) }, `${iface.label} (${iface.id})`)))),
          e("label", { className: "inspector-field" }, "IPv4 CIDR addresses (comma-separated)", e("input", { value: remAddresses, onChange: (event) => { setRemAddresses(event.target.value); setRemPreview(null); }, placeholder: "10.0.0.20/24" }))) : null,
        effectiveRemActionId === "set_service_enabled" ? e(React.Fragment, null,
          e("label", { className: "inspector-field" }, "Service", e("select", { value: remService || typedRemediation.services[0]?.name || "", onChange: (event) => { setRemService(event.target.value); setRemPreview(null); } }, ...typedRemediation.services.map((service) => e("option", { key: service.name, value: service.name }, service.name)))),
          e("label", { className: "inspector-field" }, "Service state", e("select", { value: remEnabled, onChange: (event) => { setRemEnabled(event.target.value); setRemPreview(null); } }, e("option", { value: "true" }, "enabled"), e("option", { value: "false" }, "disabled")))) : null,
        effectiveRemActionId === "set_service_port" ? e(React.Fragment, null,
          e("label", { className: "inspector-field" }, "Service", e("select", { value: remService || typedRemediation.services.find((service) => service.port !== undefined)?.name || "", onChange: (event) => { setRemService(event.target.value); setRemPreview(null); } }, ...typedRemediation.services.filter((service) => service.port !== undefined).map((service) => e("option", { key: service.name, value: service.name }, `${service.name} (current ${service.port})`)))),
          e("label", { className: "inspector-field" }, "Listener port", e("input", { type: "number", min: 1, max: 65535, value: remPort, onChange: (event) => { setRemPort(event.target.value); setRemPreview(null); } }))) : null,
        effectiveRemActionId === "set_windows_network_profile" ? e("label", { className: "inspector-field" }, "Windows network profile", e("select", { value: remProfile, onChange: (event) => { setRemProfile(event.target.value); setRemPreview(null); } }, e("option", { value: "public" }, "public"), e("option", { value: "private" }, "private"), e("option", { value: "domain" }, "domain"))) : null,
        e("label", { className: "inspector-field" }, "Remediation note (optional)", e("input", { value: remNote, onChange: (event) => setRemNote(event.target.value), maxLength: 4000 })),
        e("div", { className: "helper-actions" }, e("button", { type: "button", onClick: previewRemediation }, "Preview remediation"), e("button", { type: "button", disabled: !remPreview, onClick: commitRemediation }, "Commit remediation")),
        remPreview ? e("div", { className: "status-grid" }, e("span", null, "Revision"), e("strong", null, `${remPreview.beforeStateRevision} → ${remPreview.afterStateRevision}`), e("span", null, "Before"), e("strong", null, remPreview.beforeValueState === "KNOWN" ? JSON.stringify(remPreview.beforeValue) : "<absent>"), e("span", null, "After"), e("strong", null, remPreview.afterValueState === "KNOWN" ? JSON.stringify(remPreview.afterValue) : "<absent>")) : null,
        remediationReview ? e("div", { className: "status-grid", "data-remediation-review-status": remediationReview.status }, e("span", null, "Verification"), e("strong", null, remediationReview.status), e("span", null, "Matched before/after pairs"), e("strong", null, String(remediationReview.pairs.length)), e("span", null, "Review identity"), e("strong", null, `${remediationReview.reviewIdentity.slice(0, 12)}…`)) : null),
      notebook ? e(React.Fragment, null,
        e("div", { className: "status-grid" },
          e("span", null, "Entries"), e("strong", null, String(notebook.entries.length)),
          e("span", null, "Notebook identity"), e("strong", null, `${notebook.notebookIdentity.slice(0, 12)}…`),
        ),
        notebook.entries.length ? e("ol", { className: "notebook-entries" }, ...notebook.entries.map((entry) => {
          const stale = entry.stateRevision !== workspace.engineState.stateRevision;
          if (entry.kind === "learner_note") return e("li", { key: entry.entryId, "data-notebook-entry": entry.kind },
            e("strong", null, `#${entry.sequence} · ${entry.noteKind} · rev ${entry.stateRevision}${stale ? " · historical" : ""}`),
            e("p", null, entry.text));
          if (entry.kind === "remediation_action") return e("li", { key: entry.entryId, "data-notebook-entry": entry.kind },
            e("strong", null, `#${entry.sequence} · remediation · ${entry.typedAction?.label ?? `${entry.operation.op} ${entry.operation.target}.${entry.operation.path}`}`),
            e("small", null, `Runtime rev ${entry.beforeStateRevision} → ${entry.afterStateRevision} · ${entry.typedAction ? `${entry.typedAction.targetId} · typed ${entry.typedAction.actionId} · ` : ""}action ${entry.operationIdentity.slice(0, 12)}…`),
            entry.learnerNote ? e("p", null, entry.learnerNote) : null,
            e("button", { type: "button", onClick: () => runRemediationReview(entry.entryId) }, "Verify before/after evidence"));
          const label = entry.kind === "active_probe" ? `${entry.command} · ${entry.truth}` : entry.command;
          return e("li", { key: entry.entryId, "data-notebook-entry": entry.kind },
            e("strong", null, `#${entry.sequence} · ${label}`),
            e("small", null, `Runtime rev ${entry.stateRevision}${stale ? " · historical snapshot" : " · current snapshot"} · transcript ${entry.transcriptIdentity.slice(0, 12)}…`),
            entry.learnerNote ? e("p", null, entry.learnerNote) : null,
            e("pre", null, entry.lines.join("\n")));
        })) : e("p", { className: "helper-note" }, "Notebook created, but no evidence has been saved yet."),
        e("div", { className: "helper-actions" },
          e("button", { type: "button", onClick: () => downloadJson(createTroubleshootingNotebookDownload(notebook)) }, "Export notebook"),
          e("button", { type: "button", onClick: () => setNotebook(null) }, "Clear notebook")),
      ) : e("p", { className: "helper-note" }, "Run an observation or active probe and choose “Save evidence to notebook” to start the proof chain."),
      e("label", { className: "inspector-field" }, "Learner note type",
        e("select", { value: noteKind, onChange: (event) => setNoteKind(event.target.value) },
          e("option", { value: "hypothesis" }, "Hypothesis"), e("option", { value: "next_step" }, "Next step"), e("option", { value: "conclusion" }, "Conclusion"))),
      e("label", { className: "inspector-field" }, "Learner note",
        e("textarea", { value: noteText, onChange: (event) => setNoteText(event.target.value), rows: 3, maxLength: 4000, placeholder: "What does the current evidence support?" })),
      e("button", { type: "button", disabled: !noteText.trim(), onClick: addNote }, "Add note to proof chain"),
      e("label", { className: "file-button" }, "Import notebook", e("input", { type: "file", accept: branding.notebookExtension + ",application/json", onChange: (event) => importNotebook(event.target.files?.[0]) })),
    ),
  );
}

function Sidebar({ workspace, getWorkspace, projectGeneration = 0, onPendingDraftChange, getPendingDraftChanges, getOtherPendingDrafts, setWorkspace, diagnostics, setDiagnostics, notebook, setNotebook, onVisualJourney, onTopologyState, scenarioLoadKey = 0, probeAutoOpen = false, diagnosticSourceRequest = null, onDiagnosticSourceRequestHandled, onDiagnoseFromSource, nextCheckPreparation = null, onNextCheckPreparationHandled, onPrepareNextCheck }) {
  const selected = workspace.selection.primary;
  const semantic = workspace.mode === "builder"
    ? [...workspace.source.zones, ...workspace.source.resources, ...workspace.source.connections].find((x) => x.id === selected)
    : [...workspace.scenario.zones, ...workspace.scenario.resources, ...workspace.scenario.connections].find((x) => x.id === selected);
  const runtimeProbeModel = workspace.mode === "runtime" ? buildRuntimeActiveProbeModel(workspace, selected) : null;
  const runtimeSelectedSource = runtimeProbeModel?.sources.find((source) => source.id === selected) ?? null;
  const [target, setTarget] = useState("");
  const [path, setPath] = useState("");
  const [value, setValue] = useState("true");
  const saveObservationEvidence = async (transcript) => {
    if (workspace.mode !== "runtime") return;
    const result = await captureRuntimeObservationEvidence(workspace, notebook ?? undefined, transcript);
    setDiagnostics(result.diagnostics);
    if (result.ok && result.notebook) setNotebook(result.notebook);
  };
  const saveProbeEvidence = async (transcript) => {
    if (workspace.mode !== "runtime") return;
    const result = await captureRuntimeActiveProbeEvidence(workspace, notebook ?? undefined, transcript);
    setDiagnostics(result.diagnostics);
    if (result.ok && result.notebook) setNotebook(result.notebook);
  };
  const openGuidedTool = (tool) => {
    if (workspace.mode !== "runtime") return false;
    const selectors = {
      observations: '[data-observation-engine="wave1"]',
      probes: '[data-active-probe-engine="wave2"]',
      notebook: '[data-troubleshooting-notebook="v0.75"]',
      remediation: '[data-troubleshooting-notebook="v0.75"]',
      summary: '[data-troubleshooting-summary="v0.82"]',
    };
    const panel = document.querySelector(selectors[tool]);
    if (!panel) return false;
    panel.open = true;
    panel.scrollIntoView({ block: "center", behavior: "smooth" });
    const focusSelector = tool === "notebook" ? "textarea, select, button:not([disabled])" : "select, button:not([disabled])";
    panel.querySelector(focusSelector)?.focus({ preventScroll: true });
    return true;
  };
  const prepareNextCheck = (nextCheck) => {
    if (nextCheck.preparation) return onPrepareNextCheck?.(nextCheck);
    return openGuidedTool(nextCheck.tool);
  };

  const applyOperation = () => {
    if (workspace.mode !== "runtime") return;
    let parsed;
    try { parsed = JSON.parse(value); } catch { parsed = value; }
    const result = applyRuntimeOperation(workspace, { op: "set", target, path, value: parsed });
    setDiagnostics(result.diagnostics);
    if (result.ok) {
      setWorkspace(result.workspace);
      onTopologyState?.(buildModeledNodeStateVisual(result.workspace.scenario, target, "configuration", "runtime.set", result.workspace.engineState.stateRevision));
    }
  };

  const runRuntimeCommand = (result) => {
    setDiagnostics(result.diagnostics);
    if (result.ok) { setWorkspace(result.workspace); onTopologyState?.(null); }
  };

  const createCheckpoint = () => {
    if (workspace.mode !== "runtime") return;
    const result = createRuntimeCheckpoint(workspace);
    runRuntimeCommand(result);
  };

  const restoreLastCheckpoint = () => {
    if (workspace.mode !== "runtime") return;
    const checkpoint = workspace.history.checkpoints.at(-1);
    if (!checkpoint) {
      setDiagnostics([{ severity: "error", code: "RUNTIME_CHECKPOINT_NOT_FOUND", message: "No Runtime checkpoint exists yet." }]);
      return;
    }
    runRuntimeCommand(restoreRuntimeCheckpoint(workspace, checkpoint.id));
  };

  const resetScenario = () => {
    if (workspace.mode !== "runtime") return;
    // Reset is a new troubleshooting run, not merely an Engine history step.
    // Clear learner-owned proof and rendered journey state so a restored fault
    // cannot still look verified from the previous run.
    setWorkspace(resetRuntime(workspace));
    setNotebook(null);
    setDiagnostics([]);
    onVisualJourney?.(null);
    onTopologyState?.(null);
  };

  return e("aside", { className: "side-panel" },
    e("h2", null, workspace.mode === "builder" ? "Byggläge" : "Körläge"),
    e("div", { className: "status-grid" },
      e("span", null, "Läge"), e("strong", null, workspace.mode),
      e("span", null, "Vald"), e("strong", null, selected ?? "—"),
      workspace.mode === "builder" ? e(React.Fragment, null,
        e("span", null, "Kompilering"), e("strong", null, workspace.compile.status),
        e("span", null, "Revision"), e("strong", null, String(workspace.sourceRevision)),
      ) : e(React.Fragment, null,
        e("span", null, "Tillståndsrevision"), e("strong", null, String(workspace.engineState.stateRevision)),
        e("span", null, "Slutfört"), e("strong", null, workspace.evaluation.completion.truth),
        e("span", null, "Ångra / gör om"), e("strong", null, `${workspace.history.past.length} / ${workspace.history.future.length}`),
        e("span", null, "Kontrollpunkter"), e("strong", null, String(workspace.history.checkpoints.length)),
      ),
    ),
    runtimeSelectedSource ? e("section", { className: "runtime-diagnose-action", "data-runtime-diagnose-source": runtimeSelectedSource.id },
      e("h3", null, "Runtime-information"),
      e("p", { className: "helper-note" }, `${runtimeSelectedSource.label} är en modellerad ${runtimeSelectedSource.type.startsWith("windows.") ? "Windows" : "Linux"}-källvärd.`),
      e("button", { type: "button", "data-diagnose-from-source": runtimeSelectedSource.id, onClick: () => onDiagnoseFromSource?.(runtimeSelectedSource.id) }, "Diagnostisera från denna enhet"),
    ) : null,
    workspace.mode === "builder"
      ? e(React.Fragment, null,
          e(ImportHelper, { workspace, setWorkspace, setDiagnostics }),
          e(FaultInjectionPanel, { workspace, setWorkspace, setDiagnostics, onTopologyState }),
          // Source revision starts at zero in *every* project. A New/Open of
          // another project can therefore reuse the same React keys. Bind
          // ephemeral authoring forms to the explicit scenario generation.
          e(BuilderAssetLibrary, { key: `assets-${projectGeneration}-${selected ?? "none"}-${workspace.sourceRevision}`, workspace, getWorkspace, setWorkspace, setDiagnostics, getPendingDraftChanges }),
          e(BuilderInspector, { key: `inspector-${projectGeneration}-${selected ?? "mission"}-${workspace.sourceRevision}`, workspace, getWorkspace, setWorkspace, setDiagnostics, onPendingDraftChange, getOtherPendingDrafts, projectGeneration }),
          e(BuilderAuthoringPanels, { key: `authoring-${projectGeneration}-${workspace.sourceRevision}`, workspace, getWorkspace, setWorkspace, setDiagnostics, onPendingDraftChange, getOtherPendingDrafts, projectGeneration }),
        )
      : e(React.Fragment, null,
          e(FaultInjectionPanel, { workspace, setWorkspace, setDiagnostics, onTopologyState }),
          e(RuntimeGuidedTroubleshootingPanel, { workspace, notebook, setDiagnostics, onOpenTool: openGuidedTool, onPrepareNextCheck: prepareNextCheck }),
          e(RuntimeTroubleshootingSummaryPanel, { workspace, notebook, setDiagnostics }),
          e(RuntimeObservationPanel, { workspace, setDiagnostics, onSaveEvidence: saveObservationEvidence, onTopologyState, nextCheckPreparation, onNextCheckPreparationHandled }),
          e(RuntimeActiveProbePanel, { workspace, setDiagnostics, onSaveEvidence: saveProbeEvidence, onVisualJourney, onTopologyState, scenarioLoadKey, autoOpen: probeAutoOpen, diagnosticSourceRequest, onDiagnosticSourceRequestHandled, nextCheckPreparation, onNextCheckPreparationHandled }),
          e(RuntimeTroubleshootingNotebookPanel, { workspace, setWorkspace, notebook, setNotebook, setDiagnostics, onTopologyState }),
          e("details", { className: "inspector-disclosure" }, e("summary", null, "Inspektör"), e("pre", { className: "inspector" }, semantic ? pretty(semantic) : "Select a topology object."))),
    workspace.mode === "runtime" ? e("section", { className: "operation-editor" },
      e("h3", null, "Konfigurationsåtgärd"),
      e("label", null, "Mål", e("input", { value: target, onChange: (event) => setTarget(event.target.value), placeholder: "firewall01" })),
      e("label", null, "Sökväg", e("input", { value: path, onChange: (event) => setPath(event.target.value), placeholder: "properties.rules.0.action" })),
      e("label", null, "JSON-värde", e("input", { value, onChange: (event) => setValue(event.target.value) })),
      e("button", { type: "button", onClick: applyOperation }, "Verkställ via Engine"),
      e("div", { className: "runtime-history-actions" },
        e("button", { type: "button", disabled: workspace.history.past.length === 0, onClick: () => runRuntimeCommand(undoRuntime(workspace)) }, "Ångra"),
        e("button", { type: "button", disabled: workspace.history.future.length === 0, onClick: () => runRuntimeCommand(redoRuntime(workspace)) }, "Gör om"),
        e("button", { type: "button", onClick: resetScenario }, "Återställ scenario"),
        e("button", { type: "button", onClick: createCheckpoint }, "Skapa checkpoint"),
        e("button", { type: "button", disabled: workspace.history.checkpoints.length === 0, onClick: restoreLastCheckpoint }, "Återställ senaste checkpoint"),
      ),
    ) : null,
    diagnostics.length ? e("section", { className: "diagnostics", "aria-live": "polite" },
      e("h3", null, "Diagnostik"),
      ...diagnostics.map((d, i) => e("p", { key: `${d.code}-${i}`, className: `diagnostic ${d.severity}` }, `${d.code}: ${d.message}`)),
    ) : null,
  );
}

function Explanation({ lines }) {
  if (!lines?.length) return null;
  return e("ul", { className: "explanation" }, ...lines.map((line, index) => e("li", { key: `${index}-${line}` }, line)));
}

function RuntimeResults({ workspace }) {
  if (workspace.mode !== "runtime") return null;
  const details = buildRuntimeDetailModel(workspace);
  return e("section", { className: "results-panel", "aria-label": "Runtime details" },
    e("details", { "data-runtime-panel": "mission", "data-mission-disclosure": "true" },
      e("summary", null, "Uppdrag"),
      e("p", null, details.mission.briefing || "Ingen uppdragsbeskrivning angiven."),
    ),
    e("details", { "data-runtime-panel": "tests" },
      e("summary", null, "Test"),
      e("ul", null, ...details.tests.map((item) => e("li", { key: item.id },
        e("strong", null, `${item.label}: ${item.outcome}`),
        e(Explanation, { lines: item.explanation }),
      ))),
    ),
    e("details", { "data-runtime-panel": "findings" },
      e("summary", null, "Fynd"),
      e("ul", null, ...details.findings.map((item) => e("li", { key: item.id },
        e("strong", null, `${item.title}: ${item.state}`),
        e("span", null, `Allvarlighetsgrad: ${item.severity}`),
        item.evidenceTests.length ? e("small", null, `Evidenstest: ${item.evidenceTests.join(", ")}`) : null,
        e(Explanation, { lines: item.explanation }),
      ))),
    ),
    e("details", { "data-runtime-panel": "evidence" },
      e("summary", null, "Evidens"),
      e("ol", null, ...details.evidence.map((item) => e("li", { key: `${item.sequence}-${item.testId}` },
        e("strong", null, `${item.testId}: ${item.outcome}`),
        e("p", null, item.summary),
        e(Explanation, { lines: item.explanation }),
      ))),
    ),
    e("details", { "data-runtime-panel": "progress" },
      e("summary", null, "Framsteg"),
      e("p", null, `Tillståndsrevision: ${details.progress.stateRevision}`),
      e("p", null, `Slutförande: ${details.progress.completion}`),
      e("p", null, `Ångra / gör om: ${details.progress.undoDepth} / ${details.progress.redoDepth}`),
      e("p", null, `Checkpoints: ${details.progress.checkpoints.length}`),
      e(Explanation, { lines: details.progress.completionExplanation }),
    ),
    e("details", { "data-runtime-panel": "hints" },
      e("summary", null, "Ledtrådar"),
      details.hints?.length
        ? e("ol", null, ...details.hints.map((hint, index) => e("li", { key: `${hint.level}-${index}` }, `Nivå ${hint.level}: ${hint.text}`)))
        : e("p", null, "Inga ledtrådar angivna."),
    ),
    e("details", { "data-runtime-panel": "learning" },
      e("summary", null, "Lärande / mål"),
      e("ul", null, ...details.objectives.map((item) => e("li", { key: item.id },
        e("strong", null, `${item.title}: ${item.state}`),
        e("small", null, `${item.category}${item.required ? " · obligatorisk" : " · valfri"}`),
        e(Explanation, { lines: item.explanation }),
      ))),
    ),
  );
}

function WorkspaceMenu({ label, children, className = "", panelClassName = "", closeOnAction = true, alwaysOpen = false }) {
  const menuRef = useRef(null);
  const summaryRef = useRef(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const close = (restoreFocus = false) => {
      if (menuRef.current?.open) menuRef.current.open = false;
      setOpen(false);
      if (restoreFocus) summaryRef.current?.focus();
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target)) close(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);
  return e("details", {
    ref: menuRef,
    className: `workspace-menu ${className}`.trim(),
    ...(alwaysOpen ? { open: true } : {}),
    onToggle: (event) => {
      if (alwaysOpen && !event.currentTarget.open) {
        queueMicrotask(() => {
          if (menuRef.current) menuRef.current.open = true;
        });
        setOpen(true);
        return;
      }
      setOpen(event.currentTarget.open);
    },
    onClick: (event) => {
      if (!closeOnAction) return;
      if (event.target.closest("button, .file-button")) {
        queueMicrotask(() => {
          if (menuRef.current?.open) menuRef.current.open = false;
        });
      }
    },
  },
    e("summary", { ref: summaryRef, "aria-haspopup": "menu" }, label),
    e("div", { className: `workspace-menu-panel ${panelClassName}`.trim(), role: "menu" }, children),
  );
}


function NetworkTopologyImportPanel({ onClose, onActivate, compilerOptions, setDiagnostics, initialSelection, workspaceIdentity, getCurrentWorkspaceIdentity }) {
  const panelRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [selectedLinkSource, setSelectedLinkSource] = useState(null);
  const [legacyWorkbookConsent, setLegacyWorkbookConsent] = useState(false);
  const [atlasG4Consent, setAtlasG4Consent] = useState(false);
  const [tenThousandBoundedConsent,setTenThousandBoundedConsent]=useState(false);
  const [reimportReview, setReimportReview] = useState(null);
  const [reimportApproved, setReimportApproved] = useState(false);
  const [savedReplay, setSavedReplay] = useState(null);
  // The previous source is the CURRENT live editable workspace, not a
  // cryptographically attested past original file.
  const isCoreReimport = (candidate) => Boolean(candidate?.ok && candidate?.source &&
    candidate.source.scenarioId === "imported_network" &&
    workspaceIdentity?.source?.scenarioId === candidate.source.scenarioId);
  const largeNetworkPreview=(candidate)=>Boolean(candidate?.source&&
    (candidate.source.resources.length>=5000||candidate.source.connections.length>=5000));
  const tenThousandCsvProfile=(candidate)=>Boolean(candidate?.ok&&
    typeof candidate.filename==="string"&&/\.csv$/i.test(candidate.filename)&&
    candidate.source?.scenarioId==="imported_network"&&
    candidate.devices===10000&&candidate.links===10000&&
    candidate.source.resources.length===10000&&
    candidate.source.connections.length===10000&&
    candidate.unmappedColumnCount===0&&!candidate.linkSourceConflict);
  // P4e1: separate opt-in to genuine two-sheet XLSX, never a CSV shortcut.
  const tenThousandXlsxProfile=candidate=>Boolean(candidate?.ok&&
    typeof candidate.filename==="string"&&/\.xlsx$/i.test(candidate.filename)&&
    Array.isArray(candidate.sheets)&&candidate.sheets.length===2&&
    candidate.sheets.includes("Devices")&&candidate.sheets.includes("Links")&&
    candidate.source?.scenarioId==="imported_network"&&
    candidate.devices===10000&&candidate.links===10000&&
    candidate.source.resources.length===10000&&
    candidate.source.connections.length===10000&&
    candidate.unmappedColumnCount===0&&!candidate.linkSourceConflict&&
    candidate.source.connections.every(link=>
      link.from?.port===undefined&&link.to?.port===undefined));
  // P4f2: separate genuine ODF two-sheet review; never CSV/XLSX masquerade.
  const tenThousandOdsProfile=candidate=>Boolean(candidate?.ok&&
    typeof candidate.filename==="string"&&/\.ods$/i.test(candidate.filename)&&
    Array.isArray(candidate.sheets)&&candidate.sheets.length===2&&
    candidate.sheets.includes("Devices")&&candidate.sheets.includes("Links")&&
    candidate.source?.scenarioId==="imported_network"&&
    candidate.devices===10000&&candidate.links===10000&&
    candidate.source.resources.length===10000&&
    candidate.source.connections.length===10000&&
    candidate.unmappedColumnCount===0&&!candidate.linkSourceConflict&&
    candidate.source.connections.every(link=>
      link.from?.port===undefined&&link.to?.port===undefined));
  // ATLAS-001 G4 is a separately identified synthetic six-sheet source. It
  // is opt-in only and never broadens the generic import acceptance rules.
  const atlasG4SyntheticProfile = candidate => Boolean(candidate?.ok &&
    candidate.filename === "atlas001-g4-500.xlsx" &&
    (candidate.workbookProfile === "standard" || candidate.workbookProfile === "legacy-six") &&
    candidate.source?.scenarioId === "atlas_g4_synthetic_500" &&
    candidate.devices === 500 && candidate.links === 499 &&
    candidate.source.resources.length === 500 &&
    candidate.source.connections.length === 499 &&
    candidate.source.zones.length === 10 && candidate.unmappedColumnCount === 0 &&
    !candidate.linkSourceConflict &&
    candidate.source.resources.every(resource => /^g4_node_[0-9]{3}$/.test(resource.id)) &&
    candidate.source.connections.every(connection => /^g4_link_[0-9]{3}$/.test(connection.id)));
  const requestId = useRef(0);
  const selectedOriginal = useRef(null);
  const invalidated = () => {
    requestId.current++;
    selectedOriginal.current = null;
    setPreview(null); setFailure(""); setBusy(false); setSelectedLinkSource(null);
    setAtlasG4Consent(false);
    setTenThousandBoundedConsent(false);
    setLegacyWorkbookConsent(false);
    setReimportReview(null); setReimportApproved(false); setSavedReplay(null);
    setDiagnostics([]);
  };
  const close = () => { invalidated(); onClose(); };
  const chooseFile = async (file) => {
    const current = ++requestId.current;
    selectedOriginal.current = file ?? null;
    setFailure(""); setPreview(null); setDiagnostics([]); setSelectedLinkSource(null);
    setAtlasG4Consent(false);
    setTenThousandBoundedConsent(false);
    setLegacyWorkbookConsent(false);
    setReimportReview(null); setReimportApproved(false); setSavedReplay(null);
    if (!file) { setBusy(false); return; }
    setBusy(true);
    try {
      const result = await previewNetworkTopologyFile(file);
      if (requestId.current !== current) return;
      setPreview(result);
      setDiagnostics(result.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: d.message })));
    } catch (error) {
      if (requestId.current === current) {
        setFailure(error instanceof Error ? error.message : String(error));
        setDiagnostics([{ code: "NETWORK_IMPORT_SOURCE_BLOCKED", severity: "error", message: error instanceof Error ? error.message : String(error) }]);
      }
    } finally { if (requestId.current === current) setBusy(false); }
  };
  // Operator decision is source-bound: the initial unresolved source SHA and
  // dual declared-link counts MUST agree with the newly parsed original.
  // No default source or heuristic merging is permitted.
  const reviewLinkSource = async (choice) => {
    if (busy || !preview?.linkSourceConflict || preview.linkSourceChoice ||
        !["LINKS_SHEET", "INLINE_CONNECTED_TO"].includes(choice)) return;
    const initial = preview;
    const original = selectedOriginal.current;
    if (!original || getCurrentWorkspaceIdentity() !== workspaceIdentity) {
      setFailure("IC020_P1_STALE"); return;
    }
    const current = ++requestId.current;
    setBusy(true); setFailure(""); setPreview(null); setDiagnostics([]);
    setTenThousandBoundedConsent(false);
    setLegacyWorkbookConsent(false);
    setAtlasG4Consent(false);
    setReimportReview(null); setReimportApproved(false); setSavedReplay(null);
    try {
      const next = await previewNetworkTopologyFile(original, { linkSourceChoice: choice });
      if (requestId.current !== current || selectedOriginal.current !== original) return;
      if (getCurrentWorkspaceIdentity() !== workspaceIdentity) {
        setFailure("IC020_P1_STALE"); return;
      }
      if (next.sourceSha256 !== initial.sourceSha256 ||
          next.sourceByteSize !== initial.sourceByteSize ||
          JSON.stringify(next.linkSourceConflict) !== JSON.stringify(initial.linkSourceConflict) ||
          next.linkSourceChoice !== choice) {
        selectedOriginal.current = null;
        setFailure("IC020_P2A_SOURCE_CHANGED");
        return;
      }
      setSelectedLinkSource(choice);
      setPreview(next);
      setDiagnostics(next.diagnostics.map((d) => ({code:d.code,severity:d.severity,message:d.message})));
    } catch {
      if (requestId.current !== current) return;
      selectedOriginal.current = null;
      setFailure("IC020_P2A_SOURCE_CHANGED");
    } finally { if (requestId.current === current) setBusy(false); }
  };
  const reviewCoreReimport = async () => {
    if (busy || !preview?.ok || !preview.source || !isCoreReimport(preview)) return;
    const candidate=preview, original=selectedOriginal.current, epoch=requestId.current;
    const isCurrent=()=>Boolean(original) && requestId.current===epoch &&
      selectedOriginal.current===original && getCurrentWorkspaceIdentity()===workspaceIdentity;
    if(!isCurrent()){setFailure("IC020_P2B_BASELINE_CHANGED");return;}
    setBusy(true);setFailure("");setReimportReview(null);setReimportApproved(false);setSavedReplay(null);
    try{
      await verifyNetworkTopologyOriginalForActivation(original,candidate,isCurrent);
      const report=await compareCoreNetworkReimport(workspaceIdentity,candidate,isCurrent);
      if(!isCurrent())throw new Error("IC020_P2B_BASELINE_CHANGED");
      setReimportReview(report);
    }catch{
      if(requestId.current===epoch){
        setFailure("IC020_P2B_BASELINE_CHANGED");
        setReimportReview(null);setReimportApproved(false);
      }
    }finally{if(requestId.current===epoch)setBusy(false);}
  };
  // Saved diff export is reference information; never an approval token.
  const exportCoreReimportReport = async () => {
    if (busy || !reimportReview || !preview?.ok || !isCoreReimport(preview)) return;
    const candidate=preview, original=selectedOriginal.current, epoch=requestId.current;
    const isCurrent=()=>Boolean(original) && requestId.current===epoch &&
      selectedOriginal.current===original && getCurrentWorkspaceIdentity()===workspaceIdentity;
    if(!isCurrent()){setFailure("IC020_P2C1_REPLAY_MISMATCH");return;}
    setBusy(true);setFailure("");
    try{
      await verifyNetworkTopologyOriginalForActivation(original,candidate,isCurrent);
      const current=await compareCoreNetworkReimport(workspaceIdentity,candidate,isCurrent);
      if(!isCurrent() || JSON.stringify(current)!==JSON.stringify(reimportReview))
        throw new Error("IC020_P2C1_REPLAY_MISMATCH");
      downloadJson({filename:"yadilab-core-reimport-"+current.incomingOriginalSourceSha256.slice(0,12)+".json",
        mime:"application/json",text:savedCoreReimportReportText(current)});
    }catch{
      if(requestId.current===epoch)setFailure("IC020_P2C1_REPLAY_MISMATCH");
    }finally{if(requestId.current===epoch)setBusy(false);}
  };
  // Reopen the original, recompute the LIVE Builder diff and compare all saved
  // fields. A matched report *never* restores a prior replacement approval.
  const replaySavedCoreReimportReport = async file => {
    if(busy || !file || !preview?.ok || !isCoreReimport(preview))return;
    const candidate=preview, original=selectedOriginal.current, epoch=requestId.current;
    const isCurrent=()=>Boolean(original) && requestId.current===epoch &&
      selectedOriginal.current===original && getCurrentWorkspaceIdentity()===workspaceIdentity;
    setReimportApproved(false);setReimportReview(null);setSavedReplay(null);setFailure("");
    if(!isCurrent()){setFailure("IC020_P2C1_REPLAY_MISMATCH");return;}
    setBusy(true);
    try{
      const saved=await readSavedCoreReimportReport(file,isCurrent);
      await verifyNetworkTopologyOriginalForActivation(original,candidate,isCurrent);
      const current=await compareCoreNetworkReimport(workspaceIdentity,candidate,isCurrent);
      if(!isCurrent())throw new Error("IC020_P2C1_REPLAY_MISMATCH");
      const matched=matchSavedCoreReimportReport(saved,current);
      if(!isCurrent())throw new Error("IC020_P2C1_REPLAY_MISMATCH");
      setReimportReview(current);
      setSavedReplay(matched);
      // Never setReimportApproved(true): approval is a separate live click.
    }catch(error){
      if(requestId.current===epoch){
        const code=error?.code==="IC020_P2C1_SIDECAR_INVALID"
          ? "IC020_P2C1_SIDECAR_INVALID" : "IC020_P2C1_REPLAY_MISMATCH";
        setFailure(code);setReimportReview(null);setReimportApproved(false);setSavedReplay(null);
      }
    }finally{if(requestId.current===epoch)setBusy(false);}
  };
  // A file picked directly from MAIN ACTIONS must enter the exact same
  // preview/validation path as a file picked from the dialog itself.
  useEffect(() => {
    panelRef.current?.focus();
    if (initialSelection?.file) void chooseFile(initialSelection.file);
  }, [initialSelection]);
  useEffect(() => {
    const onEscape = (event) => {
      if (event.key === "Escape" && !busy) close();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [busy, onClose]);
  useEffect(() => () => { requestId.current++; selectedOriginal.current = null; }, []);
  const activate = async (mode = "builder") => {
    if (!preview?.ok || !preview.source || busy) return;
    const original = selectedOriginal.current;
    const activationEpoch = requestId.current;
    const needsReimportReview=isCoreReimport(preview);
    if(needsReimportReview && (!reimportReview || !reimportApproved ||
        reimportReview.incomingOriginalSourceSha256!==preview.sourceSha256 ||
        reimportReview.currentWorkspaceRevision!==workspaceIdentity.sourceRevision ||
        reimportReview.sourceLinkChoice!==preview.linkSourceChoice)){
      setFailure("IC020_P2B_REVIEW_REQUIRED");return;
    }
    if (preview.linkSourceConflict && (!preview.linkSourceChoice ||
        preview.linkSourceChoice !== selectedLinkSource)) {
      setFailure("IC020_P2A_REVIEW_REQUIRED");
      return;
    }
    if (preview.workbookProfile === "legacy-src-22" && !legacyWorkbookConsent) {
      setFailure("WORKBOOK_DOCUMENTATION_REVIEW_REQUIRED");
      return;
    }
    if (preview.workbookProfile === "legacy-src-22" && mode === "runtime") {
      setFailure("WORKBOOK_DOCUMENTATION_RUNTIME_BLOCKED");
      return;
    }
    const isCurrent = () => Boolean(original) &&
      requestId.current === activationEpoch &&
      selectedOriginal.current === original &&
      getCurrentWorkspaceIdentity() === workspaceIdentity;
    if (!isCurrent()) { setFailure("IC020_P1_STALE"); return; }
    const atlasG4 = atlasG4SyntheticProfile(preview);
    if (atlasG4 && (mode !== "builder" || !atlasG4Consent)) {
      setFailure(mode === "runtime" ? "ATLAS_G4_RUNTIME_BLOCKED" : "ATLAS_G4_BOUNDED_REVIEW_REQUIRED");
      return;
    }
    const large=largeNetworkPreview(preview);
    if(large&&(!(tenThousandCsvProfile(preview)||tenThousandXlsxProfile(preview)||tenThousandOdsProfile(preview))||
       mode!=="builder"||!tenThousandBoundedConsent)){
      setFailure(mode==="runtime"?"SCALE_P4B1_RUNTIME_BLOCKED":
        "SCALE_P4B1_BOUNDED_REVIEW_REQUIRED");
      return;
    }
    setBusy(true); setFailure("");
    const verifyReimportApproval=async()=>{
      if(!needsReimportReview)return;
      const current=await compareCoreNetworkReimport(workspaceIdentity,preview,isCurrent);
      if(!isCurrent() || JSON.stringify(current)!==JSON.stringify(reimportReview))
        throw new Error("IC020_P2B_BASELINE_CHANGED");
    };
    try {
      let next = await compileBuilderWorkspace(createBuilderWorkspace(preview.source), compilerOptions);
      if (next.compile.status !== "valid") {
        const diagnostics = next.compile.diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message }));
        setDiagnostics(diagnostics);
        setFailure(`Compilation blocked: ${diagnostics.map((d) => d.code).join(", ")}`);
        return;
      }
      if(large){
        // Complete compiled Builder source is retained unchanged. ONLY a
        // separately approved 100-original-row bounded source view enters ELK.
        const nodeOrder=preview.source.resources.map(r=>r.id);
        const focus=await buildScaledNetworkTenThousandFocus(
          next.compile.model,nodeOrder,1);
        await verifyNetworkTopologyOriginalForActivation(original,preview,isCurrent);
        await verifyReimportApproval();
        if(!isCurrent())throw new Error("IC020_P1_STALE");
        onActivate(next,false,{
          sourceOriginalSha256:preview.sourceSha256,
          sourceModelHash:next.compile.model.sourceHash??preview.sourceSha256,
          nodeOrder,focus,sourceKind:tenThousandOdsProfile(preview)?"ods-p4f2":tenThousandXlsxProfile(preview)?"xlsx-p4e1":"csv-p4b1"
        });
        return;
      }
      if (atlasG4) {
        // G4 proves the real XLSX -> canonical -> Atlas -> bounded Canvas
        // path.  Full Builder auto-layout is intentionally not run here;
        // Atlas requests ELK only for the active page after activation.
        await verifyNetworkTopologyOriginalForActivation(original, preview, isCurrent);
        await verifyReimportApproval();
        if (!isCurrent()) throw new Error("IC020_P1_STALE");
        setDiagnostics(preview.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: d.message })));
        onActivate(next, false);
        return;
      }
      const layout = await autoLayoutBuilder(next, new ElkLayoutBackend());
      if (!layout.ok) {
        setDiagnostics(layout.diagnostics);
        setFailure("Layout failed; the active workspace was not replaced.");
        return;
      }
      next = layout.workspace;
      setDiagnostics([...preview.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: d.message })), ...layout.diagnostics]);
      if (mode === "runtime") {
        const runtime = previewRuntime(next);
        if (!runtime.ok || runtime.workspace?.mode !== "runtime") {
          const errors = runtime.diagnostics ?? [];
          setDiagnostics(errors);
          setFailure(`Runtime unavailable: ${errors.map((d) => d.code).join(", ") || "unknown error"}`);
          return;
        }
        const model = buildRuntimeActiveProbeModel(runtime.workspace);
        if (!model.sources.length || !model.probes.length) {
          setFailure("No explicitly declared Windows/Linux source hosts support modeled probes. Open Builder to edit device types; do not infer an OS from an IP address.");
          return;
        }
        await verifyNetworkTopologyOriginalForActivation(original, preview, isCurrent);
        await verifyReimportApproval();
        if (!isCurrent()) throw new Error("IC020_P1_STALE");
        onActivate(runtime.workspace, true);
      } else {
        await verifyNetworkTopologyOriginalForActivation(original, preview, isCurrent);
        await verifyReimportApproval();
        if (!isCurrent()) throw new Error("IC020_P1_STALE");
        onActivate(next, false);
      }
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
      setDiagnostics([{ code: "NETWORK_IMPORT_ACTIVATION_BLOCKED", severity: "error", message: error instanceof Error ? error.message : String(error) }]);
    } finally { setBusy(false); }
  };
  return e("div", { className: "network-import-overlay", "data-network-import-overlay": "true" },
    e("section", { id: "network-topology-import-panel", ref: panelRef, tabIndex: -1, role: "dialog", "aria-modal": "true", className: "network-import-panel", "data-network-import-panel": "ready", "aria-label": "Import Network from Excel / CSV" },
    e("div", { className: "network-import-heading" },
      e("div", null, e("h2", null, "Import Network from Excel / CSV"), e("p", null, "Offline import: select → review → validate → re-check original SHA-256 → open Runtime probes or Builder. Existing workspace remains unchanged until you confirm.")),
      e("button", { type: "button", onClick: close, disabled: busy, "aria-label": "Close network import" }, "Close")),
    e("p", { className: "helper-note" }, "Supported: .json, .xlsx, .ods, .csv, .tsv. Use a Devices table (Asset ID, Hostname, Device Type; optional IP Address, IPv6 Address, IPv6 Prefix, Interface ID, Interface Name, MTU, MAC Address and Connected To), or a canonical Nodes + Links workbook. A Devices row describes at most one explicit interface. A shorthand Devices file may also have an explicit Links table. A Connected To row may declare Link ID, From Port, To Port and Link Type; port names must match independent Interface ID/Name declarations on both endpoint devices. Link details without Connected To are blocked. Any populated other sheets or unsupported selected Links fields BLOCK activation. Use canonical Metadata + Nodes + Interfaces for documented multi-interface sources. Empty template sheets do not establish links. Connections require explicit endpoint IDs; IP addresses and gateways never imply cabling."),
    e("label", { className: "file-button" }, busy ? "Reading network document…" : "Choose JSON / Excel / CSV network file",
      e("input", { type: "file", accept: ".json,.xlsx,.ods,.csv,.tsv", disabled: busy, "data-network-import-file": "true", onCancel: () => { void chooseFile(null); }, onChange: (event) => { const selected = event.target.files?.[0] ?? null; event.target.value = ""; void chooseFile(selected); }, hidden: true })),
    failure ? e("p", { role: "alert", className: "helper-status blocked" }, failure) : null,
    preview ? e("div", { className: "network-import-preview", "data-network-import-preview": preview.ok ? "READY" : "BLOCKED" },
      e("h3", null, "Preview – ", preview.filename),
      e("p", null, `Found tables: ${preview.sheets.join(", ") || "none"} · Devices: ${preview.devices} · Explicit links: ${preview.links}`),
      preview.workbookProfile ? e("p", { className: "network-import-detected", "data-network-import-detected": preview.workbookProfile },
        preview.workbookProfile === "legacy-src-22"
          ? `Canonical SRC workbook detected: ${preview.devices} devices and ${preview.links} source-declared links; ${preview.documentationSheets?.length ?? 0} supplementary documentation sheets preserved.`
          : `Canonical workbook detected: ${preview.devices} devices and ${preview.links} source-declared links.`
      ) : null,
      e("p", { "data-network-import-sha": "true", "data-network-import-byte-size": preview.sourceByteSize }, `Original SHA-256: ${preview.sourceSha256} · Bytes: ${preview.sourceByteSize}`),
      e("p", { "data-network-import-unmapped": preview.unmappedColumnCount, "data-network-import-unmapped-status": preview.unmappedColumnCount > 0 ? "UNMAPPED" : "NONE" }, `Unmapped source columns: ${preview.unmappedColumnCount}. Populated unsupported Devices columns BLOCK activation with original sheet, row and field; genuinely blank extra template columns are allowed. Populated supplementary Devices workbook sheets, unsupported selected Links fields and nonprojected canonical workbook sheets/columns also BLOCK activation instead of silently disappearing.`),
      preview.linkSourceConflict ? e("div", { "data-network-import-link-review": preview.linkSourceChoice ? "REVIEWED" : "REVIEW_REQUIRED" },
        e("p", null, `Two competing declared link sources: Links table ${preview.linkSourceConflict.sheetDeclaredLinks} · Connected To ${preview.linkSourceConflict.inlineDeclaredLinks}. No source is automatically preferred or combined.`),
        preview.linkSourceChoice
          ? e("p", { "data-network-import-link-choice": preview.linkSourceChoice },
              preview.linkSourceChoice === "LINKS_SHEET"
                ? "Reviewed selection: ONLY Links table. Other declared connections excluded; still unverified."
                : "Reviewed selection: ONLY Connected To column. Other declared connections excluded; still unverified.")
          : e("div", { className: "network-import-actions" },
              e("button", { type:"button", disabled:busy,
                "data-network-import-link-source-sheet":"true",
                onClick:() => reviewLinkSource("LINKS_SHEET") },
                "Review: Use ONLY Links table"),
              e("button", { type:"button", disabled:busy,
                "data-network-import-link-source-inline":"true",
                onClick:() => reviewLinkSource("INLINE_CONNECTED_TO") },
                "Review: Use ONLY Connected To declarations"))
      ) : null,
      e("p", { className: "helper-note" }, preview.links === 0 ? "No physical connections provided. Devices will be shown without invented links." : "Only explicitly declared links will appear in the topology."),
      preview.diagnostics.length ? e("ul", { className: "validation-list" }, ...preview.diagnostics.slice(0, 30).map((d, i) => e("li", { key: i }, formatNetworkImportDiagnostic(d)))) : e("p", null, "No import diagnostics."),
      isCoreReimport(preview) ? e("section", {
        "data-network-reimport-review": reimportApproved ? "APPROVED" : reimportReview ? "REVIEWED" : "REVIEW_REQUIRED",
      },
        e("p", null, "Reimport: compare the CURRENT LIVE workspace snapshot against the newly verified incoming original. The prior workspace digest is NOT a prior original-file SHA. No change is automatically applied."),
        e("button", { type: "button", disabled: busy, "data-network-reimport-compare": "true",
          onClick: reviewCoreReimport }, busy ? "Comparing…" : "Review differences (read-only)"),
        e("label", { "data-network-reimport-replay-picker":"true" },
          "Load a saved read-only reimport report (does not approve replacement)",
          e("input", { type:"file", accept:".json", disabled:busy,
            "data-network-reimport-replay-file":"true",
            onChange:event=>{
              const selected=event.target.files?.[0]??null;
              event.target.value="";
              if(selected)void replaySavedCoreReimportReport(selected);
            } })),
        savedReplay ? e("p", { "data-network-reimport-replay-status":"MATCHED_REVIEW_ONLY" },
          "Saved report matches this freshly rechecked original and LIVE workspace. No previous approval was restored; inspect differences and approve separately.") : null,
        reimportReview ? e("div", { "data-network-reimport-diff": "true" },
          e("button", { type:"button", disabled:busy,
            "data-network-reimport-export-report":"true",
            onClick:exportCoreReimportReport },
            "Download read-only reimport report JSON"),
          e("p", { "data-network-reimport-workspace-sha": "true" }, "Current live workspace SHA-256 (NOT an original-file SHA): " + reimportReview.currentWorkspaceSourceSha256),
          e("p", { "data-network-reimport-original-sha": "true" }, "Incoming original file SHA-256: " + reimportReview.incomingOriginalSourceSha256),
          e("p", { "data-network-reimport-resource-counts": "true" },
            `Devices: added ${reimportReview.resources.added}, removed ${reimportReview.resources.removed}, changed ${reimportReview.resources.changed}, unchanged ${reimportReview.resources.unchanged}`),
          e("p", { "data-network-reimport-link-counts": "true" },
            `Explicit links: added ${reimportReview.connections.added}, removed ${reimportReview.connections.removed}, changed ${reimportReview.connections.changed}, unchanged ${reimportReview.connections.unchanged}`),
          e("p", null, "Documented model differences only. Neither physical cabling nor Engine truth is verified here."),
          e("button", { type: "button", disabled: busy || reimportApproved,
            "data-network-reimport-approve": "true", onClick: () => {
              if (getCurrentWorkspaceIdentity() !== workspaceIdentity) {
                setFailure("IC020_P2B_BASELINE_CHANGED"); return;
              }
              setReimportApproved(true);
            } }, reimportApproved ? "Reviewed replacement approved" : "Approve replacing the entire current workspace")
        ) : null
      ) : null,
      e("div", { className: "network-import-confirmation", "data-network-import-confirmation": "true" },
      preview.workbookProfile === "legacy-src-22" ? e("section", { className: "network-import-consent", "data-legacy-workbook-profile": "SRC_22_REVIEW_REQUIRED" },
        e("strong", null, "Explicit approval required for the canonical SRC workbook"),
        e("p", { id: "legacy-workbook-consent-help" }, `Authoritative topology: ${preview.authoritativeSheets?.length ?? 0} SRC sheets · documentation: ${preview.documentationSheets?.length ?? 0} sheets. Documentation remains source documentation and is not converted into topology or Engine evidence.`),
        e("label", { htmlFor: "legacy-workbook-consent", className: "network-import-consent-label" },
          e("input", { id: "legacy-workbook-consent", type: "checkbox", checked: legacyWorkbookConsent, disabled: busy, "aria-describedby": "legacy-workbook-consent-help", "data-legacy-workbook-consent": "true", onChange: event => setLegacyWorkbookConsent(event.currentTarget.checked) }),
          e("span", null, "I have reviewed the six SRC sheets and the supplementary documentation; activate only the canonical source model.")),
      ) : null,
      atlasG4SyntheticProfile(preview) ? e("section", { className: "network-import-consent", "data-atlas-g4-profile": "REVIEW_REQUIRED" },
        e("p", null, "ATLAS-001 G4 synthetic fixture: 500 declared devices and 499 declared links. Builder activation keeps the canonical source intact and defers ELK/React Flow to bounded Atlas pages; no physical-network claim is made."),
        e("label", { className: "network-import-consent-label" },
          e("input", { type: "checkbox", checked: atlasG4Consent, disabled: busy, "data-atlas-g4-consent": "true", onChange: event => setAtlasG4Consent(event.currentTarget.checked) }),
          e("span", null, "I reviewed this synthetic source and approve bounded Atlas Builder activation.")),
      ) : null,
      largeNetworkPreview(preview)&&!tenThousandXlsxProfile(preview)&&!tenThousandOdsProfile(preview)?e("section",{className:"network-import-consent", "data-scale-p4b1-profile":
        tenThousandCsvProfile(preview)?"REVIEW_REQUIRED":"UNSUPPORTED_LARGE_SOURCE"},
        e("p",null,"Large source: full-graph ELK/ReactFlow and Runtime are blocked. Only an explicit original 10,000/10,000 CSV bounded Builder profile can be activated."),
        tenThousandCsvProfile(preview)
          ?e("label",{className:"network-import-consent-label"},
            e("input",{type:"checkbox","data-scale-p4b1-consent":"true",
              checked:tenThousandBoundedConsent,disabled:busy,
              onChange:event=>setTenThousandBoundedConsent(event.currentTarget.checked)}),
            e("span",null,"I explicitly approve loading this 10,000-device and 10,000-source-link CSV into editable Builder with only 100 source-row devices displayed per bounded graph page. Source links are modeled, not verified physical cables."))
          :e("p",null,"No verified large-source UI profile for this size/file; Builder replacement and Runtime remain blocked.")
      ):null,
      tenThousandXlsxProfile(preview)?e("section",{className:"network-import-consent", "data-scale-p4e1-xlsx-10000-profile":"REVIEW_REQUIRED"},
        e("p",null,"XLSX original Devices and separate original Links: exactly 10,000 source-declared IDs and 10,000 source-declared endpoint pairs. Only bounded 100-row source views, never full-graph ELK/ReactFlow or Runtime/Engine."),
        e("label",{className:"network-import-consent-label"},
          e("input",{type:"checkbox","data-scale-p4e1-consent":"true",
            checked:tenThousandBoundedConsent,disabled:busy,
            onChange:event=>setTenThousandBoundedConsent(event.currentTarget.checked)}),
          e("span",null,"I explicitly approve importing this genuine XLSX with 10,000 original Devices and 10,000 separate original Links into editable bounded Builder. These are modeled links, not verified physical cables."))
      ):null,
      tenThousandOdsProfile(preview)?e("section",{className:"network-import-consent", "data-scale-p4f2-ods-10000-profile":"REVIEW_REQUIRED"},
        e("p",null,"Genuine ODS original Devices and Links: 10,000 original device IDs and 10,000 explicitly declared link IDs. Builder-only bounded 100-row views; no Engine, physical cabling proof or full-graph layout."),
        e("label",{className:"network-import-consent-label"},
          e("input",{type:"checkbox","data-scale-p4f2-consent":"true",
            checked:tenThousandBoundedConsent,disabled:busy,
            onChange:event=>setTenThousandBoundedConsent(event.currentTarget.checked)}),
          e("span",null,"I explicitly approve importing this genuine ODS source into editable Builder with only bounded source-row graph pages."))
      ):null,
      e("div", { className: "network-import-actions" },
        e("button", { type: "button", disabled: !preview.ok || busy || largeNetworkPreview(preview) || preview.workbookProfile === "legacy-src-22" || (isCoreReimport(preview) && (!reimportReview || !reimportApproved)), "data-network-import-runtime": "true", onClick: () => activate("runtime") }, busy ? "Validating…" : "Open modeled Runtime + Probes"),
        e("button", { type: "button", disabled: !preview.ok || busy ||
          (atlasG4SyntheticProfile(preview) && !atlasG4Consent) ||
          (largeNetworkPreview(preview)&&(!(tenThousandCsvProfile(preview)||tenThousandXlsxProfile(preview)||tenThousandOdsProfile(preview))||
            !tenThousandBoundedConsent))||
          (preview.workbookProfile === "legacy-src-22" && !legacyWorkbookConsent)||
          (isCoreReimport(preview) && (!reimportReview || !reimportApproved)), "data-network-import-activate": "true", onClick: () => activate("builder") }, busy ? "Validating…" : "Create topology in Builder (edit only)")),
      e("p", { className: "helper-note", "data-import-probe-boundary": "true" }, "Modeled probes use declared Windows/Linux source hosts and existing Engine evidence. A topology inventory alone cannot prove connectivity, routing, DNS or open ports: UNKNOWN is expected when required facts are absent. No real traffic is sent."),
      ),
    ) : null,
    ),
  );
}

// Import failures must identify the original sheet, physical row and field
// without echoing potentially sensitive source cell values into the UI.
function formatNetworkImportDiagnostic(d) {
  const location = [d.table,
    Number.isInteger(d.row) ? "row " + d.row : null,
    d.field ? "field " + d.field : null].filter(Boolean).join(" / ");
  return d.severity.toUpperCase() + ": " + d.code +
    (location ? " (" + location + ")" : "") + " – " + d.message;
}

function MainActions({ onImportNetwork, onImportNetworkFile, onInspectStructuredXml, onInspectGraphml, onInspectNmap, onInspectNmapReplay, onInspectNessus, onInspectNessusReplay, onInspectDrawio, onReviewDrawioBuilder, onInspectDrawioReplay, onInspectAnsible, onInspectAnsibleYamlReplay, onInspectAnsibleIni, onInspectAnsibleIniReplay, onInspectDocx, onReviewOfficeBuilder, onReviewScaledOfficeBuilder, onReviewScaledOfficeThousandBuilder, onReviewScaledOfficeFiveThousandBuilder, onReviewScaledOfficeTenThousandPreflight, onReviewScaledOfficeTenThousandBuilder, onInspectDocxReplay, onInspectOdt, onInspectOdtReplay, workspace, busy, branding, enterpriseScenarioId, setEnterpriseScenarioId, enterpriseOfficeScenarios, openEnterpriseScenario, verifiedDeliveryScenarioId, setVerifiedDeliveryScenarioId, openVerifiedDeliveryScenario, guidedLabId, setGuidedLabId, builtinGuidedLabs, openGuidedLab, openSource, openPackage, compileAndLayout, preview, exportSource, exportPackage, exportProgress, loadProgress, exportTroubleshootingSession, loadTroubleshootingSession, autosaveProgress, restoreAutosave, clearAutosave, backToBuilder }) {
  const fileAction = (label, accept, onChange, dataAttribute) => e("label",
    { className: "workspace-menu-action file-button" }, label,
    e("input", { type: "file", accept,
      // Reset after copying the selected File in the direct event callback.
      // Browsers do not fire change when the same physical path is selected
      // again; users must be able to re-import a file they have just fixed.
      onChange: (event) => {
        try { onChange(event); }
        finally { event.currentTarget.value = ""; }
      },
      hidden: true, ...(dataAttribute ? { "data-menu-action": dataAttribute } : {}) }));
  const advancedFileAction = (label, accept, onChange, dataAttribute = null) => fileAction(label, accept, onChange, dataAttribute);
  const networkPickerRef = useRef(null);
  // Opening the native picker happens synchronously within the user's click,
  // not from an effect: browsers reject deferred file dialogs.
  const openNetworkPicker = () => {
    onImportNetwork(); // also reveal a clearly visible dialog if selection is cancelled
    networkPickerRef.current?.click();
  };
  const acceptNetworkFile = (event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = ""; // allow selecting the same file again
    if (file) onImportNetworkFile(file);
  };
  const selectedGuidedLab = builtinGuidedLabs.find((lab) => lab.id === guidedLabId);
  const [advancedQuery, setAdvancedQuery] = useState("");
  const actionButton = (label, onClick, extra = {}) => e("button", { type: "button", onClick, ...extra, disabled: busy || extra.disabled }, label);
  const category = (key, title, description, items) => {
    const query = advancedQuery.trim().toLocaleLowerCase();
    const visible = items.filter((item) => !query || `${item.label} ${item.searchTerms ?? ""}`.toLocaleLowerCase().includes(query));
    if (!visible.length) return null;
    return e("section", { key, className: "advanced-tools-category", "aria-label": title },
      e("div", { className: "advanced-tools-category-heading" }, e("strong", null, title), e("small", null, description)),
      e("div", { className: "advanced-tools-actions" }, ...visible.map((item) => item.node)),
    );
  };
  const standardExportItems = workspace.mode === "builder"
    ? [
      { label: "Exportera källfil", searchTerms: "source json", node: actionButton("Exportera källfil", exportSource, { "data-export-action": "source" }) },
      { label: "Exportera elevpaket", searchTerms: "student package", node: actionButton("Exportera elevpaket", () => exportPackage("student"), { disabled: workspace.compile?.status !== "valid", "data-export-action": "student" }) },
      { label: "Exportera författarpaket", searchTerms: "author package", node: actionButton("Exportera författarpaket", () => exportPackage("author"), { disabled: workspace.compile?.status !== "valid", "data-export-action": "author" }) },
    ]
    : [
      { label: "Exportera framsteg", searchTerms: "progress", node: actionButton("Exportera framsteg", exportProgress, { "data-export-action": "progress" }) },
      { label: "Exportera sessionsbackup", searchTerms: "session troubleshooting backup", node: actionButton("Exportera sessionsbackup", exportTroubleshootingSession, { "data-export-action": "session" }) },
      { label: "Läs in framsteg", searchTerms: "load progress", node: advancedFileAction("Läs in framsteg", `${branding.progressExtension},application/json`, (event) => loadProgress(event.target.files?.[0]), "load-progress") },
      { label: "Importera sessionsbackup", searchTerms: "load session", node: advancedFileAction("Importera sessionsbackup", `${branding.sessionExtension},application/json`, (event) => loadTroubleshootingSession(event.target.files?.[0]), "load-session") },
    ];
  const scenarioItems = [
    { label: "Starta enterprise-labb", searchTerms: "enterprise scenario", node: actionButton("Starta enterprise-labb", () => openEnterpriseScenario(true), { disabled: !enterpriseScenarioId }) },
    { label: "Starta verifierad leveransdemo", searchTerms: "verified delivery", node: actionButton("Starta verifierad leveransdemo", () => openVerifiedDeliveryScenario(true), { disabled: !verifiedDeliveryScenarioId }) },
    { label: "Starta guidad labb", searchTerms: "guided lab troubleshooting", node: actionButton("Starta guidad labb", () => openGuidedLab(true), { disabled: !guidedLabId, "data-guided-lab-start": "advanced" }) },
    { label: "Öppna scenario-JSON", searchTerms: "open json scenario", node: advancedFileAction("Öppna scenario-JSON", ".json,application/json", (event) => openSource(event.target.files?.[0]), "open-scenario-json") },
    { label: "Öppna paketerad labb", searchTerms: "open package lab", node: advancedFileAction("Öppna paketerad labb", `${branding.scenarioExtension},application/zip`, (event) => openPackage(event.target.files?.[0]), "open-packaged-lab") },
  ];
  const builderItems = [
    { label: "Öppna enterprise i byggläget", searchTerms: "enterprise builder", node: actionButton("Öppna enterprise i byggläget", () => openEnterpriseScenario(false), { disabled: !enterpriseScenarioId }) },
    { label: "Öppna verifierad demo i byggläget", searchTerms: "verified builder", node: actionButton("Öppna verifierad demo i byggläget", () => openVerifiedDeliveryScenario(false), { disabled: !verifiedDeliveryScenarioId }) },
    { label: "Öppna labb i byggläget", searchTerms: "guided builder", node: actionButton("Öppna labb i byggläget", () => openGuidedLab(false), { disabled: !guidedLabId }) },
    { label: "Kompilera + layout", searchTerms: "compile layout builder", node: actionButton(busy ? "Kompilerar…" : "Kompilera + layout", compileAndLayout) },
  ];
  const runItems = [
    { label: "Förhandsvisa körläge", searchTerms: "runtime preview", node: actionButton("Förhandsvisa körläge", preview, { disabled: workspace.compile?.status !== "valid" }) },
    { label: "Tillbaka till byggläget", searchTerms: "builder", node: actionButton("Tillbaka till byggläget", backToBuilder) },
    { label: "Autospara nu", searchTerms: "autosave runtime", node: actionButton("Autospara nu", autosaveProgress, { disabled: workspace.mode !== "runtime" }) },
    { label: "Återställ autosparning", searchTerms: "restore autosave runtime", node: actionButton("Återställ autosparning", restoreAutosave, { disabled: workspace.mode !== "runtime" }) },
    { label: "Rensa autosparning", searchTerms: "clear autosave runtime", node: actionButton("Rensa autosparning", clearAutosave, { disabled: workspace.mode !== "runtime" }) },
    { label: "Open modeled Runtime + Probes", searchTerms: "modeled probes runtime", node: actionButton("Open modeled Runtime + Probes", () => {
      const panel = document.querySelector('[data-active-probe-engine="wave2"]');
      if (!panel) return;
      panel.open = true;
      panel.scrollIntoView({ block: "center", behavior: "smooth" });
    }, { disabled: workspace.mode !== "runtime", "data-open-active-probes": "true" }) },
  ];
  const inspectionItems = [
    { label: "Inspect structured documents", searchTerms: "xml ansible read only", node: actionButton("Inspect structured documents (XML + static Ansible, read-only)", onInspectStructuredXml, { "data-ic010-p2-open": "true" }) },
    { label: "Import Network from Excel / CSV", searchTerms: "import network xlsx ods csv tsv", node: actionButton("Import Network from Excel / CSV", openNetworkPicker, { "data-import-network-action": "true" }) },
    { label: "Inspect GraphML", searchTerms: "graphml preview", node: actionButton("Inspect GraphML (read-only preview)", onInspectGraphml, { "data-inspect-graphml": "PREVIEW_ONLY" }) },
    { label: "Inspect Nmap XML", searchTerms: "nmap observations replay", node: actionButton("Inspect Nmap XML (observations only)", onInspectNmap, { "data-inspect-nmap": "EVIDENCE_ONLY" }) },
    { label: "Replay saved Nmap XML", searchTerms: "nmap replay saved", node: actionButton("Inspect saved Nmap XML references (read-only replay)", onInspectNmapReplay, { "data-inspect-nmap-replay": "EVIDENCE_OBSERVED" }) },
    { label: "Inspect Nessus", searchTerms: "nessus severity replay", node: actionButton("Inspect Nessus .nessus (severity summary only)", onInspectNessus, { "data-inspect-nessus": "EVIDENCE_ONLY" }) },
    { label: "Replay saved Nessus", searchTerms: "nessus replay saved", node: actionButton("Inspect saved Nessus references (read-only replay)", onInspectNessusReplay, { "data-inspect-nessus-replay": "EVIDENCE_OBSERVED" }) },
    { label: "Inspect draw.io", searchTerms: "drawio structure preview", node: actionButton("Inspect draw.io .drawio (uncompressed structure)", onInspectDrawio, { "data-inspect-drawio": "PREVIEW_ONLY" }) },
    { label: "Review diagrams.net", searchTerms: "drawio builder review", node: actionButton("Review diagrams.net (.drawio) into Builder", onReviewDrawioBuilder, { "data-review-drawio-builder": "REVIEW_REQUIRED" }) },
    { label: "Replay saved draw.io", searchTerms: "drawio replay", node: actionButton("Inspect saved draw.io references (read-only replay)", onInspectDrawioReplay, { "data-inspect-drawio-replay": "TOPOLOGY_DECLARED" }) },
    { label: "Inspect Ansible YAML", searchTerms: "ansible yaml inventory", node: actionButton("Inspect Ansible YAML (read-only inventory)", onInspectAnsible, { "data-inspect-ansible": "CONFIG_DOCUMENTED" }) },
    { label: "Replay saved Ansible YAML", searchTerms: "ansible yaml replay", node: actionButton("Inspect saved Ansible YAML references (read-only replay)", onInspectAnsibleYamlReplay, { "data-inspect-ansible-yaml-replay": "CONFIG_DOCUMENTED" }) },
    { label: "Inspect Ansible INI", searchTerms: "ansible ini inventory", node: actionButton("Inspect Ansible INI (read-only inventory)", onInspectAnsibleIni, { "data-inspect-ansible-ini": "CONFIG_DOCUMENTED" }) },
    { label: "Replay saved Ansible INI", searchTerms: "ansible ini replay", node: actionButton("Inspect saved Ansible INI references (read-only replay)", onInspectAnsibleIniReplay, { "data-inspect-ansible-ini-replay": "CONFIG_DOCUMENTED" }) },
    { label: "Inspect Word DOCX", searchTerms: "docx structure office", node: actionButton("Inspect Word DOCX (structure only)", onInspectDocx, { "data-inspect-docx": "CONFIG_DOCUMENTED" }) },
    { label: "Review DOCX / ODT", searchTerms: "office builder review", node: actionButton("Review DOCX / ODT nodes into Builder", onReviewOfficeBuilder, { "data-review-office-builder": "REVIEW_REQUIRED" }) },
    { label: "Inspect saved DOCX", searchTerms: "docx replay", node: actionButton("Inspect saved DOCX references (read-only)", onInspectDocxReplay, { "data-inspect-docx-replay": "CONFIG_DOCUMENTED" }) },
    { label: "Inspect OpenDocument ODT", searchTerms: "odt structure office", node: actionButton("Inspect OpenDocument ODT (structure only)", onInspectOdt, { "data-inspect-odt": "CONFIG_DOCUMENTED" }) },
    { label: "Inspect saved ODT", searchTerms: "odt replay", node: actionButton("Inspect saved ODT references (read-only)", onInspectOdtReplay, { "data-inspect-odt-replay": "CONFIG_DOCUMENTED" }) },
  ];
  const officeReviewItems = [
    { label: "Review 100 DOCX / ODT source nodes", searchTerms: "office scale 100", node: actionButton("Review 100 DOCX / ODT source-declared network nodes into Builder", onReviewScaledOfficeBuilder, { "data-review-scaled-office-builder": "REVIEW_REQUIRED" }) },
    { label: "Review 1,000 original DOCX / ODT devices", searchTerms: "office scale 1000", node: actionButton("Review 1,000 original DOCX / ODT network devices into focused Builder", onReviewScaledOfficeThousandBuilder, { "data-review-scaled-office-thousand-builder": "REVIEW_REQUIRED" }) },
    { label: "Review 5,000 original DOCX / ODT devices", searchTerms: "office scale 5000", node: actionButton("Review 5,000 original DOCX / ODT devices and 5,000 port-linked source rows into bounded Builder", onReviewScaledOfficeFiveThousandBuilder, { "data-review-scaled-office-five-thousand-builder": "REVIEW_REQUIRED" }) },
    { label: "Review 10,000 original DOCX / ODT preflight", searchTerms: "office scale 10000 preflight", node: actionButton("Review 10,000 original DOCX / ODT source devices + 10,000 original Links (source-only; no Builder activation)", onReviewScaledOfficeTenThousandPreflight, { "data-review-scaled-office-ten-thousand-preflight": "REVIEW_REQUIRED" }) },
    { label: "Load 10,000 original DOCX / ODT Builder", searchTerms: "office scale 10000 builder", node: actionButton("Review and explicitly load 10,000 original DOCX / ODT devices + port-linked original Links into bounded editable Builder", onReviewScaledOfficeTenThousandBuilder, { "data-review-scaled-office-ten-thousand-builder": "REVIEW_REQUIRED" }) },
  ];
  return e("section", { className: "main-actions", "aria-label": "Main actions" },
    e("div", { className: "main-actions-heading" },
      e("div", null, e("strong", null, "WORKSPACE TOOLBAR"), e("span", null, "Topology first · import, export and advanced tools remain available without pushing the canvas.")),
      e("div", { className: "main-actions-context" },
        e("label", { className: "context-select" }, "Enterprise-labb", e("select", { value: enterpriseScenarioId, onChange: (event) => setEnterpriseScenarioId(event.target.value), "data-enterprise-scenario-selector": "true" }, ...enterpriseOfficeScenarios.map((scenario) => e("option", { key: scenario.scenarioId, value: scenario.scenarioId }, scenario.metadata.title)))),
        e("label", { className: "context-select" }, "Verifierad leverans", e("select", { value: verifiedDeliveryScenarioId, onChange: (event) => setVerifiedDeliveryScenarioId(event.target.value), "data-verified-delivery-scenario-selector": "true" }, ...verifiedDeliveryScenarios.map((scenario) => e("option", { key: scenario.scenarioId, value: scenario.scenarioId }, scenario.metadata.title)))),
        e("label", { className: "context-select" }, "Guidad labb", e("select", { value: guidedLabId, onChange: (event) => setGuidedLabId(event.target.value), disabled: !builtinGuidedLabs.length, "data-guided-lab-catalog": "wave1" }, ...builtinGuidedLabs.map((lab) => e("option", { key: lab.id, value: lab.id }, `${lab.sequence}. ${lab.title} · ${lab.focus}`)))),
      ),
    ),
    e("div", { className: "main-actions-guided-start compact", "data-guided-lab-entrypoint": "direct" },
      e("button", {
        type: "button",
        className: "guided-lab-primary-button",
        "data-guided-lab-start": "direct",
        onClick: () => openGuidedLab(true),
        disabled: busy || !guidedLabId,
      }, busy ? "Startar valt labb…" : selectedGuidedLab ? `Starta valt labb · ${selectedGuidedLab.sequence}. ${selectedGuidedLab.title}` : "Starta valt labb"),
      e("span", { title: selectedGuidedLab?.title ?? "Välj ett labb ovan" }, selectedGuidedLab ? `${selectedGuidedLab.sequence}. ${selectedGuidedLab.title} · ${selectedGuidedLab.focus}` : "Välj labb ovan"),
    ),
    e("div", { className: "main-actions-toolbar", "data-primary-toolbar": "true" },
      e("button", { type: "button", className: "toolbar-primary-button toolbar-import", "data-network-import-primary": "true", onClick: openNetworkPicker, disabled: busy, "aria-controls": "network-topology-import-panel", title: "Importera JSON, Excel, ODS, CSV eller TSV" }, "Importera"),
      e("input", { type: "file", ref: networkPickerRef, accept: ".json,.xlsx,.ods,.csv,.tsv", onChange: acceptNetworkFile, style: { display: "none" }, tabIndex: -1, "aria-label": "Select network inventory document", "data-network-import-quick-file": "true" }),
      e(WorkspaceMenu, { label: e(React.Fragment, null, "Exportera", e("span", { className: "toolbar-caret", "aria-hidden": "true" }, "▾")), className: "workspace-menu-export", panelClassName: "export-menu-panel" },
        e("div", { className: "menu-heading" }, e("strong", null, workspace.mode === "builder" ? "Builder-export" : "Runtime-export"), e("small", null, "Direkt åtkomst · ingen lång inspektionslista")),
        ...standardExportItems.map((item) => React.cloneElement(item.node, { key: `export-${item.label}` })),
      ),
      e(WorkspaceMenu, { label: "Avancerade verktyg", className: "workspace-menu-advanced", panelClassName: "advanced-tools-panel" },
        e("div", { className: "advanced-tools-heading" },
          e("div", null, e("strong", null, "Avancerade verktyg"), e("small", null, "Inspektion, replay, Office-review och övriga arbetsflöden hålls separerade från canvasen.")),
          e("label", null, e("span", { className: "sr-only" }, "Sök avancerade verktyg"), e("input", { type: "search", value: advancedQuery, onChange: (event) => setAdvancedQuery(event.target.value), placeholder: "Sök verktyg…", "aria-label": "Sök avancerade verktyg", "data-advanced-tools-search": "true" })),
        ),
        // The legacy source contract still names this path "Lab & Scenario";
        // the visible category avoids colliding with its compatibility menu.
        category("scenario", "Scenario & labb", "Ladda, starta eller kompilera en källa.", scenarioItems),
        category("builder", "Builder-läge", "Enterprise, labb och canonical layout.", builderItems),
        category("runtime", "Run & Preview", "Runtime, autosparning och modellerade probes.", runItems),
        category("inspection", "Inspektion & replay", "Read-only dokument, observationer och sparade referenser.", inspectionItems),
        category("office-review", "Office-review", "Separata, uttryckliga DOCX/ODT-granskningar med provenance.", officeReviewItems),
        category("exports", "Exportgenvägar", "Samma validerade exportcallbacks är även åtkomliga här.", standardExportItems),
      ),
    ),
    // PROJECT-093 removes the former zero-opacity compatibility rail. All
    // callbacks and selectors are now owned by the visible Import, Export and
    // Avancerade verktyg controls above.
  );
}

function ControlSection({ title, description, searchTerms = "", query = "", children }) {
  const haystack = `${title} ${description} ${searchTerms}`.toLocaleLowerCase();
  const match = !query || haystack.includes(query.toLocaleLowerCase());
  return e("details", { className: "control-section", open: query ? match : undefined, hidden: !match },
    e("summary", null, e("span", null, title), e("small", null, description)),
    e("div", { className: "control-section-body" }, children),
  );
}

function ControlCenter({ children }) {
  const [query, setQuery] = useState("");
  return e("section", { className: "control-center", "aria-label": "Control Center" },
    e("div", { className: "control-center-heading" }, e("div", null, e("strong", null, "CONTROL CENTER"), e("span", null, "Search and open only the tool group you need.")), e("label", null, e("span", { className: "sr-only" }, "Search tools and actions"), e("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: "Search tools and actions...", "aria-label": "Search tools and actions" }))),
    e("div", { className: "control-section-list" }, React.Children.map(children, (child) => React.isValidElement(child) ? React.cloneElement(child, { query }) : child)),
  );
}

function PackagedMediaPanel({ media }) {
  if (!media?.images.length) return null;
  return e("section", { className: "package-media-panel", "data-package-media": "image-only", "aria-label": "Paketbilder" },
    e("h2", null, "Paketbilder"),
    e("p", null, "Images from the validated package. Untrusted SVG is displayed only as an isolated image, never as inline HTML."),
    e("div", { className: "package-media-grid" }, ...media.images.map((item) =>
      e("figure", { key: item.path, className: "package-media-card" },
        e("img", { src: item.objectUrl, alt: `Packaged image ${item.path}`, draggable: false, loading: "lazy" }),
        e("figcaption", null, item.path),
      ),
    )),
  );
}

function NetworkIntentPanel({ workspace, setDiagnostics, onOpenEngineRun }) {
  const [contract, setContract] = useState(null);
  const [expansion, setExpansion] = useState(null);
  const [intentRun, setIntentRun] = useState(null);
  const [intentMatrix, setIntentMatrix] = useState(null);
  const [matrixFilters, setMatrixFilters] = useState({});
  const [selectedCellId, setSelectedCellId] = useState(null);
  const [stale, setStale] = useState(false);
  const [intentBundle, setIntentBundle] = useState(null);
  const [bundlePreview, setBundlePreview] = useState(null);
  const [pendingBundleText, setPendingBundleText] = useState(null);
  const [busy, setBusy] = useState(false);
  const runSequenceRef = useRef(0);
  const engineWorkspacesRef = useRef(new Map());
  const source = workspace.mode === "builder" ? workspace.source : null;
  const sourceRevision = workspace.mode === "builder" ? workspace.sourceRevision : 0;
  const createIntent = async (multiCase = false) => {
    if (!source) { setDiagnostics([{ severity: "error", code: "NETWORK_INTENT_BUILDER_REQUIRED", message: "Intent execution requires a canonical Builder source in Dev2." }]); return; }
    try {
      const flow = source.tests.find((test) => test.type === "network.reachability");
      if (!flow) throw new Error("INTENT_FLOW_PROFILE_UNKNOWN_FLOW");
      const params = flow.params;
      const sourceIdentity = await computeCanonicalSourceIdentity(source);
      const resources = source.resources.map((resource) => resource.id);
      const sourceIds = multiCase ? [params.from, ...resources.filter((id) => id !== params.from && id !== params.to).slice(0, 2)] : [params.from];
      const destinationIds = multiCase ? [params.to, ...resources.filter((id) => id !== params.from && id !== params.to).slice(0, 1)] : [params.to];
      const sourceSet = await createEndpointSet({ title: multiCase ? "Intent sources" : "Explicit source", nodeIds: sourceIds, source });
      const destinationSet = await createEndpointSet({ title: multiCase ? "Intent destinations" : "Explicit destination", nodeIds: destinationIds, source });
      const profile = await createFlowProfile({ title: `${params.protocol ?? "network"}:${params.port ?? "flow"}`, flowId: flow.id, protocol: params.protocol, port: params.port, source });
      const next = await createNetworkIntentContract({ title: "Network intent contract", description: "Deterministic Dev2 intent execution", source, sourceIdentity, endpointSets: [sourceSet, destinationSet], flowProfiles: [profile], rules: [{ sourceSetId: sourceSet.setId, destinationSetId: destinationSet.setId, flowProfileId: profile.profileId, expectation: "MUST REACH", expected: "SUCCESS" }] });
      setContract(next); setExpansion(null); setIntentRun(null); setIntentMatrix(null); setSelectedCellId(null); setStale(false); setDiagnostics([{ severity: "warning", code: "NETWORK_INTENT_CONTRACT_CREATED", message: "Intent contract created. Engine execution requires explicit Run Intent." }]);
    } catch (error) { setDiagnostics([{ severity: "error", code: "NETWORK_INTENT_CONTRACT_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); }
  };
  const previewIntent = async () => {
    if (!contract || !source) return;
    try { const next = await expandNetworkIntent({ contract, source, sourceIdentity: await computeCanonicalSourceIdentity(source), sourceRevision }); setExpansion(next); setIntentRun(null); setIntentMatrix(null); setSelectedCellId(null); setStale(false); setDiagnostics([{ severity: "warning", code: "NETWORK_INTENT_EXPANSION_READY", message: `Planned deterministic expansion: ${next.caseCount} concrete cases. No Engine truth is claimed until Run Intent.` }]); }
    catch (error) { setDiagnostics([{ severity: "error", code: "NETWORK_INTENT_PREVIEW_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); }
  };
  const exportIntent = () => { if (contract) downloadJson({ filename: `${contract.contractId}.network-intent.json`, mime: "application/json", text: exportNetworkIntentContract(contract) }); };
  const createBundle = async () => { if (!contract || !source) return; try { const next = await createIntentBundle({ contract, source }); setIntentBundle(next); setBundlePreview(previewIntentBundle(next)); setDiagnostics([{ severity: "warning", code: "INTENT_BUNDLE_CREATED", message: "Intent Bundle created and verified. Bundle preview did not execute Engine work." }]); } catch (error) { setDiagnostics([{ severity: "error", code: "INTENT_BUNDLE_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); } };
  const exportBundle = () => { if (intentBundle) downloadJson({ filename: `${intentBundle.bundleId}.yadilab-intent-bundle.json`, mime: "application/json", text: exportIntentBundle(intentBundle) }); };
  const selectBundle = async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const text = await file.text(); const checked = await importIntentBundle(text); if (!checked.ok) throw new Error(checked.diagnostics.join(",")); setIntentBundle(null); setPendingBundleText(text); setBundlePreview(previewIntentBundle(checked.value)); setDiagnostics([{ severity: "warning", code: "INTENT_BUNDLE_PREVIEW_READY", message: "Bundle parsed and verified. Review the factual preview, then explicitly confirm import." }]); } catch (error) { setPendingBundleText(null); setBundlePreview(null); setDiagnostics([{ severity: "error", code: "INTENT_BUNDLE_IMPORT_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); } finally { event.target.value = ""; } };
  const confirmBundleImport = async () => { if (!pendingBundleText || !source) return; try { const checked = await importIntentBundle(pendingBundleText, source); if (!checked.ok) throw new Error(checked.diagnostics.join(",")); setIntentBundle(checked.value); setContract(checked.value.contract); setExpansion(null); setIntentRun(null); setIntentMatrix(null); setPendingBundleText(null); setDiagnostics([{ severity: "warning", code: "INTENT_BUNDLE_IMPORTED_HISTORICAL", message: "Historical Intent Bundle imported explicitly. Run Preview and then a fresh Intent execution for current evidence." }]); } catch (error) { setDiagnostics([{ severity: "error", code: "INTENT_BUNDLE_CONFIRM_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); } };
  const runIntent = async () => {
    if (!contract || !source || !expansion || stale) return;
    setBusy(true);
    try {
      const sequence = ++runSequenceRef.current;
      const runner = { run: async (candidate, flowId, revision) => { let next = createBuilderWorkspace(candidate); next = await compileBuilderWorkspace(next, compilerOptions); if (next.compile.status !== "valid") throw new Error("INTENT_RUN_COMPILE_FAILED"); const laidOut = await autoLayoutBuilder(next, new ElkLayoutBackend()); if (!laidOut.ok) throw new Error("INTENT_RUN_LAYOUT_FAILED"); const runtime = previewRuntime(laidOut.workspace); if (!runtime.ok) throw new Error("INTENT_RUN_ENGINE_FAILED"); const candidateIdentity = await computeCanonicalSourceIdentity(candidate); const runId = `${candidateIdentity}:${revision}:${flowId}:${sequence}`; engineWorkspacesRef.current.set(runId, runtime.workspace); return { runId, sourceIdentity: candidateIdentity, sourceRevision: revision, flowId, runtimeRevision: runtime.workspace.engineState.stateRevision, evaluation: runtime.workspace.evaluation }; } };
      const next = await executeNetworkIntent({ contract, source, sourceIdentity: await computeCanonicalSourceIdentity(source), sourceRevision, expansion, runSequence: sequence, runner });
      const nextMatrix = await buildIntentResultMatrix({ contract, source, run: next, expansion, sourceRevision });
      setIntentRun(next); setIntentMatrix(nextMatrix); setSelectedCellId(nextMatrix.cells.find((item) => item.caseIdentities.length)?.cellId ?? null); setDiagnostics([{ severity: "warning", code: "NETWORK_INTENT_RUN_COMPLETE", message: `IntentRun ${next.status}; matrix projection ${nextMatrix.freshness}. Actual values are Engine evaluation only.` }]);
    } catch (error) { setDiagnostics([{ severity: "error", code: "NETWORK_INTENT_RUN_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); } finally { setBusy(false); }
  };
  const exportRun = () => { if (intentRun) downloadJson({ filename: `${intentRun.runId}.network-intent-run.json`, mime: "application/json", text: exportIntentRun(intentRun) }); };
  useEffect(() => { if (!intentRun || !contract || !source || !expansion) return; let active = true; (async () => { const state = await verifyIntentRunCurrent(intentRun, { contract, source, sourceRevision }); if (!active) return; setStale(state.status === "STALE"); try { setIntentMatrix(await buildIntentResultMatrix({ contract, source, run: intentRun, expansion, sourceRevision })); } catch (error) { setDiagnostics([{ severity: "error", code: "INTENT_MATRIX_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); } })(); return () => { active = false; }; }, [workspace.mode, workspace.sourceRevision, intentRun?.identity, contract?.identity, expansion?.identity]);
  const visibleMatrix = intentMatrix ? filterIntentResultMatrix(intentMatrix, matrixFilters) : null;
  const selectedCell = visibleMatrix?.cells.find((item) => item.cellId === selectedCellId) ?? visibleMatrix?.cells.find((item) => item.caseIdentities.length) ?? null;
  const selectedCellCases = intentMatrix && selectedCell ? intentMatrixCellCases(intentMatrix, selectedCell.cellId) : [];
  return e("section", { className: "troubleshooting-case-panel network-intent-panel", "aria-label": "Network Intent", "data-network-intent": "ready" },
    e("h2", null, "Network Intent"),
    e("p", null, "Dev2 deterministic expansion and IntentRun. Expected intent remains separate from actual Engine result."),
    e("div", { className: "case-actions" },
      e("button", { type: "button", onClick: createIntent, "data-intent-create": "true" }, "Create Intent"),
      e("button", { type: "button", onClick: () => createIntent(true), "data-intent-create-multi": "true" }, "Create Multi-Case Intent"),
      e("button", { type: "button", onClick: previewIntent, disabled: !contract || !source, "data-intent-preview": "true" }, "Preview Expansion"),
      e("button", { type: "button", onClick: runIntent, disabled: !expansion || stale || busy, "data-intent-run": "true" }, busy ? "Running Intent…" : "Run Intent"),
      e("button", { type: "button", onClick: exportIntent, disabled: !contract, "data-intent-export": "true" }, "Export Intent"),
      e("button", { type: "button", onClick: createBundle, disabled: !contract || !source, "data-intent-bundle-create": "true" }, "Create Intent Bundle"),
      e("button", { type: "button", onClick: exportBundle, disabled: !intentBundle, "data-intent-bundle-export": "true" }, "Export Intent Bundle"),
      e("label", { className: "file-action" }, "Select Intent Bundle", e("input", { type: "file", accept: ".json,.yadilab-intent-bundle.json,application/json", onChange: selectBundle, "data-intent-bundle-select": "true" })),
      e("button", { type: "button", onClick: confirmBundleImport, disabled: !pendingBundleText || !source, "data-intent-bundle-confirm": "true" }, "Confirm Bundle Import"),
      e("button", { type: "button", onClick: exportRun, disabled: !intentRun, "data-intent-run-export": "true" }, "Export IntentRun")),
    contract ? e("div", { "data-intent-summary": "true" },
      e("strong", null, `Contract ${contract.identity.slice(0, 16)}…`),
      e("small", null, `${contract.endpointSets.length} endpoint sets · ${contract.flowProfiles.length} flow profiles · ${contract.rules.length} rule`),
      expansion ? e("div", { "data-intent-preview-summary": "true" }, e("strong", null, `Concrete cases ${expansion.caseCount}`), e("span", null, `Expansion ${expansion.identity.slice(0, 12)}…`)) : e("span", null, "Preview not built."),
      intentRun ? e("div", { "data-intent-run-summary": stale ? "STALE" : intentRun.status }, e("strong", null, stale ? "STALE / HISTORICAL" : `IntentRun ${intentRun.status}`), e("span", null, `PASS ${intentRun.counts.PASS} · FAIL ${intentRun.counts.FAIL} · UNMODELED ${intentRun.counts.UNMODELED} · NOT RUN ${intentRun.counts["NOT RUN"]}`), ...intentRun.cases.map((item) => e("details", { key: item.caseIdentity, "data-intent-case": item.caseIdentity }, e("summary", null, `${item.caseIdentity.slice(0, 12)}… · Expected ${item.expected} · Actual ${item.actual} · ${item.result}`), e("small", null, `Flow ${item.flowId} · Assertion ${item.assertionIdentity.slice(0, 12)}… · Engine run ${item.engineRunId ?? "NOT RUN"}`)))) : null,
      bundlePreview ? e("section", { "data-intent-bundle-preview": intentBundle?.status ?? "PENDING_CONFIRM" }, e("h3", null, "Intent Bundle Preview"), e("p", null, `${bundlePreview.formatId} · ${bundlePreview.schemaVersion} · ${bundlePreview.status} · integrity ${bundlePreview.integrity}`), e("small", null, `Rules ${bundlePreview.ruleCount} · endpoint sets ${bundlePreview.endpointSetCount} · flow profiles ${bundlePreview.flowProfileCount} · expected expansion ${bundlePreview.expectedExpansionCount}`)) : null,
      intentMatrix ? e("section", { className: "intent-matrix", "data-intent-matrix": intentMatrix.freshness },
        e("h3", null, "Intent Result Matrix"),
        e("p", null, `${intentMatrix.freshness} · expected intent remains separate from actual Engine result · projection ${intentMatrix.identity.slice(0, 12)}…`),
        e("div", { className: "case-actions", "data-intent-matrix-filters": "true" },
          e("label", null, "Result ", e("select", { value: matrixFilters.state ?? "", onChange: (event) => setMatrixFilters((current) => ({ ...current, state: event.target.value || undefined })), "data-intent-matrix-result-filter": "true" }, e("option", { value: "" }, "ALL"), ...["PASS", "FAIL", "MIXED", "UNMODELED", "NOT RUN", "INVALID", "UNKNOWN", "NO CASES"].map((state) => e("option", { key: state, value: state }, state)))),
          e("label", null, "Source ", e("select", { value: matrixFilters.sourceSetId ?? "", onChange: (event) => setMatrixFilters((current) => ({ ...current, sourceSetId: event.target.value || undefined })), "data-intent-matrix-source-filter": "true" }, e("option", { value: "" }, "ALL"), ...intentMatrix.sourceDimensions.map((item) => e("option", { key: item.id, value: item.id }, item.title)))),
          e("label", null, "Destination ", e("select", { value: matrixFilters.destinationSetId ?? "", onChange: (event) => setMatrixFilters((current) => ({ ...current, destinationSetId: event.target.value || undefined })), "data-intent-matrix-destination-filter": "true" }, e("option", { value: "" }, "ALL"), ...intentMatrix.destinationDimensions.map((item) => e("option", { key: item.id, value: item.id }, item.title)))),
          e("label", null, "Flow ", e("select", { value: matrixFilters.flowProfileId ?? "", onChange: (event) => setMatrixFilters((current) => ({ ...current, flowProfileId: event.target.value || undefined })), "data-intent-matrix-flow-filter": "true" }, e("option", { value: "" }, "ALL"), ...intentMatrix.flowProfiles.map((item) => e("option", { key: item.id, value: item.id }, item.title)))),
          e("label", null, "Rule ", e("select", { value: matrixFilters.ruleId ?? "", onChange: (event) => setMatrixFilters((current) => ({ ...current, ruleId: event.target.value || undefined })), "data-intent-matrix-rule-filter": "true" }, e("option", { value: "" }, "ALL"), ...contract.rules.map((item) => e("option", { key: item.ruleId, value: item.ruleId }, item.ruleId)))),
          e("button", { type: "button", onClick: () => setMatrixFilters({}), "data-intent-matrix-filter-clear": "true" }, "Clear filters")),
        e("div", { className: "intent-matrix-grid", "data-intent-matrix-grid": "true" }, ...visibleMatrix.cells.map((cell) => e("button", { type: "button", key: cell.cellId, className: `intent-matrix-cell state-${cell.state.toLowerCase().replaceAll(" ", "-")}`, "data-intent-matrix-cell": cell.cellId, "data-intent-matrix-state": cell.state, onClick: () => setSelectedCellId(cell.cellId) }, e("strong", null, cell.state), e("span", null, `${cell.sourceSetId} → ${cell.destinationSetId}`), e("small", null, `${cell.flowProfileId} · cases ${cell.caseIdentities.length} · PASS ${cell.counts.PASS} · FAIL ${cell.counts.FAIL} · UNKNOWN ${cell.counts.UNKNOWN}`)))),
        selectedCell ? e("section", { className: "intent-matrix-drilldown", "data-intent-matrix-drilldown": selectedCell.cellId }, e("h4", null, `Cell ${selectedCell.state}`), e("p", null, `${selectedCell.sourceSetId} → ${selectedCell.destinationSetId} · Flow ${selectedCell.flowProfileId} · Rule ${selectedCell.ruleIds.join(", ") || "NO CASES"}`), ...selectedCellCases.map((item) => e("div", { key: item.caseIdentity, className: "intent-matrix-case", "data-intent-matrix-case": item.caseIdentity }, e("strong", null, `Expected ${item.expected} · Actual ${item.actual} · ${item.result}`), e("small", null, `Case ${item.caseIdentity} · Assertion ${item.assertionIdentity} · Engine run ${item.engineRunId ?? "NOT RUN"}`), item.engineRunId && onOpenEngineRun ? e("button", { type: "button", onClick: () => onOpenEngineRun(item, engineWorkspacesRef.current.get(item.engineRunId)), "data-intent-open-engine-run": item.engineRunId, "data-intent-open-evidence": item.engineRunId }, "Open exact Engine evidence") : null))) : null,
      ) : null,
    ) : e("span", { "data-intent-empty": "true" }, "No intent contract created."),
  );
}

function App() {
  const [runtimeMedia, setRuntimeMedia] = useState(null);
  const mediaRef = useRef(null);
  const releaseMedia = () => {
    mediaRef.current?.release();
    mediaRef.current = null;
    setRuntimeMedia(null);
  };
  useEffect(() => () => mediaRef.current?.release(), []);
  // The build HTML is always "booting". Readiness is attested only after React
  // has mounted the actual application controls, never by a static HTML marker.
  useEffect(() => {
    markApplicationReady(document);
    return () => markApplicationStopped(document);
  }, []);
  const [workspace, commitWorkspaceState] = useState(() => createBuilderWorkspace(welcomeScenario));
  const lastBuilderWorkspaceRef = useRef(workspace);
  if (workspace.mode === "builder") lastBuilderWorkspaceRef.current = workspace;
  const projectGuardRef = useRef(() => true);
  const pendingBuilderDraftsRef = useRef(createPendingBuilderDraftRegistry());
  const [pendingBuilderDraftCount, setPendingBuilderDraftCount] = useState(0);
  const onPendingDraftChange = React.useCallback((owner, dirty, generation) => {
    const next = pendingBuilderDraftsRef.current.mark(owner, dirty, generation);
    setPendingBuilderDraftCount(current => current === next ? current : next);
  }, []);
  const hasPendingBuilderDrafts = React.useCallback(
    () => pendingBuilderDraftsRef.current.hasPending(), []);
  const hasOtherPendingBuilderDrafts = React.useCallback(
    owner => pendingBuilderDraftsRef.current.hasOtherPending(owner), []);
  const latestDrawioWorkspaceRef = useRef(workspace);
  latestDrawioWorkspaceRef.current = workspace;
  // The React state commit can be batched until after the current user event.
  // Native Save/New/Open and the discard guard must nevertheless observe the
  // just-applied canonical Builder edit *in that same event turn*. All callers
  // currently submit concrete workspaces, never updater callbacks.
  const setWorkspace = React.useCallback((next) => {
    // A subsequent Runtime Preview can be requested in the same JavaScript
    // task as an Apply. Keep the latest editable Builder source for Back even
    // before React commits the next render.
    latestDrawioWorkspaceRef.current = next;
    if (next.mode === "builder") lastBuilderWorkspaceRef.current = next;
    commitWorkspaceState(next);
  }, []);
  const [importWorkbench, setImportWorkbench] = useState(() => emptyImportWorkbench());
  // Both the main Import / Export file chooser and the embedded Workbench
  // feed the same source. A slow old File.text() or compiler promise must
  // never overwrite the later selected file or reactivate its old preview.
  const importWorkbenchRef = useRef(importWorkbench);
  importWorkbenchRef.current = importWorkbench;
  const importRequestEpochRef = useRef(0);
  const publishImportWorkbench = (next) => {
    importWorkbenchRef.current = next;
    setImportWorkbench(next);
  };
  const [networkImportOpen, setNetworkImportOpen] = useState(false);
  const [structuredXmlInspectionOpen, setStructuredXmlInspectionOpen] = useState(false);
  const [networkImportSelection, setNetworkImportSelection] = useState(null);
  const [graphmlPreviewOpen, setGraphmlPreviewOpen] = useState(false);
  const [nmapObservationOpen, setNmapObservationOpen] = useState(false);
  const [nmapReplayOpen, setNmapReplayOpen] = useState(false);
  const [nessusSeverityOpen, setNessusSeverityOpen] = useState(false);
  const [nessusReplayOpen, setNessusReplayOpen] = useState(false);
  const [drawioStructureOpen, setDrawioStructureOpen] = useState(false);
  const [drawioBuilderReviewOpen, setDrawioBuilderReviewOpen] = useState(false);
  const [drawioReplayOpen, setDrawioReplayOpen] = useState(false);
  const [ansibleInventoryOpen, setAnsibleInventoryOpen] = useState(false);
  const [ansibleYamlReplayOpen, setAnsibleYamlReplayOpen] = useState(false);
  const [ansibleIniOpen, setAnsibleIniOpen] = useState(false);
  const [ansibleIniReplayOpen, setAnsibleIniReplayOpen] = useState(false);
  const [docxStructureOpen, setDocxStructureOpen] = useState(false);
  const [officeReviewedBuilderOpen, setOfficeReviewedBuilderOpen] = useState(false);
  const [scaledOfficeBuilderOpen, setScaledOfficeBuilderOpen] = useState(false);
  const [scaledOfficeThousandOpen, setScaledOfficeThousandOpen] = useState(false);
  const [scaledOfficeFiveThousandOpen, setScaledOfficeFiveThousandOpen] = useState(false);
  const [scaledOfficeTenThousandPreflightOpen,setScaledOfficeTenThousandPreflightOpen]=useState(false);
  const [scaledOfficeTenThousandBuilderOpen,setScaledOfficeTenThousandBuilderOpen]=useState(false);
  const [scaledOfficeFiveThousandFocus, setScaledOfficeFiveThousandFocus] = useState(null);
  const [scaledTenThousandFocus,setScaledTenThousandFocus]=useState(null);
  const [scaledTenThousandSessionActive,setScaledTenThousandSessionActive]=useState(false);
  const [scaledTenThousandFocusBusy,setScaledTenThousandFocusBusy]=useState(false);
  const scaledTenThousandFocusEpoch=useRef(0);
  const [scaledOfficeFiveThousandSessionActive,setScaledOfficeFiveThousandSessionActive]=useState(false);
  const [scaledOfficeFiveThousandSafeCompileAttempted,setScaledOfficeFiveThousandSafeCompileAttempted]=useState(false);
  const [scaledOfficeFiveThousandFocusBusy,setScaledOfficeFiveThousandFocusBusy]=useState(false);
  const scaledOfficeFiveThousandFocusEpoch=useRef(0);
  const [scaledOfficeThousandFocus, setScaledOfficeThousandFocus] = useState(null);
  const [declaredOfficePanelOpen,setDeclaredOfficePanelOpen]=useState(false);
  const [declaredOfficeHierarchy,setDeclaredOfficeHierarchy]=useState(null);
  const [declaredOfficeFocus,setDeclaredOfficeFocus]=useState(null);
  const [declaredOfficeFocusBusy,setDeclaredOfficeFocusBusy]=useState(false);
  const declaredOfficeFocusEpoch=useRef(0),declaredOfficeVersion=useRef(0);
  const [scaledOfficeThousandFocusBusy, setScaledOfficeThousandFocusBusy] = useState(false);
  const scaledOfficeThousandFocusEpoch = useRef(0);
  const [docxReplayOpen, setDocxReplayOpen] = useState(false);
  const [odtReplayOpen, setOdtReplayOpen] = useState(false);
  const [odtStructureOpen, setOdtStructureOpen] = useState(false);
  const [importedProbeAutoOpen, setImportedProbeAutoOpen] = useState(false);
  const [diagnosticSourceRequest, setDiagnosticSourceRequest] = useState(null);
  const diagnosticSourceRequestIdRef = useRef(0);
  const [nextCheckPreparation, setNextCheckPreparation] = useState(null);
  const nextCheckRequestIdRef = useRef(0);
  const [diagnostics, setDiagnostics] = useState([]);
  const [busy, setBusy] = useState(false);
  const [guidedLabId, setGuidedLabId] = useState(() => builtinGuidedLabs[0]?.id ?? "");
  const [enterpriseScenarioId, setEnterpriseScenarioId] = useState(() => enterpriseOfficeScenarios[0]?.scenarioId ?? "");
  const [verifiedDeliveryScenarioId, setVerifiedDeliveryScenarioId] = useState(() => verifiedDeliveryScenarios[0]?.scenarioId ?? "");
  const [verifiedDeliveryLoadKey, setVerifiedDeliveryLoadKey] = useState(0);
  const [notebook, setNotebook] = useState(null);
  const [activeJourney, setActiveJourney] = useState(null);
  const [topologyStateFocus, setTopologyStateFocus] = useState(null);
  const scenarioTransitionRef = useRef(0);
  // Pending asynchronous lab launches retain old Builder draft ownership
  // until the replacement workspace is actually committed.
  const scenarioLaunchRequestRef = useRef(0);
  const showScaledTenThousandFocusPage=async requestedPage=>{
    const current=scaledTenThousandFocus;
    const before=latestDrawioWorkspaceRef.current;
    if(!current||before.mode!=="builder"||before.source!==current.source||
       before.compile.status!=="valid"||before.compile.model!==current.model||
       !Number.isSafeInteger(requestedPage)||requestedPage<1||
       requestedPage>current.pageCount)return;
    const transition=scenarioTransitionRef.current;
    const epoch=++scaledTenThousandFocusEpoch.current;
    setScaledTenThousandFocusBusy(true);
    // Unmount stale page before async ELK: same-count ReactFlow views cannot
    // display an old source edge under a freshly selected row scope.
    setScaledTenThousandFocus(null);
    try{
      const focus=current.sourceKind==="ods-p4f2"&&current.editedBounded
        ?await buildScaledOdsTenThousandEditedFocus(
          current.baselineSource,current.baselineModel,
          current.source,current.model,current.nodeOrder,requestedPage)
        :current.sourceKind==="xlsx-p4e1"&&current.editedBounded
        ?await buildScaledXlsxTenThousandEditedFocus(
          current.baselineSource,current.baselineModel,
          current.source,current.model,current.nodeOrder,requestedPage)
        :current.sourceKind==="office-p4c3b"&&current.editedBounded
        ?await buildScaledOfficeTenThousandEditedFocus(
          current.baselineSource,current.baselineModel,
          current.source,current.model,current.nodeOrder,requestedPage)
        :current.sourceKind==="office-p4c3b"
        ?await buildScaledOfficeTenThousandFocus(current.model,current.nodeOrder,requestedPage)
        :await buildScaledNetworkTenThousandFocus(current.model,current.nodeOrder,requestedPage);
      const active=latestDrawioWorkspaceRef.current;
      if(epoch!==scaledTenThousandFocusEpoch.current||
         scenarioTransitionRef.current!==transition||
         active.mode!=="builder"||active.source!==current.source||
         active.compile.status!=="valid"||active.compile.model!==current.model)return;
      setScaledTenThousandFocus({...current,...focus});
    }catch(cause){
      if(epoch===scaledTenThousandFocusEpoch.current)
        setDiagnostics([{severity:"error",
          code:typeof cause?.code==="string"&&/^SCALE_(?:P4B1|P4C3B|P4C4A|P4E2|P4F3)_[A-Z0-9_]+$/.test(cause.code)
            ?cause.code:"SCALE_P4C3B_OR_P4B1_FOCUS_BLOCKED",
          message:"Exact original source-row layout blocked; no unbounded fallback. Full canonical Builder source remains unchanged."}]);
    }finally{
      if(epoch===scaledTenThousandFocusEpoch.current)
        setScaledTenThousandFocusBusy(false);
    }
  };
  // P4c4a: separate explicit human-requested rebuild after a real local edit;
  // current compiled source and original 10k baseline must compare exactly.
  const reviewEditedTenThousandBoundedFocus=async()=>{
    const prior=scaledTenThousandFocus;
    const before=latestDrawioWorkspaceRef.current;
    if(!scaledTenThousandSessionActive||!prior||
       (prior.sourceKind!=="office-p4c3b"&&prior.sourceKind!=="xlsx-p4e1"&&prior.sourceKind!=="ods-p4f2")||
       before.mode!=="builder"||
       (before.compile.status!=="valid"&&!((prior.sourceKind==="xlsx-p4e1"||prior.sourceKind==="ods-p4f2")&&before.source.resources.length!==10001))||
       (!before.compile.model&&!((prior.sourceKind==="xlsx-p4e1"||prior.sourceKind==="ods-p4f2")&&before.source.resources.length!==10001))||
       before.source===prior.source||
       scaledTenThousandFocusBusy)return;
    // P4e2 must expose a review-denial action even when a second edit makes
    // the compiler invalid. Never compile/layout or show a stale graph here.
    if((prior.sourceKind==="xlsx-p4e1"||prior.sourceKind==="ods-p4f2")&&before.source.resources.length!==10001){
      ++scaledTenThousandFocusEpoch.current;
      setScaledTenThousandFocus(null);
      setDiagnostics([{severity:"error",code:"SCALE_P4E2_APPEND_ONLY_BLOCKED",
        message:"Only one user-authored unconnected XLSX Builder device may be separately reviewed. Original source remains editable; no graph is shown."}]);
      return;
    }
    const baselineSource=prior.baselineSource??prior.source;
    const baselineModel=prior.baselineModel??prior.model;
    const transition=scenarioTransitionRef.current;
    const epoch=++scaledTenThousandFocusEpoch.current;
    setScaledTenThousandFocusBusy(true);
    // The previous original SVG edges MUST unmount before the async review.
    // A failed new review can never reactivate a stale or full 10k graph.
    setScaledTenThousandFocus(null);
    try{
      const reviewed=await (prior.sourceKind==="ods-p4f2"
        ?buildScaledOdsTenThousandEditedFocus
        :prior.sourceKind==="xlsx-p4e1"
        ?buildScaledXlsxTenThousandEditedFocus
        :buildScaledOfficeTenThousandEditedFocus)(
        baselineSource,baselineModel,
        before.source,before.compile.model,prior.nodeOrder,1);
      const digest=new Uint8Array(await globalThis.crypto.subtle.digest(
        "SHA-256",new TextEncoder().encode(JSON.stringify(before.source))));
      const sourceModelHash=Array.from(digest,
        value=>value.toString(16).padStart(2,"0")).join("");
      const current=latestDrawioWorkspaceRef.current;
      if(epoch!==scaledTenThousandFocusEpoch.current||
         transition!==scenarioTransitionRef.current||
         current.mode!=="builder"||current.source!==before.source||
         current.compile.status!=="valid"||
         current.compile.model!==before.compile.model)return;
      setScaledTenThousandFocus({
        ...prior,
        source:current.source,model:current.compile.model,
        baselineSource,baselineModel,
        sourceModelHash,...reviewed
      });
      setDiagnostics([{severity:"warning",
        code:prior.sourceKind==="xlsx-p4e1"?"SCALE_P4E2_ONE_BOUNDED_APPEND_ONLY":prior.sourceKind==="ods-p4f2"?"SCALE_P4F3_ONE_BOUNDED_APPEND_ONLY":"SCALE_P4C4A_ONE_BOUNDED_APPEND_ONLY",
        message:"Exactly 10,000 unchanged original Office devices, all 10,000 exact source-port Links and ONE user-appended unconnected device separately reviewed. Original 100 bounded pages and isolated page 101 enabled; no Engine or physical truth."}]);
    }catch(cause){
      if(epoch===scaledTenThousandFocusEpoch.current)
        setDiagnostics([{severity:"error",
          code:typeof cause?.code==="string"&&
            /^SCALE_(?:P4C4A|P4E2|P4F3)_[A-Z0-9_]+$/.test(cause.code)
            ?cause.code:prior.sourceKind==="xlsx-p4e1"?"SCALE_P4E2_REVIEW_BLOCKED":"SCALE_P4C4A_REVIEW_BLOCKED",
          message:"Edited Office 10k bounded graph blocked: only one explicit unlinked resource is permitted; all original source and compiled port/link identities must remain unchanged. Canonical Builder source stays editable; zero graph was shown."}]);
    }finally{
      if(epoch===scaledTenThousandFocusEpoch.current)
        setScaledTenThousandFocusBusy(false);
    }
  };
  const showScaledFiveThousandFocusPage=async requestedPage=>{
    const current=scaledOfficeFiveThousandFocus;
    const before=latestDrawioWorkspaceRef.current;
    if(!current||before.mode!=="builder"||before.source!==current.source||
       before.compile.status!=="valid"||before.compile.model!==current.model||
       !Number.isSafeInteger(requestedPage)||requestedPage<1||
       requestedPage>current.pageCount)return;
    const transition=scenarioTransitionRef.current;
    const epoch=++scaledOfficeFiveThousandFocusEpoch.current;
    setScaledOfficeFiveThousandFocusBusy(true);
    // Invalidating the old page BEFORE the asynchronous ELK calculation
    // unmounts its ReactFlow edges. Otherwise pages 2/25/50 may have exactly
    // the same DOM node/edge counts and a real Chromium observer can read
    // OLD source IDs while the next bounded page is being computed.
    // A stale/failed render remains blank, never the previous or full 5k view.
    setScaledOfficeFiveThousandFocus(null);
    try{
      const focus=current.twoEditedBounded
        ?await buildScaledOfficeFiveThousandTwoEditedFocus(
          current.baselineSource,current.baselineModel,
          current.source,current.model,current.nodeOrder,requestedPage,
          current.firstApprovedSource,current.firstApprovedModel)
        :current.editedBounded
        ?await buildScaledOfficeFiveThousandEditedFocus(
          current.baselineSource,current.baselineModel,
          current.source,current.model,current.nodeOrder,requestedPage)
        :await buildScaledOfficeFiveThousandFocus(current.model,current.nodeOrder,requestedPage);
      const active=latestDrawioWorkspaceRef.current;
      if(epoch!==scaledOfficeFiveThousandFocusEpoch.current||
         scenarioTransitionRef.current!==transition||
         active.mode!=="builder"||active.source!==current.source||
         active.compile.status!=="valid"||active.compile.model!==current.model)return;
      setScaledOfficeFiveThousandFocus({...current,...focus});
    }catch(cause){
      if(epoch===scaledOfficeFiveThousandFocusEpoch.current)
        setDiagnostics([{severity:"error",
          code:typeof cause?.code==="string"&&/^SCALE_P3(?:C2|D2|D3)_[A-Z0-9_]+$/.test(cause.code)
            ?cause.code:"SCALE_P3C2_FOCUS_BLOCKED",
          message:"Unable to display the exact bounded source identity and valid ELK focus; the canonical Builder source was not modified."}]);
    }finally{
      if(epoch===scaledOfficeFiveThousandFocusEpoch.current)
        setScaledOfficeFiveThousandFocusBusy(false);
    }
  };
  const reviewEditedFiveThousandBoundedFocus=async (requestedMode="first")=>{
    const prior=scaledOfficeFiveThousandFocus;
    const before=latestDrawioWorkspaceRef.current;
    if(!scaledOfficeFiveThousandSessionActive||!prior||
       before.mode!=="builder"||before.compile.status!=="valid"||
       !before.compile.model||before.source===prior.source||
       scaledOfficeFiveThousandFocusBusy)return;
    // Keep the P3d2 negative second-append regression unchanged. A P3d2
    // denial must not erase the P3d2 approval needed by separate P3d3 review.
    if(requestedMode==="first"&&before.source.resources.length!==5001){
      setDiagnostics([{severity:"error",code:"SCALE_P3D2_APPEND_ONLY_BLOCKED",
        message:"P3d2 permits exactly one appended unlinked resource. A second addition requires the separate P3d3 review; the prior graph remains hidden."}]);
      return;
    }
    const baselineSource=prior.baselineSource??prior.source;
    const baselineModel=prior.baselineModel??prior.model;
    const transition=scenarioTransitionRef.current;
    const epoch=++scaledOfficeFiveThousandFocusEpoch.current;
    setScaledOfficeFiveThousandFocusBusy(true);
    // Do not reveal previous original edges during asynchronously recalculated
    // review: a stale/failed revision MUST stay blank.
    setScaledOfficeFiveThousandFocus(null);
    try{
      const secondReview=requestedMode==="second";
      if(secondReview&&before.source.resources.length!==5002){
        const error=new Error("SCALE_P3D3_APPEND_ONLY_BLOCKED");
        error.code="SCALE_P3D3_APPEND_ONLY_BLOCKED";throw error;
      }
      if(secondReview&&(!prior.editedBounded||prior.twoEditedBounded||
         prior.canonicalNodes!==5001||prior.source.resources.length!==5001)){
        const error=new Error("SCALE_P3D3_FIRST_REVIEW_BLOCKED");
        error.code="SCALE_P3D3_FIRST_REVIEW_BLOCKED";throw error;
      }
      const reviewed=secondReview
        ?await buildScaledOfficeFiveThousandTwoEditedFocus(
          baselineSource,baselineModel,
          before.source,before.compile.model,prior.nodeOrder,1,
          prior.source,prior.model)
        :await buildScaledOfficeFiveThousandEditedFocus(
          baselineSource,baselineModel,
          before.source,before.compile.model,prior.nodeOrder,1);
      const digest=new Uint8Array(await globalThis.crypto.subtle.digest(
        "SHA-256",new TextEncoder().encode(JSON.stringify(before.source))));
      const sourceModelHash=Array.from(digest,
        x=>x.toString(16).padStart(2,"0")).join("");
      const current=latestDrawioWorkspaceRef.current;
      if(epoch!==scaledOfficeFiveThousandFocusEpoch.current||
         transition!==scenarioTransitionRef.current||
         current.mode!=="builder"||current.source!==before.source||
         current.compile.status!=="valid"||
         current.compile.model!==before.compile.model)return;
      setScaledOfficeFiveThousandFocus({
        ...prior,
        source:current.source,model:current.compile.model,
        baselineSource,baselineModel,
        ...(secondReview?{
          firstApprovedSource:prior.source,firstApprovedModel:prior.model
        }:{}),
        sourceModelHash,...reviewed
      });
      setDiagnostics([{
        severity:"warning",
        code:secondReview?"SCALE_P3D3_TWO_BOUNDED_ADDITIONS_ONLY":"SCALE_P3D2_BOUNDED_ADDITION_ONLY",
        message:secondReview
          ?"The original 5,000 devices and 5,000 original port-paired links remain exact. Two separately reviewed manually appended unlinked Builder resources have isolated pages 51/52. No physical or Engine truth was inferred."
          :"Only the original 5,000 unchanged source devices and original 5,000 port-paired links were re-reviewed. One locally added unlinked Builder resource has its own separate bounded page. No physical or Engine truth was inferred."
      }]);
    }catch(cause){
      if(epoch===scaledOfficeFiveThousandFocusEpoch.current){
        const code=typeof cause?.code==="string"&&
          /^SCALE_P3D[23]_[A-Z0-9_]+$/.test(cause.code)
          ?cause.code:"SCALE_P3D3_REBUILD_BLOCKED";
        setDiagnostics([{severity:"error",code,
          message:"Bounded edited Builder focus is blocked: original Office source, compiled canonical links, or explicit append-only review did not match. The current source remains editable; no graph was rendered."}]);
      }
    }finally{
      if(epoch===scaledOfficeFiveThousandFocusEpoch.current)
        setScaledOfficeFiveThousandFocusBusy(false);
    }
  };
  const showScaledThousandFocusPage = async requestedPage => {
    const current=scaledOfficeThousandFocus;
    if(!current || current.source!==latestDrawioWorkspaceRef.current.source ||
       latestDrawioWorkspaceRef.current.mode!=="builder" ||
       latestDrawioWorkspaceRef.current.compile.status!=="valid" ||
       current.model!==latestDrawioWorkspaceRef.current.compile.model ||
       !Number.isSafeInteger(requestedPage)||requestedPage<1||requestedPage>10)
      return;
    const transition=scenarioTransitionRef.current;
    const epoch=++scaledOfficeThousandFocusEpoch.current;
    setScaledOfficeThousandFocusBusy(true);
    try{
      const view=await buildScaledOfficeThousandFocus(
        current.model,current.nodeOrder,requestedPage);
      const active=latestDrawioWorkspaceRef.current;
      if(epoch!==scaledOfficeThousandFocusEpoch.current ||
         scenarioTransitionRef.current!==transition ||
         active.mode!=="builder"||active.source!==current.source ||
         active.compile.status!=="valid"||active.compile.model!==current.model)
        return;
      // Returning to the original row focus cannot retain stale geography.
      declaredOfficeFocusEpoch.current++;
      setDeclaredOfficeFocus(null);
      setDeclaredOfficeFocusBusy(false);
      // Only display state changes. Full Builder source and revision remain.
      setScaledOfficeThousandFocus({...current,...view});
    }catch(cause){
      if(epoch===scaledOfficeThousandFocusEpoch.current)
        setDiagnostics([{severity:"error",
          code:typeof cause?.code==="string"&&/^SCALE_P2B1_[A-Z0-9_]+$/.test(cause.code)
            ?cause.code:"SCALE_P2B1_FOCUS_BLOCKED",
          message:"Unable to safely draw the requested original source-row focus."}]);
    }finally{
      if(epoch===scaledOfficeThousandFocusEpoch.current)
        setScaledOfficeThousandFocusBusy(false);
    }
  };
  const restoreDeclaredOfficeHierarchyFocus=()=>{
    declaredOfficeFocusEpoch.current++;
    setDeclaredOfficeFocus(null);
    setDeclaredOfficeFocusBusy(false);
  };
  const showDeclaredOfficeHierarchyFocus=async (
    kind,id,page=1,focusDeviceId=null
  )=>{
    const rowFocus=scaledOfficeThousandFocus;
    const hierarchy=declaredOfficeHierarchy;
    const current=latestDrawioWorkspaceRef.current;
    if(!rowFocus||!hierarchy||current.mode!=="builder"||
       current.compile.status!=="valid"||
       current.source!==rowFocus.source||current.compile.model!==rowFocus.model||
       hierarchy.source!==current.source||
       hierarchy.model!==current.compile.model||
       hierarchy.sourceRevision!==current.sourceRevision)return;
    const expected=JSON.stringify(current);
    const transition=scenarioTransitionRef.current;
    const epoch=++declaredOfficeFocusEpoch.current;
    setDeclaredOfficeFocusBusy(true);
    const stillCurrent=()=>{
      const active=latestDrawioWorkspaceRef.current;
      return epoch===declaredOfficeFocusEpoch.current &&
        scenarioTransitionRef.current===transition &&
        active.mode==="builder"&&active.source===rowFocus.source &&
        active.compile.status==="valid" &&
        active.compile.model===rowFocus.model &&
        active.sourceRevision===hierarchy.sourceRevision &&
        JSON.stringify(active)===expected;
    };
    try{
      const validated=await validateDeclaredOfficeSiteHierarchy(
        current.source,hierarchy.declaration,{
          sourceModelHash:rowFocus.sourceModelHash,
          sourceOriginalSha256:rowFocus.sourceOriginalSha256
        });
      if(!stillCurrent())return;
      const selected=await buildDeclaredOfficeHierarchyFocus(
        current.source,validated,kind,id,page,{
          trustedSourceModelHash:rowFocus.sourceModelHash,
          compiledModel:rowFocus.model
        });
      if(!stillCurrent())return;
      setDeclaredOfficeFocus({
        ...selected,source:current.source,model:rowFocus.model,
        sourceRevision:current.sourceRevision,hierarchy,
        ...(focusDeviceId?{focusDeviceId}:{})
      });
    }catch(cause){
      if(stillCurrent())
        setDiagnostics([{severity:"error",
          code:typeof cause?.code==="string"&&/^SCALE_P2B2_[A-Z0-9_]+$/.test(cause.code)
            ?cause.code:"SCALE_P2B2_FOCUS_BLOCKED",
          message:"The manually declared hierarchy focus was blocked; original Builder source is unchanged."}]);
    }finally{
      if(epoch===declaredOfficeFocusEpoch.current)
        setDeclaredOfficeFocusBusy(false);
    }
  };
  const [troubleshootingCase, setTroubleshootingCase] = useState(null);
  const [caseRunRecords, setCaseRunRecords] = useState([]);
  const [experimentBranches, setExperimentBranches] = useState([]);
  const [selectedExperimentId, setSelectedExperimentId] = useState("");
  const [experimentChangeSets, setExperimentChangeSets] = useState([]);
  const [verificationSuites, setVerificationSuites] = useState([]);
  const [verificationRuns, setVerificationRuns] = useState([]);
  const [variantMatrix, setVariantMatrix] = useState(null);
  const [matrixFilters, setMatrixFilters] = useState({});
  const [selectedMatrixRowId, setSelectedMatrixRowId] = useState("");
  const [caseWorkingRevision, setCaseWorkingRevision] = useState(0);
  const [promotionPreview, setPromotionPreview] = useState(null);
  const [promotionState, setPromotionState] = useState(null);
  const [promotionHistory, setPromotionHistory] = useState([]);
  const [verifiedBaselines, setVerifiedBaselines] = useState([]);
  const [selectedBaselineId, setSelectedBaselineId] = useState("");
  const [regressionCampaigns, setRegressionCampaigns] = useState([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [transitionMatrix, setTransitionMatrix] = useState(null);
  const [transitionFilter, setTransitionFilter] = useState("");
  const [campaignBundle, setCampaignBundle] = useState(null);
  const [promotionVerificationGate, setPromotionVerificationGate] = useState(null);
  const notebookScenarioHash = workspace.mode === "runtime" ? workspace.scenario.sourceHash : "builder";
  useEffect(() => { setNotebook(null); }, [notebookScenarioHash]);
  const journeyRevisionKey = workspace.mode === "runtime" ? `${workspace.scenario.sourceHash}:${workspace.engineState.stateRevision}` : "builder";
  useEffect(() => { setActiveJourney(null); setTopologyStateFocus(null); }, [journeyRevisionKey]);
  const progressStore = useMemo(() => typeof globalThis.indexedDB !== "undefined" ? new IndexedDbProgressStore(globalThis.indexedDB) : null, []);
  const troubleshootingSessionStore = useMemo(() => typeof globalThis.indexedDB !== "undefined" ? new IndexedDbTroubleshootingSessionStore(globalThis.indexedDB) : null, []);

  const beginScenarioTransition = () => {
    // Project replacement invalidates any older in-flight lab launch.
    scenarioLaunchRequestRef.current++;
    const transitionId = scenarioTransitionRef.current + 1;
    scenarioTransitionRef.current = transitionId;
    // A New/Open/import commits a new document synchronously, before old
    // Inspector/JSON React cleanup effects run. Late input from the old
    // generation cannot make the new project appear to hold its drafts.
    pendingBuilderDraftsRef.current.beginGeneration(transitionId);
    setPendingBuilderDraftCount(0);
    // All new scenario transitions invalidate the previous 5k Office session;
    // ordinary edits do not pass through this transition and remain guarded.
    setScaledOfficeFiveThousandSessionActive(false);
    setScaledOfficeFiveThousandSafeCompileAttempted(false);
    setScaledOfficeFiveThousandFocus(null);
    scaledTenThousandFocusEpoch.current++;
    setScaledTenThousandFocus(null);
    setScaledTenThousandSessionActive(false);
    setScaledTenThousandFocusBusy(false);
    releaseMedia();
    setNotebook(null);
    setActiveJourney(null);
    setTopologyStateFocus(null);
    setDiagnosticSourceRequest(null);
    setNextCheckPreparation(null);
    return transitionId;
  };
  const isCurrentScenarioTransition = (transitionId) => scenarioTransitionRef.current === transitionId;
  const requestDiagnoseFromSource = (sourceId) => {
    const active = latestDrawioWorkspaceRef.current;
    if (active.mode !== "runtime") return;
    const model = buildRuntimeActiveProbeModel(active, sourceId);
    if (model.sourceId !== sourceId) return;
    setDiagnosticSourceRequest({
      requestId: ++diagnosticSourceRequestIdRef.current,
      scenarioHash: active.scenario.sourceHash,
      sourceId,
    });
  };
  const handleDiagnosticSourceRequest = (requestId) => {
    setDiagnosticSourceRequest((current) => current?.requestId === requestId ? null : current);
  };
  const prepareNextCheck = (nextCheck) => {
    const active = latestDrawioWorkspaceRef.current;
    if (active.mode !== "runtime" || !nextCheck?.preparation || nextCheck.scenarioHash !== active.scenario.sourceHash) return false;
    setNextCheckPreparation({
      ...nextCheck.preparation,
      requestId: ++nextCheckRequestIdRef.current,
      scenarioHash: active.scenario.sourceHash,
    });
    return true;
  };
  const handleNextCheckPreparation = (requestId) => {
    setNextCheckPreparation((current) => current?.requestId === requestId ? null : current);
  };
  const reserveGuardedScenarioLaunch = () => {
    const launchToken = ++scenarioLaunchRequestRef.current;
    const transitionId = scenarioTransitionRef.current;
    const startingWorkspace = latestDrawioWorkspaceRef.current;
    let committed = false;
    const isLive = () => {
      if (scenarioLaunchRequestRef.current !== launchToken ||
          !scenarioLaunchStillCurrent(transitionId, scenarioTransitionRef.current,
            startingWorkspace, latestDrawioWorkspaceRef.current)) return false;
      // The current Builder remains mounted while compilation or ELK waits.
      // Its Inspector and JSON inputs must retain their original generation
      // until the replacement is synchronously authorized.
      if (hasPendingBuilderDrafts()) {
        setDiagnostics([{ severity: "error", code: "PROJECT_LAB_LATE_UNAPPLIED_DRAFT",
          message: "The lab switch was cancelled because unapplied Builder text appeared while loading. Apply or revert it before switching labs." }]);
        return false;
      }
      return true;
    };
    const publish = (nextWorkspace, onCommit) => {
      if (!isLive()) return false;
      // Do not clear old draft owners until an actual project handoff.
      beginScenarioTransition();
      committed = true;
      if (onCommit) onCommit();
      else setWorkspace(nextWorkspace);
      return true;
    };
    return {
      isLive, publish,
      mayFinishBusy: () => committed || scenarioLaunchRequestRef.current === launchToken,
    };
  };
  // Runtime imports/restores may await files or IndexedDB. Their results may
  // mutate only the exact Runtime generation that launched the operation.
  const isCurrentRuntimeOperation = (startingWorkspace, transitionId) =>
    startingWorkspace?.mode === "runtime" &&
    scenarioTransitionRef.current === transitionId &&
    latestDrawioWorkspaceRef.current === startingWorkspace;
  const replaceProjectDocument = (value) => {
    const next = value ?? createScenarioDraftWorkspace({
      scenarioId: "new_project", title: "New YadiLab project",
    });
    beginScenarioTransition();
    // A document replacement invalidates any older async Builder compilation.
    // Do not keep its busy flag attached to the newly opened project.
    setBusy(false);
    setImportedProbeAutoOpen(false);
    setNetworkImportOpen(false);
    setNetworkImportSelection(null);
    setWorkspace(next);
    latestDrawioWorkspaceRef.current = next;
    return next;
  };
  const commitVerifiedDeliveryRuntime = (runtime, fallback) => {
    setWorkspace(runtime.ok ? runtime.workspace : fallback);
    setVerifiedDeliveryLoadKey((value) => value + 1);
  };

  const compileAndLayout = async () => {
    if (workspace.mode !== "builder") return;
    if (hasPendingBuilderDrafts()) {
      setDiagnostics([{ severity: "error", code: "BUILDER_COMPILE_UNAPPLIED_DRAFT",
        message: "Apply or revert the pending Inspector/JSON inputs before compiling the committed source." }]);
      return;
    }
    const startedWorkspace = workspace;
    const startedTransition = scenarioTransitionRef.current;
    const isLiveCompile = () => {
      if (scenarioTransitionRef.current !== startedTransition ||
          latestDrawioWorkspaceRef.current !== startedWorkspace) return false;
      // React state/source identity is unchanged by an unapplied form edit.
      // Recheck after every compile/layout await: otherwise a late draft may
      // be silently discarded by the compiled Builder replacement.
      if (hasPendingBuilderDrafts()) {
        setDiagnostics([{ severity: "error", code: "BUILDER_COMPILE_LATE_UNAPPLIED_DRAFT",
          message: "Compilation was abandoned because Inspector/JSON text changed while the operation was running. Apply or revert that draft, then compile again." }]);
        return false;
      }
      return true;
    };
    setBusy(true);
    try {
      let next = await compileBuilderWorkspace(workspace, compilerOptions);
      // A New/Open, source replacement, or Builder edit during async compile
      // must never allow a stale result to replace the current project.
      if (!isLiveCompile()) return;
      const largeGuard=classifyScaledOfficeFiveThousandView({
        mode:"builder",resources:workspace.source.resources.length,
        connections:workspace.source.connections.length,
        sessionActive:scaledOfficeFiveThousandSessionActive,focusMatches:false
      });
      if (largeGuard.safeCompileOnly ||
          workspace.source.resources.length>=5000) {
        // Do NOT run autoLayoutBuilder on the full edited 5k canonical model.
        // Compiler checks the real editable source without fabricating a
        // usable 5k physical/Engine projection or discarding original links.
        const ok=next.compile.status==="valid";
        if(largeGuard.safeCompileOnly)
          setScaledOfficeFiveThousandSafeCompileAttempted(true);
        const office=largeGuard.safeCompileOnly;
        setDiagnostics([{
          severity:ok?"warning":"error",
          code:office
            ?(ok?"SCALE_P3D1_COMPILED_WITHOUT_FULL_LAYOUT":"SCALE_P3D1_COMPILE_BLOCKED")
            :(ok?"SCALE_P4B1_COMPILED_WITHOUT_FULL_LAYOUT":"SCALE_P4B1_COMPILE_BLOCKED"),
          message:office
            ?(ok
              ?"Edited original Office source compiled; full-graph layout deliberately not run. An independent bounded review is needed."
              :"Edited Office source compilation blocked; full-graph layout deliberately not run.")
            :(ok
              ?"Large canonical Builder source compiled without full-graph ELK; any prior bounded view remains invalid and needs separately reviewed source identity."
              :"Large Builder source compilation blocked; full-graph layout was never attempted.")
        }]);
        setWorkspace(next);
        return;
      }
      if (next.compile.status === "valid") {
        const layout = await autoLayoutBuilder(next, new ElkLayoutBackend());
        if (!isLiveCompile()) return;
        setDiagnostics(layout.diagnostics);
        if (layout.ok) next = layout.workspace;
      } else {
        setDiagnostics(next.compile.diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message })));
      }
      // One final check immediately before mutating the canonical workspace.
      if (!isLiveCompile()) return;
      setWorkspace(next);
    } finally {
      // Old completion must not clear a newer scenario operation's busy flag.
      if (scenarioTransitionRef.current === startedTransition) setBusy(false);
    }
  };

  const preview = () => {
    if (hasPendingBuilderDrafts()) {
      setDiagnostics([{ severity: "error", code: "BUILDER_PREVIEW_UNAPPLIED_DRAFT",
        message: "Apply or revert pending Builder form edits before opening Runtime. Unapplied text cannot become Engine evidence." }]);
      return;
    }
    // Inspector Apply and Runtime Preview can fire in the same JS event.
    // The rendered callback then still refers to the pre-Apply compiled
    // source while the live Builder is already dirty. Do not activate a
    // stale Engine/Runtime or silently replace the newer editable source.
    if (latestDrawioWorkspaceRef.current !== workspace) {
      setDiagnostics([{ severity: "error",
        code: "PROJECT_RUNTIME_PREVIEW_STALE_WORKSPACE",
        message: "Builder source changed before Runtime Preview. Validate and compile the current source before previewing it." }]);
      return;
    }
    if (workspace.mode !== "builder") return;
    const largeGuard=classifyScaledOfficeFiveThousandView({
      mode:"builder",resources:workspace.source.resources.length,
      connections:workspace.source.connections.length,
      sessionActive:scaledOfficeFiveThousandSessionActive,focusMatches:false
    });
    if (!largeGuard.canEnterEngine || workspace.source.resources.length>=5000){
      setDiagnostics([{
        severity:"warning",
        code:largeGuard.canEnterEngine?"SCALE_P4B1_ENGINE_NOT_VERIFIED":"SCALE_P3D1_ENGINE_NOT_VERIFIED",
        message:"Large source is editable Builder data only; full-graph layout, Runtime/Engine and physical network reachability are not verified and remain blocked."
      }]);
      return;
    }
    const result = previewRuntime(workspace);
    setDiagnostics(result.diagnostics);
    if (result.ok) {
      // Runtime activation is an explicit scenario-generation boundary.
      // Any older async compile/layout must not return later and replace the
      // Runtime with its stale Builder result. A successful preview supersedes
      // that pending operation; clear its old busy indicator here because its
      // own finally no longer owns the current transition generation.
      beginScenarioTransition();
      setBusy(false);
      setWorkspace(result.workspace);
    }
  };

  const openSource = async (file) => {
    if (!file) return;
    const ticket = ++importRequestEpochRef.current;
    // Invalidate an earlier READY source synchronously, before File.text()
    // awaits and before React can repaint the disabled Activate button.
    publishImportWorkbench({ status: "READING", fileName: file.name, diagnostics: [] });
    setDiagnostics([]);
    try {
      const next = await parseScenarioImport(file);
      if (ticket !== importRequestEpochRef.current) return;
      publishImportWorkbench(next);
      setDiagnostics(next.diagnostics);
    } catch (error) {
      if (ticket !== importRequestEpochRef.current) return;
      const next = { status: "INVALID", fileName: file.name,
        diagnostics: [{ severity: "error", code: "FILE_IMPORT_FAILED",
          message: error instanceof Error ? error.message : String(error) }] };
      publishImportWorkbench(next);
      setDiagnostics(next.diagnostics);
    }
  };

  const openPackage = async (file) => {
    if (!file || !projectGuardRef.current()) return;
    const startedIn = latestDrawioWorkspaceRef.current;
    const startedTransition = scenarioTransitionRef.current;
    try {
      const result = await openRuntimePackage(file, {
        packageIO,
        validateNormalized: packageValidator("normalized"),
        validateLayout: packageValidator("layout"),
        imageUrlHost: {
          createObjectURL: (blob) => URL.createObjectURL(blob),
          revokeObjectURL: (url) => URL.revokeObjectURL(url),
        },
      });
      if (latestDrawioWorkspaceRef.current !== startedIn ||
          scenarioTransitionRef.current !== startedTransition) {
        result.media?.release?.();
        setDiagnostics([{ severity: "error", code: "PACKAGE_OPEN_STALE_WORKSPACE", message: "Workspace changed during asynchronous package read. Package was not opened." }]);
        return;
      }
      if (hasPendingBuilderDrafts()) {
        result.media?.release?.();
        setDiagnostics([{ severity: "error", code: "PACKAGE_OPEN_LATE_UNAPPLIED_DRAFT",
          message: "Package opening was cancelled because unapplied Builder text appeared during the file read. Apply or revert it before replacing the workspace." }]);
        return;
      }
      setDiagnostics(result.diagnostics);
      if (result.ok) {
        // Imported Runtime is a new scenario generation. Old pending
        // callbacks must not mutate it after the asynchronous import.
        beginScenarioTransition();
        mediaRef.current = result.media ?? null;
        setRuntimeMedia(result.media ?? null);
        setWorkspace(result.workspace);
      }
    } catch (error) {
      setDiagnostics([{ severity: "error", code: "PACKAGE_OPEN_FAILED", message: error instanceof Error ? error.message : String(error) }]);
    }
  };

  const exportSource = () => {
    if (hasPendingBuilderDrafts()) {
      setDiagnostics([{ severity: "error", code: "BUILDER_EXPORT_UNAPPLIED_DRAFT",
        message: "Apply or revert pending form edits before exporting source JSON; the current canonical source does not contain those edits." }]);
      return;
    }
    // Export must reflect the latest committed source even if React has not
    // painted an Inspector Apply yet. Never silently download older JSON.
    const active = latestDrawioWorkspaceRef.current;
    if (active.mode !== "builder") return;
    downloadJson(createScenarioSourceDownload(active.source, `${active.source.scenarioId}.json`));
  };

  const exportProgress = () => {
    const active = latestDrawioWorkspaceRef.current;
    if (active.mode !== "runtime") return;
    downloadJson(createProgressDownload(active));
  };

  const exportTroubleshootingSession = async () => {
    if (workspace.mode !== "runtime") return;
    const origin = workspace, transition = scenarioTransitionRef.current;
    const result = await createTroubleshootingSessionDownload(workspace, notebook ?? undefined);
    if (!isCurrentRuntimeOperation(origin, transition)) return;
    setDiagnostics(result.diagnostics);
    if (result.ok) {
      if (result.notebook) setNotebook(result.notebook);
      downloadJson(result.descriptor);
    }
  };

  const loadTroubleshootingSession = async (file) => {
    if (!file || workspace.mode !== "runtime") return;
    const origin = workspace, transition = scenarioTransitionRef.current;
    const result = await loadTroubleshootingSessionFile(workspace, file, sessionValidators);
    if (!isCurrentRuntimeOperation(origin, transition)) return;
    setDiagnostics(result.diagnostics);
    if (result.ok) {
      setWorkspace(result.workspace);
      setNotebook(result.notebook ?? null);
      setDiagnostics([{ severity: "warning", code: "TROUBLESHOOTING_SESSION_FILE_RESTORED", message: "Runtime progress and Evidence Notebook restored atomically from the verified portable troubleshooting session." }]);
    }
  };

  const loadProgress = async (file) => {
    if (!file || workspace.mode !== "runtime") return;
    const origin = workspace, transition = scenarioTransitionRef.current;
    const result = await loadRuntimeProgressFile(workspace, file, packageValidator("save"));
    if (!isCurrentRuntimeOperation(origin, transition)) return;
    setDiagnostics(result.diagnostics);
    if (result.ok) setWorkspace(result.workspace);
  };

  const sessionValidators = {
    validateSession: packageValidator("troubleshootingSession"),
    validateSave: packageValidator("save"),
    validateNotebook: packageValidator("troubleshootingNotebook"),
  };

  const autosaveProgress = async () => {
    if (workspace.mode !== "runtime") return;
    const origin = workspace, transition = scenarioTransitionRef.current;
    if (!progressStore || !troubleshootingSessionStore) {
      setDiagnostics([{ severity: "error", code: "PROGRESS_AUTOSAVE_UNAVAILABLE", message: "IndexedDB is unavailable in this browser context. Export progress and notebook files for portable backup instead." }]);
      return;
    }
    const progressResult = await autosaveRuntimeProgress(workspace, progressStore);
    if (!isCurrentRuntimeOperation(origin, transition)) return;
    if (!progressResult.ok) { setDiagnostics(progressResult.diagnostics); return; }
    const sessionResult = await autosaveTroubleshootingSession(workspace, notebook ?? undefined, troubleshootingSessionStore);
    if (!isCurrentRuntimeOperation(origin, transition)) return;
    setDiagnostics(sessionResult.diagnostics);
    if (sessionResult.ok) {
      if (sessionResult.notebook) setNotebook(sessionResult.notebook);
      setDiagnostics([{ severity: "warning", code: "TROUBLESHOOTING_SESSION_AUTOSAVE_SAVED", message: "Runtime progress and Evidence Notebook were persisted together for this exact scenario hash. Portable exports remain available for backup." }]);
    }
  };

  const restoreAutosave = async () => {
    if (workspace.mode !== "runtime") return;
    const origin = workspace, transition = scenarioTransitionRef.current;
    if (!progressStore || !troubleshootingSessionStore) {
      setDiagnostics([{ severity: "error", code: "PROGRESS_AUTOSAVE_UNAVAILABLE", message: "IndexedDB is unavailable in this browser context." }]);
      return;
    }
    const sessionResult = await restoreAutosavedTroubleshootingSession(workspace, troubleshootingSessionStore, sessionValidators);
    if (!isCurrentRuntimeOperation(origin, transition)) return;
    if (sessionResult.ok) {
      setWorkspace(sessionResult.workspace);
      setNotebook(sessionResult.notebook ?? null);
      setDiagnostics([{ severity: "warning", code: "TROUBLESHOOTING_SESSION_AUTOSAVE_RESTORED", message: "Runtime progress and Evidence Notebook restored from the exact persisted troubleshooting session." }]);
      return;
    }
    const sessionMissing = sessionResult.diagnostics.some((item) => item.code === "TROUBLESHOOTING_SESSION_AUTOSAVE_NOT_FOUND");
    if (!sessionMissing) { setDiagnostics(sessionResult.diagnostics); return; }
    const result = await restoreAutosavedRuntimeProgress(workspace, progressStore, packageValidator("save"));
    if (!isCurrentRuntimeOperation(origin, transition)) return;
    setDiagnostics(result.diagnostics);
    if (result.ok) { setWorkspace(result.workspace); setNotebook(null); }
  };

  const clearAutosave = async () => {
    if (workspace.mode !== "runtime") return;
    const origin = workspace, transition = scenarioTransitionRef.current;
    if (!progressStore || !troubleshootingSessionStore) {
      setDiagnostics([{ severity: "error", code: "PROGRESS_AUTOSAVE_UNAVAILABLE", message: "IndexedDB is unavailable in this browser context." }]);
      return;
    }
    const progressResult = await clearAutosavedRuntimeProgress(workspace, progressStore);
    if (!isCurrentRuntimeOperation(origin, transition)) return;
    if (!progressResult.ok) { setDiagnostics(progressResult.diagnostics); return; }
    const sessionResult = await clearAutosavedTroubleshootingSession(workspace, troubleshootingSessionStore);
    if (!isCurrentRuntimeOperation(origin, transition)) return;
    setDiagnostics(sessionResult.diagnostics);
    if (sessionResult.ok) setDiagnostics([{ severity: "warning", code: "TROUBLESHOOTING_SESSION_AUTOSAVE_CLEARED", message: "Local Runtime progress and persisted Evidence Notebook session cleared for this scenario hash." }]);
  };

  const openGuidedLab = async (startRuntime) => {
    if (!projectGuardRef.current()) return;
    const launch = reserveGuardedScenarioLaunch();
    const isLiveLaunch = launch.isLive;
    const entry = builtinGuidedLabs.find((lab) => lab.id === guidedLabId);
    if (!entry) {
      if (isLiveLaunch()) setDiagnostics(guidedLabCatalog.diagnostics.length ? guidedLabCatalog.diagnostics : [{ severity: "error", code: "CURRICULUM_LAB_NOT_SELECTED", message: "Select a built-in guided lab first." }]);
      return;
    }
    let next = createBuilderWorkspace(cloneGuidedLabSource(entry));
    if (!startRuntime) {
      if (launch.publish(next)) {
        setDiagnostics([{ severity: "warning", code: "CURRICULUM_LAB_OPENED_IN_BUILDER", message: "Opened guided lab '" + entry.title + "' in Builder. Compile it before Runtime preview." }]);
      }
      return;
    }
    setBusy(true);
    try {
      next = await compileBuilderWorkspace(next, compilerOptions);
      if (!isLiveLaunch()) return;
      if (next.compile.status !== "valid") {
        if (launch.publish(next))
          setDiagnostics(next.compile.diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message })));
        return;
      }
      const layout = await autoLayoutBuilder(next, new ElkLayoutBackend());
      // A newer project, competing launch or newly typed unapplied form must
      // abort before changing the source, diagnostics or Runtime.
      if (!isLiveLaunch()) return;
      if (!layout.ok) {
        if (launch.publish(next)) setDiagnostics(layout.diagnostics);
        return;
      }
      next = layout.workspace;
      const runtime = previewRuntime(next);
      if (!isLiveLaunch()) return;
      if (launch.publish(runtime.ok ? runtime.workspace : next))
        setDiagnostics(runtime.diagnostics);
    } catch (error) {
      if (isLiveLaunch()) setDiagnostics([{ severity: "error", code: "CURRICULUM_LAB_SWITCH_FAILED", message: error instanceof Error ? error.message : String(error) }]);
    } finally {
      if (launch.mayFinishBusy()) setBusy(false);
    }
  };

  const openEnterpriseScenario = async (startRuntime) => {
    if (!projectGuardRef.current()) return;
    const launch = reserveGuardedScenarioLaunch();
    const isLiveLaunch = launch.isLive;
    const source = enterpriseScenarioById.get(enterpriseScenarioId);
    if (!source) return;
    let next = createBuilderWorkspace(structuredClone(source));
    if (!startRuntime) {
      if (launch.publish(next)) setDiagnostics([]);
      return;
    }
    setBusy(true);
    try {
      next = await compileBuilderWorkspace(next, compilerOptions);
      if (!isLiveLaunch()) return;
      if (next.compile.status !== "valid") {
        if (launch.publish(next))
          setDiagnostics(next.compile.diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message })));
        return;
      }
      const layout = await autoLayoutBuilder(next, new ElkLayoutBackend());
      if (!isLiveLaunch()) return;
      if (!layout.ok) {
        if (launch.publish(next)) setDiagnostics(layout.diagnostics);
        return;
      }
      next = layout.workspace;
      const runtime = previewRuntime(next);
      if (!isLiveLaunch()) return;
      if (launch.publish(runtime.ok ? runtime.workspace : next))
        setDiagnostics(runtime.diagnostics);
    } catch (error) {
      if (isLiveLaunch()) setDiagnostics([{ severity: "error", code: "ENTERPRISE_SCENARIO_SWITCH_FAILED", message: error instanceof Error ? error.message : String(error) }]);
    } finally {
      if (launch.mayFinishBusy()) setBusy(false);
    }
  };

  const openVerifiedDeliveryScenario = async (startRuntime) => {
    if (!projectGuardRef.current()) return;
    const launch = reserveGuardedScenarioLaunch();
    const isLiveLaunch = launch.isLive;
    const source = verifiedDeliveryScenarioById.get(verifiedDeliveryScenarioId);
    if (!source) return;
    let next = createBuilderWorkspace(structuredClone(source));
    if (!startRuntime) {
      if (launch.publish(next)) setDiagnostics([]);
      return;
    }
    setBusy(true);
    try {
      next = await compileBuilderWorkspace(next, compilerOptions);
      if (!isLiveLaunch()) return;
      if (next.compile.status !== "valid") {
        if (launch.publish(next))
          setDiagnostics(next.compile.diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message })));
        return;
      }
      const layout = await autoLayoutBuilder(next, new ElkLayoutBackend());
      if (!isLiveLaunch()) return;
      if (!layout.ok) {
        if (launch.publish(next)) setDiagnostics(layout.diagnostics);
        return;
      }
      next = layout.workspace;
      const runtime = previewRuntime(next);
      if (!isLiveLaunch()) return;
      // The verified-delivery screen epoch belongs only to a committed
      // handoff, never to an abandoned asynchronous lab switch.
      if (launch.publish(null, () => commitVerifiedDeliveryRuntime(runtime, next)))
        setDiagnostics(runtime.diagnostics);
    } catch (error) {
      if (isLiveLaunch()) setDiagnostics([{ severity: "error", code: "VERIFIED_DELIVERY_SCENARIO_SWITCH_FAILED", message: error instanceof Error ? error.message : String(error) }]);
    } finally {
      if (launch.mayFinishBusy()) setBusy(false);
    }
  };

  const exportPackage = async (distribution) => {
    const origin = latestDrawioWorkspaceRef.current;
    if (origin.mode !== "builder") return;
    // A verified compiled source does not imply that the visible Inspector
    // and JSON form inputs were applied. Never package only the old canonical
    // values while implying the exported package includes those edits.
    if (hasPendingBuilderDrafts()) {
      setDiagnostics([{ severity: "error", code: "PROJECT_PACKAGE_EXPORT_UNAPPLIED_DRAFT",
        message: "Apply or revert the pending Builder form text before exporting a package. No package was downloaded." }]);
      return;
    }
    const startedTransition = scenarioTransitionRef.current;
    const result = await buildBuilderPackageExport(origin, {
      packageIO,
      distribution,
      scenarioExtension: branding.scenarioExtension,
    });
    // Package serialization can await; both a replacement and an ordinary
    // in-place edit invalidate the original source identity. Also recheck
    // the project generation for a same-ID replacement with equal source.
    if (scenarioTransitionRef.current !== startedTransition ||
        latestDrawioWorkspaceRef.current !== origin) {
      setDiagnostics([{ severity: "error",
        code: "PROJECT_PACKAGE_EXPORT_STALE_WORKSPACE",
        message: "Builder changed while exporting; no outdated package was downloaded. Retry from the current source." }]);
      return;
    }
    // A draft can appear without changing the canonical workspace during
    // asynchronous package serialization; its text is still user data.
    if (hasPendingBuilderDrafts()) {
      setDiagnostics([{ severity: "error", code: "PROJECT_PACKAGE_EXPORT_LATE_UNAPPLIED_DRAFT",
        message: "An unapplied Builder form was edited while packaging. The stale package was not downloaded; Apply or revert the form first." }]);
      return;
    }
    setDiagnostics(result.diagnostics);
    if (result.ok) downloadBlob(result.descriptor.blob, result.descriptor.filename);
  };

  const backToBuilder = () => {
    const active = latestDrawioWorkspaceRef.current;
    if (active.mode !== "runtime") return;
    const source = active.source ?? welcomeScenario;
    const previous = lastBuilderWorkspaceRef.current;
    // Preserve editable topology, manual position overrides and the dirty flag
    // when returning from a preview of THIS exact Builder source.
    const resume = active.source && previous?.mode === "builder" &&
      previous.source === active.source
      ? previous : createBuilderWorkspace(source);
    // React can batch this state update. Invalidate in-flight Runtime file,
    // IndexedDB and evidence restores NOW, before their pending promises may
    // resolve in the same event task and resurrect the abandoned Runtime.
    beginScenarioTransition();
    setBusy(false);
    latestDrawioWorkspaceRef.current = resume;
    setWorkspace(resume);
  };
  const title = workspace.mode === "builder" ? workspace.source.metadata.title : workspace.scenario.metadata.title;
  // The curriculum selector is a launch choice, not proof that the current
  // workspace is that lab. Keep its selection available for the next launch,
  // but never render lab instructions over the welcome, an imported topology,
  // or another scenario.
  const activeScenarioId = workspace.mode === "builder" ? workspace.source.scenarioId : workspace.scenario.scenarioId;
  const selectedGuidedLab = builtinGuidedLabs.find((lab) =>
    lab.id === guidedLabId && lab.scenarioId === activeScenarioId);
  const evidenceWorkspace = activeJourney ? buildEvidenceWorkspace(activeJourney) : null;
  const troubleshootingTimeline = evidenceWorkspace ? buildTroubleshootingTimeline(evidenceWorkspace) : null;
  const selectedLabContract = selectedGuidedLab ? createPedagogicalLabContract(selectedGuidedLab) : null;
  const multiRunView = caseRunRecords.length ? compareSelectedRuns(caseRunRecords) : null;
  const renderableJourney = workspace.mode === "runtime"
    && activeJourney
    && activeJourney.scenarioHash === workspace.scenario.sourceHash
    && activeJourney.stateRevision === workspace.engineState.stateRevision
    ? activeJourney
    : null;
  const createCase = async () => {
    if (workspace.mode !== "builder") { setDiagnostics([{ severity: "error", code: "CASE_BUILDER_REQUIRED", message: "Skapa Case från den kanoniska källan i Byggläge." }]); return; }
    const created = await createTroubleshootingCase({ source: workspace.source, title: workspace.source.metadata.title, description: "Reproducerbart felsökningsfall från kanonisk scenario-källa." });
    setTroubleshootingCase(created); setCaseRunRecords([]); setExperimentBranches([]); setSelectedExperimentId(""); setExperimentChangeSets([]); setVerificationSuites([]); setVerificationRuns([]); setVariantMatrix(null); setSelectedMatrixRowId(""); setCaseWorkingRevision(0); setPromotionPreview(null); setPromotionState(null); setPromotionHistory([]); setDiagnostics([{ severity: "warning", code: "CASE_CREATED", message: "Case skapat från kanonisk source. Case-data är inte Engine truth." }]);
  };
  const addCaseNote = async () => { if (!troubleshootingCase) return; setTroubleshootingCase(await addTroubleshootingCaseNote(troubleshootingCase, "USER NOTE: ", false)); };
  const bookmarkCurrentEvidence = async () => { if (!troubleshootingCase || !evidenceWorkspace?.records[0]) return; setTroubleshootingCase(await addTroubleshootingBookmark(troubleshootingCase, "EVIDENCE", evidenceWorkspace.records[0].eventId, "Evidence event")); };
  const saveCaseRun = async () => { if (!troubleshootingCase || workspace.mode !== "runtime" || !evidenceWorkspace) return; const nextCase = await attachCaseRun(troubleshootingCase, evidenceWorkspace, workspace.sourceRevision); const run = nextCase.runs.find((item) => item.runId === `${evidenceWorkspace.scenarioHash}:${evidenceWorkspace.runtimeRevision}:${evidenceWorkspace.flowId}`); if (run) setCaseRunRecords((items) => [...items.filter((item) => item.run.runId !== run.runId), { run, evidence: evidenceWorkspace }]); setTroubleshootingCase(nextCase); };
  const resetCase = async () => { if (troubleshootingCase) setTroubleshootingCase(await resetTroubleshootingCase(troubleshootingCase)); };
  const exportCase = () => { if (troubleshootingCase) downloadJson({ filename: `${troubleshootingCase.caseId}.yadilab-case.json`, mime: "application/json", text: exportTroubleshootingCase(troubleshootingCase) }); };
  const exportDiagnosticSession = async () => { if (!troubleshootingCase) return; const session = await createSavedDiagnosticSession({ sessionId: troubleshootingCase.caseId, case: troubleshootingCase, runs: caseRunRecords, comparisons: multiRunView ? [multiRunView] : [] }); downloadJson({ filename: `${troubleshootingCase.caseId}.yadilab-session.json`, mime: "application/json", text: exportSavedDiagnosticSession(session) }); };
  const importDiagnosticSession = async (file) => { if (!file) return; const result = await importSavedDiagnosticSession(await file.text()); if (!result.ok) { setDiagnostics(result.diagnostics.map((message) => ({ severity: "error", code: "DIAGNOSTIC_SESSION_IMPORT_BLOCKED", message }))); return; } setTroubleshootingCase(result.session.case); setCaseRunRecords([...result.session.runs]); setDiagnostics([{ severity: "warning", code: "DIAGNOSTIC_SESSION_IMPORTED_ARCHIVED", message: "Saved Diagnostic Session opened as archived evidence; no archived runtime was activated." }]); };
  const reproduceCase = async () => {
    if (!troubleshootingCase || !projectGuardRef.current()) return;
    const startedIn = latestDrawioWorkspaceRef.current;
    setBusy(true);
    try {
      let working = createBuilderWorkspace(troubleshootingCase.startingSource);
      working = await compileBuilderWorkspace(working, compilerOptions);
      if (working.compile.status !== "valid") { setDiagnostics(working.compile.diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message }))); return; }
      const layout = await autoLayoutBuilder(working, new ElkLayoutBackend());
      if (!layout.ok) { setDiagnostics(layout.diagnostics); return; }
      const runtime = previewRuntime(layout.workspace);
      setDiagnostics(runtime.diagnostics);
      if (runtime.ok && latestDrawioWorkspaceRef.current === startedIn) { releaseMedia(); setWorkspace(runtime.workspace); setDiagnostics([{ severity: "warning", code: "CASE_REPRODUCTION_EXECUTED", message: "Reproduced via canonical source → validation → compiler → Engine. Archived outcome was not reused." }]); }
    } finally { setBusy(false); }
  };
  const selectedExperiment = experimentBranches.find((branch) => branch.experimentId === selectedExperimentId) ?? null;
  const createExperiment = async (forkSource) => {
    if (!troubleshootingCase) return;
    const branch = await forkExperimentFromCase({ value: troubleshootingCase, title: `Experiment ${experimentBranches.length + 1}`, forkSource });
    setExperimentBranches((items) => [...items, branch]); setSelectedExperimentId(branch.experimentId);
    setDiagnostics([{ severity: "warning", code: "EXPERIMENT_CREATED", message: `Experiment skapad från ${forkSource}. Ancestor source är immutable och working copy är isolerad.` }]);
  };
  const runExperiment = async () => {
    if (!selectedExperiment || !projectGuardRef.current()) return;
    const startedIn = latestDrawioWorkspaceRef.current;
    setBusy(true);
    try {
      let next = createBuilderWorkspace(selectedExperiment.workingSource);
      next = await compileBuilderWorkspace(next, compilerOptions);
      if (next.compile.status !== "valid") { setDiagnostics(next.compile.diagnostics.map((d) => ({ severity: d.severity, code: d.code, message: d.message }))); return; }
      const layout = await autoLayoutBuilder(next, new ElkLayoutBackend());
      if (!layout.ok) { setDiagnostics(layout.diagnostics); return; }
      const runtime = previewRuntime(layout.workspace);
      setDiagnostics(runtime.diagnostics);
      if (runtime.ok && latestDrawioWorkspaceRef.current === startedIn) {
        const tested = await markExperimentTested(selectedExperiment);
        if (latestDrawioWorkspaceRef.current !== startedIn) return;
        setExperimentBranches((items) => items.map((item) => item.experimentId === tested.experimentId ? tested : item));
        releaseMedia(); setWorkspace(runtime.workspace); setDiagnostics([{ severity: "warning", code: "EXPERIMENT_ENGINE_RUN", message: "Experiment run executed through canonical source → validation → compiler → Engine. Result is modeled Engine truth." }]);
      }
    } finally { setBusy(false); }
  };
  const resetExperiment = async () => {
    if (!selectedExperiment) return;
    const reset = await resetExperimentBranch(selectedExperiment);
    setExperimentBranches((items) => items.map((item) => item.experimentId === reset.experimentId ? reset : item));
    setDiagnostics([{ severity: "warning", code: "EXPERIMENT_RESET", message: "Experiment reset to its exact immutable ancestor source." }]);
  };
  const discardExperiment = async () => {
    if (!selectedExperiment) return;
    const archived = await discardExperimentBranch(selectedExperiment);
    setExperimentBranches((items) => items.filter((item) => item.experimentId !== archived.experimentId)); setSelectedExperimentId("");
    setDiagnostics([{ severity: "warning", code: "EXPERIMENT_DISCARDED", message: "Experiment discarded without changing the parent Case." }]);
  };
  const generateExperimentChangeSet = async () => {
    if (!selectedExperiment) return;
    const next = await generateChangeSet({ baseSource: selectedExperiment.ancestorSource, targetSource: selectedExperiment.workingSource, baseRevision: selectedExperiment.ancestorRevision, targetRevision: selectedExperiment.ancestorRevision + 1 });
    setExperimentChangeSets((items) => [...items.filter((item) => item.changeSetId !== next.changeSetId), next]);
    setDiagnostics([{ severity: "warning", code: "CHANGE_SET_GENERATED", message: `Change Set generated from canonical Diff (${next.sourceDiff.length} deterministic entries).` }]);
  };
  const createExperimentSuite = async () => {
    if (!selectedExperiment) return;
    const flowIds = selectedExperiment.workingSource.tests.map((item) => item.id);
    if (!flowIds.length) { setDiagnostics([{ severity: "error", code: "VERIFICATION_SUITE_NO_FLOWS", message: "No existing canonical flows are available in this scenario." }]); return; }
    const suite = await createVerificationSuite({ title: `Verification ${verificationSuites.length + 1}`, description: "User-defined expectations evaluated against normal Engine truth.", experimentId: selectedExperiment.experimentId, selectedFlowIds: flowIds, assertions: flowIds.map((flowId) => ({ assertionId: `assert-${flowId}`, flowId, type: "ENGINE_TEST_OUTCOME", expected: "SUCCESS" })) });
    setVerificationSuites((items) => [...items, suite]);
    setDiagnostics([{ severity: "warning", code: "VERIFICATION_SUITE_CREATED", message: `Verification Suite created with ${flowIds.length} existing flow expectations.` }]);
  };
  const createMatrixVariants = async () => {
    if (!troubleshootingCase) return;
    setBusy(true);
    try {
      let created = [...experimentBranches];
      while (created.length < 3) {
        const branch = await forkExperimentFromCase({ value: troubleshootingCase, title: "Matrix Variant", forkSource: "BASELINE" });
        const source = structuredClone(branch.workingSource);
        source.metadata = { ...source.metadata, description: `${source.metadata.description ?? ""} · What-If Matrix Variant ${created.length + 1}` };
        created.push(await replaceExperimentWorkingSource(branch, source));
      }
      setExperimentBranches(created); setSelectedExperimentId(created[0].experimentId);
      setDiagnostics([{ severity: "warning", code: "VARIANT_MATRIX_VARIANTS_CREATED", message: "Created explicit BASELINE ancestor plus three identity-bound experiment variants. Duplicate display titles remain distinct by experiment and source identity." }]);
    } catch (error) { setDiagnostics([{ severity: "error", code: "VARIANT_MATRIX_CREATE_FAILED", message: error instanceof Error ? error.message : String(error) }]); } finally { setBusy(false); }
  };
  const runExperimentSuite = async (againstAncestor) => {
    if (!selectedExperiment || !verificationSuites.at(-1)) return;
    const suite = verificationSuites.at(-1); const source = againstAncestor ? selectedExperiment.ancestorSource : selectedExperiment.workingSource; const sourceRevision = againstAncestor ? selectedExperiment.ancestorRevision : selectedExperiment.ancestorRevision + 1;
    const runner = { run: async (candidateSource, flowId, revision) => { let next = createBuilderWorkspace(candidateSource); next = await compileBuilderWorkspace(next, compilerOptions); if (next.compile.status !== "valid") throw new Error("VERIFICATION_COMPILE_FAILED"); const layout = await autoLayoutBuilder(next, new ElkLayoutBackend()); if (!layout.ok) throw new Error("VERIFICATION_LAYOUT_FAILED"); const runtime = previewRuntime(layout.workspace); if (!runtime.ok) throw new Error("VERIFICATION_ENGINE_FAILED"); const sourceIdentity = await computeCanonicalSourceIdentity(candidateSource); return { runId: `${sourceIdentity}:${revision}:${flowId}`, sourceIdentity, sourceRevision: revision, flowId, evaluation: runtime.workspace.evaluation }; } };
    setBusy(true); try { const run = await runVerificationSuite(suite, source, sourceRevision, runner); setVerificationRuns((items) => [...items, run]); setDiagnostics([{ severity: "warning", code: againstAncestor ? "VERIFICATION_ANCESTOR_RUN" : "VERIFICATION_EXPERIMENT_RUN", message: `Suite executed through canonical source → Validator → Compiler → Engine. ${run.summary.PASS} PASS · ${run.summary.FAIL} FAIL · ${run.summary.UNMODELED} UNMODELED.` }]); } catch (error) { setDiagnostics([{ severity: "error", code: "VERIFICATION_SUITE_FAILED", message: error instanceof Error ? error.message : String(error) }]); } finally { setBusy(false); }
  };
  const runVariantMatrix = async () => {
    const suite = verificationSuites.at(-1);
    if (!troubleshootingCase || !suite || experimentBranches.length < 3) return;
    const runner = { run: async (candidateSource, flowId, revision) => { let next = createBuilderWorkspace(candidateSource); next = await compileBuilderWorkspace(next, compilerOptions); if (next.compile.status !== "valid") throw new Error("VERIFICATION_COMPILE_FAILED"); const layout = await autoLayoutBuilder(next, new ElkLayoutBackend()); if (!layout.ok) throw new Error("VERIFICATION_LAYOUT_FAILED"); const runtime = previewRuntime(layout.workspace); if (!runtime.ok) throw new Error("VERIFICATION_ENGINE_FAILED"); const sourceIdentity = await computeCanonicalSourceIdentity(candidateSource); return { runId: `${sourceIdentity}:${revision}:${flowId}`, sourceIdentity, sourceRevision: revision, flowId, evaluation: runtime.workspace.evaluation }; } };
    setBusy(true);
    try {
      const ancestorSource = troubleshootingCase.startingSource;
      const ancestorIdentity = await computeCanonicalSourceIdentity(ancestorSource);
      const ancestorRun = await runVerificationSuite(suite, ancestorSource, 0, runner);
      const experiments = [];
      const allRuns = [ancestorRun];
      for (const branch of experimentBranches.slice(0, 3)) {
        const run = await runVerificationSuite(suite, branch.workingSource, branch.ancestorRevision + 1, runner);
        const changeSet = await generateChangeSet({ baseSource: branch.ancestorSource, targetSource: branch.workingSource, baseRevision: branch.ancestorRevision, targetRevision: branch.ancestorRevision + 1 });
        experiments.push({ variantId: branch.experimentId, experimentId: branch.experimentId, title: branch.title, sourceIdentity: branch.workingSourceIdentity, sourceRevision: branch.ancestorRevision + 1, changeSet, suiteRuns: [run] });
        allRuns.push(run);
      }
      const matrix = await buildVariantMatrix({ caseId: troubleshootingCase.caseId, suite, ancestor: { variantId: `ancestor:${ancestorIdentity.slice(0, 12)}`, title: "BASELINE / ANCESTOR", sourceIdentity: ancestorIdentity, sourceRevision: 0, suiteRuns: [ancestorRun] }, experiments });
      setVariantMatrix(matrix); setVerificationRuns(allRuns); setMatrixFilters({}); setSelectedMatrixRowId("");
      const summary = summarizeVariantMatrix(matrix);
      setDiagnostics([{ severity: "warning", code: "VARIANT_MATRIX_BUILT", message: `Matrix built from canonical Engine runs: ${summary.PASS} PASS · ${summary.FAIL} FAIL · ${summary.UNMODELED} UNMODELED · ${summary["NOT RUN"]} NOT RUN.` }]);
    } catch (error) { setDiagnostics([{ severity: "error", code: "VARIANT_MATRIX_RUN_FAILED", message: error instanceof Error ? error.message : String(error) }]); } finally { setBusy(false); }
  };
  const matrixRows = variantMatrix ? filterVariantMatrix(variantMatrix, matrixFilters) : [];
  const selectMatrixRow = (rowId) => {
    if (!variantMatrix) return;
    try { const selection = selectMatrixResult(variantMatrix, rowId); setSelectedMatrixRowId(rowId); const variant = variantById(variantMatrix, selection.variantId); if (variant.experimentId) setSelectedExperimentId(variant.experimentId); setDiagnostics([{ severity: "warning", code: "VARIANT_MATRIX_SELECTION", message: `${variant.title} · ${selection.assertionId} · run ${selection.runId ?? "not available"}. Opened as factual matrix selection.` }]); } catch (error) { setDiagnostics([{ severity: "error", code: "VARIANT_MATRIX_SELECTION_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); }
  };
  const createPromotionPreviewAction = async () => {
    if (!troubleshootingCase || !selectedExperiment) return;
    try {
      const changeSet = await generateChangeSet({ baseSource: troubleshootingCase.workingSource, targetSource: selectedExperiment.workingSource, baseRevision: caseWorkingRevision, targetRevision: caseWorkingRevision + 1 });
      const summary = variantMatrix ? summarizeVariantMatrix(variantMatrix) : undefined;
      const preview = await createPromotionPreview({ caseValue: troubleshootingCase, caseWorkingRevision, experiment: selectedExperiment, changeSet, ...(summary ? { suiteSummary: summary } : {}) });
      setPromotionPreview(preview); setPromotionState(null); setDiagnostics([{ severity: "warning", code: "PROMOTION_PREVIEW_CREATED", message: `Promotion Preview: CURRENT CASE WORKING COPY ${preview.targetWorkingSourceIdentity.slice(0, 12)}… → SELECTED EXPERIMENT ${preview.experimentSourceIdentity.slice(0, 12)}…. No Engine run was performed.` }]);
    } catch (error) { setDiagnostics([{ severity: "error", code: "PROMOTION_PREVIEW_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); }
  };
  const confirmPromotion = async () => {
    if (!promotionPreview || !troubleshootingCase || !selectedExperiment) return;
    try {
      const next = await promoteWithPreview({ preview: promotionPreview, caseValue: troubleshootingCase, caseWorkingRevision, experiment: selectedExperiment, history: promotionHistory });
      setTroubleshootingCase(next.caseValue); setCaseWorkingRevision(next.workingRevision); setPromotionState(next); setPromotionHistory([...next.history]); setPromotionPreview(next.preview); setDiagnostics([{ severity: "warning", code: "PROMOTION_COMPLETED", message: `PROMOTION completed as canonical source workflow: Case working copy now equals selected Experiment ${next.preview.experimentId}. No Engine outcome or Evidence was fabricated.` }]);
    } catch (error) { setDiagnostics([{ severity: "error", code: "PROMOTION_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); }
  };
  const rollbackPromotionAction = async () => {
    if (!promotionState) return;
    try {
      const next = await rollbackPromotion({ state: promotionState });
      setTroubleshootingCase(next.caseValue); setCaseWorkingRevision(next.workingRevision); setPromotionState(null); setPromotionPreview(null); setPromotionHistory([...next.history]); setDiagnostics([{ severity: "warning", code: "ROLLBACK_COMPLETED", message: `ROLLBACK completed to exact pre-promotion source identity ${next.snapshot.sourceIdentity}. No Engine outcome or Evidence was fabricated.` }]);
    } catch (error) { setDiagnostics([{ severity: "error", code: "ROLLBACK_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); }
  };
  const selectedBaseline = verifiedBaselines.find((item) => item.baselineId === selectedBaselineId) ?? null;
  const createVerifiedBaselineAction = async () => {
    if (!selectedExperiment) return;
    try {
      const baseline = await createVerifiedBaseline({ source: selectedExperiment.workingSource, title: selectedExperiment.title, description: "Immutable verified source snapshot from Experiment.", originType: "EXPERIMENT_SOURCE", originId: selectedExperiment.experimentId, createdSequence: verifiedBaselines.length + 1 });
      setVerifiedBaselines((items) => [...items, baseline]); setSelectedBaselineId(baseline.baselineId); setDiagnostics([{ severity: "warning", code: "VERIFIED_BASELINE_CREATED", message: `VERIFIED SNAPSHOT skapad från Experiment. Source identity ${baseline.canonicalSourceIdentity}. Ingen Engine-körning utfördes.` }]);
    } catch (error) { setDiagnostics([{ severity: "error", code: "VERIFIED_BASELINE_CREATE_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); }
  };
  const reproduceVerifiedBaselineAction = async () => {
    if (!selectedBaseline || !projectGuardRef.current()) return;
    const startedIn = latestDrawioWorkspaceRef.current;
    try {
      const result = await reproduceVerifiedBaseline(selectedBaseline, async (source) => {
        const compiled = await compileBuilderWorkspace(createBuilderWorkspace(source), compilerOptions);
        if (compiled.compile.status !== "valid") throw new Error("VERIFIED_BASELINE_REPRODUCTION_COMPILE_FAILED");
        const laidOut = await autoLayoutBuilder(compiled, new ElkLayoutBackend());
        if (!laidOut.ok) throw new Error("VERIFIED_BASELINE_REPRODUCTION_LAYOUT_FAILED");
        const runtime = previewRuntime(laidOut.workspace);
        return runtime.ok ? runtime.workspace : runtime;
      });
      if (result.ok && latestDrawioWorkspaceRef.current === startedIn) { setWorkspace(result.result); setDiagnostics([{ severity: "warning", code: "VERIFIED_BASELINE_REPRODUCED", message: `Baseline reproducerad via canonical source → validation → compiler → Engine. Arkiverat resultat återanvändes inte.` }]); }
      else setDiagnostics(result.diagnostics.map((message) => ({ severity: "error", code: "VERIFIED_BASELINE_REPRODUCTION_BLOCKED", message })));
    } catch (error) { setDiagnostics([{ severity: "error", code: "VERIFIED_BASELINE_REPRODUCTION_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); }
  };
  const exportVerifiedBaselineAction = () => { if (selectedBaseline) downloadJson({ filename: `${selectedBaseline.baselineId}.yadilab-baseline.json`, mime: "application/json", text: exportVerifiedBaseline(selectedBaseline) }); };
  const selectedCampaign = regressionCampaigns.find((item) => item.campaignId === selectedCampaignId) ?? null;
  const createRegressionCampaignAction = async () => {
    const suite = verificationSuites.at(-1);
    if (!selectedBaseline || !suite || !experimentBranches.length) { setDiagnostics([{ severity: "error", code: "REGRESSION_CAMPAIGN_CREATE_BLOCKED", message: "Create Baseline, Verification Suite and at least one Candidate Experiment first." }]); return; }
    try {
      const candidates = [];
      for (const branch of experimentBranches) candidates.push({ candidateId: branch.experimentId, title: branch.title, source: branch.workingSource, sourceIdentity: await computeCanonicalSourceIdentity(branch.workingSource) });
      const campaign = await createRegressionCampaign({ title: `Regression Campaign ${regressionCampaigns.length + 1}`, description: "Fresh baseline/candidate Engine truth comparison.", baseline: selectedBaseline, candidates, suite });
      setRegressionCampaigns((items) => [...items, campaign]); setSelectedCampaignId(campaign.campaignId); setDiagnostics([{ severity: "warning", code: "REGRESSION_CAMPAIGN_CREATED", message: `Campaign created with baseline first and ${candidates.length} deterministic candidates. No Engine run occurred during creation.` }]);
    } catch (error) { setDiagnostics([{ severity: "error", code: "REGRESSION_CAMPAIGN_CREATE_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); }
  };
  const runRegressionCampaignAction = async () => {
    if (!selectedCampaign) return;
    const runner = { run: async (candidateSource, flowId, revision) => { let next = createBuilderWorkspace(candidateSource); next = await compileBuilderWorkspace(next, compilerOptions); if (next.compile.status !== "valid") throw new Error("REGRESSION_CAMPAIGN_COMPILE_FAILED"); const layout = await autoLayoutBuilder(next, new ElkLayoutBackend()); if (!layout.ok) throw new Error("REGRESSION_CAMPAIGN_LAYOUT_FAILED"); const runtime = previewRuntime(layout.workspace); if (!runtime.ok) throw new Error("REGRESSION_CAMPAIGN_ENGINE_FAILED"); const sourceIdentity = await computeCanonicalSourceIdentity(candidateSource); return { runId: `${sourceIdentity}:${revision}:${flowId}`, sourceIdentity, sourceRevision: revision, flowId, evaluation: runtime.workspace.evaluation }; } };
    setBusy(true); try { const next = await runRegressionCampaign(selectedCampaign, runner); setRegressionCampaigns((items) => items.map((item) => item.campaignId === next.campaignId ? next : item)); setDiagnostics([{ severity: "warning", code: "REGRESSION_CAMPAIGN_COMPLETED", message: `Campaign complete: ${Object.entries(summarizeRegressionCampaign(next)).map(([subject, summary]) => `${subject} PASS ${summary.PASS ?? 0} · FAIL ${summary.FAIL ?? 0} · UNMODELED ${summary.UNMODELED ?? 0}`).join(" | ")}. Fresh Engine truth only.` }]); } catch (error) { setDiagnostics([{ severity: "error", code: "REGRESSION_CAMPAIGN_FAILED", message: error instanceof Error ? error.message : String(error) }]); } finally { setBusy(false); }
  };
  const exportRegressionCampaignAction = () => { if (selectedCampaign) downloadJson({ filename: `${selectedCampaign.campaignId}.yadilab-campaign.json`, mime: "application/json", text: exportRegressionCampaign(selectedCampaign) }); };
  const buildTransitionMatrixAction = async () => {
    if (!selectedCampaign) return;
    try { const matrix = await buildResultTransitionMatrix(selectedCampaign); setTransitionMatrix(matrix); setTransitionFilter(""); setDiagnostics([{ severity: "warning", code: "RESULT_TRANSITION_MATRIX_BUILT", message: `Transition Matrix built from factual baseline/candidate results. PASS→FAIL ${matrix.counts["PASS→FAIL"]} · FAIL→PASS ${matrix.counts["FAIL→PASS"]} · NOT COMPARABLE ${matrix.counts["NOT COMPARABLE"]}. No score or causal attribution.` }]); } catch (error) { setDiagnostics([{ severity: "error", code: "RESULT_TRANSITION_MATRIX_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); }
  };
  const createCampaignBundleAction = async () => {
    if (!selectedCampaign) return;
    try { const bundle = await createCampaignBundle(selectedCampaign); setCampaignBundle(bundle); setDiagnostics([{ severity: "warning", code: "CAMPAIGN_BUNDLE_CREATED", message: `Campaign Bundle created with ${bundle.archivedResults.length} archived/historical result runs. Import will require an explicit fresh rerun.` }]); } catch (error) { setDiagnostics([{ severity: "error", code: "CAMPAIGN_BUNDLE_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); }
  };
  const exportCampaignBundleAction = () => { if (campaignBundle) downloadJson({ filename: `${campaignBundle.identity}.yadilab-campaign-bundle.json`, mime: "application/json", text: exportCampaignBundle(campaignBundle) }); };
  const buildPromotionVerificationGateAction = async () => {
    if (!selectedCampaign || !selectedExperiment || !selectedBaseline) return;
    try { const gate = await createPromotionVerificationGate({ caseId: troubleshootingCase?.caseId ?? "builder-case", caseWorkingSourceIdentity: await computeCaseSourceIdentity(troubleshootingCase?.workingSource ?? selectedExperiment.workingSource), candidateId: selectedExperiment.experimentId, candidateSourceIdentity: await computeCanonicalSourceIdentity(selectedExperiment.workingSource), baselineId: selectedBaseline.baselineId, suiteIdentity: selectedCampaign.suite.identity, campaign: selectedCampaign }); setPromotionVerificationGate(gate); setDiagnostics([{ severity: "warning", code: "PROMOTION_VERIFICATION_GATE_BUILT", message: `Verification gate: ${gate.state}. This is factual evidence only; explicit Promotion confirmation remains required.` }]); } catch (error) { setDiagnostics([{ severity: "error", code: "PROMOTION_VERIFICATION_GATE_BLOCKED", message: error instanceof Error ? error.message : String(error) }]); }
  };
  const transitionRows = transitionMatrix ? filterResultTransitionMatrix(transitionMatrix, transitionFilter ? { transition: transitionFilter } : {}) : [];
  const topologyElement = e(Topology, { workspace, getWorkspace: () => latestDrawioWorkspaceRef.current,
    getPendingDraftChanges: hasPendingBuilderDrafts,
    projectGeneration: scenarioTransitionRef.current,
    getScenarioTransitionId: () => scenarioTransitionRef.current,
    setWorkspace, setDiagnostics, journey: renderableJourney, stateFocus: topologyStateFocus,
    scaledThousandFocus: scaledOfficeThousandFocus,
    scaledFiveThousandFocus: scaledOfficeFiveThousandFocus,
    scaledTenThousandFocus, scaledTenThousandSessionActive,
    scaledTenThousandFocusBusy, onScaledTenThousandFocusPage: showScaledTenThousandFocusPage,
    onReviewEditedTenThousandFocus: reviewEditedTenThousandBoundedFocus,
    scaledFiveThousandSessionActive: scaledOfficeFiveThousandSessionActive,
    scaledFiveThousandSafeCompileAttempted: scaledOfficeFiveThousandSafeCompileAttempted,
    onReviewEditedFiveThousandFocus: reviewEditedFiveThousandBoundedFocus,
    scaledFiveThousandFocusBusy: scaledOfficeFiveThousandFocusBusy,
    onScaledFiveThousandFocusPage: showScaledFiveThousandFocusPage,
    scaledThousandFocusBusy: scaledOfficeThousandFocusBusy,
    onScaledThousandFocusPage: showScaledThousandFocusPage,
    declaredOfficeHierarchy, declaredOfficeFocus, declaredOfficeFocusBusy,
    onFocusDeclaredOfficeHierarchy: showDeclaredOfficeHierarchyFocus,
    onRestoreDeclaredOfficeHierarchyFocus: restoreDeclaredOfficeHierarchyFocus,
    onReviewDeclaredOfficeHierarchy: () => setDeclaredOfficePanelOpen(true) });

  return e("div", { className: "app-frame", "data-app-runtime": "ready", "data-runtime-scenario-id": workspace.mode === "runtime" ? workspace.scenario.scenarioId : workspace.source.scenarioId, "data-runtime-scenario-hash": workspace.mode === "runtime" ? workspace.scenario.sourceHash : "builder" },
    e("header", { className: "app-header" },
      e("div", null, e("strong", null, branding.displayName), e("span", null, branding.tagline), e("small", { className: "build-version", "data-yadilab-build-version": releaseIdentity.version, "data-source-commit": releaseIdentity.sourceCommit, title: `Git ${releaseIdentity.sourceCommit}` }, `v${releaseIdentity.version} · ${releaseIdentity.sourceCommit.slice(0,12)}`), e("small", { "data-development-checkpoint": releaseIdentity.checkpoint }, `${releaseIdentity.checkpoint} · ${releaseIdentity.description}`)),
    ),
    e(MainActions, { onInspectStructuredXml: () => setStructuredXmlInspectionOpen(true), onInspectGraphml: () => setGraphmlPreviewOpen(true), onInspectNmap: () => setNmapObservationOpen(true), onInspectNmapReplay: () => setNmapReplayOpen(true), onInspectNessus: () => setNessusSeverityOpen(true), onInspectNessusReplay: () => setNessusReplayOpen(true),
      onInspectDrawio: () => setDrawioStructureOpen(true), onReviewDrawioBuilder: () => setDrawioBuilderReviewOpen(true), onInspectDrawioReplay: () => setDrawioReplayOpen(true), onInspectAnsible: () => setAnsibleInventoryOpen(true), onInspectAnsibleYamlReplay: () => setAnsibleYamlReplayOpen(true), onInspectAnsibleIni: () => setAnsibleIniOpen(true), onInspectAnsibleIniReplay: () => setAnsibleIniReplayOpen(true), onInspectDocx: () => setDocxStructureOpen(true), onReviewOfficeBuilder: () => setOfficeReviewedBuilderOpen(true), onReviewScaledOfficeBuilder: () => setScaledOfficeBuilderOpen(true), onReviewScaledOfficeThousandBuilder: () => setScaledOfficeThousandOpen(true), onReviewScaledOfficeFiveThousandBuilder: () => setScaledOfficeFiveThousandOpen(true), onReviewScaledOfficeTenThousandPreflight: () => setScaledOfficeTenThousandPreflightOpen(true), onReviewScaledOfficeTenThousandBuilder: () => setScaledOfficeTenThousandBuilderOpen(true), onInspectDocxReplay: () => setDocxReplayOpen(true), onInspectOdt: () => setOdtStructureOpen(true), onInspectOdtReplay: () => setOdtReplayOpen(true), onImportNetwork: () => setNetworkImportOpen(true), onImportNetworkFile: (file) => { setNetworkImportSelection({ file }); setNetworkImportOpen(true); }, workspace, busy, branding, enterpriseScenarioId, setEnterpriseScenarioId, enterpriseOfficeScenarios, openEnterpriseScenario, verifiedDeliveryScenarioId, setVerifiedDeliveryScenarioId, openVerifiedDeliveryScenario, guidedLabId, setGuidedLabId, builtinGuidedLabs, openGuidedLab, openSource, openPackage, compileAndLayout, preview, exportSource, exportPackage, exportProgress, loadProgress, exportTroubleshootingSession, loadTroubleshootingSession, autosaveProgress, restoreAutosave, clearAutosave, backToBuilder }),
    topologyElement,
    e(ProjectFileControls, {
      workspace, getWorkspace: () => latestDrawioWorkspaceRef.current,
      setWorkspace, onReplace: replaceProjectDocument,
      // Manual project documents may contain an intentionally empty New
      // draft. Compilation still uses the stricter runnable "source" schema.
      validateSource: source => validateContract("editableSource", source),
      setDiagnostics, beforeSwitchRef: projectGuardRef, busy,
      getPendingDraftChanges: hasPendingBuilderDrafts,
      pendingDraftCount: pendingBuilderDraftCount,
      getScenarioTransitionId: () => scenarioTransitionRef.current,
    }),
    e("section", { className: "mission-strip" }, e("strong", null, title)),
    selectedGuidedLab ? e("section", { className: "curriculum-strip", "data-curriculum-wave": "guided_troubleshooting_wave1" },
      e("div", null, e("strong", null, `Inbyggd guidad labb ${selectedGuidedLab.sequence}/8 · ${selectedGuidedLab.platform} · ${selectedGuidedLab.focus}`), e("span", null, selectedGuidedLab.summary)),
      selectedLabContract ? e("div", { className: "curriculum-contract", "data-pedagogical-lab-contract": selectedLabContract.id }, e("strong", null, selectedLabContract.objective), e("ol", null, ...selectedLabContract.instructions.map((instruction) => e("li", { key: instruction }, instruction))), e("details", null, e("summary", null, "Visa statiska ledtrådar"), e("ul", null, ...selectedLabContract.hints.map((hint) => e("li", { key: hint }, hint)))) ) : null,
      e("div", { className: "curriculum-difficulty", "aria-label": "Transparent difficulty dimensions" },
        e("span", null, `Lager ${selectedGuidedLab.difficulty.layers}`),
        e("span", null, `Beroendedjup ${selectedGuidedLab.difficulty.dependencyDepth}`),
        e("span", null, `Evidenssynlighet ${selectedGuidedLab.difficulty.evidenceVisibility}`),
        e("span", null, `Åtgärdsbegränsningar ${selectedGuidedLab.difficulty.remediationConstraints}`))) : null,
    networkImportOpen ? e(NetworkTopologyImportPanel, { compilerOptions, setDiagnostics,
      workspaceIdentity: workspace, getCurrentWorkspaceIdentity: () => latestDrawioWorkspaceRef.current,
      initialSelection: networkImportSelection, onClose: () => { setNetworkImportOpen(false); setNetworkImportSelection(null); }, onActivate: (next, openProbes, bounded) => {
        if (!projectGuardRef.current()) return;
        beginScenarioTransition();
        if(bounded){
          setScaledTenThousandSessionActive(true);
          setScaledTenThousandFocus({
            ...bounded.focus,source:next.source,model:next.compile.model,
            nodeOrder:bounded.nodeOrder,
            sourceKind:bounded.sourceKind,
            sourceOriginalSha256:bounded.sourceOriginalSha256,
            sourceModelHash:bounded.sourceModelHash
          });
        }
        setImportedProbeAutoOpen(Boolean(openProbes));
        setWorkspace(next);setNetworkImportOpen(false);setNetworkImportSelection(null);
      } }) : null,
    ansibleYamlReplayOpen ? e(AnsibleYamlSavedReferenceReplayPanel, {
      model: workspace.mode==="builder" ? {
        scenarioId:workspace.source.scenarioId,
        sourceRevision:workspace.sourceRevision,
        resources:workspace.source.resources.map(r=>({id:r.id,label:r.label})),
      } : null,
      onReplay: async (original,report,consent,isCurrent) => {
        const getCurrentModel=()=>{
          const live=latestDrawioWorkspaceRef.current;
          return live.mode==="builder" ? {
            scenarioId:live.source.scenarioId,
            sourceRevision:live.sourceRevision,
            resources:live.source.resources.map(r=>({id:r.id,label:r.label})),
          } : null;
        };
        return replayAnsibleYamlSavedReportFiles(original,report,getCurrentModel,consent,isCurrent);
      },
      onClose:()=>setAnsibleYamlReplayOpen(false),
    }) : null,
    ansibleInventoryOpen ? e(AnsibleInventoryPanel, {
      inspectFile: previewAnsibleYamlFileReadOnly,
      model: workspace.mode === "builder" ? {
        scenarioId: workspace.source.scenarioId,
        sourceRevision: workspace.sourceRevision,
        resources: workspace.source.resources.map(resource => ({ id: resource.id, label: resource.label })),
      } : null,
      onExportAssociation: async (originalFile,inventoryPreview,decision,isCurrent) => {
        const currentModel=()=>{
          const live=latestDrawioWorkspaceRef.current;
          return live.mode==="builder" ? {
            scenarioId:live.source.scenarioId,
            sourceRevision:live.sourceRevision,
            resources:live.source.resources.map(resource=>({
              id:resource.id,label:resource.label,
            })),
          } : null;
        };
        const sidecar=await reviewAnsibleYamlOriginalFileAssociations(
          originalFile,inventoryPreview,currentModel,decision,isCurrent);
        // No yield between the final live/generation gate and download.
        if(!isCurrent()){
          const error=new Error("ANSIBLE_YAML_ASSOC_STALE");
          error.code="ANSIBLE_YAML_ASSOC_STALE";throw error;
        }
        downloadJson({
          filename: `ansible-inventory-associations-${sidecar.source.sha256.slice(0,12)}.json`,
          mime:"application/json",
          text:JSON.stringify(sidecar,null,2),
        });
      },
      onClose: () => setAnsibleInventoryOpen(false),
    }) : null,
    odtStructureOpen ? e(OdtStructurePanel, {
      inspectFile: previewOdtFileStructure,
      reviewFile: reviewOdtFileCell,
      onBuildAssociation:(reviewedCell,decision)=>{
        const currentModel=workspace.mode==="builder"?{
          scenarioId:workspace.source.scenarioId,
          sourceRevision:workspace.sourceRevision,
          resources:workspace.source.resources.map(r=>({id:r.id,label:r.label})),
        }:null;
        const reviewed=reviewOdtCellAssociation(reviewedCell,currentModel,decision);
        if(reviewed.status!=="READY_FOR_EXPORT"||!reviewed.sidecar){
          const err=new Error("ODT_MULTI_ASSOC_BLOCKED");
          err.code=reviewed.diagnostics[0]?.code??"ODT_MULTI_ASSOC_BLOCKED";
          throw err;
        }
        return reviewed.sidecar;
      },
      onExportMulti:(staged,decision)=>{
        const currentModel=workspace.mode==="builder"?{
          scenarioId:workspace.source.scenarioId,
          sourceRevision:workspace.sourceRevision,
          resources:workspace.source.resources.map(r=>({id:r.id,label:r.label})),
        }:null;
        const reviewed=reviewOdtMultiReferences(staged,currentModel,decision);
        if(reviewed.status!=="READY_FOR_EXPORT"||!reviewed.sidecar){
          const err=new Error("ODT_MULTI_EXPORT_BLOCKED");
          err.code=reviewed.diagnostics[0]?.code??"ODT_MULTI_EXPORT_BLOCKED";
          throw err;
        }
        downloadJson({
          filename:"odt-reviewed-multi-"+reviewed.sidecar.source.sha256.slice(0,12)+".json",
          mime:"application/json",
          text:JSON.stringify(reviewed.sidecar,null,2),
        });
      },
      model: workspace.mode === "builder" ? {
        scenarioId:workspace.source.scenarioId,
        sourceRevision:workspace.sourceRevision,
        resources:workspace.source.resources.map(r=>({id:r.id,label:r.label})),
      } : null,
      onExportAssociation:(reviewedCell,decision)=>{
        // CURRENT Builder identity checked after original ODT is freshly reviewed.
        const currentModel=workspace.mode==="builder"?{
          scenarioId:workspace.source.scenarioId,
          sourceRevision:workspace.sourceRevision,
          resources:workspace.source.resources.map(r=>({id:r.id,label:r.label})),
        }:null;
        const review=reviewOdtCellAssociation(reviewedCell,currentModel,decision);
        if(review.status!=="READY_FOR_EXPORT" || !review.sidecar){
          const err=new Error("ODT_ASSOC_EXPORT_BLOCKED");
          err.code=review.diagnostics[0]?.code??"ODT_ASSOC_EXPORT_BLOCKED";
          throw err;
        }
        downloadJson({
          filename:"odt-reviewed-reference-"+review.sidecar.source.sha256.slice(0,12)+".json",
          mime:"application/json",
          text:JSON.stringify(review.sidecar,null,2),
        });
      },
      onClose: () => setOdtStructureOpen(false),
    }) : null,
    odtReplayOpen ? e(OdtReferenceReplayPanel, {
      model: workspace.mode === "builder" ? {
        scenarioId: workspace.source.scenarioId,
        sourceRevision: workspace.sourceRevision,
        resources: workspace.source.resources.map(r => ({ id: r.id, label: r.label })),
      } : null,
      onReplay: (odtFile, reportFile, acknowledged) => {
        const currentModel = workspace.mode === "builder" ? {
          scenarioId: workspace.source.scenarioId,
          sourceRevision: workspace.sourceRevision,
          resources: workspace.source.resources.map(r => ({ id: r.id, label: r.label })),
        } : null;
        return replaySavedOdtReportFiles(odtFile, reportFile, currentModel, acknowledged);
      },
      onClose: () => setOdtReplayOpen(false),
    }) : null,
    docxReplayOpen ? e(DocxReferenceReplayPanel, {
      model: workspace.mode === "builder" ? {
        scenarioId: workspace.source.scenarioId,
        sourceRevision: workspace.sourceRevision,
        resources: workspace.source.resources.map(r => ({ id: r.id, label: r.label })),
      } : null,
      onReplay: (docxFile, reportFile, acknowledged) => {
        const currentModel = workspace.mode === "builder" ? {
          scenarioId: workspace.source.scenarioId,
          sourceRevision: workspace.sourceRevision,
          resources: workspace.source.resources.map(r => ({ id: r.id, label: r.label })),
        } : null;
        return replaySavedDocxReportFiles(docxFile, reportFile, currentModel, acknowledged);
      },
      onClose: () => setDocxReplayOpen(false),
    }) : null,
    declaredOfficePanelOpen ? e(DeclaredOfficeSiteReviewPanel,{
      nodeIds:scaledOfficeThousandFocus?.nodeOrder??[],
      onClose:()=>setDeclaredOfficePanelOpen(false),
      onConfirm:async (userDeclaration,isCurrentSelection)=>{
        const blocked=code=>{const error=new Error(code);error.code=code;throw error;};
        const current=scaledOfficeThousandFocus;
        const active=latestDrawioWorkspaceRef.current;
        if(!current||active.mode!=="builder"||
           active.source!==current.source||active.compile.status!=="valid"||
           active.compile.model!==current.model||
           typeof current.sourceModelHash!=="string"||
           typeof current.sourceOriginalSha256!=="string")
          blocked("SCALE_P2B2_SOURCE_CHANGED");
        const epoch=scenarioTransitionRef.current;
        const snapshot=JSON.stringify(active);
        const check=()=>{
          const now=latestDrawioWorkspaceRef.current;
          if(scenarioTransitionRef.current!==epoch||now.mode!=="builder"||
             now.source!==current.source||now.compile.status!=="valid"||
             now.compile.model!==current.model||
             JSON.stringify(now)!==snapshot||
             typeof isCurrentSelection!=="function"||!isCurrentSelection())
            blocked("SCALE_P2B2_SOURCE_CHANGED");
        };
        check();
        const declaration={
          ...userDeclaration,
          sourceModelHash:current.sourceModelHash,
          sourceOriginalSha256:current.sourceOriginalSha256
        };
        const validated=await validateDeclaredOfficeSiteHierarchy(
          active.source,declaration,{
            sourceModelHash:current.sourceModelHash,
            sourceOriginalSha256:current.sourceOriginalSha256
          });
        check();
        if(validated.status!=="READY_FOR_PRESENTATION"||
           validated.canActivate!==false||validated.engineVerified!==false||
           validated.physicalTopologyVerified!==false)
          blocked("SCALE_P2B2_REVIEW_BLOCKED");
        restoreDeclaredOfficeHierarchyFocus();
        setDeclaredOfficeHierarchy({
          source:current.source,model:current.model,
          sourceRevision:active.sourceRevision,
          version:++declaredOfficeVersion.current,
          declaration,validated
        });
        setDeclaredOfficePanelOpen(false);
      }
    }):null,
    scaledOfficeTenThousandPreflightOpen ? e(ScaledOfficeTenThousandPreflightPanel, {
      inspectFile:async file=>{
        const blocked=code=>{const err=new Error(code);err.code=code;throw err;};
        if(!file||typeof file.name!=="string"||
           (!file.name.toLowerCase().endsWith(".docx")&&!file.name.toLowerCase().endsWith(".odt")||
            file.name.includes("/")||file.name.includes(String.fromCharCode(92))||
            file.name.includes(String.fromCharCode(0)))||
           typeof file.arrayBuffer!=="function"||
           (file.size!==undefined&&(!Number.isSafeInteger(file.size)||
             file.size<4||file.size>16*1024*1024)))
          blocked("SCALE_P4C3A_FILE_INVALID");
        const format=file.name.toLowerCase().endsWith(".docx")?"docx":"odt";
        const buf=await file.arrayBuffer();
        if(!(buf instanceof ArrayBuffer)||buf.byteLength<4||
           buf.byteLength>16*1024*1024)
          blocked("SCALE_P4C3A_FILE_INVALID");
        let preview;
        try{
          preview=format==="docx"
            ?await previewDocxTableStructure(new Uint8Array(buf),{
              capacityProfile:DOCX_S3_PROFILE})
            :await previewOdtTableStructure(new Uint8Array(buf),{
              capacityProfile:ODT_S3_PROFILE});
        }catch{blocked("SCALE_P4C3A_SOURCE_BLOCKED");}
        if(preview.status!=="REVIEW_REQUIRED"||preview.textIncluded!==false||
           preview.canActivate!==false||preview.engineVerified!==false||
           preview.physicalTopologyVerified!==false||
           preview.tables?.[0]?.rows.length!==10001||
           preview.tables?.[1]?.rows.length!==10001)
          blocked("SCALE_P4C3A_SOURCE_BLOCKED");
        return {format,preview};
      },
      onClose:()=>setScaledOfficeTenThousandPreflightOpen(false),
      onConfirm:async (expected,decision,file,isCurrentSelection)=>{
        const blocked=code=>{const err=new Error(code);err.code=code;throw err;};
        const active=latestDrawioWorkspaceRef.current;
        if(active.mode!=="builder")blocked("SCALE_P4C3A_BUILDER_REQUIRED");
        const initialIdentity=JSON.stringify(active);
        const transition=scenarioTransitionRef.current;
        const current=()=>{
          if(scenarioTransitionRef.current!==transition||
             latestDrawioWorkspaceRef.current.mode!=="builder"||
             JSON.stringify(latestDrawioWorkspaceRef.current)!==initialIdentity)
            blocked("SCALE_P4C3A_BUILDER_CHANGED");
          if(typeof isCurrentSelection!=="function"||!isCurrentSelection())
            blocked("SCALE_P4C3A_CONSENT_REVOKED");
        };
        const readOriginal=async()=>{
          current();
          const buf=await file.arrayBuffer();
          current();
          if(!(buf instanceof ArrayBuffer)||buf.byteLength<4||
             buf.byteLength>16*1024*1024)
            blocked("SCALE_P4C3A_SOURCE_CHANGED");
          const original=new Uint8Array(buf);
          let preview;
          try{
            preview=expected.format==="docx"
              ?await previewDocxTableStructure(original,{
                capacityProfile:DOCX_S3_PROFILE})
              :await previewOdtTableStructure(original,{
                capacityProfile:ODT_S3_PROFILE});
          }catch{blocked("SCALE_P4C3A_SOURCE_BLOCKED");}
          current();
          if(preview.sourceSha256!==expected.preview.sourceSha256||
             preview.sourceSha256!==decision.sourceSha256||
             preview.tables?.[0]?.rows.length!==10001||
             preview.tables?.[1]?.rows.length!==10001)
            blocked("SCALE_P4C3A_SOURCE_CHANGED");
          return original;
        };
        const original=await readOriginal();
        current();
        let candidate;
        try{candidate=await mapReviewedOfficeBatchesV3ToSource(original,decision);}
        catch(cause){
          if(typeof cause?.code==="string"&&/^SCALE_P1B[12]_[A-Z0-9_]+$/.test(cause.code))
            blocked(cause.code);
          blocked("SCALE_P4C3A_MAPPING_BLOCKED");
        }
        current();
        if(candidate.status!=="READY_FOR_COMPILATION"||
           candidate.canActivate!==false||candidate.engineVerified!==false||
           candidate.physicalTopologyVerified!==false||
           candidate.sourceSha256!==decision.sourceSha256||
           candidate.source.resources.length!==10000||
           candidate.source.connections.length!==10000||
           candidate.origins.nodes.length!==10000||
           candidate.origins.links.length!==10000||
           candidate.source.tests.length!==0)
          blocked("SCALE_P4C3A_MAPPING_BLOCKED");
        let compiled;
        try{
          compiled=await compileBuilderWorkspace(
            createBuilderWorkspace(candidate.source),compilerOptions);
        }catch{blocked("SCALE_P4C3A_COMPILE_BLOCKED");}
        current();
        if(compiled.compile.status!=="valid"||
           compiled.compile.model.resources.length!==10000||
           compiled.compile.model.connections.length!==10000||
           compiled.source.resources.length!==10000||
           compiled.source.connections.length!==10000)
          blocked("SCALE_P4C3A_COMPILE_BLOCKED");
        // A second independent read after every async mapping and compiler
        // step prevents stale File mutation. Never copy into active Builder.
        const latest=await file.arrayBuffer();
        current();
        if(!(latest instanceof ArrayBuffer)||latest.byteLength!==original.byteLength)
          blocked("SCALE_P4C3A_SOURCE_CHANGED");
        const latestHash=Array.from(new Uint8Array(await globalThis.crypto.subtle.digest(
          "SHA-256",latest)),b=>b.toString(16).padStart(2,"0")).join("");
        current();
        if(latestHash!==decision.sourceSha256)
          blocked("SCALE_P4C3A_SOURCE_CHANGED");
        current();
        return Object.freeze({
          status:"SOURCE_ONLY_NOT_ACTIVATED",
          sourceSha256:decision.sourceSha256,
          originalDevices:10000,originalPortLinks:10000,
          canActivate:false,engineVerified:false,physicalTopologyVerified:false
        });
      }
    }):null,
    scaledOfficeTenThousandBuilderOpen ? e(ScaledOfficeTenThousandBuilderPanel, {
      inspectFile:async file=>{
        const blocked=code=>{const err=new Error(code);err.code=code;throw err;};
        if(!file||typeof file.name!=="string"||
           (!file.name.toLowerCase().endsWith(".docx")&&!file.name.toLowerCase().endsWith(".odt")||
            file.name.includes("/")||file.name.includes(String.fromCharCode(92))||
            file.name.includes(String.fromCharCode(0)))||
           typeof file.arrayBuffer!=="function"||
           (file.size!==undefined&&(!Number.isSafeInteger(file.size)||
             file.size<4||file.size>16*1024*1024)))
          blocked("SCALE_P4C3B_FILE_INVALID");
        const format=file.name.toLowerCase().endsWith(".docx")?"docx":"odt";
        const buf=await file.arrayBuffer();
        if(!(buf instanceof ArrayBuffer)||buf.byteLength<4||
           buf.byteLength>16*1024*1024)
          blocked("SCALE_P4C3B_FILE_INVALID");
        let preview;
        try{
          preview=format==="docx"
            ?await previewDocxTableStructure(new Uint8Array(buf),{
              capacityProfile:DOCX_S3_PROFILE})
            :await previewOdtTableStructure(new Uint8Array(buf),{
              capacityProfile:ODT_S3_PROFILE});
        }catch{blocked("SCALE_P4C3B_SOURCE_BLOCKED");}
        if(preview.status!=="REVIEW_REQUIRED"||preview.textIncluded!==false||
           preview.canActivate!==false||preview.engineVerified!==false||
           preview.physicalTopologyVerified!==false||
           preview.tables?.[0]?.rows.length!==10001||
           preview.tables?.[1]?.rows.length!==10001)
          blocked("SCALE_P4C3B_SOURCE_BLOCKED");
        return {format,preview};
      },
      onClose:()=>setScaledOfficeTenThousandBuilderOpen(false),
      onConfirm:async (expected,decision,file,isCurrentSelection)=>{
        const blocked=code=>{const err=new Error(code);err.code=code;throw err;};
        const active=latestDrawioWorkspaceRef.current;
        if(active.mode!=="builder")blocked("SCALE_P4C3B_BUILDER_REQUIRED");
        const initialIdentity=JSON.stringify(active);
        const transition=scenarioTransitionRef.current;
        const current=()=>{
          if(scenarioTransitionRef.current!==transition||
             latestDrawioWorkspaceRef.current.mode!=="builder"||
             JSON.stringify(latestDrawioWorkspaceRef.current)!==initialIdentity)
            blocked("SCALE_P4C3B_BUILDER_CHANGED");
          if(typeof isCurrentSelection!=="function"||!isCurrentSelection())
            blocked("SCALE_P4C3B_CONSENT_REVOKED");
        };
        const readOriginal=async()=>{
          current();
          const buf=await file.arrayBuffer();
          current();
          if(!(buf instanceof ArrayBuffer)||buf.byteLength<4||
             buf.byteLength>16*1024*1024)
            blocked("SCALE_P4C3B_SOURCE_CHANGED");
          const original=new Uint8Array(buf);
          let preview;
          try{
            preview=expected.format==="docx"
              ?await previewDocxTableStructure(original,{
                capacityProfile:DOCX_S3_PROFILE})
              :await previewOdtTableStructure(original,{
                capacityProfile:ODT_S3_PROFILE});
          }catch{blocked("SCALE_P4C3B_SOURCE_BLOCKED");}
          current();
          if(preview.sourceSha256!==expected.preview.sourceSha256||
             preview.sourceSha256!==decision.sourceSha256||
             preview.tables?.[0]?.rows.length!==10001||
             preview.tables?.[1]?.rows.length!==10001)
            blocked("SCALE_P4C3B_SOURCE_CHANGED");
          return original;
        };
        const original=await readOriginal();
        current();
        let candidate;
        try{candidate=await mapReviewedOfficeBatchesV3ToSource(original,decision);}
        catch(cause){
          if(typeof cause?.code==="string"&&/^SCALE_P1B[12]_[A-Z0-9_]+$/.test(cause.code))
            blocked(cause.code);
          blocked("SCALE_P4C3B_MAPPING_BLOCKED");
        }
        current();
        if(candidate.status!=="READY_FOR_COMPILATION"||
           candidate.canActivate!==false||candidate.engineVerified!==false||
           candidate.physicalTopologyVerified!==false||
           candidate.sourceSha256!==decision.sourceSha256||
           candidate.source.resources.length!==10000||
           candidate.source.connections.length!==10000||
           candidate.origins.nodes.length!==10000||
           candidate.origins.links.length!==10000||
           candidate.source.tests.length!==0)
          blocked("SCALE_P4C3B_MAPPING_BLOCKED");
        let compiled;
        try{
          compiled=await compileBuilderWorkspace(
            createBuilderWorkspace(candidate.source),compilerOptions);
        }catch{blocked("SCALE_P4C3B_COMPILE_BLOCKED");}
        current();
        if(compiled.compile.status!=="valid"||
           compiled.compile.model.resources.length!==10000||
           compiled.compile.model.connections.length!==10000||
           compiled.source.resources.length!==10000||
           compiled.source.connections.length!==10000)
          blocked("SCALE_P4C3B_COMPILE_BLOCKED");
        // Only original source IDs, original port endpoints and exactly
        // 100 original device rows enter the first ELK/ReactFlow projection.
        const nodeOrder=candidate.origins.nodes.map(origin=>origin.nodeId);
        if(new Set(nodeOrder).size!==10000)
          blocked("SCALE_P4C3B_SOURCE_ORDER_BLOCKED");
        let firstFocus;
        try{
          firstFocus=await buildScaledOfficeTenThousandFocus(
            compiled.compile.model,nodeOrder,1);
        }catch{blocked("SCALE_P4C3B_FOCUS_BLOCKED");}
        current();
        if(firstFocus.page!==1||firstFocus.pageCount!==100||
           firstFocus.canonicalNodes!==10000||
           firstFocus.canonicalLinks!==10000||
           firstFocus.focusedNodes>116||firstFocus.focusedEdges>250)
          blocked("SCALE_P4C3B_FOCUS_BLOCKED");

        // Re-read the SAME original ZIP after every compiler and bounded ELK
        // yield; independently re-map and compare full canonical/source row
        // provenance. Source identity and active Builder may not drift.
        const latest=await file.arrayBuffer();
        current();
        if(!(latest instanceof ArrayBuffer)||latest.byteLength!==original.byteLength)
          blocked("SCALE_P4C3B_SOURCE_CHANGED");
        const latestHash=Array.from(new Uint8Array(await globalThis.crypto.subtle.digest(
          "SHA-256",latest)),b=>b.toString(16).padStart(2,"0")).join("");
        current();
        if(latestHash!==decision.sourceSha256||
           latestHash!==expected.preview.sourceSha256)
          blocked("SCALE_P4C3B_SOURCE_CHANGED");
        let verified;
        try{verified=await mapReviewedOfficeBatchesV3ToSource(
          new Uint8Array(latest),decision);}
        catch{blocked("SCALE_P4C3B_SOURCE_CHANGED");}
        current();
        if(verified.status!=="READY_FOR_COMPILATION"||
           verified.sourceSha256!==candidate.sourceSha256||
           JSON.stringify(verified.source)!==JSON.stringify(candidate.source)||
           JSON.stringify(verified.origins)!==JSON.stringify(candidate.origins))
          blocked("SCALE_P4C3B_SOURCE_CHANGED");
        const sourceText=JSON.stringify(compiled.source);
        const sourceDigest=await globalThis.crypto.subtle.digest(
          "SHA-256",new TextEncoder().encode(sourceText));
        current();
        const sourceModelHash=Array.from(new Uint8Array(sourceDigest),
          b=>b.toString(16).padStart(2,"0")).join("");
        current(); // no await between final live/consent gate and activation
        if (!projectGuardRef.current()) return;
        beginScenarioTransition();
        setScaledTenThousandSessionActive(true);
        setScaledTenThousandFocus({
          ...firstFocus,source:compiled.source,model:compiled.compile.model,
          nodeOrder,sourceKind:"office-p4c3b",
          sourceOriginalSha256:verified.sourceSha256,sourceModelHash
        });
        setScaledTenThousandFocusBusy(false);
        setImportedProbeAutoOpen(false);
        setDiagnostics([{
          severity:"warning",code:"SCALE_P4C3B_SOURCE_NOT_PHYSICAL",
          message:"Editable Builder has 10,000 original DOCX/ODT devices and 10,000 exact declared port-linked references. Only 100 original row devices per bounded page are drawn; no physical network or Engine truth is verified."
        }]);
        setWorkspace(compiled);
        setScaledOfficeTenThousandBuilderOpen(false);
        return Object.freeze({
          status:"BUILDER_ACTIVATED",sourceSha256:verified.sourceSha256,
          originalDevices:10000,originalPortLinks:10000,
          engineVerified:false,physicalTopologyVerified:false
        });
      }
    }):null,
    scaledOfficeFiveThousandOpen ? e(ScaledOfficeFiveThousandBuilderPanel, {
      inspectFile: async file => {
        const blocked=code=>{const error=new Error(code);error.code=code;throw error;};
        if(!file||typeof file.name!=="string"||
           !/^[^/\\\0]+\.(?:docx|odt)$/i.test(file.name)||
           typeof file.arrayBuffer!=="function"||
           (file.size!==undefined&&(!Number.isSafeInteger(file.size)||
             file.size<4||file.size>16*1024*1024)))
          blocked("SCALE_P3C2_FILE_INVALID");
        const format=/\.docx$/i.test(file.name)?"docx":"odt";
        const buffer=await file.arrayBuffer();
        if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<4||
           buffer.byteLength>16*1024*1024)
          blocked("SCALE_P3C2_FILE_INVALID");
        const original=new Uint8Array(buffer);
        const preview=format==="docx"
          ?await previewDocxTableStructure(original,{capacityProfile:DOCX_S2_PROFILE})
          :await previewOdtTableStructure(original,{capacityProfile:ODT_S2_PROFILE});
        if(preview.status!=="REVIEW_REQUIRED"||preview.textIncluded!==false||
           preview.canActivate!==false||preview.engineVerified!==false||
           preview.physicalTopologyVerified!==false)
          blocked("SCALE_P3C2_PREVIEW_BLOCKED");
        return {format,preview};
      },
      onClose:()=>setScaledOfficeFiveThousandOpen(false),
      onConfirm:async (expected,decision,file,isCurrentSelection)=>{
        const blocked=code=>{const err=new Error(code);err.code=code;throw err;};
        const active=latestDrawioWorkspaceRef.current;
        if(active.mode!=="builder")blocked("SCALE_P3C2_BUILDER_REQUIRED");
        const initialIdentity=JSON.stringify(active);
        const transition=scenarioTransitionRef.current;
        const current=()=>{
          if(scenarioTransitionRef.current!==transition||
             latestDrawioWorkspaceRef.current.mode!=="builder"||
             JSON.stringify(latestDrawioWorkspaceRef.current)!==initialIdentity)
            blocked("SCALE_P3C2_BUILDER_CHANGED");
          if(typeof isCurrentSelection!=="function"||!isCurrentSelection())
            blocked("SCALE_P3C2_CONSENT_REVOKED");
        };
        const reread=async()=>{
          current();
          const buffer=await file.arrayBuffer();
          current();
          if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<4||
             buffer.byteLength>16*1024*1024)
            blocked("SCALE_P3C2_SOURCE_CHANGED");
          const original=new Uint8Array(buffer);
          let preview;
          try{
            preview=expected.format==="docx"
              ?await previewDocxTableStructure(original,{capacityProfile:DOCX_S2_PROFILE})
              :await previewOdtTableStructure(original,{capacityProfile:ODT_S2_PROFILE});
          }catch{blocked("SCALE_P3C2_SOURCE_BLOCKED");}
          current();
          if(JSON.stringify(preview)!==JSON.stringify(expected.preview)||
             preview.sourceSha256!==decision.sourceSha256)
            blocked("SCALE_P3C2_SOURCE_CHANGED");
          return original;
        };
        const original=await reread();
        let candidate;
        try{candidate=await mapReviewedOfficeBatchesToSource(original,decision);}
        catch(cause){
          if(typeof cause?.code==="string"&&/^SCALE_P1B[12]_[A-Z0-9_]+$/.test(cause.code))
            blocked(cause.code);
          blocked("SCALE_P3C2_MAPPING_BLOCKED");
        }
        current();
        if(candidate.status!=="READY_FOR_COMPILATION"||
           candidate.canActivate!==false||candidate.engineVerified!==false||
           candidate.physicalTopologyVerified!==false||
           candidate.sourceSha256!==decision.sourceSha256||
           candidate.source.resources.length!==5000||
           candidate.source.connections.length!==5000||
           candidate.source.tests.length!==0||
           candidate.origins.nodes.length!==5000||
           candidate.origins.links.length!==5000)
          blocked("SCALE_P3C2_SOURCE_CANDIDATE_BLOCKED");
        const compiled=await compileBuilderWorkspace(
          createBuilderWorkspace(candidate.source),compilerOptions);
        current();
        if(compiled.compile.status!=="valid"||
           compiled.compile.model.resources.length!==5000||
           compiled.compile.model.connections.length!==5000)
          blocked("SCALE_P3C2_COMPILE_BLOCKED");
        const nodeOrder=candidate.origins.nodes.map(o=>o.nodeId);
        // Rehash the actual full compiled Builder source independently of any
        // user-provided sidecar or untrusted Office document field.
        const originalText=JSON.stringify(compiled.source);
        const digest=new Uint8Array(await globalThis.crypto.subtle.digest(
          "SHA-256",new TextEncoder().encode(originalText)));
        const sourceModelHash=Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
        current();
        const firstFocus=await buildScaledOfficeFiveThousandFocus(
          compiled.compile.model,nodeOrder,1);
        current();
        const fresh=await reread();
        let verified;
        try{verified=await mapReviewedOfficeBatchesToSource(fresh,decision);}
        catch{blocked("SCALE_P3C2_SOURCE_CHANGED");}
        current();
        if(verified.sourceSha256!==candidate.sourceSha256||
           JSON.stringify(verified.source)!==JSON.stringify(candidate.source)||
           JSON.stringify(verified.origins)!==JSON.stringify(candidate.origins))
          blocked("SCALE_P3C2_SOURCE_CHANGED");
        current(); // Never await between last workspace check and replacement.
        if (!projectGuardRef.current()) return;
        beginScenarioTransition();
        scaledOfficeFiveThousandFocusEpoch.current++;
        setImportedProbeAutoOpen(false);
        setDiagnostics([{
          severity:"warning",
          code:"SCALE_P3C2_MODELED_NOT_PHYSICAL",
          message:"Original DOCX/ODT has 5,000 reviewed devices and 5000 explicit port-linked references; only a bounded source-row view is displayed. No physical/Engine truth was inferred."
        }]);
        restoreDeclaredOfficeHierarchyFocus();
        setScaledOfficeThousandFocus(null);
        setDeclaredOfficeHierarchy(null);
        setDeclaredOfficePanelOpen(false);
        // Existing independent 1,000-view remains untouched; new 5k view has
        // its own exact source/model identity and bounded focus epoch.
        setScaledOfficeFiveThousandSessionActive(true);
        setScaledOfficeFiveThousandFocus({
          source:compiled.source,model:compiled.compile.model,nodeOrder,
          sourceModelHash,sourceOriginalSha256:verified.sourceSha256,
          ...firstFocus
        });
        setScaledOfficeFiveThousandFocusBusy(false);
        setWorkspace(compiled);
        setScaledOfficeFiveThousandOpen(false);
      },
    }) : null,
    scaledOfficeThousandOpen ? e(ScaledOfficeThousandBuilderPanel, {
      inspectFile: async file => {
        const blocked=code=>{const error=new Error(code);error.code=code;throw error;};
        if(!file||typeof file.name!=="string"||
           !/^[^/\\\0]+\.(?:docx|odt)$/i.test(file.name)||
           typeof file.arrayBuffer!=="function"||
           (file.size!==undefined&&(!Number.isSafeInteger(file.size)||
             file.size<4||file.size>16*1024*1024)))
          blocked("SCALE_P2B1_FILE_INVALID");
        const format=/\.docx$/i.test(file.name)?"docx":"odt";
        const buffer=await file.arrayBuffer();
        if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<4||
           buffer.byteLength>16*1024*1024)
          blocked("SCALE_P2B1_FILE_INVALID");
        const original=new Uint8Array(buffer);
        const preview=format==="docx"
          ?await previewDocxTableStructure(original,{capacityProfile:DOCX_LARGE_PROFILE})
          :await previewOdtTableStructure(original,{capacityProfile:ODT_LARGE_PROFILE});
        if(preview.status!=="REVIEW_REQUIRED"||preview.textIncluded!==false||
           preview.canActivate!==false||preview.engineVerified!==false||
           preview.physicalTopologyVerified!==false)
          blocked("SCALE_P2B1_PREVIEW_BLOCKED");
        return {format,preview};
      },
      onClose:()=>setScaledOfficeThousandOpen(false),
      onConfirm:async (expected,decision,file,isCurrentSelection)=>{
        const blocked=code=>{const err=new Error(code);err.code=code;throw err;};
        const active=latestDrawioWorkspaceRef.current;
        if(active.mode!=="builder")blocked("SCALE_P2B1_BUILDER_REQUIRED");
        const initialIdentity=JSON.stringify(active);
        const transition=scenarioTransitionRef.current;
        const current=()=>{
          if(scenarioTransitionRef.current!==transition||
             latestDrawioWorkspaceRef.current.mode!=="builder"||
             JSON.stringify(latestDrawioWorkspaceRef.current)!==initialIdentity)
            blocked("SCALE_P2B1_BUILDER_CHANGED");
          if(typeof isCurrentSelection!=="function"||!isCurrentSelection())
            blocked("SCALE_P2B1_CONSENT_REVOKED");
        };
        const reread=async()=>{
          current();
          const buffer=await file.arrayBuffer();
          current();
          if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<4||
             buffer.byteLength>16*1024*1024)
            blocked("SCALE_P2B1_SOURCE_CHANGED");
          const original=new Uint8Array(buffer);
          let preview;
          try{
            preview=expected.format==="docx"
              ?await previewDocxTableStructure(original,{capacityProfile:DOCX_LARGE_PROFILE})
              :await previewOdtTableStructure(original,{capacityProfile:ODT_LARGE_PROFILE});
          }catch{blocked("SCALE_P2B1_SOURCE_BLOCKED");}
          current();
          if(JSON.stringify(preview)!==JSON.stringify(expected.preview)||
             preview.sourceSha256!==decision.sourceSha256)
            blocked("SCALE_P2B1_SOURCE_CHANGED");
          return original;
        };
        const original=await reread();
        let candidate;
        try{candidate=await mapReviewedOfficeBatchesToSource(original,decision);}
        catch(cause){
          if(typeof cause?.code==="string"&&/^SCALE_P1B[12]_[A-Z0-9_]+$/.test(cause.code))
            blocked(cause.code);
          blocked("SCALE_P2B1_MAPPING_BLOCKED");
        }
        current();
        if(candidate.status!=="READY_FOR_COMPILATION"||
           candidate.canActivate!==false||candidate.engineVerified!==false||
           candidate.physicalTopologyVerified!==false||
           candidate.sourceSha256!==decision.sourceSha256||
           candidate.source.resources.length!==1000||
           candidate.source.connections.length!==999||
           candidate.source.tests.length!==0||
           candidate.origins.nodes.length!==1000||
           candidate.origins.links.length!==999)
          blocked("SCALE_P2B1_SOURCE_CANDIDATE_BLOCKED");
        const compiled=await compileBuilderWorkspace(
          createBuilderWorkspace(candidate.source),compilerOptions);
        current();
        if(compiled.compile.status!=="valid"||
           compiled.compile.model.resources.length!==1000||
           compiled.compile.model.connections.length!==999)
          blocked("SCALE_P2B1_COMPILE_BLOCKED");
        const nodeOrder=candidate.origins.nodes.map(o=>o.nodeId);
        // Rehash the actual full compiled Builder source independently of any
        // user-provided sidecar or untrusted Office document field.
        const originalText=JSON.stringify(compiled.source);
        const digest=new Uint8Array(await globalThis.crypto.subtle.digest(
          "SHA-256",new TextEncoder().encode(originalText)));
        const sourceModelHash=Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
        current();
        const firstFocus=await buildScaledOfficeThousandFocus(
          compiled.compile.model,nodeOrder,1);
        current();
        const fresh=await reread();
        let verified;
        try{verified=await mapReviewedOfficeBatchesToSource(fresh,decision);}
        catch{blocked("SCALE_P2B1_SOURCE_CHANGED");}
        current();
        if(verified.sourceSha256!==candidate.sourceSha256||
           JSON.stringify(verified.source)!==JSON.stringify(candidate.source)||
           JSON.stringify(verified.origins)!==JSON.stringify(candidate.origins))
          blocked("SCALE_P2B1_SOURCE_CHANGED");
        current(); // Never await between last workspace check and replacement.
        if (!projectGuardRef.current()) return;
        beginScenarioTransition();
        scaledOfficeThousandFocusEpoch.current++;
        setImportedProbeAutoOpen(false);
        setDiagnostics([{
          severity:"warning",
          code:"SCALE_P2B1_MODELED_NOT_PHYSICAL",
          message:"Original DOCX/ODT has 1,000 reviewed devices and 999 explicit port-linked references; only a bounded source-row view is displayed. No physical/Engine truth was inferred."
        }]);
        restoreDeclaredOfficeHierarchyFocus();
        setDeclaredOfficeHierarchy(null);
        setDeclaredOfficePanelOpen(false);
        setScaledOfficeThousandFocus({
          source:compiled.source,model:compiled.compile.model,nodeOrder,
          sourceModelHash,sourceOriginalSha256:verified.sourceSha256,
          ...firstFocus
        });
        setScaledOfficeThousandFocusBusy(false);
        setWorkspace(compiled);
        setScaledOfficeThousandOpen(false);
      },
    }) : null,
    scaledOfficeBuilderOpen ? e(ScaledOfficeBuilderPanel, {
      inspectFile: async file => {
        const denied=code=>{const error=new Error(code);error.code=code;throw error;};
        if(!file||typeof file.name!=="string"||
          !/^[^/\\\0]+\.(?:docx|odt)$/i.test(file.name)||
          typeof file.arrayBuffer!=="function"||
          (file.size!==undefined&&(!Number.isSafeInteger(file.size)||
            file.size<4||file.size>16*1024*1024)))
          denied("SCALE_P2A_FILE_INVALID");
        const format=/\.docx$/i.test(file.name)?"docx":"odt";
        const buffer=await file.arrayBuffer();
        if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<4||
          buffer.byteLength>16*1024*1024)denied("SCALE_P2A_FILE_INVALID");
        const bytes=new Uint8Array(buffer);
        const preview=format==="docx"
          ?await previewDocxTableStructure(bytes,{capacityProfile:DOCX_LARGE_PROFILE})
          :await previewOdtTableStructure(bytes,{capacityProfile:ODT_LARGE_PROFILE});
        if(preview.status!=="REVIEW_REQUIRED"||preview.textIncluded!==false||
           preview.canActivate!==false||preview.engineVerified!==false||
           preview.physicalTopologyVerified!==false)
          denied("SCALE_P2A_PREVIEW_BLOCKED");
        return {format,preview};
      },
      onClose:()=>setScaledOfficeBuilderOpen(false),
      onConfirm: async (expected,decision,file,isCurrentSelection) => {
        const denied=code=>{const error=new Error(code);error.code=code;throw error;};
        const active=latestDrawioWorkspaceRef.current;
        if(active.mode!=="builder")denied("SCALE_P2A_BUILDER_REQUIRED");
        const activeIdentity=JSON.stringify(active);
        const activeTransition=scenarioTransitionRef.current;
        const current=()=>{
          if(scenarioTransitionRef.current!==activeTransition||
            latestDrawioWorkspaceRef.current.mode!=="builder"||
            JSON.stringify(latestDrawioWorkspaceRef.current)!==activeIdentity)
            denied("SCALE_P2A_WORKSPACE_CHANGED");
          if(typeof isCurrentSelection!=="function"||!isCurrentSelection())
            denied("SCALE_P2A_SELECTION_STALE");
        };
        const reread=async()=>{
          current();
          const buffer=await file.arrayBuffer();
          current();
          if(!(buffer instanceof ArrayBuffer)||buffer.byteLength<4||
            buffer.byteLength>16*1024*1024)
            denied("SCALE_P2A_SOURCE_CHANGED");
          const raw=new Uint8Array(buffer);
          let preview;
          try{
            preview=expected.format==="docx"
              ?await previewDocxTableStructure(raw,{capacityProfile:DOCX_LARGE_PROFILE})
              :await previewOdtTableStructure(raw,{capacityProfile:ODT_LARGE_PROFILE});
          }catch{denied("SCALE_P2A_SOURCE_BLOCKED");}
          current();
          if(JSON.stringify(preview)!==JSON.stringify(expected.preview)||
             preview.sourceSha256!==decision.sourceSha256)
            denied("SCALE_P2A_SOURCE_CHANGED");
          return raw;
        };
        const bytes=await reread();
        let candidate;
        try{candidate=await mapReviewedOfficeBatchesToSource(bytes,decision);}
        catch(cause){
          if(typeof cause?.code==="string"&&/^SCALE_P1B[12]_/.test(cause.code))
            denied(cause.code);
          denied("SCALE_P2A_MAPPING_BLOCKED");
        }
        current();
        if(candidate.status!=="READY_FOR_COMPILATION"||
          candidate.canActivate!==false||candidate.engineVerified!==false||
          candidate.physicalTopologyVerified!==false||
          candidate.sourceSha256!==decision.sourceSha256||
          candidate.source.resources.length!==100||
          candidate.source.connections.length!==99||
          candidate.source.tests.length!==0)
          denied("SCALE_P2A_CANDIDATE_BLOCKED");
        const compiled=await compileBuilderWorkspace(
          createBuilderWorkspace(candidate.source),compilerOptions);
        current();
        if(compiled.compile.status!=="valid")denied("SCALE_P2A_COMPILE_BLOCKED");
        const layout=await autoLayoutBuilder(compiled,new ElkLayoutBackend());
        current();
        if(!layout.ok)denied("SCALE_P2A_LAYOUT_BLOCKED");
        const fresh=await reread();
        let checked;
        try{checked=await mapReviewedOfficeBatchesToSource(fresh,decision);}
        catch{denied("SCALE_P2A_SOURCE_CHANGED");}
        current();
        if(JSON.stringify(checked.source)!==JSON.stringify(candidate.source)||
           JSON.stringify(checked.origins)!==JSON.stringify(candidate.origins)||
           checked.sourceSha256!==candidate.sourceSha256)
          denied("SCALE_P2A_SOURCE_CHANGED");
        current(); // No await between final live check and source replacement.
        if (!projectGuardRef.current()) return;
        beginScenarioTransition();
        setImportedProbeAutoOpen(false);
        setDiagnostics([...layout.diagnostics,{
          severity:"warning",
          code:"SCALE_P2A_TOPOLOGY_MODELED_UNVERIFIED",
          message:"100 approved original DOCX/ODT device rows and 99 separately approved port-linked source references entered editable Builder. No physical cables, actual reachability, Runtime or Engine PASS were asserted."
        }]);
        setWorkspace(layout.workspace);
        setScaledOfficeBuilderOpen(false);
      },
    }) : null,
    officeReviewedBuilderOpen ? e(OfficeReviewedBuilderPanel, {
      inspectFile: previewOfficeNodesFile,
      manualRoleOptions: GRAPHML_MANUAL_ROLE_OPTIONS,
      onClose: () => setOfficeReviewedBuilderOpen(false),
      onConfirm: async (expected, decision, originalFile, isCurrentSelection) => {
        // Never let an awaited read/compiler/layout overwrite a newer Builder
        // change, a scenario transition or a revoked original-cell consent.
        const liveBefore = latestDrawioWorkspaceRef.current;
        const workspaceIdentity = JSON.stringify(liveBefore);
        const transitionIdentity = scenarioTransitionRef.current;
        const blocked = code => { const error = new Error(code); error.code = code; throw error; };
        const checkCurrent = () => {
          if (scenarioTransitionRef.current !== transitionIdentity ||
              JSON.stringify(latestDrawioWorkspaceRef.current) !== workspaceIdentity)
            blocked("IC040_P1B_WORKSPACE_CHANGED");
          if (typeof isCurrentSelection !== "function" || !isCurrentSelection())
            blocked("IC040_P1B_STALE");
        };
        checkCurrent();
        const mapped = await verifyOfficeCandidateFile(originalFile, expected, decision, isCurrentSelection);
        checkCurrent();
        // Only separately reviewed original peer cells may become modeled links.
        // P1a node-only decisions must continue to create zero connections.
        const expectedConnections = Array.isArray(decision.linkRows)
          ? decision.linkRows.length
          : Array.isArray(decision.connections) ? decision.connections.length : 0;
        if (mapped.status !== "READY_FOR_COMPILATION" || !mapped.source ||
            mapped.source.connections.length !== expectedConnections || mapped.source.tests.length ||
            mapped.canActivate !== false || mapped.engineVerified !== false)
          blocked("IC040_P1B_CANDIDATE_BLOCKED");
        const compiled = await compileBuilderWorkspace(
          createBuilderWorkspace(mapped.source), compilerOptions);
        checkCurrent();
        if (compiled.compile.status !== "valid") blocked("IC040_P1B_COMPILE_BLOCKED");
        const layout = await autoLayoutBuilder(compiled, new ElkLayoutBackend());
        checkCurrent();
        if (!layout.ok) blocked("IC040_P1B_LAYOUT_BLOCKED");
        // Final source read AFTER real compilation/layout. Never trust a
        // previously saved byte copy or a filename/same-size-only comparison.
        const refreshed = await verifyOfficeCandidateFile(
          originalFile, expected, decision, isCurrentSelection);
        checkCurrent();
        if (JSON.stringify(refreshed.source) !== JSON.stringify(mapped.source) ||
            JSON.stringify(refreshed.origins) !== JSON.stringify(mapped.origins) ||
            JSON.stringify(refreshed.connectionOrigins ?? []) !== JSON.stringify(mapped.connectionOrigins ?? []) ||
             JSON.stringify(refreshed.portOrigins ?? []) !== JSON.stringify(mapped.portOrigins ?? []) ||
             JSON.stringify(refreshed.linkRowOrigins ?? []) !== JSON.stringify(mapped.linkRowOrigins ?? []) ||
            refreshed.sourceSha256 !== mapped.sourceSha256)
          blocked("IC040_P1B_SOURCE_CHANGED");
        checkCurrent(); // no await between final live check and commit
        if (!projectGuardRef.current()) return;
        beginScenarioTransition();
        setImportedProbeAutoOpen(false);
        setDiagnostics([...layout.diagnostics, {
          severity: "warning", code: "IC040_P1B_MODELED_NODES_NOT_VERIFIED",
          message: "Only independently consented DOCX/ODT node-ID cells, operator roles and reviewed original same-row peer or separate Links-table FROM/TO endpoint cells entered Builder. Any port references and links are MODELED, not independently verified physical cables. No unselected or invented ports, IPs, routes, real devices, reachability, Engine or Runtime PASS."
        }]);
        setWorkspace(layout.workspace);
        setOfficeReviewedBuilderOpen(false);
      },
    }) : null,
    docxStructureOpen ? e(DocxTableStructurePanel, {
      inspectFile: previewDocxFileStructure,
      reviewFile: reviewDocxFileCell,
      onBuildAssociation: (reviewedCell, decision) => {
        const currentModel=workspace.mode==="builder" ? {
          scenarioId:workspace.source.scenarioId,sourceRevision:workspace.sourceRevision,
          resources:workspace.source.resources.map(r=>({id:r.id,label:r.label})),
        } : null;
        const reviewed=reviewDocxCellAssociation(reviewedCell,currentModel,decision);
        if(reviewed.status!=="READY_FOR_EXPORT" || !reviewed.sidecar){
          const err=new Error("DOCX_MULTI_ASSOC_BLOCKED");
          err.code=reviewed.diagnostics[0]?.code??"DOCX_MULTI_ASSOC_BLOCKED";
          throw err;
        }
        return reviewed.sidecar;
      },
      onExportMulti: (staged, decision) => {
        const currentModel=workspace.mode==="builder" ? {
          scenarioId:workspace.source.scenarioId,sourceRevision:workspace.sourceRevision,
          resources:workspace.source.resources.map(r=>({id:r.id,label:r.label})),
        } : null;
        const reviewed=reviewDocxMultiReferences(staged,currentModel,decision);
        if(reviewed.status!=="READY_FOR_EXPORT" || !reviewed.sidecar){
          const err=new Error("DOCX_MULTI_EXPORT_BLOCKED");
          err.code=reviewed.diagnostics[0]?.code??"DOCX_MULTI_EXPORT_BLOCKED";
          throw err;
        }
        downloadJson({
          filename:"docx-reviewed-multi-"+reviewed.sidecar.source.sha256.slice(0,12)+".json",
          mime:"application/json",
          text:JSON.stringify(reviewed.sidecar,null,2),
        });
      },
      model: workspace.mode === "builder" ? {
        scenarioId: workspace.source.scenarioId,
        sourceRevision: workspace.sourceRevision,
        resources: workspace.source.resources.map(r => ({ id: r.id, label: r.label })),
      } : null,
      onExportAssociation: (reviewedCell, decision) => {
        // Revalidate against CURRENT Builder, not snapshot chosen in the UI.
        const currentModel = workspace.mode === "builder" ? {
          scenarioId: workspace.source.scenarioId,
          sourceRevision: workspace.sourceRevision,
          resources: workspace.source.resources.map(r => ({ id: r.id, label: r.label })),
        } : null;
        const reviewed = reviewDocxCellAssociation(reviewedCell, currentModel, decision);
        if (reviewed.status !== "READY_FOR_EXPORT" || !reviewed.sidecar) {
          const blocked = new Error("DOCX_ASSOC_EXPORT_BLOCKED");
          blocked.code = reviewed.diagnostics[0]?.code ?? "DOCX_ASSOC_EXPORT_BLOCKED";
          throw blocked;
        }
        // Zero cell content, sidecar only, NEVER a Builder/Engine operation.
        downloadJson({
          filename: `docx-reviewed-reference-${reviewed.sidecar.source.sha256.slice(0, 12)}.json`,
          mime: "application/json",
          text: JSON.stringify(reviewed.sidecar, null, 2),
        });
      },
      onClose: () => setDocxStructureOpen(false),
    }) : null,
    ansibleIniReplayOpen ? e(AnsibleIniSavedReferenceReplayPanel, {
      model: workspace.mode==="builder" ? {
        scenarioId:workspace.source.scenarioId,
        sourceRevision:workspace.sourceRevision,
        resources:workspace.source.resources.map(r=>({id:r.id,label:r.label})),
      } : null,
      onReplay: async (original,report,consent,isCurrent) => {
        const getCurrentModel=()=>{
          const live=latestDrawioWorkspaceRef.current;
          return live.mode==="builder" ? {
            scenarioId:live.source.scenarioId,
            sourceRevision:live.sourceRevision,
            resources:live.source.resources.map(r=>({id:r.id,label:r.label})),
          } : null;
        };
        return replayAnsibleIniSavedReportFiles(original,report,getCurrentModel,consent,isCurrent);
      },
      onClose:()=>setAnsibleIniReplayOpen(false),
    }) : null,
    ansibleIniOpen ? e(AnsibleIniInventoryPanel, {
      inspectFile: previewAnsibleIniFileReadOnly,
      model: workspace.mode === "builder" ? {
        scenarioId: workspace.source.scenarioId,
        sourceRevision: workspace.sourceRevision,
        resources: workspace.source.resources.map(resource => ({ id: resource.id, label: resource.label })),
      } : null,
      onExportAssociation: async (originalFile,inventoryPreview,decision,isCurrent) => {
        const currentModel=()=>{
          const live=latestDrawioWorkspaceRef.current;
          return live.mode==="builder"?{
            scenarioId:live.source.scenarioId,
            sourceRevision:live.sourceRevision,
            resources:live.source.resources.map(resource=>({id:resource.id,label:resource.label})),
          }:null;
        };
        const sidecar=await reviewAnsibleIniOriginalFileAssociations(
          originalFile,inventoryPreview,currentModel,decision,isCurrent);
        if(!isCurrent()){
          const error=new Error("ANSIBLE_INI_P4_STALE");
          error.code="ANSIBLE_INI_P4_STALE";throw error;
        }
        // Source-bound unverified metadata only; NEVER mutate Builder or Engine.
        downloadJson({
          filename: `ansible-ini-inventory-associations-${sidecar.source.sha256.slice(0, 12)}.json`,
          mime: "application/json",
          text: JSON.stringify(sidecar, null, 2),
        });
      },
      onClose: () => setAnsibleIniOpen(false),
    }) : null,
    drawioReplayOpen ? e(DrawioSavedReferenceReplayPanel, {
      model: workspace.mode==="builder" ? {
        scenarioId:workspace.source.scenarioId,
        sourceRevision:workspace.sourceRevision,
        resources:workspace.source.resources.map(r=>({id:r.id,label:r.label})),
      } : null,
      onReplay: async (original,report,consent,isCurrent) => {
        const getCurrentModel=()=>{
          const live=latestDrawioWorkspaceRef.current;
          return live.mode==="builder" ? {
            scenarioId:live.source.scenarioId,
            sourceRevision:live.sourceRevision,
            resources:live.source.resources.map(r=>({id:r.id,label:r.label})),
          } : null;
        };
        return replayDrawioSavedReportFiles(original,report,getCurrentModel,consent,isCurrent);
      },
      onClose:()=>setDrawioReplayOpen(false),
    }) : null,
    drawioBuilderReviewOpen ? e(DrawioReviewedBuilderPanel, {
      inspectFile: previewDrawioCandidateFile,
      manualRoleOptions: GRAPHML_MANUAL_ROLE_OPTIONS,
      onClose: () => setDrawioBuilderReviewOpen(false),
      onConfirm: async (expectedGraph, decision, reviewedBytes, originalFile, isCurrentSelection) => {
        // Capture the exact current workspace and transition BEFORE any yield.
        // This dialog must not commit an obsolete reviewed diagram over newer
        // user Builder edits, other imports, guided labs or a Runtime.
        const liveBefore = latestDrawioWorkspaceRef.current;
        const workspaceIdentity = JSON.stringify(liveBefore);
        const transitionIdentity = scenarioTransitionRef.current;
        const checkCurrent = () => {
          if (scenarioTransitionRef.current !== transitionIdentity ||
              JSON.stringify(latestDrawioWorkspaceRef.current) !== workspaceIdentity) {
            const error = new Error("IC030_P2B_WORKSPACE_CHANGED");
            error.code = "IC030_P2B_WORKSPACE_CHANGED"; throw error;
          }
          if (typeof isCurrentSelection !== "function" || !isCurrentSelection()) {
            const error = new Error("IC030_P2B_STALE");
            error.code = "IC030_P2B_STALE"; throw error;
          }
        };
        checkCurrent();
        const mapped = await mapReviewedDrawioOriginalToBuilder(
          reviewedBytes, expectedGraph, decision);
        checkCurrent();
        if (mapped.status !== "READY_FOR_COMPILATION" || !mapped.source) {
          const code = mapped.diagnostics[0]?.code ?? "DRAWIO_CANDIDATE_BLOCKED";
          const error = new Error(code);error.code = code;throw error;
        }
        const candidate = await compileBuilderWorkspace(
          createBuilderWorkspace(mapped.source), compilerOptions);
        checkCurrent();
        if (candidate.compile.status !== "valid") {
          const error = new Error("IC030_P2B_COMPILE_BLOCKED");
          error.code = "IC030_P2B_COMPILE_BLOCKED"; throw error;
        }
        const layout = await autoLayoutBuilder(candidate, new ElkLayoutBackend());
        checkCurrent();
        if (!layout.ok) {
          const error = new Error("IC030_P2B_LAYOUT_BLOCKED");
          error.code = "IC030_P2B_LAYOUT_BLOCKED"; throw error;
        }
        // The LAST asynchronous gate rereads exactly the originally chosen
        // File, checks full SHA and ordinal endpoint structure, and reapplies
        // the SAME manual review decisions.
        const refreshed = await verifyDrawioOriginalForReviewedActivation(
          originalFile, expectedGraph, decision, isCurrentSelection);
        checkCurrent();
        if (JSON.stringify(refreshed.source) !== JSON.stringify(mapped.source) ||
            JSON.stringify(refreshed.origins) !== JSON.stringify(mapped.origins)) {
          const error = new Error("DRAWIO_CANDIDATE_SOURCE_CHANGED");
          error.code = "DRAWIO_CANDIDATE_SOURCE_CHANGED"; throw error;
        }
        if (!projectGuardRef.current()) return;
        beginScenarioTransition();
        setImportedProbeAutoOpen(false);
        setDiagnostics([...layout.diagnostics, {
          severity: "warning", code: "DRAWIO_REVIEWED_GRAPH_NOT_VERIFIED",
          message: "Only individually selected drawn positions and expressly consented modeled edges entered Builder. No real devices, physical cables, reachability, routes, OS or Engine PASS were verified."
        }]);
        setWorkspace(layout.workspace);
        setDrawioBuilderReviewOpen(false);
      },
    }) : null,
    drawioStructureOpen ? e(DrawioStructurePanel, {
      inspectFile: previewDrawioFileReadOnly,
      model: workspace.mode === "builder" ? {
        scenarioId:workspace.source.scenarioId,
        sourceRevision:workspace.sourceRevision,
        resources:workspace.source.resources.map(r=>({id:r.id,label:r.label})),
      } : null,
      onExportReviewed: async (originalFile,preview,decision,isCurrent) => {
        const currentModel=()=>{
          const current=latestDrawioWorkspaceRef.current;
          return current.mode==="builder" ? {
            scenarioId:current.source.scenarioId,
            sourceRevision:current.sourceRevision,
            resources:current.source.resources.map(r=>({id:r.id,label:r.label})),
          } : null;
        };
        const sidecar=await reviewDrawioOriginalFileReferences(
          originalFile,preview,currentModel,decision,isCurrent);
        if(!isCurrent()||!currentModel()||
           currentModel().scenarioId!==sidecar.targetModel.scenarioId||
           currentModel().sourceRevision!==sidecar.targetModel.sourceRevision){
          const error=new Error("DRAWIO_ASSOC_STALE");
          error.code="DRAWIO_ASSOC_STALE";throw error;
        }
        // Separate metadata-only download: never set workspace or call Engine.
        downloadJson({
          filename:"drawio-reviewed-vertices-"+sidecar.source.sha256.slice(0,12)+".json",
          mime:"application/json",
          text:JSON.stringify(sidecar,null,2),
        });
      },
      onClose: () => setDrawioStructureOpen(false),
    }) : null,
    nessusSeverityOpen ? e(NessusSeverityPanel, {
      inspectFile: previewNessusFileReadOnly,
      model: workspace.mode === "builder" ? {
        scenarioId: workspace.source.scenarioId,
        sourceRevision: workspace.sourceRevision,
        resources: workspace.source.resources.map(r => ({id:r.id,label:r.label})),
      } : null,
      onExportReviewed: async (sourceFile, summary, decision, isCurrent) => {
        const getCurrentModel = () => {
          const live = latestDrawioWorkspaceRef.current;
          return live.mode === "builder" ? {
            scenarioId: live.source.scenarioId,
            sourceRevision: live.sourceRevision,
            resources: live.source.resources.map(r => ({id:r.id,label:r.label})),
          } : null;
        };
        const sidecar = await reviewNessusOriginalFileAssociations(
          sourceFile, summary, getCurrentModel, decision, isCurrent);
        // No yield after final file-generation gate and before local JSON download.
        if (!isCurrent()) {
          const error = new Error("NESSUS_P5_STALE");
          error.code = "NESSUS_P5_STALE";
          throw error;
        }
        // Only metadata, never original ReportHost names, IPs, plugin output or Engine state.
        downloadJson({
          filename: "nessus-reviewed-hosts-"+sidecar.source.sha256.slice(0,12)+".json",
          mime: "application/json",
          text: JSON.stringify(sidecar,null,2),
        });
      },
      onClose: () => setNessusSeverityOpen(false),
    }) : null,
    nessusReplayOpen ? e(NessusSavedReferenceReplayPanel, {
      model: workspace.mode === "builder" ? {
        scenarioId: workspace.source.scenarioId,
        sourceRevision: workspace.sourceRevision,
        resources: workspace.source.resources.map(r=>({id:r.id,label:r.label})),
      } : null,
      onReplay: async (original,report,consent,isCurrent) => {
        const getCurrentModel=()=>{
          const live=latestDrawioWorkspaceRef.current;
          return live.mode==="builder" ? {
            scenarioId:live.source.scenarioId,
            sourceRevision:live.sourceRevision,
            resources:live.source.resources.map(r=>({id:r.id,label:r.label})),
          } : null;
        };
        return replayNessusSavedReportFiles(original,report,getCurrentModel,consent,isCurrent);
      },
      onClose:()=>setNessusReplayOpen(false),
    }) : null,
    nmapReplayOpen ? e(NmapSavedReferenceReplayPanel, {
      model: workspace.mode === "builder" ? {
        scenarioId: workspace.source.scenarioId,
        sourceRevision: workspace.sourceRevision,
        resources: workspace.source.resources.map(resource=>({id:resource.id,label:resource.label})),
      } : null,
      onReplay: async (original,report,consent,isCurrent) => {
        const currentModel=()=>{
          const live=latestDrawioWorkspaceRef.current;
          return live.mode==="builder"?{
            scenarioId:live.source.scenarioId,
            sourceRevision:live.sourceRevision,
            resources:live.source.resources.map(resource=>({id:resource.id,label:resource.label})),
          }:null;
        };
        return replayNmapSavedReportFiles(original,report,currentModel,consent,isCurrent);
      },
      onClose:()=>setNmapReplayOpen(false),
    }) : null,
    nmapObservationOpen ? e(NmapObservationPanel, {
      inspectFile: previewNmapXmlFileReadOnly,
      model: workspace.mode === "builder" ? {
        scenarioId: workspace.source.scenarioId,
        sourceRevision: workspace.sourceRevision,
        resources: workspace.source.resources.map((resource) => ({ id: resource.id, label: resource.label })),
      } : null,
      onExportAssociation: async (originalFile, scanPreview, decision, isCurrent) => {
        const getCurrentModel = () => {
          const live = latestDrawioWorkspaceRef.current;
          return live.mode === "builder" ? {
            scenarioId: live.source.scenarioId,
            sourceRevision: live.sourceRevision,
            resources: live.source.resources.map((resource) => ({
              id: resource.id, label: resource.label,
            })),
          } : null;
        };
        const sidecar = await reviewNmapOriginalFileAssociations(
          originalFile, scanPreview, getCurrentModel, decision, isCurrent);
        // No asynchronous yield after the last source-epoch gate and before
        // download. This never imports scan hosts or changes Builder/Engine.
        if (!isCurrent()) {
          const error = new Error("NMAP_P4_STALE");
          error.code = "NMAP_P4_STALE"; throw error;
        }
        downloadJson({
          filename: `nmap-associations-${sidecar.source.sha256.slice(0, 12)}.json`,
          mime: "application/json",
          text: JSON.stringify(sidecar, null, 2),
        });
      },
      onClose: () => setNmapObservationOpen(false),
    }) : null,
    structuredXmlInspectionOpen ? e(StructuredXmlInspectionPanel, {
      inspectFile: inspectSharedDocumentFileReadOnly,
      workspaceIdentity: workspace,
      getCurrentWorkspaceIdentity: () => latestDrawioWorkspaceRef.current,
      model: workspace.mode === "builder" ? {
        scenarioId: workspace.source.scenarioId,
        sourceRevision: workspace.sourceRevision,
        resources: workspace.source.resources.map(x => ({id:x.id,label:x.label})),
      } : null,
      onExportReviewed: async (file, expected, decision, isCurrent) => {
        const getLiveModel = () => {
          const w = latestDrawioWorkspaceRef.current;
          return w.mode === "builder" ? {
            scenarioId: w.source.scenarioId,
            sourceRevision: w.sourceRevision,
            resources: w.source.resources.map(x => ({id:x.id,label:x.label})),
          } : null;
        };
        const before = getLiveModel();
        if (!before || !isCurrent()) {
          const error = new Error("IC010_P3B_STALE"); error.code = "IC010_P3B_STALE"; throw error;
        }
        const beforeIdentity = JSON.stringify(before);
        const sidecar = await reviewSharedStaticHostOriginalReference(
          file,expected,getLiveModel,decision,isCurrent);
        if (!isCurrent() || JSON.stringify(getLiveModel()) !== beforeIdentity) {
          const error = new Error("IC010_P3B_STALE"); error.code = "IC010_P3B_STALE"; throw error;
        }
        // Final local sidecar download has no asynchronous yield after live gate.
        downloadJson({
          filename: "ic010-unverified-host-" + sidecar.source.sha256.slice(0,12) + ".json",
          mime: "application/json",
          text: JSON.stringify(sidecar,null,2),
        });
      },
      onClose: () => setStructuredXmlInspectionOpen(false),
    }) : null,
    graphmlPreviewOpen ? e(GraphmlReadOnlyPanel, { inspectFile: previewGraphmlFileReadOnly,
      manualRoleOptions: GRAPHML_MANUAL_ROLE_OPTIONS,
      onClose: () => setGraphmlPreviewOpen(false),
      onConfirm: async (sourcePreview, decisions, originalFile, isCurrentSelection) => {
        // Keep the exact live workspace identity and transition at the start of
        // confirmation. Compilation/layout may yield while other actions change
        // the active workspace; a stale reviewed GraphML must never replace it.
        const liveBefore = latestDrawioWorkspaceRef.current;
        const workspaceIdentity = JSON.stringify(liveBefore);
        const transitionIdentity = scenarioTransitionRef.current;
        const currentWorkspace = () => scenarioTransitionRef.current === transitionIdentity
          && JSON.stringify(latestDrawioWorkspaceRef.current) === workspaceIdentity;
        const checkCurrent = () => {
          if (!currentWorkspace()) {
            const error = new Error("IC030_P1_WORKSPACE_CHANGED");
            error.code = "IC030_P1_WORKSPACE_CHANGED"; throw error;
          }
          if (typeof isCurrentSelection !== "function" || !isCurrentSelection()) {
            const error = new Error("IC030_P1_STALE");
            error.code = "IC030_P1_STALE"; throw error;
          }
        };
        checkCurrent();
        const mapped = mapReviewedGraphmlToBuilder(sourcePreview, decisions);
        if (mapped.status !== "READY_FOR_COMPILATION" || !mapped.source) {
          throw new Error(`GraphML manual mapping blocked: ${mapped.diagnostics.map((d) => d.code).join(", ")}`);
        }
        let candidate = await compileBuilderWorkspace(createBuilderWorkspace(mapped.source), compilerOptions);
        checkCurrent();
        if (candidate.compile.status !== "valid") {
          throw new Error(`GraphML Builder compilation blocked: ${candidate.compile.diagnostics.map((d) => d.code).join(", ")}`);
        }
        const layout = await autoLayoutBuilder(candidate, new ElkLayoutBackend());
        checkCurrent();
        if (!layout.ok) {
          throw new Error(`GraphML Builder layout blocked: ${layout.diagnostics.map((d) => d.code).join(", ")}`);
        }
        // No original-file byte trust is carried across asynchronous work.
        // Re-read and reparse the ORIGINAL selected file before any mutation.
        await verifyGraphmlOriginalForReviewedActivation(originalFile, sourcePreview, isCurrentSelection);
        checkCurrent();
        if (!projectGuardRef.current()) return;
        beginScenarioTransition();
        setImportedProbeAutoOpen(false);
        setDiagnostics([...layout.diagnostics,
          { severity: "warning", code: "GRAPHML_MANUAL_MAPPING_NOT_VERIFIED",
            message: "GraphML graph edges were modeled only by explicit user choice. No physical cable, reachability, protocol result or verification PASS is implied." }]);
        setWorkspace(layout.workspace);
        setGraphmlPreviewOpen(false);
      },
    }) : null,
    e("main", { className: "workspace-grid" },
      e(ControlCenter, null,
        e(ControlSection, { title: "Verification, experiments & promotion", description: "Evidence, intent, matrix and promotion workflows stay available on demand.", searchTerms: "Troubleshooting Case Network Intent Scenario Experiments Verified Baselines Regression Campaigns Transition Matrix Campaign Bundle Change Sets Verification Suites What-If Matrix Promotion Rollback" },
          e("section", { className: "right-scroll-column", "aria-label": "Kontroll- och resultatpanel" },
          e("section", { className: "troubleshooting-case-panel", "aria-label": "Troubleshooting Case", "data-troubleshooting-case": "ready" },
            e("h2", null, "Troubleshooting Case"),
            e("p", null, troubleshootingCase ? `${troubleshootingCase.title} · ${troubleshootingCase.status}` : "Case är en behållare för verifierad data, inte en andra Engine."),
            e("div", { className: "case-actions" },
              e("button", { type: "button", onClick: createCase, "data-case-create": "true" }, "Create Case"),
              e("button", { type: "button", onClick: addCaseNote, disabled: !troubleshootingCase, "data-case-note": "true" }, "USER NOTE"),
              e("button", { type: "button", onClick: bookmarkCurrentEvidence, disabled: !troubleshootingCase || !evidenceWorkspace, "data-case-bookmark": "true" }, "Bookmark Evidence"),
              e("button", { type: "button", onClick: saveCaseRun, disabled: !troubleshootingCase || !evidenceWorkspace, "data-case-save-run": "true" }, "Save Run"),
              e("button", { type: "button", onClick: resetCase, disabled: !troubleshootingCase, "data-case-reset": "true" }, "Reset Case"),
              e("button", { type: "button", onClick: exportCase, disabled: !troubleshootingCase, "data-case-export": "true" }, "Export Case"),
              e("button", { type: "button", onClick: exportDiagnosticSession, disabled: !troubleshootingCase, "data-session-export": "true" }, "Export Diagnostic Session"),
              e("label", { className: "file-button" }, "Import Diagnostic Session", e("input", { type: "file", accept: ".yadilab-session.json,application/json", onChange: (event) => importDiagnosticSession(event.target.files?.[0]), hidden: true, "data-session-import": "true" })),
            ),
            troubleshootingCase ? e("div", { "data-case-summary": "true" },
              e("span", null, `Runs: ${troubleshootingCase.runs.length}`), e("span", null, `Bookmarks: ${troubleshootingCase.bookmarks.length}`), e("span", null, `USER NOTES: ${troubleshootingCase.notes.length}`),
              e("strong", null, "ARCHIVED RUN · historical evidence"),
              multiRunView ? e("div", { "data-multi-run": "true" }, e("strong", null, "Multi-Run Comparison"), e("span", null, `${multiRunView.rows.length} runs · outcomes are factual comparisons`), e("span", null, multiRunView.factualDifferences.join(" · ") || "No observed differences")) : null,
              e("button", { type: "button", onClick: reproduceCase, disabled: !troubleshootingCase || busy, "data-case-reproduce": "true" }, "Reproduce via Compiler + Engine"),
            ) : null,
          ),
          e(NetworkIntentPanel, { workspace, setDiagnostics, onOpenEngineRun: (item, runtimeWorkspace) => { if (runtimeWorkspace && !projectGuardRef.current()) return; if (runtimeWorkspace) setWorkspace(runtimeWorkspace); setDiagnostics([{ severity: "warning", code: "INTENT_MATRIX_ENGINE_RUN_SELECTED", message: `Exact Engine evidence opened for run ${item.engineRunId ?? "NOT RUN"}; source ${item.sourceIdentity}; flow ${item.flowId}; actual ${item.actual}.` }]); } }),
          e("section", { className: "troubleshooting-case-panel experiment-branch-panel", "aria-label": "Experiment Branches", "data-experiment-branches": "ready" },
            e("h2", null, "Scenario Experiments"),
            e("p", null, "Isolated canonical source variants. All what-if results run through the normal Compiler and Engine."),
            e("div", { className: "case-actions" },
              e("button", { type: "button", onClick: () => createExperiment("BASELINE"), disabled: !troubleshootingCase, "data-experiment-create-baseline": "true" }, "Create Experiment from BASELINE"),
              e("button", { type: "button", onClick: () => createExperiment("CURRENT_WORKING_COPY"), disabled: !troubleshootingCase, "data-experiment-create-working": "true" }, "Fork from CURRENT WORKING COPY"),
            ),
            experimentBranches.length ? e("div", { "data-experiment-list": "true" },
              e("label", null, "Experiment", e("select", { value: selectedExperimentId, onChange: (event) => setSelectedExperimentId(event.target.value), "data-experiment-selector": "true" }, ...experimentBranches.map((branch) => e("option", { key: branch.experimentId, value: branch.experimentId }, `${branch.title} · ${branch.forkSource} · ${branch.status}`)))),
              e("small", { "data-experiment-ancestor": "true" }, selectedExperiment ? `Ancestor ${selectedExperiment.ancestorSourceIdentity} · Working ${selectedExperiment.workingSourceIdentity}` : ""),
              e("div", { className: "case-actions" },
                e("button", { type: "button", onClick: runExperiment, disabled: !selectedExperiment || busy, "data-experiment-run": "true" }, "Validate + Compile + Run Experiment"),
                e("button", { type: "button", onClick: resetExperiment, disabled: !selectedExperiment, "data-experiment-reset": "true" }, "Reset Experiment"),
                e("button", { type: "button", onClick: discardExperiment, disabled: !selectedExperiment, "data-experiment-discard": "true" }, "Discard Experiment"),
              ),
              selectedExperiment ? e("strong", { "data-experiment-status": "true" }, `Status ${selectedExperiment.status} · Ancestor ${selectedExperiment.forkSource}`) : null,
            ) : e("span", { "data-experiment-empty": "true" }, "No experiment branch created."),
          ),
          e("section", { className: "troubleshooting-case-panel verified-baseline-panel", "aria-label": "Verified Baselines", "data-verified-baselines": "ready" },
            e("h2", null, "Verified Baselines"),
            e("p", null, "Immutable source snapshots for reproducible regression. Baseline är referens; Engine förblir network truth."),
            e("div", { className: "case-actions" }, e("button", { type: "button", onClick: createVerifiedBaselineAction, disabled: !selectedExperiment, "data-baseline-create": "true" }, "Create Verified Baseline")),
            verifiedBaselines.length ? e("div", { "data-baseline-list": "true" },
              e("label", null, "Baseline", e("select", { value: selectedBaselineId, onChange: (event) => setSelectedBaselineId(event.target.value), "data-baseline-selector": "true" }, ...verifiedBaselines.map((baseline) => e("option", { key: baseline.baselineId, value: baseline.baselineId }, `${baseline.title} · ${baseline.status}`)))),
              selectedBaseline ? e("div", { "data-baseline-summary": "true" }, e("small", null, `Source identity ${selectedBaseline.canonicalSourceIdentity}`), e("small", null, `Origin ${selectedBaseline.originType} · ${selectedBaseline.originId}`), e("strong", null, "SOURCE INTEGRITY VERIFIED"), e("div", { className: "case-actions" }, e("button", { type: "button", onClick: reproduceVerifiedBaselineAction, "data-baseline-reproduce": "true" }, "Run / Reproduce Baseline"), e("button", { type: "button", onClick: exportVerifiedBaselineAction, "data-baseline-export": "true" }, "Export Baseline"))) : null,
            ) : e("span", { "data-baseline-empty": "true" }, "No verified baseline created."),
          ),
          e("section", { className: "troubleshooting-case-panel regression-campaign-panel", "aria-label": "Regression Campaigns", "data-regression-campaigns": "ready" },
            e("h2", null, "Regression Campaigns"),
            e("p", null, "Samma Verification Suite körs fräscht mot Baseline och Candidates. Resultat är faktiska jämförelser, inte ranking."),
            e("div", { className: "case-actions" }, e("button", { type: "button", onClick: createRegressionCampaignAction, disabled: !selectedBaseline || !verificationSuites.length || !experimentBranches.length, "data-campaign-create": "true" }, "Create Regression Campaign")),
            regressionCampaigns.length ? e("div", { "data-campaign-list": "true" },
              e("label", null, "Campaign", e("select", { value: selectedCampaignId, onChange: (event) => setSelectedCampaignId(event.target.value), "data-campaign-selector": "true" }, ...regressionCampaigns.map((campaign) => e("option", { key: campaign.campaignId, value: campaign.campaignId }, `${campaign.title} · ${campaign.status}`)))),
              selectedCampaign ? e("div", { "data-campaign-summary": "true" }, e("strong", null, `Status ${selectedCampaign.status}`), e("small", null, `Run order: ${selectedCampaign.runOrder.join(" → ")}`), selectedCampaign.currentResults.length ? e("small", null, `Current results: ${selectedCampaign.currentResults.length} · ${selectedCampaign.status === "COMPLETE" ? "CURRENT" : "HISTORICAL / STALE"}`) : null, e("div", { className: "case-actions" }, e("button", { type: "button", onClick: runRegressionCampaignAction, disabled: busy, "data-campaign-run": "true" }, "Run Fresh Campaign"), e("button", { type: "button", onClick: exportRegressionCampaignAction, "data-campaign-export": "true" }, "Export Campaign"), e("button", { type: "button", onClick: buildTransitionMatrixAction, disabled: selectedCampaign.status !== "COMPLETE", "data-transition-matrix-build": "true" }, "Build Result Transition Matrix"))) : null,
            ) : e("span", { "data-campaign-empty": "true" }, "No regression campaign created."),
          ),
          e("section", { className: "troubleshooting-case-panel transition-matrix-panel", "aria-label": "Result Transition Matrix", "data-result-transition-matrix": transitionMatrix ? "ready" : "empty" },
            e("h2", null, "Result Transition Matrix"),
            e("p", null, "Factual Baseline → Candidate transitions for the same assertion. PASS→FAIL is regression-only semantics, not root-cause inference."),
            transitionMatrix ? e("div", { "data-transition-matrix-summary": "true" }, e("strong", null, transitionMatrix.stale ? "HISTORICAL / STALE" : "CURRENT"), e("span", null, `PASS→FAIL ${transitionMatrix.counts["PASS→FAIL"]} · FAIL→PASS ${transitionMatrix.counts["FAIL→PASS"]} · PASS→PASS ${transitionMatrix.counts["PASS→PASS"]}`), e("label", null, "Filter", e("select", { value: transitionFilter, onChange: (event) => setTransitionFilter(event.target.value), "data-transition-filter": "true" }, e("option", { value: "" }, "Alla transitions"), ...["PASS→FAIL", "FAIL→PASS", "PASS→PASS", "NOT COMPARABLE"].map((value) => e("option", { key: value, value }, value)))), e("ul", { "data-transition-rows": "true" }, ...transitionRows.map((row) => e("li", { key: `${row.candidateId}:${row.assertionId}` }, `${row.candidateId} · ${row.flowId} · ${row.transition}${row.stale ? " · HISTORICAL / STALE" : ""}`)))) : e("span", { "data-transition-matrix-empty": "true" }, "No transition matrix built."),
          ),
          e("section", { className: "troubleshooting-case-panel campaign-bundle-panel", "aria-label": "Campaign Bundle and Promotion Verification Gate", "data-campaign-bundle": campaignBundle ? "ready" : "empty" },
            e("h2", null, "Campaign Bundle + Promotion Verification Gate"),
            e("p", null, "Portabelt kampanjunderlag och aktuell verifiering för exakt kandidat. Ingen automatisk promotion eller rekommendation."),
            e("div", { className: "case-actions" }, e("button", { type: "button", onClick: createCampaignBundleAction, disabled: !selectedCampaign, "data-campaign-bundle-create": "true" }, "Create Campaign Bundle"), e("button", { type: "button", onClick: exportCampaignBundleAction, disabled: !campaignBundle, "data-campaign-bundle-export": "true" }, "Export Campaign Bundle"), e("button", { type: "button", onClick: buildPromotionVerificationGateAction, disabled: !selectedCampaign || !selectedExperiment || !selectedBaseline, "data-promotion-gate-build": "true" }, "Build Fresh Verification Gate")),
            campaignBundle ? e("div", { "data-campaign-bundle-summary": "true" }, e("strong", null, "ARCHIVED / HISTORICAL BUNDLE"), e("small", null, `Campaign ${campaignBundle.campaign.identity.slice(0, 16)}… · archived runs ${campaignBundle.archivedResults.length}`)) : null,
            promotionVerificationGate ? e("div", { "data-promotion-gate-summary": "true" }, e("strong", null, promotionVerificationGate.state), e("small", null, `Candidate ${promotionVerificationGate.candidateId} · fresh ${promotionVerificationGate.fresh ? "YES" : "NO"} · auto-promotion NO`)) : null,
          ),
          e("section", { className: "troubleshooting-case-panel dev2-verification-panel", "aria-label": "Change Sets and Verification Suites", "data-dev2-verification": "ready" },
            e("h2", null, "Change Sets + Verification Suites"),
            e("p", null, "Deterministisk canonical source-diff och användardefinierade förväntningar mot faktisk Engine truth."),
            e("div", { className: "case-actions" },
              e("button", { type: "button", onClick: generateExperimentChangeSet, disabled: !selectedExperiment, "data-change-set-generate": "true" }, "Generate Change Set"),
              e("button", { type: "button", onClick: createExperimentSuite, disabled: !selectedExperiment, "data-verification-suite-create": "true" }, "Create Verification Suite"),
              e("button", { type: "button", onClick: () => runExperimentSuite(true), disabled: !selectedExperiment || !verificationSuites.length || busy, "data-verification-run-ancestor": "true" }, "Run Ancestor Suite"),
              e("button", { type: "button", onClick: () => runExperimentSuite(false), disabled: !selectedExperiment || !verificationSuites.length || busy, "data-verification-run-experiment": "true" }, "Run Experiment Suite"),
            ),
            experimentChangeSets.length ? e("div", { "data-change-set-list": "true" }, ...experimentChangeSets.map((item) => e("p", { key: item.changeSetId }, e("strong", null, `Change Set ${item.status}`), e("small", null, ` · ${item.sourceDiff.length} entries · base ${item.baseSourceIdentity.slice(0, 12)}… → target ${item.targetSourceIdentity.slice(0, 12)}…`)))) : null,
            verificationSuites.length ? e("div", { "data-verification-suite-list": "true" }, ...verificationSuites.map((suite) => e("p", { key: suite.suiteId }, e("strong", null, `${suite.title} · ${suite.assertions.length} assertions`), e("small", null, ` · flows ${suite.selectedFlowIds.join(", ")}`)))) : null,
            verificationRuns.length ? e("div", { "data-verification-results": "true" }, ...verificationRuns.slice(-2).map((run) => e("div", { key: run.runId }, e("strong", null, `Run ${run.sourceRevision} · historical`), e("ul", null, ...run.results.map((result) => e("li", { key: result.assertionId }, `Expected: ${result.expected} · Actual: ${result.actual} · Result: ${result.result}`)))))) : null,
          ),
          e("section", { className: "troubleshooting-case-panel variant-matrix-panel", "aria-label": "Multi-Variant What-If Matrix", "data-variant-matrix": variantMatrix ? "ready" : "empty" },
            e("h2", null, "Multi-Variant / What-If Matrix"),
            e("p", null, "Explicit BASELINE / ANCESTOR plus three isolated variants. Every cell is bound to source identity, revision, assertion and an actual Verification Suite run."),
            e("div", { className: "case-actions" },
              e("button", { type: "button", onClick: createMatrixVariants, disabled: !troubleshootingCase || busy, "data-variant-matrix-create": "true" }, "Create 3 Matrix Variants"),
              e("button", { type: "button", onClick: runVariantMatrix, disabled: !troubleshootingCase || experimentBranches.length < 3 || !verificationSuites.length || busy, "data-variant-matrix-run": "true" }, "Build / Run Matrix"),
              e("button", { type: "button", onClick: () => setMatrixFilters({}), disabled: !variantMatrix, "data-variant-matrix-reset": "true" }, "Show All Results"),
            ),
            variantMatrix ? e("div", { "data-variant-matrix-summary": "true" },
              e("strong", null, `Matrix ${variantMatrix.matrixId.slice(0, 12)}… · ${variantMatrix.experiments.length} experiments`),
              e("span", null, `PASS ${summarizeVariantMatrix(variantMatrix).PASS}`), e("span", null, `FAIL ${summarizeVariantMatrix(variantMatrix).FAIL}`), e("span", null, `UNMODELED ${summarizeVariantMatrix(variantMatrix).UNMODELED}`), e("span", null, `NOT RUN ${summarizeVariantMatrix(variantMatrix)["NOT RUN"]}`),
              e("div", { className: "case-actions", "data-variant-matrix-filters": "true" }, ...["PASS", "FAIL", "UNMODELED", "NOT RUN", "NOT COMPARABLE"].map((status) => e("button", { key: status, type: "button", onClick: () => setMatrixFilters({ results: [status] }), "data-variant-matrix-filter": status }, status))),
              e("div", { className: "variant-matrix-table-wrap" },
                e("table", { "data-variant-matrix-table": "true" },
                  e("thead", null, e("tr", null, ...["Variant", "Flow / Assertion", "Expected", "Actual", "Result", "State", "Navigation"].map((label) => e("th", { key: label }, label)))),
                  e("tbody", null, ...matrixRows.map((row) => e("tr", { key: row.rowId, "data-variant-matrix-row": row.rowId, "data-result": row.displayStatus, "data-current": String(row.current) },
                    e("td", null, e("button", { type: "button", onClick: () => selectMatrixRow(row.rowId), "data-variant-matrix-select": row.variantId }, row.variantTitle), e("small", null, `${row.variantKind} · rev ${row.sourceRevision} · ${row.sourceIdentity.slice(0, 12)}…`)),
                    e("td", null, `${row.flowId} / ${row.assertionId}`), e("td", null, row.expected), e("td", null, row.actual), e("td", null, e("strong", null, row.displayStatus)), e("td", null, row.current ? "CURRENT" : "HISTORICAL"),
                    e("td", null, e("button", { type: "button", onClick: () => selectMatrixRow(row.rowId), "data-variant-matrix-open": row.rowId }, row.evidence ? "Open Evidence" : "Select Run"), e("small", null, row.runId ? ` ${row.runId.slice(0, 18)}…` : " No run")),
                  )))
                )
              ),
              selectedMatrixRowId ? e("small", { "data-variant-matrix-selected": "true" }, `Selected ${selectedMatrixRowId} · Inspector / Journey / X-Ray / Timeline / Multi-Run / Diff remain source-of-truth views for the selected run.`) : null,
            ) : e("span", { "data-variant-matrix-empty": "true" }, "Create three matrix variants, create a Verification Suite, then build the matrix."),
          ),
          e("section", { className: "troubleshooting-case-panel promotion-panel", "aria-label": "Controlled Promotion and Rollback", "data-promotion-workflow": promotionPreview?.status === "ACTIVE" ? "preview" : promotionState ? "promoted" : "idle" },
            e("h2", null, "Controlled Promotion + Rollback"),
            e("p", null, "PROMOTE EXPERIMENT CANONICAL SOURCE TO YADILAB CASE WORKING COPY. This is a local source workflow only; it does not deploy, push configuration or run the Engine."),
            e("div", { className: "case-actions" },
              e("button", { type: "button", onClick: createPromotionPreviewAction, disabled: !troubleshootingCase || !selectedExperiment, "data-promotion-preview": "true" }, "Create Promotion Preview"),
              e("button", { type: "button", onClick: confirmPromotion, disabled: !promotionPreview || promotionPreview.status !== "ACTIVE", "data-promotion-confirm": "true" }, "Confirm Explicit Promotion"),
              e("button", { type: "button", onClick: rollbackPromotionAction, disabled: !promotionState, "data-rollback-confirm": "true" }, "Rollback Exact Snapshot"),
            ),
            promotionPreview ? e("div", { "data-promotion-preview-details": "true" },
              e("strong", null, promotionPreview.status === "ACTIVE" ? "ACTIVE PROMOTION PREVIEW" : "CONSUMED PROMOTION PREVIEW"),
              e("span", null, `CURRENT CASE WORKING COPY → SELECTED EXPERIMENT · case revision ${promotionPreview.targetWorkingSourceRevision}`),
              e("small", null, `Target ${promotionPreview.targetWorkingSourceIdentity.slice(0, 16)}… → Source ${promotionPreview.experimentSourceIdentity.slice(0, 16)}… · Experiment ${promotionPreview.experimentId}`),
              e("small", null, `Change Set ${promotionPreview.changeSetId.slice(0, 16)}… · ${promotionPreview.changeSet.sourceDiff.length} deterministic diff entries`),
              promotionPreview.suiteSummary ? e("small", null, `Verification Suite factual summary: PASS ${promotionPreview.suiteSummary.PASS ?? 0} · FAIL ${promotionPreview.suiteSummary.FAIL ?? 0} · UNMODELED ${promotionPreview.suiteSummary.UNMODELED ?? 0} · NOT RUN ${promotionPreview.suiteSummary["NOT RUN"] ?? 0}`) : e("small", null, "Verification Suite: NOT RUN"),
            ) : e("span", { "data-promotion-preview-empty": "true" }, "No active Promotion Preview. Select an Experiment and create a fresh preview."),
            promotionHistory.length ? e("div", { "data-promotion-history": "true" }, e("strong", null, "Promotion / Rollback History"), e("ol", null, ...promotionHistory.map((entry) => e("li", { key: entry.entryId }, `${entry.kind} · ${entry.sourceIdentityBefore.slice(0, 12)}… → ${entry.sourceIdentityAfter.slice(0, 12)}… · sequence ${entry.sequence}`)))) : null,
          ),
          ),
        ),
        e(ControlSection, { title: "Scenario & Builder", description: "Canonical source authoring, import and builder-only controls.", searchTerms: "Scenario Studio Import Workbench Builder Inspector Fault Injection" },
          e(ScenarioStudioToolbar, { key: `studio-${scenarioTransitionRef.current}`,
            workspace, getWorkspace: () => latestDrawioWorkspaceRef.current,
            projectGeneration: scenarioTransitionRef.current,
            getScenarioTransitionId: () => scenarioTransitionRef.current,
            setWorkspace: replaceProjectDocument, setDiagnostics, onCompile: compileAndLayout,
            onExport: exportSource, canReplaceProject: () => projectGuardRef.current() }),
          e(ImportWorkbenchPanel, { state: importWorkbench, setState: publishImportWorkbench,
            getImportState: () => importWorkbenchRef.current,
            importRequestEpochRef, onParse: openSource, setWorkspace: replaceProjectDocument,
            setDiagnostics, compilerOptions, canReplaceProject: () => projectGuardRef.current() }),
        ),
        workspace.mode === "builder" ? e(ControlSection, { title: "Builder Inspector & Authoring", description: "Topology editing and canonical source controls.", searchTerms: "Inspector topology resources mission authoring assets" },
          e(Sidebar, { workspace, getWorkspace: () => latestDrawioWorkspaceRef.current, projectGeneration: scenarioTransitionRef.current, onPendingDraftChange, getPendingDraftChanges: hasPendingBuilderDrafts, getOtherPendingDrafts: hasOtherPendingBuilderDrafts, setWorkspace, diagnostics, setDiagnostics, notebook, setNotebook, scenarioLoadKey: verifiedDeliveryLoadKey, onVisualJourney: (nextJourney) => { setTopologyStateFocus(null); setActiveJourney(nextJourney); }, onTopologyState: (nextState) => { setActiveJourney(null); setTopologyStateFocus(nextState); } }),
        ) : null,
      ),
        workspace.mode === "runtime" ? e(Sidebar, { workspace, getWorkspace: () => latestDrawioWorkspaceRef.current, projectGeneration: scenarioTransitionRef.current, onPendingDraftChange, getPendingDraftChanges: hasPendingBuilderDrafts, getOtherPendingDrafts: hasOtherPendingBuilderDrafts, setWorkspace, diagnostics, setDiagnostics, scenarioLoadKey: verifiedDeliveryLoadKey, probeAutoOpen: importedProbeAutoOpen, diagnosticSourceRequest, onDiagnosticSourceRequestHandled: handleDiagnosticSourceRequest, onDiagnoseFromSource: requestDiagnoseFromSource, nextCheckPreparation, onNextCheckPreparationHandled: handleNextCheckPreparation, onPrepareNextCheck: prepareNextCheck, notebook, setNotebook, onVisualJourney: (nextJourney) => { setTopologyStateFocus(null); setActiveJourney(nextJourney); }, onTopologyState: (nextState) => { setActiveJourney(null); setTopologyStateFocus(nextState); } }) : null,
        e(RuntimeResults, { workspace }),
        evidenceWorkspace ? e("details", { className: "evidence-workspace", "aria-label": "Evidence workspace", "data-evidence-workspace": "ready" }, e("summary", null, "Evidence"), e("small", null, `Revision ${evidenceWorkspace.runtimeRevision} · ${evidenceWorkspace.records.length} Engine-event`), e("ol", null, ...evidenceWorkspace.records.slice(0, 12).map((record) => e("li", { key: record.eventId }, e("button", { type: "button", onClick: () => setDiagnostics([{ severity: "warning", code: "EVIDENCE_SELECTED", message: `${record.eventId} · ${record.domain} · ${record.summary}` }]) }, `${record.sequence}. ${record.domain} · ${record.eventType}`), e("small", null, record.summary)))) ) : null,
        troubleshootingTimeline ? e("details", { className: "troubleshooting-timeline", "aria-label": "Troubleshooting timeline", "data-troubleshooting-timeline": "ready" }, e("summary", null, "Troubleshooting timeline"), e("small", null, `Session ${troubleshootingTimeline.sessionId}`), e("ol", null, ...troubleshootingTimeline.entries.slice(0, 24).map((entry) => e("li", { key: `${entry.sequence}-${entry.eventId ?? entry.action}` }, e("span", null, `${entry.sequence}. ${entry.category} · ${entry.action}`), e("small", null, entry.detail ?? entry.outcome ?? "Actual event"))))) : null,
        workspace.mode === "runtime" ? e(PackagedMediaPanel, { media: runtimeMedia }) : null,
    ),
  );
}

const rootElement = document.getElementById("app");
if (!rootElement) throw new Error("Application root #app is missing.");
createRoot(rootElement).render(e(App));
