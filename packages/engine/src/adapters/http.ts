/**
 * HTTP Adapter — POST JSON to an agent endpoint.
 * Supports health check, configurable timeout, and retries.
 */

import type { AgentAdapter, AgentConfig, AdapterInput, AdapterOutput } from '../types.js';
import { registerAdapter } from './types.js';

export class HttpAdapter implements AgentAdapter {
  readonly name = 'http';
  private endpoint: string;
  private healthEndpoint: string;
  private timeoutMs: number;
  private maxRetries: number;
  private headers: Record<string, string>;

  constructor(private config: AgentConfig) {
    if (!config.endpoint) {
      throw new Error('HttpAdapter requires an endpoint URL');
    }
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.healthEndpoint = config.health_check ?? `${this.endpoint}/health`;
    this.timeoutMs = config.timeout_ms ?? 30_000;
    this.maxRetries = 3;
    this.headers = {
      'Content-Type': 'application/json',
      ...config.headers,
    };
  }

  async connect(): Promise<void> {
    // HTTP is stateless — nothing to initialize
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(this.healthEndpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: this.headers,
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

        const res = await fetch(`${this.endpoint}/execute`, {
          method: 'POST',
          headers: this.headers,
          signal: controller.signal,
          body: JSON.stringify({
            task: input.prompt,
            context: input.context,
          }),
        });
        clearTimeout(timer);

        if (!res.ok) {
          throw new Error(`Agent returned HTTP ${res.status}: ${await res.text()}`);
        }

        const body = (await res.json()) as Record<string, unknown>;
        const duration_ms = Date.now() - start;

        return {
          response: (body.response as string) ?? '',
          duration_ms,
          metadata: (body.structured as Record<string, unknown>) ?? undefined,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Classify network errors for clear diagnostics
        lastError = classifyNetworkError(lastError, this.endpoint);
        if (attempt < this.maxRetries) {
          // Exponential back-off: 200ms, 400ms, 800ms
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
    // HTTP is stateless — nothing to tear down
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Classify common network errors into clear, actionable messages.
 * Handles connection resets, DNS failures, socket timeouts, and abort signals.
 */
export function classifyNetworkError(err: Error, endpoint: string): Error {
  const msg = err.message || '';
  const code = (err as NodeJS.ErrnoException).code ?? '';

  if (code === 'ECONNRESET' || msg.includes('ECONNRESET')) {
    return new Error(`Connection reset by ${endpoint} — the server closed the connection unexpectedly. Check if the agent is still running.`);
  }
  if (code === 'ENOTFOUND' || msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
    const host = endpoint.replace(/^https?:\/\//, '').split(/[:/]/)[0];
    return new Error(`DNS lookup failed for "${host}" — check the hostname in your endpoint URL (${endpoint}).`);
  }
  if (code === 'ETIMEDOUT' || msg.includes('ETIMEDOUT')) {
    return new Error(`Socket connection timed out to ${endpoint} — the server may be unreachable or firewalled.`);
  }
  if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) {
    return new Error(`Connection refused by ${endpoint} — ensure the agent server is running and listening on the correct port.`);
  }
  if (err.name === 'AbortError' || msg.includes('aborted') || msg.includes('The operation was aborted')) {
    return new Error(`Request to ${endpoint} timed out — the agent did not respond within the configured timeout.`);
  }
  if (code === 'EPIPE' || msg.includes('EPIPE')) {
    return new Error(`Broken pipe to ${endpoint} — the connection was closed before the request completed.`);
  }
  if (code === 'UND_ERR_SOCKET' || msg.includes('socket hang up') || msg.includes('other side closed')) {
    return new Error(`Socket hung up for ${endpoint} — the server terminated the connection mid-request.`);
  }

  return err;
}

registerAdapter('http', (config) => new HttpAdapter(config));
