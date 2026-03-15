/**
 * Suite Loader — parse YAML suite files and validate with zod schemas.
 *
 * Handles fixture file resolution: if scenarios reference fixture files
 * (via input.fixtures), the loader reads those files and injects their
 * content into the scenario's input.context so agents receive actual data
 * instead of file paths.
 */

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { parse as parseYAML } from 'yaml';
import { ZodError } from 'zod';
import { SuiteDefinitionSchema } from './schema.js';
import type { SuiteDefinition, ScenarioDefinition } from './types.js';

export class SuiteLoader {
  /**
   * Load a suite definition from a YAML file path.
   * Resolves fixture file references relative to the suite file directory.
   */
  async loadFile(filePath: string): Promise<SuiteDefinition> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read suite file "${filePath}": ${message}`);
    }
    const suite = this.loadString(content, filePath);

    // Fix #2: Resolve fixture file references and load their content
    const suiteDir = dirname(resolve(filePath));
    await this.resolveFixtures(suite, suiteDir);

    return suite;
  }

  /**
   * Load a suite definition from a YAML string.
   * @param source Optional source identifier for error messages.
   */
  loadString(content: string, source?: string): SuiteDefinition {
    const label = source ?? '<string>';

    let raw: unknown;
    try {
      raw = parseYAML(content);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid YAML in "${label}": ${message}`);
    }

    if (raw === null || raw === undefined || typeof raw !== 'object') {
      throw new Error(`Suite definition in "${label}" must be a YAML object`);
    }

    try {
      return SuiteDefinitionSchema.parse(raw);
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = err.issues
          .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
          .join('\n');
        throw new Error(`Invalid suite definition in "${label}":\n${issues}`);
      }
      throw err;
    }
  }

  /**
   * Fix #2: Resolve fixture files referenced in scenario inputs.
   *
   * When a scenario has input.fixtures (e.g., { prospect: "fixtures/prospects/sarah-chen.yaml" }),
   * this method reads each referenced file and merges the loaded content into
   * input.context so the agent receives actual data instead of file paths.
   */
  private async resolveFixtures(suite: SuiteDefinition, suiteDir: string): Promise<void> {
    for (const scenario of suite.scenarios) {
      if (!scenario.input.fixtures) continue;

      // Ensure context exists
      if (!scenario.input.context) {
        scenario.input.context = {};
      }

      for (const [key, value] of Object.entries(scenario.input.fixtures)) {
        if (typeof value !== 'string') {
          // Already loaded or not a file path — skip
          continue;
        }

        const fixturePath = resolve(suiteDir, value);
        try {
          const fixtureContent = await readFile(fixturePath, 'utf-8');
          // Parse YAML/JSON fixture files
          const ext = fixturePath.toLowerCase();
          if (ext.endsWith('.yaml') || ext.endsWith('.yml')) {
            scenario.input.context[key] = parseYAML(fixtureContent);
          } else if (ext.endsWith('.json')) {
            scenario.input.context[key] = JSON.parse(fixtureContent);
          } else {
            // Raw text for other formats
            scenario.input.context[key] = fixtureContent;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Failed to load fixture "${key}" from "${fixturePath}" ` +
            `in scenario "${scenario.id}": ${message}`,
          );
        }
      }
    }
  }
}
