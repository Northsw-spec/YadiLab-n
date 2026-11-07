import React, { useEffect, useRef, useState } from "react";
import { OdtCellDisclosureReview } from "./odt-cell-disclosure-review.mjs";
import { OdtMultiReferenceQueue } from "./odt-multi-reference-queue.mjs";
const e=React.createElement;
const MAX_VISIBLE_TABLES=20,MAX_VISIBLE_ROWS=30,MAX_VISIBLE_CELLS=16;

export function OdtStructureDetails({ result }) {
  if(!result)return e("p",{"data-odt-empty":"true"},
    "Choose a local .odt file. Only supported table structure is inspected; no document cell text is displayed.");
  const {filename,preview}=result;
  const items=[];
  for(const table of preview.tables.slice(0,MAX_VISIBLE_TABLES)){
    const rows=[];
    for(const row of table.rows.slice(0,MAX_VISIBLE_ROWS)){
      const cells=row.cells.slice(0,MAX_VISIBLE_CELLS).map(cell=>
        e("li",{key:cell.cellOrdinal,
          "data-odt-cell":[table.tableOrdinal,row.rowOrdinal,cell.cellOrdinal].join(":")},
          "Cell "+(cell.cellOrdinal+1)+": "+cell.textCodeUnits+
          " text code units · source table "+(cell.locator.tableOrdinal+1)+
          ", row "+(cell.locator.rowOrdinal+1)+", cell "+(cell.locator.cellOrdinal+1)));
      rows.push(e("li",{key:row.rowOrdinal,
          "data-odt-row":[table.tableOrdinal,row.rowOrdinal].join(":")},
        "Row "+(row.rowOrdinal+1)+": "+row.cells.length+" cells",
        e("ul",{className:"validation-list"},...cells),
        row.cells.length>MAX_VISIBLE_CELLS?e("p",null,"Further cells not displayed."):null));
    }
    if(table.rows.length>MAX_VISIBLE_ROWS)rows.push(
      e("li",{key:"limit"},"Showing first "+MAX_VISIBLE_ROWS+" of "+table.rows.length+" rows."));
    items.push(e("li",{key:table.tableOrdinal,
        "data-odt-table":String(table.tableOrdinal)},
      e("strong",null,"Table "+(table.tableOrdinal+1)+": "+table.rows.length+" rows"),
      e("ol",{className:"validation-list"},...rows)));
  }
  return e("section",{"data-odt-preview":"CONFIG_DOCUMENTED",className:"network-import-preview"},
    e("h3",null,"ODT table structure — ",filename),
    e("p",{"data-odt-summary":"true"},
      "Declared tables: "+preview.tables.length+" · structural cells: "+preview.totalCells),
    e("p",{"data-odt-source-hash":"true"},"Original SHA-256: "+preview.sourceSha256),
    e("p",{"data-odt-truth-boundary":"true",className:"helper-note"},
      "CONFIG_DOCUMENTED, REVIEW_REQUIRED. Table shapes only. No original cell values, source secrets, verified devices, physical links, Builder edits or Engine PASS."),
    e("ol",{"data-odt-tables":"true",className:"validation-list"},...items),
    e("p",{"data-odt-activation-status":"BLOCKED"},
      "Read-only source inspection. Complex ODT tables may be rejected. No network mapping, import, or simulation activation."));
}

