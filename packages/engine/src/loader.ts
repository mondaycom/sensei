/**
 * Suite Loader — parse YAML suite files and validate with zod schemas.
 *
 * Handles fixture file resolution: if scenarios reference fixture files
 * (via input.fixtures), the loader reads those files and injects their
 * content into the scenario's input.context so agents receive actual data
 * instead of file paths.
 */

import { readFile, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYAML, YAMLParseError } from 'yaml';
import { ZodError } from 'zod';
import { SuiteDefinitionSchema } from './schema.js';
import { RegistryClient } from './registry-client.js';
import type { SuiteDefinition, ScenarioDefinition, ScenarioEntry, ScenarioPool } from './types.js';

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

    // Resolve scenario pools before fixture resolution
    resolvePools(suite);

    // Fix #2: Resolve fixture file references and load their content
    const suiteDir = dirname(resolve(filePath));
    await this.resolveFixtures(suite, suiteDir);

    return suite;
  }

  /**
   * Resolve a suite from a slug by checking multiple sources:
   * 1. Local ./suites/<slug>/suite.yaml
   * 2. Global ~/.sensei/suites/<slug>/suite.yaml
   * 3. Fallback: download from marketplace registry
   */
  async resolveFromSlug(slug: string): Promise<SuiteDefinition> {
    // 1. Check local suites directory
    const localPath = resolve(`./suites/${slug}/suite.yaml`);
    try {
      await access(localPath);
      return this.loadFile(localPath);
    } catch {
      // not found locally, continue
    }

    // 2. Check global suites directory
    const globalPath = join(homedir(), '.sensei', 'suites', slug, 'suite.yaml');
    try {
      await access(globalPath);
      return this.loadFile(globalPath);
    } catch {
      // not found globally, continue
    }

    // 3. Fallback: download from marketplace
    const client = new RegistryClient();
    const yaml = await client.download(slug);
    return this.loadString(yaml, `marketplace:${slug}`);
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
      // Extract line/column from yaml library's YAMLParseError for precise diagnostics
      if (err instanceof YAMLParseError) {
        const pos = err.linePos?.[0];
        const location = pos ? ` at line ${pos.line}, column ${pos.col}` : '';
        throw new Error(`Invalid YAML in "${label}"${location}: ${err.message}`);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Invalid YAML in "${label}": ${message}`);
    }

    if (raw === null || raw === undefined || typeof raw !== 'object') {
      throw new Error(`Suite definition in "${label}" must be a YAML object`);
    }

    try {
      const suite = SuiteDefinitionSchema.parse(raw) as SuiteDefinition & { scenarios: ScenarioEntry[] };
      // Resolve pools so the returned suite has a flat ScenarioDefinition[]
      resolvePools(suite);
      return suite as SuiteDefinition;
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = err.issues
          .map((i) => {
            const path = i.path.length > 0 ? i.path.join('.') : '(root)';
            const detail = i.code === 'invalid_type'
              ? `expected ${(i as any).expected}, got ${(i as any).received}`
              : i.message;
            return `  - ${path}: ${detail}`;
          })
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

// ─── Scenario Pool Resolution ───────────────────────────────────────

/**
 * Seeded PRNG — mulberry32.
 * Returns a function that produces a float in [0, 1) on each call.
 */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle using a supplied random function. */
function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Type guard: is a ScenarioEntry a pool wrapper? */
function isPool(entry: ScenarioEntry): entry is { pool: ScenarioPool } {
  return 'pool' in entry && typeof (entry as any).pool === 'object';
}

/**
 * Expand scenario pools into concrete ScenarioDefinition[] in-place.
 * After this call, `suite.scenarios` contains only ScenarioDefinition items.
 *
 * @throws Error if a pool has count=0 or empty scenarios array
 */
export function resolvePools(suite: { scenarios: ScenarioEntry[] }): void {
  const resolved: ScenarioDefinition[] = [];

  for (const entry of suite.scenarios) {
    if (!isPool(entry)) {
      resolved.push(entry);
      continue;
    }

    const pool = entry.pool;

    if (pool.scenarios.length === 0) {
      throw new Error(`Scenario pool "${pool.id}" has no scenarios`);
    }

    if (pool.count === 0) {
      throw new Error(`Scenario pool "${pool.id}" has count=0`);
    }

    const count = Math.min(pool.count, pool.scenarios.length);
    if (pool.count > pool.scenarios.length) {
      console.warn(
        `Pool "${pool.id}": count (${pool.count}) exceeds pool size (${pool.scenarios.length}), clamping to ${pool.scenarios.length}`,
      );
    }

    const rand = pool.seed != null
      ? mulberry32(pool.seed)
      : Math.random.bind(Math);

    const shuffled = shuffle(pool.scenarios, rand);
    resolved.push(...shuffled.slice(0, count));
  }

  (suite as any).scenarios = resolved;
}
