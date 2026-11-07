import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {performance} from "node:perf_hooks";
import {build} from "esbuild";

/**
 * SCALE-001 P3c2a: frozen BEFORE any new 5,000-node focus product code.
 *
 * Independently authored canonical 5,000/5,000 normalized graph, including
 * a second genuinely original same-pair/different-port edge. Exercise real
 * ELK + browser canvas projection of bounded source-identity subsets; this
 * IS NOT a mounted real Chromium/ReactFlow DOM acceptance (separate P3c2b).
 * No synthetic aggregate edge, vanished canonical edge or Engine PASS.
 */
const folder=mkdtempSync(join(tmpdir(),"yadilab-p3c2a-"));
process.on("exit",()=>rmSync(folder,{recursive:true,force:true}));
const bundled=join(folder,"p3c2a-focus.mjs");
await build({
  entryPoints:["ui/app/scaled-office-five-thousand-focus.mjs"],
  outfile:bundled,bundle:true,format:"esm",platform:"node",
  target:["node22"],logLevel:"silent"
});
const {buildScaledOfficeFiveThousandFocus}=await import(pathToFileURL(bundled).href);
const id=i=>"dev"+String(i).padStart(6,"0");
const port=i=>"p"+String(i).padStart(6,"0");
const sourceIds=Array.from({length:5000},(_,i)=>id(i));
const source={
  formatId:"infrastructure-cyber-lab.scenario",
  schemaVersion:"0.1.0",scenarioId:"p3c2a_independent_original_source",
  metadata:{title:"Independent original-port network source"},
  assetLocks:[{id:"fixture_icon",version:"1.0.0",
    path:"assets/builtin/endpoint.linux.svg",mime:"image/svg+xml",
    width:64,height:64,trusted:true}],
  zones:[],
  resources:sourceIds.map((name,i)=>({
    id:name,label:name,type:i?"endpoint.windows":"network.switch",
    asset:{id:"fixture_icon",version:"1.0.0"},
    interfaces:i===0?
      Array.from({length:5000},(_,j)=>({id:port(j+1),label:port(j+1),addresses:[]})):
      [{id:"eth0",label:"eth0",addresses:[]},
       ...(i===1?[{id:"eth1",label:"eth1",addresses:[]}]:[])],
    properties:{}
  })),
  connections:[
    ...Array.from({length:4999},(_,j)=>{
      const i=j+1;
      return {id:"office_link_t1_r"+i,kind:"network",
        from:{resource:id(i),port:"eth0"},
        to:{resource:id(0),port:port(i)},properties:{}};
    }),
    {id:"office_link_t1_r5000",kind:"network",
     from:{resource:id(1),port:"eth1"},
     to:{resource:id(0),port:port(5000)},properties:{}}
  ],
  tests:[],findings:[],objectives:[],hints:[],notes:[],
  completion:{path:"imported_topology_manual_verification"}
};
const originalSnapshot=JSON.stringify(source);
let checked=0;
const eq=(got,want,label)=>{assert.deepEqual(got,want,label);checked++};
const yes=(condition,label)=>{assert.ok(condition,label);checked++};
const rejected=async (p,code)=>{await assert.rejects(p,e=>e?.code===code,code);checked++};
const times=[];
for(const page of [1,2,25,50]){
  const start=performance.now();
  const focus=await buildScaledOfficeFiveThousandFocus(source,sourceIds,page);
  eq(focus.page,page,"original row page");
  eq(focus.canonicalNodes,5000,"full canonical Builder nodes preserved");
  eq(focus.canonicalLinks,5000,"full original source edges preserved");
  eq(focus.rowFirst,(page-1)*100+1,"first original source row");
  eq(focus.rowLast,page*100,"last original source row");
  eq(focus.focusedNodes,page===1?100:101,"bounded 100 rows plus at most one real connected hub");
  eq(focus.focusedEdges,100,"exact 100 original source links visible");
  eq(focus.hiddenOriginalLinks,4900,"hidden original source edges explicitly counted");
  eq(focus.canActivate,false,"display-only never authorizes activation");
  eq(focus.engineVerified,false,"no fabricated Engine verification");
  eq(focus.physicalTopologyVerified,false,"no fabricated physical cable truth");
  eq(focus.focusCanvas.nodes.length,page===1?100:101,"real ELK projected source nodes");
  eq(focus.focusCanvas.edges.length,100,"real ELK projected original links");
  eq(new Set(focus.focusCanvas.nodes.map(x=>x.id)).size,focus.focusedNodes,
    "no duplicated SVG semantic node identities");
  eq(new Set(focus.focusCanvas.edges.map(x=>x.id)).size,100,
    "no duplicate/inferred SVG semantic edge identities");
  const expected=new Set(page===1?[
    ...Array.from({length:99},(_,i)=>"office_link_t1_r"+(i+1)),
    "office_link_t1_r5000"
  ]:Array.from({length:100},(_,i)=>
    "office_link_t1_r"+((page-1)*100+i)));
  eq(new Set(focus.focusCanvas.edges.map(x=>x.id)),expected,
    "exact original source link ID subset; no arbitrary inferred links");
  yes(focus.focusCanvas.nodes.every(x=>x.layoutStatus==="resolved"&&
    Number.isFinite(x.position.x)&&Number.isFinite(x.position.y)&&
    x.width>0&&x.height>0),"real ELK finite node geometry");
  yes(focus.focusCanvas.diagnostics.every(x=>x.severity!=="error"),
    "no canvas projection error");
  eq(JSON.stringify(source),originalSnapshot,"focus never mutates Builder source");
  times.push({page,shownNodes:focus.focusedNodes,shownOriginalLinks:focus.focusedEdges,
    elapsedMs:Math.round(performance.now()-start),
    heapUsedMiB:Math.round(process.memoryUsage().heapUsed/1048576)});
}
const focus1=await buildScaledOfficeFiveThousandFocus(source,sourceIds,1);
const first=new Set(focus1.focusCanvas.edges.map(x=>x.id));
yes(first.has("office_link_t1_r1")&&first.has("office_link_t1_r5000"),
  "two separate originally declared links between same pair");
