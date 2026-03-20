import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs/promises to avoid real file writes
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises');
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});

import { Command } from 'commander';
import { registerInstallCommand } from '../src/commands/install.js';
import { mkdir, writeFile } from 'node:fs/promises';

const MOCK_SUITE_INFO = {
  slug: 'test-suite',
  name: 'Test Suite',
  description: 'A test suite',
  category: 'testing',
  version: '1.0.0',
  avg_rating: 8.5,
  rating_count: 20,
  download_count: 100,
  belt: { name: 'Brown', color: 'brown' },
  publisher_name: 'test-user',
  tags: ['test'],
};

const MOCK_YAML = `id: test-suite
name: Test Suite
version: "1.0.0"
scenarios:
  - id: s1
    name: S1
    layer: execution
    input:
      prompt: hello
    kpis:
      - id: k1
        name: K1
        weight: 1
        method: automated
        config:
          type: contains
          expected: hello
`;

describe('install command', () => {
  let program: Command;
  let logs: string[];
  let originalLog: typeof console.log;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.exitOverride();
    registerInstallCommand(program);
    logs = [];
    originalLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(' '));

    // Mock fetch to return suite info and yaml
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/download')) {
        return new Response(MOCK_YAML);
      }
      // getInfo
      return new Response(JSON.stringify(MOCK_SUITE_INFO));
    });
  });

  afterEach(() => {
    console.log = originalLog;
    vi.restoreAllMocks();
  });

  it('registers the install command', () => {
    const cmd = program.commands.find(c => c.name() === 'install');
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain('Marketplace');
  });

  it('downloads and saves suite to default location', async () => {
    await program.parseAsync(['node', 'sensei', 'install', 'test-suite']);

    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('suites/test-suite/suite.yaml'),
      expect.stringContaining('id: test-suite'),
      'utf-8',
    );

    const output = logs.join('\n');
    expect(output).toContain('Test Suite');
    expect(output).toContain('v1.0.0');
    expect(output).toContain('Brown Belt');
    expect(output).toContain('8.5/10');
    expect(output).toContain('sensei run');
  });

  it('supports --global flag', async () => {
    await program.parseAsync(['node', 'sensei', 'install', 'test-suite', '--global']);

    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.sensei/suites/test-suite/suite.yaml'),
      expect.any(String),
      'utf-8',
    );
  });

  it('supports --output flag', async () => {
    await program.parseAsync(['node', 'sensei', 'install', 'test-suite', '--output', '/tmp/custom.yaml']);

    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/custom.yaml',
      expect.any(String),
      'utf-8',
    );
  });
});
