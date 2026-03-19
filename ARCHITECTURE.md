# Sensei — Architecture & Technical Plan

## Overview

Sensei is a standalone, open-source agent qualification engine. It runs test suites against AI agents and produces scored, structured reports. AgentTalent.ai consumes Sensei as a dependency but Sensei has no dependency on AgentTalent.

## Design Principles

1. **Agent-agnostic** — Any agent, any framework, any model. Sensei talks to agents through adapters.
2. **Suite-driven** — Tests are defined declaratively in YAML/TypeScript. No code changes to add tests.
3. **Three-layer evaluation** — Every suite tests execution, reasoning, and self-improvement.
4. **Reproducible** — Same suite + same agent = same score (deterministic where possible, statistical where not).
5. **Composable** — Suites, scenarios, and KPIs are modular and reusable.
6. **LLM-as-judge** — Complex quality assessment uses a separate LLM judge (configurable).

## Tech Stack

- **Language:** TypeScript (Node.js)
- **Package manager:** npm (published as `@mondaycom/sensei-cli`, `@mondaycom/sensei-engine`, `@mondaycom/sensei-sdk`)
- **Test definition:** YAML (declarative) + TypeScript SDK (programmatic)
- **LLM Judge:** OpenAI / any OpenAI-compatible API (Anthropic via proxy)
- **Output:** JSON reports, HTML reports, terminal output
- **CI/CD:** GitHub Actions integration

## Core Components

### 1. Engine (`@mondaycom/sensei-engine`)

The core library. No CLI, no HTTP — pure evaluation logic.

```
engine/src/
├── types.ts          # Core type definitions + constants (LAYER_WEIGHTS, BADGE_THRESHOLDS)
├── schema.ts         # Zod validation schemas for suite definitions
├── loader.ts         # Loads suite definitions (YAML) + resolves fixture files
├── runner.ts         # Orchestrates test execution (connect → health check → run → disconnect)
├── scorer.ts         # Calculates scores from KPI results (automated scoring)
├── judge.ts          # LLM-as-judge evaluation (single + multi-judge median)
├── comparator.ts     # Comparative evaluation (before/after for self-improvement)
├── reporter.ts       # Generates reports (JSON + ANSI terminal)
├── llm-client.ts     # Shared OpenAI-compatible client factory
└── adapters/
    ├── types.ts      # Adapter interface + registry + factory
    ├── http.ts       # HTTP POST adapter (with retry)
    ├── stdio.ts      # Stdin/stdout JSON-line adapter
    └── openclaw.ts   # OpenClaw native adapter
```

#### Runner Flow

```
1. Load suite definition (YAML or JSON, validated via Zod)
2. Validate depends_on references (throws on unresolved)
3. Initialize adapter (connect to agent)
4. Health check agent
5. For each scenario (ordered by layer: execution → reasoning → self-improvement):
   a. Build prompt (inject depends_on output + feedback if present)
   b. Send to agent via adapter
   c. Score KPIs (automated or via judge/comparator callbacks)
   d. Calculate weighted scenario score
6. Disconnect adapter (always, via try/finally)
7. Aggregate layer scores and overall score
8. Determine badge
9. Return SuiteResult
```

#### Core Types

```typescript
interface AgentAdapter {
  name: string;
  connect(): Promise<void>;
  healthCheck(): Promise<boolean>;
  send(input: AdapterInput): Promise<AdapterOutput>;
  disconnect(): Promise<void>;
}

interface AdapterInput {
  prompt: string;
  context?: Record<string, unknown>;
  timeout_ms?: number;
}

interface AdapterOutput {
  response: string;
  duration_ms: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

interface KPIResult {
  kpi_id: string;
  kpi_name: string;
  score: number;          // 0-100 normalized
  raw_score: number;      // Raw value (e.g., 4.5/5)
  max_score: number;      // Maximum possible
  weight: number;         // Weight in scenario score (0-1)
  method: 'automated' | 'llm-judge' | 'comparative-judge';
  evidence: string;       // Explanation of score
  metadata?: Record<string, unknown>;
}

interface ScenarioResult {
  scenario_id: string;
  scenario_name: string;
  layer: 'execution' | 'reasoning' | 'self-improvement';
  score: number;          // Weighted average of KPIs (0-100)
  kpis: KPIResult[];
  duration_ms: number;
  agent_input: string;    // What was sent to the agent
  agent_output: string;   // What the agent produced
  error?: string;
}

interface SuiteResult {
  suite_id: string;
  suite_version: string;
  agent_id: string;
  timestamp: string;
  scores: {
    overall: number;      // Weighted: execution 50%, reasoning 30%, improvement 20%
    execution: number;
    reasoning: number;
    self_improvement: number;
  };
  scenarios: ScenarioResult[];
  badge: 'none' | 'bronze' | 'silver' | 'gold';
  duration_ms: number;
  judge_model?: string;
}
```

