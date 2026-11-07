import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { projectScenarioToCanvas } from "../../dist-canvas-test/ui/src/canvas/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const scenario = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/valid/scenario-normalized.json"), "utf8"));
let checks=0; const ok=(v,m)=>{assert.ok(v,m);checks+=1}; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);checks+=1};

const none = projectScenarioToCanvas(scenario);
ok(none.diagnostics.some((d)=>d.code === "CANVAS_LAYOUT_MISSING"), "missing layout is explicit");
ok(none.nodes.every((n)=>n.layoutStatus === "unplaced"), "no hidden coordinate inference without layout");

const wrong = { formatId:"infrastructure-cyber-lab.layout", schemaVersion:"0.1.0", scenarioId:"other_scenario", engine:"elk.layered", nodes:[{id:"rds01",x:999,y:999,width:1,height:1}] };
const mismatch = projectScenarioToCanvas(scenario, wrong);
ok(mismatch.diagnostics.some((d)=>d.code === "CANVAS_LAYOUT_SCENARIO_MISMATCH"), "foreign layout rejected from projection");
eq(mismatch.nodes.find((n)=>n.id === "rds01").layoutStatus, "unplaced", "foreign coordinates not consumed");

const orphan = { formatId:"infrastructure-cyber-lab.layout", schemaVersion:"0.1.0", scenarioId:scenario.scenarioId, engine:"elk.layered", nodes:[{id:"ghost",x:1,y:2,width:3,height:4}] };
const o = projectScenarioToCanvas(scenario, orphan);
ok(o.diagnostics.some((d)=>d.code === "CANVAS_LAYOUT_ORPHAN" && d.objectId === "ghost"), "orphan layout item diagnosed and ignored");
ok(!o.nodes.some((n)=>n.id === "ghost"), "layout cannot create semantic objects");

const withPorts = structuredClone(scenario);
withPorts.resources.find((r)=>r.id === "admin01").interfaces=[{id:"eth0",label:"eth0",addresses:["10.0.0.10/24"]}];
withPorts.resources.find((r)=>r.id === "rds01").interfaces=[{id:"eth0",label:"eth0",addresses:["10.0.0.20/24"]}];
withPorts.connections.find((c)=>c.id === "admin_rds").from.port="eth0";
withPorts.connections.find((c)=>c.id === "admin_rds").to.port="eth0";
const hp=projectScenarioToCanvas(withPorts);
const e=hp.edges.find((x)=>x.id === "admin_rds");
eq(e.sourceHandle,"out:eth0","source interface maps to stable handle id");
eq(e.targetHandle,"in:eth0","target interface maps to stable handle id");
const admin=hp.nodes.find((n)=>n.id === "admin01");
eq(admin.data.interfaces[0].sourceHandleId,"out:eth0","node exposes matching source handle metadata");

const badPort=structuredClone(withPorts);
badPort.connections.find((c)=>c.id === "admin_rds").to.port="missing";
const bp=projectScenarioToCanvas(badPort);
ok(bp.diagnostics.some((d)=>d.code === "CANVAS_TARGET_PORT_UNKNOWN"), "projection fails visibly on inconsistent port reference");

console.log(`PASS canvas projection adversarial suite: ${checks} assertions.`);
