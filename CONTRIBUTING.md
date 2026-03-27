# Contributing to odoo-node

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/heypinchy/odoo-node.git
cd odoo-node
pnpm install
```

## Scripts

- `pnpm test` — Run tests
- `pnpm lint` — Run ESLint
- `pnpm format` — Format code with Prettier
- `pnpm format:check` — Check formatting
- `pnpm typecheck` — Type-check with TypeScript
- `pnpm build` — Build CJS + ESM output

## Guidelines

- Write tests for all new features and bug fixes
- Run `pnpm format` before committing
- Keep zero runtime dependencies
- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`

## Pull Requests

1. Fork the repo and create a feature branch
2. Make your changes with tests
3. Ensure all checks pass: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`
4. Open a PR against `main`
