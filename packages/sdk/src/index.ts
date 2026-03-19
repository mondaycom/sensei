/**
 * @mondaycom/sensei-sdk — Programmatic API for building Sensei suites
 */

// Re-export core types consumers need
export type {
  SuiteDefinition,
  ScenarioDefinition,
  KPIDefinition,
  KPIConfig,
  EvaluationLayer,
  ScoringMethod,
  AgentConfig,
  JudgeConfig,
  SuiteResult,
  ScenarioResult,
  KPIResult,
  LayerScores,
  Badge,
} from '@mondaycom/sensei-engine';

export { determineBadge, LAYER_WEIGHTS, BADGE_THRESHOLDS } from '@mondaycom/sensei-engine';

// SDK builders and utilities
export { SuiteBuilder, defineSuite, scenario, kpi } from './builder.js';
export { registerKPI, getCustomKPI, listCustomKPIs, clearCustomKPIs, invokeKPI } from './custom-kpi.js';
export type { CustomKPIFn, CustomKPIEntry } from './custom-kpi.js';
export { filterByLayer, compareResults, formatSummary } from './result-utils.js';
