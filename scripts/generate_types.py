from __future__ import annotations
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = [
    ("scenario-source.schema.json", "ScenarioSource"),
    ("scenario-normalized.schema.json", "NormalizedScenario"),
    ("enterprise-baseline.schema.json", "EnterpriseBaseline"),
    ("enterprise-mapping-profile.schema.json", "EnterpriseMappingProfile"),
    ("enterprise-import-report.schema.json", "EnterpriseImportReport"),
    ("enterprise-mapping-review.schema.json", "EnterpriseMappingReview"),
    ("enterprise-reimport-diff.schema.json", "EnterpriseReimportDiff"),
    ("enterprise-reimport-merge-plan.schema.json", "EnterpriseReimportMergePlan"),
    ("enterprise-topology-projection.schema.json", "EnterpriseTopologyProjection"),
    ("fault-pack.schema.json", "FaultPack"),
    ("fault-overlay.schema.json", "FaultOverlay"),
    ("fault-generation-plan.schema.json", "FaultGenerationPlan"),
    ("layout.schema.json", "LayoutDocument"),
    ("package-manifest.schema.json", "PackageManifest"),
    ("save-state.schema.json", "SaveState"),
]
OUT = ROOT / "core-model/src/generated/contracts.ts"

def ident(name: str) -> str:
    x = re.sub(r"[^A-Za-z0-9]+", " ", name).title().replace(" ", "")
    if not x: x = "Anonymous"
    if x[0].isdigit(): x = "T" + x
    return x

def prop_name(name: str) -> str:
    return name if re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", name) else json.dumps(name)

def lit(v):
    if v is True: return "true"
    if v is False: return "false"
    if v is None: return "null"
    return json.dumps(v, ensure_ascii=False)

def ts(schema, defs_prefix=""):
    if not isinstance(schema, dict) or schema == {}:
        return "unknown"
    if "$ref" in schema:
        ref=schema["$ref"]
        if ref.startswith("#/$defs/"):
            return ident(defs_prefix + ref.split("/")[-1])
        return "unknown"
    if "const" in schema: return lit(schema["const"])
    if "enum" in schema: return " | ".join(lit(v) for v in schema["enum"])
    if "oneOf" in schema: return " | ".join(f"({ts(x, defs_prefix)})" for x in schema["oneOf"])
    if "anyOf" in schema: return " | ".join(f"({ts(x, defs_prefix)})" for x in schema["anyOf"])
    typ=schema.get("type")
    if isinstance(typ,list): return " | ".join(ts({"type":t},defs_prefix) for t in typ)
    if typ=="string": return "string"
    if typ in ("number","integer"): return "number"
    if typ=="boolean": return "boolean"
    if typ=="null": return "null"
    if typ=="array": return f"ReadonlyArray<{ts(schema.get('items',{}),defs_prefix)}>"
    if typ=="object" or "properties" in schema:
        props=schema.get("properties",{})
        req=set(schema.get("required",[]))
        if props:
            fields=[]
            for k,v in props.items():
                opt="" if k in req else "?"
                fields.append(f"readonly {prop_name(k)}{opt}: {ts(v,defs_prefix)};")
            extra=schema.get("additionalProperties",False)
            if isinstance(extra,dict): fields.append(f"readonly [key: string]: {ts(extra,defs_prefix)};")
            return "{ " + " ".join(fields) + " }"
        extra=schema.get("additionalProperties",True)
        return f"Readonly<Record<string, {ts(extra,defs_prefix) if isinstance(extra,dict) else 'unknown'}>>"
    return "unknown"

lines=["// GENERATED FROM JSON SCHEMA. DO NOT EDIT MANUALLY.","// JSON Schema Draft 2020-12 files under schema/ are authoritative.",""]
for filename, rootname in SCHEMAS:
    schema=json.loads((ROOT/"schema"/filename).read_text())
    prefix=rootname
    # Emit defs first with schema-specific prefix to avoid cross-file name collisions.
    for name,definition in schema.get("$defs",{}).items():
        lines.append(f"export type {ident(prefix+name)} = {ts(definition,prefix)};")
    lines.append(f"export type {rootname} = {ts(schema,prefix)};")
    lines.append("")
OUT.write_text("\n".join(lines), encoding="utf-8")
print(f"generated {OUT.relative_to(ROOT)}")
