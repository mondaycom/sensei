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
- Improve existing adapters

### 4. Core Engine
- Improve scoring algorithms
- Add new reporter formats
- Optimize performance
- Fix bugs

## Development Setup

```bash
git clone https://github.com/nymeria-ai/sensei.git
cd sensei
npm install
npm run build
npm test
```

## Suite Contribution Guidelines

1. Each suite lives in `suites/<role-name>/`
2. Define scenarios in `suite.yaml`
3. Put test data in `fixtures/`
4. Include at least:
   - 3 execution scenarios
   - 2 reasoning scenarios
   - 1 self-improvement scenario
5. Each KPI must have a clear rubric
6. Test your suite against a real agent before submitting

## Code Style

- TypeScript strict mode
- ESLint + Prettier
- Meaningful variable names
- Comments for complex logic only

## Pull Request Process

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit PR with clear description

## License

By contributing, you agree that your contributions will be licensed under MIT.
