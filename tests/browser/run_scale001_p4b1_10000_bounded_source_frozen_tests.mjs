import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";

/** Frozen FIRST: exact 10k/10k source-declared CSV-ring identities into
 * bounded real ELK + projected canvas, before new P4b1 production module.
 * Separate mounted Chromium accepts original-file UI and real ReactFlow DOM.
 */
const folder=mkdtempSync(join(tmpdir(),"yadilab-p4b1-"));
process.on("exit",()=>rmSync(folder,{recursive:true,force:true}));
const file=join(folder,"focus.mjs");
await build({
  entryPoints:["ui/app/scaled-network-ten-thousand-focus.mjs"],
  outfile:file,bundle:true,format:"esm",platform:"node",target:["node22"],logLevel:"silent"
});
const {buildScaledNetworkTenThousandFocus}=await import(pathToFileURL(file).href);
const N=10000, id=i=>i===0?"core0000":"host"+String(i).padStart(6,"0");
const ids=Array.from({length:N},(_,i)=>id(i));
const model={
  formatId:"infrastructure-cyber-lab.scenario",schemaVersion:"0.1.0",
  scenarioId:"p4b1_synthetic_original_csv_ring",
  metadata:{title:"Synthetic original CSV ring, not physical cabling"},
  assetLocks:[{id:"fixture_icon",version:"1.0.0",path:"assets/builtin/endpoint.linux.svg",
    mime:"image/svg+xml",width:64,height:64,trusted:true}],
  zones:[],
  resources:ids.map((name,i)=>({
    id:name,label:name,type:i===0?"network.switch":"endpoint.windows",
    asset:{id:"fixture_icon",version:"1.0.0"},
    interfaces:[],properties:{}
  })),
  connections:ids.map((name,i)=>({
    id:"link_row_"+(i+1),kind:"network",
    from:{resource:name},
    to:{resource:id(i===0?N-1:i-1)},
    properties:{}
  })),
  tests:[],findings:[],objectives:[],hints:[],notes:[],
  completion:{path:"imported_topology_manual_verification"}
};
const original=JSON.stringify(model);
let assertions=0;
const eq=(actual,expected,msg)=>{assert.deepEqual(actual,expected,msg);assertions++};
const yes=(ok,msg)=>{assert.ok(ok,msg);assertions++};
const denies=async(task,code)=>{
  await assert.rejects(task,e=>e?.code===code,code);assertions++;
};
for(const page of [1,2,50,100]){
  const result=await buildScaledNetworkTenThousandFocus(model,ids,page);
  eq(result.page,page,"original row page");
  eq(result.pageCount,100,"100 source row pages, 100 per page");
  eq(result.canonicalNodes,N,"canonical resource count is never clipped");
  eq(result.canonicalLinks,N,"canonical original link count never clipped");
  eq(result.focusedNodes,102,"exact ring page has two context peers");
  eq(result.focusedEdges,101,"each ring source row page shows 101 exact declared edges");
  eq(result.hiddenOriginalLinks,N-101,"all offscreen canonical links retained");
  yes(result.focusCanvas.nodes.length<=116,"bound at most 116 node DOM projections");
  yes(result.focusCanvas.edges.length<=250,"bound at most 250 original link paths");
  const first=(page-1)*100,last=page*100-1;
  const expectedNodes=new Set([
    ...Array.from({length:100},(_,i)=>id(first+i)),
    id((first-1+N)%N),id((last+1)%N)
  ]);
  eq(new Set(result.focusCanvas.nodes.map(n=>n.id)),expectedNodes,
    "original source-row identities plus only declared direct ring boundary peers");
  const expectedLinks=new Set([
    ...Array.from({length:100},(_,i)=>"link_row_"+(first+i+1)),
    "link_row_"+(last+2>N?1:last+2)
  ]);
  eq(new Set(result.focusCanvas.edges.map(e=>e.id)),expectedLinks,
    "correct actual original links including both page boundaries");
  for(const edge of result.focusCanvas.edges){
    const index=Number(edge.id.slice("link_row_".length))-1;
    const expected=model.connections[index];
    yes(Boolean(expected),"every rendered edge is a true original source ID");
    eq(edge.source,expected.from.resource,"exact original from ID");
    eq(edge.target,expected.to.resource,"exact original to ID");
  }
  yes(result.focusCanvas.nodes.every(n=>n.layoutStatus==="resolved"&&
      Number.isFinite(n.position?.x)&&Number.isFinite(n.position?.y)&&
      n.width>0&&n.height>0),"real finite ELK geometry per bounded node");
  eq(result.canActivate,false,"no automatic Runtime/Engine activation");
  eq(result.engineVerified,false,"no Engine truth");
  eq(result.physicalTopologyVerified,false,"no physical cabling proof");
  eq(JSON.stringify(model),original,"original full source immutable after ELK");
}
await denies(buildScaledNetworkTenThousandFocus(model,ids,0),
  "SCALE_P4B1_SELECTION_BLOCKED");
await denies(buildScaledNetworkTenThousandFocus(model,ids,101),
  "SCALE_P4B1_SELECTION_BLOCKED");
await denies(buildScaledNetworkTenThousandFocus(
  {...model,resources:model.resources.slice(0,N-1)},ids,1),
  "SCALE_P4B1_SOURCE_BLOCKED");
await denies(buildScaledNetworkTenThousandFocus(
  {...model,connections:model.connections.slice(0,N-1)},ids,1),
  "SCALE_P4B1_SOURCE_BLOCKED");
await denies(buildScaledNetworkTenThousandFocus(
  {...model,resources:model.resources.map((r,i)=>i===1?{...r,id:id(0)}:r)},ids,1),
  "SCALE_P4B1_SOURCE_BLOCKED");
await denies(buildScaledNetworkTenThousandFocus(
  {...model,connections:model.connections.map((e,i)=>
    i===8?{...e,to:{resource:"missing_node"}}:e)},ids,1),
  "SCALE_P4B1_SOURCE_BLOCKED");
await denies(buildScaledNetworkTenThousandFocus(
  {...model,connections:model.connections.map((e,i)=>
    i===8?{...e,id:"link_row_1"}:e)},ids,1),
  "SCALE_P4B1_SOURCE_BLOCKED");
await denies(buildScaledNetworkTenThousandFocus(model,
 [...ids.slice(1),ids[0]],1),"SCALE_P4B1_SOURCE_BLOCKED");
await denies(buildScaledNetworkTenThousandFocus(
  {...model,connections:model.connections.map((e,i)=>
    i===8?{...e,from:{resource:id(8),port:"fabricated_port"}}:e)},ids,1),
  "SCALE_P4B1_SOURCE_BLOCKED");
eq(JSON.stringify(model),original,"negative cases left original model untouched");
console.log("PASS SCALE-001 P4b1 FROZEN real ELK 10000 original CSV resources and 10000 explicitly sourced links, 4 bounded page projections, "+assertions+" identity/adversarial assertions, no physical or Engine claim");
