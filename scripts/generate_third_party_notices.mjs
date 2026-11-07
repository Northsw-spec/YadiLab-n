import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDeclaredInventory, writeInventoryArtifacts } from "./third-party-notices-lib.mjs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inventory = buildDeclaredInventory(root);
writeInventoryArtifacts(root, inventory);
console.log(`PASS third-party notices baseline: ${inventory.entries.length} direct dependencies inventoried deterministically.`);
