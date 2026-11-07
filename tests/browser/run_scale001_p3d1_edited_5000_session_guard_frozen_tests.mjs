import assert from "node:assert/strict";
import {classifyScaledOfficeFiveThousandView} from "../../ui/app/scaled-office-five-thousand-session-guard.mjs";

// Frozen before the production guard exists. All assertions remain independent
// of ReactFlow internals, source-provided claims and display text.
const cases=[
  {name:"original imported 5000/5000 compiled focus",v:{mode:"builder",resources:5000,connections:5000,sessionActive:true,focusMatches:true},
    result:{guarded:true,showBoundedFocus:true,needsReviewedRebuild:false,safeCompileOnly:true,canEnterEngine:false}},
  {name:"edit added one resource 5001/5000",v:{mode:"builder",resources:5001,connections:5000,sessionActive:true,focusMatches:false},
    result:{guarded:true,showBoundedFocus:false,needsReviewedRebuild:true,safeCompileOnly:true,canEnterEngine:false}},
  {name:"edit removed resource 4999/5000",v:{mode:"builder",resources:4999,connections:5000,sessionActive:true,focusMatches:false},
    result:{guarded:true,showBoundedFocus:false,needsReviewedRebuild:true,safeCompileOnly:true,canEnterEngine:false}},
  {name:"edit removed source link 5000/4999",v:{mode:"builder",resources:5000,connections:4999,sessionActive:true,focusMatches:false},
    result:{guarded:true,showBoundedFocus:false,needsReviewedRebuild:true,safeCompileOnly:true,canEnterEngine:false}},
  {name:"metadata mutation same-count stale model",v:{mode:"builder",resources:5000,connections:5000,sessionActive:true,focusMatches:false},
    result:{guarded:true,showBoundedFocus:false,needsReviewedRebuild:true,safeCompileOnly:true,canEnterEngine:false}},
  {name:"focus temporarily unmounted for page switch",v:{mode:"builder",resources:5000,connections:5000,sessionActive:true,focusMatches:false},
    result:{guarded:true,showBoundedFocus:false,needsReviewedRebuild:true,safeCompileOnly:true,canEnterEngine:false}},
  {name:"post-import edited 4k source",v:{mode:"builder",resources:4100,connections:4030,sessionActive:true,focusMatches:false},
    result:{guarded:true,showBoundedFocus:false,needsReviewedRebuild:true,safeCompileOnly:true,canEnterEngine:false}},
  {name:"untracked exactly 5000/5000 fail closed",v:{mode:"builder",resources:5000,connections:5000,sessionActive:false,focusMatches:false},
    result:{guarded:true,showBoundedFocus:false,needsReviewedRebuild:true,safeCompileOnly:true,canEnterEngine:false}},
  {name:"new session regular 1000/999 not blocked",v:{mode:"builder",resources:1000,connections:999,sessionActive:false,focusMatches:false},
    result:{guarded:false,showBoundedFocus:false,needsReviewedRebuild:false,safeCompileOnly:false,canEnterEngine:true}},
  {name:"new session ordinary Builder not blocked",v:{mode:"builder",resources:16,connections:15,sessionActive:false,focusMatches:false},
    result:{guarded:false,showBoundedFocus:false,needsReviewedRebuild:false,safeCompileOnly:false,canEnterEngine:true}},
  {name:"runtime source not treated as edited Builder",v:{mode:"runtime",resources:5000,connections:5000,sessionActive:false,focusMatches:false},
    result:{guarded:false,showBoundedFocus:false,needsReviewedRebuild:false,safeCompileOnly:false,canEnterEngine:true}},
];
let assertions=0;
for(const item of cases){
  const result=classifyScaledOfficeFiveThousandView(item.v);
  assert.deepEqual(result,item.result,item.name);assertions++;
  assert.ok(Object.isFrozen(result),item.name+" immutable guard");assertions++;
}
for(const v of [
  null,{}, {mode:"builder",resources:NaN,connections:5000,sessionActive:true,focusMatches:false},
  {mode:"builder",resources:-1,connections:5000,sessionActive:true,focusMatches:false},
  {mode:"builder",resources:5000.5,connections:5000,sessionActive:true,focusMatches:false},
  {mode:"builder",resources:5000,connections:5000,sessionActive:"yes",focusMatches:false},
  {mode:"builder",resources:5000,connections:5000,sessionActive:true,focusMatches:"true"},
]){
  assert.throws(()=>classifyScaledOfficeFiveThousandView(v),/SCALE_P3D1_INPUT_BLOCKED/);
  assertions++;
}
console.log("PASS SCALE-001 P3d1 FROZEN edited 5000 source session guard: "+assertions+" classification/denial assertions; no giant ELK/ReactFlow fallback or Engine claim");
