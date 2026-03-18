/**
 * Runner — orchestrates scenario execution for a suite.
 *
 * Flow: load suite → validate → init adapter → health check → run scenarios by layer order → aggregate → return SuiteResult
 */

import type {
  SuiteDefinition,
  ScenarioDefinition,
  ScenarioResult,
  KPIResult,
  SuiteResult,
  AgentAdapter,
  EvaluationLayer,
  ConcurrencyOptions,
  ProgressCallback,
  ProgressEvent,
  ProgressEventType,
} from './types.js';
import { scoreAutomatedKPI, calculateScenarioScore, calculateLayerScores } from './scorer.js';
import { determineBadge, qualifiedSuiteId } from './types.js';
import { Semaphore } from './semaphore.js';

export interface RunnerOptions {
  /** Maximum retries per scenario on failure */
  retries?: number;
  /** Override per-scenario timeout (ms) */
  timeout_ms?: number;
  /** Callback for progress updates (legacy — prefer onProgress) */
  onScenarioComplete?: (result: ScenarioResult, index: number, total: number) => void;
  /** Rich progress callback with typed events */
  onProgress?: ProgressCallback;
  /** Concurrency limits */
  concurrency?: ConcurrencyOptions;
  /** External KPI scorer for llm-judge KPIs */
  judgeScorer?: (
    kpi: import('./types.js').KPIDefinition,
    agentOutput: string,
    scenarioInput: string,
  ) => Promise<KPIResult>;
  /** External scorer for comparative-judge KPIs (self-improvement layer) */
  comparatorScorer?: (
    kpi: import('./types.js').KPIDefinition,
    task: string,
    feedback: string,
    originalOutput: string,
    revisedOutput: string,
  ) => Promise<KPIResult>;
}

const LAYER_ORDER: EvaluationLayer[] = ['execution', 'reasoning', 'self-improvement'];
const DEFAULT_SCENARIO_CONCURRENCY = 5;

export class Runner {
  private adapter: AgentAdapter;
  private options: RunnerOptions;

  constructor(adapter: AgentAdapter, options: RunnerOptions = {}) {
    this.adapter = adapter;
    this.options = options;
  }

