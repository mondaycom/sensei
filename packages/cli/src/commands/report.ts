/**
 * sensei report — Re-render JSON results as terminal or HTML
 */
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import type { SuiteResult } from '@mondaycom/sensei-engine';
import { formatTerminalReport, formatHtmlReport } from '../format.js';
import { writeOutput } from '../output.js';

export function registerReportCommand(program: Command): void {
  program
    .command('report')
    .description('Re-render a JSON result as terminal or HTML report')
    .requiredOption('--input <path>', 'Path to JSON result file')
    .action(async (opts: { input: string }) => {
      const parentOpts = program.opts();
      const format = parentOpts.format ?? 'terminal';
      const outputPath = parentOpts.output;

      try {
        const raw = await readFile(opts.input, 'utf-8');
        const result: SuiteResult = JSON.parse(raw);

        let rendered: string;
        switch (format) {
          case 'html':
            rendered = formatHtmlReport(result);
            break;
          case 'json':
            rendered = JSON.stringify(result, null, 2);
            break;
          default:
            rendered = formatTerminalReport(result);
        }

        if (outputPath) {
          await writeOutput(outputPath, rendered);
          console.error(`Report written to ${outputPath}`);
        } else {
          console.log(rendered);
        }
      } catch (err: unknown) {
        console.error(`[sensei] Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
