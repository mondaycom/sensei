/**
 * LangServe Adapter — Integration with LangChain's LangServe deployments.
 *
 * LangServe exposes LangChain runnables as REST endpoints with a standard
 * protocol: POST to `<endpoint>/invoke` with `{ "input": { ... } }`.
 *
 * Configuration:
 *   - endpoint: LangServe base URL (e.g., http://localhost:8000/my-chain)
 *   - headers: Optional auth headers
 *   - timeout_ms: Per-request timeout (default: 60s)
 *
 * The adapter supports both string and object output formats:
 *   - `{ "output": "response text" }`
 *   - `{ "output": { "content": "response text" } }`
 */

import type { AgentAdapter, AgentConfig, AdapterInput, AdapterOutput } from '../types.js';
import { registerAdapter } from './types.js';
import { classifyNetworkError } from './http.js';

export class LangServeAdapter implements AgentAdapter {
  readonly name = 'langserve';

  private endpoint: string;
  private invokeUrl: string;
  private healthEndpoint: string;
  private timeoutMs: number;
  private maxRetries: number;
  private headers: Record<string, string>;

  constructor(private config: AgentConfig) {
    if (!config.endpoint) {
      throw new Error('LangServeAdapter requires an endpoint URL (e.g., http://localhost:8000/my-chain)');
    }
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.invokeUrl = `${this.endpoint}/invoke`;
    this.healthEndpoint = config.health_check ?? `${this.endpoint}/input_schema`;
    this.timeoutMs = config.timeout_ms ?? 60_000;
    this.maxRetries = 3;
    this.headers = {
      'Content-Type': 'application/json',
      ...config.headers,
    };
  }

  async connect(): Promise<void> {
    const ok = await this.healthCheck();
    if (!ok) {
      throw new Error(
        `LangServe endpoint not reachable at ${this.endpoint}. ` +
        `Ensure the LangServe server is running.`,
      );
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      // LangServe exposes /input_schema as a GET endpoint by default
      const res = await fetch(this.healthEndpoint, {
        method: 'GET',
        headers: this.headers,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  async send(input: AdapterInput): Promise<AdapterOutput> {
    const timeout = input.timeout_ms ?? this.timeoutMs;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const start = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        // Build the LangServe input payload
        const inputPayload: Record<string, unknown> = {
          task: input.prompt,
        };

        // Include context fields if present
        if (input.context && Object.keys(input.context).length > 0) {
          if (input.context.previous_output) {
            inputPayload.previous_output = input.context.previous_output;
          }
          if (input.context.feedback) {
            inputPayload.feedback = input.context.feedback;
          }
        }

        const res = await fetch(this.invokeUrl, {
          method: 'POST',
          headers: this.headers,
          signal: controller.signal,
          body: JSON.stringify({ input: inputPayload }),
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`LangServe returned HTTP ${res.status}: ${errBody}`);
        }

        const body = (await res.json()) as {
          output?: string | { content?: string; [key: string]: unknown };
          metadata?: Record<string, unknown>;
        };

        const duration_ms = Date.now() - start;

        // Extract response — support both string and object output formats
        let response: string;
        if (typeof body.output === 'string') {
          response = body.output;
        } else if (body.output && typeof body.output === 'object') {
          response = (body.output as { content?: string }).content ?? JSON.stringify(body.output);
        } else {
          response = '';
        }

        return {
          response,
          duration_ms,
          metadata: body.metadata ?? undefined,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        lastError = classifyNetworkError(lastError, this.invokeUrl);
        if (attempt < this.maxRetries) {
          await sleep(200 * Math.pow(2, attempt));
        }
      }
    }

    return {
      response: '',
      duration_ms: 0,
      error: lastError?.message ?? 'Unknown error after retries',
    };
  }

  async disconnect(): Promise<void> {
    // Stateless — nothing to tear down
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

registerAdapter('langserve', (config) => new LangServeAdapter(config));
