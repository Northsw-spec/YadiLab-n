# YadiLab Network Workbook Schema v1

`Metadata` and `Nodes` are required. Supported optional sheets are `Zones`,
`Interfaces`, `Links`, `Routes`, `VLANs`, `STP`, `Services`, `Firewall`, `NAT`,
`Flows` and `Layout`.

The workbook contains source facts only. It never contains expected Engine
outcomes. `Links` require explicit node/interface references; subnet matching
does not infer an edge. Unknown references, duplicate identities, invalid
types and malformed IDs fail closed before activation.

Canonical JSON remains the authority after import.
