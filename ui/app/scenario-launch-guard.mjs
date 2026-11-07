// Explicitly compare both transition generation and active workspace identity.
// Used by asynchronous scenario launch flows; reference equality deliberately
// invalidates a pending launch when the operator edits, opens or creates a project.
export function scenarioLaunchStillCurrent(startEpoch, currentEpoch, startWorkspace, currentWorkspace) {
  return Number.isSafeInteger(startEpoch) && startEpoch === currentEpoch
    && startWorkspace != null && startWorkspace === currentWorkspace;
}
