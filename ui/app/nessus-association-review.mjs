import React, { useState } from "react";
const e=React.createElement;
const PAGE_SIZE=20;
const MAX_REFERENCES=20;

/** Private ReportHost ordinal -> existing modeled resource, metadata-only. */
export function NessusHostAssociationReview({preview,model,onExport}){
  const [choices,setChoices]=useState({});
  const [page,setPage]=useState(0);
  const [limitError,setLimitError]=useState(false);
  const [ack,setAck]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [exported,setExported]=useState(false);
  const pages=Math.max(1,Math.ceil(preview.hostCount/PAGE_SIZE));
  const currentPage=Math.min(Math.max(0,page),pages-1);
  const firstOrdinal=currentPage*PAGE_SIZE;
  const lastOrdinal=Math.min(preview.hostCount,firstOrdinal+PAGE_SIZE)-1;
  const selectedCount=Object.values(choices).filter(Boolean).length;
  const references=Object.entries(choices).filter(([,id])=>Boolean(id))
    .map(([hostOrdinal,targetResourceId])=>({hostOrdinal:Number(hostOrdinal),targetResourceId}))
    .sort((a,b)=>a.hostOrdinal-b.hostOrdinal);
  const dup=new Set(references.map(x=>x.targetResourceId)).size!==references.length;
  const canExport=!!model&&!!model.resources?.length&&references.length>0&&
    references.length<=MAX_REFERENCES&&!dup&&ack&&!busy&&typeof onExport==="function";
  const run=async()=>{
    if(!canExport)return;
    setBusy(true);setError("");setExported(false);
    try{
      await onExport({
        sourceSha256:preview.sourceSha256,
        scenarioId:model.scenarioId,
        sourceRevision:model.sourceRevision,
        acknowledgeNotVerified:ack,
        references,
      });
      setExported(true);
    }catch(cause){
      const code=typeof cause?.code==="string" &&
        /^NESSUS_[A-Z0-9_]+$/.test(cause.code)?cause.code:"NESSUS_ASSOC_BLOCKED";
      setError(code);
    }finally{setBusy(false);}
  };
  return e("section",{"data-nessus-association-review":model?"REVIEW_REQUIRED":"BUILDER_REQUIRED",
    className:"network-import-preview"},
    e("h3",null,"Optional reviewed ReportHost references"),
    e("p",{"data-nessus-association-boundary":"true"},
      "ReportHost ordinal is a position in this specific file, NOT an independently verified device identity. Choose existing Builder resources manually. No host names, IPs or vulnerability details are disclosed or mapped."),
    model?e("p",{"data-nessus-model":"true"},
      "Builder resource count: "+model.resources.length+" · revision "+model.sourceRevision):
      e("p",{"data-nessus-no-builder":"true"},
      "Open a Builder scenario before exporting associations. Read-only severity preview remains available."),
    model?e("div",{"data-nessus-association-pagination":"true"},
      e("p",{"data-nessus-association-page":String(currentPage+1),
        "data-nessus-association-range":`${firstOrdinal}:${lastOrdinal}`},
        `Source ReportHost positions ${firstOrdinal+1}–${lastOrdinal+1} of ${preview.hostCount} · Page ${currentPage+1} of ${pages}; at most ${MAX_REFERENCES} manually selected references across pages.`),
      e("div",{className:"network-import-actions"},
        e("button",{type:"button","data-nessus-page-previous":"true",
          disabled:busy||currentPage===0,
          onClick:()=>setPage(p=>Math.max(0,p-1))},"Previous ReportHosts"),
        e("button",{type:"button","data-nessus-page-next":"true",
          disabled:busy||currentPage===pages-1,
          onClick:()=>setPage(p=>Math.min(pages-1,p+1))},"Next ReportHosts")),
      e("ol",{"data-nessus-review-hosts":"true",className:"validation-list",start:firstOrdinal+1},
        ...Array.from({length:Math.max(0,lastOrdinal-firstOrdinal+1)},(_,index)=>{
          const hostOrdinal=firstOrdinal+index;
          return e("li",{key:hostOrdinal},
            e("label",null,"ReportHost #"+(hostOrdinal+1)+" · ",
              e("select",{"data-nessus-associate-host":String(hostOrdinal),
                value:choices[hostOrdinal]??"",disabled:busy,
                onChange:event=>{
                  const targetResourceId=event.currentTarget.value;
                  if(targetResourceId!==""&&!choices[hostOrdinal]&&selectedCount>=MAX_REFERENCES){
                    setLimitError(true);setAck(false);setExported(false);setError("");return;
                  }
                  setLimitError(false);
                  setChoices(prev=>({...prev,[hostOrdinal]:targetResourceId}));
                  setAck(false);setExported(false);setError("");
                }},
                e("option",{value:""},"Not associated (default)"),
                ...model.resources.map(item=>e("option",{key:item.id,value:item.id},
                  item.label+" ["+item.id+"]")))));
        }))) : null,
    limitError?e("p",{role:"alert","data-nessus-association-cap":"BLOCKED"},
      "At most 20 distinct ReportHost references may be selected. Clear an existing selection first."):null,
    dup?e("p",{role:"alert","data-nessus-association-conflict":"BLOCKED"},
      "Each modeled resource can be selected only once."):null,
    e("p",{"data-nessus-selected-count":String(references.length)},
      "Manually selected references: "+references.length),
    e("label",null,e("input",{type:"checkbox","data-nessus-association-ack":"true",
      checked:ack,disabled:busy||!model||!references.length||dup,
      onChange:event=>{setAck(event.currentTarget.checked);setExported(false);}}),
      " I acknowledge these are unverified source-position references, not confirmed identities or vulnerabilities."),
    e("button",{type:"button","data-nessus-association-export":"true",
      disabled:!canExport,onClick:()=>{void run();}},
      busy?"Rechecking original Nessus file…":"Export reviewed metadata-only references (JSON)"),
    error?e("p",{role:"alert","data-nessus-association-error":"BLOCKED"},error):null,
    exported?e("p",{"data-nessus-association-exported":"true"},
      "Local sidecar exported. Builder, physical topology and Engine unchanged."):null);
}
