import assert from "node:assert/strict";
import fs from "node:fs";

// P2c6 is a read-only evidence/CI-wiring gate, NEVER an importer, compiler or engine.
// The following explicit historical snapshots are frozen from protected
// main 8e43ee8341b1def9bea00ea75726889a592ce4b0 (P2c5 exact release).
const historicalP2c4 = [
  {
    "id": "builtin.json",
    "ic020Refresh": {
      "checkpoint": "IC-020 P2c4",
      "evidenceMainSha": "3c2d00d73c1204827c12be276b9d15855aadbd7f",
      "evidenceTreeSha": "25ab69f011f86dd22c4528b79846a8592f0e43e3",
      "independentLinuxRelease": {
        "runId": 41234186594,
        "headSha": "3c2d00d73c1204827c12be276b9d15855aadbd7f",
        "conclusion": "success"
      },
      "sourceBoundOriginalShaRecheck": "ATTESTED_P1_ALL_FIVE",
      "manualCompetingLinkSourceChoice": "ATTESTED_P2A_SUPPORTED_INVENTORY",
      "consentedLiveReimport": "ATTESTED_P2B",
      "readOnlySavedReimportReview": "ATTESTED_P2C1",
      "typedOriginalPortChecks": "NOT_CLAIMED_FOR_THIS_SUBTYPE",
      "ambiguousInventoryAndUnmappedColumns": "ATTESTED_P2C3_ALL_FIVE",
      "compiledChromiumFileToBuilder": "ATTESTED_P1_ALL_FIVE",
      "compiledChromiumImportedModeledRuntime": "NOT_ATTESTED_FOR_THIS_SUBTYPE",
      "importedNegativeUnknownVerdictsInChromium": "NOT_ATTESTED",
      "crossRowContradictoryFactsReconciliation": "NOT_ATTESTED",
      "nativeParrotAndPhysicalNetwork": "NOT_RUN"
    }
  },
  {
    "id": "builtin.csv",
    "ic020Refresh": {
      "checkpoint": "IC-020 P2c4",
      "evidenceMainSha": "3c2d00d73c1204827c12be276b9d15855aadbd7f",
      "evidenceTreeSha": "25ab69f011f86dd22c4528b79846a8592f0e43e3",
      "independentLinuxRelease": {
        "runId": 41234186594,
        "headSha": "3c2d00d73c1204827c12be276b9d15855aadbd7f",
        "conclusion": "success"
      },
      "sourceBoundOriginalShaRecheck": "ATTESTED_P1_ALL_FIVE",
      "manualCompetingLinkSourceChoice": "ATTESTED_P2A_SUPPORTED_INVENTORY",
      "consentedLiveReimport": "ATTESTED_P2B",
      "readOnlySavedReimportReview": "ATTESTED_P2C1",
      "typedOriginalPortChecks": "NOT_CLAIMED_FOR_THIS_SUBTYPE",
      "ambiguousInventoryAndUnmappedColumns": "ATTESTED_P2C3_ALL_FIVE",
      "compiledChromiumFileToBuilder": "ATTESTED_P1_ALL_FIVE",
      "compiledChromiumImportedModeledRuntime": "ATTESTED_P1_CSV",
      "importedNegativeUnknownVerdictsInChromium": "NOT_ATTESTED",
      "crossRowContradictoryFactsReconciliation": "NOT_ATTESTED",
      "nativeParrotAndPhysicalNetwork": "NOT_RUN"
    }
  },
  {
    "id": "builtin.tsv",
    "ic020Refresh": {
      "checkpoint": "IC-020 P2c4",
      "evidenceMainSha": "3c2d00d73c1204827c12be276b9d15855aadbd7f",
      "evidenceTreeSha": "25ab69f011f86dd22c4528b79846a8592f0e43e3",
      "independentLinuxRelease": {
        "runId": 41234186594,
        "headSha": "3c2d00d73c1204827c12be276b9d15855aadbd7f",
        "conclusion": "success"
      },
      "sourceBoundOriginalShaRecheck": "ATTESTED_P1_ALL_FIVE",
      "manualCompetingLinkSourceChoice": "ATTESTED_P2A_SUPPORTED_INVENTORY",
      "consentedLiveReimport": "ATTESTED_P2B",
      "readOnlySavedReimportReview": "ATTESTED_P2C1",
      "typedOriginalPortChecks": "NOT_CLAIMED_FOR_THIS_SUBTYPE",
      "ambiguousInventoryAndUnmappedColumns": "ATTESTED_P2C3_ALL_FIVE",
      "compiledChromiumFileToBuilder": "ATTESTED_P1_ALL_FIVE",
      "compiledChromiumImportedModeledRuntime": "NOT_ATTESTED_FOR_THIS_SUBTYPE",
      "importedNegativeUnknownVerdictsInChromium": "NOT_ATTESTED",
      "crossRowContradictoryFactsReconciliation": "NOT_ATTESTED",
      "nativeParrotAndPhysicalNetwork": "NOT_RUN"
    }
  },
  {
    "id": "builtin.xlsx",
    "ic020Refresh": {
      "checkpoint": "IC-020 P2c4",
      "evidenceMainSha": "3c2d00d73c1204827c12be276b9d15855aadbd7f",
      "evidenceTreeSha": "25ab69f011f86dd22c4528b79846a8592f0e43e3",
      "independentLinuxRelease": {
        "runId": 41234186594,
        "headSha": "3c2d00d73c1204827c12be276b9d15855aadbd7f",
        "conclusion": "success"
      },
      "sourceBoundOriginalShaRecheck": "ATTESTED_P1_ALL_FIVE",
      "manualCompetingLinkSourceChoice": "ATTESTED_P2A_SUPPORTED_INVENTORY",
      "consentedLiveReimport": "ATTESTED_P2B",
      "readOnlySavedReimportReview": "ATTESTED_P2C1",
      "typedOriginalPortChecks": "ATTESTED_P2C2_SIX_SHEET",
      "ambiguousInventoryAndUnmappedColumns": "ATTESTED_P2C3_ALL_FIVE",
      "compiledChromiumFileToBuilder": "ATTESTED_P1_ALL_FIVE",
      "compiledChromiumImportedModeledRuntime": "NOT_ATTESTED_FOR_THIS_SUBTYPE",
      "importedNegativeUnknownVerdictsInChromium": "NOT_ATTESTED",
      "crossRowContradictoryFactsReconciliation": "NOT_ATTESTED",
      "nativeParrotAndPhysicalNetwork": "NOT_RUN"
    }
  },
  {
    "id": "builtin.ods",
    "ic020Refresh": {
      "checkpoint": "IC-020 P2c4",
      "evidenceMainSha": "3c2d00d73c1204827c12be276b9d15855aadbd7f",
      "evidenceTreeSha": "25ab69f011f86dd22c4528b79846a8592f0e43e3",
      "independentLinuxRelease": {
        "runId": 41234186594,
        "headSha": "3c2d00d73c1204827c12be276b9d15855aadbd7f",
        "conclusion": "success"
      },
      "sourceBoundOriginalShaRecheck": "ATTESTED_P1_ALL_FIVE",
      "manualCompetingLinkSourceChoice": "ATTESTED_P2A_SUPPORTED_INVENTORY",
      "consentedLiveReimport": "ATTESTED_P2B",
      "readOnlySavedReimportReview": "ATTESTED_P2C1",
      "typedOriginalPortChecks": "ATTESTED_P2C2_SIX_SHEET",
      "ambiguousInventoryAndUnmappedColumns": "ATTESTED_P2C3_ALL_FIVE",
      "compiledChromiumFileToBuilder": "ATTESTED_P1_ALL_FIVE",
      "compiledChromiumImportedModeledRuntime": "ATTESTED_P2C2_ODS",
      "importedNegativeUnknownVerdictsInChromium": "NOT_ATTESTED",
      "crossRowContradictoryFactsReconciliation": "NOT_ATTESTED",
      "nativeParrotAndPhysicalNetwork": "NOT_RUN"
    }
  }
];
const historicalP2c4Audit = {
  "basis": "SOURCE_BACKED_SUBSET_REFRESH_NOT_FULL_FUNCTIONAL_CERTIFICATION",
  "evidenceMainSha": "3c2d00d73c1204827c12be276b9d15855aadbd7f",
  "evidenceTreeSha": "25ab69f011f86dd22c4528b79846a8592f0e43e3",
  "releaseRun": 41234186594,
  "note": "Historical auditBaseline is intentionally unchanged; five active adapters only updated. Other 22 profile statuses remain the original IC-000 audit observations, not current full-feature certification. IC-020 exit remains open."
};
const untouchedProfiles = [
  {
    "id": "native.scenario.json",
    "registry": "NATIVE_SCENARIO",
    "stage": {
      "detect": "NATIVE_FORMAT_ID",
      "parse": "NATIVE_JSON",
      "preview": "SCENARIO_WORKBENCH",
      "review": "COMPILER_VALIDATION",
      "projection": "NATIVE_SCENARIO_SOURCE",
      "builder": "NATIVE_SOURCE_EXPLICIT",
      "modeledProbe": "SCENARIO_RUNTIME_SEPARATE",
      "replay": "NONE",
      "ui": "SCENARIO_FILE_MENU"
    },
    "ciCoverage": "SOURCE_TEST_NOT_IN_REQUIRED_GATE",
    "nextCheckpoint": "IC-020"
  },
  {
    "id": "graphml.structural.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "SPECIALIZED_FILE_ENTRY",
      "parse": "BOUNDED_READ_ONLY",
      "preview": "SPECIALIZED_MODAL",
      "review": "EXPLICIT_ROLES_AND_EDGES",
      "projection": "REVIEWED_GRAPHML_CANDIDATE",
      "builder": "MANUAL_COMPILE_LAYOUT",
      "modeledProbe": "NOT_ATTESTED",
      "replay": "NONE",
      "ui": "SPECIALIZED_MODAL"
    },
    "ciCoverage": "DEDICATED_TESTS_AND_WORKFLOWS_NOT_CORE_REQUIRED",
    "nextCheckpoint": "IC-030"
  },
  {
    "id": "nmap.xml.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "SPECIALIZED_FILE_ENTRY",
      "parse": "BOUNDED_READ_ONLY",
      "preview": "EVIDENCE_ONLY",
      "review": "SOURCE_BOUND_REFERENCE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "SOURCE_BOUND_REPORT",
      "ui": "SPECIALIZED_MODAL"
    },
    "ciCoverage": "DEDICATED_TESTS_AND_WORKFLOWS_NOT_CORE_REQUIRED",
    "nextCheckpoint": "IC-070"
  },
  {
    "id": "nessus.xml.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "SPECIALIZED_FILE_ENTRY",
      "parse": "BOUNDED_READ_ONLY",
      "preview": "EVIDENCE_ONLY",
      "review": "SOURCE_BOUND_REFERENCE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "SOURCE_BOUND_REPORT",
      "ui": "SPECIALIZED_MODAL"
    },
    "ciCoverage": "DEDICATED_TESTS_AND_WORKFLOWS_NOT_CORE_REQUIRED",
    "nextCheckpoint": "IC-070"
  },
  {
    "id": "diagrams.drawio.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "SPECIALIZED_FILE_ENTRY",
      "parse": "BOUNDED_READ_ONLY",
      "preview": "SPECIALIZED_MODAL",
      "review": "SOURCE_BOUND_REFERENCE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "SOURCE_BOUND_REPORT",
      "ui": "SPECIALIZED_MODAL"
    },
    "ciCoverage": "DEDICATED_TESTS_AND_WORKFLOWS_NOT_CORE_REQUIRED",
    "nextCheckpoint": "IC-030"
  },
  {
    "id": "visio.vsdx.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "HINT_ONLY_BLOCKED",
      "parse": "NONE",
      "preview": "NONE",
      "review": "NONE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "NONE",
      "ui": "NONE"
    },
    "ciCoverage": "HINT_REGISTRY_NEGATIVE_ONLY",
    "nextCheckpoint": "IC-080"
  },
  {
    "id": "gns3.project.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "HINT_ONLY_BLOCKED",
      "parse": "NONE",
      "preview": "NONE",
      "review": "NONE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "NONE",
      "ui": "NONE"
    },
    "ciCoverage": "HINT_REGISTRY_NEGATIVE_ONLY",
    "nextCheckpoint": "IC-080"
  },
  {
    "id": "eve-ng.unl.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "HINT_ONLY_BLOCKED",
      "parse": "NONE",
      "preview": "NONE",
      "review": "NONE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "NONE",
      "ui": "NONE"
    },
    "ciCoverage": "HINT_REGISTRY_NEGATIVE_ONLY",
    "nextCheckpoint": "IC-080"
  },
  {
    "id": "cisco-cml.yaml.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "HINT_ONLY_BLOCKED",
      "parse": "NONE",
      "preview": "NONE",
      "review": "NONE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "NONE",
      "ui": "NONE"
    },
    "ciCoverage": "HINT_REGISTRY_NEGATIVE_ONLY",
    "nextCheckpoint": "IC-080"
  },
  {
    "id": "inventory.yaml.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "SPECIALIZED_FILE_ENTRY",
      "parse": "BOUNDED_READ_ONLY",
      "preview": "SPECIALIZED_MODAL",
      "review": "SOURCE_BOUND_REFERENCE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "SOURCE_BOUND_REPORT",
      "ui": "SPECIALIZED_MODAL"
    },
    "ciCoverage": "DEDICATED_TESTS_AND_WORKFLOWS_NOT_CORE_REQUIRED",
    "nextCheckpoint": "IC-060"
  },
  {
    "id": "ansible.inventory.ini.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "SPECIALIZED_FILE_ENTRY",
      "parse": "BOUNDED_READ_ONLY",
      "preview": "SPECIALIZED_MODAL",
      "review": "SOURCE_BOUND_REFERENCE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "SOURCE_BOUND_REPORT",
      "ui": "SPECIALIZED_MODAL"
    },
    "ciCoverage": "DEDICATED_TESTS_AND_WORKFLOWS_NOT_CORE_REQUIRED",
    "nextCheckpoint": "IC-060"
  },
  {
    "id": "configuration.text.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "HINT_ONLY_BLOCKED",
      "parse": "NONE",
      "preview": "NONE",
      "review": "NONE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "NONE",
      "ui": "NONE"
    },
    "ciCoverage": "HINT_REGISTRY_NEGATIVE_ONLY",
    "nextCheckpoint": "IC-090"
  },
  {
    "id": "office.docx-tables.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "SPECIALIZED_FILE_ENTRY",
      "parse": "BOUNDED_READ_ONLY",
      "preview": "TABLE_STRUCTURE_ONLY",
      "review": "CONSENTED_CELL_REFERENCE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "SOURCE_BOUND_REPORT",
      "ui": "SPECIALIZED_MODAL"
    },
    "ciCoverage": "DEDICATED_TESTS_AND_WORKFLOWS_NOT_CORE_REQUIRED",
    "nextCheckpoint": "IC-040"
  },
  {
    "id": "office.odt-tables.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "SPECIALIZED_FILE_ENTRY",
      "parse": "BOUNDED_READ_ONLY",
      "preview": "TABLE_STRUCTURE_ONLY",
      "review": "CONSENTED_CELL_REFERENCE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "SOURCE_BOUND_REPORT",
      "ui": "SPECIALIZED_MODAL"
    },
    "ciCoverage": "DEDICATED_TESTS_AND_WORKFLOWS_NOT_CORE_REQUIRED",
    "nextCheckpoint": "IC-040"
  },
  {
    "id": "pdf.digital-tables.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "HINT_ONLY_BLOCKED",
      "parse": "NONE",
      "preview": "NONE",
      "review": "NONE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "NONE",
      "ui": "NONE"
    },
    "ciCoverage": "HINT_REGISTRY_NEGATIVE_ONLY",
    "nextCheckpoint": "IC-050"
  },
  {
    "id": "terraform.hcl.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "HINT_ONLY_BLOCKED",
      "parse": "NONE",
      "preview": "NONE",
      "review": "NONE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "NONE",
      "ui": "NONE"
    },
    "ciCoverage": "HINT_REGISTRY_NEGATIVE_ONLY",
    "nextCheckpoint": "IC-090"
  },
  {
    "id": "terraform.state.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "HINT_ONLY_BLOCKED",
      "parse": "NONE",
      "preview": "NONE",
      "review": "NONE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "NONE",
      "ui": "NONE"
    },
    "ciCoverage": "HINT_REGISTRY_NEGATIVE_ONLY",
    "nextCheckpoint": "IC-090"
  },
  {
    "id": "capture.pcap.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "HINT_ONLY_BLOCKED",
      "parse": "NONE",
      "preview": "NONE",
      "review": "NONE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "NONE",
      "ui": "NONE"
    },
    "ciCoverage": "HINT_REGISTRY_NEGATIVE_ONLY",
    "nextCheckpoint": "IC-100"
  },
  {
    "id": "windows.evtx.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "HINT_ONLY_BLOCKED",
      "parse": "NONE",
      "preview": "NONE",
      "review": "NONE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "NONE",
      "ui": "NONE"
    },
    "ciCoverage": "HINT_REGISTRY_NEGATIVE_ONLY",
    "nextCheckpoint": "IC-100"
  },
  {
    "id": "logs.jsonl.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "HINT_ONLY_BLOCKED",
      "parse": "NONE",
      "preview": "NONE",
      "review": "NONE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "NONE",
      "ui": "NONE"
    },
    "ciCoverage": "HINT_REGISTRY_NEGATIVE_ONLY",
    "nextCheckpoint": "IC-090"
  },
  {
    "id": "logs.text.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "HINT_ONLY_BLOCKED",
      "parse": "NONE",
      "preview": "NONE",
      "review": "NONE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "NONE",
      "ui": "NONE"
    },
    "ciCoverage": "HINT_REGISTRY_NEGATIVE_ONLY",
    "nextCheckpoint": "IC-090"
  },
  {
    "id": "html.static-tables.v1",
    "registry": "PLANNED_HINT",
    "stage": {
      "detect": "HINT_ONLY_BLOCKED",
      "parse": "NONE",
      "preview": "NONE",
      "review": "NONE",
      "projection": "NONE",
      "builder": "NONE",
      "modeledProbe": "NONE",
      "replay": "NONE",
      "ui": "NONE"
    },
    "ciCoverage": "HINT_REGISTRY_NEGATIVE_ONLY",
    "nextCheckpoint": "IC-090"
  }
];
const profileIds = ["builtin.json","builtin.csv","builtin.tsv","builtin.xlsx","builtin.ods"];
const evidencePaths = [
  "tests/browser/run_ic020_p2c5_truth_tests.mjs",
  "tests/acceptance/run_ic020_p2c5_truth_real_browser.py",
];
const expectedSourceTests = [
  "test:ic020-p1-source-freshness","test:ic020-p2a-link-review",
  "test:ic020-p2b-reimport-review","test:ic020-p2c1-sidecar-replay",
  "test:ic020-p2c2-multisheet","test:ic020-p2c3-unmapped",
  "test:ic020-p2c4-matrix","test:ic020-p2c5-truth",
  "test:ic020-p2c6-exit"
];
const browserPaths = [
  "run_ic020_p1_core_inventory_real_browser.py",
  "run_ic020_p2a_link_review_real_browser.py",
  "run_ic020_p2b_reimport_real_browser.py",
  "run_ic020_p2c1_saved_report_real_browser.py",
  "run_ic020_p2c2_multisheet_real_browser.py",
  "run_ic020_p2c3_unmapped_real_browser.py",
  "run_ic020_p2c5_truth_real_browser.py"
];
// Historical IC-000/P2c4 evidence above remains byte-for-byte frozen. Only
// these two independently delivered IC-030 specialized Builder profiles can
// advance beyond the historical read-only snapshot; no other profile relaxes.
const acceptedIc030P3 = {
  "graphml.structural.v1": {
    registry: "PLANNED_HINT",
    stage: {
      detect: "SPECIALIZED_GRAPHML_FILE_ENTRY",
      parse: "BOUNDED_GRAPHML_ORIGINAL_XML_SHA",
      preview: "ORIGINAL_SHA_READ_ONLY_SPECIALIZED_MODAL",
      review: "MANUAL_NODE_ROLES_FIRST_80_AND_UNDIRECTED_EDGES_ACK",
      projection: "EXPLICIT_REVIEWED_GRAPHML_WORKBOOK_CANDIDATE",
      builder: "REAL_COMPILER_ELK_ORIGINAL_REREAD_WORKSPACE_GATE",
      modeledProbe: "NOT_ATTESTED_NO_AUTOMATIC_RUNTIME",
      replay: "NO_SAVED_REPORT_ORIGINAL_REREAD_AT_COMMIT",
      ui: "SPECIALIZED_REVIEW_MODAL_BUILDER_CONFIRM_ONLY",
    },
    ciCoverage: "REQUIRED_AND_POSTMERGE_SOURCE_PLUS_REAL_CHROMIUM_GATES_CHECK_EXACT_SHA",
    nextCheckpoint: "IC-040_AFTER_VERIFIED_P3_RELEASE"
  },
  "diagrams.drawio.v1": {
    registry: "PLANNED_HINT",
    stage: {
      detect: "SPECIALIZED_DRAWIO_P1P6_XML_READ_ONLY_AND_P2B_DRAWIO_ONLY",
      parse: "BOUNDED_2MIB_16P_1000V_2000E_RAW_DEFLATE_SHA",
      preview: "SEPARATE_READ_ONLY_AND_ORDINAL_ONLY_P2B_MODALS",
      review: "P1P6_REFERENCE_ONLY_OR_P2B_1_TO_20_EXPLICIT_NODES_EDGES_ACK",
      projection: "P2B_EXPLICIT_REVIEWED_DRAWIO_GRAPH_CANDIDATE_ONLY",
      builder: "P2B_REAL_COMPILER_ELK_LAST_ORIGINAL_REREAD_WORKSPACE_GATE",
      modeledProbe: "NOT_ATTESTED_NO_AUTOMATIC_RUNTIME",
      replay: "P1P6_REFERENCE_REPORT_ONLY_P2B_CANDIDATE_NOT_REPLAYED",
      ui: "SEPARATE_READ_ONLY_AND_P2B_REVIEWED_BUILDER_MODALS",
    },
    ciCoverage: "REQUIRED_AND_POSTMERGE_P1P6_AND_P2B_SOURCE_PLUS_REAL_CHROMIUM_CHECK_EXACT_SHA",
    nextCheckpoint: "IC-040_AFTER_VERIFIED_P3_RELEASE"
  }
};
const ic030ScopedIds = new Set(Object.keys(acceptedIc030P3));
const read=p=>fs.readFileSync(p,"utf8");
const matrix=JSON.parse(read("docs/architecture/import-capability-matrix.v1.json"));
const workflows=[
  read(".github/workflows/required-ci.yml"),
  read(".github/workflows/release-identity.yml")
];
let assertions=0;
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);assertions++;};
const yes=(v,label)=>{assert.ok(v,label);assertions++;};
function consistent(model) {
 if(model.formatId!=="yadilab.import.capability-audit" ||
   model.schemaVersion!=="1.0.0" ||
   model.status!=="SOURCE_AUDIT_NOT_FUNCTIONAL_CERTIFICATION" ||
   model.profiles?.length!==27 ||
   model.auditBaseline?.mainSha!=="56d2b9c11f65e8ce7b205a924db40c8d1d711219" ||
   JSON.stringify(model.auditRefreshP2c4)!==JSON.stringify(historicalP2c4Audit)) return false;
 const other=model.profiles.filter(p=>p.registry!=="ACTIVE_ADAPTER")
   .map(p=>({id:p.id,registry:p.registry,stage:p.stage,ciCoverage:p.ciCoverage,nextCheckpoint:p.nextCheckpoint}));
 // P2c6 freezes the historical 22 non-active snapshots. Preserve all 20
 // unaffected records identically, and verify both later IC-030 exceptions
 // against independent exact source/Builder/probe-nonclaim expectations.
 const historicalOther=untouchedProfiles.filter(p=>!ic030ScopedIds.has(p.id));
 const currentOther=other.filter(p=>!ic030ScopedIds.has(p.id));
 if(JSON.stringify(currentOther)!==JSON.stringify(historicalOther)) return false;
 if(other.filter(p=>ic030ScopedIds.has(p.id)).length!==2) return false;
 for(const [id, expected] of Object.entries(acceptedIc030P3)){
   const p=other.find(x=>x.id===id);
   if(!p || JSON.stringify(p)!==JSON.stringify({id,...expected})) return false;
   const full=model.profiles.find(x=>x.id===id);
   if(!full || full.track!=="TOPOLOGY_DECLARED" ||
      !full.sources.every(f=>fs.existsSync(f)) ||
      !full.tests.every(f=>fs.existsSync(f))) return false;
 }
 const active=model.profiles.filter(p=>p.registry==="ACTIVE_ADAPTER");
 if(JSON.stringify(active.map(p=>p.id))!==JSON.stringify(profileIds) ||
   JSON.stringify(active.map(p=>({id:p.id,ic020Refresh:p.ic020Refresh})))!==JSON.stringify(historicalP2c4)) return false;
 const a=model.auditRefreshP2c6;
 if(a?.basis!=="FIVE_ACTIVE_ADAPTERS_SOURCE_AND_CHROMIUM_SCOPED_EXIT_EVIDENCE" ||
   a?.preAuditMainSha!=="8e43ee8341b1def9bea00ea75726889a592ce4b0" ||
   a?.preAuditTreeSha!=="b04a3d49f28fdf5da730088bc4c31ecc37168fb2" ||
   a?.previousVerifiedIndependentRelease!==41237691702 ||
   a?.status!=="CODE_EVIDENCE_MET_P2C6_HEAD_CI_AND_POSTMERGE_RELEASE_REQUIRED_FOR_FINAL_VERIFICATION") return false;
 const expectedRisk="Only explicitly declared source records, connections and modeled Engine results are supported.";
 for(const p of active){
   const office=p.id==="builtin.xlsx"||p.id==="builtin.ods";
   const v=p.ic020CurrentEvidence;
   if(p.stage.modeledProbe!=="IMPORTED_MODELED_RUNTIME_SOURCE_AND_CHROMIUM_VERIFIED" ||
      p.ciCoverage!=="REQUIRED_IC020_P1_TO_P2C6_SOURCE_AND_BROWSER; SCOPED_EXIT_TRUTH_REGRESSION" ||
      p.nextCheckpoint!=="IC-030" || !p.risk.startsWith(expectedRisk) ||
      !evidencePaths.every(f=>p.tests.includes(f)) ||
      !p.tests.every(f=>fs.existsSync(f)) ||
      !p.sources.every(f=>fs.existsSync(f)) ||
      new Set(p.tests).size!==p.tests.length ||
      !v || v.checkpoint!=="IC-020 P2c6" ||
      v.preAuditMainSha!=="8e43ee8341b1def9bea00ea75726889a592ce4b0" ||
      v.preAuditTreeSha!=="b04a3d49f28fdf5da730088bc4c31ecc37168fb2" ||
      v.independentlyVerifiedPreviousRelease?.runId!==41237691702 ||
      v.independentlyVerifiedPreviousRelease?.headSha!=="8e43ee8341b1def9bea00ea75726889a592ce4b0" ||
      v.independentlyVerifiedPreviousRelease?.conclusion!=="success" ||
      v.scope!=="FIVE_ACTIVE_NETWORK_INVENTORY_FORMATS_TESTED_SOURCE_VARIANTS_ONLY" ||
      v.consentAndOriginalSha!=="P1_TO_P2C5_SHA_BOUND_REPARSE_ATTESTED" ||
      v.manualConflictingLinkSource!=="P2A_ATTESTED_FOR_TESTED_SOURCES" ||
      v.reimportReplacementAndReplay!=="P2B_P2C1_READ_ONLY_EXPLICIT_APPROVAL_ATTESTED" ||
      v.ambiguousCompetingTablesAndUnmappedPrivacy!=="P2C3_BLOCK_AND_WARNING_ATTESTED" ||
      v.flatDevicesAddressPrefixConflict!=="P2C5_ALL_FIVE_BLOCKED_IN_SOURCE_AND_CHROMIUM" ||
      v.flatDevicesProbeModeledWindowsLinux!=="P2C5_ALL_FIVE_FALSE_OFFLINK_UNKNOWN_DNS_CHROMIUM" ||
      v.compiledChromiumNativeFilePicker!=="P1_ALL_FIVE" ||
      v.canonicalSixSheetPortValidation!==(office?"P2C2_XLSX_ODS_TYPED_PORTS_SOURCE_AND_CHROMIUM":"NOT_APPLICABLE") ||
      v.canonicalSixSheetModeledRuntimeBrowser!==(p.id==="builtin.ods"
        ?"P2C2_ODS_PROBE_INTERACTION_VERDICT_NOT_RESTRICTED"
        :p.id==="builtin.xlsx"?"NOT_ATTESTED_FOR_XLSX_SIX_SHEET_PROBE":"NOT_APPLICABLE") ||
      v.canonicalSixSheetFalseUnknownChromium!==(office?"NOT_ATTESTED_FOR_CANONICAL_SIX_SHEET":"NOT_APPLICABLE") ||
      v.modeledBoundary!=="NO_GUEST_COMMAND_EXECUTION" ||
      v.nativeParrotAndPhysicalNetwork!=="NOT_RUN") return false;
 }
 return true;
}
yes(consistent(matrix),"Historical IC-000/P2c4 snapshots and truthful scoped P2c6 current evidence");
eq(matrix.profiles.filter(p=>p.registry==="ACTIVE_ADAPTER").length,5);
eq(matrix.profiles.filter(p=>p.registry==="NATIVE_SCENARIO").length,1);
eq(matrix.profiles.filter(p=>p.registry==="PLANNED_HINT").length,21);
for(const profile of matrix.profiles.filter(p=>p.registry==="ACTIVE_ADAPTER")){
 for(const file of [...profile.sources,...profile.tests])yes(fs.existsSync(file),"Actual source/test exists: "+file);
}
for(const script of expectedSourceTests){
 const scripts=JSON.parse(read("package.json")).scripts;
 yes(typeof scripts[script]==="string","Registered source gate: "+script);
 for(const [index,workflow] of workflows.entries())yes(workflow.includes("npm run "+script),
    ["required-ci","release-identity"][index]+" invokes "+script);
}
for(const p of browserPaths){
 const file="tests/acceptance/"+p;
 yes(fs.existsSync(file),"Actual Chromium test exists: "+file);
 for(const [index,workflow] of workflows.entries())yes(workflow.includes(p),
   ["required-ci","release-identity"][index]+" runs "+p);
}
for(const path of [
 "docs/architecture/IC_020_P2C6_SCOPED_EXIT_ORACLES.md",
 "docs/architecture/IC_020_P2C6_SCOPED_EXIT_AUDIT.md",
 "docs/architecture/IMPORT_COMPLETION_EXECUTION_MASTERPLAN.md",
 "tests/fixtures/import/generate_ic020_p2c5_network.py",
 "tests/fixtures/import/generate_ic020_p2c2_workbooks.py"
])yes(fs.existsSync(path),"Evidence/fixture exists: "+path);
const mutated=modify=>{const copy=structuredClone(matrix);modify(copy);return copy;};
const reject=(modify,label)=>eq(consistent(mutated(modify)),false,label);
reject(m=>m.profiles.find(p=>p.id==="builtin.xlsx").ic020CurrentEvidence.canonicalSixSheetFalseUnknownChromium="ATTESTED",
 "Cannot invent canonical six-sheet XLSX FALSE/UNKNOWN");
