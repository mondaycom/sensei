# Sensei — Architecture & Technical Plan

## Overview

Sensei is a standalone, open-source agent qualification engine. It runs test suites against AI agents and produces scored, structured reports. WorkDraft.ai consumes Sensei as a dependency but Sensei has no dependency on WorkDraft.

## Design Principles

1. **Agent-agnostic** — Any agent, any framework, any model. Sensei talks to agents through adapters.
2. **Suite-driven** — Tests are defined declaratively in YAML/TypeScript. No code changes to add tests.
3. **Three-layer evaluation** — Every suite tests execution, reasoning, and self-improvement.
4. **Reproducible** — Same suite + same agent = same score (deterministic where possible, statistical where not).
5. **Composable** — Suites, scenarios, and KPIs are modular and reusable.
6. **LLM-as-judge** — Complex quality assessment uses a separate LLM judge (configurable).

## Tech Stack

- **Language:** TypeScript (Node.js)
- **Package manager:** npm (published as `@sensei/cli`, `@sensei/engine`, `@sensei/sdk`)
- **Test definition:** YAML (declarative) + TypeScript SDK (programmatic)
- **LLM Judge:** OpenAI/Anthropic/any OpenAI-compatible API
- **Output:** JSON reports, HTML reports, terminal output
- **CI/CD:** GitHub Actions integration

## Core Components

### 1. Engine (`@sensei/engine`)

The core library. No CLI, no HTTP — pure evaluation logic.

```
engine/
├── runner.ts          # Orchestrates test execution
├── scorer.ts          # Calculates scores from KPI results
├── judge.ts           # LLM-as-judge evaluation
├── comparator.ts      # Comparative evaluation (before/after)
├── reporter.ts        # Generates reports (JSON, HTML, terminal)
├── loader.ts          # Loads suite definitions (YAML/TS)
├── adapters/          # Agent communication adapters
│   ├── types.ts       # Adapter interface
│   ├── http.ts        # HTTP POST adapter
│   ├── openclaw.ts    # OpenClaw native adapter
│   ├── stdio.ts       # Stdin/stdout adapter
│   └── langchain.ts   # LangChain adapter
└── types.ts           # Core type definitions
```

#### Runner Flow

```
1. Load suite definition (YAML or TS)
2. Initialize adapter (connect to agent)
3. Health check agent
4. For each scenario (ordered by layer):
   a. Layer 1 (execution): Send task → collect output → score KPIs
   b. Layer 2 (reasoning): Send questions about previous output → score reasoning
   c. Layer 3 (self-improvement): Send feedback → re-run task → compare with original
5. Aggregate scores
6. Generate report
7. Return results
```

#### Scoring Model

```typescript
interface KPIResult {
  kpi_id: string;
  score: number;          // 0-100 normalized
  raw_score: number;      // Raw value (e.g., 4.5/5)
  max_score: number;      // Maximum possible
  weight: number;         // Weight in scenario score
  method: 'automated' | 'llm-judge' | 'comparative-judge';
  evidence: string;       // Explanation of score
  metadata?: Record<string, unknown>;
}

interface ScenarioResult {
  scenario_id: string;
  layer: 'execution' | 'reasoning' | 'self-improvement';
  score: number;          // Weighted average of KPIs (0-100)
  kpis: KPIResult[];
  duration_ms: number;
  agent_output: string;   // What the agent produced
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
  judge_model: string;    // Which LLM was used as judge
}
```

#### Score Aggregation

```
Scenario Score = Σ(kpi.score × kpi.weight) / Σ(kpi.weight)

Layer Score = average(scenarios in layer)

Overall Score = execution × 0.50 + reasoning × 0.30 + self_improvement × 0.20

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
  model: string;              // e.g., "gpt-4o", "claude-sonnet"
  provider: 'openai' | 'anthropic' | 'openai-compatible';
  api_key?: string;           // Falls back to env vars
  base_url?: string;          // For custom endpoints
  temperature: number;        // Default 0.0 for consistency
  max_retries: number;        // Default 3
}

interface JudgePrompt {
  system: string;             // Judge persona & instructions
  rubric: string;             // Scoring rubric (from KPI definition)
  task_description: string;   // What the agent was asked to do
  agent_output: string;       // What the agent produced
  input_context?: string;     // Original input/scenario context
}

interface JudgeVerdict {
  score: number;              // Numeric score per rubric
  max_score: number;
  reasoning: string;          // Judge's explanation
  confidence: number;         // 0-1, how confident the judge is
}
```

