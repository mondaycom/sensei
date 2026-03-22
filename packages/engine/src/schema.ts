/**
 * Zod schemas for validating Sensei suite definitions.
 * Mirrors the types in types.ts for runtime validation.
 */

import { z } from 'zod';

// ─── KPI Config ──────────────────────────────────────────────────────

export const KPIConfigSchema = z.object({
  // Automated scoring
  type: z.enum(['contains', 'regex', 'json-schema', 'json-parse', 'function', 'numeric-range', 'word-count']).optional(),
  expected: z.unknown().optional(),
  tolerance: z.number().optional(),

  // LLM judge
  rubric: z.string().optional(),
  max_score: z.number().positive().optional(),
  criteria: z.array(z.string()).optional(),

  // Comparative judge
  comparison_type: z.enum(['improvement', 'consistency', 'adaptation']).optional(),
});

// ─── KPI Definition ──────────────────────────────────────────────────

export const KPIDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  weight: z.number().min(0).max(1),
  method: z.enum(['automated', 'llm-judge', 'comparative-judge']),
  config: KPIConfigSchema,
});

// ─── Scenario Input ──────────────────────────────────────────────────

export const ScenarioInputSchema = z.object({
  prompt: z.string().min(1),
  context: z.record(z.unknown()).optional(),
  fixtures: z.record(z.unknown()).optional(),
  feedback: z.string().optional(),
  previous_scenario: z.string().optional(),
});

// ─── Evaluation Layer ────────────────────────────────────────────────

export const EvaluationLayerSchema = z.enum(['execution', 'reasoning', 'self-improvement']);

// ─── Scenario Definition ─────────────────────────────────────────────

export const ScenarioDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  layer: EvaluationLayerSchema,
  description: z.string().optional(),
  input: ScenarioInputSchema,
  kpis: z.array(KPIDefinitionSchema).min(1),
  depends_on: z.string().optional(),
});

// ─── Scenario Pool ──────────────────────────────────────────────────

export const ScenarioPoolSchema = z.object({
  pool: z.object({
    id: z.string().min(1),
    count: z.number().int().min(0),
    seed: z.number().int().nullable().optional(),
    scenarios: z.array(ScenarioDefinitionSchema).min(1),
  }),
});

/** A single entry: either a regular scenario or a pool wrapper. */
export const ScenarioEntrySchema = z.union([ScenarioDefinitionSchema, ScenarioPoolSchema]);

// ─── Agent Config ────────────────────────────────────────────────────

export const AgentConfigSchema = z.object({
  adapter: z.enum(['http', 'stdio', 'openclaw', 'openai', 'openai-compat', 'langserve', 'langchain']),
  endpoint: z.string().optional(),
  command: z.string().optional(),
  session_key: z.string().optional(),
  timeout_ms: z.number().positive().optional(),
  health_check: z.string().optional(),
  headers: z.record(z.string()).optional(),
});

// ─── Judge Config ────────────────────────────────────────────────────

export const JudgeConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'openai-compatible']),
  model: z.string().min(1),
  api_key: z.string().optional(),
  base_url: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_retries: z.number().int().positive().optional(),
  multi_judge: z.boolean().optional(),
});

// ─── Evaluation Config ───────────────────────────────────────────────

export const EvaluationConfigSchema = z.object({
  scenarios_per_layer: z.object({
    execution: z.number().int().min(1).optional(),
    reasoning: z.number().int().min(1).optional(),
    'self-improvement': z.number().int().min(1).optional(),
  }).optional(),
}).optional();

// ─── Suite Definition ────────────────────────────────────────────────

// M13: Suite-level defaults that apply to all scenarios
export const SuiteDefaultsSchema = z.object({
  timeout_ms: z.number().positive().optional(),
  judge_model: z.string().optional(),
}).optional();

// Optional marketplace metadata for published suites
export const MarketplaceSchema = z.object({
  slug: z.string().min(1),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
}).optional();

export const SuiteDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  namespace: z.string().min(1).optional(),
  description: z.string().optional(),
  agent: AgentConfigSchema.optional(),
  judge: JudgeConfigSchema.optional(),
  evaluation: EvaluationConfigSchema,
  defaults: SuiteDefaultsSchema,
  marketplace: MarketplaceSchema,
  scenarios: z.array(ScenarioEntrySchema).min(1),
  metadata: z.record(z.unknown()).optional(),
});
