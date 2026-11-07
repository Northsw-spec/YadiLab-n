import React, { useEffect, useRef, useState } from "react";
const e=React.createElement;
const PAGE_SIZE=20;
const MAX_SELECTED=20;
const safeError=cause=>{
  const code=cause?.code;
  return typeof code==="string" &&
    /^(DRAWIO_|IC030_P2B_|IMPORT_XML_)[A-Z0-9_]+$/.test(code)
    ? code : "IC030_P2B_BLOCKED";
};
const keyOf=v=>v.pageOrdinal+":"+v.vertexOrdinal;
const edgeKey=v=>v.pageOrdinal+":"+v.edgeOrdinal;

/** Isolated UI: no Builder setter, no Engine actions, no raw source text. */
export function DrawioReviewedBuilderPanel({
  onClose, inspectFile, onConfirm, manualRoleOptions=["resource.generic"],
}){
  const [candidate,setCandidate]=useState(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const generation=useRef(0),originalFile=useRef(null),focus=useRef(null);
  useEffect(()=>{
    focus.current?.focus();
    return ()=>{generation.current++;originalFile.current=null;};
  },[]);
  useEffect(()=>{
    const listener=ev=>{
      if(ev.key==="Escape"&&!busy){
        generation.current++;originalFile.current=null;onClose();
      }
    };
    document.addEventListener("keydown",listener);
    return ()=>document.removeEventListener("keydown",listener);
  },[busy,onClose]);
  const close=()=>{
    generation.current++;originalFile.current=null;
    setCandidate(null);onClose();
  };
  const choose=async file=>{
    const epoch=++generation.current;
    originalFile.current=null;setCandidate(null);setError("");
    if(!file)return;
    setBusy(true);
    try{
      const result=await inspectFile(file);
      if(generation.current!==epoch)return;
      if(!result || result.graph?.status!=="REVIEW_REQUIRED" ||
        result.graph.canActivate!==false || result.graph.engineVerified!==false ||
        result.graph.physicalTopologyVerified!==false ||
        !(result.originalBytes instanceof Uint8Array)){
        setError("DRAWIO_CANDIDATE_PREVIEW_INVALID");return;
      }
      originalFile.current=file;
      setCandidate(result);
    }catch(cause){
      if(generation.current===epoch){originalFile.current=null;setError(safeError(cause));}
    }finally{
      if(generation.current===epoch)setBusy(false);
    }
  };
  return e("div",{className:"network-import-overlay","data-drawio-candidate-overlay":"true"},
    e("section",{className:"network-import-panel",role:"dialog","aria-modal":"true",
      "aria-label":"Reviewed diagrams.net Builder import",tabIndex:-1,ref:focus,
      "data-drawio-candidate-panel":"REVIEW_REQUIRED"},
      e("div",{className:"network-import-heading"},
        e("div",null,e("h2",null,"Review diagrams.net into Builder"),
          e("p",null,"Select drawn positions manually. No diagram is verified physical topology.")),
        e("button",{type:"button",disabled:busy,onClick:close,
          "data-drawio-candidate-top-close":"true"},"Close")),
      e("label",{className:"file-button"},busy?"Reading original…":"Choose .drawio original",
        e("input",{type:"file",accept:".drawio",hidden:true,disabled:busy,
          "data-drawio-candidate-file":"true",
          onChange:ev=>{
            const selected=ev.currentTarget.files?.[0]??null;
            ev.currentTarget.value="";
            void choose(selected);
          }})),
      error?e("p",{role:"alert","data-drawio-candidate-error":"BLOCKED"},error):null,
      !candidate?e("p",{"data-drawio-candidate-empty":"true"},
        "No original reviewed. Existing Builder and Engine unchanged.") : 
        e(DrawioCandidateChoices,{key:candidate.graph.sourceSha256+":"+generation.current,
          graph:candidate.graph,manualRoleOptions,busy,setBusy,setError,
          onConfirm:async decision=>{
            const epoch=generation.current,original=originalFile.current;
            if(!original||typeof onConfirm!=="function"){
              const err=new Error("IC030_P2B_STALE");err.code="IC030_P2B_STALE";throw err;
            }
            const isCurrent=()=>generation.current===epoch&&originalFile.current===original;
            return onConfirm(candidate.graph,decision,candidate.originalBytes,original,isCurrent);
          }}),
      e("div",{className:"network-import-actions"},
        e("button",{type:"button",disabled:busy,"data-drawio-candidate-cancel":"true",
          onClick:close},"Close without Builder changes"))));
}

/** No automatic classification; bounded windows of 20 source positions. */
export function DrawioCandidateChoices({
  graph,manualRoleOptions=["resource.generic"],busy=false,setBusy=()=>{},
  setError=()=>{},onConfirm,
}){
  const [nodes,setNodes]=useState({});
  const [edges,setEdges]=useState({});
  const [ack,setAck]=useState(false);
  const [nodeWindow,setNodeWindow]=useState(0);
  const [edgeWindow,setEdgeWindow]=useState(0);
  const [error,setLocalError]=useState("");
  const [sending,setSending]=useState(false);
  const positions=graph.vertices;
  const selectedCount=Object.keys(nodes).length;
  const chosenEdges=graph.edges.filter(x=>edges[edgeKey(x)]);
  const edgesCount=chosenEdges.length;
  const canCommit=selectedCount>=1 && selectedCount<=MAX_SELECTED &&
    edgesCount<=MAX_SELECTED && (!edgesCount||ack) &&
    !busy && !sending && typeof onConfirm==="function";
  const clearNotice=()=>{setAck(false);setLocalError("");setError("");};
  const changeNode=(node,checked)=>{
    const key=keyOf(node);
    if(checked&&!nodes[key]&&selectedCount>=MAX_SELECTED){
      setLocalError("DRAWIO_CANDIDATE_SELECTION_COUNT_INVALID");return;
    }
    setNodes(previous=>{
      const next={...previous};
      if(checked)next[key]="resource.generic";
      else delete next[key];
      return next;
    });
    if(!checked){
      setEdges(previous=>{
        const next={...previous};
        for(const edge of graph.edges){
          if(edge.pageOrdinal===node.pageOrdinal &&
             (edge.sourceVertexOrdinal===node.vertexOrdinal ||
              edge.targetVertexOrdinal===node.vertexOrdinal))delete next[edgeKey(edge)];
        }
        return next;
      });
    }
    clearNotice();
  };
  const changeRole=(node,type)=>{
    setNodes(previous=>({...previous,[keyOf(node)]:type}));
    clearNotice();
  };
  const changeEdge=(edge,checked)=>{
    const key=edgeKey(edge);
    if(checked&&!edges[key]&&edgesCount>=MAX_SELECTED){
      setLocalError("DRAWIO_CANDIDATE_SELECTION_COUNT_INVALID");return;
    }
    setEdges(previous=>{
      const next={...previous};
      if(checked)next[key]=true;else delete next[key];
      return next;
    });
    clearNotice();
  };
  const submit=async()=>{
    if(!canCommit)return;
    setSending(true);setBusy(true);setError("");setLocalError("");
    const decision={
      sourceSha256:graph.sourceSha256,
      nodes:graph.vertices.filter(x=>nodes[keyOf(x)]).map(x=>({
        pageOrdinal:x.pageOrdinal,vertexOrdinal:x.vertexOrdinal,type:nodes[keyOf(x)],
      })),
      edges:graph.edges.filter(x=>edges[edgeKey(x)]).map(x=>({
        pageOrdinal:x.pageOrdinal,edgeOrdinal:x.edgeOrdinal,
      })),
      acknowledgeModeledConnections:edgesCount>0&&ack,
    };
    try{await onConfirm(decision);}
    catch(cause){setLocalError(safeError(cause));}
    finally{setBusy(false);setSending(false);}
  };
  const nodeStart=nodeWindow*PAGE_SIZE,edgeStart=edgeWindow*PAGE_SIZE;
  const visibleNodes=positions.slice(nodeStart,nodeStart+PAGE_SIZE);
  const visibleEdges=graph.edges.slice(edgeStart,edgeStart+PAGE_SIZE);
  return e("section",{className:"network-import-preview",
    "data-drawio-candidate-controls":"REVIEW_REQUIRED"},
    e("h3",null,"Original SHA and bounded drawn positions"),
    e("p",{"data-drawio-candidate-source-sha":"true"},graph.sourceSha256),
    e("p",{"data-drawio-candidate-counts":"true"},
      "Pages: "+graph.pageCount+" · Vertices: "+graph.vertexCount+
      " · Drawn edges: "+graph.drawnEdgeCount+" · Compressed pages: "+graph.compressedPageCount),
    e("p",{"data-drawio-candidate-truth-boundary":"true"},
      "Every drawn position is unverified. No node label, IP, OS, port or device type is inferred. "+
      "Drawn lines are NOT observed physical cables, routing or Engine PASS."),
    e("h4",null,"Manually select up to 20 drawn vertex positions"),
    e("nav",{"data-drawio-candidate-node-window":String(nodeWindow+1)},
      e("button",{type:"button",disabled:busy||nodeWindow===0,
        "data-drawio-candidate-node-prev":"true",
        onClick:()=>setNodeWindow(x=>Math.max(0,x-1))},"Previous positions"),
      e("button",{type:"button",disabled:busy||nodeStart+PAGE_SIZE>=positions.length,
        "data-drawio-candidate-node-next":"true",
        onClick:()=>setNodeWindow(x=>x+1)},"Next positions")),
    e("ol",{className:"validation-list"},
      ...visibleNodes.map(node=>{
        const key=keyOf(node),selected=!!nodes[key];
        return e("li",{key},
          e("label",null,e("input",{type:"checkbox",checked:selected,
            disabled:busy||sending||(!selected&&selectedCount>=MAX_SELECTED),
            "data-drawio-candidate-node":key,
            onChange:ev=>changeNode(node,ev.currentTarget.checked)}),
            " Page "+(node.pageOrdinal+1)+" · drawn vertex "+(node.vertexOrdinal+1)),
          e("select",{value:nodes[key]??"resource.generic",disabled:!selected||busy||sending,
            "data-drawio-candidate-role":key,
            onChange:ev=>changeRole(node,ev.currentTarget.value)},
            ...manualRoleOptions.map(type=>e("option",{key:type,value:type},type))));
      })),
    e("p",{"data-drawio-candidate-selected-nodes":String(selectedCount)},
      "Selected modeled resources: "+selectedCount+" / "+MAX_SELECTED),
    e("h4",null,"Optional individually modeled drawn edges"),
    e("nav",{"data-drawio-candidate-edge-window":String(edgeWindow+1)},
      e("button",{type:"button",disabled:busy||edgeWindow===0,
        "data-drawio-candidate-edge-prev":"true",
        onClick:()=>setEdgeWindow(x=>Math.max(0,x-1))},"Previous drawn edges"),
      e("button",{type:"button",disabled:busy||edgeStart+PAGE_SIZE>=graph.edges.length,
        "data-drawio-candidate-edge-next":"true",
        onClick:()=>setEdgeWindow(x=>x+1)},"Next drawn edges")),
    e("ol",{className:"validation-list"},
      ...visibleEdges.map(edge=>{
        const key=edgeKey(edge);
        const eligible=!!nodes[edge.pageOrdinal+":"+edge.sourceVertexOrdinal]&&
          !!nodes[edge.pageOrdinal+":"+edge.targetVertexOrdinal];
        return e("li",{key},e("label",null,
          e("input",{type:"checkbox",checked:!!edges[key],
            disabled:busy||sending||!eligible||(!edges[key]&&edgesCount>=MAX_SELECTED),
            "data-drawio-candidate-edge":key,
            onChange:ev=>changeEdge(edge,ev.currentTarget.checked)}),
          " Page "+(edge.pageOrdinal+1)+" · drawn edge "+(edge.edgeOrdinal+1)+
          " · between positions "+(edge.sourceVertexOrdinal+1)+" and "+
          (edge.targetVertexOrdinal+1)+" (NOT verified physical link)"));
      })),
    e("p",{"data-drawio-candidate-selected-edges":String(edgesCount)},
      "Individually selected modeled connections: "+edgesCount+" / "+MAX_SELECTED),
    e("label",null,e("input",{type:"checkbox",checked:ack,
      disabled:busy||sending||edgesCount===0,
      "data-drawio-candidate-edge-ack":"true",
      onChange:ev=>setAck(ev.currentTarget.checked)}),
      " I explicitly consent to model ONLY my chosen drawn edges as UNVERIFIED network connections."),
    error?e("p",{role:"alert","data-drawio-candidate-error":"BLOCKED"},error):null,
    e("button",{type:"button",disabled:!canCommit,
      "data-drawio-candidate-confirm":"true",
      onClick:()=>{void submit();}},
      busy||sending?"Validating original…":"Validate and create reviewed Builder draft"));
}
