import React, { useEffect, useRef, useState } from "react";
const e=React.createElement;

/**
 * Strictly read-only replay of an exported P4/P5 JSON sidecar with original
 * ODT and CURRENT Builder. Never renders source cell values or JSON payloads.
 */
export function OdtReferenceReplayPanel({ model, onReplay, onClose }) {
  const [odt,setOdt]=useState(null);
  const [report,setReport]=useState(null);
  const [ack,setAck]=useState(false);
  const [status,setStatus]=useState(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const generation=useRef(0);
  const focus=useRef(null);
  useEffect(()=>{focus.current?.focus();return ()=>{generation.current++;};},[]);
  useEffect(()=>{
    const escape=event=>{
      if(event.key==="Escape"&&!busy){generation.current++;onClose();}
    };
    document.addEventListener("keydown",escape);
    return ()=>document.removeEventListener("keydown",escape);
  },[busy,onClose]);
  const reset=()=>{
    generation.current++;
    setStatus(null);setError("");setAck(false);
  };
  const run=async()=>{
    if(!odt||!report||!model||!ack||busy||typeof onReplay!=="function")return;
    const request=++generation.current;
    setBusy(true);setStatus(null);setError("");
    try{
      const result=await onReplay(odt,report,true);
      if(request!==generation.current)return;
      if(result?.status!=="REFERENCE_REPLAY_MATCH" ||
        result.engineVerified!==false || result.physicalTopologyVerified!==false ||
        result.identityVerified!==false || result.modelMutated!==false){
        setError("ODT_REPLAY_RESULT_INVALID");
      } else setStatus(result);
    }catch(cause){
      if(request!==generation.current)return;
      const code=typeof cause?.code==="string" &&
        /^ODT_REPLAY_[A-Z_]+$/.test(cause.code)
          ?cause.code:"ODT_REPLAY_BLOCKED";
      setError(code);
    }finally{
      if(request===generation.current)setBusy(false);
    }
  };
  return e("div",{className:"network-import-overlay","data-odt-replay-overlay":"true"},
    e("section",{className:"network-import-panel",role:"dialog","aria-modal":"true",
        "aria-label":"Inspect saved OpenDocument ODT references",tabIndex:-1,ref:focus,
        "data-odt-replay-panel":"CONFIG_DOCUMENTED"},
      e("div",{className:"network-import-heading"},
        e("div",null,
          e("h2",null,"Inspect saved ODT references — read-only source replay"),
          e("p",null,"Compare an exported P4/P5 JSON report to the ORIGINAL Word file and CURRENT Builder. No topology changes.")),
        e("button",{type:"button",disabled:busy,
          "aria-label":"Close ODT reference replay",
          onClick:()=>{generation.current++;onClose();}},"Close")),
      e("p",{"data-odt-replay-boundary":"true"},
        "A match verifies only document-byte provenance, existing Builder references and source locations. It does NOT verify device identity, physical network connections or Engine results. No cell text is displayed."),
      e("label",null,"Original .odt file",
        e("input",{type:"file",accept:".odt","data-odt-replay-original":"true",disabled:busy,
          onChange:event=>{
            const file=event.currentTarget.files?.[0]??null;
            reset();setOdt(file);
          }})),
      e("label",null,"Previously exported P4/P5 .json report",
        e("input",{type:"file",accept:".json","data-odt-replay-report":"true",disabled:busy,
          onChange:event=>{
            const file=event.currentTarget.files?.[0]??null;
            reset();setReport(file);
          }})),
      !model ? e("p",{"data-odt-replay-no-builder":"true"},
        "Open a Builder scenario to inspect saved references. Runtime cannot validate Builder identities.") : null,
      e("label",null,
        e("input",{type:"checkbox","data-odt-replay-consent":"true",checked:ack,
            disabled:busy||!odt||!report||!model,
            onChange:event=>{generation.current++;setStatus(null);setError("");setAck(event.currentTarget.checked);}}),
        " I explicitly request local source/reference validation without importing or changing Builder."),
      e("button",{type:"button","data-odt-replay-verify":"true",
        disabled:busy||!odt||!report||!ack||!model,
        onClick:()=>{void run();}},
        busy?"Validating original ODT and report...":"Verify saved references locally"),
      error ? e("p",{role:"alert","data-odt-replay-error":"BLOCKED"},error):null,
      status ? e("section",{"data-odt-replay-result":"REFERENCE_REPLAY_MATCH"},
        e("h3",null,"Reference source replay: MATCH"),
        e("p",{"data-odt-replay-count":String(status.referencesChecked)},
          "Referenced cells checked: "+status.referencesChecked),
        e("p",{"data-odt-replay-sha":"true"},
          "Original document SHA-256: "+status.sourceSha256),
        e("p",null,"Source locations and Builder IDs match this document and model. Still UNVERIFIED as real devices/network facts. No values shown, no Engine changes.")) : null,
      e("div",{className:"network-import-actions"},
        e("button",{type:"button",disabled:busy,"data-odt-replay-close":"true",
          onClick:()=>{generation.current++;onClose();}},"Close without changes"))));
}
