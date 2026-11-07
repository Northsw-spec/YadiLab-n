import fs from "node:fs"; import path from "node:path"; import assert from "node:assert/strict"; import { fileURLToPath } from "node:url";
import { buildLayoutGraph, runAutoLayout, outputPortId, inputPortId, ElkLayoutBackend, ZONE_HEADER_RESERVED_HEIGHT } from "../../dist-layout-test/layout/src/index.js";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../.."); const scenario=JSON.parse(fs.readFileSync(path.join(root,"tests/fixtures/valid/scenario-normalized.json"),"utf8"));
let c=0; const ok=(v,m)=>{assert.ok(v,m);c++}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);c++};
const graph=buildLayoutGraph(scenario);
eq(graph.id,"__root__","root graph neutral id"); eq(graph.edges.length,scenario.connections.length,"all semantic connections projected");
const flatten=(nodes,out=[])=>{for(const n of nodes){out.push(n);flatten(n.children,out)}return out}; const flat=flatten(graph.children);
eq(flat.length,scenario.zones.length+scenario.resources.length,"all zones/resources in layout graph");
eq(flat.find(n=>n.id==="rds01").parent,"server","resource hierarchy preserved");
const elkRaw=await new ElkLayoutBackend().layout(graph);
const elkChildren=elkRaw.nodes.filter((node)=>node.parent);
ok(elkChildren.length>0,"real ELK backend returns compound child geometry");
ok(elkChildren.every((node)=>node.y>=ZONE_HEADER_RESERVED_HEIGHT),"real ELK backend keeps every child below reserved zone header");

const withPort=structuredClone(scenario); withPort.resources.find(r=>r.id==="admin01").interfaces=[{id:"eth0",label:"eth0",addresses:[]}]; withPort.resources.find(r=>r.id==="rds01").interfaces=[{id:"eth1",label:"eth1",addresses:[]}]; const ce=withPort.connections.find(x=>x.id==="admin_rds"); ce.from.port="eth0";ce.to.port="eth1"; const gp=buildLayoutGraph(withPort); const pe=gp.edges.find(x=>x.id==="admin_rds");
eq(pe.sourcePort,outputPortId("admin01","eth0"),"source port globally unique"); eq(pe.targetPort,inputPortId("rds01","eth1"),"target port globally unique");

const visualValidNodes=(g)=>{const out=[];g.children.forEach((n,rootIndex)=>{out.push({id:n.id,x:rootIndex*800,y:0,width:n.width,height:n.height});n.children.forEach((child,childIndex)=>out.push({id:child.id,x:40+(childIndex%2)*220,y:72+Math.floor(childIndex/2)*130,width:child.width,height:child.height,parent:n.id}));});return out;};
class FakeBackend { id="fake"; async layout(g){return {nodes:visualValidNodes(g)}} }
const first=await runAutoLayout(scenario,new FakeBackend()); ok(first.ok,"backend-independent layout succeeds"); ok(first.document,"layout document emitted"); eq(first.document.engine,"elk.layered","public layout contract engine remains ELK identity"); eq(first.document.nodes.length,flat.length,"layout document complete");
const second=await runAutoLayout(scenario,new FakeBackend()); eq(second,first,"identical graph/backend yields deterministic document");
const manual=await runAutoLayout(scenario,new FakeBackend(),{manualOverrides:[{id:"rds01",x:300,y:300,width:222}]}); ok(manual.ok,"manual override accepted"); const r=manual.document.nodes.find(x=>x.id==="rds01"); eq(r.x,300,"manual x overrides generated layout");eq(r.y,300,"manual y overrides generated layout");eq(r.width,222,"manual dimension override");eq(r.manualOverride,true,"manual override marked separately");
console.log(`PASS layout suite: ${c} assertions.`);
