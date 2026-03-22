import { describe, it, expect } from 'vitest';
import { pickScenariosByLayer } from '../src/loader.js';
import type { SuiteDefinition, ScenarioDefinition, EvaluationLayer } from '../src/types.js';

function makeScenario(id: string, layer: EvaluationLayer): ScenarioDefinition {
  return {
    id,
    name: `Scenario ${id}`,
    layer,
    input: { prompt: `Prompt for ${id}` },
    kpis: [{ id: 'k1', name: 'K1', weight: 1, method: 'llm-judge', config: { rubric: 'test' } }],
  };
}

function makeSuite(
  scenarios: ScenarioDefinition[],
  evaluation?: SuiteDefinition['evaluation'],
): SuiteDefinition {
  return {
    id: 'test-suite',
    name: 'Test Suite',
    version: '1.0',
    evaluation,
    scenarios,
  };
}

describe('pickScenariosByLayer', () => {
  const exec1 = makeScenario('exec-1', 'execution');
  const exec2 = makeScenario('exec-2', 'execution');
  const exec3 = makeScenario('exec-3', 'execution');
  const reason1 = makeScenario('reason-1', 'reasoning');
  const reason2 = makeScenario('reason-2', 'reasoning');
  const selfImp1 = makeScenario('self-1', 'self-improvement');

  const allScenarios = [exec1, exec2, exec3, reason1, reason2, selfImp1];

  it('returns all scenarios when no evaluation config', () => {
    const suite = makeSuite(allScenarios);
    const result = pickScenariosByLayer(suite);
    expect(result).toHaveLength(6);
    expect(result.map((s) => s.id)).toEqual(['exec-1', 'exec-2', 'exec-3', 'reason-1', 'reason-2', 'self-1']);
  });

  it('returns all scenarios when evaluation config has no scenarios_per_layer', () => {
    const suite = makeSuite(allScenarios, {});
    const result = pickScenariosByLayer(suite);
    expect(result).toHaveLength(6);
  });

  it('picks specified count per layer, includes all for undefined layers', () => {
    const suite = makeSuite(allScenarios, {
      scenarios_per_layer: {
        execution: 1,
        // reasoning: omitted → all 2
        // self-improvement: omitted → all 1
      },
    });
    const result = pickScenariosByLayer(suite, 42);
    // 1 execution + 2 reasoning + 1 self-improvement = 4
    expect(result).toHaveLength(4);

    const execPicked = result.filter((s) => s.layer === 'execution');
    const reasonPicked = result.filter((s) => s.layer === 'reasoning');
    const selfPicked = result.filter((s) => s.layer === 'self-improvement');
    expect(execPicked).toHaveLength(1);
    expect(reasonPicked).toHaveLength(2);
    expect(selfPicked).toHaveLength(1);
  });

  it('picks 1 from each layer when all specified as 1', () => {
    const suite = makeSuite(allScenarios, {
      scenarios_per_layer: {
        execution: 1,
        reasoning: 1,
        'self-improvement': 1,
      },
    });
    const result = pickScenariosByLayer(suite, 42);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.layer)).toEqual(['execution', 'reasoning', 'self-improvement']);
  });

  it('preserves YAML definition order', () => {
    // Reverse order in YAML: self-improvement first, then reasoning, then execution
    const reversed = [selfImp1, reason1, reason2, exec1, exec2, exec3];
    const suite = makeSuite(reversed, {
      scenarios_per_layer: {
        execution: 1,
        reasoning: 1,
        'self-improvement': 1,
      },
    });
    const result = pickScenariosByLayer(suite, 42);
    expect(result).toHaveLength(3);
    // Order should follow YAML: self-improvement → reasoning → execution
    expect(result[0].layer).toBe('self-improvement');
    expect(result[1].layer).toBe('reasoning');
    expect(result[2].layer).toBe('execution');
  });

  it('clamps when count exceeds available scenarios', () => {
    const suite = makeSuite(allScenarios, {
      scenarios_per_layer: {
        execution: 10, // only 3 available
      },
    });
    const result = pickScenariosByLayer(suite, 42);
    const execPicked = result.filter((s) => s.layer === 'execution');
    expect(execPicked).toHaveLength(3); // clamped to available
  });

  it('is deterministic with same seed', () => {
    const suite = makeSuite(allScenarios, {
      scenarios_per_layer: { execution: 1, reasoning: 1 },
    });
    const r1 = pickScenariosByLayer(suite, 123);
    const r2 = pickScenariosByLayer(suite, 123);
    expect(r1.map((s) => s.id)).toEqual(r2.map((s) => s.id));
  });

  it('produces different results with different seeds', () => {
    const suite = makeSuite(allScenarios, {
      scenarios_per_layer: { execution: 1 },
    });
    // Run with many seeds to find at least one different pick
    const picks = new Set<string>();
    for (let seed = 0; seed < 20; seed++) {
      const result = pickScenariosByLayer(suite, seed);
      const execId = result.find((s) => s.layer === 'execution')!.id;
      picks.add(execId);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});
