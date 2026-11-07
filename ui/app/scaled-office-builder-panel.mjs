import React, {useEffect,useRef,useState} from "react";
const e=React.createElement;
const EMPTY={nodeTable:"",linkTable:"",nodeId:"",nodeRole:"",
  linkFrom:"",linkTo:"",sourcePort:"",targetPort:""};
const COLUMN_FIELDS=[
 ["data-scale-p2a-node-id","nodeId","Original device ID","node"],
 ["data-scale-p2a-node-role","nodeRole","Original canonical device role","node"],
 ["data-scale-p2a-link-from","linkFrom","Original link FROM ID","link"],
 ["data-scale-p2a-link-to","linkTo","Original link TO ID","link"],
 ["data-scale-p2a-source-port","sourcePort","Original FROM port","link"],
 ["data-scale-p2a-target-port","targetPort","Original TO port","link"],
];
const validOrdinal=value=>typeof value==="string"&&/^(0|[1-9]\d*)$/.test(value);
const safeCode=cause=>typeof cause?.code==="string"&&
 /^(SCALE_|DOCX_|ODT_|IC040_)[A-Z0-9_]+$/.test(cause.code)
 ?cause.code:"SCALE_P2A_REVIEW_BLOCKED";
const batch=(format,sourceSha256,tableOrdinal,rowEnd,columns)=>({
 format,sourceSha256,capacityProfile:"office.scaled-reviewed-batch.v1",
 tableOrdinal,rowStart:1,rowEnd,
 columns:columns.map(cellOrdinal=>({cellOrdinal,acknowledge:true})),
 acknowledgeSelectedRange:true,acknowledgeDisclosure:true,
});

/** Source cells are never rendered: only structural counts and explicitly
 * selected ordinal metadata. Consent is cleared on any selection change. */
