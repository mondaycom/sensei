/**
 * sensei search — Search the Sensei Suite Marketplace
 */
import { Command } from 'commander';
import { RegistryClient } from '@mondaycom/sensei-engine';
import type { SuiteInfo } from '@mondaycom/sensei-engine';

const BELT_COLORS: Record<string, string> = {
  white: '⬜',
  yellow: '🟡',
  orange: '🟠',
  green: '🟢',
  blue: '🔵',
  brown: '🟤',
  black: '⬛',
};

function formatSuiteEntry(info: SuiteInfo, index: number): string {
  const beltIcon = BELT_COLORS[info.belt.color] ?? '\u{1F94B}';
  const rating = info.avg_rating.toFixed(1);
  const lines = [
    `${index + 1}. ${info.name.padEnd(35)} ${beltIcon} ${info.belt.name} Belt \u00B7 ${rating}/10 (${info.rating_count} votes)`,
    `   ${(info.description || '').substring(0, 40).padEnd(40)} \u2193 ${info.download_count} downloads`,
    `   sensei install ${info.slug}`,
  ];
  return lines.join('\n');
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search the Sensei Suite Marketplace')
    .argument('<query>', 'Search query')
    .option('--category <cat>', 'Filter by category')
    .option('--sort <sort>', 'Sort by: rating, downloads, newest')
    .option('--limit <n>', 'Max results', '10')
    .action(async (query: string, opts: { category?: string; sort?: string; limit?: string }) => {
      try {
        const client = new RegistryClient();
        const result = await client.search(query, {
          category: opts.category,
          sort: opts.sort,
          limit: parseInt(opts.limit ?? '10', 10),
        });

        if (result.suites.length === 0) {
          console.log(`No suites found for "${query}"`);
          return;
        }

        console.log(`\u{1F94B} Search results for "${query}":`);
        console.log('');

        for (let i = 0; i < result.suites.length; i++) {
          console.log(formatSuiteEntry(result.suites[i], i));
          console.log('');
        }

        console.log(`Found ${result.total} suite${result.total === 1 ? '' : 's'}`);
      } catch (err: unknown) {
        console.error(`[sensei] Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
