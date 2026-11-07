import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { projectScenarioToCanvas, toReactFlowProjection } from "../../dist-canvas-test/ui/src/canvas/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const fixture = (rel) => JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures", rel), "utf8"));
let checks = 0;
const eq = (a,b,m) => { assert.deepEqual(a,b,m); checks += 1; };
const ok = (v,m) => { assert.ok(v,m); checks += 1; };

const scenario = fixture("valid/scenario-normalized.json");
const layout = fixture("valid/layout.json");
const p = projectScenarioToCanvas(scenario, layout);
eq(p.scenarioId, scenario.scenarioId, "scenario identity preserved");
eq(p.sourceHash, scenario.sourceHash, "source hash preserved");
eq(p.nodes.length, scenario.zones.length + scenario.resources.length, "one node per zone/resource");
eq(p.edges.length, scenario.connections.length, "one edge per semantic connection");

const firstResourceIndex = p.nodes.findIndex((n) => n.type === "resource");
ok(firstResourceIndex >= scenario.zones.length, "zones precede resources for React Flow parent ordering");
const rds = p.nodes.find((n) => n.id === "rds01");
eq(rds.parentId, "server", "resource parent is semantic zone");
eq(rds.extent, "parent", "resource is constrained to parent zone in projection");
eq(rds.position, {x:440,y:0}, "layout coordinates projected when present");
eq(rds.layoutStatus, "resolved", "resolved layout status");
const admin = p.nodes.find((n) => n.id === "admin01");
eq(admin.layoutStatus, "unplaced", "missing layout remains explicitly unplaced");
eq(admin.position, {x:0,y:0}, "unplaced placeholder does not invent semantic coordinates");
ok(p.diagnostics.some((d) => d.code === "CANVAS_NODE_UNPLACED" && d.objectId === "admin01"), "missing layout diagnostic emitted");

const edge = p.edges.find((e) => e.id === "admin_rds");
eq(edge.data.connectionKind, "management", "connection kind preserved as semantic edge data");
eq(edge.source, "admin01", "edge source projected");
eq(edge.target, "rds01", "edge target projected");

const rf = toReactFlowProjection(p);
eq(rf.nodes.length, p.nodes.length, "React Flow node projection complete");
eq(rf.edges.length, p.edges.length, "React Flow edge projection complete");
eq(rf.nodes.find((n) => n.id === "rds01").data.semanticId, "rds01", "semantic identity retained in view data");

const p2 = projectScenarioToCanvas(scenario, layout);
eq(p2, p, "projection is deterministic and pure for identical inputs");

console.log(`PASS canvas projection suite: ${checks} assertions.`);
