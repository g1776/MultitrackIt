---
name: matt-pocock
description: Guidance, conventions, and troubleshooting notes for working with Matt Pocock's preferred patterns in this repository.
---

# Matt Pocock — Skills & Preferences

Summary

This skill captures recurring conventions, useful commands, and troubleshooting tips that reflect how Matt typically works on projects. It is intended to speed up future sessions by making those preferences easily available and actionable.

When to use

- Invoke when reviewing or editing TypeScript/Node code in this repo.
- Consult when adding instrumentation, configuring tests, or debugging async issues.

Conventions

- Code style: prefer explicit types on exported functions, use readable variable names over abbreviations, and keep small pure functions for business logic.
- Tests: favor small unit tests with clear Arrange/Act/Assert structure. Use descriptive test names that explain intent rather than implementation details.
- Logging & telemetry: prefer structured logs (JSON) and include correlation IDs when tracing request flows.

Common commands & snippets

- Run tests (project root):
  - npm test

- Run linter/formatter (if present):
  - npm run lint
  - npm run format

- Quick TypeScript build check:
  - npx tsc --noEmit

Troubleshooting tips

- If a test is flaky, first run it in isolation and inspect shared state or timers. Flakes often stem from global state or incorrect mock reset.
- For mysterious TypeScript errors after dependency upgrades, run `npx tsc --noEmit` and inspect lib/tsconfig mismatches.
- When debugging async race conditions, add short waits and logs with correlation IDs to reproduce ordering issues reliably.

Learnings

- Prefer small, well-named helper functions rather than long monolithic functions — this makes unit testing and reasoning much easier.
- Always reset or re-create shared test state between tests; implicit shared state is the most common cause of flakiness.

Examples

Wrong:

- Mutating a module-scoped object during tests and relying on order of execution.

Right:

- Create fresh instances in each test or use beforeEach to reset shared structures.

Notes

- This file is intended to be concise. If there are larger procedures or multi-step debug flows discovered later, consider creating a separate skill or expanding this file's sections with concrete examples.
