/**
 * sensei run — Execute a suite against an agent
 */
import { Command } from 'commander';
import type { SuiteDefinition, JudgeConfig, AgentConfig, SuiteResult, KPIResult } from '@mondaycom/sensei-engine';
// Note: HttpAdapter, StdioAdapter, OpenAICompatAdapter, LangServeAdapter are registered via side-effect
// imports in the engine's index.ts — no need to import them directly here.
import { Runner, Judge, Comparator, createAdapter } from '@mondaycom/sensei-engine';
import { formatTerminalReport, formatHtmlReport } from '../format.js';
import { loadSuiteFile } from '../loader.js';
import { writeOutput } from '../output.js';

export interface RunOptions {
  suite: string;
  target?: string;
  adapter?: 'http' | 'stdio' | 'openclaw' | 'openai' | 'openai-compat' | 'langserve' | 'langchain';
  judgeModel?: string;
  timeout?: string;
  verbose?: boolean;
  output?: string;
  format?: string;
}

export function registerRunCommand(program: Command): void {
  program
    .command('run')
    .description('Run a qualification suite against an agent')
    .requiredOption('--suite <path>', 'Path to suite YAML or .ts file')
    .option('--target <url>', 'Agent endpoint URL or command')
    .option('--adapter <type>', 'Adapter type: http, stdio, openai, openai-compat, openclaw, langserve, langchain', 'http')
    .option('--judge-model <model>', 'LLM judge model', 'gpt-4o')
    .option('--timeout <ms>', 'Per-scenario timeout in ms', '60000')
    .action(async (opts: RunOptions) => {
      const parentOpts = program.opts();
      const verbose = parentOpts.verbose ?? false;
      const format = parentOpts.format ?? 'terminal';
      const outputPath = parentOpts.output;

      try {
        const suite = await loadSuiteFile(opts.suite);

        // m5: Validate timeout
        const timeoutMs = parseInt(opts.timeout ?? '60000', 10);
        if (Number.isNaN(timeoutMs)) {
          throw new Error(`Invalid timeout value: "${opts.timeout}"`);
        }

        // M6: Validate agent config exists
        if (!suite.agent && !opts.target) {
          throw new Error(
            'No agent configured. Provide --target or define an agent section in the suite file.',
          );
        }

        // Override agent config if --target provided
        if (opts.target) {
          suite.agent = {
            adapter: (opts.adapter ?? 'http') as AgentConfig['adapter'],
            endpoint: opts.target,
            timeout_ms: timeoutMs,
          };
        }

        // Override judge config if --judge-model provided
        if (opts.judgeModel) {
          suite.judge = {
            ...(suite.judge ?? { provider: 'openai' as const, model: 'gpt-4o' }),
            model: opts.judgeModel,
          };
        }

        if (verbose) {
          console.error(`[sensei] Suite: ${suite.name} (${suite.id} v${suite.version})`);
          console.error(`[sensei] Scenarios: ${suite.scenarios.length}`);
          console.error(`[sensei] Adapter: ${suite.agent.adapter}`);
          console.error(`[sensei] Judge: ${suite.judge?.model ?? 'none'}`);
        }

        // Create adapter from suite config
        const adapter = createAdapter(suite.agent);

        // Create Judge if suite has judge config
        const judge = suite.judge ? new Judge(suite.judge) : undefined;

        // Create Comparator for self-improvement layer
        const comparator = suite.judge ? new Comparator(suite.judge) : undefined;

        // Build Runner with wired callbacks
        const runner = new Runner(adapter, {
          retries: 2,
          timeout_ms: timeoutMs,
          onScenarioComplete: verbose
            ? (res, idx, total) => console.error(`[sensei] [${idx + 1}/${total}] ${res.scenario_name}: ${res.score.toFixed(1)}`)
            : undefined,
          judgeScorer: judge
            ? async (kpi, agentOutput, scenarioInput) => {
                const verdict = await judge.evaluate({
                  kpi,
                  scenarioInput: { prompt: scenarioInput },
                  agentOutput,
                });
                return {
                  kpi_id: kpi.id,
                  kpi_name: kpi.name,
                  score: (verdict.score / verdict.max_score) * 100,
                  raw_score: verdict.score,
                  max_score: verdict.max_score,
                  weight: kpi.weight,
                  method: kpi.method,
                  evidence: verdict.reasoning,
                } satisfies KPIResult;
              }
            : undefined,
          comparatorScorer: comparator
            ? async (kpi, task, feedback, originalOutput, revisedOutput) => {
                const verdict = await comparator.compare({
                  kpi,
                  task,
                  feedback,
                  originalOutput,
                  revisedOutput,
                });
                return {
                  kpi_id: kpi.id,
                  kpi_name: kpi.name,
                  score: (verdict.score / verdict.max_score) * 100,
                  raw_score: verdict.score,
                  max_score: verdict.max_score,
                  weight: kpi.weight,
                  method: kpi.method,
                  evidence: verdict.reasoning,
                } satisfies KPIResult;
              }
            : undefined,
        });

        const result = await runner.run(suite);

        let output: string;
        switch (format) {
          case 'json':
            output = JSON.stringify(result, null, 2);
            break;
          case 'html':
            output = formatHtmlReport(result);
            break;
          default:
            output = formatTerminalReport(result);
        }

        if (outputPath) {
          await writeOutput(outputPath, output);
          if (verbose) console.error(`[sensei] Report written to ${outputPath}`);
        } else {
          console.log(output);
        }

        // Exit with non-zero if badge is 'none'
        if (result.badge === 'none') {
          process.exit(1);
        }
      } catch (err: unknown) {
        console.error(`[sensei] Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
