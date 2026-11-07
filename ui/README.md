# UI/browser foundation

The UI layer is deliberately subordinate to the canonical model and deterministic Engine.

Implemented through v0.9.0:

- Phase 7: model -> canvas/React Flow projection;
- Phase 9: framework-neutral Builder/Runtime browser workspace, authoring commands, view models, File/Blob import/export contract, and layout integration.

React Flow node/edge/selection state is not canonical scenario state. Builder edits `ScenarioSource`; Runtime executes a compiled `NormalizedScenario` through the Engine.

Actual rendered React/PWA/browser acceptance is not claimed by v0.9.0.
