import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {performance} from "node:perf_hooks";
import {build} from "esbuild";

/** P3d2 FROZEN before product: independently original 5000/5000 source
 * with parallel authored ports plus exactly one new isolated Builder resource.
 * Genuine bounded ELK/source projections only; Chromium is separately tested.
 */
const folder=mkdtempSync(join(tmpdir(),"yadilab-p3d2-"));
process.on("exit",()=>rmSync(folder,{recursive:true,force:true}));
const bundled=join(folder,"p3d2-focus.mjs");
await build({
  entryPoints:["ui/app/scaled-office-five-thousand-edited-focus.mjs"],
  outfile:bundled,bundle:true,format:"esm",platform:"node",
  target:["node22"],logLevel:"silent"
});
const {reviewScaledOfficeFiveThousandAppendOnly,buildScaledOfficeFiveThousandEditedFocus}=await import(pathToFileURL(bundled).href);
const id=i=>"dev"+String(i).padStart(6,"0");
const port=i=>"p"+String(i).padStart(6,"0");
const sourceIds=Array.from({length:5000},(_,i)=>id(i));
const source={
  formatId:"infrastructure-cyber-lab.scenario",
  schemaVersion:"0.1.0",scenarioId:"p3d2_independent_original_source",
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

const extra={
  id:"dev_extra_guard",label:"Explicitly authored unconnected Builder device",
  type:"endpoint.windows",asset:{id:"fixture_icon",version:"1.0.0"},
  interfaces:[],properties:{}
};
const edited={...source,resources:[...source.resources,extra]};
const oldText=JSON.stringify(source),editedText=JSON.stringify(edited);
let count=0;
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);count++};
const yes=(value,label)=>{assert.ok(value,label);count++};
const denied=async(job,code)=>{
  await assert.rejects(job,error=>error?.code===code,code);count++;
};
const contract=reviewScaledOfficeFiveThousandAppendOnly(
  source,source,edited,edited,sourceIds);
eq(contract.addedId,extra.id,"exact new Builder resource ID");
eq(contract.originalNodeCount,5000,"all original source rows kept");
eq(contract.originalLinkCount,5000,"all original port-paired rows kept");
eq(contract.editedNodeCount,5001,"one manually added Builder resource");
eq(contract.editedLinkCount,5000,"no invented link");
eq(contract.engineVerified,false,"no Engine truth");
eq(contract.physicalTopologyVerified,false,"no physical link truth");
yes(Object.isFrozen(contract),"review contract immutable");

