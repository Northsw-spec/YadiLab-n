import type { EnterpriseBaseline, EnterpriseTopologyProjection, ScenarioSource } from "../../core-model/src/generated/contracts.js";

export interface EnterpriseProjectionOptions {
  readonly scenarioId?: string;
  readonly title?: string;
  readonly language?: string;
}

export interface EnterpriseProjectionSuccess {
  readonly ok: true;
  readonly source: ScenarioSource;
  readonly report: EnterpriseTopologyProjection;
}

export interface EnterpriseProjectionFailure {
  readonly ok: false;
  readonly report: EnterpriseTopologyProjection;
}

export type EnterpriseProjectionResult = EnterpriseProjectionSuccess | EnterpriseProjectionFailure;

export interface EnterpriseProjectionInput {
  readonly baseline: EnterpriseBaseline;
  readonly options?: EnterpriseProjectionOptions;
}
