/**
 * sensei install — Download a suite from the marketplace
 */
import { Command } from 'commander';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { RegistryClient } from '@mondaycom/sensei-engine';

const BELT_COLORS: Record<string, string> = {
  white: '⬜',
  yellow: '🟡',
  orange: '🟠',
  green: '🟢',
  blue: '🔵',
  brown: '🟤',
  black: '⬛',
};

export function registerInstallCommand(program: Command): void {
  program
    .command('install')
    .description('Install a suite from the Sensei Marketplace')
    .argument('<slug>', 'Suite slug (e.g., sdr-qualification)')
    .option('--global', 'Install to ~/.sensei/suites/ instead of local directory')
    .option('--output <path>', 'Custom output file path')
    .action(async (slug: string, opts: { global?: boolean; output?: string }) => {
      try {
        console.log(`\u{1F94B} Installing ${slug}...`);

        const client = new RegistryClient();

        // Download suite YAML and get info in parallel
        const [yaml, info] = await Promise.all([
          client.download(slug),
          client.getInfo(slug),
        ]);

        // Determine output path
        let outputPath: string;
        if (opts.output) {
          outputPath = resolve(opts.output);
        } else if (opts.global) {
          outputPath = join(homedir(), '.sensei', 'suites', slug, 'suite.yaml');
        } else {
          outputPath = resolve(`./suites/${slug}/suite.yaml`);
        }

        // Write file
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, yaml, 'utf-8');

        // Display result
        const beltIcon = BELT_COLORS[info.belt.color] ?? '\u{1F94B}';
        const rating = info.avg_rating.toFixed(1);
        console.log(`Downloaded ${info.name} v${info.version}`);
        console.log(`${beltIcon} ${info.belt.name} Belt \u00B7 ${rating}/10 (${info.rating_count} votes) \u00B7 ${info.download_count} downloads`);
        console.log(`Saved to ${outputPath}`);
        console.log('');
        console.log(`Run with: sensei run --suite ${outputPath} --target <agent-url>`);
      } catch (err: unknown) {
        console.error(`[sensei] Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
