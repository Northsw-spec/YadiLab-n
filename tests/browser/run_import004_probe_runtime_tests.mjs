import assert from "node:assert/strict";
import fs from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import sourceSchema from "../../schema/scenario-source.schema.json" with { type: "json" };
import normalizedSchema from "../../schema/scenario-normalized.schema.json" with { type: "json" };
import catalog from "../../catalog/builtin-catalog.json" with { type: "json" };
import { ENGINE_VERSION } from "../../dist-browser-test/engine/src/index.js";
import { previewNetworkTopologyFile } from "../../dist-browser-test/ui/src/browser/network-topology-import.js";
import { compileBuilderWorkspace, createBuilderWorkspace, previewRuntime } from "../../dist-browser-test/ui/src/browser/index.js";
import { buildRuntimeActiveProbeModel, runRuntimeActiveProbe } from "../../dist-browser-test/ui/src/browser/observations.js";
const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: false, validateSchema: true });
const srcValidate = ajv.compile(sourceSchema), normValidate = ajv.compile(normalizedSchema);
const validate = (f) => (data) => { const good = f(data); return {valid: !!good, diagnostics: (f.errors??[]).map(e=> `${e.instancePath}: ${e.message}`) }; };
const opts={compilerContext:{validateSource:validate(srcValidate),validateNormalized:validate(normValidate),catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},engineBaselineVersion:ENGINE_VERSION}};
const file=(path)=>{const b=fs.readFileSync(path);return{name:path.split('/').at(-1),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}};

const customCsv=`Asset ID,Hostname,Device Type,IP Address,Connected To
host01,Office Windows,Windows,10.99.1.10,switch01
host02,Office Linux,Linux,10.99.1.20,switch01
switch01,Office Switch,Switch,10.99.1.1,
`;
async function exercise(input, minDevices, minLinks) {
 const preview=await previewNetworkTopologyFile(input);
 assert.equal(preview.ok,true,JSON.stringify(preview.diagnostics));
 assert.ok(preview.devices>=minDevices);assert.ok(preview.links>=minLinks);
 const compiled=await compileBuilderWorkspace(createBuilderWorkspace(preview.source),opts);
 assert.equal(compiled.compile.status,'valid',JSON.stringify(compiled.compile.diagnostics));
 const running=previewRuntime(compiled);
 assert.equal(running.ok,true,JSON.stringify(running.diagnostics));
 assert.equal(running.workspace.mode,'runtime');
 const model=buildRuntimeActiveProbeModel(running.workspace);
 assert.ok(model.sources.length>0,'Imported OS-labelled endpoints must be eligible probe sources');
 const src=model.sources[0];const os=src.os;
 assert.ok(os==='windows'||os==='linux');
 const definitions=model.probes;
 assert.ok(definitions.some(x=>x.probeId===`${os}.ping`));
 const destination=model.destinations.find(x=>x.type==='network.switch')??model.destinations[0];
 assert.ok(destination);
 const result=runRuntimeActiveProbe(running.workspace,{sourceId:src.id,probeId:`${os}.ping`,destinationId:destination.id});
 assert.equal(result.ok,true,JSON.stringify(result.diagnostics));
 assert.equal(result.transcript.modeled,true);
 assert.equal(result.transcript.boundary,'NO_GUEST_COMMAND_EXECUTION');
 assert.equal(result.transcript.scenarioHash,running.workspace.scenario.sourceHash);
 assert.ok(['TRUE','FALSE','UNKNOWN'].includes(result.transcript.truth));
 assert.equal(result.transcript.sourceId,src.id);
 assert.equal(result.transcript.destinationId,destination.id);
 const before=JSON.stringify(running.workspace.engineState);
 runRuntimeActiveProbe(running.workspace,{sourceId:src.id,probeId:`${os}.ping`,destinationId:destination.id});
 assert.equal(JSON.stringify(running.workspace.engineState),before,'Probe must not mutate engine state');
 return {devices:preview.devices,links:preview.links,sources:model.sources.length,truth:result.transcript.truth};
}
const bytes=Buffer.from(customCsv);
const csv=await exercise({name:'test.csv',arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)},3,2);
assert.equal(csv.sources,2);
const example=await exercise(file('examples/enterprise-import/network-devices-example.csv'),4,3);
const testXlsx=process.env.YADILAB_IMPORT004_TEST_XLSX;
let municipal=null;
if(testXlsx){municipal=await exercise(file(testXlsx),40,40);assert.equal(municipal.devices,47);assert.equal(municipal.links,46);assert.equal(municipal.sources,16);}
// No unsupported type becomes a Windows/Linux source simply because it has an address.
assert.deepEqual(buildRuntimeActiveProbeModel({mode:'builder'}).sources,[]);
const main=fs.readFileSync('ui/app/main.mjs','utf8');
assert.ok(main.includes('data-network-import-runtime'));assert.ok(main.includes('Open modeled Runtime + Probes'));
assert.ok(main.includes('previewRuntime(next)'));
assert.ok(main.includes('buildRuntimeActiveProbeModel(runtime.workspace)'));
assert.ok(main.includes('data-open-active-probes'));
assert.ok(main.includes('data-import-probe-boundary'));
assert.ok(main.includes('probeDisclosureRef.current.open = true'));
// The IMPORT-004 probe feature remains tested, but the release label is now
// sourced from current package metadata rather than a frozen IMPORT-004 string.
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.ok(typeof pkg.yadilabRelease?.checkpoint === 'string' && pkg.yadilabRelease.checkpoint.length > 0);
assert.match(main, /const releaseIdentity\s*=\s*\{[^;]*checkpoint:\s*releasePackage\.yadilabRelease\.checkpoint/);
assert.match(main, /"data-development-checkpoint":\s*releaseIdentity\.checkpoint\b/);
assert.doesNotMatch(main, /"data-development-checkpoint":\s*"IMPORT-004"/);
// Negative control for this source-level binding check; browser DOM is a separate release gate.
assert.doesNotMatch(
  main.replace('"data-development-checkpoint": releaseIdentity.checkpoint', '"data-development-checkpoint": "IMPORT-004"'),
  /"data-development-checkpoint":\s*releaseIdentity\.checkpoint\b/
);
console.log(`PASS IMPORT-004: imported modeled probes CSV ${JSON.stringify(csv)}, 4-device example ${JSON.stringify(example)}${municipal?`, Arvidsjaur 47/46 ${JSON.stringify(municipal)}`:''}; actual Engine truth preserved`);
