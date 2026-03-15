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
    // Should have error from the judge throwing
    expect(result.scenarios[0].error).toContain('Judge API rate limited');
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

    // Should still run — depends_on just won't inject previous output
    const result = await runner.run(suite);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0].scenario_id).toBe('orphan');
    // No "Previous output:" because dep wasn't found
    expect(result.scenarios[0].agent_input).not.toContain('Previous output:');
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