#### Score Aggregation

```
Scenario Score = Σ(kpi.score × kpi.weight) / Σ(kpi.weight)

Layer Score = average(scenarios in layer)

Overall Score = execution × 0.50 + reasoning × 0.30 + self_improvement × 0.20
  (missing layers are excluded and remaining weights re-normalized)

Badge:
  gold   >= 90
  silver >= 75
  bronze >= 60
  none   < 60
```

### 2. LLM Judge (`judge.ts`)

For KPIs that can't be measured automatically (e.g., "Is this email personalized?"), we use an LLM as judge.

```typescript
interface JudgeConfig {
  provider: 'openai' | 'anthropic' | 'openai-compatible';
  model: string;              // e.g., "gpt-4o"
  api_key?: string;           // Falls back to env vars (OPENAI_API_KEY / ANTHROPIC_API_KEY)
  base_url?: string;          // For custom endpoints / proxy
  temperature?: number;       // Default 0.0 for consistency
  max_retries?: number;       // Default 3
  multi_judge?: boolean;      // Use 3 judges, take median
}

interface JudgeVerdict {
  score: number;
  max_score: number;
  reasoning: string;
  confidence: number;         // 0-1
}
```

**Judge prompt structure:**
- System: "You are an expert evaluator. Respond with JSON only."
- User: KPI name + rubric + task + input context + agent output + instructions
- Response: `{ score, max_score, reasoning, confidence }`

**Multi-judge:** Runs 3 judges in parallel (with concurrency limit), takes median score. Best verdict (closest to median) provides the reasoning.

**Per-call timeout:** 60 seconds via AbortController. NaN scores are rejected.

### 3. Comparator (`comparator.ts`)

For self-improvement layer KPIs. Compares original output with revised output after feedback.

Supports three comparison types:
- `improvement` — Did the agent meaningfully address the feedback?
- `consistency` — Did the agent maintain strengths while improving?
- `adaptation` — Did the agent adapt its approach appropriately?

Uses the same LLM client as Judge. NaN scores are validated and rejected.

### 4. Automated Scorer (`scorer.ts`)

Deterministic scoring without LLM:

| Type | Description |
|------|-------------|
| `contains` | Output includes expected string |
| `regex` | Output matches regex pattern (with ReDoS protection) |
| `json-schema` | Output validates against JSON Schema (Ajv) |
| `json-parse` | Output is valid JSON |
| `numeric-range` | Output parses to number within `{ min, max }` |
| `word-count` | Output word count within `{ min, max }` (with optional tolerance) |
| `function` | Custom scoring function registered via SDK `registerKPI()` |

### 5. Adapters

#### HTTP Adapter (`adapters/http.ts`)

```
POST <endpoint>
Body: { task: "<prompt>", context: { ... } }
Response: { response: "<output>", structured: { ... } }
```

Features: Configurable timeout, retry on failure, custom headers.

#### Stdio Adapter (`adapters/stdio.ts`)

Spawns a child process. Communicates via JSON lines on stdin/stdout.

```
→ stdin:  { "task": "...", "context": { ... } }\n
← stdout: { "response": "...", "structured": { ... } }\n
```

Features: Class-level buffer, child process exit handler, sequential request handling.

#### OpenAI-Compatible Adapter (`adapters/openai-compat.ts`)

Universal integration with any OpenAI-compatible `/v1/chat/completions` endpoint.
Works with OpenAI, Azure OpenAI, OpenClaw Gateway, vLLM, Ollama, LiteLLM, LocalAI, etc.

```
POST <endpoint>/v1/chat/completions
Body: { model: "...", messages: [...], user: "<session>" }
Response: { choices: [{ message: { content: "..." } }] }
```

Registered as: `openai-compat`, `openai`, `openclaw` (backward-compatible alias).

Features: Auth via headers/env, session continuity, retry with exponential backoff, configurable model.

#### LangServe Adapter (`adapters/langserve.ts`)

Integration with LangChain's LangServe deployments.

```
POST <endpoint>/invoke
Body: { input: { task: "...", previous_output: "...", feedback: "..." } }
Response: { output: "..." } or { output: { content: "..." } }
```

Features: Supports both string and object output formats, health check via `/input_schema`, retry with backoff.

