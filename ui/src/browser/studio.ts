import type { ScenarioSource } from "../../../core-model/src/generated/contracts.js";
import { cloneJson } from "./json.js";
import { createBuilderWorkspace } from "./builder.js";
import type { BuilderWorkspace } from "./types.js";

export interface ScenarioDraftOptions {
  readonly scenarioId?: string;
  readonly title?: string;
  readonly language?: string;
}

function normalizeId(value: string): string {
  const id = value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "_").replace(/^[^a-z]+/, "studio_");
  return id || "studio_scenario";
}

export function createScenarioDraft(options: ScenarioDraftOptions = {}): ScenarioSource {
  const scenarioId = normalizeId(options.scenarioId ?? "studio_scenario");
  return {
    formatId: "infrastructure-cyber-lab.scenario-source",
    schemaVersion: "0.1.0",
    scenarioId,
    metadata: {
      title: options.title?.trim() || "Nytt Scenario Studio-scenario",
      language: options.language?.trim() || "sv",
      briefing: "Draft skapad i Scenario Studio. Lägg till canonical resurser, länkar och mål före körning.",
    },
    requires: { capabilities: [], profiles: [] },
    zones: [],
    resources: [],
    connections: [],
    tests: [],
    findings: [],
    objectives: [],
    completion: { op: "all", rules: [] },
  };
}

export function createScenarioDraftWorkspace(options: ScenarioDraftOptions = {}): BuilderWorkspace {
  return createBuilderWorkspace(createScenarioDraft(options));
}

export function cloneScenarioDraft(source: ScenarioSource): ScenarioSource {
  return cloneJson(source);
}
