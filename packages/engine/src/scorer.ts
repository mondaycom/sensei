/**
 * Scorer — calculates KPI scores and aggregates them into layer/overall scores.
 */

import _Ajv from 'ajv';
const Ajv = _Ajv as unknown as typeof _Ajv.default;
import type {
  KPIDefinition,
  KPIResult,
  ScenarioResult,
  LayerScores,
  Badge,
  EvaluationLayer,
} from './types.js';
import { LAYER_WEIGHTS, determineBadge } from './types.js';

// Singleton Ajv instance for JSON Schema validation (Fix #4)
const ajv = new Ajv({ allErrors: true });

// Fix #8: ReDoS protection constants
const REGEX_MAX_INPUT_LENGTH = 10_000; // Truncate input to prevent catastrophic backtracking

/**
 * Safely test a regex against input, catching errors from catastrophic backtracking.
 * Returns null if the regex errors out.
 */
function safeRegexTest(pattern: RegExp, input: string): boolean | null {
  try {
    return pattern.test(input);
  } catch {
    return null;
  }
}

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
      const patternStr = String(kpi.config.expected ?? '');
      try {
        const pattern = new RegExp(patternStr);
        // Fix #8: ReDoS protection — run regex with a timeout guard.
        // We limit the input length and use a try/catch to handle catastrophic backtracking.
        const truncatedOutput = agentOutput.slice(0, REGEX_MAX_INPUT_LENGTH);
        const match = safeRegexTest(pattern, truncatedOutput);
        if (match === null) {
          rawScore = 0;
          evidence = `Regex /${patternStr}/ timed out or errored — possible ReDoS pattern`;
        } else {
          rawScore = match ? maxScore : 0;
          evidence = match
            ? `Output matches regex /${patternStr}/`
            : `Output does not match regex /${patternStr}/`;
        }
      } catch {
        rawScore = 0;
        evidence = `Invalid regex pattern: /${patternStr}/`;
      }
      break;
    }

    // Fix #4: Real JSON Schema validation using ajv.
    // If config.expected contains a JSON Schema object, validates against it.
    // If no schema is provided, falls back to checking if output is valid JSON.
    case 'json-schema': {
      try {
        const parsed = JSON.parse(agentOutput);
        const schema = kpi.config.expected;
        if (schema && typeof schema === 'object') {
          // Validate against the provided JSON Schema
          const validate = ajv.compile(schema as Record<string, unknown>);
          const valid = validate(parsed);
          if (valid) {
            rawScore = maxScore;
            evidence = 'Output is valid JSON and conforms to the provided schema';
          } else {
            rawScore = 0;
            const errors = validate.errors
              ?.map((e: { instancePath?: string; message?: string }) => `${e.instancePath || '/'}: ${e.message}`)
              .join('; ') ?? 'unknown validation error';
            evidence = `Output is valid JSON but does not conform to schema: ${errors}`;
          }
        } else {
          // No schema provided — fall back to JSON parse check only
          rawScore = maxScore;
          evidence = 'Output is valid JSON (no schema provided for validation)';
        }
      } catch {
        rawScore = 0;
        evidence = 'Output is not valid JSON';
      }
      break;
    }

    // Alias: json-parse only checks if output is valid JSON (no schema validation)
    case 'json-parse': {
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
        `Use @mondaycom/sensei-sdk registerKPI() to register a function for KPI "${kpi.id}", ` +
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

/**
 * Calculate layer scores and overall weighted score from scenario results.
 *
 * Fix #3: Missing layers are excluded from the weighted overall calculation.
 * If a suite only defines execution scenarios (no reasoning/self-improvement),
 * those missing layers are skipped entirely rather than scoring 0 and dragging
 * down the maximum possible score. The individual layer scores still report 0
 * for missing layers, but the overall score only weights layers that have data.
 *
 * Example: A suite with only execution scenarios can achieve 100% overall,
 * not be capped at 50% due to missing layers.
 */
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

  // Fix #3: Only weight layers that actually have scenarios.
  // This prevents missing layers from penalizing the overall score.
  const layers: [EvaluationLayer, number][] = [
    ['execution', execution],
    ['reasoning', reasoning],
    ['self-improvement', self_improvement],
  ];

  const presentLayers = layers.filter(([layer]) => byLayer.has(layer));
  let overall: number;

  if (presentLayers.length === 0) {
    overall = 0;
  } else {
    const totalWeight = presentLayers.reduce((sum, [layer]) => sum + LAYER_WEIGHTS[layer], 0);
    overall = presentLayers.reduce(
      (sum, [layer, score]) => sum + score * (LAYER_WEIGHTS[layer] / totalWeight),
      0,
    );
  }

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
