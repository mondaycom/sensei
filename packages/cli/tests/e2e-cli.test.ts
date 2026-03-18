/**
 * QP-2 — CLI E2E test.
 *
 * Starts a mock HTTP server, invokes the actual CLI binary, and verifies output.
 *
 * Uses async execFile (not execFileSync) because the mock server lives in
 * the same Node process — sync would block the event loop and prevent
 * the server from handling requests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';

const CLI_PATH = join(__dirname, '..', 'dist', 'index.js');
const SUITE_PATH = join(__dirname, '..', '..', '..', 'suites', 'sdr-qualification', 'suite.yaml');

// ─── Async CLI runner ───────────────────────────────────────────────

function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 60_000,
      env: { ...process.env, NO_COLOR: '1', OPENAI_API_KEY: 'sk-test-dummy-key-for-e2e' },
    }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { code?: number | string };
        const exitCode = typeof e.code === 'number' ? e.code : 1;
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode });
      } else {
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '', exitCode: 0 });
      }
    });
  });
}

// ─── Inline mock server ─────────────────────────────────────────────

function startMockServer(): Promise<{ server: Server; port: number; url: string }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (req.method === 'POST' && req.url === '/execute') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { task?: string };
            const task = (parsed.task ?? '').toLowerCase();

            let response = 'Default mock response for CLI E2E test.';
            if (task.includes('cold email')) {
              response = 'Subject: Quick question\n\nHi Sarah, I noticed your migration project at Meridian Health Systems. Would you have 10 minutes? Best, Alex';
            } else if (task.includes('analyze')) {
              response = '## Analysis\n### Pain Points\n1. Slow releases\n### BANT\n- Budget: Yes\n### Next Steps\n1. Demo';
            } else if (task.includes('3-email') || task.includes('sequence')) {
              response = '## Email 1\nSubject: Hi\n## Email 2\nSubject: Follow up\n## Email 3\nSubject: Last chance';
            } else if (task.includes('explain') || task.includes('strategic')) {
              response = 'I chose the subject line for curiosity. I prioritized the migration pain point. I considered alternatives.';
            } else if (task.includes('revise') || task.includes('feedback')) {
              response = 'Subject: Prove it\n\nSarah, here is your revised email with feedback incorporated.\n\nP.S. 73% stat.';
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ response }));
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON' }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        resolve({ server, port, url: `http://127.0.0.1:${port}` });
      } else {
        reject(new Error('Failed to get server address'));
      }
    });
    server.on('error', reject);
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('CLI E2E: sensei run → JSON output', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    const s = await startMockServer();
    server = s.server;
    url = s.url;
  });

  afterAll(() => {
    return new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it('runs the SDR suite via CLI and produces valid JSON output', { timeout: 60_000 }, async () => {
    const { stdout } = await runCli([
      '--format', 'json',
      'run',
      '--suite', SUITE_PATH,
      '--target', url,
      '--timeout', '15000',
    ]);

    // CLI may exit 1 if badge is 'none' (no real judge = low scores), that's fine
    expect(stdout).toBeTruthy();
    const parsed = JSON.parse(stdout);

    // Verify SuiteResult structure
    expect(parsed.suite_id).toContain('sdr-qualification');
    expect(parsed.suite_version).toBe('1.0.0');
    expect(parsed.agent_id).toBe('http');
    expect(parsed.timestamp).toBeTruthy();
    expect(parsed.duration_ms).toBeGreaterThan(0);
    expect(parsed.badge).toBeDefined();

    // All 5 scenarios present
    expect(parsed.scenarios).toHaveLength(5);

    // Scores structure
    expect(parsed.scores).toHaveProperty('overall');
    expect(parsed.scores).toHaveProperty('execution');
    expect(parsed.scores).toHaveProperty('reasoning');
    expect(parsed.scores).toHaveProperty('self_improvement');

    // Each scenario has required fields
    for (const s of parsed.scenarios) {
      expect(s.scenario_id).toBeTruthy();
      expect(s.scenario_name).toBeTruthy();
      expect(s.layer).toBeTruthy();
      expect(typeof s.score).toBe('number');
      expect(Array.isArray(s.kpis)).toBe(true);
    }
  });

  it('terminal format output contains report header', { timeout: 60_000 }, async () => {
    const { stdout } = await runCli([
      'run',
      '--suite', SUITE_PATH,
      '--target', url,
      '--timeout', '15000',
    ]);

    expect(stdout).toContain('SENSEI');
  });

  it('fails gracefully with unreachable target', async () => {
    const { stderr, exitCode } = await runCli([
      '--format', 'json',
      'run',
      '--suite', SUITE_PATH,
      '--target', 'http://127.0.0.1:1',
      '--timeout', '3000',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain('Error');
  });
});
