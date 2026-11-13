// G4.2: observable proof for the import activation path.  This is intentionally
// scoped to the network-import full-graph builder call; bounded Atlas pages and
// existing SCALE profiles use their own bounded paths.
const trace = { globalLayoutCalls: 0, lastDecision: null };

export function recordNetworkImportGlobalLayoutInvocation(decisionKind) {
  trace.globalLayoutCalls += 1;
  trace.lastDecision = decisionKind;
  return trace;
}

export function readNetworkImportActivationTrace() {
  return { ...trace };
}

if (typeof globalThis !== "undefined") {
  globalThis.__yadilabNetworkImportActivationTrace = trace;
}
