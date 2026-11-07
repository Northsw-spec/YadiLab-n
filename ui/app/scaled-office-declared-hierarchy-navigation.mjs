import React,{useState} from "react";
const e=React.createElement;
const LEDGER_PAGE=25;

/**
 * P2b2C user-approved presentation navigation only.
 * No site, floor, port or cable is inferred from IPs, names, layouts, or
 * imported private Office columns. The actual source is never edited here.
 */
export function DeclaredOfficeHierarchyNavigation({
  approved,focus,busy,onNavigate,onRestore,canonicalDeviceIds
}){
  const [siteId,setSiteId]=useState("");
  const [buildingId,setBuildingId]=useState("");
  const [floorId,setFloorId]=useState("");
  const [query,setQuery]=useState("");
  const [localError,setLocalError]=useState("");
  const [ledgerPage,setLedgerPage]=useState(1);
  const buildings=approved.declaredBuildings.filter(x=>x.siteId===siteId);
  const floors=approved.declaredFloors.filter(x=>x.buildingId===buildingId);
  const members=approved.memberships;
  const siteValue=x=>setSiteId(x);
  const show=(kind,value)=>{
    if(!value)return;
    setLocalError("");
    void onNavigate(kind,value,1,null);
  };
  const selectSite=value=>{
    siteValue(value);setBuildingId("");setFloorId("");
    show("site",value);
  };
  const selectBuilding=value=>{
    setBuildingId(value);setFloorId("");
    show("building",value);
  };
  const selectFloor=value=>{setFloorId(value);show("floor",value);};
  const search=()=>{
    const found=members.find(x=>x.deviceId===query);
    if(!found){
      setLocalError("SCALE_P2B2_EXACT_APPROVED_DEVICE_REQUIRED");
      return;
    }
    const selected=new Set(members.filter(x=>x.floorId===found.floorId).map(x=>x.deviceId));
    const ordered=canonicalDeviceIds.filter(id=>selected.has(id));
    const index=ordered.indexOf(found.deviceId);
    if(index<0){
      setLocalError("SCALE_P2B2_EXACT_APPROVED_DEVICE_REQUIRED");
      return;
    }
    setLocalError("");setSiteId(found.siteId);
    setBuildingId(found.buildingId);setFloorId(found.floorId);
    void onNavigate("floor",found.floorId,Math.floor(index/100)+1,found.deviceId);
  };
  const select=(tag,label,value,change,options,emptyLabel)=>e("label",null,label,
    e("select",{[tag]:"true",value,disabled:busy,onChange:event=>change(event.currentTarget.value)},
      e("option",{value:""},emptyLabel),
      ...options.map(x=>e("option",{key:x.id,value:x.id},x.label+" · "+x.id))));
  const allLedger=approved.crossSiteOriginalLinks;
  const ledgerPages=Math.max(1,Math.ceil(allLedger.length/LEDGER_PAGE));
  const ledger=allLedger.slice((ledgerPage-1)*LEDGER_PAGE,ledgerPage*LEDGER_PAGE);
  return e("section",{"data-scale-p2b2-navigation":"READY_FOR_PRESENTATION"},
    e("h3",null,"User-declared site → building → floor navigation"),
    e("p",null,"MODELED_NOT_PHYSICAL. Declared membership is not discovered geography. "+
      "Only original source-bound links between two currently visible approved devices are drawn."),
    select("data-scale-p2b2-site-select","User-declared site",siteId,selectSite,
      approved.declaredSites,"Choose approved site"),
    select("data-scale-p2b2-building-select","User-declared building",buildingId,
      selectBuilding,buildings,"Choose building inside selected site"),
    select("data-scale-p2b2-floor-select","User-declared floor",floorId,
      selectFloor,floors,"Choose floor inside selected building"),
    e("div",null,
      e("label",null,"Find exact original approved device ID across all declared sites",
        e("input",{type:"text","data-scale-p2b2-search":"true",
          value:query,disabled:busy,
          onChange:event=>{setQuery(event.currentTarget.value);setLocalError("");},
          placeholder:"Exact original device ID (never inferred)"})),
      e("button",{type:"button","data-scale-p2b2-search-go":"true",
        disabled:busy||!query,onClick:search},"Focus approved original device"),
      localError?e("p",{role:"alert","data-scale-p2b2-search-error":"BLOCKED"},localError):null),
    focus?e("section",{
      "data-scale-p2b2-focus-kind":focus.scopeKind,
      "data-scale-p2b2-focus-id":focus.scopeId,
      "data-scale-p2b2-physical":"false",
      ...(focus.focusDeviceId?{"data-scale-p2b2-focus-selected":focus.focusDeviceId}:{})
    },
      e("strong",null,"MODELED_NOT_PHYSICAL · read-only original source subset"),
      e("p",null,focus.membersInScope+" assigned originals in this declared scope; "+
        focus.focusedNodes+" visible nodes, "+focus.focusedEdges+" visible source links; "+
        focus.hiddenOriginalLinks+" original links outside current view."),
      e("p",null,"Page "+focus.page+" of "+focus.pageCount+
        " · max 100 original nodes per view; no cross-scope physical cable synthesized."),
      e("div",null,
        e("button",{type:"button","data-scale-p2b2-prev-page":"true",
          disabled:busy||focus.page<=1,
          onClick:()=>void onNavigate(focus.scopeKind,focus.scopeId,focus.page-1,null)},
          "Previous approved device page"),
        e("button",{type:"button","data-scale-p2b2-next-page":"true",
          disabled:busy||focus.page>=focus.pageCount,
          onClick:()=>void onNavigate(focus.scopeKind,focus.scopeId,focus.page+1,null)},
          "Next approved device page"))
    ):e("p",{"data-scale-p2b2-no-focus":"true"},
      "Select an explicitly declared site to show only its approved original devices."),
    busy?e("p",{"data-scale-p2b2-focus-busy":"true"},"Rendering bounded original source subset…"):null,
    e("button",{type:"button","data-scale-p2b2-restore-row-focus":"true",
      disabled:busy,onClick:()=>{
        setSiteId("");setBuildingId("");setFloorId("");setQuery("");
        onRestore();
      }},"Restore original source-row focus"),
    e("section",{"data-scale-p2b2-link-ledger":"ORIGINAL_LINK_REFERENCES"},
      e("h4",null,"Exact original cross-site link evidence · not physical discovery"),
      e("p",null,"No aggregate physical cable is drawn. "+
        allLedger.length+" cross-site source-declared link references "+
        "with individually retained original endpoint and port pairs."),
      e("p",null,"An original link crossing two user-declared sites is evidence of "+
        "source-declared topology only. It is not a verified site-to-site cable."),
      e("table",null,
        e("thead",null,e("tr",null,
          ...["Original link ID","Original from","From port","Original to","To port","Declared sites"].map(x=>
            e("th",{key:x},x)))),
        e("tbody",null,...ledger.map(x=>e("tr",{
          key:x.linkId,
          "data-scale-p2b2-ledger-row":x.linkId,
          "data-scale-p2b2-from":x.from.resource,
          "data-scale-p2b2-from-port":x.from.port??"",
          "data-scale-p2b2-to":x.to.resource,
          "data-scale-p2b2-to-port":x.to.port??""
        },
          e("td",null,x.linkId),
          e("td",null,x.from.resource),
          e("td",null,x.from.port??"NO DECLARED PORT"),
          e("td",null,x.to.resource),
          e("td",null,x.to.port??"NO DECLARED PORT"),
          e("td",null,x.fromSiteId+" → "+x.toSiteId))))),
      e("p",null,"Original link ledger page "+ledgerPage+" of "+ledgerPages+
        ". Only 25 original evidence rows rendered at once."),
      e("button",{type:"button","data-scale-p2b2-ledger-prev":"true",
        disabled:ledgerPage<=1,onClick:()=>setLedgerPage(n=>n-1)},"Previous ledger page"),
      e("button",{type:"button","data-scale-p2b2-ledger-next":"true",
        disabled:ledgerPage>=ledgerPages,onClick:()=>setLedgerPage(n=>n+1)},"Next ledger page")));}
