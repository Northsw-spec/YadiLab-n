import React, { useState } from "react";
const e=React.createElement;
const MAX_REFERENCES=20;
const WINDOW_SIZE=20;

/**
 * Build ordinal-only positions from the already validated, bounded P3 preview.
 * No source labels, source IDs, geometry or drawn links enter this component.
 */
function allVertexPositions(preview){
  const positions=[];
  for(const p of preview.pages){
    for(let vertexOrdinal=0;vertexOrdinal<p.vertexCount;vertexOrdinal++){
      positions.push({pageOrdinal:p.pageOrdinal,vertexOrdinal,
        key:p.pageOrdinal+":"+vertexOrdinal});
    }
  }
  return positions;
}

/** Render at most 20 source positions at once; retain at most 20 chosen references. */
export function DrawioVertexAssociationReview({preview,model,onExport}){
  const [choices,setChoices]=useState({});
  const [windowIndex,setWindowIndex]=useState(0);
  const [ack,setAck]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [exported,setExported]=useState(false);
  const positions=allVertexPositions(preview);
  const totalWindows=Math.max(1,Math.ceil(positions.length/WINDOW_SIZE));
  const currentWindow=Math.min(windowIndex,totalWindows-1);
  const start=currentWindow*WINDOW_SIZE;
  const visible=positions.slice(start,start+WINDOW_SIZE);
  const references=positions.filter(x=>Boolean(choices[x.key])).map(x=>({
    pageOrdinal:x.pageOrdinal,vertexOrdinal:x.vertexOrdinal,targetResourceId:choices[x.key]
  }));
  const atLimit=references.length>=MAX_REFERENCES;
  const duplicateTarget=new Set(references.map(x=>x.targetResourceId)).size!==references.length;
  const canExport=!!model&&model.resources?.length>0&&
    references.length>0&&references.length<=MAX_REFERENCES&&
    !duplicateTarget&&ack&&!busy&&typeof onExport==="function";
  const change=(key,value)=>{
    if(value && !choices[key] && atLimit){
      setError("DRAWIO_ASSOC_COUNT_INVALID");
      return;
    }
    setChoices(old=>({...old,[key]:value}));
    setAck(false);setExported(false);setError("");
  };
  const clearAll=()=>{
    setChoices({});setAck(false);setExported(false);setError("");
  };
  const send=async()=>{
    if(!canExport)return;
    setBusy(true);setError("");setExported(false);
    try{
      await onExport({
        sourceSha256:preview.sourceSha256,scenarioId:model.scenarioId,
        sourceRevision:model.sourceRevision,acknowledgeNotVerified:ack,references
      });
      setExported(true);
    }catch(cause){
      const code=typeof cause?.code==="string"&&/^DRAWIO_[A-Z0-9_]+$/.test(cause.code)
        ?cause.code:"DRAWIO_ASSOC_BLOCKED";
      setError(code);
    }finally{setBusy(false);}
  };
  return e("section",{className:"network-import-preview",
      "data-drawio-association-review":model?"REVIEW_REQUIRED":"BUILDER_REQUIRED"},
    e("h3",null,"Optional reviewed vertex-position references"),
    e("p",{"data-drawio-association-boundary":"true"},
      "A page/vertex ordinal is a position in this exact diagram file, NOT a verified real device. "+
      "Choose modeled Builder resources manually. Drawn edges cannot be associated or activated."),
    model?e("p",{"data-drawio-builder-model":"true"},
      "Builder resources: "+model.resources.length+" · revision "+model.sourceRevision):
      e("p",{"data-drawio-no-builder":"true"},
      "Open a Builder scenario to export a metadata-only reviewed reference."),
    e("nav",{"aria-label":"Drawn vertex-position windows","data-drawio-position-navigation":"true"},
      e("p",{"data-drawio-position-window":String(currentWindow+1),
        "data-drawio-total-positions":String(positions.length)},
        positions.length===0?"No drawn vertex positions":
        "Positions "+(start+1)+"–"+(start+visible.length)+" of "+positions.length+
        " · Window "+(currentWindow+1)+" of "+totalWindows),
      e("button",{type:"button","data-drawio-position-previous":"true",
        disabled:busy||currentWindow===0,
        onClick:()=>setWindowIndex(x=>Math.max(0,x-1))},"Previous 20 positions"),
      e("button",{type:"button","data-drawio-position-next":"true",
        disabled:busy||currentWindow>=totalWindows-1,
        onClick:()=>setWindowIndex(x=>Math.min(totalWindows-1,x+1))},"Next 20 positions")),
    model?e("ol",{className:"validation-list","data-drawio-vertex-positions":"true",
      "data-drawio-position-visible":String(visible.length)},
      ...visible.map(x=>e("li",{key:x.key},
        e("label",null,"Page #"+(x.pageOrdinal+1)+" · drawn vertex #"+(x.vertexOrdinal+1)+" · ",
          e("select",{
            "data-drawio-associate-vertex":x.key,
            value:choices[x.key]??"",disabled:busy||(atLimit&&!choices[x.key]),
            onChange:event=>change(x.key,event.currentTarget.value)},
            e("option",{value:""},"Not associated (default)"),
            ...model.resources.map(r=>e("option",{key:r.id,value:r.id},r.label+" ["+r.id+"]"))))))):null,
    positions.length>WINDOW_SIZE?e("p",{"data-drawio-association-limit":"true"},
      "Browse any validated drawn vertex position. "+
      "At most 20 unverified references may be selected across all windows."):null,
    duplicateTarget?e("p",{role:"alert","data-drawio-association-duplicate":"BLOCKED"},
      "Each Builder resource may be selected at most once."):null,
    e("p",{"data-drawio-reference-count":String(references.length)},
      "Selected unverified references: "+references.length+" of "+MAX_REFERENCES),
    e("button",{type:"button","data-drawio-association-clear":"true",
      disabled:busy||references.length===0,onClick:clearAll},"Clear all selected references"),
    e("label",null,e("input",{type:"checkbox","data-drawio-association-ack":"true",
      checked:ack,disabled:busy||!model||!references.length||duplicateTarget,
      onChange:event=>{setAck(event.currentTarget.checked);setExported(false);}}),
      " I acknowledge these positions are not verified device identities or physical network links."),
    e("button",{type:"button","data-drawio-association-export":"true",disabled:!canExport,
      onClick:()=>{void send();}},
      busy?"Rechecking original diagram and Builder…":"Export metadata-only reviewed references (JSON)"),
    error?e("p",{role:"alert","data-drawio-association-error":"BLOCKED"},error):null,
    exported?e("p",{"data-drawio-association-exported":"true"},
      "Metadata-only sidecar exported; Builder, topology and Engine unchanged."):null);
}
