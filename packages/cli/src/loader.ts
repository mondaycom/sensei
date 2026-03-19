/**
 * Suite file loader — reads YAML or JSON suite definitions.
 *
 * Uses the engine's SuiteLoader which handles Zod validation and
 * fixture file resolution (Fix #2).
 */
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { SuiteLoader } from '@mondaycom/sensei-engine';
import { SuiteDefinitionSchema } from '@mondaycom/sensei-engine';
import type { SuiteDefinition } from '@mondaycom/sensei-engine';

const loader = new SuiteLoader();

export async function loadSuiteFile(filePath: string): Promise<SuiteDefinition> {
  const ext = extname(filePath).toLowerCase();

  if (ext === '.yaml' || ext === '.yml') {
    // Use engine's SuiteLoader which handles Zod validation + fixture resolution
    return loader.loadFile(filePath);
  }

  if (ext === '.json') {
    const raw = await readFile(filePath, 'utf-8');
    return SuiteDefinitionSchema.parse(JSON.parse(raw));
  }

  throw new Error(`Unsupported suite file format: ${ext} (expected .yaml, .yml, or .json)`);
}