  async run(suite: SuiteDefinition): Promise<SuiteResult> {
    const startTime = Date.now();
    const emit = this.createEmitter(startTime);

    // Validate depends_on references before running (M8)
    const scenarioIds = new Set(suite.scenarios.map((s) => s.id));
    const badDeps = suite.scenarios
      .filter((s) => s.depends_on && !scenarioIds.has(s.depends_on))
      .map((s) => `"${s.id}" depends on unknown "${s.depends_on}"`);
    if (badDeps.length > 0) {
      throw new Error(`Unresolved depends_on references:\n  ${badDeps.join('\n  ')}`);
    }

    // Validate scenario ID uniqueness within qualified suite
    const seenScenarioIds = new Set<string>();
    for (const s of suite.scenarios) {
      if (seenScenarioIds.has(s.id)) {
        throw new Error(`Duplicate scenario ID "${s.id}" in suite "${qualifiedSuiteId(suite)}"`);
      }
      seenScenarioIds.add(s.id);
    }

    emit('suite:started', { scenario_id: qualifiedSuiteId(suite) });

    // Connect and health check
    await this.adapter.connect();
    try {
      const healthy = await this.adapter.healthCheck();
      if (!healthy) {
        throw new Error(`Agent health check failed for adapter "${this.adapter.name}"`);
      }

      // Sort scenarios by layer order, preserving definition order within layers
      const sorted = this.sortByLayer(suite.scenarios);

      // Track outputs for depends_on references
      const outputMap = new Map<string, string>();
      const results: ScenarioResult[] = [];
      let completedCount = 0;
      const total = sorted.length;

      // Group scenarios by layer for concurrent execution within each layer
      const scenarioConcurrency = this.options.concurrency?.scenarios ?? DEFAULT_SCENARIO_CONCURRENCY;
      const semaphore = new Semaphore(scenarioConcurrency);

      // Helper to run a scenario with error wrapping for partial suite completion
      const runWithErrorCapture = async (scenario: ScenarioDefinition): Promise<ScenarioResult> => {
        try {
          return await this.runScenarioWithRetry(scenario, outputMap, suite);
        } catch (unexpected) {
          // Unexpected error — record it so the suite continues with remaining scenarios
          const msg = unexpected instanceof Error ? unexpected.message : String(unexpected);
          return {
            scenario_id: scenario.id,
            scenario_name: scenario.name,
            layer: scenario.layer,
            score: 0,
            kpis: [],
            duration_ms: 0,
            agent_input: scenario.input.prompt,
            agent_output: '',
            error: `Unexpected error: ${msg}`,
          };
        }
      };

      // Process by layer groups — scenarios within the same layer can run concurrently
      // (unless they have depends_on within the same layer, handled by outputMap wait)
      for (const layer of LAYER_ORDER) {
        const layerScenarios = sorted.filter((s) => s.layer === layer);
        if (layerScenarios.length === 0) continue;

        // Scenarios with depends_on must wait for their dependency.
        // Within a layer, independent scenarios run concurrently.
        const independent = layerScenarios.filter((s) => !s.depends_on || !scenarioIds.has(s.depends_on));
        const dependent = layerScenarios.filter((s) => s.depends_on && scenarioIds.has(s.depends_on));

        // Run independent scenarios concurrently with semaphore
        const independentResults = await Promise.all(
          independent.map((scenario) =>
            semaphore.run(async () => {
              emit('scenario:started', {
                scenario_id: scenario.id,
                progress: { completed: completedCount, total },
              });

              const result = await runWithErrorCapture(scenario);
              outputMap.set(scenario.id, result.agent_output);
              completedCount++;

              emit('scenario:completed', {
                scenario_id: scenario.id,
                score: result.score,
                progress: { completed: completedCount, total },
              });

              this.options.onScenarioComplete?.(result, completedCount - 1, total);
              return result;
            }),
          ),
        );
        results.push(...independentResults);

        // Run dependent scenarios sequentially (they need prior outputs)
        for (const scenario of dependent) {
          const result = await semaphore.run(async () => {
            emit('scenario:started', {
              scenario_id: scenario.id,
              progress: { completed: completedCount, total },
            });

            const r = await runWithErrorCapture(scenario);
            outputMap.set(scenario.id, r.agent_output);
            completedCount++;

            emit('scenario:completed', {
              scenario_id: scenario.id,
              score: r.score,
              progress: { completed: completedCount, total },
            });

            this.options.onScenarioComplete?.(r, completedCount - 1, total);
            return r;
          });
          results.push(result);
        }
      }

      // Aggregate scores — works even with partial results (failed scenarios score 0)
      const scores = calculateLayerScores(results);
      const badge = determineBadge(scores.overall);

      const suiteResult: SuiteResult = {
        suite_id: qualifiedSuiteId(suite),
        suite_version: suite.version,
        agent_id: this.adapter.name,
        timestamp: new Date().toISOString(),
        scores,
        scenarios: results,
        badge,
        duration_ms: Date.now() - startTime,
        judge_model: suite.judge?.model,
      };

      emit('suite:completed', {
        score: scores.overall,
        badge,
      });

      return suiteResult;
    } finally {
      // M1: Always disconnect adapter, even on error
      await this.adapter.disconnect();
    }
  }

  private createEmitter(startTime: number): (type: ProgressEventType, extra?: Partial<ProgressEvent>) => void {
    return (type, extra = {}) => {
      if (!this.options.onProgress) return;
      const event: ProgressEvent = {
        type,
        timestamp: new Date().toISOString(),
        elapsed_ms: Date.now() - startTime,
        ...extra,
      };
      this.options.onProgress(event);
    };
  }

  private sortByLayer(scenarios: ScenarioDefinition[]): ScenarioDefinition[] {
    return [...scenarios].sort((a, b) => {
      return LAYER_ORDER.indexOf(a.layer) - LAYER_ORDER.indexOf(b.layer);
    });
  }