### 6. CLI (`@mondaycom/sensei-cli`)

```
sensei run [options]
  --suite <path>           Path to suite YAML or JSON file (required)
  --target <url>           Agent endpoint URL or command (overrides suite agent config)
  --adapter <type>         Adapter type: http, stdio, openai, openai-compat, openclaw, langserve, langchain (default: http)
  --judge-model <model>    LLM judge model (default: gpt-4o)
  --timeout <ms>           Per-scenario timeout in ms (default: 60000)
  --verbose                Show detailed execution logs
  --format <format>        Output format: json, html, terminal (default: terminal)
  --output <path>          Write report to file

sensei validate <path>     Validate a suite YAML/JSON file against Zod schema
sensei init [name]         Generate a new suite template (interactive or --non-interactive)
sensei report              Render a report from a previous JSON result
  --input <path>           Path to JSON result file
```

### 7. SDK (`@mondaycom/sensei-sdk`)

Programmatic suite building and utilities.

```typescript
// Fluent builder
const suite = new SuiteBuilder()
  .id('my-eval').name('My Eval').version('1.0.0')
  .agent({ adapter: 'http', endpoint: 'http://localhost:3000' })
  .judge({ provider: 'openai', model: 'gpt-4o' })
  .addScenario(scenario('task-1', { layer: 'execution', input: { prompt: '...' }, kpis: [...] }))
  .build();  // Validates and returns SuiteDefinition

// Custom KPI functions
registerKPI({ id: 'my-kpi', name: 'My KPI', maxScore: 100, fn: (output) => scoreIt(output) });
const { score, maxScore } = await invokeKPI('my-kpi', agentOutput);

// Result utilities
const comparison = compareResults(beforeResult, afterResult);  // Delta analysis
const summary = formatSummary(result);  // One-line summary
const executionScenarios = filterByLayer(result, 'execution');
```

## Suite Definition Format

Suites are defined in YAML (declarative) or built programmatically via the SDK.

```yaml
id: sdr-qualification
version: "1.0.0"
name: "Sales Development Representative"
description: "Evaluate SDR capabilities"

agent:
  adapter: http
  endpoint: http://localhost:3000
  timeout_ms: 60000

judge:
  provider: openai
  model: gpt-4o
  temperature: 0.0

defaults:
  timeout_ms: 60000
  judge_model: gpt-4o

scenarios:
  - id: cold-email
    name: "Cold Email Outreach"
    layer: execution
    input:
      prompt: |
        Write a personalized cold email to this prospect.
      context:
        prospect: { name: "Sarah Chen", title: "VP Engineering", company: "TechCorp" }
      fixtures:
        transcript: transcripts/discovery-call.yaml
    kpis:
      - id: personalization
        name: "Personalization"
        weight: 0.3
        method: llm-judge
        config:
          rubric: |
            5: References 3+ specific prospect details naturally
            3: References 1 specific detail
            1: Fully generic
          max_score: 5
      - id: brevity
        name: "Email Length"
        weight: 0.2
        method: automated
        config:
          type: word-count
          expected: { min: 80, max: 200 }

  - id: explain-strategy
    name: "Explain Strategy"
    layer: reasoning
    depends_on: cold-email
    input:
      prompt: "Explain your approach to the cold email."
    kpis:
      - id: depth
        name: "Reasoning Depth"
        weight: 1.0
        method: llm-judge
        config:
          max_score: 5

  - id: improve-email
    name: "Improve After Feedback"
    layer: self-improvement
    depends_on: cold-email
    input:
      prompt: "Rewrite the email incorporating this feedback."
      feedback: "Too feature-focused. Lead with pain, soften the CTA."
    kpis:
      - id: improvement
        name: "Improvement Quality"
        weight: 1.0
        method: comparative-judge
        config:
          comparison_type: improvement
```

## AgentTalent Integration

AgentTalent uses Sensei as a library dependency:

