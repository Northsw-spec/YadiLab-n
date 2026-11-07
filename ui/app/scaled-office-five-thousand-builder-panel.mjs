import React,{useEffect,useRef,useState} from "react";
const e=React.createElement;
const EMPTY={nodeTable:"",linkTable:"",nodeId:"",nodeRole:"",
  linkFrom:"",linkTo:"",sourcePort:"",targetPort:""};
const FIELDS=[
 ["data-scale-p3c2-node-id","nodeId","Original device identifier","node"],
 ["data-scale-p3c2-node-role","nodeRole","Original declared canonical role","node"],
 ["data-scale-p3c2-link-from","linkFrom","Original From identifier","link"],
 ["data-scale-p3c2-link-to","linkTo","Original To identifier","link"],
 ["data-scale-p3c2-source-port","sourcePort","Original From port","link"],
 ["data-scale-p3c2-target-port","targetPort","Original To port","link"]
];
const integerText=x=>typeof x==="string"&&/^(0|[1-9]\d*)$/.test(x);
const stableError=cause=>typeof cause?.code==="string"&&
 /^(SCALE_|DOCX_|ODT_|IC040_)[A-Z0-9_]+$/.test(cause.code)
 ?cause.code:"SCALE_P3C2_REVIEW_BLOCKED";
const makeBatch=(format,sha,tableOrdinal,start,end,columns)=>({
 format,sourceSha256:sha,capacityProfile:"office.scaled-reviewed-batch.v2",
 tableOrdinal,rowStart:start,rowEnd:end,
 columns:columns.map(cellOrdinal=>({cellOrdinal,acknowledge:true})),
 acknowledgeSelectedRange:true,acknowledgeDisclosure:true
});
const allRanges=(count)=>Array.from({length:50},(_,index)=>{
 const start=index*100+1;
 return {index,start,end:Math.min(count,start+99)};
});

/** Source-to-Builder consent is explicit per original 100-row interval.
 * Preview contains structural counts only, never unselected original text. */
