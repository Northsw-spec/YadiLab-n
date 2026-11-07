import fs from "node:fs"; import path from "node:path"; import assert from "node:assert/strict"; import {fileURLToPath} from "node:url";
import {renderScenarioSvg} from "../../dist-renderer-test/renderer/src/index.js";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const scenario=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/valid/scenario-normalized.json"),"utf8"));
const nodes=[]; let zx=0;
for(const z of scenario.zones){nodes.push({id:z.id,x:zx,y:0,width:720,height:520,...(z.parent?{parent:z.parent}:{})}); zx+=760;}
let i=0; for(const r of scenario.resources){nodes.push({id:r.id,x:40+(i%2)*230,y:70+Math.floor(i/2)*150,width:180,height:96,...(r.zone?{parent:r.zone}:{})}); i++;}
const layout={formatId:"infrastructure-cyber-lab.layout",schemaVersion:"0.1.0",scenarioId:scenario.scenarioId,engine:"test",nodes};
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks++}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
const a=renderScenarioSvg(scenario,layout); ok(a.ok,"resolved scenario renders"); if(!a.ok)process.exit(1);
const b=renderScenarioSvg(scenario,layout); ok(b.ok,"second render succeeds"); if(!b.ok)process.exit(1);
eq(a.svg,b.svg,"renderer is byte-deterministic"); ok(a.svg.startsWith('<?xml version="1.0"'),"SVG has XML header"); ok(a.svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'),"SVG namespace local document"); ok(a.svg.includes('data-id="firewall01"'),"resource emitted"); ok(a.svg.includes('data-id="wan_fw"'),"semantic edge emitted"); ok(a.width>=640&&a.height>=360,"preview has bounded canvas"); ok(!a.svg.includes('<script'),"preview contains no executable script"); ok(!/href=|src=/.test(a.svg),"preview contains no external-resource references");
const escaped=structuredClone(scenario); escaped.metadata.title='<Test & "safe">'; const c=renderScenarioSvg(escaped,layout); ok(c.ok,"escaped-title render succeeds"); if(!c.ok)process.exit(1); ok(c.svg.includes('&lt;Test &amp; &quot;safe&quot;&gt;'),"XML-sensitive title escaped");
console.log(`PASS headless renderer suite: ${checks} assertions.`);
