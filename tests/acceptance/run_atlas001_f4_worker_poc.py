#!/usr/bin/env python3
"""Run the isolated ATLAS-001 F4A Worker cancellation proof.

This harness deliberately exercises only the standalone proof page.  It does
not call YadiLab's product layout path and therefore cannot be interpreted as
an integration PASS.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "tests" / "fixtures" / "import" / "atlas001-normal-density-manifest.json"


def git_sha() -> str:
    value = os.environ.get("YADILAB_EXPECTED_COMMIT")
    if value:
        return value
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def load_case(key: str) -> dict:
    document = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for case in document["cases"]:
        if case["key"] == key:
            return case
    raise SystemExit(f"fixture case not found: {key}")


def make_graph(case: dict) -> dict:
    children = [
        {
            "id": resource_id,
            "width": 180,
            "height": 96,
            "ports": [
                {
                    "id": f"{resource_id}::{direction}::p{port_number:04d}",
                    "width": 8,
                    "height": 8,
                    "layoutOptions": {
                        "org.eclipse.elk.port.side": (
                            ("EAST" if port_number % 2 else "WEST")
                            if direction == "out"
                            else ("WEST" if port_number % 2 else "EAST")
                        ),
                    },
                }
                for port_number in range(1, case["portsPerResource"][resource_id] + 1)
                for direction in ("out", "in")
            ],
        }
        for resource_id in case["resourceIds"]
    ]
    edges = [
        {
            "id": truth["id"],
            "sources": [f"{truth['from']}::out::{truth['fromPort']}"],
            "targets": [f"{truth['to']}::in::{truth['toPort']}"],
        }
        for truth in case["connectionsTruth"]
    ]
    return {
        "id": f"f4-{case['key']}",
        "layoutOptions": {
            "elk.algorithm": "layered",
            "elk.direction": "RIGHT",
            "elk.edgeRouting": "ORTHOGONAL",
        },
        "children": children,
        "edges": edges,
    }


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="URL for atlas001-f4-worker-poc.html")
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--first-budget-ms", type=int, default=250)
    parser.add_argument("--second-budget-ms", type=int, default=20_000)
    args = parser.parse_args()

    first_case = load_case("200-redundant")
    second_case = load_case("50-linear")
    first_sha = first_case["sha256"]
    second_sha = second_case["sha256"]
    sequence_input = {
        "first": {
            "graph": make_graph(first_case),
            "requestId": "f4a-abort-200-1600",
            "sourceSha": first_sha,
            "sourceRevision": 1,
            "budgetMs": args.first_budget_ms,
        },
        "second": {
            "graph": make_graph(second_case),
            "requestId": "f4a-next-50-49",
            "sourceSha": second_sha,
            "sourceRevision": 2,
            "budgetMs": args.second_budget_ms,
        },
    }

    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=os.environ.get("YADILAB_CHROMIUM_EXECUTABLE", "/usr/bin/chromium"),
        )
        page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page.goto(args.url, wait_until="networkidle")
        page.wait_for_function("window.runF4WorkerSequence !== undefined")
        result = page.evaluate("input => window.runF4WorkerSequence(input)", sequence_input)
        page.screenshot(path=str(args.evidence_dir / "ATLAS001_F4_WORKER_POC.png"), full_page=True)
        browser.close()

    first = result["first"]
    second = result["second"]
    accepted = result["acceptedResults"]
    checks = {
        "first_aborted": first["status"] == "ABORTED" and first["code"] == "F4A_LAYOUT_TIMEOUT_ABORTED",
        "first_worker_terminated": first["workerTerminated"] is True,
        "first_no_post_termination_messages": first["messagesAfterTerminate"] == 0,
        "second_completed": second["status"] == "PASS" and second["code"] == "F4A_LAYOUT_COMPLETE",
        "second_identity_preserved": {
            "requestId": second["requestId"],
            "sourceSha": second["sourceSha"],
            "sourceRevision": second["sourceRevision"],
        }
        == {
            "requestId": "f4a-next-50-49",
            "sourceSha": second_sha,
            "sourceRevision": 2,
        },
        "second_complete_counts": second.get("nodes") == 50 and second.get("edges") == 49,
        "only_second_result_accepted": len(accepted) == 1 and accepted[0]["requestId"] == "f4a-next-50-49",
        "single_worker_concurrency": result["maxConcurrentWorkers"] == 1,
        "first_event_loop_observed": first["eventLoopTicks"] > 0,
        "second_event_loop_observed": second["eventLoopTicks"] > 0,
        "first_event_loop_bounded": first["eventLoopMaxDelayMs"] < 100,
        "second_event_loop_bounded": second["eventLoopMaxDelayMs"] < 100,
        "termination_probe_stable": result["terminationProof"]["stableAfterTerminate"] is True
        and result["terminationProof"]["messagesAfterTerminate"] == 0,
        "stale_identity_rejected": result["staleProbe"]["accepted"] is False
        and result["staleProbe"]["staleResultRecorded"] is True
        and result["staleProbe"]["code"] == "F4A_STALE_RESULT_IGNORED",
    }
    evidence = {
        "format": "ATLAS001_F4_WORKER_POC",
        "status": "PASS" if all(checks.values()) else "FAIL",
        "productIntegration": "NOT_IMPLEMENTED",
        "commit": git_sha(),
        "manifest": str(MANIFEST.relative_to(ROOT)),
        "sourceFixtures": {
            "first": {
                "key": first_case["key"],
                "resources": first_case["resources"],
                "connections": first_case["connections"],
                "manifestSha256": first_sha,
                "fileSha256": sha256(ROOT / first_case["path"]),
            },
            "second": {
                "key": second_case["key"],
                "resources": second_case["resources"],
                "connections": second_case["connections"],
                "manifestSha256": second_sha,
                "fileSha256": sha256(ROOT / second_case["path"]),
            },
        },
        "budgetsMs": {"first": args.first_budget_ms, "second": args.second_budget_ms},
        "result": result,
        "checks": checks,
        "interpretation": {
            "workerAbortProof": "PASS" if all(
                [checks["first_aborted"], checks["first_worker_terminated"], checks["first_no_post_termination_messages"]]
            ) else "FAIL",
            "mainThreadResponsiveness": "PASS"
            if all(
                [
                    checks["first_event_loop_observed"],
                    checks["second_event_loop_observed"],
                    checks["first_event_loop_bounded"],
                    checks["second_event_loop_bounded"],
                ]
            )
            else "FAIL",
            "staleResultGuard": "PASS"
            if checks["only_second_result_accepted"] and checks["stale_identity_rejected"]
            else "FAIL",
            "builderUnchangedOnAbort": "NOT_TESTED_PRODUCT_INTEGRATION",
        },
    }
    output = args.evidence_dir / "ATLAS001_F4_WORKER_POC.json"
    output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2, sort_keys=True))
    return 0 if evidence["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
