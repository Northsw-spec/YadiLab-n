import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {performance} from "node:perf_hooks";
import {build} from "esbuild";

/** P3d3 FROZEN before product: independently original 5000/5000 source
 * with parallel authored ports plus two separately reviewed, isolated Builder resources.
 * Genuine bounded ELK/source projections only; Chromium is separately tested.
 */
const folder=mkdtempSync(join(tmpdir(),"yadilab-p3d3-"));
process.on("exit",()=>rmSync(folder,{recursive:true,force:true}));
const bundled=join(folder,"p3d3-focus.mjs");
await build({
  entryPoints:["ui/app/scaled-office-five-thousand-two-edited-focus.mjs"],
  outfile:bundled,bundle:true,format:"esm",platform:"node",
  target:["node22"],logLevel:"silent"
});
const {reviewScaledOfficeFiveThousandTwoAppends:reviewRaw,buildScaledOfficeFiveThousandTwoEditedFocus:buildRaw}=await import(pathToFileURL(bundled).href);
const id=i=>"dev"+String(i).padStart(6,"0");
const port=i=>"p"+String(i).padStart(6,"0");
const sourceIds=Array.from({length:5000},(_,i)=>id(i));
const source={
  formatId:"infrastructure-cyber-lab.scenario",
  schemaVersion:"0.1.0",scenarioId:"p3d3_independent_original_source",
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

const extraA={id:"dev_extra_guard",label:"First independently authored unlinked Builder device",type:"endpoint.windows",asset:{id:"fixture_icon",version:"1.0.0"},interfaces:[],properties:{}};
const extraB={id:"dev_second_guard",label:"Second independently authored unlinked Builder device",type:"endpoint.windows",asset:{id:"fixture_icon",version:"1.0.0"},interfaces:[],properties:{}};
const edited={...source,resources:[...source.resources,extraA,extraB]};
const firstApproved={...source,resources:[...source.resources,extraA]};
const reviewScaledOfficeFiveThousandTwoAppends=(...args)=>reviewRaw(...args,firstApproved,firstApproved);
const buildScaledOfficeFiveThousandTwoEditedFocus=(...args)=>buildRaw(...args,firstApproved,firstApproved);
const oldText=JSON.stringify(source), editedText=JSON.stringify(edited);
let count=0;
const eq=(a,b,message)=>{assert.deepEqual(a,b,message);count++};
const yes=(a,message)=>{assert.ok(a,message);count++};
const denied=async(task,code)=>{await assert.rejects(task,e=>e?.code===code,code);count++};

const gate=reviewScaledOfficeFiveThousandTwoAppends(source,source,edited,edited,sourceIds);
eq(gate.addedIds,[extraA.id,extraB.id],"exact two distinct appended IDs");
eq(gate.originalNodeCount,5000,"original 5000 source nodes");
eq(gate.originalLinkCount,5000,"original 5000 port paired links");
eq(gate.editedNodeCount,5002,"full canonical 5002 nodes");
eq(gate.editedLinkCount,5000,"original 5000 links only");
eq(gate.engineVerified,false,"no engine truth");
eq(gate.physicalTopologyVerified,false,"no physical topology truth");
yes(Object.isFrozen(gate),"frozen explicit review result");

for(const page of [1,2,25,50,51,52]){
  const result=await buildScaledOfficeFiveThousandTwoEditedFocus(source,source,edited,edited,sourceIds,page);
  eq(result.page,page,"chosen page");
  eq(result.pageCount,52,"50 original plus 2 separate pages");
  eq(result.canonicalNodes,5002,"all editable resources preserved");
  eq(result.canonicalLinks,5000,"all original editable links preserved");
  eq(result.twoEditedBounded,true,"distinct second-append review");
  eq(result.engineVerified,false,"no engine projection");
  eq(result.physicalTopologyVerified,false,"no physical projection");
  yes(result.focusCanvas.nodes.length<=116,"max bounded node projection");
  yes(result.focusCanvas.edges.length<=250,"max bounded edge projection");
  yes(result.focusCanvas.nodes.every(n=>n.layoutStatus==="resolved"&&
    Number.isFinite(n.position.x)&&Number.isFinite(n.position.y)&&
    n.width>0&&n.height>0),"actual ELK calculated finite geometry");
  if(page>50){
    const expected=page===51?extraA:extraB;
    eq(result.rowFirst,5000+page-50,"isolated author appended row identity");
    eq(result.rowLast,5000+page-50,"isolated author appended row end");
    eq(result.addedResourceId,expected.id,"exact added ID for page");
    eq(result.addedResourceOriginalLabel,expected.label,"full author entered label preserved");
    eq(result.addedResourceLabel,"ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_OFFICE_ROW","new row explicitly not original Office row");
    eq(result.focusCanvas.nodes.map(n=>n.id),[expected.id],"single correct node on added page");
    eq(result.focusCanvas.nodes[0].data.label,expected.id,"draw exact distinct ID, no label clipping");
    eq(result.focusCanvas.edges.length,0,"no invented links");
  }else{
    eq(result.focusedEdges,100,"100 exact original links selected");
    eq(result.focusedNodes,page===1?100:101,"exact original page and context");
    const expected=new Set(page===1?[
      ...Array.from({length:99},(_,i)=>"office_link_t1_r"+(i+1)),
      "office_link_t1_r5000"
    ]:Array.from({length:100},(_,i)=>
      "office_link_t1_r"+((page-1)*100+i)));
    eq(new Set(result.focusCanvas.edges.map(e=>e.id)),expected,"original SVG edge IDs preserved");
    if(page===1)eq(result.focusCanvas.edges.filter(e=>
      ["office_link_t1_r1","office_link_t1_r5000"].includes(e.id)).length,2,
      "parallel original links distinct");
  }
  eq(JSON.stringify(source),oldText,"baseline immutable after real ELK");
  eq(JSON.stringify(edited),editedText,"full revised source immutable after real ELK");
}
await denied(buildScaledOfficeFiveThousandTwoEditedFocus(source,source,edited,edited,sourceIds,53),"SCALE_P3D3_SELECTION_BLOCKED");
await denied(buildScaledOfficeFiveThousandTwoEditedFocus(source,source,edited,edited,sourceIds,0),"SCALE_P3D3_SELECTION_BLOCKED");
await denied(buildScaledOfficeFiveThousandTwoEditedFocus(source,source,
 {...edited,resources:[...edited.resources,{...extraB,id:"third_not_reviewed"}]},
 edited,sourceIds,52),"SCALE_P3D3_APPEND_ONLY_BLOCKED");
await denied(buildScaledOfficeFiveThousandTwoEditedFocus(source,source,
 {...edited,resources:[...edited.resources,extraB]},edited,sourceIds,52),"SCALE_P3D3_APPEND_ONLY_BLOCKED");
await denied(buildScaledOfficeFiveThousandTwoEditedFocus(source,source,
 {...edited,resources:edited.resources.map((x,i)=>i===100?{...x,label:"tampered original"}:x)},
 edited,sourceIds,1),"SCALE_P3D3_ORIGINAL_CHANGED");
await denied(buildScaledOfficeFiveThousandTwoEditedFocus(source,source,edited,
 {...edited,connections:edited.connections.map((x,i)=>i===4999?{...x,to:{...x.to,port:"eth1"}}:x)},
 sourceIds,50),"SCALE_P3D3_ORIGINAL_CHANGED");
await denied(buildScaledOfficeFiveThousandTwoEditedFocus(source,source,
 {...edited,connections:[...edited.connections,
 {id:"new_cable",kind:"network",from:{resource:extraA.id,port:"eth0"},
 to:{resource:extraB.id,port:"eth0"},properties:{}}]},
 edited,sourceIds,52),"SCALE_P3D3_APPEND_ONLY_BLOCKED");
await denied(buildScaledOfficeFiveThousandTwoEditedFocus(source,source,
 {...edited,resources:[...source.resources,extraA,{...extraB,id:extraA.id}]},
 edited,sourceIds,51),"SCALE_P3D3_APPEND_ONLY_BLOCKED");
await denied(buildScaledOfficeFiveThousandTwoEditedFocus(source,source,
 {...edited,scenarioId:"changed_scenario"},
 edited,sourceIds,51),"SCALE_P3D3_ORIGINAL_CHANGED");
await denied(buildScaledOfficeFiveThousandTwoEditedFocus(source,source,
 {...edited,tests:[{id:"sneak_engine"}]},
 edited,sourceIds,51),"SCALE_P3D3_ORIGINAL_CHANGED");
await denied(buildScaledOfficeFiveThousandTwoEditedFocus(source,source,edited,edited,
 [...sourceIds.slice(1),sourceIds[0]],51),"SCALE_P3D3_ORIGINAL_CHANGED");
await denied(buildRaw(source,source,edited,edited,sourceIds,52,source,source),
  "SCALE_P3D3_FIRST_REVIEW_BLOCKED");
eq(JSON.stringify(source),oldText,"negative cases did not modify baseline");
eq(JSON.stringify(edited),editedText,"negative cases did not modify revised source");
console.log("PASS SCALE-001 P3d3 FROZEN 5000/5000 -> 5002/5000 second independent append: "+count+" bounded ELK/source identity/adversarial assertions, 50 original plus 2 isolated pages; no Engine or physical truth");
