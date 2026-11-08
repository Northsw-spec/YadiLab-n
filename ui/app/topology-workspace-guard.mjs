// Canonical source ownership for delayed ReactFlow callbacks.
// A canvas event can update selection on the most recently published workspace,
// but may never commit the stale workspace captured in a previous React render.
export function liveCanvasWorkspace(rendered, active, renderedGeneration, currentGeneration) {
  if (!Number.isSafeInteger(renderedGeneration) || renderedGeneration < 0 ||
      !Number.isSafeInteger(currentGeneration) || currentGeneration < 0 ||
      renderedGeneration !== currentGeneration ||
      !rendered || !active ||
      !["builder", "runtime"].includes(rendered.mode) ||
      active.mode !== rendered.mode) return null;
  return active;
}

// Source-dependent geometry and new links can only use the graph from which
// the gesture originated. Selection-only events need not satisfy this guard.
export function liveBuilderCanvasMutationWorkspace(rendered, active, renderedGeneration, currentGeneration) {
  const current = liveCanvasWorkspace(rendered, active, renderedGeneration, currentGeneration);
  return current?.mode === "builder" && current.source === rendered.source ? current : null;
}
