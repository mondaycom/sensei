/**
 * Stdio Adapter — spawn a child process, communicate via stdin/stdout JSON.
 *
 * Protocol:
 *   stdin  → JSON line: { "task": "...", "context": {...} }
 *   stdout ← JSON line: { "response": "...", "structured": {...} }
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { AgentAdapter, AgentConfig, AdapterInput, AdapterOutput } from '../types.js';
import { registerAdapter } from './types.js';

interface PendingRequest {
  resolve: (output: AdapterOutput) => void;
  startTime: number;
  timer: ReturnType<typeof setTimeout>;
}

export class StdioAdapter implements AgentAdapter {
  readonly name = 'stdio';
  private command: string;
  private args: string[];
  private timeoutMs: number;
  private proc: ChildProcess | null = null;
  private buffer = '';
  private pending: PendingRequest | null = null;
  private stderrBuffer = '';

  constructor(private config: AgentConfig) {
    if (!config.command) {
      throw new Error('StdioAdapter requires a command');
    }
    const parts = config.command.split(/\s+/);
    this.command = parts[0];
    this.args = parts.slice(1);
    this.timeoutMs = config.timeout_ms ?? 30_000;
  }

  async connect(): Promise<void> {
    this.proc = spawn(this.command, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // M2: Class-level buffer + exit handler
    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.drainBuffer();
    });

    // Capture stderr for diagnostics
    this.proc.stderr!.on('data', (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString();
      // Cap stderr buffer to avoid memory bloat
      if (this.stderrBuffer.length > 10_000) {
        this.stderrBuffer = this.stderrBuffer.slice(-5_000);
      }
    });

    // Handle spawn errors (e.g., command not found)
    this.proc.on('error', (err) => {
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.resolve({
          response: '',
          duration_ms: Date.now() - this.pending.startTime,
          error: `Child process error: ${err.message}`,
        });
        this.pending = null;
      }
    });

    this.proc.on('exit', (code, signal) => {
      if (this.pending) {
        clearTimeout(this.pending.timer);
        const reason = signal
          ? `killed by signal ${signal}`
          : `exited with code ${code}`;
        const stderr = this.stderrBuffer.trim();
        const detail = stderr ? `\nStderr: ${stderr.slice(0, 500)}` : '';
        this.pending.resolve({
          response: '',
          duration_ms: Date.now() - this.pending.startTime,
          error: `Child process ${reason}${detail}`,
        });
        this.pending = null;
      }
    });
  }

  private drainBuffer(): void {
    if (!this.pending) return;

    const newlineIdx = this.buffer.indexOf('\n');
    if (newlineIdx === -1) return;

    const line = this.buffer.slice(0, newlineIdx).trim();
    this.buffer = this.buffer.slice(newlineIdx + 1);

    const { resolve, startTime, timer } = this.pending;
    this.pending = null;
    clearTimeout(timer);

    try {
      const body = JSON.parse(line) as Record<string, unknown>;
      resolve({
        response: (body.response as string) ?? '',
        duration_ms: Date.now() - startTime,
        metadata: (body.structured as Record<string, unknown>) ?? undefined,
      });
    } catch {
      resolve({
        response: line,
        duration_ms: Date.now() - startTime,
        error: 'Failed to parse JSON from agent stdout',
      });
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.proc !== null && this.proc.exitCode === null;
  }

  async send(input: AdapterInput): Promise<AdapterOutput> {
    if (!this.proc?.stdin || !this.proc?.stdout) {
      return { response: '', duration_ms: 0, error: 'Process not connected' };
    }

    const timeout = input.timeout_ms ?? this.timeoutMs;
    const start = Date.now();

    return new Promise<AdapterOutput>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.resolve === resolve) {
          this.pending = null;
        }
        resolve({
          response: '',
          duration_ms: Date.now() - start,
          error: `Stdio adapter timed out after ${timeout}ms`,
        });
      }, timeout);

      this.pending = { resolve, startTime: start, timer };

      const payload = JSON.stringify({ task: input.prompt, context: input.context }) + '\n';
      this.proc!.stdin!.write(payload);

      // Check if buffer already has a complete line from earlier data
      this.drainBuffer();
    });
  }

  async disconnect(): Promise<void> {
    if (this.proc && this.proc.exitCode === null) {
      this.proc.kill('SIGTERM');
      // SIGKILL fallback if process doesn't exit within 3s
      const proc = this.proc;
      const killTimer = setTimeout(() => {
        try { if (proc.exitCode === null) proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, 3_000);
      this.proc = null;
      // Clear the fallback timer if not needed (fire-and-forget cleanup)
      proc.once('exit', () => clearTimeout(killTimer));
    }
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
    this.buffer = '';
    this.stderrBuffer = '';
  }
}

registerAdapter('stdio', (config) => new StdioAdapter(config));
