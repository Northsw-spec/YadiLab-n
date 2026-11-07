import React, { useEffect, useRef, useState } from "react";
const e=React.createElement;
const MAX=4;
const errCode=cause=>{
  const code=cause?.code;
  return typeof code==="string" && /^(?:IC040_|DOCX_|ODT_|IMPORT_)[A-Z0-9_]+$/.test(code)
    ? code : "IC040_P1B_BLOCKED";
};
const keyOf=n=>[n.tableOrdinal,n.rowOrdinal,n.nodeIdCellOrdinal].join(":");

/** Separate from P1-P6 read-only/reference panels: only original cell ordinals. */
export function OfficeReviewedBuilderPanel({inspectFile,onConfirm,onClose,manualRoleOptions=["resource.generic"]}){
  const [result,setResult]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const epoch=useRef(0),selectedFile=useRef(null),focus=useRef(null);
  const reset=()=>{
    epoch.current++;selectedFile.current=null;setResult(null);setError("");setBusy(false);
  };
  const close=()=>{reset();onClose();};
  useEffect(()=>{
    focus.current?.focus();
    return()=>{epoch.current++;selectedFile.current=null;};
  },[]);
  useEffect(()=>{
    const onKey=event=>{if(event.key==="Escape")close();};
    document.addEventListener("keydown",onKey);
    return()=>document.removeEventListener("keydown",onKey);
  },[onClose]);
  const choose=async file=>{
    reset();if(!file)return;
    const request=epoch.current;
    setBusy(true);
    try{
      const value=await inspectFile(file);
      if(epoch.current!==request)return;
      if(!value || !["docx","odt"].includes(value.format) ||
          value.preview?.status!=="REVIEW_REQUIRED" ||
          value.preview?.textIncluded!==false ||
          value.preview?.canActivate!==false ||
          value.preview?.engineVerified!==false ||
          value.preview?.physicalTopologyVerified!==false){
        setError("IC040_P1B_PREVIEW_INVALID");return;
      }
      selectedFile.current=file;setResult(value);
    }catch(cause){
      if(epoch.current===request)setError(errCode(cause));
    }finally{if(epoch.current===request)setBusy(false);}
  };
  return e("div",{className:"network-import-overlay","data-office-p1b-overlay":"true"},
    e("section",{className:"network-import-panel",role:"dialog","aria-modal":"true",
      tabIndex:-1,ref:focus,"aria-label":"Reviewed DOCX/ODT nodes into Builder",
      "data-office-p1b-panel":"REVIEW_REQUIRED"},
      e("div",{className:"network-import-heading"},
        e("div",null,e("h2",null,"Review DOCX/ODT nodes into Builder"),
          e("p",null,"Choose individual original table cells, not whole rows or documents. All modeled resources are unverified.")),
        e("button",{type:"button",onClick:close,"data-office-p1b-top-close":"true"},"Close")),
      e("label",{className:"file-button"},"Choose local .docx or .odt",
        e("input",{type:"file",accept:".docx,.odt",hidden:true,
          "data-office-p1b-file":"true",
          onClick:reset,onCancel:reset,
          onChange:event=>{
            const file=event.currentTarget.files?.[0]??null;
            event.currentTarget.value="";
            void choose(file);
          }})),
      error?e("p",{role:"alert","data-office-p1b-error":"BLOCKED"},error):null,
      result?e(OfficeReviewedNodeChoices,{
        key:result.preview.sourceSha256+":"+epoch.current,
        result,manualRoleOptions,busy,setBusy,setError,
        onConfirm:async decision=>{
          const request=epoch.current,original=selectedFile.current;
          const isCurrent=()=>epoch.current===request&&selectedFile.current===original;
          if(!original || !isCurrent() || typeof onConfirm!=="function"){
            const error=new Error("IC040_P1B_STALE");error.code="IC040_P1B_STALE";throw error;
          }
          return onConfirm(result,decision,original,isCurrent);
        }
      }):e("p",{"data-office-p1b-empty":"true"},"No original selected. Existing Builder and Engine unchanged."),
      e("div",{className:"network-import-actions"},
        e("button",{type:"button","data-office-p1b-cancel":"true",onClick:close},
          "Close without Builder changes"))));
}