reject(m=>m.profiles.find(p=>p.id==="builtin.xlsx").ic020CurrentEvidence.canonicalSixSheetModeledRuntimeBrowser="ATTESTED",
 "Cannot invent canonical six-sheet XLSX Runtime Chromium");
reject(m=>m.profiles.find(p=>p.id==="builtin.tsv").ic020CurrentEvidence.flatDevicesProbeModeledWindowsLinux="ALL_DOCUMENTS_PASS",
 "Cannot generalize from tested flat Devices oracles");
reject(m=>m.profiles.find(p=>p.id==="builtin.json").ic020CurrentEvidence.nativeParrotAndPhysicalNetwork="PASS",
 "No physical/Parrot testing has occurred");
reject(m=>m.profiles.find(p=>p.id==="builtin.csv").ic020CurrentEvidence.modeledBoundary="LIVE_COMMANDS",
 "Cannot promote Engine modeling to guest command execution");
reject(m=>m.profiles.find(p=>p.id==="builtin.ods").ic020Refresh.importedNegativeUnknownVerdictsInChromium="PASS",
 "P2c4 historical NOT_ATTESTED must stay historically accurate");
reject(m=>m.auditRefreshP2c4.releaseRun=41237691702,
 "Cannot retroactively swap historical P2c4 run");
