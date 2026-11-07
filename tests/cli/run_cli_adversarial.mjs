import assert from "node:assert/strict";
import { executeCli, parseArgs, inspectDocument } from "../../dist-cli-test/cli/src/index.js";

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }
function throws(fn, pattern, message) { assert.throws(fn, pattern, message); checks += 1; }

const noopServices = {
  validateSource: () => ({ valid: true, diagnostics: [] }),
  async compileSource() { throw new Error("compile should not be reached"); },
  runRegression() { throw new Error("regression should not be reached"); },
  migrateDocument() { throw new Error("migration should not be reached"); },
  renderScenario() { throw new Error("render should not be reached"); },
};
function ioFor(text = "{}") {
  const stdout = [], stderr = [], writes = [];
  return {
    stdout, stderr, writes,
    io: {
      async readText() { return text; },
      async writeText(path, content) { writes.push([path, content]); },
      stdout(v) { stdout.push(v); },
      stderr(v) { stderr.push(v); },
    },
  };
}

throws(() => parseArgs(["compile", "--input", "a", "--input", "b"]), /only be specified once/, "duplicate input rejected");
throws(() => parseArgs(["compile", "--output", "x"]), /requires --input/, "output without input rejected");
throws(() => parseArgs(["compile", "--input"]), /requires a value/, "missing input value rejected");
throws(() => parseArgs(["compile", "--input", "a", "--wat", "x"]), /Unknown argument/, "unknown flag rejected");

ok(parseArgs(["render", "--input", "a.yadilab", "--output", "x.svg"]).command === "render", "package render may defer layout requirement to embedded package layout");
throws(() => parseArgs(["render", "--input", "a", "--layout", "l.json"]), /requires --output/, "render requires explicit output");
throws(() => parseArgs(["unpack", "--input", "a.yadilab"]), /requires --output directory/, "unpack requires output directory");
throws(() => parseArgs(["inspect", "--input", "a", "--layout", "l.json"]), /only valid/, "layout argument rejected outside render");
throws(() => inspectDocument([]), /JSON object/, "array inspect rejected");
eq(inspectDocument({ formatId: "evil.format" }), { formatId: "evil.format", kind: "unknown" }, "unknown format is identified without execution");

{
  const m = ioFor("{}");
  const r = await executeCli(["validate", "--input", "x", "--output", "--bad"], m.io, noopServices);
  eq(r.exitCode, 2, "flag-like output value rejected");
  ok(m.stderr.length >= 1, "usage error goes to stderr");
}
{
  const m = ioFor("null");
  const r = await executeCli(["inspect", "--input", "x"], m.io, noopServices);
  eq(r.exitCode, 2, "null inspect rejected as input error");
  ok(m.stderr.some((x) => x.includes("JSON object")), "inspect error explained");
}
{
  const m = ioFor("{}");
  const exploding = { ...noopServices, validateSource() { throw new Error("validator exploded"); } };
  const r = await executeCli(["validate", "--input", "x"], m.io, exploding);
  eq(r.exitCode, 2, "service exception is operational error");
  ok(m.stderr.includes("validator exploded"), "service exception surfaced without fake success");
}
{
  const m = ioFor("{}");
  const failingWrite = {
    ...m.io,
    async writeText() { throw new Error("disk full"); },
  };
  const r = await executeCli(["validate", "--input", "x", "--output", "out"], failingWrite, noopServices);
  eq(r.exitCode, 2, "write failure is operational error");
  ok(m.stderr.includes("disk full"), "write failure surfaced");
}


{
  const m = ioFor("{}");
  const r = await executeCli(["render", "--input", "x.json", "--output", "x.svg"], m.io, noopServices);
  eq(r.exitCode, 2, "JSON render without layout fails at execution boundary");
  ok(m.stderr.some((x) => x.includes("JSON render requires --layout")), "JSON render missing layout explained");
}
{
  const bytes = new TextEncoder().encode("not-a-package");
  const stdout = [], stderr = [];
  const io = {
    async readText() { return ""; }, async writeText() {}, async readBytes() { return bytes; }, async writeBytes() {},
    stdout(v) { stdout.push(v); }, stderr(v) { stderr.push(v); },
  };
  const r = await executeCli(["inspect", "--input", "broken.yadilab"], io, noopServices);
  eq(r.exitCode, 2, "package input without package runtime is operational failure");
  ok(stderr.some((x) => x.includes("Package runtime is unavailable")), "missing package runtime explained");
}

console.log(`PASS CLI adversarial suite: ${checks} assertions.`);
