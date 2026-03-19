/**
 * SuiteBuilder — Fluent API for creating suites programmatically
 */
import type {
  SuiteDefinition,
  ScenarioDefinition,
  KPIDefinition,
  KPIConfig,
  EvaluationLayer,
  ScoringMethod,
  AgentConfig,
  JudgeConfig,
  ScenarioInput,
} from '@mondaycom/sensei-engine';

// ─── Helper factories ───────────────────────────────────────────────

export function scenario(
  id: string,
  opts: {
    name?: string;
    layer: EvaluationLayer;
    description?: string;
    input: ScenarioInput;
    kpis: KPIDefinition[];
    depends_on?: string;
  },
): ScenarioDefinition {
  return {
    id,
    name: opts.name ?? id,
    layer: opts.layer,
    description: opts.description,
    input: opts.input,
    kpis: opts.kpis,
    depends_on: opts.depends_on,
  };
}

export function kpi(
  id: string,
  opts: {
    name?: string;
    weight: number;
    method: ScoringMethod;
    config: KPIConfig;
  },
): KPIDefinition {
  return {
    id,
    name: opts.name ?? id,
    weight: opts.weight,
    method: opts.method,
    config: opts.config,
  };
}

// ─── defineSuite shorthand ──────────────────────────────────────────

export function defineSuite(def: SuiteDefinition): SuiteDefinition {
  return def;
}

// ─── SuiteBuilder (fluent) ──────────────────────────────────────────

export class SuiteBuilder {
  private _id = '';
  private _name = '';
  private _version = '1.0.0';
  private _description?: string;
  private _agent: AgentConfig = { adapter: 'http' };
  private _judge?: JudgeConfig;
  private _scenarios: ScenarioDefinition[] = [];
  private _metadata?: Record<string, unknown>;

  id(id: string): this {
    this._id = id;
    return this;
  }

  name(name: string): this {
    this._name = name;
    return this;
  }

  version(version: string): this {
    this._version = version;
    return this;
  }

  description(description: string): this {
    this._description = description;
    return this;
  }

  agent(config: AgentConfig): this {
    this._agent = config;
    return this;
  }

  judge(config: JudgeConfig): this {
    this._judge = config;
    return this;
  }

  addScenario(scenario: ScenarioDefinition): this {
    this._scenarios.push(scenario);
    return this;
  }

  metadata(meta: Record<string, unknown>): this {
    this._metadata = meta;
    return this;
  }

  validate(): string[] {
    const errors: string[] = [];
    if (!this._id) errors.push('Suite id is required');
    if (!this._name) errors.push('Suite name is required');
    if (!this._version) errors.push('Suite version is required');
    if (this._scenarios.length === 0) errors.push('At least one scenario is required');

    const ids = new Set<string>();
    for (const s of this._scenarios) {
      if (ids.has(s.id)) errors.push(`Duplicate scenario id: "${s.id}"`);
      ids.add(s.id);
      if (s.kpis.length === 0) errors.push(`Scenario "${s.id}" has no KPIs`);
      for (const k of s.kpis) {
        if (k.weight < 0 || k.weight > 1) {
          errors.push(`KPI "${k.id}" in scenario "${s.id}" has invalid weight: ${k.weight}`);
        }
      }
    }
    return errors;
  }

  build(): SuiteDefinition {
    const errors = this.validate();
    if (errors.length > 0) {
      throw new Error(`Suite validation failed:\n  ${errors.join('\n  ')}`);
    }

    return {
      id: this._id,
      name: this._name,
      version: this._version,
      description: this._description,
      agent: { ...this._agent },
      judge: this._judge ? { ...this._judge } : undefined,
      scenarios: [...this._scenarios],
      metadata: this._metadata ? { ...this._metadata } : undefined,
    };
  }
}
