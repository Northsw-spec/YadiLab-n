import React, { useEffect, useRef, useState } from "react";
import { OdtReviewedCellAssociation } from "./odt-reviewed-cell-association.mjs";
const e=React.createElement;

/** Ephemeral, locally consented, ONE ODT cell only; never persists or exports. */
export function OdtCellDisclosureReview({ preview, onRevealCell, model=null, onExportAssociation,onStageAssociation }) {
  const [selected,setSelected]=useState("");
  const [acknowledged,setAcknowledged]=useState(false);
  const [disclosed,setDisclosed]=useState(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const generation=useRef(0);
  useEffect(()=>()=>{generation.current++;},[]);
  const options=[],locators=new Map();
  for(const table of preview.tables){
    for(const row of table.rows){
      for(const cell of row.cells){
        const key=[table.tableOrdinal,row.rowOrdinal,cell.cellOrdinal].join(":");
        locators.set(key,cell.locator);
        options.push(e("option",{key,value:key},
          "Table "+(table.tableOrdinal+1)+" / Row "+(row.rowOrdinal+1)+
          " / Cell "+(cell.cellOrdinal+1)+" ("+cell.textCodeUnits+" code units)"));
      }
    }
  }
  const clear=()=>{
    generation.current++;setDisclosed(null);setError("");setAcknowledged(false);
    setBusy(false);
  };
  const reveal=async()=>{
    if(!selected||!acknowledged||busy||!locators.has(selected)||
       typeof onRevealCell!=="function")return;
    const current=++generation.current;
    setDisclosed(null);setError("");setBusy(true);
    try{
      const value=await onRevealCell(locators.get(selected),true);
      if(current!==generation.current)return;
      if(value?.status!=="REVEALED_UNVERIFIED" ||
         value.sourceSha256!==preview.sourceSha256 ||
         value.engineVerified!==false||value.physicalTopologyVerified!==false||
         value.canActivate!==false||
         [value.locator?.tableOrdinal,value.locator?.rowOrdinal,
          value.locator?.cellOrdinal].join(":")!==selected){
        setError("ODT_CELL_RESULT_INVALID");
      }else setDisclosed(value);
    }catch(cause){
      if(current!==generation.current)return;
      const code=typeof cause?.code==="string"&&/^ODT_CELL_[A-Z_]+$/.test(cause.code)
        ?cause.code:"ODT_CELL_REVIEW_BLOCKED";
      setError(code);
    }finally{
      if(current===generation.current)setBusy(false);
    }
  };
  return e("section",{className:"network-import-preview",
     "data-odt-disclosure":"OPERATOR_REVIEW_ONLY"},
    e("h4",null,"Optional one-cell local ODT disclosure"),
    e("p",{className:"helper-note","data-odt-disclosure-warning":"true"},
      "Only reveal cells you are authorized to view. Sensitive content may not always be detected. One cell at a time; no Builder changes, exports, or Engine verification."),
    e("label",null,"Select one original cell (no values shown): ",
      e("select",{"data-odt-select-cell":"true",value:selected,disabled:busy,
        onChange:event=>{clear();setSelected(event.currentTarget.value);}},
        e("option",{value:""},"Select a cell"),...options)),
    e("label",null,
      e("input",{type:"checkbox","data-odt-consent":"true",checked:acknowledged,
        disabled:busy||!selected,onChange:event=>{
          generation.current++;setDisclosed(null);setError("");
          setAcknowledged(event.currentTarget.checked);
        }}),
      " I understand the selected ODT cell may contain confidential data and explicitly choose to reveal it locally."),
    e("button",{type:"button","data-odt-reveal":"true",
      disabled:busy||!selected||!acknowledged,onClick:()=>{void reveal();}},
      busy?"Validating the original ODT cell…":"Reveal selected ODT cell locally"),
    error?e("p",{role:"alert","data-odt-disclosure-error":"BLOCKED"},error):null,
    disclosed?e("p",{"data-odt-revealed":"UNVERIFIED"},
      "Selected original cell (DOCUMENTED, NOT VERIFIED): ",
      e("code",{"data-odt-revealed-value":"true"},disclosed.text),
      e("button",{type:"button","data-odt-hide":"true",onClick:clear},"Hide value")):null,
    disclosed?e(OdtReviewedCellAssociation,{
      key:[disclosed.sourceSha256,disclosed.locator.tableOrdinal,
        disclosed.locator.rowOrdinal,disclosed.locator.cellOrdinal].join(":"),
      disclosed,model,onExportAssociation,onStageAssociation,
    }):null
  );
}