reject(m=>m.auditRefreshP2c6.previousVerifiedIndependentRelease=41234186594,
 "Cannot misattribute P2c5 release identity");
reject(m=>m.profiles.find(p=>p.id==="pdf.digital-tables.v1").stage.builder="DIRECT_ACTIVATION",
 "Cannot invent PDF Builder support");
reject(m=>m.profiles.find(p=>p.id==="builtin.ods").tests=[],
 "Cannot lose referenced oracle evidence");
reject(m=>m.profiles.find(p=>p.id==="graphml.structural.v1").stage.modeledProbe="VERIFIED_RUNTIME",
 "Future GraphML probe claims may not rewrite historical IC-020 evidence");
reject(m=>m.profiles.find(p=>p.id==="diagrams.drawio.v1").stage.builder="NONE",
 "Later delivered P2b Builder cannot be erased from source truth");
reject(m=>m.profiles.find(p=>p.id==="diagrams.drawio.v1").stage.projection="AUTO_PHYSICAL_TOPOLOGY",
 "Drawn edges never prove physical network connectivity");
reject(m=>m.profiles.find(p=>p.id==="builtin.json").ic020CurrentEvidence.flatDevicesAddressPrefixConflict="INFERRED",
 "Cannot transform explicit conflicts into inferred truth");
reject(m=>m.profiles.find(p=>p.id==="builtin.csv").nextCheckpoint="COMPLETE_ALL_IMPORTS",
 "Cannot close IC-030 through IC-110 by closing IC-020");
console.log("PASS IC-020 P2c6 scoped five-format completion evidence with frozen historical profile truth: "+
 assertions+" read-only assertions");
