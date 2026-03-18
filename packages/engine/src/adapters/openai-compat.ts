/**
 * OpenAI-Compatible Adapter — Universal integration with any agent
 * exposing an OpenAI-compatible /v1/chat/completions endpoint.
 *
 * Works with: OpenAI, Azure OpenAI, OpenClaw Gateway, vLLM, Ollama,
 * LiteLLM, LocalAI, and any OpenAI-compatible API.
 *
 * Configuration:
 *   - endpoint: Base URL (default: http://127.0.0.1:18789)
 *   - session_key: Optional stable session key for multi-turn scenarios
 *   - headers: { Authorization: "Bearer <token>" } or set OPENAI_API_KEY env
 *
 * The adapter sends each scenario prompt as a chat completion request and
 * extracts the assistant's response.
 */

import type { AgentAdapter, AgentConfig, AdapterInput, AdapterOutput } from '../types.js';
import { registerAdapter } from './types.js';
import { classifyNetworkError } from './http.js';

export class OpenAICompatAdapter implements AgentAdapter {
  readonly name = 'openai-compat';

  private endpoint: string;
  private healthEndpoint: string;
  private timeoutMs: number;
  private maxRetries: number;
  private headers: Record<string, string>;
  private sessionUser: string;
  private model: string;

  constructor(private config: AgentConfig) {
    const base = (config.endpoint ?? 'http://127.0.0.1:18789').replace(/\/$/, '');
    this.endpoint = `${base}/v1/chat/completions`;
    this.healthEndpoint = config.health_check ?? `${base}/v1/chat/completions`;
    this.timeoutMs = config.timeout_ms ?? 60_000;
    this.maxRetries = 3;

    // Auth: explicit header > OPENCLAW_GATEWAY_TOKEN > OPENAI_API_KEY
    const token = config.headers?.['Authorization']
      ?? (process.env.OPENCLAW_GATEWAY_TOKEN
        ? `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN}`
        : undefined)
      ?? (process.env.OPENAI_API_KEY
        ? `Bearer ${process.env.OPENAI_API_KEY}`
        : undefined);

    this.headers = {
      'Content-Type': 'application/json',
      ...config.headers,
      ...(token ? { Authorization: token } : {}),
    };

    // Stable session user key for multi-turn (scenario chaining)
    this.sessionUser = config.session_key ?? `sensei-${Date.now()}`;

    // Model name — configurable, defaults to 'default'
    this.model = (config as unknown as Record<string, unknown>).model as string ?? 'default';
  }

  async connect(): Promise<void> {
    // Validate the endpoint is reachable
    const ok = await this.healthCheck();
    if (!ok) {
      throw new Error(
        `OpenAI-compatible endpoint not reachable at ${this.endpoint}. ` +
        `Ensure the server is running and the /v1/chat/completions endpoint is enabled.`,
      );
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      // A simple POST with a minimal message — any non-5xx response means the server is up
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
      clearTimeout(timer);
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
            model: this.model,
            messages,
            user: this.sessionUser,
          }),
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`OpenAI-compatible endpoint returned HTTP ${res.status}: ${errBody}`);
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
        lastError = classifyNetworkError(lastError, this.endpoint);
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

// Register under multiple aliases for flexibility
registerAdapter('openai-compat', (config) => new OpenAICompatAdapter(config));
registerAdapter('openai', (config) => new OpenAICompatAdapter(config));
registerAdapter('openclaw', (config) => new OpenAICompatAdapter(config));
