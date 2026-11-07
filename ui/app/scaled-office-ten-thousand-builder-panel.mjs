import React,{useEffect,useRef,useState} from "react";
const e=React.createElement;
const EMPTY={nodeTable:"",linkTable:"",nodeId:"",nodeRole:"",
  linkFrom:"",linkTo:"",sourcePort:"",targetPort:""};
const FIELDS=[
  ["data-scale-p4c3b-node-id","nodeId","Original device identifier","node"],
  ["data-scale-p4c3b-node-role","nodeRole","Original declared canonical role","node"],
  ["data-scale-p4c3b-link-from","linkFrom","Original From identifier","link"],
  ["data-scale-p4c3b-link-to","linkTo","Original To identifier","link"],
  ["data-scale-p4c3b-source-port","sourcePort","Original From port","link"],
  ["data-scale-p4c3b-target-port","targetPort","Original To port","link"]
];
const integerText=x=>typeof x==="string"&&/^(0|[1-9]\d*)$/.test(x);
const stableError=cause=>typeof cause?.code==="string"&&
  /^(SCALE_|DOCX_|ODT_|IC040_)[A-Z0-9_]+$/.test(cause.code)
  ?cause.code:"SCALE_P4C3B_PREFLIGHT_BLOCKED";
const ranges=Array.from({length:100},(_,index)=>Object.freeze({
  index,start:index*100+1,end:(index+1)*100
}));
const makeGrant=(format,sha,tableOrdinal,range,columns)=>({
  format,sourceSha256:sha,capacityProfile:"office.scaled-reviewed-batch.v3",
  tableOrdinal,rowStart:range.start,rowEnd:range.end,
  columns:columns.map(cellOrdinal=>({cellOrdinal,acknowledge:true})),
  acknowledgeSelectedRange:true,acknowledgeDisclosure:true
});

/** P4c3b: 200 independently source-granted 10k Office rows and
 * separately approved replacement of the editable canonical Builder.
 * Only bounded source-row graph pages, no whole-graph ELK or Engine truth.
 * The old 5k and P4c3b preflight panels stay independent and unchanged.
 */
