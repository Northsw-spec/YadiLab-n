import React, { useState } from "react";

const e = React.createElement;

/**
 * Common UI never displays original inventory host aliases, addresses, group
 * paths, variables, raw source locators or credentials. Host ordinal is bound
 * to the original source SHA and checked again inside the export boundary.
 */
export function SharedAnsibleOrdinalReview({ result, model = null, onExport }) {
  const [ordinal, setOrdinal] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [ack, setAck] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [exported, setExported] = useState(false);
  const hostCount = result.summary.documentedHosts;
  const canSelect = Boolean(model && model.resources?.length && hostCount);
  const canExport = Boolean(canSelect && ordinal !== "" && resourceId &&
    model.resources.some(resource => resource.id === resourceId) &&
    Number.isSafeInteger(Number(ordinal)) && Number(ordinal) >= 0 &&
    Number(ordinal) < hostCount && ack && !submitting && typeof onExport === "function");
  const change = (state, value) => {
    state(value); setAck(false); setExported(false); setError("");
  };
  const submit = async () => {
    if (!canExport) return;
    setSubmitting(true); setError(""); setExported(false);
    try {
      await onExport({
        profileId: result.profileId,
        sourceSha256: result.sourceSha256,
        scenarioId: model.scenarioId,
        sourceRevision: model.sourceRevision,
        hostOrdinal: Number(ordinal),
        resourceId,
        acknowledgeNotVerified: true,
      });
      setExported(true);
    } catch (cause) {
      // No untrusted Error.message or source diagnostics are echoed to the DOM.
      setError(typeof cause?.code === "string" && /^IC010_P3B_[A-Z0-9_]+$/.test(cause.code)
        ? cause.code : "IC010_P3B_EXPORT_BLOCKED");
    } finally { setSubmitting(false); }
  };
  return e("section", {className:"network-import-preview",
    "data-ic010-p3b-review": canSelect ? "REVIEW_REQUIRED" : "BUILDER_REQUIRED"},
    e("h3",null,"Review one original source-host reference"),
    e("p",{"data-ic010-p3b-boundary":"true"},
      "One source ordinal can be associated with one existing Builder resource. This is a ",
      "manual, UNVERIFIED reference exported as separate JSON, not an asset match, ",
      "network link, model import, probe or Engine verification. No source host details are displayed."),
    !model
      ? e("p",{"data-ic010-p3b-builder-blocked":"true"},
        "A Builder workspace is required. Review is unavailable in Runtime.")
      : e("p",{"data-ic010-p3b-builder":"true"},
        "Current Builder source revision: ",String(model.sourceRevision),
        " · available resources: ",String(model.resources.length)),
    e("label",null,"Original source host (ordinal only): ",
      e("select",{value:ordinal,disabled:!canSelect||submitting,
        "data-ic010-p3b-host":"true",
        onChange:event=>change(setOrdinal,event.target.value)},
        e("option",{value:""},"Choose source ordinal (none by default)"),
        ...Array.from({length:Math.min(hostCount,500)},(_,i)=>
          e("option",{key:i,value:String(i)},"Source host #"+String(i+1))))),
    e("label",null,"Existing modeled Builder resource: ",
      e("select",{value:resourceId,disabled:!canSelect||submitting,
        "data-ic010-p3b-resource":"true",
        onChange:event=>change(setResourceId,event.target.value)},
        e("option",{value:""},"Do not associate (default)"),
        ...(model?.resources??[]).map(resource=>
          e("option",{key:resource.id,value:resource.id},
            String(resource.label)+" ["+String(resource.id)+"]")))),
    e("label",null,
      e("input",{type:"checkbox",checked:ack,
        disabled:!canSelect||ordinal===""||resourceId===""||submitting,
        "data-ic010-p3b-ack":"true",
        onChange:event=>{setAck(event.target.checked);setExported(false);setError("");}}),
      " I explicitly acknowledge that this ordinal-to-resource reference is NOT a verified asset identity."),
    e("button",{type:"button","data-ic010-p3b-export":"true",
      disabled:!canExport,onClick:()=>{void submit();}},
      submitting?"Revalidating original source and Builder…":"Export one reviewed reference (JSON)"),
    error?e("p",{role:"alert","data-ic010-p3b-error":"BLOCKED"},error):null,
    exported?e("p",{"data-ic010-p3b-exported":"true"},
      "One unverified reference sidecar exported; Builder and Engine unchanged."):null,
  );
}
