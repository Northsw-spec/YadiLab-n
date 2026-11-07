/**
 * SCALE-001 P3d1. A fail-closed view classification for a reviewed
 * large-Office Builder source across manual editing, source revisions, and
 * temporarily unmounted asynchronous ReactFlow page transitions.
 * Session membership is established only after full source consent/compile.
 */
export function classifyScaledOfficeFiveThousandView(value){
  if(!value||typeof value!=="object"||!["builder","runtime"].includes(value.mode)||
     !Number.isSafeInteger(value.resources)||value.resources<0||
     !Number.isSafeInteger(value.connections)||value.connections<0||
     typeof value.sessionActive!=="boolean"||
     typeof value.focusMatches!=="boolean")
    throw new Error("SCALE_P3D1_INPUT_BLOCKED");
  const guarded=value.mode==="builder"&&(
    value.sessionActive||(value.resources===5000&&value.connections===5000));
  const showBoundedFocus=guarded&&value.focusMatches&&
    value.resources===5000&&value.connections===5000;
  return Object.freeze({
    guarded,showBoundedFocus,
    needsReviewedRebuild:guarded&&!showBoundedFocus,
    safeCompileOnly:guarded,
    canEnterEngine:!guarded
  });
}
