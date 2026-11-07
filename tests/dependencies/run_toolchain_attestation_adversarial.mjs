import assert from "node:assert/strict";
import { attestBrowserToolchain } from "../../scripts/browser-toolchain-attestation-lib.mjs";

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };

function baseModules() {
  class Ajv { compile() { return (value) => value?.ok === true; } }
  class ELK { async layout(graph) { return { ...graph, children: graph.children.map((c, i) => ({ ...c, x: i, y: i })) }; } }
  return {
    react: { createElement: () => ({}) },
    "react-dom/server": { renderToStaticMarkup: () => '<span data-probe="react">ok</span>' },
    "@xyflow/react": { ReactFlow() {}, applyNodeChanges() {} },
    ajv: { default: Ajv },
    "elkjs/lib/elk.bundled.js": { default: ELK },
    "@zip.js/zip.js": { ZipReader() {}, ZipWriter() {}, Uint8ArrayReader() {}, Uint8ArrayWriter() {} },
    typescript: { version: "5.9.2", ScriptTarget: { ES2022: 9 }, transpileModule: () => ({ outputText: "const answer=42;" }) },
    esbuild: { version: "0.28.2", transform: async () => ({ code: "const answer=42;" }) },
  };
}

async function expectFailure(name, mutate, code) {
  const modules = baseModules();
  mutate(modules);
  const result = await attestBrowserToolchain(async (specifier) => {
    if (!(specifier in modules)) throw new Error(`module absent: ${specifier}`);
    const value = modules[specifier];
    if (value instanceof Error) throw value;
    return value;
  }, { typescript: "5.9.2", esbuild: "0.28.2" });
  ok(!result.ok, `${name} fails closed`);
  ok(result.failures.some((x) => x.code === code), `${name} keeps ${code}`);
}

await expectFailure("React missing", (m) => { delete m.react; }, "MODULE_LOAD_FAILED");
await expectFailure("ReactDOM output corrupt", (m) => { m["react-dom/server"].renderToStaticMarkup = () => "bad"; }, "REACT_DOM_EXECUTION_FAILED");
await expectFailure("React Flow export absent", (m) => { delete m["@xyflow/react"].ReactFlow; }, "XYFLOW_EXPORT_INVALID");
await expectFailure("React Flow object is not a component", (m) => { m["@xyflow/react"].ReactFlow = { render() {} }; }, "XYFLOW_EXPORT_INVALID");
await expectFailure("Ajv compile throws", (m) => { m.ajv.default = class { compile() { throw new Error("ajv broken"); } }; }, "AJV_EXECUTION_FAILED");
await expectFailure("ELK layout fails", (m) => { m["elkjs/lib/elk.bundled.js"].default = class { async layout() { throw new Error("elk broken"); } }; }, "ELK_EXECUTION_FAILED");
await expectFailure("zip.js export absent", (m) => { delete m["@zip.js/zip.js"].ZipWriter; }, "ZIPJS_EXPORT_INVALID");
await expectFailure("TypeScript wrong version", (m) => { m.typescript.version = "5.8.3"; }, "TYPESCRIPT_EXECUTION_FAILED");
await expectFailure("TypeScript transpile broken", (m) => { m.typescript.transpileModule = () => ({ outputText: "" }); }, "TYPESCRIPT_EXECUTION_FAILED");
await expectFailure("esbuild wrong version", (m) => { m.esbuild.version = "0.27.0"; }, "ESBUILD_EXECUTION_FAILED");
await expectFailure("esbuild native transform throws", (m) => { m.esbuild.transform = async () => { throw new Error("native binary unavailable"); }; }, "ESBUILD_EXECUTION_FAILED");

console.log(`PASS browser toolchain attestation adversarial suite: ${checks} assertions.`);
