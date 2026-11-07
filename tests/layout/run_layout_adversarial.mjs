import fs from "node:fs"; import path from "node:path"; import assert from "node:assert/strict"; import { fileURLToPath } from "node:url"; import { runAutoLayout, buildLayoutGraph } from "../../dist-layout-test/layout/src/index.js";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."); const scenario=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/valid/scenario-normalized.json"),"utf8")); let c=0; const ok=(v,m)=>{assert.ok(v,m);c++};
const base=buildLayoutGraph(scenario); const flat=[]; const walk=ns=>{for(const n of ns){flat.push(n);walk(n.children)}};walk(base.children); const valid=()=>{const out=[];base.children.forEach((n,rootIndex)=>{out.push({id:n.id,x:rootIndex*800,y:0,width:n.width,height:n.height});n.children.forEach((child,childIndex)=>out.push({id:child.id,x:40+(childIndex%2)*220,y:72+Math.floor(childIndex/2)*130,width:child.width,height:child.height,parent:n.id}));});return out;};
for (const [name,mutate,code] of [
 ["missing", a=>a.slice(1),"LAYOUT_NODE_MISSING"],
 ["duplicate", a=>[...a,a[0]],"LAYOUT_DUPLICATE_NODE"],
 ["unknown", a=>[...a,{id:"ghost",x:0,y:0,width:1,height:1}],"LAYOUT_UNKNOWN_NODE"],
 ["nan", a=>a.map((x,i)=>i?x:{...x,x:Number.NaN}),"LAYOUT_INVALID_GEOMETRY"],
 ["parent", a=>a.map(x=>x.id==="rds01"?{...x,parent:"wan"}:x),"LAYOUT_PARENT_MISMATCH"],
]) {
 const backend={id:name,async layout(){return {nodes:mutate(valid())}}}; const result=await runAutoLayout(scenario,backend); ok(!result.ok,`${name} backend output rejected`); ok(result.diagnostics.some(d=>d.code===code),`${name} reports ${code}`);
}
const exploding={id:"explode",async layout(){throw new Error("boom")}}; const e=await runAutoLayout(scenario,exploding);ok(!e.ok,"backend exception fails closed");ok(e.diagnostics.some(d=>d.code==="LAYOUT_BACKEND_FAILED"),"backend exception diagnostic");
const override=await runAutoLayout(scenario,{id:"ok",async layout(){return {nodes:valid()}}},{manualOverrides:[{id:"ghost",x:1,y:2}]});ok(override.ok,"unknown override is warning only");ok(override.diagnostics.some(d=>d.code==="LAYOUT_OVERRIDE_UNKNOWN"),"unknown override warning");
console.log(`PASS layout adversarial suite: ${c} assertions.`);
