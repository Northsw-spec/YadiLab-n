import json
from pathlib import Path
from jsonschema import Draft202012Validator

root = Path(__file__).resolve().parents[1]
schema = json.loads((root / "schema/save-state.schema.json").read_text())
data = json.loads((root / "tests/generated/runtime-save.json").read_text())
Draft202012Validator.check_schema(schema)
errors = sorted(Draft202012Validator(schema).iter_errors(data), key=lambda e: list(e.path))
if errors:
    for error in errors:
        print(f"FAIL runtime-save.json: {list(error.path)}: {error.message}")
    raise SystemExit(1)
print("PASS runtime-save.json: save-state schema valid")
