import React,{useState} from "react";
const e=React.createElement;

/** One explicit P3-reviewed ODT cell -> one existing modeled Builder resource. */
export function OdtReviewedCellAssociation({ disclosed,model,onExportAssociation,onStageAssociation }) {
  const [resourceId,setResourceId]=useState("");
  const [acknowledged,setAcknowledged]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [exported,setExported]=useState(false);
  const [staged,setStaged]=useState(false);
  const canExport=Boolean(model&&model.resources?.length&&disclosed&&resourceId&&
    acknowledged&&!busy&&typeof onExportAssociation==="function");
  const stage=async()=>{
    if(!canExport||typeof onStageAssociation!=="function")return;
    setBusy(true);setError("");setStaged(false);
    try{
      await onStageAssociation(disclosed,{
        sourceSha256:disclosed.sourceSha256,scenarioId:model.scenarioId,
        sourceRevision:model.sourceRevision,targetResourceId:resourceId,
        acknowledgeNotVerified:acknowledged,
      });
      setStaged(true);
    }catch(cause){
      const code=typeof cause?.code==="string"&&/^ODT_[A-Z_]+$/.test(cause.code)
        ?cause.code:"ODT_MULTI_STAGE_BLOCKED";
      setError(code);
    }finally{setBusy(false);}
  };
  const exportOne=async()=>{
    if(!canExport)return;
    setBusy(true);setError("");setExported(false);
    try{
      await onExportAssociation(disclosed,{
        sourceSha256:disclosed.sourceSha256,
        scenarioId:model.scenarioId,sourceRevision:model.sourceRevision,
        targetResourceId:resourceId,acknowledgeNotVerified:acknowledged,
      });
      setExported(true);
    }catch(cause){
      const code=typeof cause?.code==="string" &&
        /^(?:ODT_ASSOC_|ODT_CELL_|ODT_FILE_)[A-Z_]+$/.test(cause.code)
          ?cause.code:"ODT_ASSOC_EXPORT_BLOCKED";
      setError(code);
    }finally{
      setBusy(false);
    }
  };
  return e("section",{className:"network-import-preview",
      "data-odt-association":"REVIEWED_ASSOCIATIONS_ONLY"},
    e("h4",null,"Optional reviewed ODT reference to an existing Builder resource"),
    e("p",{"data-odt-association-boundary":"true"},
      "UNVERIFIED operator assertion for one selected document cell. Exported JSON stores the original ODT SHA-256 and cell position, not the cell value. Builder and Engine remain unchanged."),
    model && model.resources?.length?e("label",null,"Existing Builder resource: ",
      e("select",{"data-odt-association-target":"true",value:resourceId,disabled:busy,
          onChange:event=>{
            setResourceId(event.currentTarget.value);
            setAcknowledged(false);setExported(false);setStaged(false);setError("");
          }},
        e("option",{value:""},"No resource selected (default)"),
        ...model.resources.map(item=>e("option",{key:item.id,value:item.id},
          item.label+" ["+item.id+"]"))))
    :e("p",{"data-odt-association-model-blocked":"true"},
      "A current Builder scenario with existing resources is required. Runtime observation cannot export modeled associations."),
    e("label",null,
      e("input",{type:"checkbox","data-odt-association-ack":"true",
          checked:acknowledged,disabled:busy||!model||!resourceId,
          onChange:event=>{
            setAcknowledged(event.currentTarget.checked);setError("");setExported(false);setStaged(false);
          }}),
      " I assert this is an UNVERIFIED operator-selected reference, not proof of the actual device or physical topology."),
    e("button",{type:"button","data-odt-association-export":"true",
        disabled:!canExport,onClick:()=>{void exportOne();}},
      busy?"Revalidating original ODT source…":"Export reviewed ODT reference (JSON)"),
    typeof onStageAssociation==="function"?e("button",{
       type:"button","data-odt-multi-stage":"true",disabled:!canExport||staged,
       onClick:()=>{void stage();}
     },staged?"Reference added to report":"Add reviewed ODT reference to report"):null,
    staged?e("p",{"data-odt-multi-staged":"true"},
      "Only the source position and existing resource ID were queued; original cell text was not stored."):null,
    error?e("p",{role:"alert","data-odt-association-error":"BLOCKED"},error):null,
    exported?e("p",{"data-odt-association-exported":"true"},
      "One source-reference JSON was exported without cell contents or Builder/Engine changes."):null);
}