export function OdtStructurePanel({ inspectFile,reviewFile,model=null,onExportAssociation,onBuildAssociation,onExportMulti,onClose }) {
  const [result,setResult]=useState(null),[error,setError]=useState(""),
        [busy,setBusy]=useState(false);
  const [multiItems,setMultiItems]=useState([]);
  const generation=useRef(0),focus=useRef(null),localFile=useRef(null);
  useEffect(()=>{focus.current?.focus();return()=>{generation.current++;};},[]);
  useEffect(()=>{
    const escape=event=>{
      if(event.key==="Escape"&&!busy){generation.current++;localFile.current=null;onClose();}
    };
    document.addEventListener("keydown",escape);
    return()=>document.removeEventListener("keydown",escape);
  },[busy,onClose]);
  const inspect=async file=>{
    if(!file)return;
    const current=++generation.current;
    localFile.current=file;
    setMultiItems([]);
    setResult(null);setError("");setBusy(true);
    try{
      const next=await inspectFile(file);
      if(current===generation.current)setResult({...next,sourceEpoch:current});
    }catch(cause){
      if(current===generation.current){
        localFile.current=null;
        const code=typeof cause?.code==="string" &&
          /^(ODT_|IMPORT_ARCHIVE_|IMPORT_WORKBOOK_ARCHIVE_|IMPORT_XML_)[A-Z_]+$/.test(cause.code)
          ?cause.code:"ODT_INSPECTION_BLOCKED";
        setError(code);
      }
    }finally{
      if(current===generation.current)setBusy(false);
    }
  };
  const validateCurrentCell=async(disclosed,decision)=>{
    const epoch=generation.current,source=localFile.current;
    if(!source||!result||typeof reviewFile!=="function"||
        typeof onBuildAssociation!=="function"){
      throw Object.assign(new Error("ODT_MULTI_UNAVAILABLE"),{code:"ODT_MULTI_UNAVAILABLE"});
    }
    const fresh=await reviewFile(source,result.preview.sourceSha256,disclosed.locator,true);
    if(epoch!==generation.current||source!==localFile.current||
       fresh.sourceSha256!==disclosed.sourceSha256||
       fresh.text!==disclosed.text||
       JSON.stringify(fresh.locator)!==JSON.stringify(disclosed.locator)){
      throw Object.assign(new Error("ODT_MULTI_STALE_SOURCE"),{code:"ODT_MULTI_STALE_SOURCE"});
    }
    return onBuildAssociation(fresh,decision);
  };
  const stageReference=async(disclosed,decision)=>{
    if(!result||!model||result.preview.sourceSha256!==disclosed.sourceSha256){
      throw Object.assign(new Error("ODT_MULTI_STALE"),{code:"ODT_MULTI_STALE"});
    }
    if(multiItems.length>=10)throw Object.assign(new Error("ODT_MULTI_COUNT_INVALID"),{code:"ODT_MULTI_COUNT_INVALID"});
    const item=await validateCurrentCell(disclosed,decision);
    const loc=item?.source?.cellLocator;
    if(!loc||item.source.sha256!==result.preview.sourceSha256){
      throw Object.assign(new Error("ODT_MULTI_REFERENCE_INVALID"),{code:"ODT_MULTI_REFERENCE_INVALID"});
    }
    const key=[loc.tableOrdinal,loc.rowOrdinal,loc.cellOrdinal].join(":");
    if(multiItems.some(existing=>{
      const a=existing.source.cellLocator;
      return [a.tableOrdinal,a.rowOrdinal,a.cellOrdinal].join(":")===key||
          existing.association.targetResourceId===item.association.targetResourceId;
    }))throw Object.assign(new Error("ODT_MULTI_DUPLICATE_REFERENCE"),{code:"ODT_MULTI_DUPLICATE_REFERENCE"});
    // Only P4 metadata, never the disclosed raw ODT cell text, is persisted in React state.
    setMultiItems(previous=>[...previous,item]);
  };
  const exportMulti=async()=>{
    if(!result||!localFile.current||!model||multiItems.length<2||
      typeof reviewFile!=="function"||typeof onBuildAssociation!=="function"||
      typeof onExportMulti!=="function"){
      throw Object.assign(new Error("ODT_MULTI_UNAVAILABLE"),{code:"ODT_MULTI_UNAVAILABLE"});
    }
    const epoch=generation.current,source=localFile.current;
    const checked=[];
    for(const item of multiItems){
      const loc=item.source.cellLocator;
      const fresh=await reviewFile(source,result.preview.sourceSha256,loc,true);
      if(epoch!==generation.current||source!==localFile.current||
         fresh.sourceSha256!==item.source.sha256||
         JSON.stringify(fresh.locator)!==JSON.stringify(loc)){
        throw Object.assign(new Error("ODT_MULTI_STALE_SOURCE"),{code:"ODT_MULTI_STALE_SOURCE"});
      }
      const verified=await onBuildAssociation(fresh,{
        sourceSha256:item.source.sha256,scenarioId:item.targetModel.scenarioId,
        sourceRevision:item.targetModel.sourceRevision,
        targetResourceId:item.association.targetResourceId,acknowledgeNotVerified:true,
      });
      if(JSON.stringify(verified)!==JSON.stringify(item)){
        throw Object.assign(new Error("ODT_MULTI_STALE"),{code:"ODT_MULTI_STALE"});
      }
      checked.push(verified);
    }
    if(epoch!==generation.current||source!==localFile.current){
      throw Object.assign(new Error("ODT_MULTI_STALE_SOURCE"),{code:"ODT_MULTI_STALE_SOURCE"});
    }
    return onExportMulti(checked,{
      sourceSha256:result.preview.sourceSha256,
      scenarioId:model.scenarioId,sourceRevision:model.sourceRevision,
      acknowledgeNotVerified:true,
    });
  };
  return e("div",{className:"network-import-overlay","data-odt-overlay":"true"},
    e("section",{className:"network-import-panel",role:"dialog","aria-modal":"true",
        "aria-label":"OpenDocument ODT table structure inspection",ref:focus,tabIndex:-1,
        "data-odt-panel":"CONFIG_DOCUMENTED"},
      e("div",{className:"network-import-heading"},
        e("div",null,
          e("h2",null,"Inspect OpenDocument ODT — structure only"),
          e("p",null,"Structure is masked by default. Optional one-cell local reveal requires separate consent; nothing is imported.")),
        e("button",{type:"button",disabled:busy,
          "aria-label":"Close ODT inspection",onClick:()=>{
            generation.current++;localFile.current=null;onClose();
          }},"Close")),
      e("label",{className:"file-button"},busy?"Reading ODT structure…":"Choose .odt file",
        e("input",{type:"file",accept:".odt",hidden:true,disabled:busy,
          "data-odt-file":"true",onChange:event=>{
            const file=event.currentTarget.files?.[0];
            event.currentTarget.value="";
            if(file)void inspect(file);
          }})),
      error?e("p",{role:"alert",className:"helper-status blocked",
        "data-odt-error":"BLOCKED"},error):null,
      e(OdtStructureDetails,{result}),
      result && typeof reviewFile==="function" ? e(OdtCellDisclosureReview,{
        key:result.sourceEpoch,
        preview:result.preview,model,
        onStageAssociation:stageReference,
        onExportAssociation:async(disclosed,decision)=>{
          const current=generation.current,source=localFile.current;
          if(!source || !result || typeof reviewFile!=="function" ||
             typeof onExportAssociation!=="function"){
            throw Object.assign(new Error("ODT_ASSOC_EXPORT_UNAVAILABLE"),
              {code:"ODT_ASSOC_EXPORT_UNAVAILABLE"});
          }
          // Re-read and re-run *all* P3 original ZIP/XML/SHA/secret checks.
          const fresh=await reviewFile(source,result.preview.sourceSha256,
            disclosed.locator,true);
          if(current!==generation.current || source!==localFile.current ||
             fresh.sourceSha256!==disclosed.sourceSha256 ||
             fresh.text!==disclosed.text ||
             JSON.stringify(fresh.locator)!==JSON.stringify(disclosed.locator)){
            throw Object.assign(new Error("ODT_ASSOC_STALE_SOURCE"),
              {code:"ODT_ASSOC_STALE_SOURCE"});
          }
          return onExportAssociation(fresh,decision);
        },
        onRevealCell:async(locator,acknowledged)=>{
          const epoch=generation.current,source=localFile.current;
          if(!source)throw Object.assign(new Error("ODT_CELL_SOURCE_UNAVAILABLE"),
            {code:"ODT_CELL_SOURCE_UNAVAILABLE"});
          const value=await reviewFile(source,result.preview.sourceSha256,locator,acknowledged);
          if(epoch!==generation.current || source!==localFile.current) {
            throw Object.assign(new Error("ODT_CELL_STALE_REQUEST"),{code:"ODT_CELL_STALE_REQUEST"});
          }
          return value;
        },
      }) : null,
      result&&model&&typeof onExportMulti==="function"?e(OdtMultiReferenceQueue,{
        key:result.sourceEpoch+":"+multiItems.map(i=>
          [i.source.cellLocator.tableOrdinal,i.source.cellLocator.rowOrdinal,
           i.source.cellLocator.cellOrdinal,i.association.targetResourceId].join(":")).join("|"),
        items:multiItems,model,busy,
        onRemove:index=>setMultiItems(prev=>prev.filter((_,i)=>i!==index)),
        onExport:exportMulti,
      }):null,
      e("div",{className:"network-import-actions"},
        e("button",{type:"button",disabled:busy,"data-odt-close":"true",
          onClick:()=>{generation.current++;localFile.current=null;onClose();}},"Close without changes"))));
}
