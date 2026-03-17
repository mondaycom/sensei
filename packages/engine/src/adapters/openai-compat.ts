/**
 * OpenClaw Adapter — Native integration with OpenClaw agents via the
 * Gateway's OpenAI-compatible /v1/chat/completions endpoint.
 *
 * Configuration:
 *   - endpoint: Gateway base URL (default: http://127.0.0.1:18789)
 *   - session_key: Optional stable session key for multi-turn scenarios
 *   - headers: { Authorization: "Bearer <token>" } or set OPENCLAW_GATEWAY_TOKEN env
 *
 * The adapter sends each scenario prompt as a chat completion request and
 * extracts the assistant's response. Session continuity is maintained via
 * the OpenAI `user` field (derived from suite+run id).
 */

import type { AgentAdapter, AgentConfig, AdapterInput, AdapterOutput } from '../types.js';
import { registerAdapter } from './types.js';

export class OpenClawAdapter implements AgentAdapter {
  readonly name = 'openclaw';

  private endpoint: string;
  private healthEndpoint: string;
  private timeoutMs: number;
  private maxRetries: number;
  private headers: Record<string, string>;
  private sessionUser: string;

  constructor(private config: AgentConfig) {
    const base = (config.endpoint ?? 'http://127.0.0.1:18789').replace(/\/$/, '');
    this.endpoint = `${base}/v1/chat/completions`;
    this.healthEndpoint = config.health_check ?? `${base}/v1/chat/completions`;
    this.timeoutMs = config.timeout_ms ?? 60_000;
    this.maxRetries = 3;

    // Auth: explicit header > env var
    const token = config.headers?.['Authorization']
      ?? (process.env.OPENCLAW_GATEWAY_TOKEN
        ? `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN}`
        : undefined);

    this.headers = {
      'Content-Type': 'application/json',
      ...config.headers,
      ...(token ? { Authorization: token } : {}),
    };

    // Stable session user key for multi-turn (scenario chaining)
    this.sessionUser = config.session_key ?? `sensei-${Date.now()}`;
  }

  async connect(): Promise<void> {
    // Validate the gateway is reachable
    const ok = await this.healthCheck();
    if (!ok) {
      throw new Error(
        `OpenClaw Gateway not reachable at ${this.endpoint}. ` +
        `Ensure gateway.http.endpoints.chatCompletions.enabled is true in your OpenClaw config.`,
      );
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      // A simple POST with empty messages will fail with 4xx, but the
      // connection itself proves the gateway is up. We check for !5xx.
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: 'openclaw',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
      clearTimeout(timer);
      // Any non-5xx response means the gateway is up
      return res.status < 500;
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

        // Build messages array
        const messages: Array<{ role: string; content: string }> = [];

        // If there's context (e.g., previous scenario output for self-improvement),
        // include it as a system message
        if (input.context && Object.keys(input.context).length > 0) {
          const contextParts: string[] = [];
          if (input.context.previous_output) {
            contextParts.push(`Previous response:\n${input.context.previous_output}`);
          }
          if (input.context.feedback) {
            contextParts.push(`Feedback:\n${input.context.feedback}`);
          }
          if (contextParts.length > 0) {
            messages.push({ role: 'system', content: contextParts.join('\n\n') });
          }
        }

        messages.push({ role: 'user', content: input.prompt });

        const res = await fetch(this.endpoint, {
          method: 'POST',
          headers: this.headers,
          signal: controller.signal,
          body: JSON.stringify({
            model: 'openclaw',
            messages,
            user: this.sessionUser,
          }),
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`OpenClaw Gateway returned HTTP ${res.status}: ${errBody}`);
        }

        const body = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
          usage?: { total_tokens?: number };
        };

        const duration_ms = Date.now() - start;
        const response = body.choices?.[0]?.message?.content ?? '';

        return {
          response,
          duration_ms,
          metadata: body.usage ? { tokens: body.usage.total_tokens } : undefined,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
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

registerAdapter('openclaw', (config) => new OpenClawAdapter(config));
