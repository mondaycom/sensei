/**
 * Report formatters — terminal and HTML output
 */
import type { SuiteResult, Badge } from '@mondaycom/sensei-engine';
import { generateHtmlReport } from './html-report.js';

// ─── Badge display ──────────────────────────────────────────────────

const BADGE_ICONS: Record<Badge, string> = {
  gold: '🥇',
  silver: '🥈',
  bronze: '🥉',
  none: '—',
};

function badgeLabel(badge: Badge): string {
  return `${BADGE_ICONS[badge]} ${badge.toUpperCase()}`;
}

function scoreBar(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${score.toFixed(1)}`;
}

// ─── Terminal Report ────────────────────────────────────────────────

export function formatTerminalReport(result: SuiteResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push(`  SENSEI QUALIFICATION REPORT`);
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('');
  lines.push(`  Suite:     ${result.suite_id} v${result.suite_version}`);
  lines.push(`  Agent:     ${result.agent_id}`);
  lines.push(`  Timestamp: ${result.timestamp}`);
  lines.push(`  Duration:  ${(result.duration_ms / 1000).toFixed(1)}s`);
  if (result.judge_model) {
    lines.push(`  Judge:     ${result.judge_model}`);
  }
  lines.push('');

  // Overall scores
  lines.push('───────────────────────────────────────────────────────');
  lines.push('  SCORES');
  lines.push('───────────────────────────────────────────────────────');
  lines.push(`  Overall:          ${scoreBar(result.scores.overall)}`);
  lines.push(`  Execution:        ${scoreBar(result.scores.execution)}`);
  lines.push(`  Reasoning:        ${scoreBar(result.scores.reasoning)}`);
  lines.push(`  Self-Improvement: ${scoreBar(result.scores.self_improvement)}`);
  lines.push('');
  lines.push(`  Badge: ${badgeLabel(result.badge)}`);
  lines.push('');

  // Scenarios
  lines.push('───────────────────────────────────────────────────────');
  lines.push('  SCENARIOS');
  lines.push('───────────────────────────────────────────────────────');

  for (const scenario of result.scenarios) {
    lines.push('');
    lines.push(`  [${scenario.layer.toUpperCase()}] ${scenario.scenario_name}`);
    lines.push(`    Score: ${scenario.score.toFixed(1)} / 100  (${(scenario.duration_ms / 1000).toFixed(1)}s)`);
    if (scenario.error) {
      lines.push(`    ERROR: ${scenario.error}`);
    }
    for (const kpi of scenario.kpis) {
      lines.push(`    • ${kpi.kpi_name}: ${kpi.score.toFixed(1)} (${kpi.raw_score}/${kpi.max_score}, weight: ${kpi.weight})`);
      if (kpi.evidence) {
        lines.push(`      ${kpi.evidence}`);
      }
    }
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('');

  return lines.join('\n');
}

// ─── HTML Report ────────────────────────────────────────────────────

export function formatHtmlReport(result: SuiteResult): string {
  return generateHtmlReport(result);
}
