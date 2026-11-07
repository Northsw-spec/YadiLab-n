#!/usr/bin/env python3
"""SCALE-001 P4d1: measure the unchanged real mounted P4c4a acceptance.

Read-only Ubuntu qualification.  The actual frozen DOCX+ODT Chromium script
runs exactly once, in its original Python interpreter and against the
existing mounted build.  This wrapper only samples /proc process-tree
RSS/PSS and checks the original browser-generated evidence before claiming
that any measurement is valid.  It never certifies a performance SLO.
"""
import argparse
import json
import math
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import time

from profile_chromium_process_tree import sample

ACCEPTANCE_TEST = "tests/acceptance/run_scale001_p4c4a_10000_office_one_edit_real_browser.py"
ACCEPTANCE_JSON = "scale001-p4c4a-10000-office-one-edit-real-dom.json"
METRICS_JSON = "scale001-p4d1-office-10000-process-tree-measured.json"
LOG_FILE = "scale001-p4d1-original-frozen-p4c4a-browser.log"
SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
INTERVAL_SECONDS = 0.25


def require(condition, message):
    if not condition:
        raise ValueError("P4D1_INVALID_MEASUREMENT: " + message)


def finite_positive(value):
    return (type(value) in (int, float)
            and math.isfinite(value) and value > 0)