```typescript
import { SuiteLoader, Runner, Judge, Comparator, createAdapter } from '@mondaycom/sensei-engine';
import type { KPIResult } from '@mondaycom/sensei-engine';

async function evaluateCandidate(agentUrl: string, suiteFile: string) {
  // Load the suite
  const loader = new SuiteLoader();
  const suite = await loader.loadFile(suiteFile);

  // Override agent endpoint
  suite.agent = { adapter: 'http', endpoint: agentUrl, timeout_ms: 60000 };

  // Create components
  const adapter = createAdapter(suite.agent);
  const judge = suite.judge ? new Judge(suite.judge) : undefined;
  const comparator = suite.judge ? new Comparator(suite.judge) : undefined;

  // Build runner with scoring callbacks
  const runner = new Runner(adapter, {
    retries: 2,
    judgeScorer: judge ? async (kpi, agentOutput, scenarioInput) => {
      const verdict = await judge.evaluate({ kpi, scenarioInput: { prompt: scenarioInput }, agentOutput });
      return {
        kpi_id: kpi.id, kpi_name: kpi.name,
        score: (verdict.score / verdict.max_score) * 100,
        raw_score: verdict.score, max_score: verdict.max_score,
        weight: kpi.weight, method: kpi.method, evidence: verdict.reasoning,
      } satisfies KPIResult;
    } : undefined,
    comparatorScorer: comparator ? async (kpi, task, feedback, orig, revised) => {
      const verdict = await comparator.compare({ kpi, task, feedback, originalOutput: orig, revisedOutput: revised });
      return {
        kpi_id: kpi.id, kpi_name: kpi.name,
        score: (verdict.score / verdict.max_score) * 100,
        raw_score: verdict.score, max_score: verdict.max_score,
        weight: kpi.weight, method: kpi.method, evidence: verdict.reasoning,
      } satisfies KPIResult;
    } : undefined,
  });

  const result = await runner.run(suite);

  // Store in AgentTalent DB
  await saveEvaluationResult(result);

  if (result.scores.overall < 60) {
    await rejectApplication(result);
  } else {
    await queueForReview(result);
  }

  return result;
}
```

## File Structure

```
sensei/
├── packages/
│   ├── engine/                  # @mondaycom/sensei-engine
│   │   ├── src/
│   │   │   ├── types.ts         # Core types + LAYER_WEIGHTS + BADGE_THRESHOLDS
│   │   │   ├── schema.ts        # Zod schemas (SuiteDefinitionSchema, etc.)
│   │   │   ├── loader.ts        # YAML parser + fixture resolver
│   │   │   ├── runner.ts        # Scenario execution orchestrator
│   │   │   ├── scorer.ts        # Automated KPI scoring + aggregation
│   │   │   ├── judge.ts         # LLM-as-judge (single + multi-judge)
│   │   │   ├── comparator.ts    # Before/after comparative judge
│   │   │   ├── reporter.ts      # JSON + terminal reporter
│   │   │   ├── llm-client.ts    # OpenAI-compatible client factory
│   │   │   └── adapters/
│   │   │       ├── types.ts          # Adapter registry + createAdapter()
│   │   │       ├── http.ts           # HTTP POST adapter
│   │   │       ├── stdio.ts          # Stdin/stdout JSON-line adapter
│   │   │       ├── openai-compat.ts  # OpenAI-compatible adapter (also: openai, openclaw)
│   │   │       └── langserve.ts      # LangServe adapter
│   │   ├── tests/               # 100+ engine tests
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── cli/                     # @mondaycom/sensei-cli
│   │   ├── src/
│   │   │   ├── index.ts         # Entry point (commander)
│   │   │   ├── loader.ts        # Suite loader (YAML + JSON with Zod validation)
│   │   │   ├── format.ts        # Terminal + HTML report wrappers
│   │   │   ├── html-report.ts   # Self-contained dark-theme HTML
│   │   │   ├── output.ts        # File output helper
│   │   │   └── commands/
│   │   │       ├── run.ts       # sensei run
│   │   │       ├── validate.ts  # sensei validate
│   │   │       ├── init.ts      # sensei init
│   │   │       └── report.ts    # sensei report
│   │   ├── tests/               # CLI + E2E tests
│   │   └── package.json
│   └── sdk/                     # @mondaycom/sensei-sdk
│       ├── src/
│       │   ├── index.ts         # Public API exports
│       │   ├── builder.ts       # SuiteBuilder + scenario() + kpi() helpers
│       │   ├── custom-kpi.ts    # Custom KPI registry + invokeKPI()
│       │   └── result-utils.ts  # filterByLayer, compareResults, formatSummary
│       ├── tests/               # SDK tests
│       └── package.json
├── suites/
│   └── sdr-qualification/
│       ├── suite.yaml           # SDR test suite definition
│       └── fixtures/
│           ├── prospects/       # Sample prospect data
│           ├── products/        # Sample product data
│           └── transcripts/     # Sample call transcripts
├── README.md
├── ARCHITECTURE.md
├── CONTRIBUTING.md
├── CHANGELOG.md
├── LICENSE
├── package.json                 # Workspace root
├── tsconfig.base.json
└── vitest.config.ts
```
