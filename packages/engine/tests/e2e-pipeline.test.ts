/**
 * QP-2 — Full E2E pipeline test.
 *
 * Starts a real mock HTTP server, loads the ACTUAL SDR suite YAML,
 * creates a real HttpAdapter, runs through the Runner with deterministic
 * mock judge scoring, and verifies the complete SuiteResult structure.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { createMockServer } from './mock-server.js';
import { Runner } from '../src/runner.js';
import { createAdapter } from '../src/adapters/types.js';
import '../src/adapters/http.js'; // register http adapter
import type { SuiteDefinition, KPIResult, KPIDefinition } from '../src/types.js';

// ─── SDR-realistic mock responses keyed by prompt substrings ────────

const SDR_RESPONSES = new Map<string, string>([
  [
    'cold email',
    `Subject: Scaling engineering at Meridian?

Hi Sarah,

I noticed your recent post about the monolith-to-microservices migration at Meridian Health Systems — that's a massive undertaking with a 450-person engineering org.

At AgentOps, we help VPs of Engineering like you measure developer productivity during transitions like this, without overhead. Unlike LinearB, we never read code content.

Would you have 10 minutes this week for a quick call?

Best,
Alex`,
  ],
  [
    'analyze',
    `## Discovery Call Analysis

### Pain Points
1. Migration slowing release cadence
2. No clear productivity metrics
3. Difficulty justifying hires to the board

### BANT Assessment
- Budget: Series C funded, likely has budget
- Authority: VP of Engineering — decision maker
- Need: Clear need for productivity measurement
- Timeline: Immediate — board pressure

### Competitive Landscape
- Evaluated LinearB last quarter, rejected due to privacy concerns

### Next Steps
1. Schedule demo with solutions engineer
2. Include David Park (Engineering Manager)
3. Prepare privacy-focused positioning

### Call Quality: 8/10`,
  ],
  [
    '3-email',
    `## Email 1 — Day 0: Initial Outreach
Subject: Your microservices migration metrics

Hi Sarah...

## Email 2 — Day 3: Value Add
Subject: How Meridian can measure migration velocity

Sarah, I came across a case study...

## Email 3 — Day 7: Break-up
Subject: Should I close your file?

Sarah, I don't want to be a bother...`,
  ],
  [
    'explain',
    `I chose the subject line because it references Sarah's specific project and creates curiosity. I prioritized the migration pain point because it's timely. The value proposition was tailored around productivity measurement during transitions, which addresses her board-reporting challenge. I chose a low-commitment CTA because cold outreach conversion improves with lower asks. I considered but rejected: referencing mutual connections (none found), leading with pricing (too early), and using a case study (better for follow-up).`,
  ],
  [
    'strategic',
    `I chose the subject line because it references Sarah's specific project and creates curiosity. I prioritized the migration pain point because it's timely. The value proposition was tailored around productivity measurement during transitions. I chose a low-commitment CTA because cold outreach conversion improves with lower asks. I considered but rejected alternatives.`,
  ],
  [
    'revise',
    `Subject: Prove it to your board

Sarah,

You mentioned needing to justify two senior hires to the board — but without data on whether the microservices migration is a people problem or process problem, that's a tough sell.

AgentOps gives engineering leaders like you that data in under a week, with zero setup overhead.

Have 10 minutes to see how it works?

Best,
Alex

P.S. 73% of engineering leaders say they lack the metrics to justify headcount decisions (State of DevOps 2024).`,
  ],
  [
    'feedback',
    `Subject: Prove it to your board

Sarah, you need data to justify those hires. AgentOps delivers that in under a week.

Have 10 minutes?

P.S. 73% of engineering leaders lack metrics to justify headcount (State of DevOps 2024).`,
  ],
  ['default', 'This is a default SDR mock response for testing purposes.'],
]);

// ─── Deterministic judge/comparator scorers ─────────────────────────

function makeDeterministicJudge(): (
  kpi: KPIDefinition,
  agentOutput: string,
  scenarioInput: string,
) => Promise<KPIResult> {
  return async (kpi, agentOutput, _scenarioInput) => {
    const maxScore = kpi.config.max_score ?? 5;
    // Return 4/5 for all judge KPIs (80%)
    const rawScore = Math.round(maxScore * 0.8);
    return {
      kpi_id: kpi.id,
      kpi_name: kpi.name,
      score: (rawScore / maxScore) * 100,
      raw_score: rawScore,
      max_score: maxScore,
      weight: kpi.weight,
      method: kpi.method,
      evidence: `Deterministic judge: ${rawScore}/${maxScore}`,
    };
  };
}

function makeDeterministicComparator(): (
  kpi: KPIDefinition,
  task: string,
  feedback: string,
  originalOutput: string,
  revisedOutput: string,
) => Promise<KPIResult> {
  return async (kpi, _task, _feedback, _orig, _revised) => {
    const maxScore = kpi.config.max_score ?? 5;
    const rawScore = Math.round(maxScore * 0.8);
    return {
      kpi_id: kpi.id,
      kpi_name: kpi.name,
      score: (rawScore / maxScore) * 100,
      raw_score: rawScore,
      max_score: maxScore,
      weight: kpi.weight,
      method: kpi.method,
      evidence: `Deterministic comparator: ${rawScore}/${maxScore}`,
    };
  };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('E2E Pipeline: mock HTTP server → Runner → SuiteResult', () => {
  let mockServer: ReturnType<typeof createMockServer>;
  let baseUrl: string;
  let suite: SuiteDefinition;

  beforeAll(async () => {
    // Start mock HTTP server on random port
    mockServer = createMockServer({ responses: SDR_RESPONSES });
    const port = await mockServer.start();
    baseUrl = mockServer.url();

    // Load ACTUAL SDR suite YAML (it has no 'agent' field, so parse raw + add agent)
    const suitePath = resolve(import.meta.dirname ?? __dirname, '../../../suites/sdr-qualification/suite.yaml');
    const content = await readFile(suitePath, 'utf-8');
    suite = YAML.parse(content) as SuiteDefinition;

    // Override agent config to point at our mock server
    suite.agent = {
      adapter: 'http',
      endpoint: baseUrl,
      timeout_ms: 10_000,
      health_check: `${baseUrl}/health`,
    };
  });

  afterAll(async () => {
    await mockServer.stop();
  });

  it('loads the real SDR suite with 5 scenarios', () => {
    expect(suite.id).toBe('sdr-qualification');
    expect(suite.version).toBe('1.0.0');
    expect(suite.scenarios).toHaveLength(5);
  });

  it('runs the full pipeline and produces a valid SuiteResult', async () => {
    const adapter = createAdapter(suite.agent);
    const progressCalls: number[] = [];

    const runner = new Runner(adapter, {
      retries: 1,
      onScenarioComplete: (_res, idx) => progressCalls.push(idx),
      judgeScorer: makeDeterministicJudge(),
      comparatorScorer: makeDeterministicComparator(),
    });

    const result = await runner.run(suite);

    // ── Structure ──
    expect(result.suite_id).toBe('sdr-qualification');
    expect(result.suite_version).toBe('1.0.0');
    expect(result.agent_id).toBe('http');
    expect(result.timestamp).toBeTruthy();
    expect(result.duration_ms).toBeGreaterThan(0);
    expect(result.badge).toBeDefined();

    // ── All 5 scenarios scored ──
    expect(result.scenarios).toHaveLength(5);
    const scenarioIds = result.scenarios.map((s) => s.scenario_id);
    expect(scenarioIds).toContain('cold-email-personalization');
    expect(scenarioIds).toContain('discovery-call-analysis');
    expect(scenarioIds).toContain('email-sequence-design');
    expect(scenarioIds).toContain('explain-outreach-strategy');
    expect(scenarioIds).toContain('improve-cold-email');

    // ── Each scenario has KPIs and valid scores ──
    for (const scenario of result.scenarios) {
      expect(scenario.kpis.length).toBeGreaterThan(0);
      expect(scenario.score).toBeGreaterThanOrEqual(0);
      expect(scenario.score).toBeLessThanOrEqual(100);
      expect(scenario.agent_output).toBeTruthy();
      expect(scenario.agent_input).toBeTruthy();
      expect(scenario.duration_ms).toBeGreaterThanOrEqual(0);
    }

    // ── Layer scores ──
    expect(result.scores).toHaveProperty('overall');
    expect(result.scores).toHaveProperty('execution');
    expect(result.scores).toHaveProperty('reasoning');
    expect(result.scores).toHaveProperty('self_improvement');
    expect(result.scores.execution).toBeGreaterThan(0);
    expect(result.scores.reasoning).toBeGreaterThan(0);
    expect(result.scores.self_improvement).toBeGreaterThan(0);
    expect(result.scores.overall).toBeGreaterThan(0);

    // ── Badge assigned (deterministic 80% → silver) ──
    expect(['bronze', 'silver', 'gold']).toContain(result.badge);

    // ── Progress callback fired for each scenario ──
    expect(progressCalls).toHaveLength(5);
    expect(progressCalls).toEqual([0, 1, 2, 3, 4]);
  });

  it('execution layer scenarios are scored correctly', async () => {
    const adapter = createAdapter(suite.agent);
    const runner = new Runner(adapter, {
      judgeScorer: makeDeterministicJudge(),
      comparatorScorer: makeDeterministicComparator(),
    });
    const result = await runner.run(suite);

    const execScenarios = result.scenarios.filter((s) => s.layer === 'execution');
    expect(execScenarios).toHaveLength(3);

    for (const s of execScenarios) {
      // All execution scenarios should have non-zero scores
      expect(s.score).toBeGreaterThan(0);
      // Each KPI should have been scored
      for (const kpi of s.kpis) {
        expect(kpi.score).toBeGreaterThanOrEqual(0);
        expect(kpi.evidence).toBeTruthy();
      }
    }
  });

  it('reasoning scenario receives depends_on output', async () => {
    const adapter = createAdapter(suite.agent);
    const runner = new Runner(adapter, {
      judgeScorer: makeDeterministicJudge(),
      comparatorScorer: makeDeterministicComparator(),
    });
    const result = await runner.run(suite);

    const reasoning = result.scenarios.find((s) => s.scenario_id === 'explain-outreach-strategy')!;
    expect(reasoning).toBeDefined();
    expect(reasoning.layer).toBe('reasoning');
    // Should have "Previous output:" injected from cold-email-personalization
    expect(reasoning.agent_input).toContain('Previous output:');
  });

  it('self-improvement scenario uses depends_on and feedback correctly', async () => {
    const adapter = createAdapter(suite.agent);
    const runner = new Runner(adapter, {
      judgeScorer: makeDeterministicJudge(),
      comparatorScorer: makeDeterministicComparator(),
    });
    const result = await runner.run(suite);

    const si = result.scenarios.find((s) => s.scenario_id === 'improve-cold-email')!;
    expect(si).toBeDefined();
    expect(si.layer).toBe('self-improvement');
    // Should have depends_on output injected
    expect(si.agent_input).toContain('Previous output:');
    // Should have feedback injected
    expect(si.agent_input).toContain('Feedback:');
    // All KPIs should be comparative-judge, scored by our deterministic comparator
    for (const kpi of si.kpis) {
      expect(kpi.method).toBe('comparative-judge');
      expect(kpi.score).toBe(80); // 4/5 = 80%
    }
  });

  it('layer scores aggregate correctly with weights', async () => {
    const adapter = createAdapter(suite.agent);
    const runner = new Runner(adapter, {
      judgeScorer: makeDeterministicJudge(),
      comparatorScorer: makeDeterministicComparator(),
    });
    const result = await runner.run(suite);

    // With deterministic 80% judge scoring:
    // - Execution: mix of judge (80%) and automated (varies) KPIs
    // - Reasoning: all judge (80%)
    // - Self-improvement: all comparator (80%)
    expect(result.scores.reasoning).toBeCloseTo(80, 0);
    expect(result.scores.self_improvement).toBeCloseTo(80, 0);

    // Overall = exec*0.5 + reason*0.3 + si*0.2
    const expectedOverall =
      result.scores.execution * 0.5 +
      result.scores.reasoning * 0.3 +
      result.scores.self_improvement * 0.2;
    expect(result.scores.overall).toBeCloseTo(expectedOverall, 0);
  });
});
