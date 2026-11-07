import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../schema/scenario-source.schema.json" with {type:"json"};
import normalized from "../../schema/scenario-normalized.schema.json" with {type:"json"};
import catalog from "../../catalog/builtin-catalog.json" with {type:"json"};
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import { previewNetworkTopologyFile, verifyNetworkTopologyOriginalForActivation }
  from "../../dist-browser-test/ui/src/browser/network-topology-import.js";
import { compileBuilderWorkspace, createBuilderWorkspace, previewRuntime }
  from "../../dist-browser-test/ui/src/browser/index.js";
import { buildRuntimeActiveProbeModel, runRuntimeActiveProbe }
  from "../../dist-browser-test/ui/src/browser/observations.js";
import { builtinEnterpriseImportAdapters } from "../../dist-browser-test/enterprise-import/src/adapters.js";

let assertions=0;
const eq=(a,b,why)=>{assert.deepEqual(a,b,why);assertions++;};
const yes=(v,why)=>{assert.ok(v,why);assertions++;};
const rejects=async(p,code)=>{await assert.rejects(p,e=>e?.code===code||e?.message===code,code);assertions++;};
const digest=b=>crypto.createHash("sha256").update(b).digest("hex");
const file=(name,data)=>({name,size:data.byteLength,async arrayBuffer(){
  return data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
}});
execFileSync("python3",["-c",
  "import ast,pathlib; ast.parse(pathlib.Path('tests/acceptance/run_ic020_p2c5_truth_real_browser.py').read_text(encoding='utf-8'))"],
  {stdio:["ignore","pipe","pipe"],timeout:8000});
