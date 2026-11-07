import fs from "node:fs"; import assert from "node:assert/strict";
import {renderScenarioSvg} from "../../dist-renderer-test/renderer/src/index.js";
const scenario=JSON.parse(fs.readFileSync('tests/fixtures/valid/scenario-normalized.json','utf8')); let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
let r=renderScenarioSvg(scenario,{formatId:'infrastructure-cyber-lab.layout',schemaVersion:'0.1.0',scenarioId:'wrong',engine:'x',nodes:[]}); eq(r.ok,false,'layout identity mismatch fails render'); if(r.ok)process.exit(1); ok(r.diagnostics.some(d=>d.code==='CANVAS_LAYOUT_SCENARIO_MISMATCH'),'identity diagnostic preserved');
r=renderScenarioSvg(scenario,{formatId:'infrastructure-cyber-lab.layout',schemaVersion:'0.1.0',scenarioId:scenario.scenarioId,engine:'x',nodes:[]}); eq(r.ok,false,'missing layout nodes fail instead of stacking at origin'); if(r.ok)process.exit(1); ok(r.diagnostics.some(d=>d.code==='RENDER_LAYOUT_REQUIRED'),'missing layout named');
const nodes=[...scenario.zones,...scenario.resources].map((x,i)=>({id:x.id,x:i*10,y:i*10,width:100,height:80})); nodes[0].width=-1;
r=renderScenarioSvg(scenario,{formatId:'infrastructure-cyber-lab.layout',schemaVersion:'0.1.0',scenarioId:scenario.scenarioId,engine:'x',nodes}); eq(r.ok,false,'negative geometry rejected'); if(r.ok)process.exit(1); ok(r.diagnostics.some(d=>d.code==='RENDER_NODE_GEOMETRY_INVALID'),'geometry diagnostic named');
console.log(`PASS headless renderer adversarial suite: ${checks} assertions.`);