**Judge prompt template:**
```
You are an expert evaluator for AI agent qualification tests.

Your task: Score the agent's output on the following KPI.

## KPI: {kpi.name}
{kpi.description}

## Rubric
{kpi.rubric}

## Task Given to Agent
{scenario.task}

## Input Context
{scenario.input}

## Agent's Output
{agent_output}

## Instructions
1. Evaluate the output against the rubric
2. Provide a numeric score
3. Explain your reasoning in 2-3 sentences
4. Rate your confidence (0.0-1.0)

Respond in JSON:
{
  "score": <number>,
  "max_score": <number>,
  "reasoning": "<string>",
  "confidence": <number>
}
```

**Multi-judge option:** For high-stakes evaluations, run 3 judges and take the median score.

### 3. Adapters

```typescript
interface SenseiAdapter {
  /** Unique adapter identifier */
  id: string;

  /** Initialize connection to agent */
  connect(config: AdapterConfig): Promise<void>;

  /** Check if agent is reachable and ready */
  healthCheck(): Promise<{ ok: boolean; latency_ms: number }>;

  /** Send a task and get structured output */
  execute(input: ExecuteInput): Promise<ExecuteOutput>;

  /** Send a conversational message (for reasoning layer) */
  converse(message: string, context?: ConversationContext): Promise<string>;

  /** Disconnect/cleanup */
  disconnect(): Promise<void>;
}

interface ExecuteInput {
  task: string;                    // What to do
  context?: Record<string, any>;   // Additional context/data
  files?: FileAttachment[];        // Files to provide
  timeout_ms?: number;             // Max execution time
}

interface ExecuteOutput {
  response: string;                // Agent's primary output
  structured?: Record<string, any>; // Structured data if available
  duration_ms: number;             // How long the agent took
  tokens_used?: number;            // Token consumption if available
  metadata?: Record<string, any>;  // Any additional metadata
}
```

#### HTTP Adapter

The simplest adapter. POST to an endpoint, get JSON back.

```typescript
// Agent endpoint contract:
// POST /execute
// Body: { task: string, context?: object }
// Response: { response: string, structured?: object }

// POST /converse
// Body: { message: string, context?: { history: Message[] } }
// Response: { response: string }
```

#### OpenClaw Adapter

Native integration with OpenClaw agents. Uses the OpenClaw CLI or API.

```typescript
// Uses: openclaw agent --message "..." --session-id "sensei-{suite}-{run}" --json
// Or: OpenClaw API endpoint
```

#### Stdio Adapter

For CLI-based agents. Send task via stdin, read response from stdout.

```typescript
// spawn agent process
// write JSON to stdin: { task: "...", context: {...} }
// read JSON from stdout: { response: "...", structured: {...} }
```

### 4. Suite Definition Format

Suites can be defined in YAML (declarative) or TypeScript (programmatic).

#### YAML Format

```yaml
id: sdr
version: 1.0.0
name: "Sales Development Representative"
description: "Evaluate SDR capabilities"
author: "Sensei Community"
tags: ["sales", "outbound", "email", "calling"]

# Default timeouts
defaults:
  timeout_ms: 60000
  judge_model: "gpt-4o"

# Fixtures directory (relative to suite root)
fixtures: ./fixtures

scenarios:
  - id: cold-email
    name: "Cold Email Outreach"
    layer: execution
    timeout_ms: 30000
    input:
      # Can be inline or reference a fixture file
      prospect: !file fixtures/prospects/sarah-chen.yaml
      product: !file fixtures/products/agentops.yaml
    task: |
      Write a personalized cold email to this prospect.
      Include a compelling subject line.
    expected_format: |
      Subject: <subject line>

      <email body>
    kpis:
      - id: personalization
        name: "Personalization"
        scoring: llm-judge
        rubric: |
          5: References 3+ specific prospect details naturally
          4: References 2 specific details
          3: References 1 specific detail
          2: Generic with name
          1: Fully generic
        weight: 0.3
      # ... more KPIs
```

#### TypeScript SDK Format

```typescript
import { defineSuite, scenario, kpi, fixtures } from '@sensei/sdk';

const prospects = fixtures.load<Prospect[]>('./fixtures/prospects.json');

export default defineSuite({
  id: 'sdr',
  version: '1.0.0',
  name: 'Sales Development Representative',

  scenarios: [
    scenario('cold-email', {
      layer: 'execution',
      input: { prospect: prospects[0], product: agentOps },
      task: 'Write a personalized cold email...',
      kpis: [
        kpi('personalization', {
          scoring: 'llm-judge',
          rubric: '5: References 3+ details...',
          weight: 0.3,
        }),
      ],
    }),
  ],
});
```

### 5. CLI (`@sensei/cli`)

