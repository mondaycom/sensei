/**
 * Result utilities — filter, compare, and summarize suite results
 */
import type { SuiteResult, ScenarioResult, EvaluationLayer, Badge } from '@mondaycom/sensei-engine';
import { determineBadge } from '@mondaycom/sensei-engine';

/**
 * Filter scenarios by evaluation layer
 */
export function filterByLayer(result: SuiteResult, layer: EvaluationLayer): ScenarioResult[] {
  return result.scenarios.filter((s) => s.layer === layer);
}

/**
 * Compare two suite results and produce a delta summary
 */
export interface ResultComparison {
  suiteId: string;
  before: { overall: number; badge: Badge; timestamp: string };
  after: { overall: number; badge: Badge; timestamp: string };
  delta: {
    overall: number;
    execution: number;
    reasoning: number;
    self_improvement: number;
  };
  improved: boolean;
  scenarioDeltas: Array<{
    scenarioId: string;
    before: number;
    after: number;
    delta: number;
  }>;
}

export function compareResults(before: SuiteResult, after: SuiteResult): ResultComparison {
  const scenarioDeltas: ResultComparison['scenarioDeltas'] = [];

  const afterIds = new Set<string>();
  for (const afterScenario of after.scenarios) {
    afterIds.add(afterScenario.scenario_id);
    const beforeScenario = before.scenarios.find((s) => s.scenario_id === afterScenario.scenario_id);
    scenarioDeltas.push({
      scenarioId: afterScenario.scenario_id,
      before: beforeScenario?.score ?? 0,
      after: afterScenario.score,
      delta: afterScenario.score - (beforeScenario?.score ?? 0),
    });
  }

  // M12: Include scenarios that were in before but removed in after
  for (const beforeScenario of before.scenarios) {
    if (!afterIds.has(beforeScenario.scenario_id)) {
      scenarioDeltas.push({
        scenarioId: beforeScenario.scenario_id,
        before: beforeScenario.score,
        after: 0,
        delta: -beforeScenario.score,
      });
    }
  }

  const overallDelta = after.scores.overall - before.scores.overall;

  return {
    suiteId: after.suite_id,
    before: { overall: before.scores.overall, badge: before.badge, timestamp: before.timestamp },
    after: { overall: after.scores.overall, badge: after.badge, timestamp: after.timestamp },
    delta: {
      overall: overallDelta,
      execution: after.scores.execution - before.scores.execution,
      reasoning: after.scores.reasoning - before.scores.reasoning,
      self_improvement: after.scores.self_improvement - before.scores.self_improvement,
    },
    improved: overallDelta > 0,
    scenarioDeltas,
  };
}

/**
 * Format a one-line summary of a suite result
 */
export function formatSummary(result: SuiteResult): string {
  const badge = determineBadge(result.scores.overall);
  const badgeStr = badge === 'none' ? 'NO BADGE' : badge.toUpperCase();
  return `${result.suite_id} v${result.suite_version} — ${result.agent_id} — Score: ${result.scores.overall.toFixed(1)}/100 [${badgeStr}] (${result.scenarios.length} scenarios, ${(result.duration_ms / 1000).toFixed(1)}s)`;
}
