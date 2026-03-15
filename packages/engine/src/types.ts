/**
 * Sensei Core Types
 * All type definitions for the qualification engine
 */

// ─── Suite Definition ────────────────────────────────────────────────

export interface SuiteDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  agent: AgentConfig;
  judge?: JudgeConfig;
  scenarios: ScenarioDefinition[];
  metadata?: Record<string, unknown>;
}

export interface AgentConfig {
  adapter: 'http' | 'stdio' | 'openclaw' | 'langchain';
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
}

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
