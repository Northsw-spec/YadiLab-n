#!/usr/bin/env python3
"""Reproducible qualification metric: isolated Chromium process-tree RSS/PSS/CPU."""
import argparse
import json
import os
import statistics
import time


def descendants(root):
    parents = {}
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            text = open(f"/proc/{name}/stat", encoding="utf-8").read()
            close = text.rfind(")")
            parents[int(name)] = int(text[close + 2:].split()[1])
        except (OSError, ValueError, IndexError):
            pass
    result = {root}
    changed = True
    while changed:
        changed = False
        for pid, parent in parents.items():
            if parent in result and pid not in result:
                result.add(pid)
                changed = True
    return sorted(result)


def sample(root):
    rss = pss = cpu_ticks = 0
    pids = descendants(root)
    for pid in pids:
        try:
            for line in open(f"/proc/{pid}/status", encoding="utf-8"):
                if line.startswith("VmRSS:"):
                    rss += int(line.split()[1])
                    break
            for line in open(f"/proc/{pid}/smaps_rollup", encoding="utf-8"):
                if line.startswith("Pss:"):
                    pss += int(line.split()[1])
                    break
            text = open(f"/proc/{pid}/stat", encoding="utf-8").read()
            close = text.rfind(")")
            fields = text[close + 2:].split()
            cpu_ticks += int(fields[11]) + int(fields[12])
        except (OSError, ValueError, IndexError):
            pass
    return {"processes": len(pids), "rssKb": rss, "pssKb": pss, "cpuTicks": cpu_ticks}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("root_pid", type=int)
    parser.add_argument("--samples", type=int, default=6)
    parser.add_argument("--interval", type=float, default=3.0)
    args = parser.parse_args()
    values = []
    for index in range(args.samples):
        values.append(sample(args.root_pid))
        if index + 1 < args.samples:
            time.sleep(args.interval)
    result = {"rootPid": args.root_pid, "sampleIntervalSeconds": args.interval, "samples": values}
    for key in ("rssKb", "pssKb"):
        series = [item[key] for item in values]
        result[key] = {"min": min(series), "median": statistics.median(series), "max": max(series)}
    result["cpuTicksDelta"] = values[-1]["cpuTicks"] - values[0]["cpuTicks"]
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
