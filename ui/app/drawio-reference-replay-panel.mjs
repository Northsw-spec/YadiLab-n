import React,{useEffect,useRef,useState} from "react";
const e=React.createElement;
/** Source-bound replay only; shows no source labels or JSON body. */
export function DrawioSavedReferenceReplayPanel({model,onReplay,onClose}){
  const [original,setOriginal]=useState(null);
  const [report,setReport]=useState(null);
  const [ack,setAck]=useState(false);
  const [match,setMatch]=useState(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const generation=useRef(0),focus=useRef(null);
  useEffect(()=>{focus.current?.focus();return()=>{generation.current++;};},[]);
  useEffect(()=>{
    const escape=event=>{
      if(event.key==="Escape"&&!busy){generation.current++;onClose();}
    };
    document.addEventListener("keydown",escape);
    return()=>document.removeEventListener("keydown",escape);
  },[busy,onClose]);
  const reset=()=>{
    generation.current++;setAck(false);setMatch(null);setError("");
  };
  const run=async()=>{
    if(!original||!report||!ack||!model||busy||typeof onReplay!=="function")return;
    const request=++generation.current;
    setBusy(true);setMatch(null);setError("");
    try{
      const result=await onReplay(original,report,true,()=>request===generation.current);
      if(request!==generation.current)return;
      if(result?.status!=="REFERENCE_REPLAY_MATCH"||
         result.identityVerified!==false||result.physicalTopologyVerified!==false||
         result.engineVerified!==false||result.modelMutated!==false){
        setError("DRAWIO_REPLAY_RESULT_INVALID");
      }else setMatch(result);
    }catch(cause){
      if(request!==generation.current)return;
      setError(typeof cause?.code==="string"&&/^DRAWIO_REPLAY_[A-Z0-9_]+$/.test(cause.code)
        ?cause.code:"DRAWIO_REPLAY_BLOCKED");
    }finally{if(request===generation.current)setBusy(false);}
  };
  return e("div",{className:"network-import-overlay","data-drawio-replay-overlay":"true"},
    e("section",{className:"network-import-panel",role:"dialog","aria-modal":"true",
      "aria-label":"Inspect saved draw.io vertex references",tabIndex:-1,ref:focus,
      "data-drawio-replay-panel":"TOPOLOGY_DECLARED"},
      e("div",{className:"network-import-heading"},
        e("div",null,e("h2",null,"Inspect saved draw.io references — read-only replay"),
          e("p",null,"Compare original .drawio, an exported P4 JSON sidecar and current Builder.")),
        e("button",{type:"button",disabled:busy,"aria-label":"Close draw.io replay",
          onClick:()=>{generation.current++;onClose();}},"Close")),
      e("p",{"data-drawio-replay-truth":"true"},
        "MATCH verifies only source byte provenance, selected drawing vertex positions and modeled Builder IDs. "+
        "It does NOT verify physical devices, network cabling or Engine results. No source labels or JSON contents are displayed."),
      e("label",null,"Original .drawio file",
        e("input",{type:"file",accept:".drawio",disabled:busy,"data-drawio-replay-original":"true",
          onChange:event=>{const f=event.currentTarget.files?.[0]??null;reset();setOriginal(f);}})),
      e("label",null,"Previously exported P4 .json references",
        e("input",{type:"file",accept:".json",disabled:busy,"data-drawio-replay-report":"true",
          onChange:event=>{const f=event.currentTarget.files?.[0]??null;reset();setReport(f);}})),
      !model?e("p",{"data-drawio-replay-no-builder":"true"},
        "Open a Builder scenario to inspect saved references."):null,
      e("label",null,
        e("input",{type:"checkbox",checked:ack,disabled:busy||!original||!report||!model,
          "data-drawio-replay-consent":"true",
          onChange:event=>{generation.current++;setMatch(null);setError("");setAck(event.currentTarget.checked);}}),
        " I explicitly request read-only source/reference validation without modifying Builder."),
      e("button",{type:"button","data-drawio-replay-verify":"true",
        disabled:busy||!original||!report||!ack||!model,onClick:()=>{void run();}},
        busy?"Validating source and saved references…":"Verify saved references locally"),
      error?e("p",{role:"alert","data-drawio-replay-error":"BLOCKED"},error):null,
      match?e("section",{"data-drawio-replay-result":"REFERENCE_REPLAY_MATCH"},
        e("h3",null,"Saved reference replay: MATCH"),
        e("p",{"data-drawio-replay-count":String(match.referencesChecked)},
          "Original source vertex positions checked: "+match.referencesChecked),
        e("p",{"data-drawio-replay-sha":"true"},"Original source SHA-256: "+match.sourceSha256),
        e("p",null,"Source positions and Builder references match, not verified physical network identities. No Engine/Builder changes.")):null,
      e("div",{className:"network-import-actions"},
        e("button",{type:"button",disabled:busy,"data-drawio-replay-close":"true",
          onClick:()=>{generation.current++;onClose();}},"Close without changes"))));
}
