> [Français](branch-protection.md) | **English**

# Protection of the `main` Branch

## Active Model (Public Repository)

Public repository: the GitHub branch protection ruleset is **active and automated**.

```bash
gh api -X POST repos/Jayteam2025/jay-reach/rulesets --input docs/branch-protection-ruleset.json
```

The ruleset enforces:
- **Direct push forbidden** on `main` (all contributors)
- **Pull Request required** + approved review
- **Code owner review** (@Jeeiib via `CODEOWNERS`)
- **Green CI checks required**: `lint-and-test (22.x)`, `deno-check`, `gitleaks`, etc.
- No force-push or branch deletion allowed

**Admin (@Jeeiib) can bypass**: they can push/merge directly if needed.

## Contributing Process

**Anyone can contribute**:

1. **Fork** the public repository
2. Create a feature/bugfix branch
3. Open a **Pull Request** (from your fork to `main`)
4. A maintainer reviews and verifies CLA acceptance
5. Once approved, the PR is merged

The GitHub ruleset automates these safeguards for all contributors.
