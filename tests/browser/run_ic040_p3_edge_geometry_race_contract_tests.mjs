import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// Frozen alongside real failed main-push Linux release #41343926420.
// Exact DOM parity failed even though PR browser checks had passed.
// A deferred store rewrite of a captured edge array can re-instate stale
// edges during the next scenario import. Require edge-ID/order stability.
const source=readFileSync(new URL("../../ui/app/main.mjs",import.meta.url),"utf8");
const fragment=source.split("function ReactFlowGeometryRepair(")[1]?.split("function downloadBlob(")[0];
assert.ok(fragment && fragment.includes("updateNodeInternals("),
 "Missing actual ReactFlow geometry-repair hook; investigate source change rather than bypassing contract");
assert.equal((fragment.match(/store\.setState\(/g)??[]).length,1,
 "Geometry repair must publish a single synchronous current-edge snapshot, never deferred stale writes");
assert.doesNotMatch(fragment,/restoreEdgeOrderTimer|setTimeout\(\(\)\s*=>\s*\{[\s\S]*store\.setState\(\{\s*edges:/,
 "Do not restore captured edge sets asynchronously across Builder scenario revisions");
assert.doesNotMatch(fragment,/next\.edges\.length\s*>\s*1\s*\?\s*\[\.\.\.next\.edges\]\.reverse\(\)/,
 "Geometry update must not flip actual edge order and immediately flip it back");
assert.match(fragment,/edges:\s*\[\.\.\.next\.edges\]/,
 "ReactFlow geometry repair must copy the current store edges in original ID order");
assert.match(fragment,/nodeLookup:\s*new Map\(next\.nodeLookup\)/,
 "Geometry must still publish fresh node/handle bounds with the stable edges");
assert.match(fragment,/globalThis\.clearInterval\(retryInterval\)/,
 "Geometry polling must be cleaned up on topology scenario revision");
console.log("PASS IC-040 P3 release DOM race source contract: exact current edge order, no deferred stale edge restoration");