export function ScaledOfficeFiveThousandBuilderPanel({inspectFile,onConfirm,onClose}){
 const [result,setResult]=useState(null);
 const [config,setConfig]=useState(EMPTY);
 const [nodeApproved,setNodeApproved]=useState(()=>Array(50).fill(false));
 const [linkApproved,setLinkApproved]=useState(()=>Array(50).fill(false));
 const [modelApproved,setModelApproved]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const tokenRef=useRef(0),fileRef=useRef(null),focusRef=useRef(null);
 const reset=()=>{
   tokenRef.current++;
   fileRef.current=null;
   setResult(null);setConfig(EMPTY);
   setNodeApproved(Array(50).fill(false));
   setLinkApproved(Array(50).fill(false));
   setModelApproved(false);
   setBusy(false);setError("");
 };
 const close=()=>{reset();onClose?.();};
 useEffect(()=>{focusRef.current?.focus();return()=>{
   tokenRef.current++;fileRef.current=null;
 };},[]);
 useEffect(()=>{
   const handler=event=>{if(event.key==="Escape")close();};
   document.addEventListener("keydown",handler);
   return()=>document.removeEventListener("keydown",handler);
 },[onClose]);
 const choose=async file=>{
   reset();
   if(!file)return;
   const token=tokenRef.current;
   setBusy(true);
   try{
     const value=await inspectFile(file);
     if(tokenRef.current!==token)return;
     const info=value?.preview;
     if(!value||!["docx","odt"].includes(value.format)||
        info?.status!=="REVIEW_REQUIRED"||
        info.textIncluded!==false||info.canActivate!==false||
        info.engineVerified!==false||info.physicalTopologyVerified!==false)
       throw Object.assign(new Error("BLOCKED"),{code:"SCALE_P3C2_PREVIEW_BLOCKED"});
     fileRef.current=file;setResult(value);
   }catch(cause){
     if(tokenRef.current===token)setError(stableError(cause));
   }finally{if(tokenRef.current===token)setBusy(false);}
 };
 const change=(field,value)=>{
   setConfig(old=>({...old,[field]:value}));
   setNodeApproved(Array(50).fill(false));
   setLinkApproved(Array(50).fill(false));
   setModelApproved(false);setError("");
 };
 const tables=result?.preview?.tables??[];
 const nodes=integerText(config.nodeTable)?tables[Number(config.nodeTable)]:null;
 const links=integerText(config.linkTable)?tables[Number(config.linkTable)]:null;
 const valid=Boolean(result)&&integerText(config.nodeTable)&&
   integerText(config.linkTable)&&config.nodeTable!==config.linkTable&&
   nodes?.rows.length===5001&&links?.rows.length===5001&&
   nodes.rows[0].cells.length>=2&&links.rows[0].cells.length>=4&&
   config.nodeId==="0"&&config.nodeRole==="1"&&
   config.linkFrom==="0"&&config.linkTo==="1"&&
   config.sourcePort==="2"&&config.targetPort==="3";
 const nodeRanges=allRanges(5000),linkRanges=allRanges(5000);
 const approvedCount=valid
   ?nodeRanges.reduce((n,r)=>n+(nodeApproved[r.index]?r.end-r.start+1:0),0)+
      linkRanges.reduce((n,r)=>n+(linkApproved[r.index]?r.end-r.start+1:0),0)
   :0;
 const allApproved=valid&&nodeApproved.every(Boolean)&&linkApproved.every(Boolean);
 const canSubmit=allApproved&&modelApproved&&!busy&&Boolean(fileRef.current);
 const toggle=(kind,index,checked)=>{
   const setter=kind==="node"?setNodeApproved:setLinkApproved;
   setter(old=>old.map((value,i)=>i===index?checked:value));
   setModelApproved(false);setError("");
 };
 const submit=async()=>{
   if(!canSubmit||!result)return;
   const file=fileRef.current,token=tokenRef.current;
   setBusy(true);setError("");
   try{
     const format=result.format,sha=result.preview.sourceSha256;
     const decision={
       capacityProfile:"office.scaled-reviewed-topology.v2",
       format,sourceSha256:sha,
       nodeBatches:nodeRanges.map(r=>makeBatch(format,sha,Number(config.nodeTable),
         r.start,r.end,[Number(config.nodeId),Number(config.nodeRole)])),
       linkBatches:linkRanges.map(r=>makeBatch(format,sha,Number(config.linkTable),
         r.start,r.end,[Number(config.linkFrom),Number(config.linkTo),
           Number(config.sourcePort),Number(config.targetPort)])),
       acknowledgeModeledResources:true,
       acknowledgeModeledConnections:true
     };
     const current=()=>tokenRef.current===token&&fileRef.current===file&&
       nodeApproved.every(Boolean)&&linkApproved.every(Boolean)&&modelApproved;
     await onConfirm(result,decision,file,current);
   }catch(cause){
     if(tokenRef.current===token)setError(stableError(cause));
   }finally{if(tokenRef.current===token)setBusy(false);}
 };
 const selectTable=(name,marker,label)=>e("label",{key:name},label,
   e("select",{value:config[name],disabled:busy||!result,[marker]:"true",
     onChange:event=>change(name,event.currentTarget.value)},
     e("option",{value:""},"Select original table"),
     ...tables.map(t=>e("option",{key:t.tableOrdinal,value:String(t.tableOrdinal)},
       "Table "+t.tableOrdinal+" · "+t.rows.length+" original rows"))));
 const selectColumn=([marker,name,label,kind])=>{
   const table=kind==="node"?nodes:links;
   return e("label",{key:marker},label,
     e("select",{value:config[name],disabled:busy||!table,[marker]:"true",
       onChange:event=>change(name,event.currentTarget.value)},
       e("option",{value:""},"Select source column"),
       ...(table?.rows?.[0]?.cells??[]).map(c=>e("option",{
         key:c.cellOrdinal,value:String(c.cellOrdinal)
       },"Column "+c.cellOrdinal))));
 };
 const ranges=(kind,items,checked)=>e("fieldset",{key:kind},
   e("legend",null,kind==="node"?"Fifty original device-row batches":"Fifty original Links-row batches"),
   ...items.map(r=>e("label",{key:kind+"-"+r.index},
     e("input",{type:"checkbox",
       ["data-scale-p3c2-approve-"+kind+"-batch"]:String(r.index),
       checked:checked[r.index],disabled:busy||!valid,
       onChange:event=>toggle(kind,r.index,event.currentTarget.checked)}),
     "I separately approve "+kind+" original rows "+r.start+"–"+r.end+
       ", selected columns ONLY.")));
 return e("div",{className:"network-import-overlay","data-scale-p3c2-overlay":"true"},
   e("section",{className:"network-import-panel",role:"dialog","aria-modal":"true",
     tabIndex:-1,ref:focusRef,"data-scale-p3c2-panel":"REVIEW_REQUIRED",
     "aria-label":"Source-reviewed 5,000-node Office topology"},
     e("div",{className:"network-import-heading"},
       e("div",null,e("h2",null,"Review 5,000 genuine DOCX/ODT devices"),
         e("p",null,"Source-row groups are review pages, NOT buildings or verified network areas.")),
       e("button",{type:"button",onClick:close},"Close")),
     e("label",null,"Choose original DOCX or ODT",
       e("input",{type:"file",accept:".docx,.odt","data-scale-p3c2-file":"true",
         onChange:event=>{const file=event.currentTarget.files?.[0]??null;
           event.currentTarget.value="";void choose(file);}})),
     error?e("p",{role:"alert","data-scale-p3c2-error":"BLOCKED"},error):null,
     result?e("section",{"data-scale-p3c2-summary":"REVIEW_REQUIRED"},
       e("p",null,"Original SHA-256: "+result.preview.sourceSha256),
       e("p",null,tables.length+" original structural tables; no cell text disclosed."),
       e("ul",null,...tables.map(t=>e("li",{key:t.tableOrdinal},
         "Table "+t.tableOrdinal+": "+t.rows.length+" original rows · "+
         (t.rows[0]?.cells.length??0)+" columns."))),
       selectTable("nodeTable","data-scale-p3c2-node-table","Original Nodes table"),
       selectTable("linkTable","data-scale-p3c2-link-table","Original Links table"),
       ...FIELDS.map(selectColumn),
       e("p",null,valid
         ?"Review 5,000 original device rows and 5,000 original Links rows in 100 independent batches."
         :"Select exactly 5,000 original device rows, 5,000 explicit Links rows, and all six exact columns."),
       ranges("node",nodeRanges,nodeApproved),
       ranges("link",linkRanges,linkApproved),
       e("p",{"data-scale-p3c2-selection-count":String(approvedCount)},
         approvedCount+" individually approved original rows; source unverified physically."),
       e("label",null,e("input",{type:"checkbox",
         "data-scale-p3c2-approve-model":"true",checked:modelApproved,
         disabled:busy||!allApproved,
         onChange:event=>setModelApproved(event.currentTarget.checked)}),
         "I separately authorize replacing the active editable Builder source with all 5,000 devices and 5,000 explicit port-linked references.")
     ):e("p",{"data-scale-p3c2-empty":"true"},"No original chosen. Builder remains unchanged."),
     e("div",{className:"network-import-actions"},
       e("button",{type:"button","data-scale-p3c2-confirm":"true",
         disabled:!canSubmit,onClick:()=>void submit()},
         busy?"Validating all original source rows and focus…":"Import all 5,000 reviewed devices / 5,000 links"),
       e("button",{type:"button","data-scale-p3c2-cancel":"true",
         onClick:close},"Cancel without Builder changes"))));
}