  private async runScenarioWithRetry(
    scenario: ScenarioDefinition,
    outputMap: Map<string, string>,
    suite: SuiteDefinition,
  ): Promise<ScenarioResult> {
    const maxRetries = this.options.retries ?? 0;
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.runScenario(scenario, outputMap, suite);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < maxRetries) continue;
      }
    }

    // All retries exhausted — return error result
    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      layer: scenario.layer,
      score: 0,
      kpis: [],
      duration_ms: 0,
      agent_input: scenario.input.prompt,
      agent_output: '',
      error: lastError,
    };
  }

  private async runScenario(
    scenario: ScenarioDefinition,
    outputMap: Map<string, string>,
    suite: SuiteDefinition,
  ): Promise<ScenarioResult> {
    const startTime = Date.now();
    const emit = this.createEmitter(startTime);

    // Build prompt, injecting dependency output if needed
    let prompt = scenario.input.prompt;
    if (scenario.depends_on) {
      const depOutput = outputMap.get(scenario.depends_on);
      if (depOutput) {
        prompt = `Previous output:\n${depOutput}\n\n${prompt}`;
      }
    }
    if (scenario.input.feedback) {
      prompt = `${prompt}\n\nFeedback: ${scenario.input.feedback}`;
    }

    // Send to agent
    const timeout = this.options.timeout_ms ?? suite.agent?.timeout_ms;
    let output: import('./types.js').AdapterOutput;
    try {
      output = await this.adapter.send({
        prompt,
        context: scenario.input.context,
        timeout_ms: timeout,
      });
    } catch (sendErr) {
      const msg = sendErr instanceof Error ? sendErr.message : String(sendErr);
      throw new Error(`Adapter send failed: ${msg}`);
    }

    if (output.error) {
      throw new Error(output.error);
    }

    // Guard against malformed adapter responses (null, undefined, non-string)
    if (output.response == null || typeof output.response !== 'string') {
      output = { ...output, response: String(output.response ?? '') };
    }

    // Score each KPI — errors in individual KPIs don't fail the whole scenario
    const kpis: KPIResult[] = [];
    for (const kpiDef of scenario.kpis) {
      emit('scoring:started', { scenario_id: scenario.id, kpi_id: kpiDef.id });

      let kpiResult: KPIResult;
      try {
        if (kpiDef.method === 'automated') {
          kpiResult = scoreAutomatedKPI(kpiDef, output.response);
        } else if (
          kpiDef.method === 'comparative-judge' &&
          this.options.comparatorScorer &&
          scenario.depends_on
        ) {
          const originalOutput = outputMap.get(scenario.depends_on) ?? '';
          kpiResult = await this.options.comparatorScorer(
            kpiDef,
            scenario.input.prompt,
            scenario.input.feedback ?? '',
            originalOutput,
            output.response,
          );
        } else if (this.options.judgeScorer) {
          kpiResult = await this.options.judgeScorer(kpiDef, output.response, prompt);
        } else {
          // No judge available — score 0 with explanation
          kpiResult = {
            kpi_id: kpiDef.id,
            kpi_name: kpiDef.name,
            score: 0,
            raw_score: 0,
            max_score: kpiDef.config.max_score ?? 10,
            weight: kpiDef.weight,
            method: kpiDef.method,
            evidence: `No judge configured for ${kpiDef.method} scoring`,
          };
        }
      } catch (kpiErr) {
        // KPI scoring failed (e.g., judge timeout) — record error, don't crash scenario
        const msg = kpiErr instanceof Error ? kpiErr.message : String(kpiErr);
        kpiResult = {
          kpi_id: kpiDef.id,
          kpi_name: kpiDef.name,
          score: 0,
          raw_score: 0,
          max_score: kpiDef.config.max_score ?? 10,
          weight: kpiDef.weight,
          method: kpiDef.method,
          evidence: `KPI scoring failed: ${msg}`,
        };
      }

      emit('scoring:completed', { scenario_id: scenario.id, kpi_id: kpiDef.id, score: kpiResult.score });
      kpis.push(kpiResult);
    }

    const score = calculateScenarioScore(kpis);

    return {
      scenario_id: scenario.id,
      scenario_name: scenario.name,
      layer: scenario.layer,
      score,
      kpis,
      duration_ms: Date.now() - startTime,
      agent_input: prompt,
      agent_output: output.response,
    };
  }
}
