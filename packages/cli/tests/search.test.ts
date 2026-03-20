import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerSearchCommand } from '../src/commands/search.js';

const MOCK_SEARCH_RESULT = {
  suites: [
    {
      slug: 'sdr-qualification',
      name: 'SDR Qualification Suite',
      description: 'Sales development rep evaluation',
      category: 'sales',
      version: '1.0.0',
      avg_rating: 7.8,
      rating_count: 28,
      download_count: 89,
      belt: { name: 'Brown', color: 'brown' },
      publisher_name: 'sensei-team',
      tags: ['sdr'],
    },
    {
      slug: 'sales-outreach',
      name: 'Sales Outreach Tester',
      description: 'Test cold email and follow-up',
      category: 'sales',
      version: '0.9.0',
      avg_rating: 5.2,
      rating_count: 12,
      download_count: 34,
      belt: { name: 'Green', color: 'green' },
      publisher_name: null,
      tags: ['sales'],
    },
  ],
  total: 2,
};

describe('search command', () => {
  let program: Command;
  let logs: string[];
  let originalLog: typeof console.log;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerSearchCommand(program);
    logs = [];
    originalLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));

    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(MOCK_SEARCH_RESULT)),
    );
  });

  afterEach(() => {
    console.log = originalLog;
    vi.restoreAllMocks();
  });

  it('registers the search command', () => {
    const cmd = program.commands.find(c => c.name() === 'search');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain('Marketplace');
  });

  it('displays search results in formatted output', async () => {
    await program.parseAsync(['node', 'sensei', 'search', 'sdr']);
    const output = logs.join('\n');

    // Check header
    expect(output).toContain('Search results for "sdr"');

    // Check first result
    expect(output).toContain('SDR Qualification Suite');
    expect(output).toContain('Brown Belt');
    expect(output).toContain('7.8/10');
    expect(output).toContain('89 downloads');
    expect(output).toContain('sensei install sdr-qualification');

    // Check second result
    expect(output).toContain('Sales Outreach Tester');
    expect(output).toContain('Green Belt');
    expect(output).toContain('sensei install sales-outreach');

    // Check footer
    expect(output).toContain('Found 2 suites');
  });

  it('handles empty results', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ suites: [], total: 0 })),
    );

    await program.parseAsync(['node', 'sensei', 'search', 'nonexistent']);
    const output = logs.join('\n');
    expect(output).toContain('No suites found');
  });
});
