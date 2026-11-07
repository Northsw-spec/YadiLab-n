import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../schema/scenario-source.schema.json" with {type:"json"};
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with {type:"json"};
import catalog from "../../catalog/builtin-catalog.json" with {type:"json"};
import {ENGINE_VERSION} from "../../dist-browser-test/engine/src/index.js";
import {
  previewNetworkTopologyFile,
  verifyNetworkTopologyOriginalForActivation
} from "../../dist-browser-test/ui/src/browser/network-topology-import.js";
import {
  createBuilderWorkspace,compileBuilderWorkspace
} from "../../dist-browser-test/ui/src/browser/index.js";

/**
 * Frozen SCALE-001 P4a capacity oracle. Genuine deterministic 10,000 CSV
 * data rows, each with exactly one original Connected To declaration:
 * 10,000 synthetic nodes and 10,000 explicit edges form a ring.
 * This is NOT an imported Office source, a reviewed UI consent flow, an
 * Engine, physical cable, full ELK or mounted ReactFlow browser test.
 */
const enc=new TextEncoder(),N=10000;
const id=i=>i===0?"core0000":"host"+String(i).padStart(6,"0");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const sizeMiB=n=>Math.round(n/1048576*100)/100;
let assertions=0;
const eq=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);assertions++};
const yes=(condition,label)=>{assert.ok(condition,label);assertions++};
function csv(n){
  assert(Number.isSafeInteger(n)&&n>=3);
  const lines=["Asset ID,Hostname,Device Type,Connected To"];
  for(let i=0;i<n;i++){
    const target=i===0?id(n-1):id(i-1);
    lines.push([id(i),i===0?"Core Switch":"Device "+i,
      i===0?"Switch":"Windows",target].join(","));
  }
  return lines.join("\n")+"\n";
}
function sourceFile(bytes){
  let current=bytes,reads=0;
  return {
    file:{name:"synthetic-source-declared-10000-ring.csv",
      get size(){return current.byteLength;},
      async arrayBuffer(){reads++;return current.buffer.slice(
        current.byteOffset,current.byteOffset+current.byteLength);}},
    setBytes(next){current=next;},get reads(){return reads;}
  };
}
const ajv=new Ajv2020({strict:true,allErrors:true,allowUnionTypes:false,validateSchema:true});
const sourceCheck=ajv.compile(schema),modelCheck=ajv.compile(normalizedSchema);
const validate=fn=>obj=>({valid:!!fn(obj),diagnostics:(fn.errors??[]).map(e=>e.message)});
const options={compilerContext:{
  validateSource:validate(sourceCheck),validateNormalized:validate(modelCheck),
  catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},
  engineBaselineVersion:ENGINE_VERSION
}};
const t0=performance.now();
const bytes=enc.encode(csv(N)),file=sourceFile(bytes),sourceHash=sha(bytes);
let before=performance.now();
const preview=await previewNetworkTopologyFile(file.file);
const parseMs=performance.now()-before;
eq(preview.ok,true,"genuine source CSV imported successfully: "+JSON.stringify(preview.diagnostics.slice(0,4)));
eq(preview.devices,N,"exact original 10000 device rows");
eq(preview.links,N,"exact original 10000 declared Connected To values");
eq(preview.sourceByteSize,bytes.length,"exact original UTF-8 byte count");
eq(preview.sourceSha256,sourceHash,"whole original SHA-256");
yes(preview.source!==undefined,"source mapped but not activated");
const source=preview.source;
eq(source.resources.length,N,"all 10000 canonical resources");
eq(source.connections.length,N,"all 10000 distinct canonical connections");
eq(source.resources.map(x=>x.id),Array.from({length:N},(_,i)=>id(i)),
  "exact original ID and row order, no silent reindexing");
eq(new Set(source.resources.map(x=>x.id)).size,N,"no duplicate resource IDs");
eq(new Set(source.connections.map(x=>x.id)).size,N,"no collapsed link IDs");
eq(source.resources[0].type,"network.switch","declared original core role");
yes(source.resources.slice(1).every(x=>x.type==="endpoint.windows"),
  "declared Windows role preserved on every host");
const linksByFrom=new Map(source.connections.map(e=>[e.from.resource,e]));
eq(linksByFrom.size,N,"one distinct source link per declared source row");
for(let i=0;i<N;i++){
  const from=id(i),to=i===0?id(N-1):id(i-1),edge=linksByFrom.get(from);
  assert.ok(edge,"source row "+i+" has original explicit link");
  assert.equal(edge.from.resource,from,"source link "+i+" exact from ID");
  assert.equal(edge.to.resource,to,"source link "+i+" exact to ID");
  assert.ok(!edge.from.port&&!edge.to.port,"no invented port for row "+i);
}
assertions+=N*4;
eq(source.tests,[],"source declarations are not Engine tests");
eq(source.completion.path,"imported_topology_manual_verification",
  "source is explicitly unverified physical network");
yes(sourceCheck(source),"canonical source schema");
const frozen=JSON.stringify(source);