const exact=source.connections.filter(x=>first.has(x.id));
eq(exact.filter(x=>x.from.resource===id(1)&&x.to.resource===id(0))
   .map(x=>[x.from.port,x.to.port]),
   [["eth0",port(1)],["eth1",port(5000)]],
   "both original parallel port pairs survive focus, no merged cable");
eq(focus1.contextNodeIds,[],"page 1 does not infer external context");
const focus2=await buildScaledOfficeFiveThousandFocus(source,sourceIds,2);
eq(focus2.contextNodeIds,[id(0)],
  "page 2 only shows the genuinely connected original core as context");
const focus50=await buildScaledOfficeFiveThousandFocus(source,sourceIds,50);
yes(focus50.focusCanvas.nodes.some(x=>x.id===id(4999)),
  "last original node searchable/visible on page 50");
yes(focus50.focusCanvas.nodes.every(x=>x.id===id(0)||
  sourceIds.indexOf(x.id)>=4900),"no unrelated rows on final page");

await rejected(buildScaledOfficeFiveThousandFocus(source,sourceIds,0),
  "SCALE_P3C2_FOCUS_SELECTION_BLOCKED");
await rejected(buildScaledOfficeFiveThousandFocus(source,sourceIds,51),
  "SCALE_P3C2_FOCUS_SELECTION_BLOCKED");
await rejected(buildScaledOfficeFiveThousandFocus(source,sourceIds,1.5),
  "SCALE_P3C2_FOCUS_SELECTION_BLOCKED");
await rejected(buildScaledOfficeFiveThousandFocus(source,sourceIds.slice(0,4999),1),
  "SCALE_P3C2_FOCUS_SELECTION_BLOCKED");
await rejected(buildScaledOfficeFiveThousandFocus(source,[id(0),...sourceIds.slice(0,4999)],1),
  "SCALE_P3C2_FOCUS_SOURCE_MISMATCH");
await rejected(buildScaledOfficeFiveThousandFocus({...source,
  connections:source.connections.slice(1)},sourceIds,1),
  "SCALE_P3C2_FOCUS_SOURCE_MISMATCH");
await rejected(buildScaledOfficeFiveThousandFocus({...source,
  connections:[...source.connections.slice(0,4999),source.connections[0]]},
  sourceIds,1),"SCALE_P3C2_FOCUS_DUPLICATE_EDGE");
await rejected(buildScaledOfficeFiveThousandFocus({...source,
  connections:source.connections.map((x,i)=>i===0?
    {...x,to:{...x.to,resource:"missing999"}}:x)
},sourceIds,1),"SCALE_P3C2_FOCUS_SOURCE_MISMATCH");
await rejected(buildScaledOfficeFiveThousandFocus({...source,
  connections:source.connections.map((x,i)=>i===4999?
    {...x,to:{...x.to,port:port(1)}}:x)
},sourceIds,1),"SCALE_P3C2_FOCUS_PORT_MISMATCH");
eq(JSON.stringify(source),originalSnapshot,"all adversarial cases left source unchanged");
console.log("PASS SCALE-001 P3c2a FROZEN source-only genuine ELK focus for 5000/5000 "+
  "pages 1/2/25/50, exact original parallel ports, "+checked+
  " positive/negative assertions; "+JSON.stringify(times)+
  "; mounted Chromium/ReactFlow/5k UI not verified");