assertions++;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ic020-p2c5-"));
try {
 execFileSync("python3",["tests/fixtures/import/generate_ic020_p2c5_network.py","--out-dir",dir],
   {stdio:["ignore","pipe","pipe"],timeout:15000});
 const sv=Ajv2020;
 const ajv=new sv({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
 const sc=ajv.compile(schema),ns=ajv.compile(normalized);
 const options={compilerContext:{
  validateSource:x=>({valid:!!sc(x),diagnostics:(sc.errors??[]).map(e=>e.message)}),
  validateNormalized:x=>({valid:!!ns(x),diagnostics:(ns.errors??[]).map(e=>e.message)}),
  catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
  engineBaselineVersion:ENGINE_VERSION,
 }};
 const actual={};
 for(const format of ["json","csv","tsv","xlsx","ods"]){
  const load=variant=>new Uint8Array(fs.readFileSync(path.join(dir,
    "ic020-p2c5-"+variant+"."+format)));
  const raw=load("valid");
  const input=file("consultant."+format,raw);
  const p=await previewNetworkTopologyFile(input);
  eq(p.ok,true,format+" valid flat Devices imports "+JSON.stringify(p.diagnostics));
  eq(p.sourceSha256,digest(raw),"Exact full original SHA "+format);
  eq(p.sourceByteSize,raw.byteLength,"Original bytes "+format);
  eq(p.devices,3,"Three declared nodes "+format);
  eq(p.links,2,"Two explicit declarations "+format);
  eq(p.source.resources.map(x=>x.id),["rtr01","win01","lin01"]);
  eq(p.source.connections.map(x=>[x.from.resource,x.to.resource]),
    [["win01","rtr01"],["lin01","rtr01"]],"No gateway/IP link inferred");
  const win=p.source.resources.find(x=>x.id==="win01");
  const lin=p.source.resources.find(x=>x.id==="lin01");
  eq(win.type,"endpoint.windows");
  eq(lin.type,"endpoint.linux");
  eq(win.interfaces?.[0]?.addresses,["10.9.10.10/24"]);
  eq(lin.interfaces?.[0]?.addresses,["10.9.30.10/24"]);
  await verifyNetworkTopologyOriginalForActivation(input,p,()=>true);
  const compiled=await compileBuilderWorkspace(createBuilderWorkspace(p.source),options);
  eq(compiled.compile.status,"valid","Actual imported Builder compile "+format);
  const runtime=previewRuntime(compiled);
  eq(runtime.ok,true,"Actual modeled Runtime "+format);
  const model=buildRuntimeActiveProbeModel(runtime.workspace);
  const before=JSON.stringify(runtime.workspace.engineState);
  for(const [host,system] of [["win01","windows"],["lin01","linux"]]){
   yes(model.sources.some(x=>x.id===host&&x.os===system),"OS explicitly mapped "+host);
   const ping=runRuntimeActiveProbe(runtime.workspace,{
     sourceId:host,probeId:system+".ping",destinationId:"rtr01",
   });
   eq(ping.ok,true,system+" Engine ping exists "+format);
   eq(ping.transcript.truth,"FALSE","Off-link and no modeled route returns FALSE "+format);
   eq(ping.transcript.modeled,true);
   eq(ping.transcript.boundary,"NO_GUEST_COMMAND_EXECUTION");
   eq(ping.transcript.scenarioHash,runtime.workspace.scenario.sourceHash);
   const dns=runRuntimeActiveProbe(runtime.workspace,{
     sourceId:host,probeId:system==="windows"?"windows.resolve_dnsname":"linux.dig",
     queryName:"app.lab.test",
   });
   eq(dns.ok,true,system+" modeled DNS exists "+format);
   eq(dns.transcript.truth,"UNKNOWN","Absent resolver is UNKNOWN, not FALSE/PASS "+format);
   eq(dns.transcript.boundary,"NO_GUEST_COMMAND_EXECUTION");
   eq(dns.transcript.scenarioHash,runtime.workspace.scenario.sourceHash);
  }
  eq(JSON.stringify(runtime.workspace.engineState),before,"Engine read-only probes "+format);
  actual[format]={source:p.source,sha:p.sourceSha256};
  for(const [variant,code] of [["address-conflict","NETWORK_IMPORT_ADDRESS_CONFLICT"],
     ["prefix-conflict","NETWORK_IMPORT_ADDRESS_CONFLICT"],
     ["alias-conflict","NETWORK_IMPORT_FIELD_AMBIGUOUS"],
     ["duplicate-device","NETWORK_IMPORT_DUPLICATE_DEVICE_ID"]]){
   const broken=load(variant);
   const result=await previewNetworkTopologyFile(file("invalid."+format,broken));
   eq(result.ok,false,variant+" MUST block "+format);
   eq(Boolean(result.source),false,"No active candidate for "+variant+" "+format);
   yes(result.diagnostics.some(x=>x.code===code&&x.severity==="error"),
     "Fixed diagnostic "+code+" "+format);
   yes(!JSON.stringify(result.diagnostics).includes("10.9.10.99"),
     "Confidential mismatched address not in diagnostics");
   await rejects(verifyNetworkTopologyOriginalForActivation(
     file("invalid."+format,broken),result,()=>true),"IC020_P1_SOURCE_CHANGED");
  }
  await rejects(verifyNetworkTopologyOriginalForActivation(input,p,()=>false),"IC020_P1_STALE");
  await rejects(verifyNetworkTopologyOriginalForActivation(
     file("consultant."+format,load("address-conflict")),p,()=>true),"IC020_P1_SOURCE_CHANGED");
 }
 eq(actual.json.source.resources,actual.csv.source.resources,"JSON and CSV same modeled identities");
 eq(actual.csv.source.connections,actual.tsv.source.connections);
 eq(actual.xlsx.source.resources,actual.ods.source.resources,"Independent Office producers same graph");
 yes(actual.xlsx.sha!==actual.ods.sha,"Original ZIP hashes producer-specific");
 eq(builtinEnterpriseImportAdapters.map(x=>x.id),
   ["builtin.json","builtin.csv","builtin.tsv","builtin.xlsx","builtin.ods"]);
 const source=fs.readFileSync("enterprise-import/src/network-inventory.ts","utf8");
 const main=fs.readFileSync("ui/app/main.mjs","utf8");
 yes(source.includes("NETWORK_IMPORT_ADDRESS_CONFLICT"));
 yes(main.includes("verifyNetworkTopologyOriginalForActivation(original, preview, isCurrent)"));
 yes(main.includes('data-network-import-runtime'));
 for(const w of [".github/workflows/required-ci.yml",".github/workflows/release-identity.yml"]){
  const v=fs.readFileSync(w,"utf8");
  yes(v.includes("npm run test:ic020-p2c5-truth"),"Required source gate in "+w);
  yes(v.includes("run_ic020_p2c5_truth_real_browser.py"),"Compiled Chromium in "+w);
 }
 console.log("PASS IC-020 P2c5 source-bound five-format address contradictions and imported FALSE/UNKNOWN modeled Engine: "+
   assertions+" independent assertions");
} finally {
 for(const x of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,x));
 fs.rmdirSync(dir);
}
