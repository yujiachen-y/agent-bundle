# Contributing to agent-bundle

Thanks for your interest in contributing! This guide covers the basics.

## Getting Started

1. Fork the repo and clone your fork
2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Create a feature branch from `main`:

   ```bash
   git checkout -b feat/your-feature
   ```

## Development

### Commands

```bash
pnpm test              # run unit tests
pnpm run lint          # lint check
pnpm run quality       # lint + duplicate + tests
```

### Pre-commit Hooks

This repo uses pre-commit hooks to enforce quality gates (coverage, complexity, lint). Install them with:

```bash
pre-commit install
```

All hooks must pass before your code can be committed.

### Code Style

- Follow existing patterns in the codebase
- Use TypeScript strict mode
- Keep functions focused and under the configured line limits
- Write tests for new functionality

## Submitting Changes

1. Keep PRs focused on a single change
2. Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:

   ```
   feat(sandbox): add Docker provider support
   fix(agent-loop): handle empty tool responses
   docs: update configuration examples
   ```

3. Include a clear description of what changed and why
4. Make sure all checks pass (`pnpm run quality`)
5. Rebase on latest `main` before requesting review

## Reporting Bugs

Use the [Bug Report](https://github.com/yujiachen-y/agent-bundle/issues/new?template=bug_report.yml) issue template. Include:

- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, Node.js version, provider config)

## Requesting Features

Use the [Feature Request](https://github.com/yujiachen-y/agent-bundle/issues/new?template=feature_request.yml) issue template.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