for(const page of [1,2,25,50,51]){
  const result=await buildScaledOfficeFiveThousandEditedFocus(
    source,source,edited,edited,sourceIds,page);
  eq(result.page,page,"exact reviewed bounded page");
  eq(result.pageCount,51,"one separate added-resource page");
  eq(result.canonicalNodes,5001,"all canonical editable resources preserved");
  eq(result.canonicalLinks,5000,"all original canonical links preserved");
  eq(result.editedBounded,true,"explicit review-only edited scope");
  eq(result.engineVerified,false,"edited focus is never Engine verification");
  eq(result.physicalTopologyVerified,false,"edited focus never declares cable truth");
  yes(result.focusCanvas.nodes.length<=116,"no full 5001-resource layout");
  yes(result.focusCanvas.edges.length<=250,"no full 5000-link layout");
  yes(result.focusCanvas.nodes.every(n=>n.layoutStatus==="resolved"&&
     Number.isFinite(n.position.x)&&Number.isFinite(n.position.y)&&
     n.width>0&&n.height>0),"genuine ELK visible bounded geometry");
  if(page===51){
    eq(result.rowFirst,5001,"new resource distinct from original Office rows");
    eq(result.rowLast,5001,"separate new-resource page");
    eq(result.addedResourceLabel,"ADDED_BUILDER_RESOURCE_NOT_ORIGINAL_OFFICE_ROW",
      "visible nonoriginal status");
    eq(result.focusCanvas.nodes.map(n=>n.id),[extra.id],"exactly new resource drawn");
    eq(result.addedResourceOriginalLabel,extra.label,"full author-entered 46-character label retained");
    eq(result.focusCanvas.nodes[0].data.label,extra.id,
      "actual bounded ELK draws exact source ID, never clips/mutates the long canonical label");
    eq(result.focusCanvas.edges.length,0,"no phantom connection");
    eq(result.hiddenOriginalLinks,5000,"all 5000 original links retained outside added page");
  }else{
    eq(result.focusedEdges,100,"exact original page links");
    eq(result.focusedNodes,page===1?100:101,"original row page + authenticated core peer");
    const expected=new Set(page===1?[
      ...Array.from({length:99},(_,i)=>"office_link_t1_r"+(i+1)),
      "office_link_t1_r5000"
    ]:Array.from({length:100},(_,i)=>
      "office_link_t1_r"+((page-1)*100+i)));
    eq(new Set(result.focusCanvas.edges.map(e=>e.id)),expected,
      "original link identities retained by real ELK");
    if(page===1){
      const samePair=result.focusCanvas.edges.filter(x=>
        ["office_link_t1_r1","office_link_t1_r5000"].includes(x.id));
      eq(samePair.length,2,"distinct parallel original links do not collapse");
    }
  }
  eq(JSON.stringify(source),oldText,"no baseline mutation during focus");
  eq(JSON.stringify(edited),editedText,"no revised Builder mutation during focus");
}
await denied(buildScaledOfficeFiveThousandEditedFocus(
  source,source,edited,edited,sourceIds,52),"SCALE_P3D2_SELECTION_BLOCKED");
await denied(buildScaledOfficeFiveThousandEditedFocus(
  source,source,edited,edited,sourceIds,0),"SCALE_P3D2_SELECTION_BLOCKED");
await denied(buildScaledOfficeFiveThousandEditedFocus(
  source,source,{...edited,resources:[...edited.resources,extra]},edited,sourceIds,51),
  "SCALE_P3D2_APPEND_ONLY_BLOCKED");
await denied(buildScaledOfficeFiveThousandEditedFocus(
  source,source,{...edited,resources:edited.resources.map((x,i)=>i===3?{...x,label:"Tampered original"}:x)},
  edited,sourceIds,1),"SCALE_P3D2_ORIGINAL_CHANGED");
await denied(buildScaledOfficeFiveThousandEditedFocus(
  source,source,edited,{...edited,connections:edited.connections.map((x,i)=>
    i===0?{...x,from:{...x.from,port:"eth1"}}:x)},sourceIds,1),
  "SCALE_P3D2_ORIGINAL_CHANGED");
await denied(buildScaledOfficeFiveThousandEditedFocus(
  source,source,{...edited,connections:[...edited.connections,edited.connections[0]]},
  edited,sourceIds,51),"SCALE_P3D2_APPEND_ONLY_BLOCKED");
await denied(buildScaledOfficeFiveThousandEditedFocus(
  source,source,edited,{...edited,resources:[...source.resources,source.resources[0]]},
  sourceIds,51),"SCALE_P3D2_APPEND_ONLY_BLOCKED");
await denied(buildScaledOfficeFiveThousandEditedFocus(
  source,source,edited,edited,[...sourceIds.slice(1),sourceIds[0]],51),
  "SCALE_P3D2_ORIGINAL_CHANGED");
eq(JSON.stringify(source),oldText,"negative cases preserve baseline source");
eq(JSON.stringify(edited),editedText,"negative cases preserve current Builder source");
console.log("PASS SCALE-001 P3d2 FROZEN append-one original Office 5000/5000 -> 5001/5000: "+
  count+" genuine ELK/identity/adversarial assertions, pages 1/2/25/50/51, no full graph or Engine claim");
