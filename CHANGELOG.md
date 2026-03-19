# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-03-18

### Added
- Changelog automation with [@changesets/cli](https://github.com/changesets/changesets)
- GitHub Actions `release.yml` workflow for automated Version Packages PRs and GitHub Releases
- `.changeset/config.json` configuration for npm workspaces

## [0.2.0] - 2026-03-16

### Fixed (Code Review)
- **M1:** Runner now disconnects adapter in `try/finally` — no more resource leaks on error
- **M2:** StdioAdapter rewritten with class-level buffer + child process exit handler
- **M3:** Comparator validates NaN scores (parity with judge.ts `parseVerdict`)
- **M4:** CLI JSON loader now routes through Zod schema validation
- **M5:** YAML injection prevented in `init` command template (escaped user input)
- **M6:** Early guard for missing `suite.agent` config in CLI `run` command
- **M7:** 60-second timeout on LLM judge calls via AbortController
- **M8:** `depends_on` references validated before run — throws on unresolved
- **M9:** SDK `SuiteBuilder.build()` returns defensive copies (no mutable state leak)
- **M10:** `clearCustomKPIs` exported from SDK public API
- **M11:** `invokeKPI()` validates return values (NaN, Infinity, negative, >maxScore)
- **M12:** `compareResults` includes scenarios removed between runs in delta
- **M13:** Suite schema accepts optional `defaults` field (`timeout_ms`, `judge_model`)
- **m3:** `inferApiKey` throws on missing env var instead of returning empty string
- **m4:** Reporter derives weight percentages from `LAYER_WEIGHTS` constant
- **m5:** `parseInt` NaN guard in CLI `run` command
- **m6:** Fixed `||` between `expect()` calls in test assertion
- **m7:** XSS fix — `esc()` applied to method field in HTML report
- **m8:** Removed dead code in `init.ts`
- **m9:** CLI version read from `package.json` instead of hardcoded

### Changed
- Documentation fully rewritten to match implementation (README, ARCHITECTURE, flow-diagram, CONTRIBUTING)
- Landing page updated with correct CLI commands and code examples

## [0.1.0] - 2026-03-16

### Added

- **Engine Core** (`@mondaycom/sensei-engine`)
  - Zod schema for runtime validation of YAML suite definitions
  - Suite loader with YAML parsing, fixture resolution, and descriptive error messages
  - Automated KPI scorer: `contains`, `regex`, `json-schema`, `json-parse`, `numeric-range`, `word-count`, `function`
  - LLM-as-judge evaluation (single judge + multi-judge with median scoring)
  - Comparative judge for self-improvement layer (before/after comparison)
  - Weighted score aggregation: scenario, layer, and overall scores (missing layers re-normalized)
  - Badge determination: gold (90+), silver (75+), bronze (60+)
  - Runner with layer-ordered execution, `depends_on` resolution, retry logic, and resource cleanup
  - Reporter with JSON and ANSI terminal output formats
  - Adapters: HTTP (with retry), Stdio (JSON-line protocol), OpenClaw (native)
  - Shared LLM client factory (`llm-client.ts`) supporting OpenAI + OpenAI-compatible providers
- **CLI** (`@mondaycom/sensei-cli`)
  - `sensei run` — execute suite against agent with configurable adapter/judge/timeout
  - `sensei validate` — validate suite YAML/JSON against Zod schema
  - `sensei init` — scaffold new suite template (interactive + non-interactive)
  - `sensei report` — render reports from previous JSON results
  - HTML report generator (self-contained dark theme)
- **SDK** (`@mondaycom/sensei-sdk`)
  - `SuiteBuilder` fluent API for programmatic suite construction
  - `scenario()` and `kpi()` helper factories
  - `defineSuite()` passthrough helper
  - Custom KPI function registry (`registerKPI`, `getCustomKPI`, `listCustomKPIs`, `clearCustomKPIs`, `invokeKPI`)
  - Result utilities: `filterByLayer`, `compareResults`, `formatSummary`
- **Monorepo** with npm workspaces: `@mondaycom/sensei-engine`, `@mondaycom/sensei-cli`, `@mondaycom/sensei-sdk`
- **Test suites** — SDR qualification suite with fixtures (prospects, products, transcripts)
- **173 tests** covering engine, CLI, SDK, and E2E flows
- **CI/CD** — GitHub Actions workflows for CI (build + test) and npm publishing
- Architecture documentation, flow diagrams, and project specification
