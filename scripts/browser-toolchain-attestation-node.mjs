import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { evaluateBuildReadiness } from "./dependency-contract-lib.mjs";
import { attestBrowserToolchain } from "./browser-toolchain-attestation-lib.mjs";

export async function attestInstalledBrowserToolchain(root, providedReadiness = null) {
  const readiness = providedReadiness ?? evaluateBuildReadiness(root);
  if (!readiness.ready) return { status: "BLOCKED", exitCode: 77, readiness, result: null };
  const requireFromRoot = createRequire(path.join(root, "package.json"));
  const loadModule = async (specifier) => {
    const resolved = requireFromRoot.resolve(specifier);
    return import(pathToFileURL(resolved).href);
  };
  const expected = Object.fromEntries(readiness.installed.map((entry) => [entry.name, entry.version]));
  const result = await attestBrowserToolchain(loadModule, { typescript: expected.typescript, esbuild: expected.esbuild });
  return { status: result.ok ? "PASS" : "FAIL", exitCode: result.ok ? 0 : 1, readiness, result };
}