export function ScaledOfficeTenThousandBuilderPanel({inspectFile,onConfirm,onClose}){
  const [result,setResult]=useState(null);
  const [config,setConfig]=useState(EMPTY);
  const [nodeApproved,setNodeApproved]=useState(()=>Array(100).fill(false));
  const [linkApproved,setLinkApproved]=useState(()=>Array(100).fill(false));
  const [builderApproved,setBuilderApproved]=useState(false);
  const [success,setSuccess]=useState(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const epochRef=useRef(0),fileRef=useRef(null),focusRef=useRef(null);
  const revoke=()=>{
    epochRef.current++;
    setNodeApproved(Array(100).fill(false));
    setLinkApproved(Array(100).fill(false));
    setBuilderApproved(false);setSuccess(null);setError("");
  };
  const reset=()=>{
    revoke();fileRef.current=null;setResult(null);
    setConfig(EMPTY);setBusy(false);
  };
  const close=()=>{reset();onClose?.();};
  useEffect(()=>{focusRef.current?.focus();return()=>{
    epochRef.current++;fileRef.current=null;
  };},[]);
  useEffect(()=>{
    const key=event=>{if(event.key==="Escape")close();};
    document.addEventListener("keydown",key);
    return()=>document.removeEventListener("keydown",key);
  },[onClose]);
  const choose=async file=>{
    reset();
    if(!file)return;
    const epoch=epochRef.current;
    setBusy(true);
    try{
      const value=await inspectFile(file);
      if(epochRef.current!==epoch)return;
      const preview=value?.preview;
      if(!value||!["docx","odt"].includes(value.format)||
         preview?.status!=="REVIEW_REQUIRED"||
         preview.textIncluded!==false||preview.canActivate!==false||
         preview.engineVerified!==false||preview.physicalTopologyVerified!==false||
         !Array.isArray(preview.tables))
        throw Object.assign(new Error("BLOCKED"),{code:"SCALE_P4C3B_PREVIEW_BLOCKED"});
      fileRef.current=file;
      setResult(value);
    }catch(cause){
      if(epochRef.current===epoch)setError(stableError(cause));
    }finally{if(epochRef.current===epoch)setBusy(false);}
  };
  const change=(name,value)=>{
    revoke();
    setConfig(old=>({...old,[name]:value}));
  };
  const tableList=result?.preview?.tables??[];
  const nodes=integerText(config.nodeTable)?tableList[Number(config.nodeTable)]:null;
  const links=integerText(config.linkTable)?tableList[Number(config.linkTable)]:null;
  const valid=Boolean(result)&&integerText(config.nodeTable)&&
    integerText(config.linkTable)&&config.nodeTable!==config.linkTable&&
    config.nodeTable==="0"&&config.linkTable==="1"&&
    nodes?.rows.length===10001&&links?.rows.length===10001&&
    nodes.rows[0]?.cells.length>=2&&links.rows[0]?.cells.length>=4&&
    config.nodeId==="0"&&config.nodeRole==="1"&&
    config.linkFrom==="0"&&config.linkTo==="1"&&
    config.sourcePort==="2"&&config.targetPort==="3";
  const approvedCount=valid?100*(
    nodeApproved.filter(Boolean).length+linkApproved.filter(Boolean).length):0;
  const allApproved=valid&&nodeApproved.every(Boolean)&&linkApproved.every(Boolean);
  const canSubmit=allApproved&&builderApproved&&!busy&&
    Boolean(fileRef.current)&&!success;
  const toggle=(kind,index,checked)=>{
    epochRef.current++;
    (kind==="node"?setNodeApproved:setLinkApproved)(
      old=>old.map((selected,i)=>i===index?checked:selected));
    setBuilderApproved(false);setSuccess(null);setError("");
  };
  const approveBuilder=checked=>{
    epochRef.current++;
    setBuilderApproved(checked);setSuccess(null);setError("");
  };
  const submit=async()=>{
    if(!canSubmit||!result)return;
    const file=fileRef.current,epoch=epochRef.current;
    const format=result.format,sha=result.preview.sourceSha256;
    const decision={
      capacityProfile:"office.scaled-reviewed-topology.v3",
      format,sourceSha256:sha,
      nodeBatches:ranges.map(r=>makeGrant(format,sha,Number(config.nodeTable),
        r,[Number(config.nodeId),Number(config.nodeRole)])),
      linkBatches:ranges.map(r=>makeGrant(format,sha,Number(config.linkTable),
        r,[Number(config.linkFrom),Number(config.linkTo),
          Number(config.sourcePort),Number(config.targetPort)])),
      acknowledgeModeledResources:true,acknowledgeModeledConnections:true
    };
    const current=()=>epochRef.current===epoch&&fileRef.current===file;
    setBusy(true);setError("");setSuccess(null);
    try{
      const proof=await onConfirm(result,decision,file,current);
      if(!current())return;
      if(!proof||proof.status!=="BUILDER_ACTIVATED"||
         proof.sourceSha256!==sha||
         proof.originalDevices!==10000||proof.originalPortLinks!==10000||
         proof.engineVerified!==false||
         proof.physicalTopologyVerified!==false)
        throw Object.assign(new Error("BLOCKED"),{code:"SCALE_P4C3B_PREFLIGHT_BLOCKED"});
      setSuccess(Object.freeze(proof));
    }catch(cause){
      if(current())setError(stableError(cause));
    }finally{if(current())setBusy(false);}
  };
  const selectTable=(name,marker,label)=>e("label",{key:name},label,
    e("select",{value:config[name],disabled:busy||!result,[marker]:"true",
      onChange:ev=>change(name,ev.currentTarget.value)},
      e("option",{value:""},"Choose original table"),
      ...tableList.map(t=>e("option",{key:t.tableOrdinal,
        value:String(t.tableOrdinal)},
        "Table "+t.tableOrdinal+" — "+t.rows.length+" original structural rows"))));
  const selectColumn=([marker,name,label,kind])=>{
    const table=kind==="node"?nodes:links;
    return e("label",{key:marker},label,
      e("select",{value:config[name],disabled:busy||!table,[marker]:"true",
        onChange:ev=>change(name,ev.currentTarget.value)},
        e("option",{value:""},"Choose original cell ordinal"),
        ...(table?.rows?.[0]?.cells??[]).map(c=>e("option",{
          key:c.cellOrdinal,value:String(c.cellOrdinal)},"Column "+c.cellOrdinal))));
  };
  const checkboxes=(kind,approved)=>e("fieldset",{key:kind},
    e("legend",null,"100 original "+(kind==="node"?"device":"Links")+
      " source-row grants, each individually acknowledged"),
    ...ranges.map(r=>e("label",{key:kind+"-"+r.index},
      e("input",{type:"checkbox",checked:approved[r.index],
        ["data-scale-p4c3b-approve-"+kind+"-batch"]:String(r.index),
        disabled:busy||!valid,
        onChange:ev=>toggle(kind,r.index,ev.currentTarget.checked)}),
      "I separately authorize review of "+kind+" source rows "+
        r.start+"–"+r.end+", selected original columns ONLY.")));
  return e("div",{className:"network-import-overlay","data-scale-p4c3b-overlay":"true"},
    e("section",{className:"network-import-panel",role:"dialog","aria-modal":"true",
      tabIndex:-1,ref:focusRef,"aria-label":"10,000 original Office editable Builder replacement",
      "data-scale-p4c3b-panel":"REVIEW_REQUIRED"},
      e("div",{className:"network-import-heading"},
        e("div",null,e("h2",null,"10,000 original DOCX/ODT devices — source-only review"),
          e("p",null,"This WILL replace editable Builder after 200 individually approved source ranges and separate replacement consent. Physical links and Engine remain UNVERIFIED.")),
        e("button",{type:"button",onClick:close},"Close")),
      e("label",null,"Choose actual original DOCX or ODT",
        e("input",{type:"file",accept:".docx,.odt",
          "data-scale-p4c3b-file":"true",
          onChange:ev=>{
            const file=ev.currentTarget.files?.[0]??null;
            ev.currentTarget.value="";
            void choose(file);
          }})),
      error?e("p",{role:"alert","data-scale-p4c3b-error":"BLOCKED"},error):null,
      result?e("section",{"data-scale-p4c3b-summary":"REVIEW_REQUIRED"},
        e("p",null,"Original ZIP SHA-256: "+result.preview.sourceSha256),
        e("p",null,"Structural-only preview. No source-cell text revealed."),
        e("ul",null,...tableList.map(t=>e("li",{key:t.tableOrdinal},
          "Table "+t.tableOrdinal+": "+t.rows.length+" original structural rows."))),
        selectTable("nodeTable","data-scale-p4c3b-node-table","Original Nodes table"),
        selectTable("linkTable","data-scale-p4c3b-link-table","Original Links table"),
        ...FIELDS.map(selectColumn),
        e("p",null,valid
          ?"200 independent 100-row grants required: 10,000 original nodes and 10,000 original Links."
          :"Select exact original tables and six source columns; no implicit grants."),
        checkboxes("node",nodeApproved),
        checkboxes("link",linkApproved),
        e("p",{"data-scale-p4c3b-selection-count":String(approvedCount)},
          approvedCount+" individually acknowledged original source rows, unverified physically."),
        e("label",null,
          e("input",{type:"checkbox","data-scale-p4c3b-approve-builder":"true",
            checked:builderApproved,disabled:busy||!allApproved,
            onChange:ev=>approveBuilder(ev.currentTarget.checked)}),
          "I separately authorize REPLACING the active editable Builder source with all 10,000 original devices and 10,000 source-declared port links. No Runtime/Engine or physical cable verification.")
      ):e("p",{"data-scale-p4c3b-empty":"true"},
        "No original selected; editable Builder remains untouched."),
      success?e("section",{"data-scale-p4c3b-validated":"BUILDER_ACTIVATED"},
        e("h3",null,"Editable Builder activated with bounded Office graph pages"),
        e("p",null,"Original ZIP SHA-256: "+success.sourceSha256),
        e("p",null,"10000 original source devices, 10000 explicitly source-port-linked "+
          "connections; physical network UNVERIFIED, Engine UNVERIFIED."),
        e("p",null,"Builder has been replaced with all original source rows. Only a bounded subset was laid out; no Engine run.")
      ):null,
      e("div",{className:"network-import-actions"},
        e("button",{type:"button","data-scale-p4c3b-confirm":"true",
          disabled:!canSubmit,onClick:()=>void submit()},
          busy?"Rechecking original ZIP, compiling, preparing bounded graph…":
          "Replace editable Builder (10,000 original nodes and 10,000 original Links)"),
        e("button",{type:"button","data-scale-p4c3b-cancel":"true",
          onClick:close},"Cancel without replacing Builder"))));
}