```
sensei test [options]
  --suite <name>           Suite to run (e.g., sdr, support, qa)
  --scenario <id>          Run specific scenario only
  --agent <url|path>       Agent endpoint or command
  --adapter <type>         Adapter type (http, openclaw, stdio, langchain)
  --judge-model <model>    LLM judge model (default: gpt-4o)
  --judge-provider <name>  Judge provider (openai, anthropic)
  --timeout <ms>           Global timeout per scenario
  --output <format>        Output format (json, html, terminal)
  --output-file <path>     Write report to file
  --multi-judge            Use 3 judges and take median
  --verbose                Show detailed execution logs
  --dry-run                Parse suite without running

sensei list                List available suites
sensei info <suite>        Show suite details & scenarios
sensei validate <path>     Validate a custom suite definition
sensei init <name>         Scaffold a new custom suite
sensei serve               Start HTTP API server for remote execution
```

### 6. API Server (optional)

For integration with WorkDraft or other platforms.

```
POST /api/v1/evaluate
  Body: {
    suite: "sdr",
    agent: { type: "http", url: "https://..." },
    options: { judge_model: "gpt-4o", multi_judge: true }
  }
  Response: SuiteResult (streamed or polled)

GET  /api/v1/suites             List suites
GET  /api/v1/suites/:id         Suite details
GET  /api/v1/results/:id        Get evaluation result
GET  /api/v1/results/:id/report Report (HTML/PDF)
```

## Test Suites — Initial Set

### Suite 1: SDR (Sales Development Representative)
**Scenarios:**
| ID | Layer | Description |
|----|-------|-------------|
| cold-email-personalization | execution | Write personalized cold email |
| email-sequence | execution | Design 3-touch email sequence |
| call-transcript-analysis | execution | Analyze SDR call recording |
| linkedin-outreach | execution | Write LinkedIn connection request + message |
| lead-qualification | execution | Qualify a lead using BANT/MEDDIC |
| explain-strategy | reasoning | Explain outreach strategy choices |
| handle-objection-reasoning | reasoning | Explain how to handle "we already have a solution" |
| improve-after-feedback | self-improvement | Rewrite email after feedback |
| adjust-qualification | self-improvement | Re-qualify lead after criteria change |

### Suite 2: Customer Support
**Scenarios:**
| ID | Layer | Description |
|----|-------|-------------|
| ticket-resolution | execution | Resolve a customer support ticket |
| escalation-decision | execution | Decide whether to escalate or resolve |
| multi-turn-support | execution | Handle a 5-turn support conversation |
| tone-adaptation | execution | Adapt tone for angry vs. confused customer |
| knowledge-base-answer | execution | Answer from provided KB articles |
| explain-resolution | reasoning | Explain why this resolution was chosen |
| empathy-reasoning | reasoning | Explain approach to emotional customer |
| improve-after-csat | self-improvement | Improve response after low CSAT feedback |

### Suite 3: Content Writer
**Scenarios:**
| ID | Layer | Description |
|----|-------|-------------|
| blog-post | execution | Write 800-word blog post from brief |
| social-media-set | execution | Create week of social posts |
| email-newsletter | execution | Write monthly newsletter |
| seo-optimization | execution | Optimize existing content for SEO |
| brand-voice-match | execution | Match a specific brand voice from examples |
| content-strategy | reasoning | Explain content calendar decisions |
| audience-reasoning | reasoning | Explain audience targeting choices |
| improve-after-edit | self-improvement | Revise content after editorial feedback |

### Suite 4: QA Engineer
**Scenarios:**
| ID | Layer | Description |
|----|-------|-------------|
| test-plan-creation | execution | Create test plan for a feature spec |
| bug-report-writing | execution | Write bug report from reproduction steps |
| api-test-generation | execution | Generate API test cases from spec |
| regression-analysis | execution | Analyze test results and identify regressions |
| edge-case-discovery | execution | Find edge cases in a feature description |
| test-strategy | reasoning | Explain testing strategy and priorities |
| risk-assessment | reasoning | Explain where to focus testing effort |
| improve-coverage | self-improvement | Expand test plan after coverage feedback |

### Suite 5: Data Analyst
**Scenarios:**
| ID | Layer | Description |
|----|-------|-------------|
| data-exploration | execution | Explore dataset and summarize findings |
| sql-query-writing | execution | Write SQL queries for business questions |
| anomaly-detection | execution | Find anomalies in time-series data |
| dashboard-design | execution | Design KPI dashboard layout |
| insight-generation | execution | Generate actionable insights from data |
| methodology-explanation | reasoning | Explain analytical approach |
| correlation-reasoning | reasoning | Explain correlation vs causation in findings |
| improve-analysis | self-improvement | Refine analysis after stakeholder feedback |