export function ScaledOfficeBuilderPanel({inspectFile,onConfirm,onClose}){
 const [result,setResult]=useState(null);
 const [config,setConfig]=useState(EMPTY);
 const [rangeApproved,setRangeApproved]=useState(false);
 const [modelApproved,setModelApproved]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const epoch=useRef(0),originalFile=useRef(null),focus=useRef(null);
 const reset=()=>{
   epoch.current++;originalFile.current=null;
   setResult(null);setConfig(EMPTY);
   setRangeApproved(false);setModelApproved(false);
   setBusy(false);setError("");
 };
 const close=()=>{reset();onClose?.();};
 useEffect(()=>{focus.current?.focus();return()=>{
   epoch.current++;originalFile.current=null;
 };},[]);
 useEffect(()=>{
   const handler=event=>{if(event.key==="Escape")close();};
   document.addEventListener("keydown",handler);
   return()=>document.removeEventListener("keydown",handler);
 },[onClose]);
 const choose=async file=>{
   reset();
   if(!file)return;
   const token=epoch.current;
   setBusy(true);
   try{
     const value=await inspectFile(file);
     if(epoch.current!==token)return;
     if(!value||!["docx","odt"].includes(value.format)||
        value.preview?.status!=="REVIEW_REQUIRED"||
        value.preview?.textIncluded!==false||
        value.preview?.canActivate!==false||
        value.preview?.engineVerified!==false||
        value.preview?.physicalTopologyVerified!==false)
       throw Object.assign(new Error("BLOCKED"),{code:"SCALE_P2A_PREVIEW_BLOCKED"});
     originalFile.current=file;
     setResult(value);
   }catch(cause){
     if(epoch.current===token)setError(safeCode(cause));
   }finally{if(epoch.current===token)setBusy(false);}
 };
 const change=(name,value)=>{
   setConfig(old=>({...old,[name]:value}));
   setRangeApproved(false);setModelApproved(false);setError("");
 };
 const tables=result?.preview?.tables??[];
 const nodes=validOrdinal(config.nodeTable)?tables[Number(config.nodeTable)]:null;
 const links=validOrdinal(config.linkTable)?tables[Number(config.linkTable)]:null;
 const nodeRows=nodes?nodes.rows.length-1:0;
 const linkRows=links?links.rows.length-1:0;
 const fields=[config.nodeId,config.nodeRole,config.linkFrom,config.linkTo,
   config.sourcePort,config.targetPort];
 const valid=Boolean(result)&&validOrdinal(config.nodeTable)&&
   validOrdinal(config.linkTable)&&config.nodeTable!==config.linkTable&&
   nodeRows===100&&linkRows===99&&fields.every(validOrdinal)&&
   config.nodeId==="0"&&config.nodeRole==="1"&&
   config.linkFrom==="0"&&config.linkTo==="1"&&
   config.sourcePort==="2"&&config.targetPort==="3"&&
   nodes.rows[0].cells.length>=2&&links.rows[0].cells.length>=4;
 const approvedCount=valid&&rangeApproved?199:0;
 const canSubmit=valid&&rangeApproved&&modelApproved&&!busy&&!!originalFile.current;
 const submit=async()=>{
   if(!canSubmit||!result)return;
   const file=originalFile.current,token=epoch.current;
   setBusy(true);setError("");
   try{
     const format=result.format,sourceSha256=result.preview.sourceSha256;
     const decision={
       capacityProfile:"office.scaled-reviewed-topology.v1",
       format,sourceSha256,
       nodeBatches:[batch(format,sourceSha256,Number(config.nodeTable),100,
         [Number(config.nodeId),Number(config.nodeRole)])],
       linkBatches:[batch(format,sourceSha256,Number(config.linkTable),99,
         [Number(config.linkFrom),Number(config.linkTo),
          Number(config.sourcePort),Number(config.targetPort)])],
       acknowledgeModeledResources:true,
       acknowledgeModeledConnections:true
     };
     const current=()=>epoch.current===token&&originalFile.current===file&&
       rangeApproved&&modelApproved;
     await onConfirm(result,decision,file,current);
   }catch(cause){
     if(epoch.current===token)setError(safeCode(cause));
   }finally{if(epoch.current===token)setBusy(false);}
 };
 const tableSelector=(key,selector,title)=>e("label",null,title,
   e("select",{value:config[key],disabled:busy||!result,[selector]:"true",
      onChange:event=>change(key,event.currentTarget.value)},
     e("option",{value:""},"Select original table"),
     ...tables.map(t=>e("option",{key:t.tableOrdinal,
       value:String(t.tableOrdinal)},
       "Table "+t.tableOrdinal+" · "+t.rows.length+" original rows"))));
 const columnSelector=([selector,key,title,owner])=>{
   const table=owner==="node"?nodes:links;
   return e("label",{key:selector},title,
     e("select",{value:config[key],disabled:busy||!table,
       [selector]:"true",
       onChange:event=>change(key,event.currentTarget.value)},
       e("option",{value:""},"Select original column"),
       ...(table?.rows?.[0]?.cells??[]).map(cell=>
         e("option",{key:cell.cellOrdinal,value:String(cell.cellOrdinal)},
           "Column "+cell.cellOrdinal))));
 };
 return e("div",{className:"network-import-overlay","data-scale-p2a-overlay":"true"},
   e("section",{className:"network-import-panel",role:"dialog","aria-modal":"true",
     tabIndex:-1,ref:focus,"aria-label":"Review 100-node Office network",
     "data-scale-p2a-panel":"REVIEW_REQUIRED"},
     e("div",{className:"network-import-heading"},
       e("div",null,e("h2",null,"Review 100-node DOCX/ODT topology"),
         e("p",null,"Structural metadata until explicit table, column and row consent. All links are unverified modeled references.")),
       e("button",{type:"button","data-scale-p2a-top-close":"true",
         onClick:close},"Close")),
     e("label",{className:"file-button"},"Choose original DOCX or ODT",
       e("input",{type:"file",hidden:true,accept:".docx,.odt",
         "data-scale-p2a-file":"true",
         onChange:event=>{
           const file=event.currentTarget.files?.[0]??null;
           event.currentTarget.value="";
           void choose(file);
         }})),
     error?e("p",{role:"alert","data-scale-p2a-error":"BLOCKED"},error):null,
     result?e("section",{"data-scale-p2a-summary":"REVIEW_REQUIRED"},
       e("p",null,"Original SHA-256: "+result.preview.sourceSha256),
       e("p",null,tables.length+" original structural tables · "+
         result.preview.totalCells+" source structural cells. No cell values exposed."),
       e("ul",null,...tables.map(t=>e("li",{key:t.tableOrdinal},
         "Table "+t.tableOrdinal+": "+t.rows.length+" original rows · "+
         (t.rows[0]?.cells.length??0)+" columns."))),
       tableSelector("nodeTable","data-scale-p2a-node-table","Original Nodes table"),
       tableSelector("linkTable","data-scale-p2a-link-table","Original Links table"),
       ...COLUMN_FIELDS.map(columnSelector),
       e("p",null,valid
         ?"Explicit approved ranges: Devices 1–100; Links 1–99. All six column ordinals selected."
         :"Original ranges not approved. Select 100 Devices rows, 99 Links rows, and their exact source columns."),
       e("label",null,e("input",{type:"checkbox",
         "data-scale-p2a-approve-range":"true",checked:rangeApproved,
         disabled:busy||!valid,onChange:event=>{
           setRangeApproved(event.currentTarget.checked);setModelApproved(false);
         }}),"I explicitly approve only these row intervals and six original columns."),
       e("label",null,e("input",{type:"checkbox",
         "data-scale-p2a-approve-model":"true",checked:modelApproved,
         disabled:busy||!valid||!rangeApproved,
         onChange:event=>setModelApproved(event.currentTarget.checked)}),
         "I separately authorize replacing the active Builder model with these source-declared devices and exact port-linked connections."),
       e("p",{"data-scale-p2a-selection-count":String(approvedCount)},
         approvedCount+" consented source rows; no physical cabling or Engine PASS.")
     ):e("p",{"data-scale-p2a-empty":"true"},"No original chosen. Active Builder unchanged."),
     e("div",{className:"network-import-actions"},
       e("button",{type:"button","data-scale-p2a-confirm":"true",
         disabled:!canSubmit,onClick:()=>void submit()},
         busy?"Verifying source and Builder…":"Import 100 original devices and 99 links"),
       e("button",{type:"button","data-scale-p2a-cancel":"true",
         onClick:close},"Cancel without Builder changes"))));
}
