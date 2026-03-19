# Sensei Evaluation Flow

## How it works: Load Suite → Connect Agent → Evaluate → Score → Badge

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CALLER (AgentTalent, CI/CD, or CLI)                │
│                                                                     │
│  1. Load suite YAML:                                               │
│     const suite = await loader.loadFile('./suites/sdr-qualification/suite.yaml')  │
│                                                                     │
│  2. Create adapter + runner:                                       │
│     const adapter = createAdapter(suite.agent)                     │
│     const runner = new Runner(adapter, { judgeScorer, ... })       │
│                                                                     │
│  3. Run evaluation:                                                │
│     const result = await runner.run(suite)                         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SENSEI ENGINE                               │
│                                                                     │
│  4. Validate depends_on references                                 │
│  5. Connect to agent via adapter                                   │
│  6. Health check ✓                                                 │
│                                                                     │
│  ┌─── LAYER 1: EXECUTION (50% of score) ─────────────────────┐    │
│  │                                                             │    │
│  │  Scenario: "cold-email"                                     │    │
│  │  ┌──────────┐    adapter.send()             ┌──────────┐   │    │
│  │  │  RUNNER   │──── { prompt: "Write cold ──▶│  AGENT   │   │    │
│  │  │          │      email to Sarah Chen,     │          │   │    │
│  │  │          │      VP Eng at TechCorp..." } │          │   │    │
│  │  │          │                                │          │   │    │
│  │  │          │◀─── { response: "Subject:  ───│          │   │    │
│  │  │          │      Scaling DevEx at          │          │   │    │
│  │  │          │      TechCorp..." }            │          │   │    │
│  │  └──────────┘                                └──────────┘   │    │
│  │       │                                                     │    │
│  │       ▼                                                     │    │
│  │  Score KPIs:                                                │    │
│  │  ├─ personalization: 4.5/5 (LLM judge) ✅                  │    │
│  │  ├─ value_alignment: 4.8/5 (LLM judge) ✅                  │    │
│  │  ├─ call_to_action: 4.0/5 (LLM judge) ✅                   │    │
│  │  ├─ brevity: 142 words (automated word-count) ✅            │    │
│  │  └─ subject_line: 4.6/5 (LLM judge) ✅                     │    │
│  │                                                             │    │
│  │  EXECUTION SCORE: 91.2 / 100                               │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─── LAYER 2: REASONING (30% of score) ─────────────────────┐    │
│  │                                                             │    │
│  │  Scenario: "explain-strategy" (depends_on: cold-email)      │    │
│  │  ┌──────────┐    adapter.send()             ┌──────────┐   │    │
│  │  │  RUNNER   │──── { prompt: "Previous   ──▶│  AGENT   │   │    │
│  │  │          │      output:\n<email>\n\n     │          │   │    │
│  │  │          │      Why did you choose       │          │   │    │
│  │  │          │      this angle?" }           │          │   │    │
│  │  │          │◀─── { response: "I focused ──│          │   │    │
│  │  │          │      on the Series B..." }    │          │   │    │
│  │  └──────────┘                                └──────────┘   │    │
│  │       │                                                     │    │
│  │       ▼                                                     │    │
│  │  Score KPIs (via judgeScorer callback → Judge.evaluate):    │    │
│  │  ├─ reasoning_depth: 4.3/5 ✅                               │    │
│  │  └─ strategic_thinking: 4.0/5 ✅                            │    │
│  │                                                             │    │
│  │  REASONING SCORE: 82.5 / 100                               │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─── LAYER 3: SELF-IMPROVEMENT (20% of score) ──────────────┐    │
│  │                                                             │    │
│  │  Scenario: "improve-email" (depends_on: cold-email)         │    │
│  │  ┌──────────┐    adapter.send()             ┌──────────┐   │    │
│  │  │  RUNNER   │──── { prompt: "Previous   ──▶│  AGENT   │   │    │
│  │  │          │      output:\n<email>\n\n     │          │   │    │
│  │  │          │      Rewrite incorporating    │          │   │    │
│  │  │          │      feedback: too feature-   │          │   │    │
│  │  │          │      focused, soften CTA" }   │          │   │    │
│  │  │          │◀─── { response: "Subject:  ──│          │   │    │
│  │  │          │      How TechCorp could       │          │   │    │
│  │  │          │      save 20hrs/week..." }    │          │   │    │
│  │  └──────────┘                                └──────────┘   │    │
│  │       │                                                     │    │
│  │       ▼                                                     │    │
│  │  Score KPIs (via comparatorScorer → Comparator.compare):    │    │
│  │  ├─ improvement: 4.5/5 (comparative-judge)                  │    │
│  │  │   "Agent addressed all feedback points" ✅               │    │
│  │  └─ delta: 4.0/5 (comparative-judge)                        │    │
│  │      "Compared v1 vs v2: outcome-focused, softer CTA" ✅   │    │
│  │                                                             │    │
│  │  SELF-IMPROVEMENT SCORE: 85.0 / 100                        │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  7. Disconnect adapter (always, via try/finally)                   │
│                                                                     │
│  8. AGGREGATE SCORES                                               │
│     ┌──────────────────────────────────────────────────────┐       │
│     │  Execution:        91.2 × 0.50 = 45.60              │       │
│     │  Reasoning:        82.5 × 0.30 = 24.75              │       │
│     │  Self-Improvement: 85.0 × 0.20 = 17.00              │       │
│     │  ─────────────────────────────────────               │       │
│     │  OVERALL SCORE:    87.35 → 🥈 SILVER                │       │
│     └──────────────────────────────────────────────────────┘       │
│                                                                     │
│  9. Return SuiteResult (JSON)                                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        CALLER (receives SuiteResult)                │
│                                                                     │
│  10. Use result:                                                   │
│      - reporter.toTerminal(result) → pretty console output         │
│      - reporter.toJSON(result) → machine-readable JSON             │
│      - generateHtmlReport(result) → dark-theme HTML report         │
│      - Store in database                                           │
│      - Make hiring decision based on badge                         │
└─────────────────────────────────────────────────────────────────────┘
```

## Integration Code (AgentTalent)

```typescript
import { SuiteLoader, Runner, Judge, Comparator, createAdapter } from '@mondaycom/sensei-engine';
import type { KPIResult } from '@mondaycom/sensei-engine';

async function onAgentApply(application: Application) {
  // 1. Load the relevant suite
  const loader = new SuiteLoader();
  const suite = await loader.loadFile(`./suites/${application.job.role_type}/suite.yaml`);

  // 2. Override agent endpoint with applicant's URL
  suite.agent = {
    adapter: 'http',
    endpoint: application.agent_endpoint,
    timeout_ms: 60000,
    headers: { Authorization: `Bearer ${application.agent_token}` },
  };

  // 3. Create components
  const adapter = createAdapter(suite.agent);
  const judge = suite.judge ? new Judge(suite.judge) : undefined;
  const comparator = suite.judge ? new Comparator(suite.judge) : undefined;

  // 4. Run evaluation
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

  // 5. Store and act on result
  await db.evaluations.create({
    application_id: application.id,
    suite: result.suite_id,
    overall_score: result.scores.overall,
    badge: result.badge,
    full_report: result,
  });

  if (result.scores.overall < 60) {
    await rejectApplication(application, result);
  } else {
    await queueForReview(application, result);
  }
}
```

## Sequence Diagram

```
Agent Owner    Caller          Sensei Engine     LLM Judge       Agent
    │              │                │                │              │
    │──request──▶  │                │                │              │
    │              │                │                │              │
    │              │──runner.run()─▶│                │              │
    │              │                │                │              │
    │              │                │──adapter.connect()──────────▶│
    │              │                │──healthCheck()──────────────▶│
    │              │                │◀──── true ──────────────────│
    │              │                │                │              │
    │              │                │  LAYER 1: EXECUTION          │
    │              │                │──send(prompt)──────────────▶│
    │              │                │◀──{ response }─────────────│
    │              │                │──judgeScorer()─▶│             │
    │              │                │◀──verdict────── │             │
    │              │                │                │              │
    │              │                │  LAYER 2: REASONING           │
    │              │                │──send(prev+prompt)─────────▶│
    │              │                │◀──{ response }─────────────│
    │              │                │──judgeScorer()─▶│             │
    │              │                │◀──verdict────── │             │
    │              │                │                │              │
    │              │                │  LAYER 3: SELF-IMPROVEMENT    │
    │              │                │──send(prev+feedback+prompt)─▶│
    │              │                │◀──{ response }──────────────│
    │              │                │──comparatorScorer()─▶│        │
    │              │                │◀──verdict───────────│         │
    │              │                │                │              │
    │              │                │──adapter.disconnect()         │
    │              │                │  (always, via try/finally)    │
    │              │                │                │              │
    │              │                │  AGGREGATE: 87.3 🥈           │
    │              │◀──SuiteResult──│                │              │
    │              │                │                │              │
    │◀──result──── │                │                │              │
```
