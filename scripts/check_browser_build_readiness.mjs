import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateBuildReadiness } from "./dependency-contract-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(here, ".."));
const result = evaluateBuildReadiness(root);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ready ? 0 : 77);
