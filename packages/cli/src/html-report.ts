/**
 * Self-contained HTML report generator — dark theme
 */
import type { SuiteResult, ScenarioResult, KPIResult, Badge } from '@mondaycom/sensei-engine';

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badgeEmoji(badge: Badge): string {
  return { gold: '🥇', silver: '🥈', bronze: '🥉', none: '—' }[badge];
}

function scoreColor(score: number): string {
  if (score >= 90) return '#d4a574'; // gold
  if (score >= 75) return '#b0b0b0'; // silver
  if (score >= 60) return '#cd7f32'; // bronze
  return '#c44';                     // fail
}

function kpiRows(kpis: KPIResult[]): string {
  return kpis
    .map(
      (k) => `<tr>
      <td>${esc(k.kpi_name)}</td>
      <td><span class="score-pill" style="background:${scoreColor(k.score)}">${k.score.toFixed(1)}</span></td>
      <td>${k.raw_score}/${k.max_score}</td>
      <td>${k.weight}</td>
      <td><code>${esc(k.method)}</code></td>
      <td class="evidence">${esc(k.evidence)}</td>
    </tr>`,
    )
    .join('\n');
}

function scenarioCard(s: ScenarioResult): string {
  const barColor = scoreColor(s.score);
  const barWidth = Math.max(s.score, 2);
  return `
  <div class="scenario-card">
    <div class="scenario-header">
      <span class="layer-tag">${esc(s.layer.toUpperCase())}</span>
      <span class="scenario-name">${esc(s.scenario_name)}</span>
      <span class="scenario-time">${(s.duration_ms / 1000).toFixed(1)}s</span>
    </div>
    <div class="score-bar-container">
      <div class="score-bar" style="width:${barWidth}%;background:${barColor}"></div>
      <span class="score-label">${s.score.toFixed(1)}</span>
    </div>
    ${s.error ? `<p class="error-msg">⚠ ${esc(s.error)}</p>` : ''}
    <table class="kpi-table">
      <thead><tr><th>KPI</th><th>Score</th><th>Raw</th><th>Weight</th><th>Method</th><th>Evidence</th></tr></thead>
      <tbody>${kpiRows(s.kpis)}</tbody>
    </table>
  </div>`;
}

function scoreCard(label: string, value: number): string {
  return `<div class="score-card">
    <div class="score-value" style="color:${scoreColor(value)}">${value.toFixed(1)}</div>
    <div class="score-label-text">${label}</div>
  </div>`;
}

export function generateHtmlReport(result: SuiteResult): string {
  const layers = ['execution', 'reasoning', 'self-improvement'] as const;
  const grouped = new Map<string, ScenarioResult[]>();
  for (const s of result.scenarios) {
    const arr = grouped.get(s.layer) ?? [];
    arr.push(s);
    grouped.set(s.layer, arr);
  }

  const layerLabels: Record<string, string> = {
    execution: 'Execution',
    reasoning: 'Reasoning',
    'self-improvement': 'Self-Improvement',
  };

  const layerSections = layers
    .filter((l) => grouped.has(l))
    .map((l) => {
      const scenarios = grouped.get(l)!;
      const layerLabel = layerLabels[l] ?? l;
      return `
      <section class="layer-section">
        <h2>${layerLabel} Layer</h2>
        ${scenarios.map(scenarioCard).join('\n')}
      </section>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sensei Report — ${esc(result.suite_id)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a0a;color:#e8e4df;font-family:'Inter',system-ui,-apple-system,sans-serif;line-height:1.6;padding:2rem;max-width:960px;margin:0 auto}
a{color:#d4a574}
h1,h2,h3{font-weight:600}
h1{font-size:1.8rem;margin-bottom:.25rem}
h2{font-size:1.3rem;margin-bottom:1rem;border-bottom:1px solid #222;padding-bottom:.5rem}
.header{text-align:center;padding:2rem 0 1.5rem;border-bottom:1px solid #1a1a1a;margin-bottom:2rem}
.header .badge{font-size:2.5rem;margin:.75rem 0}
.header .badge-label{font-size:1rem;text-transform:uppercase;letter-spacing:.15em;color:#d4a574;font-weight:600}
.meta{color:#888;font-size:.85rem;margin-top:.5rem}
.scores-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem;margin-bottom:2.5rem}
.score-card{background:#141414;border:1px solid #222;border-radius:10px;padding:1.25rem;text-align:center}
.score-value{font-size:2rem;font-weight:700}
.score-label-text{font-size:.8rem;color:#888;text-transform:uppercase;letter-spacing:.1em;margin-top:.25rem}
.layer-section{margin-bottom:2rem}
.scenario-card{background:#111;border:1px solid #1e1e1e;border-radius:10px;padding:1.25rem;margin-bottom:1.25rem}
.scenario-header{display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem}
.layer-tag{background:#1e1e1e;color:#d4a574;font-size:.7rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;padding:.2rem .6rem;border-radius:4px}
.scenario-name{flex:1;font-weight:600;font-size:1rem}
.scenario-time{color:#666;font-size:.8rem}
.score-bar-container{position:relative;background:#1a1a1a;border-radius:6px;height:28px;margin-bottom:.75rem;overflow:hidden}
.score-bar{height:100%;border-radius:6px;transition:width .3s}
.score-label{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:.8rem;font-weight:700;color:#e8e4df}
.error-msg{color:#c44;font-size:.85rem;margin-bottom:.5rem}
.kpi-table{width:100%;border-collapse:collapse;font-size:.82rem}
.kpi-table th{text-align:left;padding:.5rem .6rem;border-bottom:1px solid #222;color:#888;font-weight:600;text-transform:uppercase;font-size:.7rem;letter-spacing:.05em}
.kpi-table td{padding:.45rem .6rem;border-bottom:1px solid #1a1a1a}
.kpi-table .evidence{color:#999;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.score-pill{display:inline-block;padding:.1rem .5rem;border-radius:4px;color:#0a0a0a;font-weight:700;font-size:.78rem}
code{background:#1a1a1a;padding:.1rem .4rem;border-radius:3px;font-size:.78rem;color:#aaa}
.footer{text-align:center;color:#444;font-size:.75rem;margin-top:3rem;padding-top:1rem;border-top:1px solid #1a1a1a}
@media(max-width:640px){.scores-grid{grid-template-columns:repeat(2,1fr)}}
</style>
</head>
<body>
  <div class="header">
    <h1>Sensei Qualification Report</h1>
    <div class="badge">${badgeEmoji(result.badge)}</div>
    <div class="badge-label">${esc(result.badge)} badge</div>
    <div class="meta">
      ${esc(result.suite_id)} v${esc(result.suite_version)} &mdash; Agent: ${esc(result.agent_id)}<br>
      ${esc(result.timestamp)} &mdash; ${(result.duration_ms / 1000).toFixed(1)}s${result.judge_model ? ` &mdash; Judge: ${esc(result.judge_model)}` : ''}
    </div>
  </div>

  <div class="scores-grid">
    ${scoreCard('Overall', result.scores.overall)}
    ${scoreCard('Execution', result.scores.execution)}
    ${scoreCard('Reasoning', result.scores.reasoning)}
    ${scoreCard('Self-Improvement', result.scores.self_improvement)}
  </div>

  ${layerSections}

  <div class="footer">Generated by Sensei Qualification Engine</div>
</body>
</html>`;
}