### Suite 6: Developer
**Scenarios:**
| ID | Layer | Description |
|----|-------|-------------|
| code-generation | execution | Implement function from specification |
| code-review | execution | Review PR and provide feedback |
| bug-fix | execution | Debug and fix a failing test |
| api-design | execution | Design REST API from requirements |
| refactoring | execution | Refactor legacy code to modern patterns |
| architecture-reasoning | reasoning | Explain architectural decisions |
| tradeoff-analysis | reasoning | Explain performance vs. readability tradeoffs |
| improve-after-review | self-improvement | Update code after code review comments |

## WorkDraft Integration

WorkDraft uses Sensei as a library dependency:

```typescript
import { SenseiEngine, HttpAdapter } from '@sensei/engine';

// When agent applies to a job
async function evaluateCandidate(agentUrl: string, jobRoleType: string) {
  const engine = new SenseiEngine({
    judge: { model: 'gpt-4o', provider: 'openai' },
  });

  const adapter = new HttpAdapter({ url: agentUrl });
  const result = await engine.run({
    suite: jobRoleType, // e.g., 'sdr'
    adapter,
    options: { multiJudge: true },
  });

  // Store result in WorkDraft DB
  await saveEvaluationResult(result);

  return result;
}
```

## Development Plan

### Phase 1: Foundation (Week 1)
- [ ] Project setup (TypeScript, npm workspaces, ESLint, tests)
- [ ] Core types and interfaces
- [ ] Suite loader (YAML parser)
- [ ] HTTP adapter
- [ ] LLM judge (OpenAI)
- [ ] Scorer (automated + judge-based)
- [ ] Basic CLI (`sensei test`, `sensei list`)
- [ ] JSON reporter
- [ ] SDR suite (3 scenarios: cold-email, call-analysis, explain-strategy)

### Phase 2: Expand (Week 2)
- [ ] Remaining SDR scenarios
- [ ] Customer Support suite
- [ ] Content Writer suite
- [ ] OpenClaw adapter
- [ ] Stdio adapter
- [ ] HTML reporter
- [ ] Terminal reporter (pretty output)
- [ ] Multi-judge support
- [ ] Comparative judge (before/after)
- [ ] `sensei init` scaffolding

### Phase 3: Polish (Week 3)
- [ ] QA Engineer suite
- [ ] Data Analyst suite
- [ ] Developer suite
- [ ] API server
- [ ] GitHub Actions integration
- [ ] Badge system
- [ ] Documentation site
- [ ] npm publish

### Phase 4: Community (Ongoing)
- [ ] Community suite contributions
- [ ] Suite marketplace
- [ ] WorkDraft deep integration
- [ ] Leaderboard
- [ ] Certificate system

## File Structure

```
sensei/
├── packages/
│   ├── engine/                # @sensei/engine
│   │   ├── src/
│   │   │   ├── runner.ts
│   │   │   ├── scorer.ts
│   │   │   ├── judge.ts
│   │   │   ├── comparator.ts
│   │   │   ├── reporter/
│   │   │   │   ├── json.ts
│   │   │   │   ├── html.ts
│   │   │   │   └── terminal.ts
│   │   │   ├── loader.ts
│   │   │   ├── adapters/
│   │   │   │   ├── http.ts
│   │   │   │   ├── openclaw.ts
│   │   │   │   ├── stdio.ts
│   │   │   │   └── langchain.ts
│   │   │   └── types.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── cli/                   # @sensei/cli
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   └── commands/
│   │   │       ├── test.ts
│   │   │       ├── list.ts
│   │   │       ├── info.ts
│   │   │       ├── init.ts
│   │   │       └── serve.ts
│   │   └── package.json
│   └── sdk/                   # @sensei/sdk
│       ├── src/
│       │   ├── index.ts
│       │   ├── define.ts
│       │   └── fixtures.ts
│       └── package.json
├── suites/
│   ├── sdr/
│   │   ├── suite.yaml
│   │   └── fixtures/
│   │       ├── prospects/
│   │       ├── products/
│   │       └── transcripts/
│   ├── support/
│   │   ├── suite.yaml
│   │   └── fixtures/
│   ├── content-writer/
│   │   ├── suite.yaml
│   │   └── fixtures/
│   ├── qa-engineer/
│   │   ├── suite.yaml
│   │   └── fixtures/
│   ├── data-analyst/
│   │   ├── suite.yaml
│   │   └── fixtures/
│   └── developer/
│       ├── suite.yaml
│       └── fixtures/
├── README.md
├── ARCHITECTURE.md
├── CONTRIBUTING.md
├── LICENSE
├── package.json               # Workspace root
└── tsconfig.json
```
