import React,{useEffect,useRef,useState} from "react";
const e=React.createElement;

/** Two local files and explicit consent. Never disclose inventory values or JSON content. */
export function AnsibleYamlSavedReferenceReplayPanel({model,onReplay,onClose}){
  const [original,setOriginal]=useState(null);
  const [report,setReport]=useState(null);
  const [ack,setAck]=useState(false);
  const [match,setMatch]=useState(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const generation=useRef(0),focus=useRef(null);
  useEffect(()=>{focus.current?.focus();return()=>{generation.current++;};},[]);
  useEffect(()=>{
    const escape=event=>{if(event.key==="Escape"&&!busy){generation.current++;onClose();}};
    document.addEventListener("keydown",escape);
    return()=>document.removeEventListener("keydown",escape);
  },[busy,onClose]);
  const reset=()=>{
    generation.current++;setAck(false);setMatch(null);setError("");
  };
  const run=async()=>{
    if(!original||!report||!ack||!model||busy||typeof onReplay!=="function")return;
    const epoch=++generation.current;
    setBusy(true);setMatch(null);setError("");
    try{
      const result=await onReplay(original,report,true,()=>generation.current===epoch);
      if(epoch!==generation.current)return;
      if(result?.status!=="REFERENCE_REPLAY_MATCH"||
         result.semanticTrack!=="CONFIG_DOCUMENTED"||
         result.identityVerified!==false||result.physicalTopologyVerified!==false||
         result.engineVerified!==false||result.modelMutated!==false){
        setError("ANSIBLE_YAML_REPLAY_RESULT_INVALID");
      }else setMatch(result);
    }catch(cause){
      if(epoch!==generation.current)return;
      setError(typeof cause?.code==="string"&&/^ANSIBLE_YAML_REPLAY_[A-Z0-9_]+$/.test(cause.code)
        ?cause.code:"ANSIBLE_YAML_REPLAY_BLOCKED");
    }finally{if(epoch===generation.current)setBusy(false);}
  };
  return e("div",{className:"network-import-overlay","data-ansible-yaml-replay-overlay":"true"},
    e("section",{className:"network-import-panel",role:"dialog","aria-modal":"true",
      "aria-label":"Inspect saved Ansible YAML references",tabIndex:-1,ref:focus,
      "data-ansible-yaml-replay-panel":"CONFIG_DOCUMENTED"},
      e("div",{className:"network-import-heading"},
        e("div",null,e("h2",null,"Inspect saved Ansible YAML references — read-only replay"),
          e("p",null,"Compare the exact original YAML, an exported association JSON and current Builder.")),
        e("button",{type:"button",disabled:busy,"aria-label":"Close Ansible YAML replay",
          onClick:()=>{generation.current++;onClose();}},"Close")),
      e("p",{"data-ansible-yaml-replay-truth":"true"},
        "MATCH verifies only unchanged source declarations and operator-selected references "+
        "to currently modeled Builder IDs. It does NOT verify real asset identity, IP ownership, "+
        "reachability, physical cabling or Engine results. No source inventory values are displayed."),
      e("label",null,"Original static Ansible inventory .yml/.yaml",
        e("input",{type:"file",accept:".yml,.yaml",disabled:busy,
          "data-ansible-yaml-replay-original":"true",
          onChange:event=>{const f=event.currentTarget.files?.[0]??null;reset();setOriginal(f);}})),
      e("label",null,"Previously exported reviewed associations (.json)",
        e("input",{type:"file",accept:".json",disabled:busy,
          "data-ansible-yaml-replay-report":"true",
          onChange:event=>{const f=event.currentTarget.files?.[0]??null;reset();setReport(f);}})),
      !model?e("p",{"data-ansible-yaml-replay-no-builder":"true"},
        "Open an existing Builder scenario before checking a saved report."):null,
      e("label",null,
        e("input",{type:"checkbox",checked:ack,
          disabled:busy||!model||!original||!report,
          "data-ansible-yaml-replay-consent":"true",
          onChange:event=>{generation.current++;setMatch(null);setError("");setAck(event.currentTarget.checked);}}),
        " I request an unverified reference consistency check; no Engine or Builder modification."),
      e("button",{type:"button","data-ansible-yaml-replay-verify":"true",
        disabled:busy||!model||!original||!report||!ack,onClick:()=>{void run();}},
        busy?"Rechecking original YAML, JSON and Builder…":"Verify saved references locally"),
      error?e("p",{role:"alert","data-ansible-yaml-replay-error":"BLOCKED"},error):null,
      match?e("section",{"data-ansible-yaml-replay-result":"REFERENCE_REPLAY_MATCH"},
        e("h3",null,"Saved reference replay: MATCH"),
        e("p",{"data-ansible-yaml-replay-count":String(match.referencesChecked)},
          "Reviewed unverified inventory references checked: "+match.referencesChecked),
        e("p",{"data-ansible-yaml-replay-sha":"true"},
          "Original source SHA-256: "+match.sourceSha256),
        e("p",null,"Inventory metadata consistency only; no Builder changes or Engine verification.")):null,
      e("div",{className:"network-import-actions"},
        e("button",{type:"button",disabled:busy,"data-ansible-yaml-replay-close":"true",
          onClick:()=>{generation.current++;onClose();}},"Close without changes"))));
}
