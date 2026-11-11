# PROJECT-089 — Excel import detection and consent decision

## Root cause

The importer selected canonical workbook profiles with exact worksheet-name
lookups. Harmless producer differences such as a non-breaking space, repeated
whitespace or casing could therefore make a workbook containing all six `SRC`
worksheets look like an unstructured workbook. The UI then received no
`legacy-src-22` profile, so it rendered no SRC review consent and left the
activation path blocked by the underlying validation result.

The preview path also iterated the physical document instead of the
compatibility projection. That made authoritative SRC rows and their canonical
`Nodes`/`Links` names diverge in preview bookkeeping even after detection.

Finally, the global `input { width: 100% }` rule applied to checkboxes. The
consent control was technically present but visually stretched and easy to
miss, while the action buttons remained below a long diagnostic scroll area.

## Fix

- Normalize worksheet names using Unicode normalization, NBSP conversion,
  trimmed/collapsed whitespace and case folding.
- Map only unique normalized names to the six documented canonical SRC sheets;
  normalized-name collisions fail closed with a source diagnostic.
- Preserve original worksheet IDs and cell locators for provenance while
  exposing canonical table IDs to validation and mapping.
- Keep supplementary worksheets as documentation; they are never projected
  into resources, interfaces, links, VLANs, routes or Engine evidence.
- Add an explicit detected-workbook status and a sticky confirmation footer.
- Give consent checkboxes a 24×24px hit target, contrast, keyboard focus and
  an unchecked initial state. SRC activation remains disabled until approval.

No filename, sheet count or SHA-256 is used to infer topology. Existing
source re-read, SHA, schema, provenance and Runtime/Engine boundaries remain
unchanged.

