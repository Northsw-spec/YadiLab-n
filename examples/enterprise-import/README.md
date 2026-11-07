# Enterprise import template

These files are a deterministic, offline-first example/template for the first-release Enterprise Environment Import path.

Files:

- `enterprise-import-template.xlsx`
- `enterprise-import-template.ods`
- `enterprise-import-template.mapping.json`

The `Devices` sheet uses these columns:

- `Asset ID` — required stable ASCII-safe entity ID, e.g. `pc01`.
- `Hostname` — required in this mapping profile.
- `IP Address` — required IPv4 value in this mapping profile.
- `Default Gateway` — optional; an empty cell becomes explicit `UNKNOWN`, never an assumed `.1` gateway.
- `OS` — optional string.
- `Notes` — intentionally unmapped in this first template and reported as unmapped source data.

The workbook also contains a `Metadata` sheet to demonstrate multi-sheet detection. It is not silently merged into `Devices`.

Security rules:

- workbook formulas are never executed;
- cached formula values may be imported only with an explicit warning;
- external workbook/data links are not fetched and block data-link import;
- ordinary hyperlinks are not followed and are ignored with a warning;
- VBA/ActiveX/OLE workbook content is rejected;
- ODS Basic/Scripts content and encrypted members are rejected;
- XML DTD/custom entity declarations are rejected;
- ZIP member count, size and compression ratio are bounded.