def validate_evidence(report, expected_sha):
    """Reject contradictory data, never turn an observed non-PASS into PASS."""
    require(isinstance(report, dict), "root")
    require(isinstance(expected_sha, str) and
            SHA_RE.fullmatch(expected_sha) is not None, "expected SHA")
    require(type(report.get("schemaVersion")) is int and
            report["schemaVersion"] == 1, "schema version")
    sha = report.get("gitSha")
    require(isinstance(sha, str) and SHA_RE.fullmatch(sha) is not None
            and sha == expected_sha, "exact git SHA")
    require(report.get("runnerOs") == "Linux", "Linux runner")
    require(report.get("acceptanceTest") == ACCEPTANCE_TEST,
            "unchanged original P4c4a acceptance path")
    require(type(report.get("exitCode")) is int and
            report["exitCode"] == 0, "original subprocess exit code")
    require(finite_positive(report.get("elapsedSeconds")), "finite wall seconds")
    require(report.get("performanceSloCertified") is False, "no performance SLO")

    sampling = report.get("sampling")
    require(isinstance(sampling, dict), "sampling")
    require(type(sampling.get("samples")) is int and
            sampling["samples"] >= 2, "at least two actual observations")
    require(finite_positive(sampling.get("intervalSeconds")),
            "positive sampling interval")
    rss = sampling.get("peakProcessTreeRssKiB")
    pss = sampling.get("peakProcessTreePssKiB")
    require(finite_positive(rss) and finite_positive(pss) and pss <= rss,
            "nonzero and consistent process-tree RSS/PSS KiB")

    acceptance = report.get("acceptance")
    require(isinstance(acceptance, dict) and
            acceptance.get("status") == "PASS", "original browser PASS")
    require(acceptance.get("noFullGraph") is True, "no full graph")
    require(acceptance.get("engineVerified") is False and
            acceptance.get("physicalTopologyVerified") is False,
            "no Engine or physical-network truth")
    cases = acceptance.get("cases")
    require(isinstance(cases, list) and len(cases) == 2,
            "two separately tested original formats")
    formats = set()
    for entry in cases:
        require(isinstance(entry, dict), "original format case")
        fmt = entry.get("format")
        require(fmt in ("docx", "odt") and fmt not in formats,
                "distinct DOCX and ODT original cases")
        formats.add(fmt)
        for key, expected in (
            ("status", "PASS"),
            ("originalDevices", 10000),
            ("originalPortLinks", 10000),
            ("editedCanonicalDevices", 10001),
            ("originalPagesChecked", [1, 2, 50, 100]),
            ("independentUnlinkedPage", 101),
            ("extraPageNodes", 1),
            ("extraPageLinks", 0),
            ("secondAppendDenied", True),
            ("unboundedGraphRendered", False),
            ("engineVerified", False),
            ("physicalTopologyVerified", False),
        ):
            value = entry.get(key)
            require(type(value) is type(expected) and value == expected,
                    fmt + " original browser " + key)
    require(formats == {"docx", "odt"}, "both real Office formats")
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--evidence-dir", required=True, type=Path)
    args = parser.parse_args()

    require(platform.system() == "Linux" and
            sys.platform.startswith("linux") and
            os.environ.get("GITHUB_ACTIONS") == "true",
            "must run on actual GitHub Ubuntu")
    sha = os.environ.get("YADILAB_EXPECTED_COMMIT", "")
    require(bool(SHA_RE.fullmatch(sha)) and
            os.environ.get("GITHUB_SHA") == sha, "GitHub expected commit")
    root = Path(__file__).resolve().parents[2]
    require((root / ACCEPTANCE_TEST).is_file(), "original frozen test missing")
    evidence_dir = args.evidence_dir.resolve()
    evidence_dir.mkdir(parents=True, exist_ok=True)
    original_path = evidence_dir / ACCEPTANCE_JSON
    measured_path = evidence_dir / METRICS_JSON
    measured_path.unlink(missing_ok=True)
    original_path.unlink(missing_ok=True)

    command = [
        sys.executable, str(root / ACCEPTANCE_TEST),
        "--url", args.url, "--evidence-dir", str(evidence_dir)
    ]
    start = time.monotonic()
    snapshots = []
    stdout_path = evidence_dir / LOG_FILE
    with stdout_path.open("w+", encoding="utf-8") as output:
        proc = subprocess.Popen(
            command, cwd=root, stdout=output, stderr=subprocess.STDOUT
        )
        try:
            while proc.poll() is None:
                snapshots.append(sample(proc.pid))
                time.sleep(INTERVAL_SECONDS)
            code = proc.wait()
        except BaseException:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
            raise
        elapsed = time.monotonic() - start
        output.flush()
        output.seek(0)
        sys.stdout.write(output.read())
        sys.stdout.flush()

    require(code == 0, "real original Chromium acceptance failed")
    require(original_path.is_file(), "original browser evidence absent")
    with original_path.open(encoding="utf-8") as handle:
        original = json.load(handle)

    peak_rss = max((s["rssKb"] for s in snapshots), default=0)
    peak_pss = max((s["pssKb"] for s in snapshots), default=0)
    report = {
        "schemaVersion": 1,
        "gitSha": sha,
        "runnerOs": platform.system(),
        "acceptanceTest": ACCEPTANCE_TEST,
        "exitCode": code,
        "elapsedSeconds": round(elapsed, 3),
        "sampling": {
            "intervalSeconds": INTERVAL_SECONDS,
            "samples": len(snapshots),
            "peakProcessTreeRssKiB": peak_rss,
            "peakProcessTreePssKiB": peak_pss,
            "peakProcessesObserved": max(
                (s["processes"] for s in snapshots), default=0),
            "cpuTicksDelta": (
                max((s["cpuTicks"] for s in snapshots), default=0)
                - min((s["cpuTicks"] for s in snapshots), default=0)),
        },
        "acceptance": original,
        "performanceSloCertified": False,
    }
    require(report["sampling"]["peakProcessesObserved"] >= 2,
            "real browser descendants not observed")
    validate_evidence(report, sha)
    with measured_path.open("w", encoding="utf-8") as out:
        json.dump(report, out, indent=2, allow_nan=False)
        out.write("\n")
    print("PASS SCALE-001 P4d1 verified actual original frozen DOCX+ODT "
          "P4c4a acceptance with sampled Ubuntu process-tree RSS/PSS "
          "and elapsed seconds; performance SLO NOT certified")
    print(json.dumps({
        "gitSha": sha,
        "acceptanceTest": ACCEPTANCE_TEST,
        "elapsedSeconds": report["elapsedSeconds"],
        "sampling": report["sampling"],
        "formats": [entry["format"] for entry in original["cases"]],
        "performanceSloCertified": False,
    }, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("FAIL SCALE-001 P4d1 Ubuntu measured Office acceptance:",
              str(exc), file=sys.stderr)
        raise
