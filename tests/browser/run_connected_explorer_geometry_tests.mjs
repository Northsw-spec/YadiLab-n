import assert from "node:assert/strict";
import { inspectConnectedExplorerGeometry } from "../../ui/app/connected-explorer-guard.mjs";
const zone = (status = "resolved", width = 900, height = 600) => ({
  id: "z", type: "zone", position: { x: 20, y: 20 }, width, height, layoutStatus: status
});
const resource = (id, x, y, status = "resolved", parentId = "z") => ({
  id, type: "resource", ...(parentId ? { parentId } : {}),
  position: { x, y }, width: 180, height: 96, layoutStatus: status
});
const check = nodes => inspectConnectedExplorerGeometry({ nodes });
const valid = [zone(), resource("a", 32, 128), resource("b", 256, 128)];
const before = JSON.stringify(valid);
assert.equal(check(valid).safe, true);
assert.equal(JSON.stringify(valid), before, "the view guard may not edit topology");
assert.equal(check([zone(), resource("a", 0, 0, "unplaced")]).reason, "UNRESOLVED_GEOMETRY");
assert.equal(check([zone(), resource("a", 32, 0)]).reason, "ZONE_HEADER_OVERLAP");
assert.equal(check([zone(), resource("a", 32, 128), resource("b", 32, 128)]).reason, "OVERLAPPING_SIBLINGS");
assert.equal(check([zone(), resource("a", 770, 128)]).reason, "OUTSIDE_PARENT_BOUNDS");
assert.equal(check([resource("a", 10, 10, "resolved", "missing")]).reason, "MISSING_PARENT_GEOMETRY");
assert.equal(check([zone("unplaced"), resource("a", 32, 128)]).reason, "UNRESOLVED_GEOMETRY");
assert.equal(check([resource("a", 0, 0, "resolved", null), resource("b", 240, 0, "resolved", null)]).safe, true);
assert.equal(check([resource("a", NaN, 0, "resolved", null)]).reason, "INVALID_GEOMETRY");
const many = [zone("resolved", 900, 14000)];
for (let i = 0; i < 300; i += 1) many.push(resource(`n${i}`, 32 + (i % 3) * 220, 128 + Math.floor(i / 3) * 132));
assert.equal(check(many).safe, true, "fully placed 300-node explorer is not disabled");
many[101] = resource("n100", 32, 128);
assert.equal(check(many).reason, "OVERLAPPING_SIBLINGS", "stacked cards must not be rendered");
console.log("PASS Connected Explorer geometry: good documents retained; missing/overlapping coordinates blocked");
