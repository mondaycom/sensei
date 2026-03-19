/**
 * T8.10 — SDK tests: builder validation, custom KPI, result utils
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  SuiteBuilder,
  scenario,
  kpi,
  defineSuite,
} from '../src/builder.js';
import {
  registerKPI,
  getCustomKPI,
  listCustomKPIs,
  clearCustomKPIs,
} from '../src/custom-kpi.js';
import {
  filterByLayer,
  compareResults,
  formatSummary,
} from '../src/result-utils.js';
import type { SuiteResult } from '@mondaycom/sensei-engine';

// ─── SuiteBuilder ───────────────────────────────────────────────────

describe('SuiteBuilder', () => {
  it('builds a valid suite', () => {
    const suite = new SuiteBuilder()
      .id('test')
      .name('Test Suite')
      .version('1.0.0')
      .agent({ adapter: 'http', endpoint: 'http://localhost:3000' })
      .addScenario(
        scenario('s1', {
          layer: 'execution',
          input: { prompt: 'Do something' },
          kpis: [
            kpi('k1', { weight: 1.0, method: 'automated', config: { type: 'contains', expected: 'hello' } }),
          ],
        }),
      )
      .build();

    expect(suite.id).toBe('test');
    expect(suite.name).toBe('Test Suite');
    expect(suite.scenarios).toHaveLength(1);
    expect(suite.scenarios[0].kpis[0].weight).toBe(1.0);
  });

  it('validates missing id', () => {
    const builder = new SuiteBuilder()
      .name('Test')
      .version('1.0.0')
      .addScenario(
        scenario('s1', {
          layer: 'execution',
          input: { prompt: 'test' },
          kpis: [kpi('k1', { weight: 0.5, method: 'automated', config: {} })],
        }),
      );

    expect(() => builder.build()).toThrow('Suite id is required');
  });

  it('validates missing scenarios', () => {
    const builder = new SuiteBuilder().id('test').name('Test').version('1.0.0');
    expect(() => builder.build()).toThrow('At least one scenario');
  });

  it('detects duplicate scenario ids', () => {
    const builder = new SuiteBuilder()
      .id('test').name('Test').version('1.0.0')
      .addScenario(scenario('s1', { layer: 'execution', input: { prompt: 'a' }, kpis: [kpi('k1', { weight: 0.5, method: 'automated', config: {} })] }))
      .addScenario(scenario('s1', { layer: 'reasoning', input: { prompt: 'b' }, kpis: [kpi('k2', { weight: 0.5, method: 'automated', config: {} })] }));

    expect(() => builder.build()).toThrow('Duplicate scenario id');
  });

  it('detects invalid KPI weight', () => {
    const builder = new SuiteBuilder()
      .id('test').name('Test').version('1.0.0')
      .addScenario(scenario('s1', { layer: 'execution', input: { prompt: 'a' }, kpis: [kpi('k1', { weight: 2.0, method: 'automated', config: {} })] }));

    expect(() => builder.build()).toThrow('invalid weight');
  });

  it('sets metadata and description', () => {
    const suite = new SuiteBuilder()
      .id('test').name('Test').version('1.0.0')
      .description('A test suite')
      .metadata({ author: 'tester' })
      .agent({ adapter: 'http' })
      .addScenario(scenario('s1', { layer: 'execution', input: { prompt: 'a' }, kpis: [kpi('k1', { weight: 0.5, method: 'automated', config: {} })] }))
      .build();

    expect(suite.description).toBe('A test suite');
    expect(suite.metadata).toEqual({ author: 'tester' });
  });
});

describe('defineSuite', () => {
  it('returns the definition as-is', () => {
    const def = defineSuite({
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      agent: { adapter: 'http' },
      scenarios: [],
    });
    expect(def.id).toBe('test');
  });
});

describe('scenario helper', () => {
  it('uses id as name when name is omitted', () => {
    const s = scenario('my-scenario', {
      layer: 'execution',
      input: { prompt: 'test' },
      kpis: [],
    });
    expect(s.name).toBe('my-scenario');
  });

  it('uses provided name', () => {
    const s = scenario('my-scenario', {
      name: 'My Scenario',
      layer: 'reasoning',
      input: { prompt: 'test' },
      kpis: [],
    });
    expect(s.name).toBe('My Scenario');
  });
});

describe('kpi helper', () => {
  it('uses id as name when name is omitted', () => {
    const k = kpi('my-kpi', { weight: 0.5, method: 'llm-judge', config: { rubric: 'test' } });
    expect(k.name).toBe('my-kpi');
  });
});

// ─── Custom KPI Registration ────────────────────────────────────────

describe('Custom KPI registration', () => {
  beforeEach(() => {
    clearCustomKPIs();
  });

  it('registers and retrieves a custom KPI', () => {
    registerKPI({
      id: 'word-count',
      name: 'Word Count',
      maxScore: 100,
      fn: (output) => output.split(/\s+/).length,
    });

    const entry = getCustomKPI('word-count');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('Word Count');
  });

  it('executes the custom scoring function', async () => {
    registerKPI({
      id: 'word-count',
      name: 'Word Count',
      maxScore: 100,
      fn: (output) => Math.min(output.split(/\s+/).length, 100),
    });

    const entry = getCustomKPI('word-count')!;
    const score = await entry.fn('hello world foo bar');
    expect(score).toBe(4);
  });

  it('prevents duplicate registration', () => {
    registerKPI({ id: 'dup', name: 'Dup', maxScore: 10, fn: () => 5 });
    expect(() => registerKPI({ id: 'dup', name: 'Dup2', maxScore: 10, fn: () => 5 })).toThrow('already registered');
  });

  it('rejects non-positive maxScore', () => {
    expect(() => registerKPI({ id: 'bad', name: 'Bad', maxScore: 0, fn: () => 0 })).toThrow('maxScore must be positive');
  });

  it('lists all registered KPIs', () => {
    registerKPI({ id: 'a', name: 'A', maxScore: 10, fn: () => 1 });
    registerKPI({ id: 'b', name: 'B', maxScore: 10, fn: () => 2 });
    const all = listCustomKPIs();
    expect(all).toHaveLength(2);
    expect(all.map((k) => k.id)).toEqual(['a', 'b']);
  });

  it('returns undefined for unknown KPI', () => {
    expect(getCustomKPI('unknown')).toBeUndefined();
  });
});

// ─── Result Utilities ───────────────────────────────────────────────

function makeSuiteResult(overrides: Partial<SuiteResult> = {}): SuiteResult {
  return {
    suite_id: 'test',
    suite_version: '1.0.0',
    agent_id: 'agent-1',
    timestamp: '2026-01-01T00:00:00Z',
    scores: { overall: 80, execution: 85, reasoning: 75, self_improvement: 70 },
    scenarios: [
      { scenario_id: 's1', scenario_name: 'S1', layer: 'execution', score: 85, kpis: [], duration_ms: 1000, agent_input: '', agent_output: '' },
      { scenario_id: 's2', scenario_name: 'S2', layer: 'reasoning', score: 75, kpis: [], duration_ms: 1200, agent_input: '', agent_output: '' },
      { scenario_id: 's3', scenario_name: 'S3', layer: 'self-improvement', score: 70, kpis: [], duration_ms: 800, agent_input: '', agent_output: '' },
    ],
    badge: 'silver',
    duration_ms: 3000,
    ...overrides,
  };
}

describe('filterByLayer', () => {
  it('filters execution scenarios', () => {
    const result = makeSuiteResult();
    const filtered = filterByLayer(result, 'execution');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].scenario_id).toBe('s1');
  });

  it('filters reasoning scenarios', () => {
    const result = makeSuiteResult();
    expect(filterByLayer(result, 'reasoning')).toHaveLength(1);
  });

  it('filters self-improvement scenarios', () => {
    const result = makeSuiteResult();
    expect(filterByLayer(result, 'self-improvement')).toHaveLength(1);
  });

  it('returns empty for missing layer', () => {
    const result = makeSuiteResult({ scenarios: [] });
    expect(filterByLayer(result, 'execution')).toHaveLength(0);
  });
});

describe('compareResults', () => {
  it('computes deltas between two results', () => {
    const before = makeSuiteResult({ scores: { overall: 70, execution: 75, reasoning: 65, self_improvement: 60 }, badge: 'bronze' });
    const after = makeSuiteResult({ scores: { overall: 85, execution: 90, reasoning: 80, self_improvement: 75 }, badge: 'silver' });

    const comparison = compareResults(before, after);
    expect(comparison.improved).toBe(true);
    expect(comparison.delta.overall).toBe(15);
    expect(comparison.delta.execution).toBe(15);
    expect(comparison.before.badge).toBe('bronze');
    expect(comparison.after.badge).toBe('silver');
  });

  it('detects no improvement', () => {
    const before = makeSuiteResult({ scores: { overall: 90, execution: 90, reasoning: 90, self_improvement: 90 } });
    const after = makeSuiteResult({ scores: { overall: 80, execution: 85, reasoning: 75, self_improvement: 70 } });

    const comparison = compareResults(before, after);
    expect(comparison.improved).toBe(false);
    expect(comparison.delta.overall).toBe(-10);
  });

  it('handles missing before scenarios in deltas', () => {
    const before = makeSuiteResult({ scenarios: [] });
    const after = makeSuiteResult();

    const comparison = compareResults(before, after);
    expect(comparison.scenarioDeltas).toHaveLength(3);
    expect(comparison.scenarioDeltas[0].before).toBe(0);
  });
});

describe('formatSummary', () => {
  it('formats a one-line summary', () => {
    const result = makeSuiteResult();
    const summary = formatSummary(result);
    expect(summary).toContain('test v1.0.0');
    expect(summary).toContain('agent-1');
    expect(summary).toContain('80.0');
    expect(summary).toContain('SILVER');
    expect(summary).toContain('3 scenarios');
  });

  it('shows NO BADGE for low scores', () => {
    const result = makeSuiteResult({ scores: { overall: 40, execution: 40, reasoning: 40, self_improvement: 40 }, badge: 'none' });
    const summary = formatSummary(result);
    expect(summary).toContain('NO BADGE');
  });
});
