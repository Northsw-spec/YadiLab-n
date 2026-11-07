import React, { useEffect, useRef, useState } from "react";
const e=React.createElement;

/**
 * Strictly read-only replay of an exported P4/P5 JSON sidecar with original
 * DOCX and CURRENT Builder. Never renders source cell values or JSON payloads.
 */
export function DocxReferenceReplayPanel({ model, onReplay, onClose }) {
  const [docx,setDocx]=useState(null);
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
    if(!docx||!report||!model||!ack||busy||typeof onReplay!=="function")return;
    const request=++generation.current;
    setBusy(true);setStatus(null);setError("");
    try{
      const result=await onReplay(docx,report,true);
      if(request!==generation.current)return;
      if(result?.status!=="REFERENCE_REPLAY_MATCH" ||
        result.engineVerified!==false || result.physicalTopologyVerified!==false ||
        result.identityVerified!==false || result.modelMutated!==false){
        setError("DOCX_REPLAY_RESULT_INVALID");
      } else setStatus(result);
    }catch(cause){
      if(request!==generation.current)return;
      const code=typeof cause?.code==="string" &&
        /^DOCX_REPLAY_[A-Z_]+$/.test(cause.code)
          ?cause.code:"DOCX_REPLAY_BLOCKED";
      setError(code);
    }finally{
      if(request===generation.current)setBusy(false);
    }
  };
  return e("div",{className:"network-import-overlay","data-docx-replay-overlay":"true"},
    e("section",{className:"network-import-panel",role:"dialog","aria-modal":"true",
        "aria-label":"Inspect saved Word DOCX references",tabIndex:-1,ref:focus,
        "data-docx-replay-panel":"CONFIG_DOCUMENTED"},
      e("div",{className:"network-import-heading"},
        e("div",null,
          e("h2",null,"Inspect saved DOCX references — read-only source replay"),
          e("p",null,"Compare an exported P4/P5 JSON report to the ORIGINAL Word file and CURRENT Builder. No topology changes.")),
        e("button",{type:"button",disabled:busy,
          "aria-label":"Close DOCX reference replay",
          onClick:()=>{generation.current++;onClose();}},"Close")),
      e("p",{"data-docx-replay-boundary":"true"},
        "A match verifies only document-byte provenance, existing Builder references and source locations. It does NOT verify device identity, physical network connections or Engine results. No cell text is displayed."),
      e("label",null,"Original .docx file",
        e("input",{type:"file",accept:".docx","data-docx-replay-original":"true",disabled:busy,
          onChange:event=>{
            const file=event.currentTarget.files?.[0]??null;
            reset();setDocx(file);
          }})),
      e("label",null,"Previously exported P4/P5 .json report",
        e("input",{type:"file",accept:".json","data-docx-replay-report":"true",disabled:busy,
          onChange:event=>{
            const file=event.currentTarget.files?.[0]??null;
            reset();setReport(file);
          }})),
      !model ? e("p",{"data-docx-replay-no-builder":"true"},
        "Open a Builder scenario to inspect saved references. Runtime cannot validate Builder identities.") : null,
      e("label",null,
        e("input",{type:"checkbox","data-docx-replay-consent":"true",checked:ack,
            disabled:busy||!docx||!report||!model,
            onChange:event=>{generation.current++;setStatus(null);setError("");setAck(event.currentTarget.checked);}}),
        " I explicitly request local source/reference validation without importing or changing Builder."),
      e("button",{type:"button","data-docx-replay-verify":"true",
        disabled:busy||!docx||!report||!ack||!model,
        onClick:()=>{void run();}},
        busy?"Validating original DOCX and report...":"Verify saved references locally"),
      error ? e("p",{role:"alert","data-docx-replay-error":"BLOCKED"},error):null,
      status ? e("section",{"data-docx-replay-result":"REFERENCE_REPLAY_MATCH"},
        e("h3",null,"Reference source replay: MATCH"),
        e("p",{"data-docx-replay-count":String(status.referencesChecked)},
          "Referenced cells checked: "+status.referencesChecked),
        e("p",{"data-docx-replay-sha":"true"},
          "Original document SHA-256: "+status.sourceSha256),
        e("p",null,"Source locations and Builder IDs match this document and model. Still UNVERIFIED as real devices/network facts. No values shown, no Engine changes.")) : null,
      e("div",{className:"network-import-actions"},
        e("button",{type:"button",disabled:busy,"data-docx-replay-close":"true",
          onClick:()=>{generation.current++;onClose();}},"Close without changes"))));
}
