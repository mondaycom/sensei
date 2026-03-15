/**
 * sensei validate — Validate suite YAML schema
 *
 * Fix #10: Removed manual validateSuiteSchema() that duplicated the Zod schema
 * validation already performed by loadSuiteFile(). The CLI loader uses the
 * engine's SuiteLoader which validates via Zod (SuiteDefinitionSchema).
 * The manual validation was redundant and could drift out of sync with schema.ts.
 */
import { Command } from 'commander';
import { loadSuiteFile } from '../loader.js';

export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Validate a suite YAML file')
    .argument('<path>', 'Path to suite YAML file')
    .action(async (suitePath: string) => {
      const parentOpts = program.opts();
      const verbose = parentOpts.verbose ?? false;

      try {
        // loadSuiteFile uses engine's SuiteLoader which validates via Zod schema.
        // If the suite is invalid, it throws with detailed Zod error messages.
        const suite = await loadSuiteFile(suitePath);

        if (verbose) {
          console.error(`Suite ID: ${suite.id}`);
          console.error(`Scenarios: ${suite.scenarios.length}`);
          console.error(`Layers: ${[...new Set(suite.scenarios.map((s) => s.layer))].join(', ')}`);
        }

        console.log(`✓ Suite "${suite.name}" is valid (${suite.scenarios.length} scenarios)`);
        process.exit(0);
      } catch (err: unknown) {
        console.error(`✗ Validation failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
