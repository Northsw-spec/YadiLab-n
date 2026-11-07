"""Independent Draft 2020-12 validation of the integrated Golden Scenario artifacts."""
from pathlib import Path
import json
from jsonschema import Draft202012Validator
root=Path(__file__).resolve().parent.parent
cases=(
 ('schema/scenario-source.schema.json','tests/fixtures/golden/proxmox_rds_opnsense.source.json'),
 ('schema/scenario-normalized.schema.json','tests/generated/golden-proxmox-rds-opnsense.normalized.json'),
 ('schema/layout.schema.json','tests/generated/golden-proxmox-rds-opnsense.layout.json'),
)
for schema_path,fixture_path in cases:
 schema=json.loads((root/schema_path).read_text());v=Draft202012Validator(schema)
 errors=list(v.iter_errors(json.loads((root/fixture_path).read_text())))
 if errors: raise SystemExit(f'FAIL {fixture_path}: '+ '; '.join(error.message for error in errors[:5]))
 print(f'PASS golden {fixture_path}: Draft 2020-12')
print('PASS golden independent schema validation: 3/3')
