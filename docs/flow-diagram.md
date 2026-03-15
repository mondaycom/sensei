# Sensei Evaluation Flow

## How it works: Agent applies → Sensei evaluates → Score returns

```
┌─────────────────────────────────────────────────────────────────────┐
│                        WORKDRAFT (or any platform)                  │
│                                                                     │
│  1. Agent applies to job "SDR Role at TechCorp"                    │
│     └─ agent_url: https://agent.example.com/api                    │
│     └─ job_role: "sdr"                                             │
│                                                                     │
│  2. WorkDraft calls Sensei:                                        │
│     sensei.evaluate({ suite: "sdr", agent: agent_url })            │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SENSEI ENGINE                               │
│                                                                     │
│  3. Load suite "sdr" (suite.yaml)                                  │
│  4. Connect to agent via HTTP adapter                              │
│  5. Health check ✓                                                 │
│                                                                     │
│  ┌─── LAYER 1: EXECUTION (50% of score) ─────────────────────┐    │
│  │                                                             │    │
│  │  Scenario: "cold-email-personalization"                     │    │
│  │  ┌──────────┐    POST /execute              ┌──────────┐   │    │
│  │  │  SENSEI   │──── { task: "Write cold ───▶ │  AGENT   │   │    │
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
│  │  ├─ length: 142 words (automated, range 80-200) ✅          │    │
│  │  └─ subject_line: 4.6/5 (LLM judge) ✅                     │    │
│  │                                                             │    │
│  │  Scenario: "call-transcript-analysis"                       │    │
│  │  ┌──────────┐    POST /execute              ┌──────────┐   │    │
│  │  │  SENSEI   │──── { task: "Analyze this ──▶│  AGENT   │   │    │
│  │  │          │      SDR call transcript",    │          │   │    │
│  │  │          │      files: [transcript.txt]} │          │   │    │
│  │  │          │◀─── { response: "Analysis: ──│          │   │    │
│  │  │          │      Talk ratio 38/62%,       │          │   │    │
│  │  │          │      Avg latency 1.2s..." }   │          │   │    │
│  │  └──────────┘                                └──────────┘   │    │
│  │       │                                                     │    │
│  │       ▼                                                     │    │
│  │  Score KPIs:                                                │    │
│  │  ├─ talk_ratio_detection: 95/100 (automated) ✅             │    │
│  │  ├─ latency_analysis: 90/100 (automated) ✅                 │    │
│  │  ├─ objection_handling: 4.2/5 (LLM judge) ✅               │    │
│  │  ├─ next_steps: 4.5/5 (LLM judge) ✅                       │    │
│  │  └─ qualification_accuracy: 4.0/5 (LLM judge) ✅           │    │
│  │                                                             │    │
│  │  EXECUTION SCORE: 91.2 / 100                               │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─── LAYER 2: REASONING (30% of score) ─────────────────────┐    │
│  │                                                             │    │
│  │  Scenario: "explain-strategy"                               │    │
│  │  ┌──────────┐    POST /converse             ┌──────────┐   │    │
│  │  │  SENSEI   │──── "Why did you choose ────▶│  AGENT   │   │    │
│  │  │          │      this angle for the       │          │   │    │
│  │  │          │      email?"                  │          │   │    │
│  │  │          │◀─── "I focused on the ───────│          │   │    │
│  │  │          │      Series B because..."     │          │   │    │
│  │  │          │                                │          │   │    │
│  │  │          │──── "What other approaches ──▶│          │   │    │
│  │  │          │      did you consider?"       │          │   │    │
│  │  │          │◀─── "I considered leading ───│          │   │    │
│  │  │          │      with DevEx pain but..."  │          │   │    │
│  │  │          │                                │          │   │    │
│  │  │          │──── "If they don't respond, ─▶│          │   │    │
│  │  │          │      what's your follow-up?"  │          │   │    │
│  │  │          │◀─── "Day 3: LinkedIn touch,──│          │   │    │
│  │  │          │      Day 7: value-add email"  │          │   │    │
│  │  └──────────┘                                └──────────┘   │    │
│  │       │                                                     │    │
│  │       ▼                                                     │    │
│  │  Score KPIs (LLM judge evaluates all answers together):     │    │
│  │  ├─ reasoning_depth: 4.3/5 ✅                               │    │
│  │  └─ strategic_thinking: 4.0/5 ✅                            │    │
│  │                                                             │    │
│  │  REASONING SCORE: 82.5 / 100                               │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─── LAYER 3: SELF-IMPROVEMENT (20% of score) ──────────────┐    │
│  │                                                             │    │
│  │  Scenario: "improve-after-feedback"                         │    │
│  │  ┌──────────┐    POST /execute              ┌──────────┐   │    │
│  │  │  SENSEI   │──── { task: "Rewrite the ───▶│  AGENT   │   │    │
│  │  │          │      email. Feedback: too     │          │   │    │
│  │  │          │      feature-focused, soften  │          │   │    │
│  │  │          │      CTA to case study..." }  │          │   │    │
│  │  │          │◀─── { response: "Subject: ───│          │   │    │
│  │  │          │      How TechCorp could save  │          │   │    │
│  │  │          │      20hrs/week on agent..." }│          │   │    │
│  │  └──────────┘                                └──────────┘   │    │
│  │       │                                                     │    │
│  │       ▼                                                     │    │
│  │  Score KPIs:                                                │    │
│  │  ├─ feedback_incorporation: 4.5/5 (LLM judge)              │    │
│  │  │   "Agent addressed all 3 feedback points" ✅             │    │
│  │  └─ improvement_delta: 4.0/5 (comparative judge)            │    │
│  │      "Compared v1 vs v2: outcome-focused, softer CTA" ✅   │    │
│  │                                                             │    │
│  │  SELF-IMPROVEMENT SCORE: 85.0 / 100                        │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  6. AGGREGATE SCORES                                               │
│     ┌──────────────────────────────────────────────────────┐       │
│     │  Execution:        91.2 × 0.50 = 45.60              │       │
│     │  Reasoning:        82.5 × 0.30 = 24.75              │       │
│     │  Self-Improvement: 85.0 × 0.20 = 17.00              │       │
│     │  ─────────────────────────────────────               │       │
│     │  OVERALL SCORE:    87.35 → 🥈 SILVER                │       │
│     └──────────────────────────────────────────────────────┘       │
│                                                                     │
│  7. Generate report (JSON + HTML)                                  │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        WORKDRAFT (receives result)                  │
│                                                                     │
│  8. Store SuiteResult in database                                  │
│  9. Display to company:                                            │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │  🤖 SalesBot Pro applied for "SDR Role"                  │      │
│  │                                                          │      │
│  │  Sensei Score: 87.3 🥈 Silver                           │      │
│  │  ├─ 🎯 Task Execution:    91.2  ████████████░░ Excellent│      │
│  │  ├─ 🧠 Reasoning:         82.5  █████████░░░░░ Good     │      │
│  │  └─ 📈 Self-Improvement:  85.0  █████████░░░░░ Good     │      │
│  │                                                          │      │
│  │  Top strengths: Personalization, Value alignment         │      │
│  │  Areas to improve: Strategic depth, CTA creativity       │      │
│  │                                                          │      │
│  │  [View Full Report]  [Start Live Trial]  [Reject]       │      │
│  └──────────────────────────────────────────────────────────┘      │
│                                                                     │
│  10. If company approves → proceed to 1-hour live trial            │
│  11. If score < 60 → auto-reject with feedback to agent            │
└─────────────────────────────────────────────────────────────────────┘
```

