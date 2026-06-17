> [Français](CONTRIBUTING.md) | **English**

# Contributing to Jay Reach

Thank you for your interest in Jay Reach! This document explains how to contribute to the project and the rules we follow.

## About Jay Reach

Jay Reach is a prospecting engine designed to run self-hosted. This repository is public and welcomes contributions from everyone to improve the product, fix bugs, and enrich documentation.

## Contributing Process

Any code change must go through a **Pull Request**:

1. **Never push directly to `main`** — create a feature or bugfix branch
2. **Open a PR** describing the change
3. **An admin of the project** (notably @Jeeiib) will review your changes
4. Once approved, your PR is merged to `main`

This approach ensures quality and traceability of all changes.

## How to Contribute

The repository is public. **Fork it, create a branch, and open a Pull Request.**

### Signing the CLA

The CLA (Contributor License Agreement) is automatically signed via a GitHub bot:

1. When you submit your first PR, a bot automatically comments with a link to [CLA.md](CLA.md).
2. Read the CLA document.
3. Post a comment on your PR containing exactly: `I have read the CLA Document and I hereby sign the CLA`
4. The check will pass and your PR can be reviewed. Subsequent PRs are automatically recognized.

## License Agreements

By contributing to Jay Reach, you agree that your contribution may be used under the **Functional Source License (FSL-1.1-MIT)** described in the [LICENSE](LICENSE) file.

The CLA allows us to relicense the project in the future if needed, while guaranteeing that your contribution will be credited and protected.

## Setting up your development environment

### Prerequisites

- Node.js >= 22.12
- pnpm >= 10

### Installation

```bash
git clone <repo-url>
cd jay-reach
pnpm install
```

### Project health check

```bash
pnpm run doctor
```

### Environment variables

Create a `.env` file in the root (never committed):

```bash
cp .env.example .env
```

Never commit secrets or API keys. Supabase Edge Functions secrets are managed separately in production.

## Before pushing: mandatory local checks

All these tests must pass on your machine before pushing:

```bash
# Linting
pnpm lint

# Type-checking (full TypeScript compiler)
pnpm typecheck

# Build
pnpm build

# Tests
pnpm test:run
```

If a check fails, fix the issue locally. PRs with failed checks will not be merged.

### Anti-hardcodes gate

A CI gate also blocks hardcodes specific to Jay (email addresses, internal UUIDs, proprietary domains). Run:

```bash
node scripts/check-no-jay-hardcodes.mjs --strict
```

Must display **0 violations** before a commit.

## Commit conventions

- **In French or English** (pick whichever you're more comfortable with)
- **No emojis** in the message
- **No mention of AI tools** (e.g., "Claude", "ChatGPT") in the message
- Be descriptive about the **why**, not just the **what**

Examples:

```
# GOOD
fix: fix a prospecting ranking bug
docs: add Supabase configuration guide

# BAD
update code
fix: 123456
feat: done with Claude
```

## Tests and coverage

### Front-end

React tests use Vitest + Testing Library:

```bash
pnpm test:run
```

### Back-end

Deno Edge Functions use `deno test`:

```bash
cd supabase/functions/_shared
deno test
```

When you add a feature or fix a bug, **add corresponding tests**. A PR without tests is less likely to be approved.

## Security

- **Never commit secrets** (API keys, tokens, passwords)
- **RLS (Row-Level Security)** on all new Supabase tables
- **Zod validation** on all user inputs
- **HTTPS required** for external redirects
- Report vulnerabilities privately (see [SECURITY.en.md](SECURITY.en.md))

## Reporting a bug or suggesting a feature

Any bug discovery, feature request, or improvement must be submitted via a **GitHub Issue**:

1. Check [existing issues](../../issues) to avoid duplicates
2. Describe the problem or request clearly (context, steps, expected outcome)
3. A maintainer will respond and assign labels

## Questions and support

- **Bugs or feature ideas**: [open an Issue](../../issues/new)
- **Design or architecture questions**: discuss in a PR or Discussion
- **Security issues**: see [SECURITY.en.md](SECURITY.en.md) and report privately

## Licenses and attributions

All code in this repository is under Functional Source License (FSL-1.1-MIT). See [LICENSE](LICENSE) for full details and the definition of "Competing Use".

Thank you for contributing!

---

**Need help?** Ask a question in an Issue or PR, and a maintainer will respond.