/** Metadata-only choices; no original text or source filenames rendered. */
export function OfficeReviewedNodeChoices({
  result,manualRoleOptions=["resource.generic"],busy=false,
  setBusy=()=>{},setError=()=>{},onConfirm,
}){
  const [choice,setChoice]=useState(""),[nodes,setNodes]=useState([]),
        [peerChoice,setPeerChoice]=useState(""),[connections,setConnections]=useState([]),
        [connectionAck,setConnectionAck]=useState(false),
        [portLinkChoice,setPortLinkChoice]=useState(""),
        [sourcePortChoice,setSourcePortChoice]=useState(""),
        [peerPortChoice,setPeerPortChoice]=useState(""),
        [portSelections,setPortSelections]=useState([]),
        [portAck,setPortAck]=useState(false),
        [linkRowChoice,setLinkRowChoice]=useState(""),
        [linkFromChoice,setLinkFromChoice]=useState(""),
        [linkToChoice,setLinkToChoice]=useState(""),
        [linkSourcePortChoice,setLinkSourcePortChoice]=useState(""),
        [linkTargetPortChoice,setLinkTargetPortChoice]=useState(""),
        [linkRows,setLinkRows]=useState([]),
        [linkRowAck,setLinkRowAck]=useState(false),
        [capacityMode,setCapacityMode]=useState(false),
        [optionalPortsMode,setOptionalPortsMode]=useState(false),
        [parallelPortsMode,setParallelPortsMode]=useState(false),
        [eightBySevenMode,setEightBySevenMode]=useState(false),
        [tenByNineMode,setTenByNineMode]=useState(false),
        [twelveByElevenMode,setTwelveByElevenMode]=useState(false),
        [modeledAck,setModeledAck]=useState(false),[sending,setSending]=useState(false),
        [localError,setLocalError]=useState("");
  const nodeLimit=twelveByElevenMode?12:tenByNineMode?10:eightBySevenMode?8:capacityMode?6:MAX;
  const linkLimit=twelveByElevenMode?11:tenByNineMode?9:eightBySevenMode?7:capacityMode?5:MAX;
  const choices=[];
  for(const table of result.preview.tables.slice(0,4)){
    for(const row of table.rows.slice(1,21)){
      for(const cell of row.cells.slice(0,4)){
        choices.push({tableOrdinal:table.tableOrdinal,rowOrdinal:row.rowOrdinal,
          nodeIdCellOrdinal:cell.cellOrdinal});
      }
    }
  }
  const selectable=new Map(choices.map(n=>[keyOf(n),n]));
  const present=new Set(nodes.map(keyOf));
  const peerKey=v=>[v.fromNodeIndex,v.peerCellOrdinal].join(":");
  const peerOptions=nodes.flatMap((n,fromNodeIndex)=>
    (result.preview.tables[n.tableOrdinal]?.rows[n.rowOrdinal]?.cells??[])
      .slice(0,4).filter(cell=>cell.cellOrdinal!==n.nodeIdCellOrdinal)
      .map(cell=>({fromNodeIndex,peerCellOrdinal:cell.cellOrdinal})));
  const peerAvailable=new Map(peerOptions.map(x=>[peerKey(x),x]));
  const peerPresent=new Set(connections.map(peerKey));
  const portPresent=new Set(portSelections.map(v=>v.connectionIndex));
  const portCellsFor=index=>{
    const link=connections[index], node=link?nodes[link.fromNodeIndex]:null;
    return node ? (result.preview.tables[node.tableOrdinal]?.rows[node.rowOrdinal]?.cells??[])
      .slice(0,4).filter(cell=>cell.cellOrdinal!==node.nodeIdCellOrdinal &&
        cell.cellOrdinal!==link.peerCellOrdinal).map(cell=>cell.cellOrdinal) : [];
  };
  const availablePortCells=portLinkChoice===""?[]:portCellsFor(Number(portLinkChoice));
  const nodeTables=new Set(nodes.map(n=>n.tableOrdinal));
  const linkRowCandidates=result.preview.tables.slice(0,4)
    .filter(table=>!nodeTables.has(table.tableOrdinal))
    .flatMap(table=>table.rows.slice(1,21).filter(row=>row.cells.length>=2)
      .map(row=>({tableOrdinal:table.tableOrdinal,rowOrdinal:row.rowOrdinal})));
  const linkRowKey=row=>row.tableOrdinal+":"+row.rowOrdinal;
  const linkRowPresent=new Set(linkRows.map(linkRowKey));
  const selectedLinkRow=linkRowCandidates.find(x=>linkRowKey(x)===linkRowChoice);
  const selectedLinkCells=selectedLinkRow
    ?result.preview.tables[selectedLinkRow.tableOrdinal]
      ?.rows[selectedLinkRow.rowOrdinal]?.cells.slice(0,4).map(x=>x.cellOrdinal)??[]
    :[];
  const canSubmit=nodes.length>=1 && nodes.length<=nodeLimit &&
    (!capacityMode||(nodes.length===(twelveByElevenMode?12:tenByNineMode?10:eightBySevenMode?8:6) &&
      linkRows.length===(twelveByElevenMode?11:tenByNineMode?9:eightBySevenMode?7:5) &&
      connections.length===0 && portSelections.length===0 &&
      (optionalPortsMode || linkRows.every(v=>v.sourcePortCellOrdinal!==null &&
        v.targetPortCellOrdinal!==null &&
        v.acknowledgeSourcePortCell===true && v.acknowledgeTargetPortCell===true)))) &&
    nodes.every(n=>n.acknowledgeCell===true)&&modeledAck&&
    connections.every(c=>c.acknowledgePeerCell===true)&&
    (connections.length===0||connectionAck)&&
    (portSelections.length===0 || (portSelections.length===connections.length &&
      portSelections.every(v=>v.acknowledgeSourcePortCell===true &&
        v.acknowledgePeerPortCell===true) && portAck)) &&
    (linkRows.length===0 || (connections.length===0 && linkRowAck &&
      linkRows.every(v=>v.acknowledgeFromCell===true &&
        v.acknowledgeToCell===true &&
        (v.sourcePortCellOrdinal===null ||
          (v.acknowledgeSourcePortCell===true && v.acknowledgeTargetPortCell===true))))) &&
    !busy&&!sending&&typeof onConfirm==="function";
  const clear=()=>{
    setModeledAck(false);setConnectionAck(false);setPortAck(false);setLinkRowAck(false);
    setLocalError("");setError("");
  };
  const add=()=>{
    const available=selectable.get(choice);
    if(!available || present.has(choice) || nodes.length>=nodeLimit){
      setLocalError("IC040_P1B_NODE_DECISION_INVALID");return;
    }
    setNodes(prev=>[...prev,{...available,role:"resource.generic",acknowledgeCell:false}]);
    setLinkRows([]);setLinkRowChoice("");
    setChoice("");clear();
  };
  const edit=(key,patch)=>{
    setNodes(prev=>prev.map(n=>keyOf(n)===key?{...n,...patch}:n));
    setLinkRows([]);setLinkRowChoice("");clear();
  };
  const remove=key=>{
    setNodes(prev=>prev.filter(n=>keyOf(n)!==key));
    // Link source is a selected node INDEX. Never preserve stale indices after
    // node removal/reordering; require a fresh explicit peer review.
    setConnections([]);setPeerChoice("");setPortSelections([]);setPortLinkChoice("");
    setLinkRows([]);setLinkRowChoice("");
    setSourcePortChoice("");setPeerPortChoice("");clear();
  };
  const addConnection=()=>{
    const selected=peerAvailable.get(peerChoice);
    if(!selected||peerPresent.has(peerChoice)||connections.length>=MAX||linkRows.length||capacityMode){
      setLocalError("IC040_P2_LINK_DECISION_INVALID");return;
    }
    setConnections(prev=>[...prev,{...selected,acknowledgePeerCell:false}]);
    setPortSelections([]);setPortLinkChoice("");
    setSourcePortChoice("");setPeerPortChoice("");setPeerChoice("");clear();
  };
  const editConnection=(key,checked)=>{
    setConnections(prev=>prev.map(x=>peerKey(x)===key
      ?{...x,acknowledgePeerCell:checked}:x));
    clear();
  };
  const removeConnection=key=>{
    setConnections(prev=>prev.filter(x=>peerKey(x)!==key));
    setPortSelections([]);setPortLinkChoice("");
    setSourcePortChoice("");setPeerPortChoice("");clear();
  };
  const addPortPair=()=>{
    const index=Number(portLinkChoice),from=Number(sourcePortChoice),to=Number(peerPortChoice);
    if(portLinkChoice===""||sourcePortChoice===""||peerPortChoice===""||
      !Number.isSafeInteger(index)||index<0||index>=connections.length||
      portPresent.has(index)||from===to||!portCellsFor(index).includes(from)||
      !portCellsFor(index).includes(to)||portSelections.length>=MAX){
      setLocalError("IC040_P3_PORT_DECISION_INVALID");return;
    }
    setPortSelections(prev=>[...prev,{
      connectionIndex:index,sourcePortCellOrdinal:from,peerPortCellOrdinal:to,
      acknowledgeSourcePortCell:false,acknowledgePeerPortCell:false,
    }]);
    setPortLinkChoice("");setSourcePortChoice("");setPeerPortChoice("");clear();
  };
  const setPortCellConsent=(index,patch)=>{
    setPortSelections(prev=>prev.map(v=>v.connectionIndex===index?{...v,...patch}:v));
    clear();
  };
  const removePortPair=index=>{
    setPortSelections(prev=>prev.filter(v=>v.connectionIndex!==index));clear();
  };
  const addLinkRow=()=>{
    const row=selectedLinkRow;
    const from=Number(linkFromChoice),to=Number(linkToChoice);
    const portA=linkSourcePortChoice===""?null:Number(linkSourcePortChoice);
    const portB=linkTargetPortChoice===""?null:Number(linkTargetPortChoice);
    const columns=[from,to,...(portA===null?[]:[portA]),...(portB===null?[]:[portB])];
    if(!row||linkRows.length>=linkLimit||connections.length>0||
      (capacityMode&&!optionalPortsMode&&(portA===null||portB===null))||
      linkFromChoice===""||linkToChoice===""||
      !selectedLinkCells.includes(from)||!selectedLinkCells.includes(to)||
      (portA===null)!==(portB===null)||
      (portA!==null&&(!selectedLinkCells.includes(portA)||!selectedLinkCells.includes(portB)))||
      new Set(columns).size!==columns.length||linkRowPresent.has(linkRowChoice)){
      setLocalError("IC040_P4_LINK_DECISION_INVALID");return;
    }
    setLinkRows(prev=>[...prev,{...row,fromCellOrdinal:from,toCellOrdinal:to,
      sourcePortCellOrdinal:portA,targetPortCellOrdinal:portB,
      acknowledgeFromCell:false,acknowledgeToCell:false,
      acknowledgeSourcePortCell:false,acknowledgeTargetPortCell:false}]);
    setLinkRowChoice("");setLinkFromChoice("");setLinkToChoice("");
    setLinkSourcePortChoice("");setLinkTargetPortChoice("");clear();
  };
  const editLinkRow=(key,patch)=>{
    setLinkRows(prev=>prev.map(x=>linkRowKey(x)===key?{...x,...patch}:x));clear();
  };
  const removeLinkRow=key=>{setLinkRows(prev=>prev.filter(x=>linkRowKey(x)!==key));clear();};
  const changeCapacityMode=(checked,permitPortless=false,permitParallel=false,permitEight=false,permitTen=false,permitTwelve=false)=>{
    if(busy||sending)return;
    setCapacityMode(checked);
    setOptionalPortsMode(checked&&permitPortless);
    setParallelPortsMode(checked&&permitParallel);
    setEightBySevenMode(checked&&permitEight);
    setTenByNineMode(checked&&permitTen);
    setTwelveByElevenMode(checked&&permitTwelve);
    // Changing profile must discard ALL prior cell/role/peer/port consents:
    // ordinal limits and the decision shape have changed.
    setNodes([]);setConnections([]);setLinkRows([]);setPortSelections([]);
    setChoice("");setPeerChoice("");setPortLinkChoice("");
    setSourcePortChoice("");setPeerPortChoice("");
    setLinkRowChoice("");setLinkFromChoice("");setLinkToChoice("");
    setLinkSourcePortChoice("");setLinkTargetPortChoice("");
    clear();
  };
  const submit=async()=>{
    if(!canSubmit)return;
    setSending(true);setBusy(true);setError("");setLocalError("");
    const decision={format:result.format,sourceSha256:result.preview.sourceSha256,
      nodes:nodes.map(n=>({...n})),acknowledgeModeledResources:modeledAck};
    // P4 separate-table decisions intentionally exclude the P2/P3 link keys.
    if(linkRows.length){
      decision.linkRows=linkRows.map(x=>({...x}));
      decision.acknowledgeModeledLinkRows=linkRowAck;
      if(capacityMode){
        decision.capacityProfile=twelveByElevenMode
          ?"office.reviewed-network-tables.twelve-by-eleven-parallel-port-links.v1"
          :tenByNineMode
          ?"office.reviewed-network-tables.ten-by-nine-parallel-port-links.v1"
          :eightBySevenMode
          ?"office.reviewed-network-tables.eight-by-seven-parallel-port-links.v1"
          :parallelPortsMode
          ?"office.reviewed-network-tables.six-by-five-parallel-port-links.v1"
          :optionalPortsMode
          ?"office.reviewed-network-tables.six-by-five-optional-ports.v1"
          :"office.reviewed-network-tables.six-by-five.v1";
      }
    }
    // Keep P1a/P1b/P2/P3 exact legacy shapes when P4 is not selected.
    if(connections.length){
      decision.connections=connections.map(x=>({...x}));
      decision.acknowledgeModeledConnections=connectionAck;
      if(portSelections.length){
        decision.portSelections=portSelections.map(x=>({...x}));
        decision.acknowledgeModeledPorts=portAck;
      }
    }
    try{await onConfirm(decision);}
    catch(cause){setLocalError(errCode(cause));}
    finally{setBusy(false);setSending(false);}
  };
  return e("section",{className:"network-import-preview","data-office-p1b-controls":"REVIEW_REQUIRED"},
    e("h3",null,result.format.toUpperCase()+" — original table cell review"),
    e("p",{"data-office-p1b-source-sha":"true"},result.preview.sourceSha256),
    e("p",{"data-office-p1b-counts":"true"},
      "Tables: "+result.preview.tables.length+" · structural cells: "+result.preview.totalCells),
    e("p",{"data-office-p1b-truth-boundary":"true"},
      "Only first four tables, first 20 non-header rows and first four cells per row can be selected. Only individually acknowledged peer cells and optional separately reviewed port cells may become modeled links/interface references; no unselected source text, OS, IP, physical cabling, Runtime or Engine PASS is inferred."),
    e("section",{"data-office-p5-capacity":"REVIEW_REQUIRED"},
      e("label",null,e("input",{type:"checkbox",
        "data-office-p5-capacity-toggle":"true",checked:capacityMode&&!optionalPortsMode&&!parallelPortsMode,
        disabled:busy||sending,onChange:event=>changeCapacityMode(event.currentTarget.checked,false)}),
        " Enable separately reviewed P5: exactly 6 original device IDs and "+
        "5 port-annotated Links-table rows (not P1b/P2/P3/P4)."),
      e("p",{"data-office-p5-capacity-boundary":"UNVERIFIED"},
        "P5 requires SIX individually approved original node-ID cells "+
        "and FIVE independently reviewed two-endpoint Links-table rows, "+
        "each with separately approved local and remote port cells. "+
        "Changing profile clears all earlier selections and consents. "+
        "No physical cables, inferred connectivity or Engine PASS.")),
    e("section",{"data-office-p6-capacity":"REVIEW_REQUIRED"},
      e("label",null,e("input",{type:"checkbox",
        "data-office-p6-capacity-toggle":"true",checked:capacityMode&&optionalPortsMode&&!parallelPortsMode,
        disabled:busy||sending,onChange:event=>changeCapacityMode(event.currentTarget.checked,true)}),
        " Enable separately reviewed P6: exactly 6 devices and 5 Links rows "+
        "with independently approved port pairs OR no port evidence per row."),
      e("p",{"data-office-p6-capacity-boundary":"UNVERIFIED"},
        "P6 permits portless original Links rows only when both port cells are unselected. "+
        "Approved port pairs remain exact and individually consented. "+
        "A portless link never invents either port or physical cable. "+
        "Changing P4/P5/P6/P7 profile clears ALL previous choices and approvals.")),
    e("section",{"data-office-p7-capacity":"REVIEW_REQUIRED"},
      e("label",null,e("input",{type:"checkbox",
        "data-office-p7-capacity-toggle":"true",checked:capacityMode&&parallelPortsMode&&!eightBySevenMode&&!tenByNineMode&&!twelveByElevenMode,
        disabled:busy||sending,onChange:event=>changeCapacityMode(event.currentTarget.checked,false,true)}),
        " Enable reviewed P7: six devices, five original Links rows and "+
        "distinct port-annotated parallel links between the same two devices."),
      e("p",{"data-office-p7-capacity-boundary":"UNVERIFIED"},
        "Every P7 link requires its own two individually approved source port cells. "+
        "Same two devices may appear on multiple rows ONLY with non-reused ports "+
        "on BOTH ends. Duplicate or reversed-identical ports BLOCK. "+
        "No physical cabling or Engine PASS; changing profile clears all consents.")),
    e("section",{"data-office-p8-capacity":"REVIEW_REQUIRED"},
      e("label",null,e("input",{type:"checkbox",
        "data-office-p8-capacity-toggle":"true",checked:capacityMode&&eightBySevenMode,
        disabled:busy||sending,
        onChange:event=>changeCapacityMode(event.currentTarget.checked,false,true,true)}),
        " Enable reviewed P8: exactly 8 original device IDs and 7 separate Links rows "+
        "with both source-approved endpoint port cells on EVERY row. "+
        "Multiple port-distinct links between the same two devices are permitted."),
      e("p",{"data-office-p8-capacity-boundary":"UNVERIFIED"},
        "P8 is an explicit separate topology capacity, not an inference engine. "+
        "All eight original node ID cells, seven original Links rows and fourteen "+
        "port cells require independent operator approval. Reused ports and "+
        "reversed duplicate port pairs BLOCK. Changing profile clears all prior "+
        "selections and approvals. No physical cable or Engine PASS is asserted.")),
    e("section",{"data-office-p9-capacity":"REVIEW_REQUIRED"},
      e("label",null,e("input",{type:"checkbox",
        "data-office-p9-capacity-toggle":"true",checked:capacityMode&&tenByNineMode,
        disabled:busy||sending,
        onChange:event=>changeCapacityMode(event.currentTarget.checked,false,true,false,true)}),
        " Enable reviewed P9: exactly 10 original device-ID cells and 9 separate Links rows "+
        "with individually approved source and target port cells on EVERY row."),
      e("p",{"data-office-p9-capacity-boundary":"UNVERIFIED"},
        "P9 expands only the documented table capacity. Ten original node IDs, nine "+
        "independently selected Links rows and eighteen port cells need separate "+
        "approval. Same-device parallel links require distinct non-reused port pairs. "+
        "Switching any profile clears ALL previous choices and acknowledgments. "+
        "No inferred physical cable, subnet-derived links, or Engine PASS.")),
    e("section",{"data-office-p10-capacity":"REVIEW_REQUIRED"},
      e("label",null,e("input",{type:"checkbox",
        "data-office-p10-capacity-toggle":"true",checked:capacityMode&&twelveByElevenMode,
        disabled:busy||sending,
        onChange:event=>changeCapacityMode(event.currentTarget.checked,false,true,false,false,true)}),
        " Enable reviewed P10: exactly 12 original device-ID cells and 11 separate Links rows "+
        "with BOTH original source and target port cells individually approved on EVERY row."),
      e("p",{"data-office-p10-capacity-boundary":"UNVERIFIED"},
        "P10 is a separate versioned source-table capacity. Twelve individually "+
        "approved original device IDs, eleven original Links rows and twenty-two original "+
        "port cells require explicit operator consent. Port-distinct parallel links "+
        "may coexist; reused or reversed duplicate port pairs BLOCK. Switching the "+
        "profile resets ALL old P4-P9 selections and approvals. No invented links, "+
        "physical cable verification or Engine/Runtime PASS.")),
    e("label",null,"Original cell position (never the header)",
      e("select",{value:choice,disabled:busy||sending,
        "data-office-p1b-cell-ordinal":"true",onChange:event=>{
          setChoice(event.currentTarget.value);clear();
        }},
        e("option",{value:""},"Choose an original cell…"),
        ...choices.map(n=>e("option",{key:keyOf(n),value:keyOf(n)},
          "Table "+(n.tableOrdinal+1)+" · row "+(n.rowOrdinal+1)+
          " · cell "+(n.nodeIdCellOrdinal+1))))),
    e("button",{type:"button",disabled:!choice||present.has(choice)||nodes.length>=nodeLimit||busy||sending,
      "data-office-p1b-add":"true",onClick:add},"Add cell for individual consent"),
    e("p",{"data-office-p1b-selected-count":String(nodes.length)},
      "Cells selected: "+nodes.length+" / "+nodeLimit+"; no unselected cell may become a node."),
    e("ol",{className:"validation-list"},...nodes.map(n=>{
      const key=keyOf(n);
      return e("li",{key,"data-office-p1b-selection":key},
        e("span",null,"Table "+(n.tableOrdinal+1)+" · row "+(n.rowOrdinal+1)+" · cell "+(n.nodeIdCellOrdinal+1)+" (not yet verified) "),
        e("label",null,"Operator-assigned modeled role ",
          e("select",{value:n.role,disabled:busy||sending,
            "data-office-p1b-role":key,
            onChange:event=>edit(key,{role:event.currentTarget.value,acknowledgeCell:false})},
            ...manualRoleOptions.map(role=>e("option",{key:role,value:role},role)))),
        e("label",null,e("input",{type:"checkbox",checked:n.acknowledgeCell,
          disabled:busy||sending,"data-office-p1b-cell-ack":key,
          onChange:event=>edit(key,{acknowledgeCell:event.currentTarget.checked})}),
          " I independently authorize use of ONLY this selected original cell as an unverified modeled node ID."),
        e("button",{type:"button",disabled:busy||sending,
          "data-office-p1b-remove":key,onClick:()=>remove(key)},"Remove"));
    })),
    e("h4",{"data-office-p2-title":"REVIEW_REQUIRED"},
      "Optional individually reviewed original peer cells"),
    e("p",{"data-office-p2-boundary":"UNVERIFIED"},
      "Choose a peer cell from an individually selected node's SAME original row. "+
      "It must contain another selected node ID, or import BLOCKS. At most four connections; "+
      "no port, cable, interface, physical verification or network PASS inferred."),
    e("label",null,"Original row's peer cell position",
      e("select",{value:peerChoice,disabled:busy||sending||nodes.length<2||linkRows.length>0||capacityMode,
        "data-office-p2-peer-choice":"true",
        onChange:event=>{setPeerChoice(event.currentTarget.value);clear();}},
        e("option",{value:""},"Choose explicitly documented peer cell…"),
        ...peerOptions.map(x=>e("option",{key:peerKey(x),value:peerKey(x)},
          "Selected node "+(x.fromNodeIndex+1)+" · original peer cell "+(x.peerCellOrdinal+1))))),
    e("button",{type:"button",disabled:!peerChoice||peerPresent.has(peerChoice)||
      connections.length>=MAX||busy||sending,
      "data-office-p2-add":"true",onClick:addConnection},
      "Review this explicitly declared peer cell"),
    e("p",{"data-office-p2-selected-count":String(connections.length)},
      "Reviewed peer cells: "+connections.length+" / "+MAX+"; only exact selected node IDs can be endpoints."),
    e("ol",{className:"validation-list"},...connections.map(link=>{
      const key=peerKey(link);
      return e("li",{key,"data-office-p2-selection":key},
        e("span",null,"Selected node "+(link.fromNodeIndex+1)+
          " · same row, original peer cell "+(link.peerCellOrdinal+1)+" "),
        e("label",null,e("input",{type:"checkbox",checked:link.acknowledgePeerCell,
          disabled:busy||sending,"data-office-p2-peer-ack":key,
          onChange:event=>editConnection(key,event.currentTarget.checked)}),
          " I authorize disclosure of ONLY this original cell to map its exact peer ID."),
        e("button",{type:"button",disabled:busy||sending,
          "data-office-p2-remove":key,onClick:()=>removeConnection(key)},"Remove"));
    })),
    e("label",null,e("input",{type:"checkbox",checked:connectionAck,
      disabled:busy||sending||connections.length===0,
      "data-office-p2-modeled-ack":"true",
      onChange:event=>{setConnectionAck(event.currentTarget.checked);setLocalError("");}}),
      " I explicitly approve ONLY these source-declared peer references as UNVERIFIED modeled Builder connections."),
    e("section",{"data-office-p3-ports":"REVIEW_REQUIRED"},
      e("h4",{"data-office-p3-title":"REVIEW_REQUIRED"},
        "Optional exact original interface and port pairs"),
      e("p",{"data-office-p3-boundary":"UNVERIFIED"},
        "Choose both local and remote port cells from the SAME original row "+
        "as a separately reviewed peer link. Each port is individually consented. "+
        "In this bounded profile, all selected links require both ports when "+
        "the port option is used. A reused interface or uncertain evidence BLOCKS. "+
        "These are modeled interfaces, not physically verified cables."),
      e("label",null,"Reviewed link to annotate",
        e("select",{value:portLinkChoice,disabled:busy||sending||connections.length===0,
          "data-office-p3-link-choice":"true",
          onChange:event=>{setPortLinkChoice(event.currentTarget.value);
            setSourcePortChoice("");setPeerPortChoice("");clear();}},
          e("option",{value:""},"Choose reviewed link…"),
          ...connections.map((link,index)=>e("option",{key:index,value:String(index)},
            "Reviewed link "+(index+1)+" · source node "+(link.fromNodeIndex+1))))),
      e("label",null,"Local/source interface cell",
        e("select",{value:sourcePortChoice,disabled:busy||sending||portLinkChoice==="",
          "data-office-p3-source-choice":"true",
          onChange:event=>{setSourcePortChoice(event.currentTarget.value);clear();}},
          e("option",{value:""},"Choose local port cell…"),
          ...availablePortCells.map(x=>e("option",{key:x,value:String(x)},
            "Original cell "+(x+1))))),
      e("label",null,"Remote/peer interface cell",
        e("select",{value:peerPortChoice,disabled:busy||sending||portLinkChoice==="",
          "data-office-p3-peer-choice":"true",
          onChange:event=>{setPeerPortChoice(event.currentTarget.value);clear();}},
          e("option",{value:""},"Choose peer port cell…"),
          ...availablePortCells.map(x=>e("option",{key:x,value:String(x)},
            "Original cell "+(x+1))))),
      e("button",{type:"button",disabled:busy||sending||portLinkChoice===""||
        sourcePortChoice===""||peerPortChoice===""||
        sourcePortChoice===peerPortChoice||
        portPresent.has(Number(portLinkChoice))||portSelections.length>=MAX,
        "data-office-p3-add":"true",onClick:addPortPair},
        "Review exact local and remote port pair"),
      e("p",{"data-office-p3-selected-count":String(portSelections.length)},
        "Port pairs selected: "+portSelections.length+" / "+connections.length),
      e("ol",{className:"validation-list"},...portSelections.map(selection=>
        e("li",{key:selection.connectionIndex,
          "data-office-p3-selection":String(selection.connectionIndex)},
          e("span",null,"Link "+(selection.connectionIndex+1)+
            " · local cell "+(selection.sourcePortCellOrdinal+1)+
            " · remote cell "+(selection.peerPortCellOrdinal+1)),
          e("label",null,e("input",{type:"checkbox",
            checked:selection.acknowledgeSourcePortCell,disabled:busy||sending,
            "data-office-p3-source-ack":String(selection.connectionIndex),
            onChange:event=>setPortCellConsent(selection.connectionIndex,
              {acknowledgeSourcePortCell:event.currentTarget.checked})}),
            " I authorize this selected local interface cell."),
          e("label",null,e("input",{type:"checkbox",
            checked:selection.acknowledgePeerPortCell,disabled:busy||sending,
            "data-office-p3-peer-ack":String(selection.connectionIndex),
            onChange:event=>setPortCellConsent(selection.connectionIndex,
              {acknowledgePeerPortCell:event.currentTarget.checked})}),
            " I authorize this selected remote interface cell."),
          e("button",{type:"button",disabled:busy||sending,
            "data-office-p3-remove":String(selection.connectionIndex),
            onClick:()=>removePortPair(selection.connectionIndex)},
            "Remove port pair")))),
      e("label",null,e("input",{type:"checkbox",checked:portAck,
        disabled:busy||sending||portSelections.length===0,
        "data-office-p3-modeled-ack":"true",
        onChange:event=>{setPortAck(event.currentTarget.checked);setLocalError("");}}),
        " I independently approve these original source interface IDs "+
        "as UNVERIFIED modeled Builder ports; they do not verify physical cables.")),
    e("section",{"data-office-p4-link-rows":"REVIEW_REQUIRED"},
      e("h4",{"data-office-p4-title":"REVIEW_REQUIRED"},
        "Optional separately reviewed Links-table rows"),
      e("p",{"data-office-p4-boundary":"UNVERIFIED"},
        "Choose an original row from a table DIFFERENT from the selected "+
        "device-ID table. Independently authorize the FROM and TO cells; "+
        "both must contain already selected device IDs. Optional local and "+
        "remote port cells must be selected together and approved separately. "+
        "Multiple rows may share a switch with DISTINCT reviewed ports. P4 is max four; "+
        "P5/P6/P7 support five; P8 seven; P9 nine; explicit P10 eleven Links rows. "+
        "No inferred cables, no Runtime or Engine PASS. "+
        "Use either this separate-row profile or the earlier P2/P3 same-row profile."),
      e("label",null,"Original separate link row",
        e("select",{value:linkRowChoice,disabled:busy||sending||connections.length>0||
          nodes.length<2,"data-office-p4-row-choice":"true",
          onChange:event=>{setLinkRowChoice(event.currentTarget.value);
            setLinkFromChoice("");setLinkToChoice("");setLinkSourcePortChoice("");
            setLinkTargetPortChoice("");clear();}},
          e("option",{value:""},"Choose a separate original link row…"),
          ...linkRowCandidates.map(row=>e("option",{key:linkRowKey(row),value:linkRowKey(row)},
            "Table "+(row.tableOrdinal+1)+" · row "+(row.rowOrdinal+1))))),
      ...[
        ["Source device ID cell",linkFromChoice,setLinkFromChoice,"data-office-p4-from-choice"],
        ["Target device ID cell",linkToChoice,setLinkToChoice,"data-office-p4-to-choice"],
        ["Optional source port cell",linkSourcePortChoice,setLinkSourcePortChoice,"data-office-p4-source-port-choice"],
        ["Optional target port cell",linkTargetPortChoice,setLinkTargetPortChoice,"data-office-p4-target-port-choice"],
      ].map(([label,value,setValue,attribute])=>e("label",{key:attribute},label,
        e("select",{value,disabled:busy||sending||!selectedLinkRow,
          [attribute]:"true",onChange:event=>{setValue(event.currentTarget.value);clear();}},
          e("option",{value:""},"No cell selected"),
          ...selectedLinkCells.map(index=>e("option",{key:index,value:String(index)},
            "Original cell "+(index+1)))))),
      e("button",{type:"button",disabled:busy||sending||!selectedLinkRow||
        connections.length>0||linkRows.length>=linkLimit||linkRowPresent.has(linkRowChoice)||
        (capacityMode&&!optionalPortsMode&&
          (linkSourcePortChoice===""||linkTargetPortChoice===""))||
        linkFromChoice===""||linkToChoice===""||linkFromChoice===linkToChoice||
        (linkSourcePortChoice==="")!==(linkTargetPortChoice===""),
        "data-office-p4-add":"true",onClick:addLinkRow},
        "Review both endpoints of this original Links row"),
      e("p",{"data-office-p4-count":String(linkRows.length)},
        "Individually selected Links rows: "+linkRows.length+" / "+linkLimit),
      e("ol",{className:"validation-list"},...linkRows.map(link=>{
        const k=linkRowKey(link),portPair=link.sourcePortCellOrdinal!==null;
        return e("li",{key:k,"data-office-p4-selection":k},
          e("span",null,"Table "+(link.tableOrdinal+1)+" · row "+(link.rowOrdinal+1)+
            " · endpoints cells "+(link.fromCellOrdinal+1)+"/"+(link.toCellOrdinal+1)+
            (portPair?" · ports "+(link.sourcePortCellOrdinal+1)+"/"+
              (link.targetPortCellOrdinal+1):" · no source ports claimed")),
          ...[
            ["acknowledgeFromCell","I independently approve this source device ID.","data-office-p4-from-ack"],
            ["acknowledgeToCell","I independently approve this target device ID.","data-office-p4-to-ack"],
            ...(portPair?[
              ["acknowledgeSourcePortCell","I independently approve this local port.","data-office-p4-source-port-ack"],
              ["acknowledgeTargetPortCell","I independently approve this remote port.","data-office-p4-target-port-ack"],
            ]:[]),
          ].map(([flag,label,attribute])=>e("label",{key:flag},
            e("input",{type:"checkbox",checked:link[flag],disabled:busy||sending,
              [attribute]:k,onChange:event=>editLinkRow(k,{[flag]:event.currentTarget.checked})}),
            label)),
          e("button",{type:"button",disabled:busy||sending,
            "data-office-p4-remove":k,onClick:()=>removeLinkRow(k)},
            "Remove separate link row"));
      })),
      e("label",null,e("input",{type:"checkbox",checked:linkRowAck,
        disabled:busy||sending||linkRows.length===0,
        "data-office-p4-modeled-ack":"true",
        onChange:event=>{setLinkRowAck(event.currentTarget.checked);setLocalError("");}}),
        " I separately approve ONLY these original two-endpoint Links rows "+
        "as UNVERIFIED modeled Builder connections, not physical cables.")),
    e("label",null,e("input",{type:"checkbox",checked:modeledAck,
      disabled:busy||sending||nodes.length===0,"data-office-p1b-modeled-ack":"true",
      onChange:event=>{setModeledAck(event.currentTarget.checked);setLocalError("");}}),
      " I separately acknowledge these are only MODELED Builder resources, not observed machines or proven physical network connectivity."),
    localError?e("p",{role:"alert","data-office-p1b-error":"BLOCKED"},localError):null,
    e("button",{type:"button",disabled:!canSubmit,"data-office-p1b-confirm":"true",
      onClick:()=>{void submit();}},busy||sending?"Rechecking original…":"Validate original and create reviewed Builder draft"));
}
