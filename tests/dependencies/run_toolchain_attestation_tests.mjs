import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { attestBrowserToolchain } from "../../scripts/browser-toolchain-attestation-lib.mjs";

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const eq = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };

function goodModules() {
  class Ajv {
    compile() { return (value) => value?.ok === true; }
  }
  class ELK {
    async layout(graph) { return { ...graph, children: graph.children.map((child, i) => ({ ...child, x: i * 80, y: 0 })) }; }
  }
  const ReactFlow = function ReactFlow() {};
  return {
    react: { createElement: (type, props, child) => ({ type, props, child }) },
    "react-dom/server": { renderToStaticMarkup: () => '<span data-probe="react">ok</span>' },
    "@xyflow/react": { ReactFlow, applyNodeChanges: () => [] },
    ajv: { default: Ajv },
    "elkjs/lib/elk.bundled.js": { default: ELK },
    "@zip.js/zip.js": {
      ZipReader: function ZipReader() {}, ZipWriter: function ZipWriter() {},
      Uint8ArrayReader: function Uint8ArrayReader() {}, Uint8ArrayWriter: function Uint8ArrayWriter() {},
    },
    typescript: {
      version: "5.9.2", ScriptTarget: { ES2022: 9 },
      transpileModule: () => ({ outputText: "const answer = 42;" }),
    },
    esbuild: {
      version: "0.28.2",
      transform: async () => ({ code: "const answer = 42;\nexport { answer };" }),
    },
  };
}

const modules = goodModules();
const result = await attestBrowserToolchain(async (specifier) => {
  if (!(specifier in modules)) throw new Error(`unexpected ${specifier}`);
  return modules[specifier];
}, { typescript: "5.9.2", esbuild: "0.28.2" });

ok(result.ok, `complete executable toolchain passes: ${JSON.stringify(result.failures)}`);
eq(result.failures, [], "no failures for complete toolchain");
eq(result.passed.sort(), ["@xyflow/react", "@zip.js/zip.js", "ajv", "elkjs", "esbuild", "react", "react-dom", "typescript"].sort(), "all required components execute");
ok(result.passed.includes("esbuild"), "native esbuild transform gate executed");
ok(result.passed.includes("elkjs"), "ELK layout gate executed");
ok(result.passed.includes("ajv"), "Ajv compile gate executed");
ok(result.passed.includes("react-dom"), "ReactDOM render gate executed");
ok(result.passed.includes("typescript"), "TypeScript transpile gate executed");

const forwardRefModules = goodModules();
forwardRefModules["@xyflow/react"].ReactFlow = {
  $$typeof: Symbol.for("react.forward_ref"),
  render() {},
};
const forwardRefResult = await attestBrowserToolchain(async (specifier) => forwardRefModules[specifier], { typescript: "5.9.2", esbuild: "0.28.2" });
ok(forwardRefResult.ok, "React Flow forward_ref component export is accepted");

const wrappedModules = goodModules();
wrappedModules["@xyflow/react"] = { default: wrappedModules["@xyflow/react"] };
const wrappedResult = await attestBrowserToolchain(async (specifier) => wrappedModules[specifier], { typescript: "5.9.2", esbuild: "0.28.2" });
ok(wrappedResult.ok, "CommonJS React Flow default namespace is accepted");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const buildSource = fs.readFileSync(path.join(root, "scripts/build_browser_app.mjs"), "utf8");
const installSource = fs.readFileSync(path.join(root, "scripts/install_offline_browser_dependencies.sh"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
ok(buildSource.includes("attestInstalledBrowserToolchain"), "direct browser build cannot skip executable toolchain attestation");
ok(installSource.includes("check_browser_toolchain_execution.mjs"), "offline installer runs executable toolchain attestation before build");
ok(packageJson.scripts?.["check:toolchain"] === "node scripts/check_browser_toolchain_execution.mjs", "toolchain gate has explicit npm command");
ok(packageJson.scripts?.["test:toolchain-attestation"]?.includes("run_toolchain_attestation_adversarial.mjs"), "toolchain tests have explicit npm command");

console.log(`PASS browser toolchain attestation suite: ${checks} assertions.`);
