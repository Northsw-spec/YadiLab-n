import React, { useEffect, useRef, useState } from "react";
import { NessusHostAssociationReview } from "./nessus-association-review.mjs";
const e=React.createElement;

/** Metadata-only Nessus v2 scan-summary. No raw XML, host/plugin identities or output in DOM. */
export function NessusSeverityDetails({ result }) {
  if(!result) return e("p",{"data-nessus-empty":"true"},
    "Choose a local .nessus file. Nothing is read until you select a file.");
  return e("section",{"data-nessus-summary":"EVIDENCE_ONLY",className:"network-import-preview"},
    e("h3",null,"Nessus v2 XML — read-only severity totals"),
    e("p",{"data-nessus-host-count":String(result.hostCount)},
      "ReportHost sections: "+result.hostCount),
    e("p",{"data-nessus-finding-count":String(result.findingCount)},
      "ReportItem findings: "+result.findingCount),
    e("p",{"data-nessus-source-sha":"true"},"Original file SHA-256: "+result.sourceSha256),
    e("ul",{"data-nessus-severity-counts":"true",className:"validation-list"},
      ...["Informational","Low","Medium","High","Critical"].map((label,i)=>
        e("li",{key:i,"data-nessus-severity":String(i)},label+": "+result.severityCounts[i]))),
    e("p",{"data-nessus-truth-boundary":"true"},
      "EVIDENCE_OBSERVED only: exporter-declared scan findings, not current verified vulnerabilities, device identities, physical topology, open ports or Engine success. No original host names, IPs, plugin output or credential strings are displayed."),
    e("p",{"data-nessus-activation-status":"BLOCKED"},
      "No import, mapping, topology activation or Engine change. Closing discards the summary."));
}

export function NessusSeverityPanel({ inspectFile, onClose, model=null, onExportReviewed }) {
  const [result,setResult]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const generation=useRef(0),focus=useRef(null),originalFile=useRef(null);
  useEffect(()=>{focus.current?.focus();return()=>{generation.current++;};},[]);
  useEffect(()=>{
    const key=event=>{if(event.key==="Escape"&&!busy){generation.current++;originalFile.current=null;onClose();}};
    document.addEventListener("keydown",key);
    return()=>document.removeEventListener("keydown",key);
  },[busy,onClose]);
  const inspect=async file=>{
    const id=++generation.current;
    setResult(null);setError("");originalFile.current=file;
    if(!file)return;
    setBusy(true);
    try {
      const next=await inspectFile(file);
      if(generation.current===id &&
         next?.status==="EVIDENCE_ONLY"&&next.canActivate===false&&
         next.engineVerified===false&&next.physicalTopologyVerified===false){
        setResult(next);
      } else if(generation.current===id){
        setError("NESSUS_PREVIEW_INVALID");
      }
    }catch(cause){
      if(generation.current===id){
        originalFile.current=null;
        setError(typeof cause?.code==="string" &&
          /^(NESSUS_|IMPORT_XML_)[A-Z0-9_]+$/.test(cause.code)
          ?cause.code:"NESSUS_PREVIEW_BLOCKED");
      }
    }finally{if(generation.current===id)setBusy(false);}
  };
  return e("div",{className:"network-import-overlay","data-nessus-overlay":"true"},
    e("section",{className:"network-import-panel",role:"dialog","aria-modal":"true",
      "aria-label":"Nessus v2 severity read-only review",ref:focus,tabIndex:-1,
      "data-nessus-panel":"EVIDENCE_ONLY"},
      e("div",{className:"network-import-heading"},e("div",null,
        e("h2",null,"Inspect Nessus v2 XML — severity only"),
        e("p",null,"Offline structural summary; source identifiers and plugin details are suppressed.")),
        e("button",{type:"button",disabled:busy,onClick:()=>{generation.current++;originalFile.current=null;onClose();},
          "aria-label":"Close Nessus inspection"},"Close")),
      e("label",{className:"file-button"},busy?"Inspecting Nessus v2 XML…":"Choose .nessus file",
        e("input",{type:"file",accept:".nessus",hidden:true,disabled:busy,
          "data-nessus-file":"true",
          onChange:event=>{
            const file=event.currentTarget.files?.[0]??null;
            event.currentTarget.value="";
            void inspect(file);
          }})),
      error?e("p",{role:"alert","data-nessus-error":"BLOCKED"},error):null,
      e(NessusSeverityDetails,{result}),
      result?e(NessusHostAssociationReview,{
        key:result.sourceSha256+":"+generation.current+":"+String(model?.sourceRevision??-1),
        preview:result,model,
        onExport:async decision=>{
          const epoch=generation.current,source=originalFile.current;
          if(!source||!result||!model||typeof onExportReviewed!=="function"){
            const error=new Error("NESSUS_ASSOC_UNAVAILABLE");
            error.code="NESSUS_ASSOC_UNAVAILABLE";throw error;
          }
          return onExportReviewed(source,result,decision,()=>{
            return generation.current===epoch&&originalFile.current===source;
          });
        },
      }):null,
      e("div",{className:"network-import-actions"},
        e("button",{type:"button","data-nessus-close":"true",disabled:busy,
          onClick:()=>{generation.current++;originalFile.current=null;onClose();}},"Close without changes"))));
}
