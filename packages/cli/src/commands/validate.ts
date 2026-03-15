/**
 * sensei validate — Validate suite YAML schema
 */
import { Command } from 'commander';
import { loadSuiteFile } from '../loader.js';

export interface ValidationError {
  path: string;
  message: string;
}

function validateSuiteSchema(suite: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = [];

  // Required top-level fields
  if (!suite.id || typeof suite.id !== 'string') {
    errors.push({ path: 'id', message: 'Suite must have a string "id"' });
  }
  if (!suite.name || typeof suite.name !== 'string') {
    errors.push({ path: 'name', message: 'Suite must have a string "name"' });
  }
  if (!suite.version || typeof suite.version !== 'string') {
    errors.push({ path: 'version', message: 'Suite must have a string "version"' });
  }

  // Agent config (optional — can be supplied via --target at runtime)
  const agent = suite.agent as Record<string, unknown> | undefined;
  if (agent && typeof agent === 'object') {
    const validAdapters = ['http', 'stdio', 'openclaw', 'langchain'];
    if (!agent.adapter || !validAdapters.includes(agent.adapter as string)) {
      errors.push({ path: 'agent.adapter', message: `Adapter must be one of: ${validAdapters.join(', ')}` });
    }
  }

  // Scenarios
  const scenarios = suite.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    errors.push({ path: 'scenarios', message: 'Suite must have at least one scenario' });
  } else {
    const validLayers = ['execution', 'reasoning', 'self-improvement'];
    const validMethods = ['automated', 'llm-judge', 'comparative-judge'];
    const scenarioIds = new Set<string>();

    for (let i = 0; i < scenarios.length; i++) {
      const s = scenarios[i] as Record<string, unknown>;
      const prefix = `scenarios[${i}]`;

      if (!s.id || typeof s.id !== 'string') {
        errors.push({ path: `${prefix}.id`, message: 'Scenario must have a string "id"' });
      } else if (scenarioIds.has(s.id as string)) {
        errors.push({ path: `${prefix}.id`, message: `Duplicate scenario id: "${s.id}"` });
      } else {
        scenarioIds.add(s.id as string);
      }

      if (!s.name || typeof s.name !== 'string') {
        errors.push({ path: `${prefix}.name`, message: 'Scenario must have a string "name"' });
      }
      if (!s.layer || !validLayers.includes(s.layer as string)) {
        errors.push({ path: `${prefix}.layer`, message: `Layer must be one of: ${validLayers.join(', ')}` });
      }

      const input = s.input as Record<string, unknown> | undefined;
      if (!input || typeof input !== 'object') {
        errors.push({ path: `${prefix}.input`, message: 'Scenario must have an "input" object' });
      } else if (!input.prompt || typeof input.prompt !== 'string') {
        errors.push({ path: `${prefix}.input.prompt`, message: 'Input must have a string "prompt"' });
      }

      const kpis = s.kpis;
      if (!Array.isArray(kpis) || kpis.length === 0) {
        errors.push({ path: `${prefix}.kpis`, message: 'Scenario must have at least one KPI' });
      } else {
        for (let j = 0; j < kpis.length; j++) {
          const k = kpis[j] as Record<string, unknown>;
          const kPrefix = `${prefix}.kpis[${j}]`;

          if (!k.id || typeof k.id !== 'string') {
            errors.push({ path: `${kPrefix}.id`, message: 'KPI must have a string "id"' });
          }
          if (typeof k.weight !== 'number' || k.weight < 0 || k.weight > 1) {
            errors.push({ path: `${kPrefix}.weight`, message: 'KPI weight must be a number between 0 and 1' });
          }
          if (!k.method || !validMethods.includes(k.method as string)) {
            errors.push({ path: `${kPrefix}.method`, message: `Method must be one of: ${validMethods.join(', ')}` });
          }
          if (!k.config || typeof k.config !== 'object') {
            errors.push({ path: `${kPrefix}.config`, message: 'KPI must have a "config" object' });
          }
        }
      }

      // Check depends_on references
      if (s.depends_on && typeof s.depends_on === 'string') {
        // We check at the end if the referenced scenario exists
        const depId = s.depends_on as string;
        const allIds = scenarios.map((sc: Record<string, unknown>) => sc.id);
        if (!allIds.includes(depId)) {
          errors.push({ path: `${prefix}.depends_on`, message: `References unknown scenario: "${depId}"` });
        }
      }
    }
  }

  return errors;
}

export function registerValidateCommand(program: Command): void {
  program
    .command('validate')
    .description('Validate a suite YAML file')
    .argument('<path>', 'Path to suite YAML file')
    .action(async (suitePath: string) => {
      const parentOpts = program.opts();
      const verbose = parentOpts.verbose ?? false;

      try {
        const suite = await loadSuiteFile(suitePath);
        const errors = validateSuiteSchema(suite as unknown as Record<string, unknown>);

        if (errors.length === 0) {
          console.log(`✓ Suite "${suite.name}" is valid (${suite.scenarios.length} scenarios)`);
          process.exit(0);
        } else {
          console.error(`✗ Suite validation failed with ${errors.length} error(s):\n`);
          for (const err of errors) {
            console.error(`  ${err.path}: ${err.message}`);
          }
          if (verbose) {
            console.error(`\nParsed suite ID: ${suite.id}`);
          }
          process.exit(1);
        }
      } catch (err: unknown) {
        console.error(`[sensei] Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

export { validateSuiteSchema };
