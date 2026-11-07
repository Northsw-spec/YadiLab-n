#!/usr/bin/env python3
"""P2c5 local-only source fixtures; no vendor library, network or runtime commands."""
from __future__ import annotations
import argparse
import csv
from io import StringIO
import json
from pathlib import Path
from generate_ic020_p2c2_workbooks import build_flat

FIELDS=["Asset ID","Hostname","Device Type","IP Address","CIDR","Prefix Length","Connected To"]
BASE=[
    ["rtr01","Consultant router","Router","10.9.20.1","10.9.20.1/24","24",""],
    ["win01","Office Windows","Windows","10.9.10.10","10.9.10.10/24","24","rtr01"],
    ["lin01","Application Linux","Linux","10.9.30.10","10.9.30.10/24","24","rtr01"],
]
FORMATS=("json","csv","tsv","xlsx","ods")
VARIANTS=("valid","address-conflict","prefix-conflict","alias-conflict","duplicate-device")

def rows(variant="valid"):
    if variant not in VARIANTS:
        raise ValueError("unsupported test variant")
    headings=list(FIELDS)
    entries=[list(r) for r in BASE]
    if variant=="address-conflict":
        entries[1][4]="10.9.10.99/24"
    elif variant=="prefix-conflict":
        entries[1][5]="25"
    elif variant=="alias-conflict":
        headings.append("IPv4")
        entries=[[*r,r[3]] for r in entries]
    elif variant=="duplicate-device":
        entries.append(["win01","Contradictory Linux","Linux",
                        "10.9.99.11","10.9.99.11/24","24","rtr01"])
    return [headings,*entries]

def build(fmt="json",variant="valid"):
    records=rows(variant)
    if fmt in ("xlsx","ods"):
        return build_flat(fmt,records)
    if fmt=="json":
        return json.dumps({"Devices":[dict(zip(records[0],row)) for row in records[1:]]},
            ensure_ascii=False,separators=(",",":")).encode("utf-8")
    if fmt in ("csv","tsv"):
        dest=StringIO(newline="")
        writer=csv.writer(dest,delimiter="," if fmt=="csv" else "\t",
            lineterminator="\n")
        writer.writerows(records)
        return dest.getvalue().encode("utf-8")
    raise ValueError("unsupported format")

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--out-dir",type=Path,required=True)
    args=ap.parse_args()
    args.out_dir.mkdir(parents=True,exist_ok=True)
    for fmt in FORMATS:
        for variant in VARIANTS:
            target=args.out_dir/("ic020-p2c5-"+variant+"."+fmt)
            target.write_bytes(build(fmt,variant))
            print(target.name,len(target.read_bytes()))

if __name__=="__main__":
    main()
