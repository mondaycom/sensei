/**
 * Sensei Core Types
 * All type definitions for the qualification engine
 */

// ─── Suite Definition ────────────────────────────────────────────────

export interface MarketplaceMetadata {
  slug: string;
  category?: string;
  tags?: string[];
}

export interface SuiteDefinition {
  id: string;
  name: string;
  version: string;
  namespace?: string;
  description?: string;
  agent?: AgentConfig;
  judge?: JudgeConfig;
  marketplace?: MarketplaceMetadata;
  scenarios: ScenarioDefinition[];
  metadata?: Record<string, unknown>;
}

/**
 * Build a fully-qualified suite ID: namespace/id@version.
 * Falls back to id@version when no namespace is set,
 * and plain id when version is also absent.
 */
export function qualifiedSuiteId(suite: Pick<SuiteDefinition, 'id' | 'version' | 'namespace'>): string {
  const base = suite.namespace ? `${suite.namespace}/${suite.id}` : suite.id;
  return suite.version ? `${base}@${suite.version}` : base;
}

export interface AgentConfig {
  adapter: 'http' | 'stdio' | 'openclaw' | 'openai' | 'openai-compat' | 'langserve' | 'langchain';
  endpoint?: string;          // For HTTP adapter
  command?: string;           // For stdio adapter
  session_key?: string;       // For OpenClaw adapter
  timeout_ms?: number;        // Per-request timeout
  health_check?: string;      // Health check endpoint/command
  headers?: Record<string, string>;
}

export interface JudgeConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible';
  model: string;
  api_key?: string;           // Falls back to env vars
  base_url?: string;
  temperature?: number;       // Default 0.0
  max_retries?: number;       // Default 3
  multi_judge?: boolean;      // Use 3 judges, take median
  rate_limit?: {
    rpm?: number;             // Requests per minute (default: 60)
    rps?: number;             // Requests per second (overrides rpm-derived rate)
  };
  retry?: {
    base_delay_ms?: number;   // Base delay before first retry (default: 500)
    max_delay_ms?: number;    // Maximum delay cap (default: 30000)
    jitter?: number;          // Jitter factor 0-1 (default: 0.3)
  };
}

// ─── Scenario Pool ──────────────────────────────────────────────────

export interface ScenarioPool {
  id: string;
  count: number;
  seed?: number | null;         // Fixed seed for reproducible selection (null = random)
  scenarios: ScenarioDefinition[];
}

/** A single entry in the suite's scenarios array: either a plain scenario or a pool wrapper. */
export type ScenarioEntry = ScenarioDefinition | { pool: ScenarioPool };

// ─── Scenario ────────────────────────────────────────────────────────

export interface ScenarioDefinition {
  id: string;
  name: string;
  layer: EvaluationLayer;
  description?: string;
  input: ScenarioInput;
  kpis: KPIDefinition[];
  depends_on?: string;        // Scenario ID this depends on (e.g., reasoning depends on execution output)
}

export type EvaluationLayer = 'execution' | 'reasoning' | 'self-improvement';

export interface ScenarioInput {
  prompt: string;
  context?: Record<string, unknown>;
  fixtures?: Record<string, unknown>;
  feedback?: string;          // For self-improvement layer
  previous_scenario?: string; // Reference to previous scenario's output
}

// ─── KPI ─────────────────────────────────────────────────────────────

export interface KPIDefinition {
  id: string;
  name: string;
  weight: number;             // Weight in scenario score (0-1)
  method: ScoringMethod;
  config: KPIConfig;
}

export type ScoringMethod = 'automated' | 'llm-judge' | 'comparative-judge';

export interface KPIConfig {
  // For automated scoring
  type?: 'contains' | 'regex' | 'json-schema' | 'json-parse' | 'function' | 'numeric-range' | 'word-count';
  expected?: unknown;
  tolerance?: number;

  // For LLM judge scoring
  rubric?: string;
  max_score?: number;         // Default 10
  criteria?: string[];

  // For comparative judge
  comparison_type?: 'improvement' | 'consistency' | 'adaptation';
}

// ─── Results ─────────────────────────────────────────────────────────

export interface SuiteResult {
  suite_id: string;
  suite_version: string;
  agent_id: string;
  timestamp: string;
  scores: LayerScores;
  scenarios: ScenarioResult[];
  badge: Badge;
  duration_ms: number;
  judge_model?: string;
}

export interface LayerScores {
  overall: number;            // Weighted: execution 50%, reasoning 30%, improvement 20%
  execution: number;
  reasoning: number;
  self_improvement: number;
}

export interface ScenarioResult {
  scenario_id: string;
  scenario_name: string;
  layer: EvaluationLayer;
  score: number;              // 0-100
  kpis: KPIResult[];
  duration_ms: number;
  agent_input: string;
  agent_output: string;
  error?: string;
}

export interface KPIResult {
  kpi_id: string;
  kpi_name: string;
  score: number;              // 0-100 normalized
  raw_score: number;
  max_score: number;
  weight: number;
  method: ScoringMethod;
  evidence: string;           // Explanation of score
  metadata?: Record<string, unknown>;
}

export type Badge = 'none' | 'bronze' | 'silver' | 'gold';

// ─── Adapter Interface ───────────────────────────────────────────────

export interface AgentAdapter {
  name: string;
  connect(): Promise<void>;
  healthCheck(): Promise<boolean>;
  send(input: AdapterInput): Promise<AdapterOutput>;
  disconnect(): Promise<void>;
}

export interface AdapterInput {
  prompt: string;
  context?: Record<string, unknown>;
  timeout_ms?: number;
}

export interface AdapterOutput {
  response: string;
  duration_ms: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

// ─── Judge Interface ─────────────────────────────────────────────────

export interface JudgeVerdict {
  score: number;
  max_score: number;
  reasoning: string;
  confidence: number;         // 0-1
}

// ─── Progress Events ────────────────────────────────────────────

export type ProgressEventType =
  | 'suite:started'
  | 'suite:completed'
  | 'scenario:started'
  | 'scenario:completed'
  | 'scoring:started'
  | 'scoring:completed';

export interface ProgressEvent {
  type: ProgressEventType;
  timestamp: string;
  elapsed_ms: number;
  /** Completed count / total count for scenario-level events */
  progress?: { completed: number; total: number };
  /** Present on scenario:* events */
  scenario_id?: string;
  /** Present on scoring:* events */
  kpi_id?: string;
  /** Present on *:completed events with results */
  score?: number;
  /** Present on suite:completed */
  badge?: Badge;
}

export type ProgressCallback = (event: ProgressEvent) => void;

// ─── Concurrency ────────────────────────────────────────────────

export interface ConcurrencyOptions {
  /** Max concurrent scenario executions (default 5) */
  scenarios?: number;
  /** Max concurrent multi-judge LLM calls (default 3) */
  judges?: number;
}

// ─── Constants ───────────────────────────────────────────────────────

export const LAYER_WEIGHTS: Record<EvaluationLayer, number> = {
  'execution': 0.50,
  'reasoning': 0.30,
  'self-improvement': 0.20,
};

export const BADGE_THRESHOLDS: Record<Badge, number> = {
  'gold': 90,
  'silver': 75,
  'bronze': 60,
  'none': 0,
};

export function determineBadge(score: number): Badge {
  if (score >= BADGE_THRESHOLDS.gold) return 'gold';
  if (score >= BADGE_THRESHOLDS.silver) return 'silver';
  if (score >= BADGE_THRESHOLDS.bronze) return 'bronze';
  return 'none';
}
