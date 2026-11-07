import React, { useEffect, useRef, useState } from "react";
import { DrawioVertexAssociationReview } from "./drawio-association-review.mjs";
const e=React.createElement;

/** Aggregate-only projection of declared diagram cells, not a physical topology. */
export function DrawioStructureDetails({preview}){
  if(!preview)return e("p",{"data-drawio-empty":"true"},
    "Choose a local .drawio file (uncompressed XML or bounded compressed pages).");
  return e("section",{className:"network-import-preview",
      "data-drawio-preview":"PREVIEW_ONLY"},
    e("h3",null,"diagrams.net — structural preview only"),
    e("p",{"data-drawio-summary":"true"},
      "Pages: "+preview.pageCount+" · Drawn vertices: "+preview.vertexCount+
      " · Drawn edges: "+preview.drawnEdgeCount+
      " · Compressed pages: "+preview.compressedPageCount),
    e("p",{"data-drawio-source-sha":"true"},"Original source SHA-256: "+preview.sourceSha256),
    e("ul",{className:"validation-list","data-drawio-page-counts":"true"},
      ...preview.pages.map(page=>e("li",{
        key:page.pageOrdinal,"data-drawio-page":String(page.pageOrdinal)},
        "Page #"+(page.pageOrdinal+1)+": "+page.vertexCount+
        " drawn vertices, "+page.drawnEdgeCount+" drawn edges"))),
    e("p",{"data-drawio-truth-boundary":"true"},
      "TOPOLOGY_DECLARED only. Drawn edges are not verified physical cables. "+
      "No node labels, IPs, styles or endpoints are exposed; no asset identity, reachability, "+
      "routing, current network state, or Engine PASS is inferred."),
    e("p",{"data-drawio-activation-status":"BLOCKED"},
      "No Builder changes, import, topology activation or Engine operations."));
}

/** Separate file selection dialog; never receives any Builder or Engine setter. */
export function DrawioStructurePanel({inspectFile,onClose,model=null,onExportReviewed}){
  const [preview,setPreview]=useState(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const generation=useRef(0),focus=useRef(null),originalFile=useRef(null);
  useEffect(()=>{focus.current?.focus();return()=>{generation.current++;};},[]);
  useEffect(()=>{
    const handler=event=>{if(event.key==="Escape"&&!busy){generation.current++;originalFile.current=null;onClose();}};
    document.addEventListener("keydown",handler);
    return()=>document.removeEventListener("keydown",handler);
  },[busy,onClose]);
  const choose=async file=>{
    const current=++generation.current;
    setPreview(null);setError("");originalFile.current=file;
    if(!file)return;
    setBusy(true);
    try{
      const next=await inspectFile(file);
      if(generation.current===current){
        if(next?.status==="PREVIEW_ONLY"&&next.canActivate===false&&
           next.engineVerified===false&&next.physicalTopologyVerified===false&&
           next.modelMutated===false)setPreview(next);
        else setError("DRAWIO_PREVIEW_INVALID");
      }
    }catch(cause){
      if(generation.current===current){
        originalFile.current=null;
        setError(typeof cause?.code==="string" &&
          /^(DRAWIO_|IMPORT_XML_)[A-Z0-9_]+$/.test(cause.code)
          ?cause.code:"DRAWIO_PREVIEW_BLOCKED");
      }
    }finally{if(generation.current===current)setBusy(false);}
  };
  return e("div",{className:"network-import-overlay","data-drawio-overlay":"true"},
    e("section",{className:"network-import-panel",role:"dialog","aria-modal":"true",
      "aria-label":"diagrams.net structural preview",tabIndex:-1,ref:focus,
      "data-drawio-panel":"PREVIEW_ONLY"},
      e("div",{className:"network-import-heading"},
        e("div",null,e("h2",null,"Inspect draw.io — read-only structure"),
          e("p",null,"Local uncompressed or raw-DEFLATE compressed diagrams; bounded, read-only counts.")),
        e("button",{type:"button",disabled:busy,"aria-label":"Close draw.io preview",
          onClick:()=>{generation.current++;originalFile.current=null;onClose();}},"Close")),
      e("label",{className:"file-button"},busy?"Reading diagram…":"Choose .drawio file",
        e("input",{type:"file",accept:".drawio",hidden:true,disabled:busy,
          "data-drawio-file":"true",
          onChange:event=>{
            const file=event.currentTarget.files?.[0]??null;
            event.currentTarget.value="";
            void choose(file);
          }})),
      error?e("p",{role:"alert","data-drawio-error":"BLOCKED"},error):null,
      e(DrawioStructureDetails,{preview}),
      preview?e(DrawioVertexAssociationReview,{
        key:preview.sourceSha256+":"+generation.current+":"+String(model?.sourceRevision??-1),
        preview,model,
        onExport:async decision=>{
          const epoch=generation.current,source=originalFile.current;
          if(!source||typeof onExportReviewed!=="function"){
            const error=new Error("DRAWIO_ASSOC_UNAVAILABLE");
            error.code="DRAWIO_ASSOC_UNAVAILABLE";throw error;
          }
          return onExportReviewed(source,preview,decision,
            ()=>generation.current===epoch&&originalFile.current===source);
        }
      }):null,
      e("div",{className:"network-import-actions"},
        e("button",{type:"button",disabled:busy,"data-drawio-close":"true",
          onClick:()=>{generation.current++;originalFile.current=null;onClose();}},"Close without changes"))));
}
