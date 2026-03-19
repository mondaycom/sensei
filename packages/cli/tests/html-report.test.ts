/**
 * HTML report generator tests
 */
import { describe, it, expect } from 'vitest';
import { generateHtmlReport } from '../src/html-report.js';
import type { SuiteResult } from '@mondaycom/sensei-engine';

const mockResult: SuiteResult = {
  suite_id: 'sdr-qualification',
  suite_version: '1.0.0',
  agent_id: 'test-agent',
  timestamp: '2026-03-16T12:00:00Z',
  scores: { overall: 82.5, execution: 88, reasoning: 76, self_improvement: 70 },
  scenarios: [
    {
      scenario_id: 'cold-email',
      scenario_name: 'Cold Email Personalization',
      layer: 'execution',
      score: 88,
      kpis: [
        { kpi_id: 'k1', kpi_name: 'Personalization', score: 92, raw_score: 9, max_score: 10, weight: 0.4, method: 'llm-judge', evidence: 'Strong personalization' },
        { kpi_id: 'k2', kpi_name: 'Clarity', score: 84, raw_score: 8, max_score: 10, weight: 0.6, method: 'llm-judge', evidence: 'Clear structure' },
      ],
      duration_ms: 3200,
      agent_input: 'Write a cold email',
      agent_output: 'Dear ...',
    },
    {
      scenario_id: 'explain-strategy',
      scenario_name: 'Explain Outreach Strategy',
      layer: 'reasoning',
      score: 76,
      kpis: [
        { kpi_id: 'k3', kpi_name: 'Reasoning Depth', score: 76, raw_score: 7, max_score: 10, weight: 1.0, method: 'llm-judge', evidence: 'Good reasoning' },
      ],
      duration_ms: 2100,
      agent_input: 'Explain strategy',
      agent_output: 'The strategy is...',
    },
    {
      scenario_id: 'improve-email',
      scenario_name: 'Improve Cold Email',
      layer: 'self-improvement',
      score: 70,
      kpis: [
        { kpi_id: 'k4', kpi_name: 'Improvement', score: 70, raw_score: 7, max_score: 10, weight: 1.0, method: 'comparative-judge', evidence: 'Moderate improvement' },
      ],
      duration_ms: 1800,
      agent_input: 'Improve this email',
      agent_output: 'Improved version...',
    },
  ],
  badge: 'silver',
  duration_ms: 7100,
  judge_model: 'gpt-4o',
};

describe('generateHtmlReport', () => {
  const html = generateHtmlReport(mockResult);

  it('is valid self-contained HTML', () => {
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('<head>');
    expect(html).toContain('<style>');
    expect(html).toContain('</style>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
    expect(html).toContain('</html>');
  });

  it('uses dark theme colors', () => {
    expect(html).toContain('#0a0a0a');
    expect(html).toContain('#e8e4df');
    expect(html).toContain('#d4a574');
  });

  it('contains header with badge and overall score', () => {
    expect(html).toContain('Sensei Qualification Report');
    expect(html).toContain('🥈'); // silver badge
    expect(html).toContain('silver');
    expect(html).toContain('82.5');
  });

  it('contains layer breakdown', () => {
    expect(html).toContain('Execution Layer');
    expect(html).toContain('Reasoning Layer');
    expect(html).toContain('Self-Improvement Layer');
  });

  it('contains per-scenario details with KPI scores', () => {
    expect(html).toContain('Cold Email Personalization');
    expect(html).toContain('Personalization');
    expect(html).toContain('92.0');
    expect(html).toContain('Explain Outreach Strategy');
    expect(html).toContain('Improve Cold Email');
  });

  it('contains score bars', () => {
    expect(html).toContain('score-bar');
    expect(html).toContain('score-pill');
  });

  it('contains suite metadata', () => {
    expect(html).toContain('sdr-qualification');
    expect(html).toContain('test-agent');
    expect(html).toContain('gpt-4o');
    expect(html).toContain('7.1s');
  });

  it('escapes HTML in text content', () => {
    const xssResult: SuiteResult = {
      ...mockResult,
      agent_id: '<script>alert("xss")</script>',
    };
    const xssHtml = generateHtmlReport(xssResult);
    expect(xssHtml).not.toContain('<script>alert');
    expect(xssHtml).toContain('&lt;script&gt;');
  });

  it('handles scenario with error', () => {
    const errorResult: SuiteResult = {
      ...mockResult,
      scenarios: [
        {
          ...mockResult.scenarios[0],
          error: 'Timeout exceeded',
        },
      ],
    };
    const errorHtml = generateHtmlReport(errorResult);
    expect(errorHtml).toContain('Timeout exceeded');
    expect(errorHtml).toContain('error-msg');
  });
});
