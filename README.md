# 🥋 Sensei

**Open-source AI agent qualification engine.**

Test, evaluate, and certify AI agents across professional skills with standardized benchmarks, real-world scenarios, and measurable KPIs.

> *"Before you hire an agent, ask the Sensei."*

## What is Sensei?

Sensei is an open-source framework for evaluating AI agents on real-world professional tasks. It provides:

- **Standardized test suites** for common agent roles (SDR, Support, QA, Content, Data Analysis, etc.)
- **Three-layer evaluation** — Task execution → Reasoning → Self-improvement
- **Professional-grade KPIs** — not toy benchmarks, but metrics that matter in production
- **Pluggable architecture** — bring your own agent, any framework, any model
- **Machine-readable results** — JSON reports, scores, badges, CI/CD integration

## Why?

The AI agent ecosystem has no hiring standard. Companies can't tell which agents are good. Agent builders can't prove their agents work. There's no equivalent of a "skills test" or "certification" for autonomous agents.

Sensei changes that. It's the professional qualification layer for AI agents.

## Architecture

```
sensei/
├── suites/                    # Test suites by role
│   ├── sdr/                   # Sales Development Rep tests
│   ├── support/               # Customer Support tests
│   ├── content-writer/        # Content Creation tests
│   ├── qa-engineer/           # QA/Testing tests
│   ├── data-analyst/          # Data Analysis tests
│   └── developer/             # Software Development tests
├── engine/                    # Core evaluation engine
│   ├── runner.ts              # Test runner & orchestrator
│   ├── scorer.ts              # Scoring & KPI calculation
│   ├── judge.ts               # LLM-as-judge evaluator
│   └── reporter.ts            # Report generation
├── adapters/                  # Agent framework adapters
│   ├── openclaw.ts            # OpenClaw adapter
│   ├── langchain.ts           # LangChain adapter
│   ├── http.ts                # Generic HTTP/API adapter
│   └── stdio.ts               # Stdin/stdout adapter
├── sdk/                       # SDK for creating custom suites
├── cli/                       # CLI tool
└── api/                       # HTTP API server (optional)
```

## Three-Layer Evaluation

### Layer 1: Task Execution 🎯
*"Can the agent do the job?"*

Feed the agent realistic scenarios with clear success criteria. Measure output quality, accuracy, completeness, and speed.

### Layer 2: Conversational Reasoning 🧠
*"Can the agent explain its decisions?"*

After task completion, the agent is questioned about its approach. Why did it choose this strategy? What tradeoffs did it consider? Agents that can't explain themselves fail.

### Layer 3: Self-Improvement 📈
*"Can the agent learn from feedback?"*

Give the agent specific feedback ("your threshold is too aggressive, adjust it"). Re-run the test. Compare before/after. Agents that improve score higher.

## Example: SDR Test Suite

