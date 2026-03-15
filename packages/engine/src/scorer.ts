/**
 * Scorer — calculates KPI scores and aggregates them into layer/overall scores.
 */

import type {
  KPIDefinition,
  KPIResult,
  ScenarioResult,
  LayerScores,
  Badge,
  EvaluationLayer,
} from './types.js';
import { LAYER_WEIGHTS, determineBadge } from './types.js';

// ─── Automated KPI Scoring ───────────────────────────────────────────

export function scoreAutomatedKPI(
  kpi: KPIDefinition,
  agentOutput: string,
): KPIResult {
  const maxScore = kpi.config.max_score ?? 100;
  let rawScore = 0;
  let evidence = '';

  switch (kpi.config.type) {
    case 'contains': {
      const expected = String(kpi.config.expected ?? '');
      const found = agentOutput.includes(expected);
      rawScore = found ? maxScore : 0;
      evidence = found
        ? `Output contains expected string "${expected}"`
        : `Output does not contain expected string "${expected}"`;
      break;
    }

    case 'regex': {
      const pattern = new RegExp(String(kpi.config.expected ?? ''));
      const match = pattern.test(agentOutput);
      rawScore = match ? maxScore : 0;
      evidence = match
        ? `Output matches regex /${kpi.config.expected}/`
        : `Output does not match regex /${kpi.config.expected}/`;
      break;
    }

    case 'json-schema': {
      try {
        JSON.parse(agentOutput);
        rawScore = maxScore;
        evidence = 'Output is valid JSON';
      } catch {
        rawScore = 0;
        evidence = 'Output is not valid JSON';
      }
      break;
    }

    case 'numeric-range': {
      const expected = kpi.config.expected as { min?: number; max?: number } | undefined;
      const num = parseFloat(agentOutput);
      if (isNaN(num)) {
        rawScore = 0;
        evidence = 'Output is not a number';
      } else {
        const min = expected?.min ?? -Infinity;
        const max = expected?.max ?? Infinity;
        const inRange = num >= min && num <= max;
        rawScore = inRange ? maxScore : 0;
        evidence = inRange
          ? `Value ${num} is within range [${min}, ${max}]`
          : `Value ${num} is outside range [${min}, ${max}]`;
      }
      break;
    }

    // Fix #1: word-count scorer — counts words in agent output and checks against a range.
    // This is what the 'brevity' KPI in the SDR suite needs (not numeric-range, which
    // tried to parseFloat the entire email body and always got NaN).
    case 'word-count': {
      const expected = kpi.config.expected as { min?: number; max?: number } | undefined;
      const wordCount = agentOutput.trim().split(/\s+/).filter(Boolean).length;
      const min = expected?.min ?? 0;
      const max = expected?.max ?? Infinity;
      const tolerance = kpi.config.tolerance ?? 0;
      const inRange = wordCount >= (min - tolerance) && wordCount <= (max + tolerance);
      rawScore = inRange ? maxScore : 0;
      evidence = inRange
        ? `Word count ${wordCount} is within range [${min}, ${max}]${tolerance > 0 ? ` (±${tolerance} tolerance)` : ''}`
        : `Word count ${wordCount} is outside range [${min}, ${max}]${tolerance > 0 ? ` (±${tolerance} tolerance)` : ''}`;
      break;
    }

    // Fix #9: 'function' scorer — delegates to custom KPI functions registered via the SDK.
    // If no function is registered for this KPI, returns 0 with a clear error.
    case 'function': {
      // Function scoring requires async and is handled by the runner/SDK layer.
      // In the synchronous scoreAutomatedKPI path, we return 0 with guidance.
      rawScore = 0;
      evidence = `Function scorer type requires a registered custom KPI function. ` +
        `Use @sensei/sdk registerKPI() to register a function for KPI "${kpi.id}", ` +
        `then use the Runner's judgeScorer callback to invoke it.`;
      break;
    }

    default: {
      rawScore = 0;
      evidence = `Unknown automated scoring type: ${kpi.config.type}`;
    }
  }

  const score = maxScore > 0 ? (rawScore / maxScore) * 100 : 0;

  return {
    kpi_id: kpi.id,
    kpi_name: kpi.name,
    score,
    raw_score: rawScore,
    max_score: maxScore,
    weight: kpi.weight,
    method: kpi.method,
    evidence,
  };
}

// ─── Scenario Score Aggregation ──────────────────────────────────────

export function calculateScenarioScore(kpis: KPIResult[]): number {
  const totalWeight = kpis.reduce((sum, k) => sum + k.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = kpis.reduce((sum, k) => sum + k.score * k.weight, 0);
  return weightedSum / totalWeight;
}

// ─── Layer Score Aggregation ─────────────────────────────────────────

export function calculateLayerScores(scenarios: ScenarioResult[]): LayerScores {
  const byLayer = new Map<EvaluationLayer, number[]>();

  for (const s of scenarios) {
    const scores = byLayer.get(s.layer) ?? [];
    scores.push(s.score);
    byLayer.set(s.layer, scores);
  }

  const avg = (nums: number[] | undefined): number => {
    if (!nums || nums.length === 0) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  };

  const execution = avg(byLayer.get('execution'));
  const reasoning = avg(byLayer.get('reasoning'));
  const self_improvement = avg(byLayer.get('self-improvement'));

  const overall =
    execution * LAYER_WEIGHTS['execution'] +
    reasoning * LAYER_WEIGHTS['reasoning'] +
    self_improvement * LAYER_WEIGHTS['self-improvement'];

  return { overall, execution, reasoning, self_improvement };
}

// ─── Badge Determination ─────────────────────────────────────────────

export { determineBadge };

// ─── Scorer Class ────────────────────────────────────────────────────

export class Scorer {
  scoreAutomatedKPI(kpi: KPIDefinition, agentOutput: string): KPIResult {
    return scoreAutomatedKPI(kpi, agentOutput);
  }

  calculateScenarioScore(kpis: KPIResult[]): number {
    return calculateScenarioScore(kpis);
  }

  calculateLayerScores(scenarios: ScenarioResult[]): LayerScores {
    return calculateLayerScores(scenarios);
  }

  determineBadge(score: number): Badge {
    return determineBadge(score);
  }
}
