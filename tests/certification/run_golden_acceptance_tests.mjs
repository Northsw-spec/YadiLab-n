import fs from 'node:fs';
import assert from 'node:assert/strict';
import {compileScenario} from '../../dist-certification-test/compiler/src/index.js';
import {certifyCompiledScenario,certifyScenarioSource} from '../../dist-certification-test/certification/src/index.js';
import {MemoryArchiveBackend,SafePackageIO} from '../../dist-certification-test/package-io/src/index.js';
import {ENGINE_VERSION,createInitialEngineState,queryReachability,runScenarioRegression} from '../../dist-certification-test/engine/src/index.js';
import {validateVisualLayout} from '../../dist-certification-test/layout/src/index.js';
const load=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const source=load('tests/fixtures/golden/proxmox_rds_opnsense.source.json');
const catalog=load('catalog/builtin-catalog.json');
const pass=()=>({valid:true,diagnostics:[]});
const context={validateSource:pass,validateNormalized:pass,catalog:{capabilities:catalog.capabilities,profiles:catalog.profiles,assets:catalog.assets},engineBaselineVersion:ENGINE_VERSION};
const archive=new SafePackageIO(new MemoryArchiveBackend(),()=>({valid:true}));
let assertions=0;
function eq(a,b,msg){assert.deepEqual(a,b,msg);assertions++};function ok(x,msg){assert.ok(x,msg);assertions++};
function layoutFor(model){
 const zones=model.zones.map((z,i)=>({id:z.id,x:i*750,y:0,width:700,height:480,...(z.parent?{parent:z.parent}:{})}));
 const next={};const resources=model.resources.map(r=>{const i=next[r.zone]??0;next[r.zone]=i+1;return {id:r.id,x:40+(i%2)*285,y:80+Math.floor(i/2)*135,width:220,height:90,...(r.zone?{parent:r.zone}:{})}});
 return {formatId:'infrastructure-cyber-lab.layout',schemaVersion:'0.1.0',scenarioId:model.scenarioId,engine:'elk.layered',nodes:[...zones,...resources]};
}
const compiled=await compileScenario(source,context);ok(compiled.ok,`golden source compiles: ${JSON.stringify(compiled.diagnostics)}`);if(!compiled.ok)process.exit(1);
eq(compiled.model.minimumEngineVersion,'0.8.0','golden scenario uses current Engine 0.8 baseline');
eq(compiled.model.resources.length,10,'ten integrated resources');eq(compiled.model.tests.length,10,'ten integrated tests');
const layout=layoutFor(compiled.model);eq(validateVisualLayout(compiled.model,layout),[],'golden layout passes deterministic visual validation');
const regression=runScenarioRegression(compiled.model);ok(regression.passed,`canonical regression passes: ${JSON.stringify(regression.checks.filter(x=>!x.passed))}`);
eq(regression.initialEvaluation.completion.truth,'FALSE','initial state unsolved');eq(regression.solvedEvaluation.completion.truth,'TRUE','canonical solution reaches completion');
for(const definition of compiled.model.tests){
 const initial=regression.initialEvaluation.tests.find(x=>x.id===definition.id);
 const solved=regression.solvedEvaluation.tests.find(x=>x.id===definition.id);
 eq(initial?.outcome,definition.expectedInitial,`initial expected outcome for ${definition.id}`);
 eq(solved?.outcome,definition.expectedSolved,`solved expected outcome for ${definition.id}`);
}
for(const id of ['admin_rdp','admin_pve']) eq(regression.solvedEvaluation.tests.find(x=>x.id===id)?.outcome,'TRUE',`${id} legitimate management retained`);
const state=createInitialEngineState(compiled.model);const wanPve=queryReachability(compiled.model,state,'attacker','pve01','tcp',8006);eq(wanPve.truth,'FALSE','Proxmox management inaccessible from WAN');
const wanRdp=queryReachability(compiled.model,state,'attacker','rds01','tcp',3389);eq(wanRdp.truth,'TRUE','intended initial WAN RDP exposure exists');ok(wanRdp.explanation.some(line=>line.includes("DNAT rule 'rdp_forward'")),'DNAT policy evidence preserved');

