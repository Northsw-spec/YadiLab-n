#!/usr/bin/env python3
"""ATLAS-001 F5A: final NORMAL projection acceptance in Chromium.

The 200/199 linear source is the positive P0 control. The star and redundant
profiles are negative controls: their current raw ELK/route safety findings
must remain visible and fail closed. The helper used here is the existing
independent XLSX-to-Chromium density harness; this wrapper changes only the
expected classification, never the product safety rules.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from playwright.sync_api import sync_playwright

from run_atlas001_normal_connection_density_real_browser import (
    VIEWPORT,
    load_manifest,
    require,
    run_case,
)
from run_atlas001_real_browser import require_loopback


ROOT = Path(__file__).resolve().parents[2]
POSITIVE = "200-linear"
NEGATIVE = ("50-star", "100-star", "200-star", "50-redundant")


def launch_options() -> dict[str, Any]:
    options: dict[str, Any] = {
        "headless": True,
        "args": [
            "--disable-background-networking",
            "--disable-dev-shm-usage",
            "--enable-precise-memory-info",
        ],
    }
    executable = os.environ.get("YADILAB_CHROMIUM_EXECUTABLE")
    if executable:
        options["executable_path"] = executable
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        options["args"].append("--no-sandbox")
    return options


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()
    require_loopback(args.url)
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    by_key = {item["key"]: item for item in manifest["cases"]}
    keys = (POSITIVE, *NEGATIVE)
    require(all(key in by_key for key in keys), "F5A density manifest is missing a required profile")
    results: list[dict[str, Any]] = []
    failures: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(**launch_options())
        try:
            for key in keys:
                try:
                    result = run_case(browser, args.url, args.evidence_dir, by_key[key])
                except Exception as error:  # pragma: no cover - emitted as evidence for CI diagnosis
                    result = {
                        "key": key,
                        "status": "ERROR",
                        "failureDiagnostic": f"{type(error).__name__}: {error}",
                    }
                results.append(result)
        finally:
            browser.close()

    observed = {result.get("key"): result for result in results}
    positive = observed.get(POSITIVE, {})
    if positive.get("status") != "PASS":
        failures.append(f"{POSITIVE}: expected FULL_UI_PASS, observed {positive.get('status')}")
    else:
        for field, expected in (
            ("renderedResourceCount", 200),
            ("renderedSvgEdgeCount", 199),
            ("overlapPairs", 0),
            ("zoneHeaderOverlaps", 0),
            ("endpointPortErrors", 0),
            ("nonOrthogonalRoutes", 0),
            ("malformedSvgPaths", 0),
        ):
            if positive.get(field) != expected:
                failures.append(f"{POSITIVE}: {field}={positive.get(field)!r}, expected {expected!r}")
        if positive.get("topologyPanel", {}).get("layoutQuality") == "BLOCKED":
            failures.append(f"{POSITIVE}: final NORMAL validation remained blocked")

    for key in NEGATIVE:
        result = observed.get(key, {})
        if result.get("status") != "FAIL" or result.get("failureKind") != "ACTIVATION_BLOCKED":
            failures.append(f"{key}: expected fail-closed ACTIVATION_BLOCKED, observed {result.get('status')}/{result.get('failureKind')}")
        if result.get("builderUnchanged") is not True:
            failures.append(f"{key}: Builder was not proven unchanged")

    evidence = {
        "format": "atlas001-f5a-normal-final-view-evidence",
        "schemaVersion": "1.0.0",
        "status": "FAIL" if failures else "PASS",
        "prNumber": 105,
        "viewport": list(VIEWPORT),
        "positiveProfile": POSITIVE,
        "negativeProfiles": list(NEGATIVE),
        "rawElkWhitespaceIsIntermediateOnly": True,
        "finalViewMustPassBeforeActivation": True,
        "results": results,
        "failures": failures,
        "normalConnectionBudget": "PENDING_DECISION",
    }
    (args.evidence_dir / "atlas001-f5a-normal-final-view-evidence.json").write_text(
        json.dumps(evidence, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(evidence, indent=2))
    if failures:
        print("FAIL ATLAS-001 F5A NORMAL final-view acceptance")
        return 1
    print("PASS ATLAS-001 F5A NORMAL final-view acceptance")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
