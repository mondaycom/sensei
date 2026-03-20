# Sensei

![CI](https://github.com/mondaycom/sensei/actions/workflows/ci.yml/badge.svg)
[![npm](https://img.shields.io/npm/v/@mondaycom/sensei-engine)](https://www.npmjs.com/package/@mondaycom/sensei-engine)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**Open-source AI agent qualification engine.**

Test, evaluate, and certify AI agents across professional skills with standardized benchmarks, real-world scenarios, and measurable KPIs.

> *"Before you hire an agent, ask the Sensei."*

<p align="center">
  <img src="docs/images/sensei-hero.jpg" alt="Sensei — The open-source qualification engine for AI agents" width="800" />
</p>

## What is Sensei?

Sensei is an open-source framework for evaluating AI agents on real-world professional tasks. It provides:

- **Standardized test suites** for common agent roles (SDR, Support, QA, Content, Data Analysis, etc.)
- **Three-layer evaluation** — Task execution, Reasoning, Self-improvement
- **Professional-grade KPIs** — not toy benchmarks, but metrics that matter in production
- **Pluggable architecture** — bring your own agent, any framework, any model
- **Machine-readable results** — JSON reports, scores, badges, CI/CD integration

## Quick Start

```bash
# Install
npm install @mondaycom/sensei-engine

# Or use the CLI
npm install -g @mondaycom/sensei-cli
```

### Programmatic Usage

```typescript
import { SuiteLoader, Runner, Judge, Comparator, createAdapter } from '@mondaycom/sensei-engine';

// Load a test suite
const loader = new SuiteLoader();
const suite = await loader.loadFile('./suites/sdr-qualification/suite.yaml');

// Create adapter from suite config (or override)
const adapter = createAdapter(suite.agent!);

// Create LLM judge for quality evaluation
const judge = new Judge(suite.judge!);
const comparator = new Comparator(suite.judge!);

// Run against your agent
const runner = new Runner(adapter, {
  retries: 2,
  judgeScorer: async (kpi, agentOutput, scenarioInput) => {
    const verdict = await judge.evaluate({ kpi, scenarioInput: { prompt: scenarioInput }, agentOutput });
    return {
      kpi_id: kpi.id, kpi_name: kpi.name,
      score: (verdict.score / verdict.max_score) * 100,
      raw_score: verdict.score, max_score: verdict.max_score,
      weight: kpi.weight, method: kpi.method, evidence: verdict.reasoning,
    };
  },
});

const result = await runner.run(suite);

// Output results
import { Reporter } from '@mondaycom/sensei-engine';
const reporter = new Reporter();
console.log(reporter.toTerminal(result));   // Pretty terminal output
console.log(reporter.toJSON(result));       // Machine-readable JSON
```

### SDK Usage (Programmatic Suite Building)

```typescript
import { SuiteBuilder, scenario, kpi } from '@mondaycom/sensei-sdk';

const suite = new SuiteBuilder()
  .id('my-eval')
  .name('My Agent Evaluation')
  .version('1.0.0')
  .agent({ adapter: 'http', endpoint: 'http://localhost:3000' })
  .judge({ provider: 'openai', model: 'gpt-4o' })
  .addScenario(scenario('write-email', {
    layer: 'execution',
    input: { prompt: 'Write a professional cold email to Sarah Chen, VP Eng at TechCorp.' },
    kpis: [
      kpi('personalization', { weight: 0.6, method: 'llm-judge', config: { rubric: '5: Excellent personalization\n1: Generic', max_score: 5 } }),
      kpi('length', { weight: 0.4, method: 'automated', config: { type: 'word-count', expected: { min: 80, max: 200 } } }),
    ],
  }))
  .build();
```

### CLI Usage

```bash
# Run a full suite against your agent
sensei run --suite ./suites/sdr-qualification/suite.yaml --target http://localhost:3000

# Run with a specific judge model
sensei run --suite ./my-suite.yaml --target http://localhost:3000 --judge-model gpt-4o

# Validate a custom suite definition
sensei validate ./my-suite.yaml

# Generate a new suite template
sensei init my-suite

# Render a report from a previous JSON result
sensei report --input ./result.json
```

## Suite Marketplace

The [Sensei Suite Marketplace](https://sensei.sh/marketplace) is a community hub for discovering, sharing, and installing evaluation suites.

### Search for suites

```bash
# Search by keyword
sensei search "sdr"

# Filter by category and sort by rating
sensei search "sales" --category sales --sort rating --limit 5
```

### Install a suite

```bash
# Install to local ./suites/ directory
sensei install sdr-qualification

# Install globally to ~/.sensei/suites/
sensei install sdr-qualification --global

# Install to a custom path
sensei install sdr-qualification --output ./my-suites/sdr.yaml
```

After installing, run the suite against your agent:

```bash
sensei run --suite ./suites/sdr-qualification/suite.yaml --target http://localhost:3000
```

### Publish a suite

```bash
# Publish suite.yaml from current directory
sensei publish --api-key <your-key>

# Publish a specific file with metadata overrides
sensei publish --file ./my-suite.yaml --name "My Suite" --category sales --tags "sdr,cold-email"
```

You can also set the `SENSEI_API_KEY` environment variable instead of passing `--api-key` each time.

## Three-Layer Evaluation

<p align="center">
  <img src="docs/images/sensei-see-it-in-action.jpg" alt="Sensei — See It In Action" width="800" />
</p>

### Layer 1: Task Execution (50%)
*"Can the agent do the job?"*

Feed the agent realistic scenarios with clear success criteria. Measure output quality, accuracy, completeness, and speed.

### Layer 2: Conversational Reasoning (30%)
*"Can the agent explain its decisions?"*

After task completion, the agent is questioned about its approach. Why did it choose this strategy? What tradeoffs did it consider?

### Layer 3: Self-Improvement (20%)
*"Can the agent learn from feedback?"*

Give the agent specific feedback. Re-run the test. Compare before/after using a comparative judge. Agents that improve score higher.

## Scoring

```
Scenario Score = weighted average of KPI scores
Layer Score    = average of scenario scores in that layer
Overall Score  = execution × 0.50 + reasoning × 0.30 + self_improvement × 0.20
```

Note: If a suite only defines some layers (e.g., only execution), missing layers are excluded and the remaining weights are re-normalized. A suite with only execution scenarios can still achieve 100%.

### Badge Levels

| Badge | Score | Meaning |
|-------|-------|---------|
| 🥇 Gold | 90+ | Exceptional, top-tier agent |
| 🥈 Silver | 75-89 | Solid professional performance |
| 🥉 Bronze | 60-74 | Meets minimum qualification |

### KPI Scoring Methods

- **Automated** — deterministic checks:
  - `contains` — output includes expected string
  - `regex` — output matches regex pattern
  - `json-schema` — output validates against JSON Schema (via Ajv)
  - `json-parse` — output is valid JSON
  - `numeric-range` — output parses to number within range
  - `word-count` — output word count within range
  - `function` — custom scoring function via SDK `registerKPI()`
- **LLM Judge** — an LLM evaluates output quality against a rubric
- **Comparative Judge** — compares before/after outputs for self-improvement scoring

## Suite Definition (YAML)

```yaml
id: my-suite
name: My Test Suite
version: "1.0.0"

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
  - id: basic-task
    name: Basic Task
    layer: execution
    input:
      prompt: "Write a professional email"
    kpis:
      - id: quality
        name: Output Quality
        weight: 0.5
        method: llm-judge
        config:
          rubric: |
            5: Excellent — clear, professional, compelling
            3: Adequate — gets the point across
            1: Poor — unclear or unprofessional
          max_score: 5
      - id: has-subject
        name: Has Subject Line
        weight: 0.3
        method: automated
        config:
          type: regex
          expected: "^Subject:"
      - id: length
        name: Email Length
        weight: 0.2
        method: automated
        config:
          type: word-count
          expected: { min: 50, max: 300 }

  - id: explain-approach
    name: Explain Approach
    layer: reasoning
    depends_on: basic-task
    input:
      prompt: "Explain your approach to the previous task."
    kpis:
      - id: clarity
        name: Reasoning Clarity
        weight: 1.0
        method: llm-judge
        config:
          rubric: |
            5: Clear, structured, insightful reasoning
            3: Adequate explanation
            1: Vague or missing reasoning
          max_score: 5

  - id: improve-after-feedback
    name: Improve After Feedback
    layer: self-improvement
    depends_on: basic-task
    input:
      prompt: "Redo the original task incorporating this feedback."
      feedback: "Be more specific and provide concrete examples."
    kpis:
      - id: improvement
        name: Improvement Over Original
        weight: 1.0
        method: comparative-judge
        config:
          comparison_type: improvement
```

## Packages

| Package | Description |
|---------|-------------|
| `@mondaycom/sensei-engine` | Core evaluation engine — loader, runner, scorer, judge, comparator, reporter, adapters |
| `@mondaycom/sensei-cli` | Command-line interface — `run`, `validate`, `init`, `report`, `install`, `search`, `publish` |
| `@mondaycom/sensei-sdk` | SDK for building custom suites programmatically + custom KPI functions |

## Architecture

```
packages/
├── engine/src/
│   ├── types.ts          # Core type definitions + constants
│   ├── schema.ts         # Zod validation schemas
│   ├── loader.ts         # YAML suite parser + fixture resolution
│   ├── runner.ts         # Scenario execution orchestrator
│   ├── scorer.ts         # KPI scoring + layer aggregation
│   ├── judge.ts          # LLM-as-judge (single + multi-judge)
│   ├── comparator.ts     # Before/after comparative evaluation
│   ├── reporter.ts       # JSON + ANSI terminal output
│   ├── llm-client.ts     # Shared OpenAI-compatible client factory
│   ├── registry-client.ts # Marketplace registry API client
│   └── adapters/
│       ├── types.ts      # Adapter registry + factory
│       ├── http.ts       # HTTP POST adapter
│       ├── stdio.ts      # Stdin/stdout JSON-line adapter
│       ├── openai-compat.ts  # OpenAI-compatible adapter (openai, openclaw aliases)
│       └── langserve.ts      # LangServe adapter
├── cli/src/
│   ├── index.ts          # CLI entry point (commander)
│   ├── loader.ts         # Suite file loader (YAML + JSON with Zod)
│   ├── format.ts         # Terminal + HTML report formatting
│   ├── html-report.ts    # Self-contained dark-theme HTML reports
│   ├── output.ts         # File output utility
│   └── commands/
│       ├── run.ts        # sensei run — execute suite against agent
│       ├── validate.ts   # sensei validate — check suite YAML
│       ├── init.ts       # sensei init — scaffold new suite
│       ├── report.ts     # sensei report — render from JSON result
│       ├── install.ts    # sensei install — download suite from marketplace
│       ├── search.ts     # sensei search — search marketplace suites
│       └── publish.ts    # sensei publish — publish suite to marketplace
└── sdk/src/
    ├── index.ts          # Public API exports
    ├── builder.ts        # SuiteBuilder fluent API + helpers
    ├── custom-kpi.ts     # Custom KPI function registry
    └── result-utils.ts   # Filter, compare, summarize results
```

## Built-In Test Suites

<p align="center">
  <img src="docs/images/sensei-test-suites.jpg" alt="Sensei — Built-In Test Suites" width="800" />
</p>

## Adapters

Sensei communicates with agents through adapters:

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
```

Built-in adapters:
- **HTTP** — POST JSON to an endpoint, get JSON response
- **Stdio** — Spawn a child process, communicate via stdin/stdout JSON lines
- **OpenAI-Compatible** (`openai-compat` / `openai` / `openclaw`) — Universal adapter for any OpenAI-compatible `/v1/chat/completions` endpoint (OpenAI, Azure, vLLM, Ollama, OpenClaw, etc.)
- **LangServe** — Integration with LangChain LangServe deployments via `/invoke` protocol

## Roadmap

- [x] Architecture & specification
- [x] Core engine (runner, scorer, loader, reporter)
- [x] Zod schema validation
- [x] LLM Judge integration (single + multi-judge)
- [x] Comparative Judge (before/after self-improvement)
- [x] HTTP, Stdio, OpenAI-Compatible, LangServe adapters
- [x] CLI commands (`run`, `validate`, `init`, `report`)
- [x] SDR test suite with fixtures
- [x] HTML reporter (dark theme)
- [x] Terminal reporter (ANSI colors)
- [x] SDK with fluent SuiteBuilder API
- [x] Custom KPI function registry
- [x] 173 unit + integration tests
- [x] CI/CD workflows
- [ ] Additional test suites (Support, Content, QA, Data, Developer)
- [ ] Web dashboard
- [x] Community suite marketplace (`install`, `search`, `publish` CLI commands)
- [ ] npm publish to registry

## Contributing

We welcome contributions! Whether it's new test suites, scoring improvements, or framework adapters — Sensei gets better when the community builds together.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — use it, fork it, improve it.

---

*Built by [AgentTalent.ai](https://agentalent.ai) — The managed marketplace for AI agent labor.*