// Phase 35 continuity: integrated multi-domain baseline must retain SNAT semantics
// without mutating the certified source/model or silently replacing its policy.
const snatProbe=structuredClone(compiled.model);
snatProbe.resources.find(x=>x.id==='attacker').interfaces=[{id:'uplink',addresses:['10.42.0.10/24']}];
const snatFirewall=snatProbe.resources.find(x=>x.id==='firewall01');
snatFirewall.properties.snatPolicy='required';
snatFirewall.properties.natRules.push({id:'golden_snat',type:'snat',source:'attacker',destination:'rds01',protocol:'tcp',port:3389,translatedSource:'198.51.100.44'});
const snatRds=snatProbe.resources.find(x=>x.id==='rds01');
snatRds.properties.acls=[{source:'198.51.100.0/24',destination:'rds01',protocol:'tcp',port:3389,action:'allow'}];
snatRds.properties.aclDefaultAction='deny';
const goldenSnat=queryReachability(snatProbe,createInitialEngineState(snatProbe),'attacker','rds01','tcp',3389);
eq(goldenSnat.truth,'TRUE','golden DNAT/SNAT flow passes downstream translated-source ACL');
eq(goldenSnat.value?.translatedSource,'198.51.100.44','golden SNAT records translated source');
eq(goldenSnat.value?.matchedSnatRule,'golden_snat','golden SNAT records exact matched rule');
const wrongSnat=structuredClone(snatProbe);
wrongSnat.resources.find(x=>x.id==='firewall01').properties.natRules.find(x=>x.id==='golden_snat').translatedSource='198.51.101.44';
eq(queryReachability(wrongSnat,createInitialEngineState(wrongSnat),'attacker','rds01','tcp',3389).truth,'FALSE','downstream ACL rejects incorrect SNAT CIDR');
const absentSnat=structuredClone(snatProbe);
absentSnat.resources.find(x=>x.id==='firewall01').properties.natRules=absentSnat.resources.find(x=>x.id==='firewall01').properties.natRules.filter(x=>x.type!=='snat');
delete absentSnat.resources.find(x=>x.id==='firewall01').properties.snatPolicy;
eq(queryReachability(absentSnat,createInitialEngineState(absentSnat),'attacker','rds01','tcp',3389).truth,'FALSE','downstream ACL rejects untranslated source');

let cert=await certifyCompiledScenario(compiled.model,{packageIO:archive,distribution:'student',layout});ok(cert.ok,`student package certification succeeds: ${JSON.stringify(cert.diagnostics)}`);if(!cert.ok)process.exit(1);eq(cert.certificate.gates.length,5,'five certification gates');eq(cert.readback.solution,undefined,'student package strips canonical solution');eq(cert.readback.scenario.tests.length,10,'student readback keeps integrated tests');
cert=await certifyCompiledScenario(compiled.model,{packageIO:archive,distribution:'author',layout});ok(cert.ok,'author package certification succeeds');if(cert.ok)ok(cert.readback.solution!==undefined,'author package retains canonical solution');
const sourceCert=await certifyScenarioSource(source,{compilerContext:context,packageIO:archive,distribution:'student',layout});ok(sourceCert.ok,'source-to-package certification succeeds');
// Adversarial integrated regressions: no silent degradation.
const brokenSolution=structuredClone(compiled.model);brokenSolution.canonicalSolution.operations=brokenSolution.canonicalSolution.operations.filter(x=>x.target!=='alice');
let bad=await certifyCompiledScenario(brokenSolution,{packageIO:archive,distribution:'student',layout});ok(!bad.ok,'missing MFA remediation fails certification');ok(bad.diagnostics.some(x=>x.code==='CERT_REGRESSION_FAILED'),'MFA failure is a regression gate failure');
const brokenNat=structuredClone(compiled.model);brokenNat.resources.find(x=>x.id==='firewall01').properties.natRules[0].translatedPort=8443;
bad=await certifyCompiledScenario(brokenNat,{packageIO:archive,distribution:'student',layout});ok(!bad.ok,'wrong DNAT translation fails intended initial-state regression');
const brokenLayout=structuredClone(layout);brokenLayout.nodes.find(x=>x.id==='pve01').x=brokenLayout.nodes.find(x=>x.id==='admin01').x;brokenLayout.nodes.find(x=>x.id==='pve01').y=brokenLayout.nodes.find(x=>x.id==='admin01').y;
bad=await certifyCompiledScenario(compiled.model,{packageIO:archive,distribution:'student',layout:brokenLayout});ok(!bad.ok,'overlapping integrated layout fails certification');ok(bad.diagnostics.some(x=>x.code.includes('LAYOUT_NODE_OVERLAP')),'visual overlap diagnostic explicit');
const missingCap=structuredClone(source);missingCap.requires.capabilities=missingCap.requires.capabilities.filter(x=>x.id!=='core.backup');const capCompile=await compileScenario(missingCap,context);ok(!capCompile.ok,'missing core.backup rejected before Runtime');
const compiledAgain=await compileScenario(source,context);ok(compiledAgain.ok,'repeat compile succeeds');if(compiledAgain.ok)eq(compiledAgain.model.sourceHash,compiled.model.sourceHash,'golden source hash deterministic');
fs.writeFileSync('tests/generated/golden-proxmox-rds-opnsense.normalized.json',JSON.stringify(compiled.model,null,2)+'\n');fs.writeFileSync('tests/generated/golden-proxmox-rds-opnsense.layout.json',JSON.stringify(layout,null,2)+'\n');
console.log(`PASS Phase 36 golden integrated acceptance: ${assertions} assertions`);