```yaml
suite: sdr
version: 1.0.0
name: "Sales Development Representative"
description: "Evaluate an agent's ability to perform outbound sales development"

scenarios:
  - id: cold-email-personalization
    name: "Cold Email Personalization"
    layer: execution
    input:
      prospect:
        name: "Sarah Chen"
        title: "VP of Engineering"
        company: "TechCorp"
        industry: "SaaS"
        recent_news: "Just raised Series B, $40M"
        linkedin_summary: "10 years in DevOps, passionate about developer experience"
      product:
        name: "AgentOps"
        value_prop: "Monitor and optimize AI agent performance"
    task: "Write a personalized cold email to this prospect"
    kpis:
      - id: personalization_score
        name: "Personalization"
        description: "Does the email reference specific prospect details?"
        scoring: llm-judge
        rubric: |
          5 - References 3+ specific details (company, role, news, interests)
          4 - References 2 specific details with natural integration
          3 - References 1 specific detail
          2 - Generic template with name inserted
          1 - Completely generic
        weight: 0.3
      - id: value_alignment
        name: "Value Alignment"
        description: "Does the email connect product value to prospect's needs?"
        scoring: llm-judge
        weight: 0.25
      - id: call_to_action
        name: "Call to Action"
        description: "Is there a clear, low-friction CTA?"
        scoring: llm-judge
        weight: 0.15
      - id: length
        name: "Email Length"
        description: "Is the email appropriately concise?"
        scoring: automated
        target: { min: 80, max: 200, unit: "words" }
        weight: 0.1
      - id: subject_line
        name: "Subject Line Quality"
        description: "Is the subject line compelling and relevant?"
        scoring: llm-judge
        weight: 0.2

  - id: call-transcript-analysis
    name: "SDR Call Analysis"
    layer: execution
    input:
      transcript: "fixtures/sdr-call-transcript-01.txt"
    task: "Analyze this SDR call transcript and provide a detailed assessment"
    kpis:
      - id: talk_ratio_detection
        name: "Talk Ratio Analysis"
        description: "Did the agent correctly identify talk-to-listen ratio?"
        scoring: automated
        expected: { agent_talk: 40, prospect_talk: 60, tolerance: 5 }
        weight: 0.15
      - id: latency_analysis
        name: "Response Latency"
        description: "Did the agent measure avg latency between human end and agent start?"
        scoring: automated
        weight: 0.15
      - id: objection_handling
        name: "Objection Handling Score"
        description: "Were prospect objections identified and assessed?"
        scoring: llm-judge
        weight: 0.2
      - id: next_steps
        name: "Follow-up Scheduled"
        description: "Was a follow-up/meeting properly proposed?"
        scoring: llm-judge
        weight: 0.15
      - id: qualification_accuracy
        name: "Lead Qualification"
        description: "Was the lead correctly qualified using BANT/MEDDIC?"
        scoring: llm-judge
        weight: 0.2
      - id: overall_call_score
        name: "Overall Call Score"
        description: "Holistic quality assessment"
        scoring: llm-judge
        weight: 0.15

  - id: explain-strategy
    name: "Explain Your Outreach Strategy"
    layer: reasoning
    context: "After completing cold-email-personalization"
    questions:
      - "Why did you choose this angle for the email?"
      - "What other approaches did you consider?"
      - "If the prospect doesn't respond, what's your follow-up strategy?"
    kpis:
      - id: reasoning_depth
        name: "Reasoning Depth"
        scoring: llm-judge
        weight: 0.5
      - id: strategic_thinking
        name: "Strategic Thinking"
        scoring: llm-judge
        weight: 0.5

  - id: improve-after-feedback
    name: "Improve Based on Feedback"
    layer: self-improvement
    context: "After completing cold-email-personalization"
    feedback: |
      The email was too focused on features. Rewrite it focusing on the
      business outcome — how does AgentOps save VP of Engineering time
      and reduce agent failures? Also, the CTA was too aggressive for
      a cold outreach. Make it softer — suggest sharing a case study
      instead of booking a demo.
    task: "Rewrite the email incorporating this feedback"
    kpis:
      - id: feedback_incorporation
        name: "Feedback Incorporation"
        description: "Did the agent address each piece of feedback?"
        scoring: llm-judge
        weight: 0.5
      - id: improvement_delta
        name: "Improvement Delta"
        description: "Is the rewritten email measurably better?"
        scoring: comparative-judge
        compare_with: "cold-email-personalization"
        weight: 0.5
```

## CLI Usage

```bash
# Install
npm install -g @sensei/cli

# Run a full suite against your agent
sensei test --suite sdr --agent http://localhost:3000/agent

# Run a specific scenario
sensei test --suite sdr --scenario cold-email-personalization --agent ./my-agent.sh

# Run with OpenClaw agent
sensei test --suite sdr --agent openclaw://my-agent

# Generate report
sensei test --suite sdr --agent http://localhost:3000/agent --report html

# List available suites
sensei list

# Get suite details
sensei info sdr
```

## Scoring

Each scenario produces a score from 0-100. Scores are aggregated per layer and overall:

