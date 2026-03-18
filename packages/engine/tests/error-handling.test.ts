/**
 * QP-3 — Error handling and edge case tests.
 *
 * Tests graceful behavior when things go wrong: empty suites,
 * unreachable agents, invalid responses, bad YAML, etc.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { Runner } from '../src/runner.js';
import { SuiteLoader } from '../src/loader.js';
import { createAdapter } from '../src/adapters/types.js';
import { classifyNetworkError } from '../src/adapters/http.js';
import '../src/adapters/http.js'; // register http adapter
import type { SuiteDefinition, AgentAdapter, AdapterInput, AdapterOutput, KPIResult } from '../src/types.js';

// ─── Helpers ────────────────────────────────────────────────────────

function buildMinimalSuite(overrides?: Partial<SuiteDefinition>): SuiteDefinition {
  return {
    id: 'error-test',
    name: 'Error Test Suite',
    version: '1.0.0',
    agent: {
      adapter: 'http',
      endpoint: 'http://127.0.0.1:9999',
      timeout_ms: 3000,
    },
    scenarios: [
      {
        id: 's1',
        name: 'Test Scenario',
        layer: 'execution',
        input: { prompt: 'Hello agent' },
        kpis: [
          {
            id: 'k1',
            name: 'Contains hello',
            weight: 1,
            method: 'automated',
            config: { type: 'contains', expected: 'hello' },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function createMockAdapter(overrides?: Partial<AgentAdapter>): AgentAdapter {
  return {
    name: 'mock',
    connect: vi.fn(async () => {}),
    healthCheck: vi.fn(async () => true),
    send: vi.fn(async (_input: AdapterInput): Promise<AdapterOutput> => ({
      response: 'hello world',
      duration_ms: 100,
    })),
    disconnect: vi.fn(async () => {}),
    ...overrides,
  };
}

// ─── Suite Validation Errors ────────────────────────────────────────

describe('Suite YAML validation errors', () => {
  const loader = new SuiteLoader();

  it('rejects suite with 0 scenarios', () => {
    const yaml = `
id: empty
name: "Empty Suite"
version: "1.0.0"
agent:
  adapter: http
  endpoint: "http://localhost:3000"
scenarios: []
`;
    expect(() => loader.loadString(yaml)).toThrow('at least');
  });

  it('rejects suite with missing id', () => {
    const yaml = `
name: "No ID Suite"
version: "1.0.0"
agent:
  adapter: http
scenarios:
  - id: s1
    name: "S1"
    layer: execution
    input:
      prompt: "do something"
    kpis:
      - id: k1
        name: "K1"
        weight: 0.5
        method: automated
        config:
          type: contains
          expected: "hello"
`;
    expect(() => loader.loadString(yaml)).toThrow();
  });

  it('rejects suite with missing scenario name', () => {
    const yaml = `
id: test
name: "Test"
version: "1.0.0"
agent:
  adapter: http
scenarios:
  - id: s1
    layer: execution
    input:
      prompt: "do something"
    kpis:
      - id: k1
        name: "K1"
        weight: 0.5
        method: automated
        config:
          type: contains
`;
    expect(() => loader.loadString(yaml)).toThrow();
  });

  it('rejects KPI weight > 1', () => {
    const yaml = `
id: test
name: "Test"
version: "1.0.0"
agent:
  adapter: http
scenarios:
  - id: s1
    name: "S1"
    layer: execution
    input:
      prompt: "do something"
    kpis:
      - id: k1
        name: "K1"
        weight: 5.0
        method: automated
        config:
          type: contains
`;
    expect(() => loader.loadString(yaml)).toThrow('weight');
  });

  it('rejects invalid layer value', () => {
    const yaml = `
id: test
name: "Test"
version: "1.0.0"
agent:
  adapter: http
scenarios:
  - id: s1
    name: "S1"
    layer: invalid-layer
    input:
      prompt: "do something"
    kpis:
      - id: k1
        name: "K1"
        weight: 0.5
        method: automated
        config:
          type: contains
`;
    expect(() => loader.loadString(yaml)).toThrow();
  });

  it('rejects invalid YAML syntax', () => {
    const yaml = `
id: test
  name: [broken yaml
    this is not valid: {{{
`;
    expect(() => loader.loadString(yaml)).toThrow('YAML');
  });

  it('rejects non-object YAML', () => {
    expect(() => loader.loadString('just a string')).toThrow('must be a YAML object');
  });

  it('gives clear error on missing file', async () => {
    await expect(loader.loadFile('/nonexistent/path/suite.yaml')).rejects.toThrow(
      'Failed to read suite file',
    );
  });
});

// ─── Runner Error Paths ─────────────────────────────────────────────

describe('Runner error handling', () => {
  it('throws on failed health check', async () => {
    const adapter = createMockAdapter({
      healthCheck: vi.fn(async () => false),
    });
    const runner = new Runner(adapter);
    const suite = buildMinimalSuite();

    await expect(runner.run(suite)).rejects.toThrow('health check failed');
  });

  it('returns error result when adapter send fails after retries', async () => {
    const adapter = createMockAdapter({
      send: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    });
    const runner = new Runner(adapter, { retries: 1 });
    const suite = buildMinimalSuite();

    const result = await runner.run(suite);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].error).toContain('connection refused');
    expect(result.scenarios[0].score).toBe(0);
  });

  it('handles adapter returning error field gracefully', async () => {
    const adapter = createMockAdapter({
      send: vi.fn(async (): Promise<AdapterOutput> => ({
        response: '',
        duration_ms: 0,
        error: 'Agent returned HTTP 500: Internal Server Error',
      })),
    });
    const runner = new Runner(adapter, { retries: 0 });
    const suite = buildMinimalSuite();

    const result = await runner.run(suite);
    expect(result.scenarios[0].error).toContain('500');
    expect(result.scenarios[0].score).toBe(0);
  });

  it('scores 0 for llm-judge KPIs when no judge is configured', async () => {
    const adapter = createMockAdapter();
    const runner = new Runner(adapter); // no judgeScorer
    const suite = buildMinimalSuite({
      scenarios: [
        {
          id: 's1',
          name: 'Judge scenario',
          layer: 'execution',
          input: { prompt: 'test' },
          kpis: [
            {
              id: 'k1',
              name: 'Quality',
              weight: 1,
              method: 'llm-judge',
              config: { max_score: 5, rubric: 'score it' },
            },
          ],
        },
      ],
    });

    const result = await runner.run(suite);
    expect(result.scenarios[0].kpis[0].score).toBe(0);
    expect(result.scenarios[0].kpis[0].evidence).toContain('No judge configured');
  });

  it('handles judge scorer that throws', async () => {
    const adapter = createMockAdapter();
    const runner = new Runner(adapter, {
      retries: 0,
      judgeScorer: async () => {
        throw new Error('Judge API rate limited');
      },
    });
    const suite = buildMinimalSuite({
      scenarios: [
        {
          id: 's1',
          name: 'Judge scenario',
          layer: 'execution',
          input: { prompt: 'test' },
          kpis: [
            {
              id: 'k1',
              name: 'Quality',
              weight: 1,
              method: 'llm-judge',
              config: { max_score: 5 },
            },
          ],
        },
      ],
    });

    const result = await runner.run(suite);
    // Per-KPI error handling catches the judge error — KPI scores 0 with error evidence
    expect(result.scenarios[0].kpis[0].score).toBe(0);
    expect(result.scenarios[0].kpis[0].evidence).toContain('Judge API rate limited');
    expect(result.scenarios[0].score).toBe(0);
  });

  it('handles depends_on referencing non-existent scenario gracefully', async () => {
    const adapter = createMockAdapter();
    const runner = new Runner(adapter, {
      judgeScorer: async (kpi) => ({
        kpi_id: kpi.id,
        kpi_name: kpi.name,
        score: 80,
        raw_score: 4,
        max_score: 5,
        weight: kpi.weight,
        method: kpi.method,
        evidence: 'ok',
      }),
    });

    const suite = buildMinimalSuite({
      scenarios: [
        {
          id: 'orphan',
          name: 'Orphan Scenario',
          layer: 'reasoning',
          depends_on: 'non-existent-scenario',
          input: { prompt: 'Explain something' },
          kpis: [
            {
              id: 'k1',
              name: 'Quality',
              weight: 1,
              method: 'llm-judge',
              config: { max_score: 5 },
            },
          ],
        },
      ],
    });

    // M8: Now throws on unresolved depends_on references
    await expect(runner.run(suite)).rejects.toThrow(/Unresolved depends_on/);
  });
});

// ─── HTTP Adapter Error Paths (real server) ─────────────────────────

describe('HTTP adapter error handling', () => {
  it('handles unreachable agent (connection refused)', async () => {
    const suite = buildMinimalSuite({
      agent: {
        adapter: 'http',
        endpoint: 'http://127.0.0.1:1', // port 1 — won't be listening
        timeout_ms: 2000,
      },
    });

    const adapter = createAdapter(suite.agent);
    const runner = new Runner(adapter, { retries: 0 });

    // Health check should fail → throw
    await expect(runner.run(suite)).rejects.toThrow('health check failed');
  });

  it('handles server returning invalid JSON', async () => {
    // Create a server that returns non-JSON from /execute
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"status":"ok"}');
        return;
      }
      if (req.url === '/execute') {
        // Consume the request body
        req.on('data', () => {});
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('this is not json');
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('no address'));
      });
    });

    try {
      const suite = buildMinimalSuite({
        agent: {
          adapter: 'http',
          endpoint: `http://127.0.0.1:${port}`,
          timeout_ms: 5000,
          health_check: `http://127.0.0.1:${port}/health`,
        },
      });

      const adapter = createAdapter(suite.agent);
      const runner = new Runner(adapter, { retries: 0 });
      const result = await runner.run(suite);

      // The adapter should handle the invalid JSON response — either as error or empty response
      const scenario = result.scenarios[0];
      // It should not crash; it should produce some result
      expect(scenario).toBeDefined();
      expect(scenario.scenario_id).toBe('s1');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it('handles server returning HTTP 500', async () => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"status":"ok"}');
        return;
      }
      if (req.url === '/execute') {
        req.on('data', () => {});
        req.on('end', () => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end('Internal Server Error');
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    const port = await new Promise<number>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('no address'));
      });
    });

    try {
      const suite = buildMinimalSuite({
        agent: {
          adapter: 'http',
          endpoint: `http://127.0.0.1:${port}`,
          timeout_ms: 5000,
          health_check: `http://127.0.0.1:${port}/health`,
        },
      });

      const adapter = createAdapter(suite.agent);
      // retries: 0 to avoid slow test from retry backoff hitting the 500 server
      const runner = new Runner(adapter, { retries: 0 });
      const result = await runner.run(suite);

      // Should get an error scenario result, not crash
      const scenario = result.scenarios[0];
      expect(scenario).toBeDefined();
      // The adapter returns error field on non-ok responses after retries
      // The runner turns that into an error scenario
      expect(scenario.score).toBe(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});

// ─── Scorer Edge Cases ──────────────────────────────────────────────

describe('Scorer edge cases', () => {
  it('handles empty agent output for contains check', async () => {
    const adapter = createMockAdapter({
      send: vi.fn(async (): Promise<AdapterOutput> => ({
        response: '',
        duration_ms: 50,
      })),
    });
    const runner = new Runner(adapter);
    const suite = buildMinimalSuite();

    const result = await runner.run(suite);
    // Empty response should not contain 'hello'
    expect(result.scenarios[0].kpis[0].score).toBe(0);
    expect(result.scenarios[0].kpis[0].evidence).toContain('does not contain');
  });

  it('handles unknown automated scoring type', async () => {
    const adapter = createMockAdapter();
    const runner = new Runner(adapter);
    const suite = buildMinimalSuite({
      scenarios: [
        {
          id: 's1',
          name: 'Unknown type',
          layer: 'execution',
          input: { prompt: 'test' },
          kpis: [
            {
              id: 'k1',
              name: 'Mystery',
              weight: 1,
              method: 'automated',
              config: { type: 'nonexistent' as any },
            },
          ],
        },
      ],
    });

    const result = await runner.run(suite);
    expect(result.scenarios[0].kpis[0].score).toBe(0);
    expect(result.scenarios[0].kpis[0].evidence).toContain('Unknown');
  });
});

// ─── Timeout Mid-Scoring ───────────────────────────────────────────

describe('Timeout mid-scoring', () => {
  it('marks individual KPI as errored without crashing the scenario', async () => {
    const adapter = createMockAdapter();
    let callCount = 0;
    const runner = new Runner(adapter, {
      retries: 0,
      judgeScorer: async (kpi) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Judge timeout after 60000ms');
        }
        return {
          kpi_id: kpi.id,
          kpi_name: kpi.name,
          score: 80,
          raw_score: 4,
          max_score: 5,
          weight: kpi.weight,
          method: kpi.method,
          evidence: 'Good quality',
        };
      },
    });

    const suite = buildMinimalSuite({
      scenarios: [
        {
          id: 's1',
          name: 'Multi-KPI Scenario',
          layer: 'execution',
          input: { prompt: 'test' },
          kpis: [
            {
              id: 'k1',
              name: 'Quality (will timeout)',
              weight: 0.5,
              method: 'llm-judge',
              config: { max_score: 5 },
            },
            {
              id: 'k2',
              name: 'Completeness (will succeed)',
              weight: 0.5,
              method: 'llm-judge',
              config: { max_score: 5 },
            },
          ],
        },
      ],
    });

    const result = await runner.run(suite);
    const scenario = result.scenarios[0];
    // Scenario should NOT have a top-level error — it completed
    expect(scenario.error).toBeUndefined();
    // First KPI errored
    expect(scenario.kpis[0].score).toBe(0);
    expect(scenario.kpis[0].evidence).toContain('KPI scoring failed');
    expect(scenario.kpis[0].evidence).toContain('Judge timeout');
    // Second KPI succeeded
    expect(scenario.kpis[1].score).toBe(80);
    // Overall score should reflect the partial success
    expect(scenario.score).toBeGreaterThan(0);
  });

  it('gracefully marks scenario as errored on adapter timeout', async () => {
    const adapter = createMockAdapter({
      send: vi.fn(async (): Promise<AdapterOutput> => ({
        response: '',
        duration_ms: 30000,
        error: 'Stdio adapter timed out after 30000ms',
      })),
    });
    const runner = new Runner(adapter, { retries: 0 });
    const suite = buildMinimalSuite();

    const result = await runner.run(suite);
    expect(result.scenarios[0].error).toContain('timed out');
    expect(result.scenarios[0].score).toBe(0);
    // Suite still produces a valid result
    expect(result.suite_id).toBe('error-test');
    expect(result.badge).toBeDefined();
  });
});

// ─── Network Error Classification ──────────────────────────────────

describe('Network error classification', () => {
  it('classifies ECONNRESET with clear message', () => {
    const err = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const classified = classifyNetworkError(err, 'http://agent:3000');
    expect(classified.message).toContain('Connection reset');
    expect(classified.message).toContain('agent:3000');
  });

  it('classifies ENOTFOUND (DNS failure) with clear message', () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND badhost'), { code: 'ENOTFOUND' });
    const classified = classifyNetworkError(err, 'http://badhost:3000');
    expect(classified.message).toContain('DNS lookup failed');
    expect(classified.message).toContain('badhost');
  });

  it('classifies ETIMEDOUT (socket timeout) with clear message', () => {
    const err = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
    const classified = classifyNetworkError(err, 'http://slow-server:3000');
    expect(classified.message).toContain('Socket connection timed out');
    expect(classified.message).toContain('slow-server:3000');
  });

  it('classifies ECONNREFUSED with clear message', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const classified = classifyNetworkError(err, 'http://localhost:9999');
    expect(classified.message).toContain('Connection refused');
    expect(classified.message).toContain('localhost:9999');
  });

  it('classifies AbortError (request timeout) with clear message', () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    const classified = classifyNetworkError(err, 'http://slow-agent:3000');
    expect(classified.message).toContain('timed out');
    expect(classified.message).toContain('slow-agent:3000');
  });

  it('classifies socket hang up with clear message', () => {
    const err = Object.assign(new Error('socket hang up'), { code: 'UND_ERR_SOCKET' });
    const classified = classifyNetworkError(err, 'http://flaky:3000');
    expect(classified.message).toContain('Socket hung up');
  });

  it('passes through unrecognized errors unchanged', () => {
    const err = new Error('Something completely different');
    const classified = classifyNetworkError(err, 'http://example.com');
    expect(classified).toBe(err);
  });
});

// ─── Malformed YAML ────────────────────────────────────────────────

describe('Malformed YAML detailed errors', () => {
  const loader = new SuiteLoader();

  it('reports line/column for YAML syntax errors', () => {
    const yaml = `id: test
name: "Test"
version: "1.0.0"
scenarios:
  - id: s1
    name: "S1"
    layer: execution
    input:
      prompt: "test"
    broken: [unclosed bracket
    kpis: []
`;
    try {
      loader.loadString(yaml, 'test.yaml');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('Invalid YAML');
      expect(err.message).toContain('test.yaml');
    }
  });

  it('reports field path for Zod validation errors', () => {
    const yaml = `
id: test
name: "Test"
version: "1.0.0"
scenarios:
  - id: s1
    name: "S1"
    layer: execution
    input:
      prompt: "do something"
    kpis:
      - id: k1
        name: "K1"
        weight: 999
        method: automated
        config:
          type: contains
`;
    try {
      loader.loadString(yaml, 'bad-weight.yaml');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.message).toContain('bad-weight.yaml');
      expect(err.message).toContain('weight');
    }
  });

  it('rejects empty YAML content', () => {
    expect(() => loader.loadString('', 'empty.yaml')).toThrow('must be a YAML object');
  });

  it('rejects YAML array at root level', () => {
    expect(() => loader.loadString('- item1\n- item2', 'array.yaml')).toThrow(/must be a YAML object|expected object, got array/);
  });

  it('rejects YAML with tab indentation errors', () => {
    const yaml = `id: test
\tname: "Test"`;
    try {
      loader.loadString(yaml, 'tabs.yaml');
      expect.fail('Should have thrown');
    } catch (err: any) {
      // Either YAML parse error or validation error
      expect(err.message).toMatch(/YAML|Invalid/);
    }
  });
});

// ─── Malformed Agent Responses ─────────────────────────────────────

describe('Malformed agent responses', () => {
  it('handles adapter returning null response field', async () => {
    const adapter = createMockAdapter({
      send: vi.fn(async (): Promise<AdapterOutput> => ({
        response: null as any,
        duration_ms: 100,
      })),
    });
    const runner = new Runner(adapter);
    const suite = buildMinimalSuite();

    const result = await runner.run(suite);
    // Should not crash, should produce a result
    expect(result.scenarios[0]).toBeDefined();
    expect(result.scenarios[0].kpis[0].score).toBe(0);
  });

  it('handles adapter returning undefined response field', async () => {
    const adapter = createMockAdapter({
      send: vi.fn(async (): Promise<AdapterOutput> => ({
        response: undefined as any,
        duration_ms: 100,
      })),
    });
    const runner = new Runner(adapter);
    const suite = buildMinimalSuite();

    const result = await runner.run(suite);
    expect(result.scenarios[0]).toBeDefined();
    expect(typeof result.scenarios[0].agent_output).toBe('string');
  });

  it('handles adapter returning numeric response', async () => {
    const adapter = createMockAdapter({
      send: vi.fn(async (): Promise<AdapterOutput> => ({
        response: 42 as any,
        duration_ms: 100,
      })),
    });
    const runner = new Runner(adapter);
    const suite = buildMinimalSuite();

    const result = await runner.run(suite);
    expect(result.scenarios[0]).toBeDefined();
    expect(typeof result.scenarios[0].agent_output).toBe('string');
  });

  it('handles adapter.send() throwing unexpectedly', async () => {
    const adapter = createMockAdapter({
      send: vi.fn(async () => {
        throw new TypeError('Cannot read properties of undefined');
      }),
    });
    const runner = new Runner(adapter, { retries: 0 });
    const suite = buildMinimalSuite();

    const result = await runner.run(suite);
    expect(result.scenarios[0].error).toContain('Cannot read properties');
    expect(result.scenarios[0].score).toBe(0);
  });

  it('handles empty string response gracefully for json-schema KPI', async () => {
    const adapter = createMockAdapter({
      send: vi.fn(async (): Promise<AdapterOutput> => ({
        response: '',
        duration_ms: 100,
      })),
    });
    const runner = new Runner(adapter);
    const suite = buildMinimalSuite({
      scenarios: [
        {
          id: 's1',
          name: 'JSON check',
          layer: 'execution',
          input: { prompt: 'return json' },
          kpis: [
            {
              id: 'k1',
              name: 'Valid JSON',
              weight: 1,
              method: 'automated',
              config: { type: 'json-parse' },
            },
          ],
        },
      ],
    });

    const result = await runner.run(suite);
    expect(result.scenarios[0].kpis[0].score).toBe(0);
    expect(result.scenarios[0].kpis[0].evidence).toContain('not valid JSON');
  });
});

// ─── Partial Suite Completion ──────────────────────────────────────

describe('Partial suite completion', () => {
  it('produces valid report when some scenarios fail and others succeed', async () => {
    let callCount = 0;
    const adapter = createMockAdapter({
      send: vi.fn(async (): Promise<AdapterOutput> => {
        callCount++;
        if (callCount === 1) {
          return { response: '', duration_ms: 0, error: 'Agent crashed' };
        }
        return { response: 'hello world', duration_ms: 100 };
      }),
    });
    const runner = new Runner(adapter, { retries: 0 });
    const suite = buildMinimalSuite({
      scenarios: [
        {
          id: 's1',
          name: 'Failing scenario',
          layer: 'execution',
          input: { prompt: 'test1' },
          kpis: [
            { id: 'k1', name: 'K1', weight: 1, method: 'automated', config: { type: 'contains', expected: 'hello' } },
          ],
        },
        {
          id: 's2',
          name: 'Succeeding scenario',
          layer: 'execution',
          input: { prompt: 'test2' },
          kpis: [
            { id: 'k2', name: 'K2', weight: 1, method: 'automated', config: { type: 'contains', expected: 'hello' } },
          ],
        },
      ],
    });

    const result = await runner.run(suite);
    // Both scenarios present in results
    expect(result.scenarios).toHaveLength(2);
    // First failed
    expect(result.scenarios[0].error).toContain('Agent crashed');
    expect(result.scenarios[0].score).toBe(0);
    // Second succeeded
    expect(result.scenarios[1].score).toBe(100);
    // Valid report structure
    expect(result.suite_id).toBe('error-test');
    expect(result.badge).toBeDefined();
    expect(result.scores.overall).toBeGreaterThan(0);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeTruthy();
  });

  it('produces valid report when all scenarios fail', async () => {
    const adapter = createMockAdapter({
      send: vi.fn(async (): Promise<AdapterOutput> => ({
        response: '',
        duration_ms: 0,
        error: 'Connection lost',
      })),
    });
    const runner = new Runner(adapter, { retries: 0 });
    const suite = buildMinimalSuite({
      scenarios: [
        {
          id: 's1',
          name: 'Fail 1',
          layer: 'execution',
          input: { prompt: 'test' },
          kpis: [
            { id: 'k1', name: 'K1', weight: 1, method: 'automated', config: { type: 'contains', expected: 'x' } },
          ],
        },
        {
          id: 's2',
          name: 'Fail 2',
          layer: 'execution',
          input: { prompt: 'test' },
          kpis: [
            { id: 'k2', name: 'K2', weight: 1, method: 'automated', config: { type: 'contains', expected: 'x' } },
          ],
        },
      ],
    });

    const result = await runner.run(suite);
    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios.every((s) => s.error)).toBe(true);
    expect(result.scores.overall).toBe(0);
    expect(result.badge).toBe('none');
    // Still a valid JSON-serializable result
    const json = JSON.parse(JSON.stringify(result));
    expect(json.suite_id).toBe('error-test');
  });

  it('reports partial results with correct layer scores', async () => {
    let callCount = 0;
    const adapter = createMockAdapter({
      send: vi.fn(async (): Promise<AdapterOutput> => {
        callCount++;
        if (callCount === 2) {
          return { response: '', duration_ms: 0, error: 'Timeout' };
        }
        return { response: 'hello reasoning output', duration_ms: 100 };
      }),
    });
    const runner = new Runner(adapter, { retries: 0 });
    const suite = buildMinimalSuite({
      scenarios: [
        {
          id: 's-exec',
          name: 'Execution',
          layer: 'execution',
          input: { prompt: 'exec' },
          kpis: [
            { id: 'k1', name: 'K1', weight: 1, method: 'automated', config: { type: 'contains', expected: 'hello' } },
          ],
        },
        {
          id: 's-reason',
          name: 'Reasoning (fails)',
          layer: 'reasoning',
          input: { prompt: 'reason' },
          kpis: [
            { id: 'k2', name: 'K2', weight: 1, method: 'automated', config: { type: 'contains', expected: 'reason' } },
          ],
        },
      ],
    });

    const result = await runner.run(suite);
    expect(result.scores.execution).toBe(100);
    expect(result.scores.reasoning).toBe(0);
    // Overall still computed correctly with available data
    expect(result.scores.overall).toBeGreaterThan(0);
  });
});

// ─── Stdio Adapter Resource Cleanup ────────────────────────────────

describe('Stdio adapter resource cleanup', () => {
  it('cleans up pending request and buffer on disconnect', async () => {
    // Import the adapter class directly
    const { StdioAdapter } = await import('../src/adapters/stdio.js');

    // Create adapter with a command that exists but won't respond
    const adapter = new StdioAdapter({
      adapter: 'stdio',
      command: 'cat',
      timeout_ms: 500,
    });

    await adapter.connect();
    const healthy = await adapter.healthCheck();
    expect(healthy).toBe(true);

    // Disconnect should clean up
    await adapter.disconnect();
    const healthAfter = await adapter.healthCheck();
    expect(healthAfter).toBe(false);
  });

  it('handles disconnect when process is already dead', async () => {
    const { StdioAdapter } = await import('../src/adapters/stdio.js');
    const adapter = new StdioAdapter({
      adapter: 'stdio',
      command: 'echo hello',
      timeout_ms: 500,
    });

    await adapter.connect();
    // Wait for the echo process to finish naturally
    await new Promise((r) => setTimeout(r, 200));

    // Disconnect on dead process should not throw
    await adapter.disconnect();
    expect(await adapter.healthCheck()).toBe(false);
  });

  it('returns error with stderr content when child process fails', async () => {
    const { StdioAdapter } = await import('../src/adapters/stdio.js');
    // Use a command that writes to stderr and exits
    const adapter = new StdioAdapter({
      adapter: 'stdio',
      command: 'node -e "process.stderr.write(\'fatal error\\n\'); process.exit(1)"',
      timeout_ms: 2000,
    });

    await adapter.connect();
    const result = await adapter.send({ prompt: 'test' });
    expect(result.error).toBeDefined();
    // Should include stderr content or exit code info
    expect(result.error).toMatch(/exit|fatal|code/i);
    await adapter.disconnect();
  });
});
