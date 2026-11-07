#!/usr/bin/env python3
"""Frozen-first adversarial source gate for SCALE-001 P4d1 Ubuntu metrics.

This deliberately fails on frozen-only baseline because the separate
production measurement validator does not exist yet. No browser test altered.
"""
import copy
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "tests/qualification/scale001_p4d1_measured_acceptance.py"
assert TARGET.is_file(), "EXPECTED RED P4D1_METRIC_VALIDATOR_NOT_IMPLEMENTED"
spec = importlib.util.spec_from_file_location("scale001_p4d1_measured_acceptance", TARGET)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert callable(module.validate_evidence), "P4D1_VALIDATE_EVIDENCE_MISSING"

SHA = "a" * 40
PATH = "tests/acceptance/run_scale001_p4c4a_10000_office_one_edit_real_browser.py"

def case(fmt):
    return {
        "format": fmt, "status": "PASS",
        "originalDevices": 10000, "originalPortLinks": 10000,
        "editedCanonicalDevices": 10001,
        "originalPagesChecked": [1, 2, 50, 100],
        "independentUnlinkedPage": 101,
        "extraPageNodes": 1, "extraPageLinks": 0,
        "secondAppendDenied": True, "unboundedGraphRendered": False,
        "engineVerified": False, "physicalTopologyVerified": False,
    }

good = {
    "schemaVersion": 1, "gitSha": SHA, "runnerOs": "Linux",
    "acceptanceTest": PATH, "exitCode": 0,
    "elapsedSeconds": 48.125,
    "sampling": {
        "intervalSeconds": 0.2, "samples": 40,
        "peakProcessTreeRssKiB": 250000,
        "peakProcessTreePssKiB": 170000,
    },
    "acceptance": {
        "status": "PASS", "cases": [case("docx"), case("odt")],
        "noFullGraph": True, "engineVerified": False,
        "physicalTopologyVerified": False,
    },
    "performanceSloCertified": False,
}
assert module.validate_evidence(copy.deepcopy(good), SHA) is True

def rejected(label, mutate):
    evidence = copy.deepcopy(good)
    mutate(evidence)
    try:
        result = module.validate_evidence(evidence, SHA)
    except (ValueError, TypeError, AssertionError):
        return
    assert result is not True, "P4D1_INVALID_EVIDENCE_ACCEPTED: " + label

negative = [
    ("missing_sha", lambda x: x.pop("gitSha")),
    ("bogus_sha", lambda x: x.update(gitSha="b"*40)),
    ("malformed_sha", lambda x: x.update(gitSha="not-a-sha")),
    ("wrong_os", lambda x: x.update(runnerOs="Windows")),
    ("wrong_test", lambda x: x.update(acceptanceTest="wrong.py")),
    ("failed_exit", lambda x: x.update(exitCode=1)),
    ("overall_failure", lambda x: x["acceptance"].update(status="FAIL")),
    ("no_docx", lambda x: x["acceptance"]["cases"].pop(0)),
    ("duplicate_odt", lambda x: x["acceptance"]["cases"].__setitem__(0, case("odt"))),
    ("format_failure", lambda x: x["acceptance"]["cases"][1].update(status="FAIL")),
    ("altered_orig", lambda x: x["acceptance"]["cases"][0].update(originalDevices=9999)),
    ("altered_ports", lambda x: x["acceptance"]["cases"][0].update(originalPortLinks=9999)),
    ("edited_count", lambda x: x["acceptance"]["cases"][1].update(editedCanonicalDevices=10002)),
    ("pages", lambda x: x["acceptance"]["cases"][0].update(originalPagesChecked=[1, 2, 100])),
    ("page101", lambda x: x["acceptance"]["cases"][1].update(independentUnlinkedPage=100)),
    ("fake_link", lambda x: x["acceptance"]["cases"][0].update(extraPageLinks=1)),
    ("second_edit", lambda x: x["acceptance"]["cases"][0].update(secondAppendDenied=False)),
    ("unbounded", lambda x: x["acceptance"]["cases"][0].update(unboundedGraphRendered=True)),
    ("engine", lambda x: x["acceptance"]["cases"][0].update(engineVerified=True)),
    ("physical", lambda x: x["acceptance"].update(physicalTopologyVerified=True)),
    ("full_graph", lambda x: x["acceptance"].update(noFullGraph=False)),
    ("zero_seconds", lambda x: x.update(elapsedSeconds=0)),
    ("nan_seconds", lambda x: x.update(elapsedSeconds=float("nan"))),
    ("no_samples", lambda x: x["sampling"].update(samples=0)),
    ("no_interval", lambda x: x["sampling"].update(intervalSeconds=0)),
    ("no_rss", lambda x: x["sampling"].update(peakProcessTreeRssKiB=0)),
    ("nan_pss", lambda x: x["sampling"].update(peakProcessTreePssKiB=float("nan"))),
    ("pss_gt_rss", lambda x: x["sampling"].update(peakProcessTreePssKiB=999999)),
    ("slo_claim", lambda x: x.update(performanceSloCertified=True)),
]
for name, mutation in negative:
    rejected(name, mutation)

print(f"PASS P4D1 frozen Ubuntu measured 10k Office evidence contract: {len(negative)+1} cases, no performance SLO")