```json
{
  "suite": "sdr",
  "agent": "my-sales-agent",
  "timestamp": "2026-03-15T20:00:00Z",
  "scores": {
    "overall": 87.3,
    "execution": 91.2,
    "reasoning": 82.5,
    "self_improvement": 85.0
  },
  "scenarios": [
    {
      "id": "cold-email-personalization",
      "layer": "execution",
      "score": 91.2,
      "kpis": {
        "personalization_score": { "score": 4.5, "max": 5, "pct": 90 },
        "value_alignment": { "score": 4.8, "max": 5, "pct": 96 },
        "call_to_action": { "score": 4.0, "max": 5, "pct": 80 },
        "length": { "score": 95, "max": 100, "in_range": true, "actual": 142 },
        "subject_line": { "score": 4.6, "max": 5, "pct": 92 }
      }
    }
  ],
  "badge": "sensei-sdr-gold",
  "certificate_url": "https://sensei.dev/cert/abc123"
}
```

### Badge Levels
- 🥉 **Bronze** — Score 60-74: Meets minimum qualification
- 🥈 **Silver** — Score 75-89: Solid professional performance
- 🥇 **Gold** — Score 90-100: Exceptional, top-tier agent

## Adapters

Sensei doesn't care what framework your agent uses. It communicates through adapters:

```typescript
interface SenseiAdapter {
  // Send a task to the agent, get a response
  execute(task: TaskInput): Promise<TaskOutput>;

  // Send a conversational message (for Layer 2)
  converse(message: string): Promise<string>;

  // Check if agent is ready
  healthCheck(): Promise<boolean>;
}
```

### Built-in Adapters
- **HTTP** — POST tasks to any HTTP endpoint
- **OpenClaw** — Native OpenClaw agent integration
- **Stdio** — Communicate via stdin/stdout (for CLI agents)
- **LangChain** — LangChain/LangServe integration

## Creating Custom Suites

```typescript
import { defineSuite, scenario, kpi } from '@sensei/sdk';

export default defineSuite({
  id: 'price-monitor',
  name: 'Price Monitoring Agent',
  version: '1.0.0',
  scenarios: [
    scenario({
      id: 'detect-anomaly',
      layer: 'execution',
      input: { prices: 'fixtures/price-data.csv' },
      task: 'Analyze the price data and flag anomalies',
      kpis: [
        kpi({
          id: 'anomaly_detection',
          name: 'Anomaly Detection Rate',
          scoring: 'automated',
          expected: { anomalies: [3, 7, 15], tolerance: 0 },
          weight: 0.5,
        }),
        kpi({
          id: 'false_positive_rate',
          name: 'False Positive Rate',
          scoring: 'automated',
          target: { max: 5, unit: 'percent' },
          weight: 0.3,
        }),
        kpi({
          id: 'explanation_quality',
          name: 'Explanation Quality',
          scoring: 'llm-judge',
          weight: 0.2,
        }),
      ],
    }),
  ],
});
```

## Integration with WorkDraft

Sensei is the open-source qualification engine that powers [WorkDraft.ai](https://workdraft.ai)'s agent hiring process. When a company posts a job on WorkDraft, Sensei runs the relevant test suites to evaluate candidate agents.

```
WorkDraft Job Post → Sensei Test Suite → Score & Report → Hiring Decision
```

## Roadmap

- [x] Architecture & specification
- [ ] Core engine (runner, scorer, judge, reporter)
- [ ] CLI tool
- [ ] SDR test suite
- [ ] Customer Support test suite
- [ ] Content Writer test suite
- [ ] QA Engineer test suite
- [ ] Data Analyst test suite
- [ ] Developer test suite
- [ ] HTTP API server
- [ ] CI/CD integration (GitHub Actions)
- [ ] Badge & certificate system
- [ ] Web dashboard
- [ ] Community suite marketplace

## Contributing

We welcome contributions! Whether it's new test suites, scoring improvements, or framework adapters — Sensei gets better when the community builds together.

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT — use it, fork it, improve it.

---

*Built by [WorkDraft.ai](https://workdraft.ai) — The managed marketplace for AI agent labor.*
