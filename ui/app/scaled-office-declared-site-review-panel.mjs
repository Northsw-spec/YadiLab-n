import React,{useEffect,useRef,useState} from "react";
import {DECLARED_OFFICE_SITE_PROFILE} from "./scaled-office-declared-site-hierarchy.mjs";

const e=React.createElement;
const validId=value=>typeof value==="string"&&/^[a-z][a-z0-9_-]{0,63}$/.test(value);
const validLabel=value=>typeof value==="string"&&value===value.trim()&&
  value.length>=1&&value.length<=96&&!/[\x00-\x1f\x7f<>]/.test(value);
const errorCode=value=>typeof value?.code==="string"&&/^SCALE_P2B2_[A-Z0-9_]+$/.test(value.code)
  ?value.code:"SCALE_P2B2_REVIEW_BLOCKED";
const blocked=code=>{const error=new Error(code);error.code=code;throw error;};

/**
 * SCALE-001 P2b2B: no imported Office bytes or unchecked source columns enter
 * this component. Only the already consented original Builder device IDs
 * are eligible. All geographic labels are manually entered declarations,
 * never facts discovered by the importer.
 *
 * This panel authors a presentation-only sidecar. The host MUST provide the
 * real, separately trusted source hashes to the P2b2A source validator; the
 * sidecar cannot authorize or validate itself.
 */
