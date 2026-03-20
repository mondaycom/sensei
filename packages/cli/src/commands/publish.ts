/**
 * sensei publish — Publish a suite to the Sensei Marketplace
 */
import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SuiteLoader, RegistryClient } from '@mondaycom/sensei-engine';

async function findSuiteFile(): Promise<string> {
  // Check ./suite.yaml first
  const candidates = ['suite.yaml', 'suite.yml'];
  for (const name of candidates) {
    try {
      await readFile(resolve(name), 'utf-8');
      return resolve(name);
    } catch {
      // continue
    }
  }

  // Check ./suites/*.yaml
  try {
    const dir = resolve('./suites');
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
        return resolve(dir, entry);
      }
    }
  } catch {
    // directory doesn't exist
  }

  throw new Error(
    'No suite file found. Use --file <path> or place a suite.yaml in the current directory.',
  );
}

export function registerPublishCommand(program: Command): void {
  program
    .command('publish')
    .description('Publish a suite to the Sensei Marketplace')
    .option('--file <path>', 'Path to suite YAML file')
    .option('--api-key <key>', 'Marketplace API key (or set SENSEI_API_KEY)')
    .option('--name <name>', 'Override suite name')
    .option('--description <desc>', 'Override suite description')
    .option('--category <cat>', 'Suite category')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (opts: {
      file?: string;
      apiKey?: string;
      name?: string;
      description?: string;
      category?: string;
      tags?: string;
    }) => {
      try {
        const apiKey = opts.apiKey ?? process.env.SENSEI_API_KEY;
        if (!apiKey) {
          console.error('Error: API key required. Use --api-key or set SENSEI_API_KEY environment variable.');
          process.exit(1);
        }

        // Find suite file
        const filePath = opts.file ? resolve(opts.file) : await findSuiteFile();

        console.log('\u{1F94B} Publishing suite...');

        // Read and validate
        const yaml = await readFile(filePath, 'utf-8');
        process.stdout.write(`Validating ${filePath}... `);
        const loader = new SuiteLoader();
        const suite = loader.loadString(yaml, filePath);
        console.log('\u2713');

        // Build metadata
        const name = opts.name ?? suite.name;
        const metadata = {
          name,
          description: opts.description ?? suite.description,
          category: opts.category ?? suite.marketplace?.category,
          tags: opts.tags ? opts.tags.split(',').map(t => t.trim()) : suite.marketplace?.tags,
        };

        console.log(`Publishing "${name}" to Sensei Marketplace...`);
        console.log('');

        const client = new RegistryClient();
        const result = await client.publish(yaml, metadata, apiKey);

        console.log('\u2705 Published successfully!');
        console.log(`View at: ${result.url}`);
        console.log(`Install: sensei install ${result.slug}`);
      } catch (err: unknown) {
        console.error(`[sensei] Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
