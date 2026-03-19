/**
 * T8.9 — CLI tests: command parsing, output formatting
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CLI_PATH = join(__dirname, '..', 'dist', 'index.js');

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 10000,
      env: { ...process.env, NO_COLOR: '1' },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

// ─── Command Parsing ────────────────────────────────────────────────

describe('CLI command parsing', () => {
  it('shows help with --help', () => {
    const { stdout, exitCode } = runCli(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Sensei');
    expect(stdout).toContain('run');
    expect(stdout).toContain('init');
    expect(stdout).toContain('report');
    expect(stdout).toContain('validate');
  });

  it('shows version with --version', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
    const { stdout, exitCode } = runCli(['--version']);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe(pkg.version);
  });

  it('shows run command help', () => {
    const { stdout, exitCode } = runCli(['run', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--suite');
    expect(stdout).toContain('--target');
    expect(stdout).toContain('--adapter');
    expect(stdout).toContain('--judge-model');
    expect(stdout).toContain('--timeout');
  });

  it('shows init command help', () => {
    const { stdout, exitCode } = runCli(['init', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Generate a new suite template');
  });

  it('shows validate command help', () => {
    const { stdout, exitCode } = runCli(['validate', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Validate a suite YAML file');
  });

  it('shows report command help', () => {
    const { stdout, exitCode } = runCli(['report', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--input');
  });

  it('run fails without --suite', () => {
    const { stderr, exitCode } = runCli(['run']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('--suite');
  });
});

// ─── Init Command ───────────────────────────────────────────────────

describe('sensei init', () => {
  const testDir = join(tmpdir(), `sensei-test-init-${Date.now()}`);

  it('generates a suite YAML template (non-interactive)', () => {
    mkdirSync(testDir, { recursive: true });
    const { stdout, exitCode } = runCli(['init', 'test-suite', '--non-interactive']);
    // It writes to cwd, but we just check it doesn't crash
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Suite template written to');
  });
});

// ─── Validate Command ───────────────────────────────────────────────

describe('sensei validate', () => {
  const testDir = join(tmpdir(), `sensei-test-validate-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('validates a correct suite YAML', () => {
    const yamlPath = join(testDir, 'valid.yaml');
    writeFileSync(yamlPath, `
id: test
name: "Test Suite"
version: "1.0.0"
agent:
  adapter: http
  endpoint: "http://localhost:3000"
scenarios:
  - id: s1
    name: "Scenario 1"
    layer: execution
    input:
      prompt: "Do something"
    kpis:
      - id: k1
        name: "Quality"
        weight: 0.5
        method: automated
        config:
          type: contains
          expected: "hello"
`);
    const { stdout, exitCode } = runCli(['validate', yamlPath]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('valid');
  });

  it('rejects a suite with missing scenarios', () => {
    const yamlPath = join(testDir, 'invalid.yaml');
    writeFileSync(yamlPath, `
id: test
name: "Test Suite"
version: "1.0.0"
agent:
  adapter: http
scenarios: []
`);
    const { stderr, exitCode } = runCli(['validate', yamlPath]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Invalid suite definition|Validation failed/);
  });

  it('rejects a suite with invalid KPI weight', () => {
    const yamlPath = join(testDir, 'bad-weight.yaml');
    writeFileSync(yamlPath, `
id: test
name: "Test Suite"
version: "1.0.0"
agent:
  adapter: http
scenarios:
  - id: s1
    name: "Scenario 1"
    layer: execution
    input:
      prompt: "Do something"
    kpis:
      - id: k1
        name: "Quality"
        weight: 5.0
        method: automated
        config:
          type: contains
`);
    const { stderr, exitCode } = runCli(['validate', yamlPath]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('weight');
  });

  it('fails on non-existent file', () => {
    const { stderr, exitCode } = runCli(['validate', '/tmp/nonexistent.yaml']);
    expect(exitCode).toBe(1);
    expect(stderr).toContain('Validation failed');
  });
});

// ─── Report Formatting ─────────────────────────────────────────────

describe('sensei report', () => {
  const testDir = join(tmpdir(), `sensei-test-report-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  const sampleResult = {
    suite_id: 'test-suite',
    suite_version: '1.0.0',
    agent_id: 'test-agent',
    timestamp: '2026-01-01T00:00:00Z',
    scores: { overall: 85.5, execution: 90, reasoning: 80, self_improvement: 75 },
    scenarios: [
      {
        scenario_id: 's1',
        scenario_name: 'Test Scenario',
        layer: 'execution',
        score: 90,
        kpis: [
          { kpi_id: 'k1', kpi_name: 'Quality', score: 90, raw_score: 9, max_score: 10, weight: 1.0, method: 'automated', evidence: 'Passed' },
        ],
        duration_ms: 1500,
        agent_input: 'test input',
        agent_output: 'test output',
      },
    ],
    badge: 'silver',
    duration_ms: 2000,
    judge_model: 'gpt-4o',
  };

  it('renders terminal report from JSON', () => {
    const jsonPath = join(testDir, 'result.json');
    writeFileSync(jsonPath, JSON.stringify(sampleResult));

    const { stdout, exitCode } = runCli(['report', '--input', jsonPath]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('SENSEI QUALIFICATION REPORT');
    expect(stdout).toContain('test-suite');
    expect(stdout).toContain('85.5');
    expect(stdout).toContain('SILVER');
  });

  it('renders JSON format', () => {
    const jsonPath = join(testDir, 'result.json');
    writeFileSync(jsonPath, JSON.stringify(sampleResult));

    const { stdout, exitCode } = runCli(['--format', 'json', 'report', '--input', jsonPath]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.suite_id).toBe('test-suite');
  });

  it('renders HTML format', () => {
    const jsonPath = join(testDir, 'result.json');
    writeFileSync(jsonPath, JSON.stringify(sampleResult));

    const { stdout, exitCode } = runCli(['--format', 'html', 'report', '--input', jsonPath]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('<!DOCTYPE html>');
    expect(stdout).toContain('test-suite');
  });

  it('writes report to --output file', () => {
    const jsonPath = join(testDir, 'result.json');
    const outPath = join(testDir, 'out-report.txt');
    writeFileSync(jsonPath, JSON.stringify(sampleResult));

    const { exitCode } = runCli(['--output', outPath, 'report', '--input', jsonPath]);
    expect(exitCode).toBe(0);
    const content = readFileSync(outPath, 'utf-8');
    expect(content).toContain('SENSEI QUALIFICATION REPORT');
  });
});
