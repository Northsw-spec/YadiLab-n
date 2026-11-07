import React, { useState } from "react";
const e=React.createElement;
export function DocxMultiReferenceQueue({ items, model, busy=false, onRemove, onExport }) {
  const [acknowledged,setAcknowledged]=useState(false);
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState("");
  const [done,setDone]=useState(false);
  const eligible=Boolean(model && items.length>=2 && items.length<=10 && acknowledged &&
    !busy && !submitting && typeof onExport==="function");
  const exportAll=async()=>{
    if(!eligible)return;
    setSubmitting(true);setError("");setDone(false);
    try{
      await onExport();
      setDone(true);
    }catch(cause){
      const code=typeof cause?.code==="string" && /^DOCX_[A-Z_]+$/.test(cause.code)
        ?cause.code:"DOCX_MULTI_EXPORT_BLOCKED";
      setError(code);
    }finally{setSubmitting(false);}
  };
  return e("section",{"data-docx-multi-queue":"REVIEWED_ASSOCIATIONS_ONLY",className:"network-import-preview"},
    e("h4",null,"Reviewed multi-reference report"),
    e("p",{"data-docx-multi-warning":"true"},
      "Add 2–10 individually disclosed and acknowledged cells. Only original cell positions and existing resource IDs are queued; no cell text is stored or exported. All references remain UNVERIFIED."),
    e("p",{"data-docx-multi-count":String(items.length)},
      "Selected references: "+items.length+" / 10"),
    items.length ? e("ol",{"data-docx-multi-items":"true",className:"validation-list"},
      ...items.map((item,i)=>{
        const loc=item.source.cellLocator;
        return e("li",{key:[loc.tableOrdinal,loc.rowOrdinal,loc.cellOrdinal].join(":"),
            "data-docx-multi-item":String(i)},
          "Table "+(loc.tableOrdinal+1)+", row "+(loc.rowOrdinal+1)+
          ", cell "+(loc.cellOrdinal+1)+" → resource "+item.association.targetResourceId,
          e("button",{type:"button","data-docx-multi-remove":String(i),
            disabled:busy||submitting,onClick:()=>{
              setAcknowledged(false);setError("");setDone(false);onRemove(i);
            }},"Remove"));
      })) : null,
    !model ? e("p",{"data-docx-multi-model-blocked":"true"},
      "Only available in an existing Builder model.") : null,
    e("label",null,
      e("input",{type:"checkbox","data-docx-multi-ack":"true",checked:acknowledged,
        disabled:items.length<2||!model||submitting||busy,
        onChange:event=>{setAcknowledged(event.currentTarget.checked);setDone(false);}}),
      " I explicitly approve this collection of unverified DOCX-to-model references. No identity, physical connection or Engine result was verified."),
    e("button",{type:"button","data-docx-multi-export":"true",disabled:!eligible,
      onClick:()=>{void exportAll();}},
      submitting?"Revalidating all selected DOCX cells…":"Export multi-reference report (JSON)"),
    error?e("p",{role:"alert","data-docx-multi-error":"BLOCKED"},error):null,
    done?e("p",{"data-docx-multi-exported":"true"},
      "Reviewed multi-reference sidecar exported. Builder and Engine unchanged."):null
  );
}
