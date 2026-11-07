export interface TopologyViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface TopologyViewportLifecycleSnapshot {
  readonly phase: "unmeasured" | "valid" | "transient-zero-size";
  readonly width: number;
  readonly height: number;
  readonly lastValidSize?: TopologyViewportSize;
  readonly edgeIds: readonly string[];
  readonly edgeCount: number;
  readonly preserveCanonicalGeometry: boolean;
  readonly rebuildVisualGeometry: boolean;
}

export interface TopologyViewportLifecycle {
  observe(size: TopologyViewportSize): TopologyViewportLifecycleSnapshot;
  setEdgeIds(edgeIds: readonly string[]): TopologyViewportLifecycleSnapshot;
  snapshot(): TopologyViewportLifecycleSnapshot;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function uniqueSortedEdgeIds(edgeIds: readonly string[]): readonly string[] {
  return [...new Set(edgeIds.filter((edgeId): edgeId is string => typeof edgeId === "string" && edgeId.length > 0))].sort((a, b) => a.localeCompare(b, "en"));
}

export function createTopologyViewportLifecycle(initialEdgeIds: readonly string[] = []): TopologyViewportLifecycle {
  let phase: TopologyViewportLifecycleSnapshot["phase"] = "unmeasured";
  let width = 0;
  let height = 0;
  let lastValidSize: TopologyViewportSize | undefined;
  let edgeIds = uniqueSortedEdgeIds(initialEdgeIds);
  let rebuildVisualGeometry = false;

  const snapshot = (): TopologyViewportLifecycleSnapshot => ({
    phase,
    width,
    height,
    ...(lastValidSize ? { lastValidSize } : {}),
    edgeIds,
    edgeCount: edgeIds.length,
    preserveCanonicalGeometry: phase === "transient-zero-size",
    rebuildVisualGeometry,
  });

  return {
    observe(size) {
      width = Number.isFinite(size.width) ? size.width : 0;
      height = Number.isFinite(size.height) ? size.height : 0;
      if (!finitePositive(width) || !finitePositive(height)) {
        phase = "transient-zero-size";
        rebuildVisualGeometry = false;
        return snapshot();
      }
      const wasTransient = phase === "transient-zero-size";
      const hadValidSize = phase === "valid" && Boolean(lastValidSize);
      const sizeChanged = lastValidSize !== undefined && (lastValidSize.width !== width || lastValidSize.height !== height);
      phase = "valid";
      lastValidSize = { width, height };
      // The first valid measurement only establishes the baseline. A repair
      // is requested for a real resize or for the return from a transient
      // zero-size browser state.
      rebuildVisualGeometry = wasTransient || sizeChanged;
      return snapshot();
    },
    setEdgeIds(nextEdgeIds) {
      edgeIds = uniqueSortedEdgeIds(nextEdgeIds);
      return snapshot();
    },
    snapshot,
  };
}
