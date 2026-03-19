# Contributing to Sensei

We love contributions! Here's how you can help.

## Ways to Contribute

### 1. Add a Test Suite
The most impactful contribution. Create a new suite for a professional role:
- Define scenarios across all 3 layers (execution, reasoning, self-improvement)
- Include realistic fixtures (sample data, transcripts, etc.)
- Write clear rubrics for LLM-judge KPIs
- Test with at least 2 different agents

### 2. Improve Existing Suites
- Add scenarios to existing suites
- Improve scoring rubrics for more accurate evaluation
- Add edge-case scenarios
- Contribute fixtures (more diverse test data)

### 3. Build Adapters
- Add support for new agent frameworks
- Improve existing adapters (HTTP, Stdio, OpenClaw)

### 4. Core Engine
- Improve scoring algorithms
- Add new automated scorer types
- Add new reporter formats
- Optimize performance
- Fix bugs

## Development Setup

```bash
git clone https://github.com/mondaycom/sensei.git
cd sensei
npm install
npm run build
npm test          # runs vitest across all packages
```

## Suite Contribution Guidelines

1. Each suite lives in `suites/<role-name>/`
2. Define scenarios in `suite.yaml`
3. Put test data in `fixtures/`
4. Include at least:
   - 3 execution scenarios
   - 2 reasoning scenarios
   - 1 self-improvement scenario
5. Each KPI must have a clear rubric (for LLM-judge) or expected value (for automated)
6. Test your suite against a real agent before submitting

## Code Style

- TypeScript strict mode
- Meaningful variable names
- Comments for complex logic only
- All new code should have corresponding tests

## Releases

Releases are triggered manually by maintainers via **Actions → Release → Run workflow**. Select the bump type (`patch` / `minor` / `major`) and which packages to release. You don't need to do anything special in your PR to trigger a release.

## Pull Request Process

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Run build: `npm run build`
6. Submit PR with clear description

## License

By contributing, you agree that your contributions will be licensed under MIT.
