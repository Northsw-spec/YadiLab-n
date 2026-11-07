function pushFailure(failures, component, code, error) {
  failures.push({
    component,
    code,
    message: error instanceof Error ? error.message : String(error),
  });
}

function requireFunction(value, name) {
  if (typeof value !== "function") throw new Error(`${name} is not a function`);
  return value;
}

function requireReactComponent(value, name) {
  if (typeof value === "function") return value;
  if (value && typeof value === "object") {
    const tag = value.$$typeof;
    if (tag === Symbol.for("react.forward_ref") && typeof value.render === "function") return value;
    if (tag === Symbol.for("react.memo") && (typeof value.type === "function" || (value.type && typeof value.type === "object"))) return value;
  }
  throw new Error(`${name} is not a supported React component export`);
}

function moduleDefault(mod) {
  return mod?.default ?? mod;
}

export async function attestBrowserToolchain(loadModule, expected = {}) {
  const failures = [];
  const passed = [];
  const load = async (component, specifier) => {
    try { return await loadModule(specifier); }
    catch (error) { pushFailure(failures, component, "MODULE_LOAD_FAILED", error); return null; }
  };

  const react = await load("react", "react");
  let element = null;
  if (react) {
    try {
      const createElement = requireFunction(react.createElement ?? react.default?.createElement, "react.createElement");
      element = createElement("span", { "data-probe": "react" }, "ok");
      if (!element) throw new Error("React did not return an element");
      passed.push("react");
    } catch (error) { pushFailure(failures, "react", "REACT_EXECUTION_FAILED", error); }
  }

  const reactDom = await load("react-dom", "react-dom/server");
  if (reactDom && element) {
    try {
      const render = requireFunction(reactDom.renderToStaticMarkup ?? reactDom.default?.renderToStaticMarkup, "react-dom/server.renderToStaticMarkup");
      const html = render(element);
      if (typeof html !== "string" || !html.includes("data-probe=\"react\"") || !html.includes("ok")) throw new Error("ReactDOM probe output mismatch");
      passed.push("react-dom");
    } catch (error) { pushFailure(failures, "react-dom", "REACT_DOM_EXECUTION_FAILED", error); }
  }

  const xyflow = await load("@xyflow/react", "@xyflow/react");
  if (xyflow) {
    try {
      const api = moduleDefault(xyflow);
      requireReactComponent(api.ReactFlow, "@xyflow/react.ReactFlow");
      requireFunction(api.applyNodeChanges, "@xyflow/react.applyNodeChanges");
      passed.push("@xyflow/react");
    } catch (error) { pushFailure(failures, "@xyflow/react", "XYFLOW_EXPORT_INVALID", error); }
  }

  const ajvModule = await load("ajv", "ajv");
  if (ajvModule) {
    try {
      const Ajv = requireFunction(moduleDefault(ajvModule), "Ajv");
      const ajv = new Ajv({ strict: true, allErrors: true });
      const validate = ajv.compile({ type: "object", properties: { ok: { const: true } }, required: ["ok"], additionalProperties: false });
      if (!validate({ ok: true }) || validate({ ok: false })) throw new Error("Ajv validation probe mismatch");
      passed.push("ajv");
    } catch (error) { pushFailure(failures, "ajv", "AJV_EXECUTION_FAILED", error); }
  }

  const elkModule = await load("elkjs", "elkjs/lib/elk.bundled.js");
  if (elkModule) {
    try {
      const ELK = requireFunction(moduleDefault(elkModule), "ELK");
      const elk = new ELK();
      if (typeof elk.layout !== "function") throw new Error("ELK.layout is not a function");
      const laidOut = await elk.layout({ id: "root", children: [{ id: "a", width: 40, height: 20 }, { id: "b", width: 40, height: 20 }], edges: [{ id: "e", sources: ["a"], targets: ["b"] }] });
      const child = laidOut?.children?.[0];
      if (!Number.isFinite(child?.x) || !Number.isFinite(child?.y)) throw new Error("ELK did not produce numeric coordinates");
      passed.push("elkjs");
    } catch (error) { pushFailure(failures, "elkjs", "ELK_EXECUTION_FAILED", error); }
  }

  const zip = await load("@zip.js/zip.js", "@zip.js/zip.js");
  if (zip) {
    try {
      for (const name of ["ZipReader", "ZipWriter", "Uint8ArrayReader", "Uint8ArrayWriter"]) requireFunction(zip[name], `@zip.js/zip.js.${name}`);
      passed.push("@zip.js/zip.js");
    } catch (error) { pushFailure(failures, "@zip.js/zip.js", "ZIPJS_EXPORT_INVALID", error); }
  }

  const ts = await load("typescript", "typescript");
  if (ts) {
    try {
      const api = moduleDefault(ts);
      if (expected.typescript && api.version !== expected.typescript) throw new Error(`TypeScript version ${api.version} != ${expected.typescript}`);
      const transpile = requireFunction(api.transpileModule, "typescript.transpileModule");
      const output = transpile("const answer: number = 42;", { compilerOptions: { target: api.ScriptTarget?.ES2022 } }).outputText;
      if (typeof output !== "string" || !output.includes("answer")) throw new Error("TypeScript transpile probe mismatch");
      passed.push("typescript");
    } catch (error) { pushFailure(failures, "typescript", "TYPESCRIPT_EXECUTION_FAILED", error); }
  }

  const esbuild = await load("esbuild", "esbuild");
  if (esbuild) {
    try {
      if (expected.esbuild && esbuild.version !== expected.esbuild) throw new Error(`esbuild version ${esbuild.version} != ${expected.esbuild}`);
      const transform = requireFunction(esbuild.transform, "esbuild.transform");
      const result = await transform("export const answer: number = 42", { loader: "ts", format: "esm", target: "es2022", minify: false });
      if (typeof result?.code !== "string" || !result.code.includes("answer")) throw new Error("esbuild native transform probe mismatch");
      passed.push("esbuild");
    } catch (error) { pushFailure(failures, "esbuild", "ESBUILD_EXECUTION_FAILED", error); }
  }

  return { ok: failures.length === 0, passed, failures };
}
