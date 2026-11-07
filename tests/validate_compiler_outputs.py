from __future__ import annotations
import json
from pathlib import Path
from jsonschema import Draft202012Validator

ROOT=Path(__file__).resolve().parents[1]
schema=json.loads((ROOT/'schema/scenario-normalized.schema.json').read_text())
Draft202012Validator.check_schema(schema)
validator=Draft202012Validator(schema)
files=[ROOT/'tests/generated/compiled-foundation.json', ROOT/'tests/generated/compiled-profile.json']
failed=False
for path in files:
    data=json.loads(path.read_text())
    errors=sorted(validator.iter_errors(data), key=lambda e:list(e.path))
    if errors:
        failed=True
        print(f"FAIL {path.name}")
        for e in errors: print("  ", list(e.path), e.message)
    else:
        print(f"PASS {path.name}: normalized schema valid")
if failed:
    raise SystemExit(1)
print(f"PASS compiler output schema validation: {len(files)}/{len(files)}")
