export type { EnterpriseImportAdapter, EnterpriseImportHashProvider, EnterpriseImportRequest, EnterpriseImportResult, EnterpriseImportSourceInput, EnterpriseMappingReviewArtifact, EnterpriseMappingReviewRequest, EnterpriseMappingReviewResult, EnterpriseReimportDiffArtifact, ImportDiagnostic, ImportDocument, ImportRecord, ImportTable, MappingClass, MappingReviewDecision } from "./types.js";
export type { WorkbookArchiveLimits, SafeWorkbookArchive } from "./workbook-archive.js";
export { EnterpriseImportError } from "./types.js";
export { csvImportAdapter, tsvImportAdapter } from "./delimited.js";
export { jsonImportAdapter } from "./json.js";
export { createXlsxImportAdapter, xlsxImportAdapter } from "./xlsx.js";
export { createOdsImportAdapter, odsImportAdapter } from "./ods.js";
export { DEFAULT_WORKBOOK_LIMITS, openSafeWorkbookArchive } from "./workbook-archive.js";
export { builtinEnterpriseImportAdapters, selectEnterpriseImportAdapter } from "./adapters.js";
export { computeMappingProfileHash, computeRawValueHash, webCryptoImportHashProvider } from "./hash.js";
export { mapImportDocumentToBaseline } from "./mapping.js";
export { runEnterpriseImport } from "./pipeline.js";

export { analyzeEnterpriseMapping, applyMappingReviewDecisions, runEnterpriseMappingReview } from "./review.js";
export { compareEnterpriseBaselines } from "./reimport.js";

export { computeExternalMappingProfileHash, externalDataCapabilities, mapExternalDocumentToCanonicalScenario, previewExternalMapping } from "./external-mapping.js";
export type { ExternalCanonicalMappingResult, ExternalFormatCapability, ExternalFormatStatus, ExternalMappingPreview } from "./external-mapping.js";
export { mapNetworkWorkbookToScenario, previewNetworkWorkbook, standardWorkbookSheets, validateNetworkWorkbook, YADILAB_NETWORK_WORKBOOK_SCHEMA_VERSION } from "./workbook-mapping.js";
export type { StandardWorkbookSheet, WorkbookImportResult, WorkbookPreview } from "./workbook-mapping.js";
export { resolveReconciliationGroup, searchReconciliation, summarizeReconciliation } from "./reconciliation.js";
export type { ReconciliationGroup, ReconciliationStatus, ReconciliationSummary } from "./reconciliation.js";

export * from "./merge.js";
export { normalizeNetworkInventoryDocument } from "./network-inventory.js";

// Read-only GraphML candidate preview. Does NOT register an import adapter or activate a scenario.
export { GRAPHML_PREVIEW_PROFILE, previewGraphmlReadOnly } from "./graphml-preview.js";
export type { GraphmlReadOnlyPreview, GraphmlPreviewNode, GraphmlPreviewEdge, GraphmlSourceLocator } from "./graphml-preview.js";

// Explicit GraphML review-to-Builder mapping: no automatic inferred links.
export { GRAPHML_MANUAL_ROLE_OPTIONS, mapReviewedGraphmlToBuilder } from "./graphml-review-mapping.js";
export type { GraphmlManualReview, GraphmlManualRole, GraphmlBuilderMapping, GraphmlMappedOrigin } from "./graphml-review-mapping.js";

// Read-only Nmap scan-time observations. NOT an active importer or Engine source.
export { NMAP_EVIDENCE_PROFILE, previewNmapXmlObservations } from "./nmap-xml-preview.js";
export type { NmapReadOnlyEvidence, NmapObservedHost, NmapObservedPort, NmapEvidenceLocator } from "./nmap-xml-preview.js";

// Reviewed Nmap association sidecars are independent of ScenarioSource/Engine.
export { reviewNmapObservationAssociations } from "./nmap-association-review.js";
export type {
  NmapModelSnapshot, NmapModeledResource, NmapManualAssociationDecision,
  NmapReviewedAssociation, NmapAssociationSidecar, NmapAssociationResult,
} from "./nmap-association-review.js";

// Strict Ansible YAML static inventory evidence preview. NOT an active adapter.
export { ANSIBLE_YAML_PREVIEW_PROFILE, previewAnsibleStaticInventory } from "./ansible-yaml-preview.js";
export type { AnsibleStaticInventoryPreview, AnsibleHostObservation, AnsibleInventoryLocator } from "./ansible-yaml-preview.js";

// Operator-reviewed Ansible inventory associations: separate JSON sidecar, NOT an Engine source.
export { ANSIBLE_ASSOCIATION_FORMAT, reviewAnsibleInventoryAssociations } from "./ansible-association-review.js";
export type { AnsibleModeledResource, AnsibleBuilderSnapshot, AnsibleAssociationDecision,
  AnsibleReviewedAssociation, AnsibleAssociationSidecar, AnsibleAssociationResult } from "./ansible-association-review.js";

// IC-010/P1: bounded producer-validated read-only XML profile metadata; never an active adapter.
export { inspectStructuredXmlSourceReadOnly } from "./structured-xml-source-inspection.js";
export type { ReadOnlyXmlProfileId, XmlSourceSummary, OriginalXmlSourceLocator, XmlSourceBlockedCode, BlockedXmlSource, InspectedXmlSource, ReadOnlyXmlInspection } from "./structured-xml-source-inspection.js";

// IC-010/P3a: metadata-only static Ansible inventory inspection; no new adapter.
export { inspectStaticAnsibleSourceReadOnly } from "./structured-ansible-source-inspection.js";
export type { AnsibleStaticProfileId, AnsibleBlockedCode, AnsibleDocumentLocator, AnsibleAggregateSummary, AnsibleBlockedInspection, AnsibleReadOnlyInspection, AnsibleStaticInspection } from "./structured-ansible-source-inspection.js";