export function DeclaredOfficeSiteReviewPanel({nodeIds,onConfirm,onClose}){
  const [sites,setSites]=useState([]);
  const [buildings,setBuildings]=useState([]);
  const [floors,setFloors]=useState([]);
  const [assignments,setAssignments]=useState([]);
  const [siteDraft,setSiteDraft]=useState({id:"",label:""});
  const [buildingDraft,setBuildingDraft]=useState({id:"",label:"",siteId:""});
  const [floorDraft,setFloorDraft]=useState({id:"",label:"",buildingId:""});
  const [devicesDraft,setDevicesDraft]=useState("");
  const [deviceFloor,setDeviceFloor]=useState("");
  const [approvedDefinitions,setApprovedDefinitions]=useState(false);
  const [approvedAssignments,setApprovedAssignments]=useState(false);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const token=useRef(0),panelRef=useRef(null);
  const knownDevices=new Set(nodeIds);
  const ownerIds=new Set([...sites,...buildings,...floors].map(x=>x.id));
  const touch=()=>{
    token.current++;
    setApprovedDefinitions(false);setApprovedAssignments(false);
    setError("");
  };
  const failVisible=code=>setError(code);
  const close=()=>{token.current++;onClose?.();};
  useEffect(()=>{
    panelRef.current?.focus();
    const key=event=>{if(event.key==="Escape")close();};
    document.addEventListener("keydown",key);
    return()=>{token.current++;document.removeEventListener("keydown",key);};
  },[onClose]);
  const addGroup=(kind,draft,setDraft,setItems)=>{
    if(busy)return;
    try{
      if(!validId(draft.id)||!validLabel(draft.label)||
         ownerIds.has(draft.id))
        blocked("SCALE_P2B2_DECLARATIONS_INVALID");
      if(kind==="building"&&!sites.some(x=>x.id===draft.siteId)||
         kind==="floor"&&!buildings.some(x=>x.id===draft.buildingId))
        blocked("SCALE_P2B2_PARENT_INVALID");
      touch();
      setItems(old=>[...old,{...draft,acknowledged:false}]);
      setDraft(kind==="site"?{id:"",label:""}:
        kind==="building"?{id:"",label:"",siteId:draft.siteId}:
        {id:"",label:"",buildingId:draft.buildingId});
    }catch(cause){failVisible(errorCode(cause));}
  };
  const removeGroup=(kind,id)=>{
    if(busy)return;
    if(kind==="site"&&buildings.some(x=>x.siteId===id)||
       kind==="building"&&floors.some(x=>x.buildingId===id)||
       kind==="floor"&&assignments.some(x=>x.floorId===id)){
      failVisible("SCALE_P2B2_PARENT_IN_USE");return;
    }
    touch();
    const setter=kind==="site"?setSites:kind==="building"?setBuildings:setFloors;
    setter(old=>old.filter(x=>x.id!==id));
  };
  const ackGroup=(kind,id,value)=>{
    if(busy)return;touch();
    const setter=kind==="site"?setSites:kind==="building"?setBuildings:setFloors;
    setter(old=>old.map(x=>x.id===id?{...x,acknowledged:value}:x));
  };
  const addAssignment=()=>{
    if(busy)return;
    try{
      const ids=devicesDraft.split(/[\s,;]+/).filter(Boolean);
      if(!ids.length||ids.length>100||
         !floors.some(x=>x.id===deviceFloor)||
         ids.some(id=>!validId(id)||!knownDevices.has(id))||
         new Set(ids).size!==ids.length||
         ids.some(id=>assignments.some(x=>x.deviceId===id)))
        blocked("SCALE_P2B2_ASSIGNMENT_INVALID");
      touch();
      setAssignments(old=>[...old,...ids.map(deviceId=>({
        deviceId,floorId:deviceFloor,acknowledged:false
      }))]);
      setDevicesDraft("");
    }catch(cause){failVisible(errorCode(cause));}
  };
  const ackAssignment=(id,value)=>{
    if(busy)return;touch();
    setAssignments(old=>old.map(x=>x.deviceId===id?{...x,acknowledged:value}:x));
  };
  const removeAssignment=id=>{
    if(busy)return;touch();
    setAssignments(old=>old.filter(x=>x.deviceId!==id));
  };
  const allDefinitions=[...sites,...buildings,...floors];
  const definitionsReady=sites.length>0&&buildings.length>0&&floors.length>0&&
    allDefinitions.every(x=>x.acknowledged);
  const assignmentsReady=assignments.length>0&&
    assignments.every(x=>x.acknowledged);
  const canConfirm=definitionsReady&&assignmentsReady&&
    approvedDefinitions&&approvedAssignments&&!busy;
  const confirm=async()=>{
    if(!canConfirm)return;
    const start=token.current;
    const isCurrent=()=>start===token.current&&
      approvedDefinitions&&approvedAssignments;
    setBusy(true);setError("");
    try{
      const declaration={
        formatId:DECLARED_OFFICE_SITE_PROFILE,schemaVersion:"1.0.0",
        // Host replaces these placeholders with separately stored, trusted
        // original SHA and freshly computed full Builder hash.
        declaredByUser:true,
        sites,buildings,floors,areas:[],assignments
      };
      await onConfirm(declaration,isCurrent);
      if(isCurrent())close();
    }catch(cause){
      if(isCurrent())setError(errorCode(cause));
    }finally{if(isCurrent())setBusy(false);}
  };
  const textInput=(marker,value,onChange,label)=>e("label",null,label,
    e("input",{type:"text",[marker]:"true",value,disabled:busy,
      onChange:event=>onChange(event.currentTarget.value)}));
  const optionList=(marker,value,onChange,label,items)=>e("label",null,label,
    e("select",{[marker]:"true",value,disabled:busy,
      onChange:event=>onChange(event.currentTarget.value)},
      e("option",{value:""},"Select an explicitly declared parent"),
      ...items.map(x=>e("option",{value:x.id,key:x.id},x.id+" · "+x.label))));
  const rows=(kind,items)=>e("ul",{["data-scale-p2b2-"+kind+"-rows"]:String(items.length)},
    ...items.map(x=>e("li",{key:x.id},
      e("label",null,e("input",{type:"checkbox",
        "data-scale-p2b2-ack-definition":x.id,checked:x.acknowledged,
        disabled:busy,onChange:event=>ackGroup(kind,x.id,event.currentTarget.checked)}),
        "I declare "+kind+" "+x.id+" · "+x.label+
        (x.siteId?" in "+x.siteId:"")+(x.buildingId?" in "+x.buildingId:"")),
      e("button",{type:"button",disabled:busy,onClick:()=>removeGroup(kind,x.id)},
        "Remove "+kind))));
  return e("div",{className:"network-import-overlay","data-scale-p2b2-overlay":"true"},
    e("section",{className:"network-import-panel",role:"dialog","aria-modal":"true",
      tabIndex:-1,ref:panelRef,"aria-label":"Declare presentation-only site hierarchy",
      "data-scale-p2b2-panel":"REVIEW_REQUIRED"},
      e("div",{className:"network-import-heading"},
        e("div",null,e("h2",null,"Declare site, building and floor membership"),
          e("p",null,"MODELED_NOT_PHYSICAL · User-entered labels only. No inferred site, discovered location, physical cable or Engine PASS.")),
        e("button",{type:"button",onClick:close},"Close")),
      e("p",null,"The approved original Builder retains "+nodeIds.length+
        " device IDs. Enter only exact already reviewed IDs. No original private Office columns are available here."),
      error?e("p",{role:"alert","data-scale-p2b2-error":"BLOCKED"},error):null,
      e("fieldset",null,e("legend",null,"1. User-declared sites"),
        textInput("data-scale-p2b2-site-id",siteDraft.id,value=>setSiteDraft(old=>({...old,id:value})),"Site ID"),
        textInput("data-scale-p2b2-site-label",siteDraft.label,value=>setSiteDraft(old=>({...old,label:value})),"Site display label"),
        e("button",{type:"button",disabled:busy,"data-scale-p2b2-add-site":"true",
          onClick:()=>addGroup("site",siteDraft,setSiteDraft,setSites)},"Add site (unapproved)"),
        rows("site",sites)),
      e("fieldset",null,e("legend",null,"2. User-declared buildings"),
        textInput("data-scale-p2b2-building-id",buildingDraft.id,value=>setBuildingDraft(old=>({...old,id:value})),"Building ID"),
        textInput("data-scale-p2b2-building-label",buildingDraft.label,value=>setBuildingDraft(old=>({...old,label:value})),"Building display label"),
        optionList("data-scale-p2b2-building-site",buildingDraft.siteId,
          value=>setBuildingDraft(old=>({...old,siteId:value})),"Parent site",sites),
        e("button",{type:"button",disabled:busy,"data-scale-p2b2-add-building":"true",
          onClick:()=>addGroup("building",buildingDraft,setBuildingDraft,setBuildings)},"Add building (unapproved)"),
        rows("building",buildings)),
      e("fieldset",null,e("legend",null,"3. User-declared floors"),
        textInput("data-scale-p2b2-floor-id",floorDraft.id,value=>setFloorDraft(old=>({...old,id:value})),"Floor ID"),
        textInput("data-scale-p2b2-floor-label",floorDraft.label,value=>setFloorDraft(old=>({...old,label:value})),"Floor display label"),
        optionList("data-scale-p2b2-floor-building",floorDraft.buildingId,
          value=>setFloorDraft(old=>({...old,buildingId:value})),"Parent building",buildings),
        e("button",{type:"button",disabled:busy,"data-scale-p2b2-add-floor":"true",
          onClick:()=>addGroup("floor",floorDraft,setFloorDraft,setFloors)},"Add floor (unapproved)"),
        rows("floor",floors)),
      e("fieldset",null,e("legend",null,"4. Exact original device-ID assignments (max 100 per entry)"),
        e("label",null,"Exact reviewed IDs separated by spaces, commas or newlines",
          e("textarea",{"data-scale-p2b2-device-id":"true",value:devicesDraft,
            disabled:busy,rows:3,onChange:event=>setDevicesDraft(event.currentTarget.value)})),
        optionList("data-scale-p2b2-device-floor",deviceFloor,
          setDeviceFloor,"Declared floor",floors),
        e("button",{type:"button",disabled:busy,"data-scale-p2b2-add-assignment":"true",
          onClick:addAssignment},"Add exact IDs (individually unapproved)"),
        e("p",{"data-scale-p2b2-assignment-count":String(assignments.length)},
          assignments.length+" assigned IDs · "+(nodeIds.length-assignments.length)+
          " original IDs remain explicitly unassigned."),
        e("ul",{"data-scale-p2b2-assignment-rows":"true"},
          ...assignments.map(x=>e("li",{key:x.deviceId},
            e("label",null,e("input",{type:"checkbox",
              "data-scale-p2b2-ack-assignment":x.deviceId,checked:x.acknowledged,
              disabled:busy,onChange:event=>ackAssignment(x.deviceId,event.currentTarget.checked)}),
              "I assign exact original "+x.deviceId+" to user-declared "+x.floorId),
            e("button",{type:"button",disabled:busy,
              onClick:()=>removeAssignment(x.deviceId)},"Remove assignment"))))),
      e("fieldset",null,e("legend",null,"5. Separate final authorizations"),
        e("label",null,e("input",{type:"checkbox",
          "data-scale-p2b2-approve-definition":"true",checked:approvedDefinitions,
          disabled:busy||!definitionsReady,
          onChange:event=>{token.current++;setApprovedDefinitions(event.currentTarget.checked);setError("");}}),
          "I authorize exactly these individually acknowledged site, building and floor definitions."),
        e("label",null,e("input",{type:"checkbox",
          "data-scale-p2b2-approve-assignment":"true",checked:approvedAssignments,
          disabled:busy||!assignmentsReady,
          onChange:event=>{token.current++;setApprovedAssignments(event.currentTarget.checked);setError("");}}),
          "I separately authorize exactly these acknowledged original device-ID assignments.")),
      e("div",{className:"network-import-actions"},
        e("button",{type:"button","data-scale-p2b2-confirm":"true",
          disabled:!canConfirm,onClick:()=>void confirm()},
          busy?"Validating trusted original source…":"Approve presentation sidecar only"),
        e("button",{type:"button","data-scale-p2b2-cancel":"true",
          onClick:close},"Cancel without source changes"))));
}