before=performance.now();
const workspace=createBuilderWorkspace(source);
const built=await compileBuilderWorkspace(workspace,options);
const compilerMs=performance.now()-before;
eq(built.compile.status,"valid",
  "actual production Builder compiler: "+JSON.stringify(built.compile.diagnostics?.slice(0,4)));
eq(built.source.resources.length,N,"full canonical Builder node count");
eq(built.source.connections.length,N,"full canonical Builder link count");
eq(built.compile.model.resources.length,N,"full normalized model node count");
eq(built.compile.model.connections.length,N,"full normalized model link count");
eq(built.compile.model.resources.map(x=>x.id),
  source.resources.map(x=>x.id),"exact compiler node identities/order");
eq(built.compile.model.connections.map(x=>x.id),
  source.connections.map(x=>x.id),"exact compiler edge IDs/order");
eq(built.compile.model.connections.map(x=>[
  x.from.resource,x.from.port??null,x.to.resource,x.to.port??null
]),source.connections.map(x=>[
  x.from.resource,x.from.port??null,x.to.resource,x.to.port??null
]),"every compiled endpoint and absent port matches source exactly");
eq(JSON.stringify(source),frozen,"input source unchanged by compiling");
eq(JSON.stringify(built.source),frozen,"whole editable Builder source unchanged");
eq(built.source.tests,[],"no fabricated Runtime tests");
yes(modelCheck(built.compile.model),"normalized model valid under production schema");

before=performance.now();
await verifyNetworkTopologyOriginalForActivation(file.file,preview,()=>true);
const rereadMs=performance.now()-before;
yes(file.reads>=2,"production verifier actually re-read original bytes");
eq(JSON.stringify(source),frozen,"source unchanged by verification");

// Deliberate negatives are smaller for budget reasons: they do NOT claim
// a 10k adversarial throughput measurement.
const negativeN=1000,negBytes=enc.encode(csv(negativeN));
const malformed=sourceFile(negBytes);
const badDup=csv(negativeN).replace("host000998,Device 998",
  "host000997,Device 998");
const duplicate=await previewNetworkTopologyFile(sourceFile(enc.encode(badDup)).file);
eq(duplicate.ok,false,"duplicate original source ID rejected");
yes(duplicate.diagnostics.some(d=>[
  "NETWORK_IMPORT_DUPLICATE_DEVICE_ID","WORKBOOK_DUPLICATE_NODE_ID"
].includes(d.code)),"duplicate diagnosed");
yes(!duplicate.source,"invalid duplicate does not activate canonical source");

const badTarget=csv(negativeN).replace(
  "host000998,Device 998,Windows,host000997",
  "host000998,Device 998,Windows,missing997");
const unknown=await previewNetworkTopologyFile(sourceFile(enc.encode(badTarget)).file);
eq(unknown.ok,false,"unknown original link target rejected");
yes(unknown.diagnostics.some(d=>d.code==="WORKBOOK_LINK_ENDPOINT_UNKNOWN"),
  "unknown endpoint diagnosed");
yes(!unknown.source,"invalid endpoint yields no activatable source");

const expected=await previewNetworkTopologyFile(malformed.file);
eq(expected.ok,true,"valid negative-control source");
const changedBytes=enc.encode(csv(negativeN).replace("Device 500","Device 501"));
eq(changedBytes.length,negBytes.length,"tampered bytes are exactly same size");
malformed.setBytes(changedBytes);
await assert.rejects(
  verifyNetworkTopologyOriginalForActivation(malformed.file,expected,()=>true),
  e=>e?.code==="IC020_P1_SOURCE_CHANGED",
  "same-size changed original must fail the SHA/source re-read gate");
assertions++;
await assert.rejects(
  verifyNetworkTopologyOriginalForActivation(file.file,preview,()=>false),
  e=>e?.code==="IC020_P1_STALE",
  "stale reviewer/workspace must fail before source activation");
assertions++;

const metric={
  gate:"10K_CSV_TO_BUILDER_SOURCE_BASELINE",result:"PASS",
  gitSha:process.env.GITHUB_SHA??"UNSPECIFIED_CI_SHA",
  nodeVersion:process.version,platform:process.platform,arch:process.arch,
  fixtureKind:"synthetic-original-CSV-explicit-ring-NOT-physical-topology",
  originalNodes:N,originalDeclaredLinks:N,originalBytes:bytes.length,
  originalSha256:sourceHash,
  parseMs:Math.round(parseMs),compilerMs:Math.round(compilerMs),
  rereadMs:Math.round(rereadMs),totalMs:Math.round(performance.now()-t0),
  rssMiB:sizeMiB(process.memoryUsage().rss),
  heapUsedMiB:sizeMiB(process.memoryUsage().heapUsed),
  assertions,sourceToBuilderVerified:true,
  mountedChromiumVerified:false,office10kVerified:false,
  engineVerified:false,physicalTopologyVerified:false,
  timingOrMemoryCertified:false
};
console.log("PASS SCALE-001 P4a 10000 original CSV resources / 10000 original CSV links "+
  "to production compiled Builder; no full graph layout/Runtime/Engine or physical truth");
console.log("SCALE001_P4A_MEASURED_METRICS_JSON "+JSON.stringify(metric));