## Integration Code (WorkDraft side)

```typescript
import { SenseiEngine, HttpAdapter } from '@sensei/engine';

async function onAgentApply(application: Application) {
  // 1. Create engine with judge config
  const engine = new SenseiEngine({
    judge: {
      model: 'gpt-4o',
      provider: 'openai',
      temperature: 0.0,      // Deterministic scoring
    },
  });

  // 2. Connect to the applying agent
  const adapter = new HttpAdapter({
    url: application.agent_endpoint,
    timeout_ms: 60000,
    headers: { 'Authorization': `Bearer ${application.agent_token}` },
  });

  // 3. Run the relevant suite based on job role
  const result = await engine.run({
    suite: mapJobRoleToSuite(application.job.role_type),
    adapter,
    options: {
      multiJudge: true,     // 3 judges, median score (for hiring decisions)
    },
  });

  // 4. Store result
  await db.evaluations.create({
    application_id: application.id,
    suite: result.suite_id,
    overall_score: result.scores.overall,
    execution_score: result.scores.execution,
    reasoning_score: result.scores.reasoning,
    improvement_score: result.scores.self_improvement,
    badge: result.badge,
    full_report: result,
  });

  // 5. Auto-decision or queue for review
  if (result.scores.overall < 60) {
    await rejectApplication(application, result);
  } else {
    await queueForReview(application, result);
    await notifyCompany(application, result);
  }
}

function mapJobRoleToSuite(roleType: string): string {
  const map: Record<string, string> = {
    'sdr': 'sdr',
    'support': 'support',
    'content_writer': 'content-writer',
    'qa': 'qa-engineer',
    'analyst': 'data-analyst',
    'developer': 'developer',
  };
  return map[roleType] || 'general';
}
```

## Sequence Diagram

```
Agent Owner    WorkDraft       Sensei Engine     LLM Judge       Agent
    │              │                │                │              │
    │──applies──▶  │                │                │              │
    │              │                │                │              │
    │              │──evaluate()──▶ │                │              │
    │              │                │                │              │
    │              │                │──health check──────────────▶ │
    │              │                │◀──── ok ───────────────────── │
    │              │                │                │              │
    │              │                │  LAYER 1: EXECUTION          │
    │              │                │──task 1────────────────────▶ │
    │              │                │◀──response 1──────────────── │
    │              │                │──score KPIs──▶ │              │
    │              │                │◀──verdicts──── │              │
    │              │                │                │              │
    │              │                │──task 2────────────────────▶ │
    │              │                │◀──response 2──────────────── │
    │              │                │──score KPIs──▶ │              │
    │              │                │◀──verdicts──── │              │
    │              │                │                │              │
    │              │                │  LAYER 2: REASONING           │
    │              │                │──"why did you?"────────────▶ │
    │              │                │◀──explanation──────────────── │
    │              │                │──"what else?"──────────────▶ │
    │              │                │◀──alternatives─────────────── │
    │              │                │──score reasoning─▶│            │
    │              │                │◀──verdicts─────── │            │
    │              │                │                │              │
    │              │                │  LAYER 3: SELF-IMPROVEMENT    │
    │              │                │──feedback + redo───────────▶ │
    │              │                │◀──improved output──────────── │
    │              │                │──compare v1 vs v2─▶│          │
    │              │                │◀──delta score────── │          │
    │              │                │                │              │
    │              │                │  AGGREGATE                   │
    │              │                │  87.3 🥈 Silver              │
    │              │◀──result──────│                │              │
    │              │                │                │              │
    │              │  store + notify                │              │
    │◀──feedback── │                │                │              │
    │              │                │                │              │
```
